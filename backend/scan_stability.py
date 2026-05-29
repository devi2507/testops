"""Shared helpers for stable scan execution, Groq calls, and SSE streaming."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi.responses import StreamingResponse

GROQ_MODEL = "llama-3.1-8b-instant"
MAX_LOG_LINES = 80
MAX_CODE_CHARS = 12_000
MAX_FINDINGS_JSON = 3_500
GROQ_MAX_TOKENS_CODE = 1_800
GROQ_MAX_TOKENS_URL = 1_500
SCAN_TASK_TIMEOUT_SEC = 600
SSE_HEARTBEAT_SEC = 12.0
TERMINAL_STATUSES = frozenset({"completed", "cancelled", "failed"})

LEVEL_DEBUG = "debug"
LEVEL_INTERNAL = "internal"
LEVEL_USER = "user_visible"

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Type": "text/event-stream; charset=utf-8",
}

BROWSER_AUTOMATION_DISABLED_MSG = (
    "Browser automation is disabled for platform stability. "
    "Use URL security scanning for live endpoint analysis."
)

# Per-scan async queues for instant SSE delivery (scan_id -> Queue)
scan_queues: dict[str, asyncio.Queue] = {}
_STREAM_END = object()


def utc_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_log_type(msg: str = "") -> str:
    """Map user-facing milestone text to UI color category."""
    m = (msg or "").lower()
    if any(x in m for x in ("failed", "error")):
        return "error"
    if "cancel" in m:
        return "warning"
    if any(x in m for x in ("completed", "generated", "validated")):
        return "success"
    if "running" in m:
        return "warning"
    return "info"


def ensure_scan_queue(test_id: str) -> asyncio.Queue:
    if test_id not in scan_queues:
        scan_queues[test_id] = asyncio.Queue()
    return scan_queues[test_id]


def init_scan_stream_state(active_tests: dict, test_id: str) -> None:
    """Initialize per-scan SSE dedup + user-visible event history."""
    state = active_tests.setdefault(test_id, {})
    state.setdefault("logs", [])
    state.setdefault("user_events", [])
    state.setdefault("sse_seen_keys", set())


def format_sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


def update_scan_progress(active_tests: dict, test_id: str, pct: int) -> None:
    """Update progress percentage without emitting SSE noise."""
    state = active_tests.get(test_id)
    if state is not None:
        state["progress"] = pct


def _append_internal_log(active_tests: dict, test_id: str, msg: str) -> None:
    """Optional internal trace (never streamed to SSE)."""
    state = active_tests.get(test_id)
    if not state:
        return
    logs = state.setdefault("logs", [])
    logs.append(msg)
    if len(logs) > MAX_LOG_LINES:
        state["logs"] = logs[-MAX_LOG_LINES:]


def _is_duplicate_user_event(state: dict, event_key: str) -> bool:
    seen = state.setdefault("sse_seen_keys", set())
    if event_key in seen:
        return True
    seen.add(event_key)
    return False


async def emit_scan_event(
    active_tests: dict,
    test_id: str,
    msg: str,
    pct: Optional[int] = None,
    *,
    event: str = "log",
    status: Optional[str] = None,
    log_type: Optional[str] = None,
    level: str = LEVEL_INTERNAL,
    event_key: Optional[str] = None,
) -> None:
    """
    Record scan activity. Only ``level=user_visible`` events are pushed to SSE.
    ``event_key`` enforces once-only milestones (e.g. report_generated).
    """
    state = active_tests.get(test_id)
    if not state:
        return

    if pct is not None:
        state["progress"] = pct

    if level in (LEVEL_DEBUG, LEVEL_INTERNAL):
        _append_internal_log(active_tests, test_id, msg)
        return

    key = event_key or msg.strip().lower().replace(" ", "_")[:64]
    if _is_duplicate_user_event(state, key):
        return

    payload: dict[str, Any] = {
        "event": event,
        "event_key": key,
        "message": msg,
        "progress": state.get("progress", 0),
        "status": status or state.get("status", "running"),
        "log_type": log_type or classify_log_type(msg),
        "level": LEVEL_USER,
        "ts": utc_ts(),
        "log_index": len(state.setdefault("user_events", [])),
        "latest_log": msg,
    }
    state["user_events"].append(payload)

    queue = ensure_scan_queue(test_id)
    await queue.put(payload)
    await asyncio.sleep(0)


async def emit_user_event(
    active_tests: dict,
    test_id: str,
    message: str,
    pct: Optional[int] = None,
    *,
    event_key: str,
    log_type: Optional[str] = None,
    event: str = "log",
    status: Optional[str] = None,
) -> None:
    """Emit a deduplicated user-visible milestone to the SSE stream."""
    await emit_scan_event(
        active_tests,
        test_id,
        message,
        pct,
        event=event,
        status=status,
        log_type=log_type,
        level=LEVEL_USER,
        event_key=event_key,
    )


async def emit_scan_status(
    active_tests: dict,
    test_id: str,
    status: str,
    msg: Optional[str] = None,
    pct: Optional[int] = None,
    *,
    log_type: Optional[str] = None,
    event: str = "status",
    event_key: Optional[str] = None,
) -> None:
    state = active_tests.get(test_id)
    if not state:
        return
    state["status"] = status
    if pct is not None:
        state["progress"] = pct

    if not msg:
        if status in TERMINAL_STATUSES:
            payload = {
                "event": event,
                "event_key": event_key or f"scan_{status}",
                "message": "",
                "progress": state.get("progress", 0),
                "status": status,
                "log_type": log_type or "info",
                "level": LEVEL_USER,
                "ts": utc_ts(),
                "latest_log": "",
            }
            if not _is_duplicate_user_event(state, payload["event_key"]):
                state.setdefault("user_events", []).append(payload)
                await ensure_scan_queue(test_id).put(payload)
                await asyncio.sleep(0)
        return

    key = event_key or {
        "completed": "scan_completed",
        "cancelled": "scan_cancelled",
        "failed": "scan_failed",
    }.get(status, f"status_{status}")

    await emit_user_event(
        active_tests,
        test_id,
        msg,
        pct,
        event_key=key,
        log_type=log_type or (
            "success" if status == "completed"
            else "warning" if status == "cancelled"
            else "error"
        ),
        event=event,
        status=status,
    )


async def finish_scan_success(active_tests: dict, test_id: str) -> None:
    """Emit terminal success milestones once each (report generated + scan completed)."""
    state = active_tests.get(test_id)
    if not state:
        return
    await emit_user_event(
        active_tests, test_id, "Report generated",
        98, event_key="report_generated", log_type="success",
    )
    state["status"] = "completed"
    await emit_user_event(
        active_tests, test_id, "Scan completed",
        100, event_key="scan_completed", log_type="success",
        event="complete", status="completed",
    )


async def close_scan_stream(test_id: str) -> None:
    queue = scan_queues.get(test_id)
    if queue:
        await queue.put(_STREAM_END)


def cleanup_scan_queue(test_id: str) -> None:
    scan_queues.pop(test_id, None)


def finalize_active_test(active_tests: dict, test_id: str, max_sessions: int = 25) -> None:
    state = active_tests.get(test_id)
    if not state:
        return
    logs = state.get("logs", [])
    if len(logs) > MAX_LOG_LINES:
        state["logs"] = logs[-MAX_LOG_LINES:]
    state.pop("steps", None)

    if len(active_tests) <= max_sessions:
        return
    finished = [
        tid for tid, entry in active_tests.items()
        if entry.get("status") in TERMINAL_STATUSES
    ]
    for tid in finished[: max(0, len(active_tests) - max_sessions)]:
        if tid != test_id:
            active_tests.pop(tid, None)
            cleanup_scan_queue(tid)


def sse_streaming_response(generator) -> StreamingResponse:
    return StreamingResponse(generator, media_type="text/event-stream", headers=SSE_HEADERS)


async def progress_event_stream(test_id: str, active_tests: dict):
    """Stream only user-visible events from the per-scan queue."""
    if test_id not in active_tests:
        yield format_sse({"event": "error", "message": "test not found", "status": "error"})
        return

    queue = ensure_scan_queue(test_id)
    state = active_tests[test_id]

    for payload in state.get("user_events", []):
        replay = dict(payload)
        replay["replay"] = True
        yield format_sse(replay)

    if state.get("status") in TERMINAL_STATUSES:
        cleanup_scan_queue(test_id)
        return

    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=SSE_HEARTBEAT_SEC)
        except asyncio.TimeoutError:
            if test_id not in active_tests:
                break
            cur = active_tests[test_id]
            yield format_sse({
                "event": "heartbeat",
                "progress": cur.get("progress", 0),
                "status": cur.get("status", "running"),
                "ts": utc_ts(),
            })
            if cur.get("status") in TERMINAL_STATUSES:
                break
            continue

        if item is _STREAM_END:
            break

        if item.get("level") != LEVEL_USER:
            continue

        yield format_sse(item)

        if item.get("status") in TERMINAL_STATUSES and item.get("event") in {
            "status", "complete", "cancelled", "error",
        }:
            break

    cleanup_scan_queue(test_id)


async def call_groq(client, system: str, user: str, max_tokens: int) -> str:
    def _invoke() -> str:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0,
            max_tokens=max_tokens,
        )
        return (response.choices[0].message.content or "").strip()

    return await asyncio.wait_for(asyncio.to_thread(_invoke), timeout=120)


async def groq_chat_with_fallback(
    client,
    models: list[str],
    messages: list[dict],
    *,
    max_tokens: int = 3500,
    on_model_retry: Optional[Callable[[str], Awaitable[None]]] = None,
):
    """Run Groq chat in a worker thread so the event loop can stream SSE."""
    last_exc: Optional[Exception] = None
    for i, model_name in enumerate(models):
        try:

            def _invoke(m=model_name):
                return client.chat.completions.create(
                    model=m,
                    messages=messages,
                    temperature=0,
                    max_tokens=max_tokens,
                )

            return await asyncio.wait_for(asyncio.to_thread(_invoke), timeout=180)
        except Exception as exc:
            last_exc = exc
            err_str = str(exc).lower()
            if (
                i < len(models) - 1
                and any(x in err_str for x in ("rate_limit", "429", "too many requests"))
            ):
                if on_model_retry:
                    await on_model_retry(model_name)
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("Groq request failed")


def trim_findings_for_ai(findings: dict, max_chars: int = MAX_FINDINGS_JSON) -> str:
    sensitive = findings.get("sensitive_paths") or {}
    rate = findings.get("rate_limiting") or {}
    slim = {
        "target_context": findings.get("target_context"),
        "status_code": findings.get("status_code"),
        "http_to_https": findings.get("http_to_https"),
        "security_headers": findings.get("security_headers"),
        "cookies": findings.get("cookies"),
        "cors": findings.get("cors"),
        "ssl": findings.get("ssl"),
        "sensitive_paths": {
            "exposed_paths": sensitive.get("exposed_paths"),
            "api_documentation_exposed": sensitive.get("api_documentation_exposed"),
            "admin_or_dashboard_exposed": sensitive.get("admin_or_dashboard_exposed"),
        },
        "rate_limiting": {
            "tested_existing_endpoint": rate.get("tested_existing_endpoint"),
            "protected": rate.get("protected"),
        },
    }
    return json.dumps(slim, default=str)[:max_chars]


async def run_background_scan(coro, *args):
    """Run a scan coroutine without letting exceptions crash the server."""
    test_id = args[0] if args else None
    try:
        await asyncio.wait_for(coro(*args), timeout=SCAN_TASK_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        print(f"[Scan] Timed out after {SCAN_TASK_TIMEOUT_SEC}s: {test_id}")
    except Exception as exc:
        import traceback
        print(f"[Scan] Unhandled background error: {exc}")
        traceback.print_exc()
    finally:
        if test_id:
            await close_scan_stream(test_id)
