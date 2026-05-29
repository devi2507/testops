"""
playwright_runtime — Isolated, sandboxed Playwright runner for page-render
validation.  Headless Chromium only, one browser at a time, hard-capped at
10 actions and 30 seconds.

Designed to run as a subprocess so a crash never takes down the main
FastAPI process.
"""

from .runner import run_render_check, run_render_check_subprocess  # noqa: F401
