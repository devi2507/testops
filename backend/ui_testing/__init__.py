"""
UI Testing Module — AI-powered UI interaction testing with Playwright + browser-use.
"""

from .runner import UITestRunner, UITestConfig, StepResult
from .form_detector import FormDetector
from .report_builder import ReportBuilder, UITestReport
from .templates import INSTRUCTION_TEMPLATES

__all__ = [
    "UITestRunner",
    "UITestConfig",
    "StepResult",
    "FormDetector",
    "ReportBuilder",
    "UITestReport",
    "INSTRUCTION_TEMPLATES",
]
