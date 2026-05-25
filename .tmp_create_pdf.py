from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem

output_path = Path.home() / "Desktop" / "TestOps_Platform_Overview.pdf"

text = """
TestOps Platform Overview

This document explains the current TestOps Platform architecture, features, and technology stack.

1. Platform Purpose
TestOps Platform is an AI-powered security and testing platform designed to help teams run automated audits on applications, URLs, and related targets. It combines a React dashboard, a FastAPI backend, and AI-assisted analysis to deliver scan execution, live progress updates, security scoring, and report management.

2. What the platform currently does
- Start security and URL scanning workflows
- Stream execution logs and progress in real time
- Generate audit results and report summaries
- Provide AI-generated remediation guidance
- Support history and report navigation
- Offer a chat-like AI assistant for guidance

3. Current architecture
Frontend
- React 18 single-page application
- React Router for route navigation
- Context API for shared state
- Custom CSS for UI styling
- EventSource-based streaming for backend progress updates
- PDF export and icons through supporting libraries

Backend
- FastAPI API layer
- Python 3.11 runtime
- Uvicorn server
- Pydantic validation
- python-dotenv for environment variables
- httpx for outbound HTTP requests
- Groq for AI-assisted analysis
- Motor and PyMongo for MongoDB access
- python-multipart for file uploads

4. Workflow
1. User opens the React UI and chooses a scan target or configuration.
2. The frontend sends requests to the FastAPI backend.
3. The backend orchestrates the scan and streams progress updates through SSE/EventSource.
4. Results are rendered in the dashboard, history, and report views.
5. AI components generate remediation insights and summary guidance.

5. Current tech stack
Frontend
- React
- React Router DOM
- Context API
- Custom CSS
- React Scripts
- jspdf
- lucide-react

Backend
- FastAPI
- Uvicorn
- Pydantic
- Python-dotenv
- httpx
- Groq
- Motor
- PyMongo
- python-multipart

6. Current strengths
- Clean separation between frontend and backend
- Strong AI-assisted workflow
- Real-time UI updates during scans
- Flexible scan configuration and report navigation
- A solid base for a future enterprise-grade rebuild

7. Current limitations
- Browser automation is disabled for stability, so live UI interaction testing is not fully active.
- MongoDB persistence is planned or partially wired, but not fully dependable in the current runtime.
- The architecture is still relatively lightweight and would benefit from stronger service boundaries and background job orchestration.

8. Recommended rebuild direction
- Keep React and FastAPI as the foundation
- Move scanning, AI analysis, and reporting into separate services
- Implement a real background worker for long-running scans
- Add robust authentication, authorization, and RBAC
- Add observability, logs, metrics, and tracing
- Introduce a dedicated browser automation service for UI testing
- Standardize deployment, environment management, and data persistence

9. Summary
TestOps Platform is a promising AI-powered security testing platform with a modern frontend, a Python FastAPI backend, and a real-time dashboard. It is already a solid foundation for a full rebuild and can be evolved into a more scalable, production-grade platform.
"""

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='CustomTitle', fontName='Helvetica-Bold', fontSize=20, leading=24, spaceAfter=16))
styles.add(ParagraphStyle(name='CustomHeading', fontName='Helvetica-Bold', fontSize=14, leading=18, spaceAfter=10, spaceBefore=16))
styles.add(ParagraphStyle(name='CustomBody', fontName='Helvetica', fontSize=11, leading=15, spaceAfter=8))
styles.add(ParagraphStyle(name='CustomBullet', fontName='Helvetica', fontSize=11, leading=15, leftIndent=20, bulletIndent=8, spaceAfter=4))

story = []
for line in text.splitlines():
    if not line.strip():
        story.append(Spacer(1, 6))
        continue
    if line.startswith("1. ") or line.startswith("2. ") or line.startswith("3. ") or line.startswith("4. ") or line.startswith("5. ") or line.startswith("6. ") or line.startswith("7. ") or line.startswith("8. ") or line.startswith("9. "):
        story.append(Paragraph(line, styles['CustomHeading']))
    elif line.startswith("TestOps Platform Overview"):
        story.append(Paragraph(line, styles['CustomTitle']))
    else:
        story.append(Paragraph(line, styles['CustomBody']))

# Add simple bullet-like formatting for the list entries in the source text.
# The content is already formatted as paragraphs, so this keeps the PDF readable.

doc = SimpleDocTemplate(str(output_path), pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
doc.build(story)
print(str(output_path))
