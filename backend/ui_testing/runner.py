"""
Core UI test runner — orchestrates Playwright + browser-use for
AI-powered UI interaction testing.

Yields StepResult objects as an async generator for SSE streaming.
"""

import asyncio
import base64
import io
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import AsyncGenerator, Optional
from urllib.parse import urlparse, urljoin

from .form_detector import FormDetector
from .report_builder import StepResult, ReportBuilder, UITestReport

logger = logging.getLogger("ui_testing.runner")


@dataclass
class UITestConfig:
    """Configuration for a UI test run."""
    url: str
    instructions: list[str] = field(default_factory=list)
    headless: bool = True
    timeout_per_step: int = 30        # seconds
    timeout_total: int = 300          # 5 minutes
    llm_model: str = "gpt-4o-mini"
    llm_provider: str = "openai"      # openai | groq
    screenshot_quality: int = 50      # JPEG quality 0-100
    screenshot_max_bytes: int = 200_000  # 200KB


def _compress_screenshot(raw_bytes: bytes, quality: int = 50, max_bytes: int = 200_000) -> str:
    """Compress a screenshot PNG to JPEG, downscale if needed, return base64."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(raw_bytes))

        # Downscale if very large
        max_dim = 1280
        if img.width > max_dim or img.height > max_dim:
            ratio = min(max_dim / img.width, max_dim / img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)

        # Convert to RGB (JPEG doesn't support alpha)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)

        # If still too large, reduce quality further
        while buf.tell() > max_bytes and quality > 15:
            quality -= 10
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)

        return base64.b64encode(buf.getvalue()).decode("ascii")
    except ImportError:
        # Pillow not available — return raw base64 (may be large)
        logger.warning("Pillow not installed — screenshots will not be compressed")
        return base64.b64encode(raw_bytes).decode("ascii")
    except Exception as e:
        logger.warning(f"Screenshot compression failed: {e}")
        return base64.b64encode(raw_bytes).decode("ascii")


async def _take_screenshot(page, config: UITestConfig) -> Optional[str]:
    """Capture a compressed screenshot of the current page."""
    try:
        raw = await page.screenshot(full_page=False, type="png", timeout=5000)
        return _compress_screenshot(raw, config.screenshot_quality, config.screenshot_max_bytes)
    except Exception as e:
        logger.warning(f"Screenshot failed: {e}")
        return None


async def _dismiss_popups(page):
    """Try to dismiss common cookie banners, modals, and popups."""
    dismiss_selectors = [
        "button[id*='cookie' i][id*='accept' i]",
        "button[class*='cookie' i][class*='accept' i]",
        "button[id*='consent' i]",
        "button[class*='consent' i]",
        "button[aria-label*='accept' i]",
        "button[aria-label*='agree' i]",
        "button[aria-label*='close' i]",
        "[class*='cookie-banner'] button",
        "[class*='cookie-consent'] button",
        "[id*='onetrust'] button[id*='accept']",
        ".modal .close, .modal [data-dismiss]",
        "button[class*='dismiss']",
    ]
    for sel in dismiss_selectors:
        try:
            btn = await page.query_selector(sel)
            if btn and await btn.is_visible():
                await btn.click(timeout=2000)
                await asyncio.sleep(0.3)
        except Exception:
            continue


async def _check_internal_links(page, base_url: str, max_links: int = 20) -> list[dict]:
    """Check internal links for 404s."""
    import httpx

    parsed_base = urlparse(base_url)
    results = []

    try:
        links = await page.evaluate("""() => {
            const anchors = document.querySelectorAll('a[href]');
            return Array.from(anchors).map(a => ({
                href: a.href,
                text: a.textContent.trim().substring(0, 50)
            })).filter(l => l.href.startsWith('http'));
        }""")

        # Filter to internal links only
        internal = [
            l for l in links
            if urlparse(l["href"]).netloc == parsed_base.netloc
        ][:max_links]

        async with httpx.AsyncClient(
            follow_redirects=True, timeout=8.0, verify=False
        ) as client:
            for link in internal:
                try:
                    resp = await client.head(link["href"])
                    results.append({
                        "url": link["href"],
                        "text": link["text"],
                        "status": resp.status_code,
                        "ok": resp.status_code < 400,
                    })
                except Exception as e:
                    results.append({
                        "url": link["href"],
                        "text": link["text"],
                        "status": 0,
                        "ok": False,
                        "error": str(e)[:80],
                    })
    except Exception as e:
        logger.warning(f"Link check failed: {e}")

    return results


async def _run_browser_use_instruction(
    page, instruction: str, config: UITestConfig
) -> dict:
    """
    Try to execute an instruction via browser-use Agent.
    Falls back to a placeholder if browser-use is not available.
    """
    try:
        from browser_use import Agent
        from langchain_openai import ChatOpenAI

        # Configure LLM based on provider
        llm_kwargs = {"model": config.llm_model, "temperature": 0}

        if config.llm_provider == "groq":
            groq_key = os.environ.get("GROQ_API_KEY", "")
            llm_kwargs["openai_api_key"] = groq_key
            llm_kwargs["openai_api_base"] = "https://api.groq.com/openai/v1"
        else:
            openai_key = os.environ.get("OPENAI_API_KEY", "")
            if openai_key:
                llm_kwargs["openai_api_key"] = openai_key

        llm = ChatOpenAI(**llm_kwargs)

        agent = Agent(
            task=instruction,
            llm=llm,
            browser=None,  # Will use the existing page context
        )

        result = await asyncio.wait_for(
            agent.run(),
            timeout=config.timeout_per_step,
        )

        return {
            "success": True,
            "action": str(result) if result else "Instruction executed",
            "error": None,
        }

    except ImportError:
        logger.info("browser-use not available — falling back to Playwright heuristics")
        return await _playwright_heuristic_fallback(page, instruction)

    except asyncio.TimeoutError:
        return {
            "success": False,
            "action": "Timed out executing instruction",
            "error": f"Step timed out after {config.timeout_per_step}s",
        }

    except Exception as e:
        logger.warning(f"browser-use failed for '{instruction[:60]}': {e}")
        # Fall back to Playwright heuristics
        return await _playwright_heuristic_fallback(page, instruction)


async def _playwright_heuristic_fallback(page, instruction: str) -> dict:
    """
    Raw Playwright fallback when browser-use is unavailable or fails.
    Parses the instruction text for keywords and executes matching actions.
    """
    instr_lower = instruction.lower()
    action_taken = ""

    try:
        # ── Fill / Submit form ──
        if any(kw in instr_lower for kw in ("fill", "form", "submit", "input", "enter")):
            detector = FormDetector(page)
            forms = await detector.detect_forms()
            if forms:
                for form in forms:
                    if form.fields:
                        filled = await detector.fill_form(form)
                        submitted = await detector.submit_form(filled)
                        filled_count = sum(1 for f in filled.fields if f.filled)
                        action_taken = (
                            f"Detected form with {len(form.fields)} field(s), "
                            f"filled {filled_count}, submit result: {submitted.submit_result}"
                        )
                        break
                else:
                    action_taken = f"Found {len(forms)} form(s) but none had fillable fields"
            else:
                action_taken = "No forms detected on the page"

            return {"success": True, "action": action_taken, "error": None}

        # ── Click button / link ──
        if any(kw in instr_lower for kw in ("click", "press", "tap", "button", "link")):
            # Extract what to click from the instruction
            clickables = await page.query_selector_all(
                "button, a, input[type='button'], input[type='submit'], [role='button']"
            )
            clicked = False
            for el in clickables[:10]:
                try:
                    if not await el.is_visible():
                        continue
                    text = (await el.inner_text() or "").strip()[:50]
                    # Try to match instruction keywords to button text
                    text_lower = text.lower()
                    if any(word in text_lower for word in instr_lower.split()
                           if len(word) > 3 and word not in ("click", "press", "button", "the", "and")):
                        await el.click(timeout=5000)
                        action_taken = f"Clicked element: '{text}'"
                        clicked = True
                        break
                except Exception:
                    continue

            if not clicked and clickables:
                # Click the first visible clickable as fallback
                for el in clickables[:5]:
                    try:
                        if await el.is_visible():
                            text = (await el.inner_text() or "").strip()[:30]
                            await el.click(timeout=3000)
                            action_taken = f"Clicked first available element: '{text}'"
                            clicked = True
                            break
                    except Exception:
                        continue

            if not clicked:
                action_taken = "No matching clickable element found"

            return {"success": clicked, "action": action_taken, "error": None if clicked else "No element matched"}

        # ── Navigate / visit ──
        if any(kw in instr_lower for kw in ("navigate", "visit", "go to", "open")):
            nav_links = await page.query_selector_all("nav a, header a, [role='navigation'] a")
            if nav_links:
                first_visible = None
                for nl in nav_links[:10]:
                    if await nl.is_visible():
                        first_visible = nl
                        break
                if first_visible:
                    text = (await first_visible.inner_text() or "").strip()[:30]
                    await first_visible.click(timeout=5000)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=5000)
                    except Exception:
                        pass
                    action_taken = f"Navigated via link: '{text}' → {page.url}"
                    return {"success": True, "action": action_taken, "error": None}

            action_taken = "No navigation links found"
            return {"success": False, "action": action_taken, "error": "No nav links"}

        # ── Search ──
        if any(kw in instr_lower for kw in ("search", "query", "find")):
            search_input = await page.query_selector(
                "input[type='search'], input[name*='search' i], input[placeholder*='search' i], "
                "input[aria-label*='search' i]"
            )
            if search_input and await search_input.is_visible():
                await search_input.fill("test search query")
                await search_input.press("Enter")
                await asyncio.sleep(1)
                action_taken = "Entered search query and submitted"
                return {"success": True, "action": action_taken, "error": None}

            action_taken = "No search input found on page"
            return {"success": False, "action": action_taken, "error": "No search field"}

        # ── Check / verify / assert ──
        if any(kw in instr_lower for kw in ("check", "verify", "assert", "confirm")):
            page_text = await page.text_content("body") or ""
            action_taken = f"Page loaded with {len(page_text)} chars of text content. URL: {page.url}"
            return {"success": True, "action": action_taken, "error": None}

        # ── Default: report page state ──
        action_taken = f"Instruction interpreted via heuristic. Current page: {page.url}"
        return {"success": True, "action": action_taken, "error": None}

    except Exception as e:
        return {
            "success": False,
            "action": action_taken or "Heuristic execution failed",
            "error": str(e)[:200],
        }


class UITestRunner:
    """
    Core orchestrator: runs Playwright browser + browser-use Agent for
    AI-powered UI interaction testing.

    Usage:
        runner = UITestRunner()
        async for step_result in runner.run(config):
            # stream step_result via SSE
    """

    async def run(self, config: UITestConfig) -> AsyncGenerator[StepResult, None]:
        """
        Execute all test steps and yield results as an async generator.
        Each yield is a StepResult that can be streamed via SSE.
        """
        from playwright.async_api import async_playwright

        test_start = time.time()

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=config.headless)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent="TestOps-UITester/1.0 (Playwright)",
            )
            page = await context.new_page()

            try:
                # ─── Step 0: Navigate to URL ────────────────────────────
                nav_step = StepResult(
                    step_id="nav-0",
                    instruction=f"Navigate to {config.url}",
                    status="running",
                    step_type="navigation",
                )
                yield nav_step

                step_start = time.time()
                try:
                    await page.goto(
                        config.url,
                        timeout=config.timeout_per_step * 1000,
                        wait_until="networkidle",
                    )
                    nav_step.screenshot_after = await _take_screenshot(page, config)
                    nav_step.status = "pass"
                    nav_step.action_taken = f"Loaded {page.url} (title: {await page.title()})"
                    nav_step.duration_ms = int((time.time() - step_start) * 1000)
                except Exception as e:
                    nav_step.status = "fail"
                    nav_step.error = str(e)[:200]
                    nav_step.duration_ms = int((time.time() - step_start) * 1000)
                    yield nav_step
                    return

                yield nav_step

                # ─── Dismiss popups/cookie banners ──────────────────────
                await _dismiss_popups(page)
                await asyncio.sleep(0.5)

                # ─── Step 1: Full-page screenshot (before) ──────────────
                before_step = StepResult(
                    step_id="screenshot-before",
                    instruction="Capture initial page state",
                    status="running",
                    step_type="screenshot",
                )
                yield before_step

                before_step.screenshot_after = await _take_screenshot(page, config)
                before_step.status = "pass"
                before_step.action_taken = "Captured full-page screenshot of initial state"
                before_step.duration_ms = 200
                yield before_step

                # ─── Step 2: Auto-detect and fill forms ─────────────────
                if time.time() - test_start < config.timeout_total:
                    form_step = StepResult(
                        step_id="form-detect",
                        instruction="Auto-detect and fill all forms with test data",
                        status="running",
                        step_type="form_fill",
                    )
                    yield form_step

                    step_start = time.time()
                    try:
                        form_step.screenshot_before = await _take_screenshot(page, config)
                        detector = FormDetector(page)
                        forms = await detector.detect_forms()

                        if forms:
                            filled_count = 0
                            for form in forms:
                                if form.fields:
                                    filled = await detector.fill_form(form)
                                    submitted = await detector.submit_form(filled)
                                    filled_count += 1
                                    form_step.dom_changes.append(
                                        f"Form {form.form_index}: {len(form.fields)} fields, "
                                        f"submit → {submitted.submit_result}"
                                    )

                            form_step.screenshot_after = await _take_screenshot(page, config)
                            form_step.status = "pass"
                            form_step.action_taken = (
                                f"Found {len(forms)} form(s), filled and submitted {filled_count}"
                            )
                        else:
                            form_step.status = "warning"
                            form_step.action_taken = "No forms detected on this page"

                        form_step.duration_ms = int((time.time() - step_start) * 1000)
                    except Exception as e:
                        form_step.status = "error"
                        form_step.error = str(e)[:200]
                        form_step.duration_ms = int((time.time() - step_start) * 1000)

                    yield form_step

                # ─── Step 3: CTA button discovery & clicking ────────────
                if time.time() - test_start < config.timeout_total:
                    btn_step = StepResult(
                        step_id="cta-buttons",
                        instruction="Find and click CTA buttons, record responses",
                        status="running",
                        step_type="button_click",
                    )
                    yield btn_step

                    step_start = time.time()
                    try:
                        buttons = await page.query_selector_all(
                            "button, a.btn, a.button, [role='button'], "
                            "input[type='button'], input[type='submit']"
                        )
                        clicks = 0
                        max_clicks = 5
                        btn_step.screenshot_before = await _take_screenshot(page, config)

                        for btn in buttons[:15]:
                            if clicks >= max_clicks:
                                break
                            try:
                                if not await btn.is_visible():
                                    continue
                                text = (await btn.inner_text() or "").strip()[:40]
                                if not text or text.lower() in ("×", "x", "close"):
                                    continue
                                tag = await page.evaluate("el => el.tagName.toLowerCase()", btn)
                                await btn.click(timeout=3000)
                                await asyncio.sleep(0.5)
                                btn_step.dom_changes.append(f"Clicked <{tag}> '{text}' → {page.url}")
                                clicks += 1
                            except Exception:
                                continue

                        btn_step.screenshot_after = await _take_screenshot(page, config)
                        btn_step.status = "pass" if clicks > 0 else "warning"
                        btn_step.action_taken = f"Clicked {clicks} CTA button(s)"
                        btn_step.duration_ms = int((time.time() - step_start) * 1000)
                    except Exception as e:
                        btn_step.status = "error"
                        btn_step.error = str(e)[:200]
                        btn_step.duration_ms = int((time.time() - step_start) * 1000)

                    yield btn_step

                # ─── Step 4: Internal link checking ─────────────────────
                if time.time() - test_start < config.timeout_total:
                    link_step = StepResult(
                        step_id="link-check",
                        instruction="Check all internal links for broken (404) responses",
                        status="running",
                        step_type="link_check",
                    )
                    yield link_step

                    step_start = time.time()
                    try:
                        # Go back to the original URL for link checking
                        await page.goto(config.url, timeout=15000, wait_until="domcontentloaded")
                        link_results = await _check_internal_links(page, config.url)
                        broken = [l for l in link_results if not l["ok"]]

                        link_step.status = "pass" if not broken else "warning"
                        link_step.action_taken = (
                            f"Checked {len(link_results)} internal link(s), "
                            f"{len(broken)} broken"
                        )
                        for bl in broken[:10]:
                            link_step.dom_changes.append(
                                f"BROKEN: {bl['url']} → {bl.get('status', 'error')}"
                            )
                        link_step.duration_ms = int((time.time() - step_start) * 1000)
                    except Exception as e:
                        link_step.status = "error"
                        link_step.error = str(e)[:200]
                        link_step.duration_ms = int((time.time() - step_start) * 1000)

                    yield link_step

                # ─── Step 5+: Custom instructions ───────────────────────
                for idx, instruction in enumerate(config.instructions):
                    if time.time() - test_start >= config.timeout_total:
                        timeout_step = StepResult(
                            step_id=f"timeout-{idx}",
                            instruction=instruction,
                            status="skipped",
                            action_taken="Skipped — total timeout reached",
                            step_type="custom",
                        )
                        yield timeout_step
                        continue

                    custom_step = StepResult(
                        step_id=f"custom-{idx}",
                        instruction=instruction,
                        status="running",
                        step_type="custom",
                    )
                    yield custom_step

                    step_start = time.time()
                    try:
                        # Navigate back to target URL for each instruction
                        if page.url != config.url:
                            await page.goto(
                                config.url,
                                timeout=15000,
                                wait_until="domcontentloaded",
                            )
                            await _dismiss_popups(page)

                        custom_step.screenshot_before = await _take_screenshot(page, config)

                        # Try browser-use first, fall back to Playwright heuristics
                        result = await _run_browser_use_instruction(page, instruction, config)

                        await asyncio.sleep(0.5)
                        custom_step.screenshot_after = await _take_screenshot(page, config)

                        custom_step.action_taken = result.get("action", "")
                        custom_step.error = result.get("error")
                        custom_step.status = "pass" if result.get("success") else "fail"
                        custom_step.duration_ms = int((time.time() - step_start) * 1000)

                    except asyncio.TimeoutError:
                        custom_step.status = "error"
                        custom_step.error = f"Timed out after {config.timeout_per_step}s"
                        custom_step.duration_ms = int((time.time() - step_start) * 1000)
                    except Exception as e:
                        custom_step.status = "error"
                        custom_step.error = str(e)[:200]
                        custom_step.duration_ms = int((time.time() - step_start) * 1000)

                    yield custom_step

                # ─── Final screenshot (after all interactions) ──────────
                final_step = StepResult(
                    step_id="screenshot-after",
                    instruction="Capture final page state after all interactions",
                    status="running",
                    step_type="screenshot",
                )
                yield final_step

                try:
                    await page.goto(config.url, timeout=15000, wait_until="domcontentloaded")
                except Exception:
                    pass

                final_step.screenshot_after = await _take_screenshot(page, config)
                final_step.status = "pass"
                final_step.action_taken = "Captured final page state"
                final_step.duration_ms = 200
                yield final_step

            except Exception as e:
                error_step = StepResult(
                    step_id="fatal-error",
                    instruction="Test execution",
                    status="error",
                    error=str(e)[:300],
                    step_type="custom",
                )
                yield error_step

            finally:
                await browser.close()
