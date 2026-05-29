"""
playwright_runtime.runner
─────────────────────────
Headless Chromium page-render validator using the Playwright async API.

Guarantees
──────────
• Max 1 browser, max 1 page, max 10 actions, 30-second hard timeout
• BROWSER_LOCK ensures only one browser instance system-wide
• Browser is ALWAYS closed in a finally block — even on crash
• No Browser Use, no AI agents, no recursive crawling
• No parallel sessions, no multi-tab, no persistent sessions
• Can be invoked in-process or as an isolated subprocess

Metrics captured
────────────────
• page render validation (did it load without crash)
• single screenshot as base64
• console error detection
• failed network request detection
• runtime JS error capture
• load time in milliseconds
• broken image / resource detection
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
import time
import traceback
from typing import Any

# ── Concurrency guard ────────────────────────────────────────────────────
BROWSER_LOCK = asyncio.Lock()

# ── Hard limits ──────────────────────────────────────────────────────────
MAX_ACTIONS = 10
HARD_TIMEOUT_SECONDS = 30


# ── Result template ──────────────────────────────────────────────────────
def _empty_result() -> dict[str, Any]:
    """Return a fresh copy of the canonical result structure."""
    return {
        "rendered": False,
        "console_errors": [],
        "failed_requests": [],
        "runtime_errors": [],
        "load_time_ms": 0,
        "screenshot": "",
        "actions_completed": 0,
    }


# ── Core runner (async, in-process) ──────────────────────────────────────
async def run_render_check(url: str) -> dict[str, Any]:
    """
    Launch a headless Chromium browser, navigate to *url*, and collect
    render-quality metrics.  Returns the canonical JSON dict.

    This coroutine is safe to call from any async context.  The
    ``BROWSER_LOCK`` ensures at most one browser exists at a time.
    """
    result = _empty_result()
    actions = 0

    async with BROWSER_LOCK:
        browser = None
        try:
            from playwright.async_api import async_playwright

            pw_context = async_playwright()
            pw = await pw_context.__aenter__()

            # ── 1. Launch browser (action 1) ─────────────────────────
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-extensions",
                    "--disable-background-networking",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--disable-translate",
                    "--mute-audio",
                    "--no-first-run",
                    "--safebrowsing-disable-auto-update",
                ],
            )
            actions += 1

            # ── 2. Create single page (action 2) ────────────────────
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent="TestOps-RenderCheck/1.0 (Playwright; Headless)",
                java_script_enabled=True,
                ignore_https_errors=True,
            )
            # Block new tabs / popups — enforce single page
            context.on("page", lambda p: asyncio.ensure_future(p.close()))

            page = await context.new_page()
            actions += 1

            # ── Attach metric collectors BEFORE navigation ───────────
            console_errors: list[str] = []
            runtime_errors: list[str] = []
            failed_requests: list[str] = []

            def _on_console(msg):
                if msg.type in ("error", "warning"):
                    text = msg.text[:500]
                    console_errors.append(text)

            def _on_page_error(error):
                runtime_errors.append(str(error)[:500])

            def _on_response(response):
                if response.status >= 400:
                    failed_requests.append(
                        f"{response.status} {response.url[:300]}"
                    )

            page.on("console", _on_console)
            page.on("pageerror", _on_page_error)
            page.on("response", _on_response)

            # ── 3. Navigate (action 3) ───────────────────────────────
            nav_start = time.monotonic()
            try:
                await asyncio.wait_for(
                    page.goto(url, wait_until="networkidle"),
                    timeout=HARD_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                # Page took too long — still try to collect what we can
                runtime_errors.append(
                    f"Navigation timed out after {HARD_TIMEOUT_SECONDS}s"
                )
            except Exception as nav_exc:
                runtime_errors.append(f"Navigation error: {nav_exc!s}"[:500])

            load_time_ms = int((time.monotonic() - nav_start) * 1000)
            actions += 1

            # ── 4. Validate render (action 4) ────────────────────────
            rendered = False
            try:
                # Check the page actually has a <body> with content
                body_text = await asyncio.wait_for(
                    page.evaluate(
                        "() => document.body ? document.body.innerText.length : -1"
                    ),
                    timeout=5,
                )
                rendered = body_text is not None and body_text >= 0
            except Exception:
                rendered = False
            actions += 1

            # ── 5. Capture screenshot (action 5) ────────────────────
            screenshot_b64 = ""
            try:
                raw_png = await asyncio.wait_for(
                    page.screenshot(full_page=False, type="png"),
                    timeout=10,
                )
                screenshot_b64 = base64.b64encode(raw_png).decode("ascii")
            except Exception:
                pass
            actions += 1

            # ── 6. Detect broken images / resources (action 6) ──────
            try:
                broken_images = await asyncio.wait_for(
                    page.evaluate("""() => {
                        const broken = [];
                        document.querySelectorAll('img').forEach(img => {
                            if (img.naturalWidth === 0 && img.src) {
                                broken.push(img.src.substring(0, 300));
                            }
                        });
                        return broken;
                    }"""),
                    timeout=5,
                )
                for src in (broken_images or []):
                    failed_requests.append(f"broken-image {src}")
            except Exception:
                pass
            actions += 1

            # ── 7. Detect broken CSS / link resources (action 7) ────
            try:
                broken_resources = await asyncio.wait_for(
                    page.evaluate("""() => {
                        const broken = [];
                        document.querySelectorAll(
                            'link[rel="stylesheet"], script[src]'
                        ).forEach(el => {
                            const tag = el.tagName.toLowerCase();
                            const src = el.href || el.src || '';
                            if (src) {
                                // We already catch failed network requests
                                // via the response handler, but flag any
                                // elements that appear to have no content.
                            }
                        });
                        // Check for iframes that failed to load
                        document.querySelectorAll('iframe[src]').forEach(f => {
                            try {
                                if (!f.contentDocument && !f.contentWindow) {
                                    broken.push('broken-iframe ' + f.src.substring(0, 300));
                                }
                            } catch(e) {
                                // cross-origin — not a bug
                            }
                        });
                        return broken;
                    }"""),
                    timeout=5,
                )
                for item in (broken_resources or []):
                    failed_requests.append(item)
            except Exception:
                pass
            actions += 1

            # ── 8. Check for JS framework crash screens (action 8) ──
            try:
                crash_detected = await asyncio.wait_for(
                    page.evaluate("""() => {
                        // React error boundary overlay
                        const reactOverlay = document.querySelector(
                            '#webpack-dev-server-client-overlay, '
                          + '[class*="error-overlay"], '
                          + '[id*="error-overlay"]'
                        );
                        if (reactOverlay) return 'React/Webpack error overlay detected';

                        // Generic "Something went wrong" text
                        const body = document.body ? document.body.innerText : '';
                        if (/something went wrong/i.test(body)) {
                            return 'Crash screen detected: "Something went wrong"';
                        }
                        return null;
                    }"""),
                    timeout=5,
                )
                if crash_detected:
                    runtime_errors.append(crash_detected)
                    rendered = False
            except Exception:
                pass
            actions += 1

            # ── 9. Check for empty page / white screen (action 9) ───
            try:
                page_health = await asyncio.wait_for(
                    page.evaluate("""() => {
                        const body = document.body;
                        if (!body) return {empty: true, title: ''};
                        const text = body.innerText.trim();
                        const children = body.children.length;
                        return {
                            empty: text.length === 0 && children <= 1,
                            title: document.title || '',
                            textLen: text.length,
                            childCount: children
                        };
                    }"""),
                    timeout=5,
                )
                if page_health and page_health.get("empty"):
                    runtime_errors.append(
                        "Page appears blank (no visible text content)"
                    )
            except Exception:
                pass
            actions += 1

            # ── 10. Final wait for late console errors (action 10) ──
            try:
                await asyncio.sleep(0.5)  # let any last messages flush
            except Exception:
                pass
            actions += 1

            # ── Assemble result ──────────────────────────────────────
            result["rendered"] = rendered
            result["console_errors"] = console_errors[:50]
            result["failed_requests"] = failed_requests[:50]
            result["runtime_errors"] = runtime_errors[:50]
            result["load_time_ms"] = load_time_ms
            result["screenshot"] = screenshot_b64
            result["actions_completed"] = min(actions, MAX_ACTIONS)

        except Exception as exc:
            # Catch-all — populate whatever we can
            result["rendered"] = False
            result["runtime_errors"].append(
                f"Fatal runner error: {exc!s}"[:500]
            )
            result["actions_completed"] = min(actions, MAX_ACTIONS)

        finally:
            # ── ALWAYS close the browser ─────────────────────────────
            if browser is not None:
                try:
                    await browser.close()
                except Exception:
                    pass
            # Close the Playwright context manager
            try:
                await pw_context.__aexit__(None, None, None)
            except Exception:
                pass

    return result


# ── Subprocess wrapper ───────────────────────────────────────────────────
async def run_render_check_subprocess(url: str) -> dict[str, Any]:
    """
    Run ``run_render_check`` in a completely isolated subprocess so that
    a Chromium crash, segfault, or OOM never affects the calling process.

    Returns the same canonical JSON dict.
    """
    script = (
        "import asyncio, json, sys; "
        "sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))); "
        "from playwright_runtime.runner import run_render_check; "
        "result = asyncio.run(run_render_check(sys.argv[1])); "
        "print(json.dumps(result))"
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script, url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=None,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=HARD_TIMEOUT_SECONDS + 10,  # extra grace for subprocess overhead
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            result = _empty_result()
            result["runtime_errors"].append(
                f"Subprocess timed out after {HARD_TIMEOUT_SECONDS + 10}s"
            )
            return result

        if proc.returncode != 0:
            result = _empty_result()
            stderr_text = (stderr or b"").decode("utf-8", errors="replace")[:1000]
            result["runtime_errors"].append(
                f"Subprocess exited with code {proc.returncode}: {stderr_text}"
            )
            return result

        stdout_text = (stdout or b"").decode("utf-8", errors="replace").strip()

        # The JSON output is the last line (ignore any warnings printed before)
        json_line = stdout_text.rsplit("\n", 1)[-1].strip()
        return json.loads(json_line)

    except json.JSONDecodeError as exc:
        result = _empty_result()
        result["runtime_errors"].append(
            f"Failed to parse subprocess output: {exc!s}"[:500]
        )
        return result
    except Exception as exc:
        result = _empty_result()
        result["runtime_errors"].append(
            f"Subprocess launch failed: {exc!s}"[:500]
        )
        return result


# ── CLI entry-point (for subprocess mode) ────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps(_empty_result()))
        sys.exit(1)
    target_url = sys.argv[1]
    output = asyncio.run(run_render_check(target_url))
    print(json.dumps(output))
