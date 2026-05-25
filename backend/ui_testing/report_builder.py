"""
Report builder — aggregates StepResult objects into a structured UI test report.
"""

import time
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class StepResult:
    """Result of a single UI test step."""
    step_id: str
    instruction: str
    status: str = "pending"       # pending | running | pass | fail | warning | error | skipped
    action_taken: str = ""
    screenshot_before: Optional[str] = None   # base64
    screenshot_after: Optional[str] = None    # base64
    dom_changes: list[str] = field(default_factory=list)
    duration_ms: int = 0
    error: Optional[str] = None
    step_type: str = "custom"     # custom | form_fill | button_click | link_check | screenshot

    def to_dict(self) -> dict:
        d = asdict(self)
        # Strip large screenshots for SSE events if needed
        return d

    def to_sse_dict(self) -> dict:
        """Lightweight dict for SSE streaming — omits screenshot data."""
        return {
            "step_id": self.step_id,
            "instruction": self.instruction,
            "status": self.status,
            "action_taken": self.action_taken,
            "has_screenshot_before": self.screenshot_before is not None,
            "has_screenshot_after": self.screenshot_after is not None,
            "dom_changes": self.dom_changes[:5],
            "duration_ms": self.duration_ms,
            "error": self.error,
            "step_type": self.step_type,
        }


@dataclass
class UITestReport:
    """Complete UI test report aggregating all steps."""
    test_id: str
    url: str
    started_at: float = 0.0
    completed_at: float = 0.0
    total_steps: int = 0
    passed: int = 0
    failed: int = 0
    warnings: int = 0
    errors: int = 0
    skipped: int = 0
    steps: list[StepResult] = field(default_factory=list)
    forms_detected: int = 0
    forms_filled: int = 0
    buttons_clicked: int = 0
    links_checked: int = 0
    links_broken: int = 0
    overall_status: str = "pending"  # pending | running | completed | failed | timeout

    def to_dict(self) -> dict:
        return {
            "test_id": self.test_id,
            "url": self.url,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": int((self.completed_at - self.started_at) * 1000) if self.completed_at else 0,
            "total_steps": self.total_steps,
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "errors": self.errors,
            "skipped": self.skipped,
            "forms_detected": self.forms_detected,
            "forms_filled": self.forms_filled,
            "buttons_clicked": self.buttons_clicked,
            "links_checked": self.links_checked,
            "links_broken": self.links_broken,
            "overall_status": self.overall_status,
            "steps": [s.to_dict() for s in self.steps],
        }

    def summary_dict(self) -> dict:
        """Lightweight summary without step details — for the final SSE event."""
        return {
            "test_id": self.test_id,
            "url": self.url,
            "duration_ms": int((self.completed_at - self.started_at) * 1000) if self.completed_at else 0,
            "total_steps": self.total_steps,
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "errors": self.errors,
            "skipped": self.skipped,
            "forms_detected": self.forms_detected,
            "forms_filled": self.forms_filled,
            "buttons_clicked": self.buttons_clicked,
            "links_checked": self.links_checked,
            "links_broken": self.links_broken,
            "overall_status": self.overall_status,
        }


class ReportBuilder:
    """Builds and updates a UITestReport incrementally."""

    def __init__(self, test_id: str, url: str):
        self.report = UITestReport(
            test_id=test_id,
            url=url,
            started_at=time.time(),
        )

    def add_step(self, step: StepResult) -> None:
        self.report.steps.append(step)
        self.report.total_steps = len(self.report.steps)
        self._update_counts()

    def update_step(self, step_id: str, **kwargs) -> StepResult | None:
        for step in self.report.steps:
            if step.step_id == step_id:
                for k, v in kwargs.items():
                    if hasattr(step, k):
                        setattr(step, k, v)
                self._update_counts()
                return step
        return None

    def finalize(self) -> UITestReport:
        self.report.completed_at = time.time()
        self._update_counts()
        if self.report.errors > 0 or self.report.failed > self.report.passed:
            self.report.overall_status = "failed"
        else:
            self.report.overall_status = "completed"
        return self.report

    def timeout(self) -> UITestReport:
        self.report.completed_at = time.time()
        self.report.overall_status = "timeout"
        # Mark any pending steps as skipped
        for step in self.report.steps:
            if step.status in ("pending", "running"):
                step.status = "skipped"
        self._update_counts()
        return self.report

    def _update_counts(self):
        self.report.passed = sum(1 for s in self.report.steps if s.status == "pass")
        self.report.failed = sum(1 for s in self.report.steps if s.status == "fail")
        self.report.warnings = sum(1 for s in self.report.steps if s.status == "warning")
        self.report.errors = sum(1 for s in self.report.steps if s.status == "error")
        self.report.skipped = sum(1 for s in self.report.steps if s.status == "skipped")
