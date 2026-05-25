"""
UI Interaction Testing API — SSE-streaming endpoint.

Browser automation (Playwright) is disabled for platform stability.
Templates remain available; live UI runs return a graceful SSE error.
"""

import json
import logging
import uuid
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from scan_stability import BROWSER_AUTOMATION_DISABLED_MSG, sse_streaming_response
from ui_testing.templates import get_all_templates

logger = logging.getLogger("api.ui_test")

ui_test_router = APIRouter(tags=["UI Testing"])


class UITestOptions(BaseModel):
    headless: bool = True
    timeout_per_step: int = 30
    timeout_total: int = 300
    llm_model: str = "gpt-4o-mini"
    llm_provider: str = "openai"


class UITestRequest(BaseModel):
    url: str
    instructions: list[str] = []
    custom_instructions: list[str] = []
    options: Optional[UITestOptions] = None

    @field_validator("url", mode="before")
    @classmethod
    def normalize_url(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("URL is required")
        if not v.lower().startswith(("http://", "https://")):
            v = f"https://{v}"
        return v

    @field_validator("instructions", "custom_instructions", mode="before")
    @classmethod
    def clean_instructions(cls, v):
        if isinstance(v, str):
            return [line.strip() for line in v.split("\n") if line.strip()]
        if v is None:
            return []
        if isinstance(v, list):
            return [str(i).strip() for i in v if str(i).strip()]
        return [str(v).strip()] if str(v).strip() else []


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "URL must use http or https scheme")
    if not parsed.hostname:
        raise HTTPException(400, "Invalid URL — no hostname found")


def _sse_event(event_type: str, data: dict) -> str:
    payload = json.dumps({"type": event_type, **data}, default=str)
    return f"event: {event_type}\ndata: {payload}\n\n"


@ui_test_router.post("/api/test/ui-interactions")
async def start_ui_test(req: UITestRequest, request: Request):
    """Browser automation disabled — return a short, graceful SSE response."""
    _validate_url(req.url)
    test_id = str(uuid.uuid4())

    async def event_stream():
        yield _sse_event("test_start", {"test_id": test_id, "url": req.url})
        yield _sse_event("test_error", {
            "test_id": test_id,
            "error": BROWSER_AUTOMATION_DISABLED_MSG,
        })

    return sse_streaming_response(event_stream())


@ui_test_router.get("/api/test/ui-templates")
async def get_ui_templates():
    return get_all_templates()


@ui_test_router.get("/api/test/ui-results/{test_id}")
async def get_ui_results(test_id: str):
    raise HTTPException(status_code=503, detail=BROWSER_AUTOMATION_DISABLED_MSG)
