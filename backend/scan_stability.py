"""Shared helpers for stable scan execution, Groq calls, and SSE streaming."""

from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi.responses import StreamingResponse

GROQ_MODEL = "llama-3.1-8b-instant"
MAX_LOG_LINES = 80
MAX_CODE_CHARS = 12_000
MAX_FINDINGS_JSON = 3_500
GROQ_MAX_TOKENS_CODE = 1_800
GROQ_MAX_TOKENS_URL = 1_500
SCAN_TASK_TIMEOUT_SEC = 600

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

BROWSER_AUTOMATION_DISABLED_MSG = (
    "Browser automation is disabled for platform stability. "
    "Use URL security scanning for live endpoint analysis."
)


def append_scan_log(active_tests: dict, test_id: str, msg: str, pct: Optional[int] = None) -> None:
    state = active_tests.get(test_id)
    if not state:
        return
    logs = state.setdefault("logs", [])
    logs.append(msg)
    if len(logs) > MAX_LOG_LINES:
        state["logs"] = logs[-MAX_LOG_LINES:]
    if pct is not None:
        state["progress"] = pct


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
        if entry.get("status") in {"completed", "cancelled", "failed"}
    ]
    for tid in finished[: max(0, len(active_tests) - max_sessions)]:
        if tid != test_id:
            active_tests.pop(tid, None)


def sse_streaming_response(generator) -> StreamingResponse:
    return StreamingResponse(generator, media_type="text/event-stream", headers=SSE_HEADERS)


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
    try:
        await asyncio.wait_for(coro(*args), timeout=SCAN_TASK_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        test_id = args[0] if args else None
        print(f"[Scan] Timed out after {SCAN_TASK_TIMEOUT_SEC}s: {test_id}")
    except Exception as exc:
        import traceback
        print(f"[Scan] Unhandled background error: {exc}")
        traceback.print_exc()
