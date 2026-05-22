"""
TestOps Platform — Backend
FastAPI + Groq (llama-3.1-8b-instant)
API key is loaded from .env — users never need to enter one.
"""

import asyncio, uuid, os, zipfile, tempfile, shutil, json, re, ssl, time
from collections import defaultdict, deque
from datetime import datetime, timezone
from ipaddress import ip_address
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, BackgroundTasks, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator
import httpx


from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from groq import Groq
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

# ── MongoDB (Atlas) persistence ─────────────────────────────────────────
MONGODB_URI  = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
_mongo       = AsyncIOMotorClient(MONGODB_URI)
_db          = _mongo["testops"]
audits_col   = _db["audits"]

async def save_audit(
    test_id: str,
    input_type: str,
    selected_tests: list,
    target: str,
    result: "TestResult",
    status: str = "completed"
) -> None:
    """Upsert a completed audit into MongoDB."""
    try:
        doc = {
            "_id":           test_id,
            "createdAt":     datetime.now(timezone.utc).isoformat(),
            "inputType":     input_type,
            "selectedTests": selected_tests,
            "target":        target,
            "grade":         result.grade,
            "securityScore": result.securityScore,
            "bugsFound":     result.bugsFound,
            "results":       result.model_dump(),
            "status":        status,
        }
        await audits_col.replace_one({"_id": test_id}, doc, upsert=True)
    except Exception as exc:
        print(f"[MongoDB] Failed to save audit {test_id}: {exc}")


# ── Email utility function ──────────────────────────────────────────────
async def send_invitation_email(recipient_email: str, inviter_name: str, workspace_name: str):
    """Send team invitation email to invited member"""
    if not SEND_EMAILS:
        print(f"[Email] Email not configured. Skipping invitation to {recipient_email}")
        return
    
    try:
        subject = f"You've been invited to join {workspace_name or 'TestOps'} workspace"
        
        body_html = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
        .card {{ background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        .header {{ color: #1a1a2e; margin-bottom: 20px; }}
        .content {{ color: #555; line-height: 1.6; margin-bottom: 30px; }}
        .cta-button {{ display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 20px 0; }}
        .footer {{ color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1 class="header">🔐 You're invited to join TestOps!</h1>
            <div class="content">
                <p>Hi there,</p>
                <p><strong>{inviter_name or 'A team member'}</strong> has invited you to join their workspace on <strong>TestOps</strong> — a security audit and testing platform.</p>
                <p>You can now:</p>
                <ul>
                    <li>View shared security reports and audit findings</li>
                    <li>Collaborate on scan results with team members</li>
                    <li>Track security issues and remediation progress</li>
                </ul>
                <p>Click the button below to accept the invitation and join the workspace:</p>
                <a href="{APP_URL}" class="cta-button">Join Workspace</a>
                <p>If the button doesn't work, copy and paste this link into your browser:</p>
                <p><code>{APP_URL}</code></p>
            </div>
            <div class="footer">
                <p>This is an automated message from TestOps. Please don't reply to this email.</p>
            </div>
        </div>
    </div>
</body>
</html>"""
        
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = EMAIL_SENDER
        message["To"] = recipient_email
        
        part = MIMEText(body_html, "html")
        message.attach(part)
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(EMAIL_SENDER, recipient_email, message.as_string())
        
        print(f"[Email] Invitation sent to {recipient_email}")
        
        # Log to database
        await invites_col.insert_one({
            "_id": str(uuid.uuid4()),
            "recipientEmail": recipient_email,
            "inviterName": inviter_name,
            "workspaceName": workspace_name,
            "sentAt": datetime.now(timezone.utc),
            "status": "sent",
        })
    except Exception as e:
        print(f"[Email] Failed to send invitation to {recipient_email}: {e}")


API_DOCS_ENABLED = os.environ.get("ENABLE_API_DOCS", "false").strip().lower() in {"1", "true", "yes", "on"}

app = FastAPI(
    title="TestOps Platform",
    version="2.0",
    docs_url="/docs" if API_DOCS_ENABLED else None,
    redoc_url="/redoc" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
)

DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
HSTS_HEADER = "max-age=31536000; includeSubDomains"
AUTH_RATE_LIMIT_PATHS = {"/login", "/api/login", "/api/auth/login", "/auth/login", "/signin"}
RATE_LIMIT_EXEMPT_PREFIXES = ("/api/test/progress",)
RATE_LIMIT_EXEMPT_PATHS = {"/health", "/api/health"}
_rate_limit_hits = defaultdict(deque)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def parse_allowed_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if raw == "*":
        return ["*"]
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def request_is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return forwarded_proto == "https" or request.url.scheme == "https"


def is_rate_limit_exempt(path: str) -> bool:
    return path in RATE_LIMIT_EXEMPT_PATHS or any(path.startswith(prefix) for prefix in RATE_LIMIT_EXEMPT_PREFIXES)


def rate_limit_for(request: Request) -> tuple[int, int]:
    path = request.url.path.rstrip("/") or "/"
    window = env_int("RATE_LIMIT_WINDOW_SECONDS", 60)
    if request.method.upper() == "POST" and path in AUTH_RATE_LIMIT_PATHS:
        return env_int("AUTH_RATE_LIMIT_MAX_REQUESTS", 5), window
    return env_int("RATE_LIMIT_MAX_REQUESTS", 240), window


def is_rate_limited(request: Request) -> tuple[bool, int]:
    path = request.url.path.rstrip("/") or "/"
    if request.method.upper() == "OPTIONS" or is_rate_limit_exempt(path):
        return False, 0

    max_requests, window = rate_limit_for(request)
    now = time.monotonic()
    key = f"{client_ip(request)}:{request.method.upper()}:{path}"
    hits = _rate_limit_hits[key]
    while hits and now - hits[0] > window:
        hits.popleft()
    if len(hits) >= max_requests:
        retry_after = max(1, int(window - (now - hits[0]))) if hits else window
        return True, retry_after
    hits.append(now)
    return False, 0


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    limited, retry_after = is_rate_limited(request)
    if limited:
        return JSONResponse(
            {"detail": "Too many requests. Please retry later."},
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )

    response = await call_next(request)
    docs_path = request.url.path.startswith(("/docs", "/redoc", "/openapi.json"))
    for header, value in SECURITY_HEADERS.items():
        if header == "Content-Security-Policy" and docs_path:
            continue
        response.headers.setdefault(header, value)
    if request_is_https(request):
        response.headers.setdefault("Strict-Transport-Security", HSTS_HEADER)
    for header in ("server", "x-powered-by"):
        if header in response.headers:
            del response.headers[header]
    return response


if env_bool("FORCE_HTTPS", False):
    app.add_middleware(HTTPSRedirectMiddleware)

@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "Backend is alive"}

allowed_origins = parse_allowed_origins()
allow_all_origins = allowed_origins == ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False if allow_all_origins else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BugReport(BaseModel):
    id: str
    severity: str
    title: str
    type: str
    reason: str
    reproduction: str
    recommendation: str

    @field_validator("reproduction", mode="before")
    @classmethod
    def join_list(cls, v):
        if isinstance(v, list):
            return "\n".join(str(i) for i in v)
        return v

class TestResult(BaseModel):
    grade: str
    securityScore: int
    bugsFound: int
    bugs: List[BugReport]

class AssistantChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str

    @field_validator("role", mode="before")
    @classmethod
    def normalise_role(cls, v):
        v = (v or "").strip().lower()
        if v in {"ai", "bot"}:
            return "assistant"
        return v

    @field_validator("content", mode="before")
    @classmethod
    def ensure_string_content(cls, v):
        return "" if v is None else str(v)

class AssistantChatRequest(BaseModel):
    messages: List[AssistantChatMessage]
    reportContext: Optional[dict] = None

class AssistantChatResponse(BaseModel):
    answer: str
    isUnrelated: bool = False

active_tests: dict = {}
test_results: dict = {}

CODE_UPLOAD_EXTENSIONS = (".zip", ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".php", ".rb")
CODE_INNER_EXTENSIONS = (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".php", ".rb")
SCHEMA_UPLOAD_EXTENSIONS = (".zip", ".sql", ".json", ".prisma")
SCHEMA_INNER_EXTENSIONS = (".sql", ".json", ".prisma")


def file_extension(filename: str = "") -> str:
    return os.path.splitext(filename or "")[1].lower()


def ensure_allowed_upload(upload: UploadFile, allowed: tuple[str, ...], label: str) -> str:
    ext = file_extension(upload.filename)
    if ext not in allowed:
        allowed_list = ", ".join(allowed)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {label} file type. Allowed extensions: {allowed_list}.",
        )
    return ext


def ensure_schema_payload(path: str, original_name: str) -> None:
    """Validate schema uploads enough to route them safely. Parsing happens later."""
    ext = file_extension(original_name)
    if ext != ".zip":
        return
    if not zipfile.is_zipfile(path):
        raise HTTPException(status_code=400, detail="Uploaded schema file has .zip extension but is not a valid ZIP archive.")
    try:
        with zipfile.ZipFile(path, "r") as zr:
            names = [info.filename for info in zr.infolist() if not info.is_dir()]
            supported = [name for name in names if name.lower().endswith(SCHEMA_INNER_EXTENSIONS)]
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded schema ZIP archive is corrupt or unreadable.")
    if not supported:
        allowed_list = ", ".join(SCHEMA_INNER_EXTENSIONS)
        raise HTTPException(
            status_code=400,
            detail=f"Schema ZIP must contain at least one supported file: {allowed_list}.",
        )


def score_to_grade(score: int) -> str:
    if score >= 90: return "A+"
    if score >= 80: return "A"
    if score >= 70: return "B"
    if score >= 60: return "C"
    if score >= 40: return "D"
    return "F"


def compute_score(bugs: list) -> int:
    """Calculate a score 0-100 purely from bug severity — never trusts the AI."""
    score = 100
    for bug in bugs:
        sev = bug.get("severity", "").upper()
        if sev == "HIGH":
            score -= 15
        elif sev == "MEDIUM":
            score -= 7
        elif sev == "LOW":
            score -= 3
    return max(0, min(100, score))

def extract_json_robust(text: str) -> dict:
    
    text = re.sub(r"```(?:json)?", "", text).strip()

  
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in AI response")
    depth, end = 0, -1
    for i, ch in enumerate(text[start:], start):
        if ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        raise ValueError("Incomplete JSON — response was truncated")
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        pass

    bug_matches = re.findall(r'\{[^{}]*"id"\s*:\s*"[^"]*"[^{}]*\}', text, re.DOTALL)
    bugs = []
    for bm in bug_matches:
        try:
            bugs.append(json.loads(bm))
        except Exception:
            pass
    score_m = re.search(r'"securityScore"\s*:\s*(\d+)', text)
    score = int(score_m.group(1)) if score_m else 30
    return {"grade": score_to_grade(score), "securityScore": score,
            "bugsFound": len(bugs), "bugs": bugs}

def extract_assistant_json_robust(text: str) -> dict:
    """
    Extracts a JSON object from an LLM response for the assistant chat endpoint.
    Expected shape:
      {"answer": "...", "isUnrelated": false}
    """
    text = (text or "").strip()
    text = re.sub(r"```(?:json)?", "", text).strip()

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    start = text.find("{")
    if start == -1:
        return {"answer": text, "isUnrelated": False}
    depth, end = 0, -1
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        return {"answer": text, "isUnrelated": False}

    try:
        obj = json.loads(text[start:end])
        if isinstance(obj, dict):
            return obj
    except Exception:
        return {"answer": text, "isUnrelated": False}

    return {"answer": text, "isUnrelated": False}

TEST_FOCUS = {
    "unit": (
        "Unit Testing: find functions with no input validation, bare except blocks that hide errors, "
        "missing return value checks, hardcoded values that break isolation, logic typos, "
        "and functions that depend on global state or side effects."
    ),
    "integration": (
        "Integration Testing: find tight coupling between layers (e.g. raw DB calls directly in route "
        "handlers), no transaction handling on bulk operations, missing connection cleanup (no finally), "
        "no abstraction interfaces between components, and missing dependency injection."
    ),
    "security": (
        "Security: find SQL injection via f-string or % formatting, hardcoded secrets or passwords, "
        "insecure hashing (MD5/SHA1 for passwords), missing authentication/authorization checks, "
        "CSRF vulnerabilities, debug=True exposed in production, and sensitive data in API responses."
    ),
    "schema": (
        "Schema Validation: find columns with wrong data types, missing NOT NULL constraints on required "
        "fields, missing DEFAULT values, absent audit trail columns (created_at/updated_at), "
        "and sensitive data stored in plain text (passwords, card numbers, tokens)."
    ),
    "query": (
        "Query Optimization: find missing indexes on foreign key columns and frequently filtered columns, "
        "columns with inefficient types (TEXT where VARCHAR suffices), tables with no primary key, "
        "and missing composite indexes for common query patterns."
    ),
    "integrity": (
        "Referential Integrity: find missing FOREIGN KEY constraints that allow orphan records, "
        "missing CHECK constraints allowing invalid data (negative prices, invalid ratings), "
        "missing UNIQUE constraints that allow duplicates, and missing ON DELETE cascade rules."
    ),
    "e2e": (
        "End-to-End: find places where code inserts/reads data the schema does not validate, "
        "column type mismatches between code and schema, and missing error handling for DB "
        "constraint violations in the application layer."
    ),
    "fullstack": (
        "Full Stack Integration: find compound vulnerabilities across layers (e.g. code hashes with MD5 "
        "AND schema has no hash enforcement), missing FK relationships the code assumes exist, and schema "
        "designs that force the application to do validation the DB should enforce."
    ),
    "dataflow": (
        "Data Flow Security: trace sensitive data (passwords, card numbers, tokens, PII) from HTTP "
        "request through business logic to DB write — find every point where data is logged, returned "
        "in responses, stored unencrypted, or passed to external services."
    ),
}


TYPE_FILTER_MAP: dict[str, list[str]] = {
    "unit":        ["Logic Error",  "Code Quality"],
    "integration": ["Integration",  "Code Quality"],
    "security":    ["Security"],
    "schema":      ["Database",     "Schema"],
    "query":       ["Performance",  "Database"],
    "integrity":   ["Database",     "Integrity"],
    "e2e":         ["Integration",  "Logic Error", "Database"],
    "fullstack":   ["Security",     "Integration", "Logic Error", "Database", "Code Quality", "Performance"],
    "dataflow":    ["Security",     "Data Flow"],
}

def allowed_types_for(selected_tests: list[str]) -> set[str]:
    """Return the set of bug type labels allowed for the given test suites."""
    result: set[str] = set()
    for t in selected_tests:
        result.update(TYPE_FILTER_MAP.get(t, []))
    return result or {"Code Quality", "Logic Error"}  

@app.post("/api/test/start")
async def start_test(
    background_tasks: BackgroundTasks,
    inputType:     str = Form(...),
    selectedTests: str = Form(...),
    file:          UploadFile = File(...),
    schemaFile:    Optional[UploadFile] = File(None),
):
    inputType = inputType.strip().lower()
    selected = [s.strip() for s in selectedTests.split(",") if s.strip()]
    if inputType not in {"codebase", "database", "both"}:
        raise HTTPException(status_code=400, detail="inputType must be one of: codebase, database, both.")
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one test suite.")

    primary_allowed = SCHEMA_UPLOAD_EXTENSIONS if inputType == "database" else CODE_UPLOAD_EXTENSIONS
    primary_ext = ensure_allowed_upload(file, primary_allowed, "primary upload")
    if inputType == "both" and not (schemaFile and schemaFile.filename):
        raise HTTPException(status_code=400, detail="Full stack scans require a database schema upload.")

    test_id  = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp()
    upload_path = os.path.join(temp_dir, f"upload{primary_ext}")
    schema_path = None

    try:
        with open(upload_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)
        if inputType == "database":
            ensure_schema_payload(upload_path, file.filename or "")

        if schemaFile and schemaFile.filename:
            schema_ext = ensure_allowed_upload(schemaFile, SCHEMA_UPLOAD_EXTENSIONS, "schema upload")
            schema_path = os.path.join(temp_dir, f"schema_upload{schema_ext}")
            with open(schema_path, "wb") as buf:
                shutil.copyfileobj(schemaFile.file, buf)
            ensure_schema_payload(schema_path, schemaFile.filename or "")
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Could not process upload: {exc}")

    active_tests[test_id] = {
        "status":   "running",
        "progress": 0,
        "logs":     [],
        "config":   {
            "inputType":     inputType,
            "selectedTests": selected,
            "target":        file.filename or "uploaded file",
        },
    }

    background_tasks.add_task(
        run_analysis, test_id, temp_dir, upload_path, schema_path
    )
    return {"testId": test_id}


async def run_analysis(test_id: str, temp_dir: str, zip_path: str, schema_path: Optional[str]):
    def log(msg: str, pct: int = None):
        active_tests[test_id]["logs"].append(msg)
        if pct is not None:
            active_tests[test_id]["progress"] = pct

    def is_cancelled() -> bool:
        return active_tests.get(test_id, {}).get("status") == "cancelled"

    def abort_if_cancelled() -> bool:
        if is_cancelled():
            if not active_tests[test_id]["logs"] or active_tests[test_id]["logs"][-1] != "Scan cancelled by user.":
                active_tests[test_id]["logs"].append("Scan cancelled by user.")
            active_tests[test_id]["status"] = "cancelled"
            return True
        return False

    try:
        input_type     = active_tests[test_id]["config"]["inputType"]
        selected_tests = active_tests[test_id]["config"]["selectedTests"]

        
        log("Inspecting uploaded archive...", 10)
        await asyncio.sleep(0.5)
        if abort_if_cancelled():
            return

        code_contents = []

        
        def read_files(path: str, extensions: tuple, tag: str):
            if zipfile.is_zipfile(path):
                with zipfile.ZipFile(path, "r") as zr:
                    for info in zr.infolist():
                        if info.is_dir() or not info.filename.lower().endswith(extensions):
                            continue
                        with zr.open(info, "r") as fh:
                            content = fh.read().decode("utf-8", errors="ignore")
                        code_contents.append(f"--- [{tag.upper()}] {info.filename} ---\n{content}\n")
            else:
                fname = os.path.basename(path)
                if fname.lower().endswith(extensions):
                    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                        code_contents.append(f"--- [{tag.upper()}] {fname} ---\n{fh.read()}\n")

        if input_type == "codebase":
            read_files(zip_path, CODE_INNER_EXTENSIONS, "code")
        elif input_type == "database":
            read_files(zip_path, SCHEMA_INNER_EXTENSIONS, "schema")
        else:  # both
            read_files(zip_path, CODE_INNER_EXTENSIONS, "code")
            if schema_path:
                read_files(schema_path, SCHEMA_INNER_EXTENSIONS, "schema")

        if not code_contents:
            raise Exception("No analysable files found in the uploaded archive.")

        log(f"Found {len(code_contents)} file(s). Building analysis context...", 30)
        await asyncio.sleep(0.4)
        if abort_if_cancelled():
            return

        all_code      = "\n".join(code_contents)[:20000]   # ~5k tokens — ample for 70B model
        active_suites = [TEST_FOCUS[t] for t in selected_tests if t in TEST_FOCUS]
        if not active_suites:
            active_suites = list(TEST_FOCUS.values())[:3]

        combined_focus = "\n".join(f"- {p}" for p in active_suites)

        suite_prompts = {
            "unit": (
                "UNIT TESTING FOCUS: Look for functions with missing input validation, "
                "bare except blocks that hide errors, missing return-value checks, "
                "logic typos (wrong operator, off-by-one), hardcoded test values, "
                "and functions that rely on global mutable state."
            ),
            "integration": (
                "INTEGRATION TESTING FOCUS: Look for raw DB queries directly in route handlers "
                "(no service layer), missing transaction handling on multi-step operations, "
                "missing connection/resource cleanup (no finally/context manager), "
                "and tight coupling between components with no interface abstraction."
            ),
            "security": (
                "SECURITY FOCUS: Look for SQL injection via f-string/% formatting, "
                "hardcoded passwords or API keys, insecure password hashing (MD5/SHA1), "
                "missing authentication checks, CSRF gaps, debug mode enabled in production, "
                "and sensitive data exposed in API responses."
            ),
            "schema": (
                "SCHEMA VALIDATION FOCUS: Look for columns with wrong data types, "
                "missing NOT NULL on required fields, missing DEFAULT values, "
                "absent created_at/updated_at audit columns, and plain-text sensitive data storage."
            ),
            "query": (
                "QUERY OPTIMIZATION FOCUS: Look for missing indexes on FK and filter columns, "
                "TEXT columns where VARCHAR suffices, tables without a primary key, "
                "and missing composite indexes for common query patterns."
            ),
            "integrity": (
                "REFERENTIAL INTEGRITY FOCUS: Look for missing FOREIGN KEY constraints "
                "that allow orphan records, missing CHECK constraints on numeric ranges, "
                "missing UNIQUE constraints, and missing ON DELETE/UPDATE cascade rules."
            ),
            "e2e": (
                "END-TO-END FOCUS: Look for mismatches between what the code writes to the DB "
                "and what the schema actually validates, column type mismatches between ORM "
                "models and DDL, and missing error handling for DB constraint violations."
            ),
            "fullstack": (
                "FULL STACK FOCUS: Look for compound issues spanning both layers — "
                "code uses MD5 AND schema has no hash enforcement, missing FKs the code assumes exist, "
                "schema designs that force app-level validation that the DB should enforce."
            ),
            "dataflow": (
                "DATA FLOW SECURITY FOCUS: Trace sensitive data (passwords, tokens, PII) from "
                "HTTP input through business logic to DB write. Find every point where data is "
                "logged, returned in responses, stored unencrypted, or sent to external services."
            ),
        }

        active_instructions = "\n\n".join(
            f"[{i+1}] {suite_prompts[t]}"
            for i, t in enumerate(selected_tests)
            if t in suite_prompts
        )
        if not active_instructions:
            active_instructions = suite_prompts.get("unit", "")

        
        allowed = allowed_types_for(selected_tests)
        allowed_str = "|".join(sorted(allowed))

        if input_type == "database":
            subject = "database schema (SQL DDL)"
        elif input_type == "both":
            subject = "full-stack application (source code + database schema)"
        else:
            subject = "codebase (may include Python, JavaScript, TypeScript, Java, Go, PHP or Ruby)"

        log(f"Running {len(active_suites)} test suite(s): {', '.join(selected_tests)}", 50)
        await asyncio.sleep(0.4)
        if abort_if_cancelled():
            return
        prompt = f"""You are an expert software quality engineer performing a targeted audit.

Your audit scope for this run is strictly limited to the following test categories:
{active_instructions}

For each issue you find, classify it with the correct type from this list: {allowed_str}

Report ONLY bugs that genuinely exist in the code — do not invent issues to fill a quota.
If you find fewer real issues, report only those. Do not pad the list.

For each bug, assign severity using this rubric:
- HIGH: Can directly cause data loss, unauthorised access, system crash, or financial loss. E.g. SQL injection, missing auth check, data corruption.
- MEDIUM: Degrades reliability, maintainability, or partially exposes risk. E.g. missing error handling, tight coupling that causes failures, logic error with limited impact.
- LOW: Minor code quality issue, small inefficiency, or best-practice violation with no immediate risk. E.g. unused variable, non-optimal query, missing index on low-traffic table.

After finding all bugs, compute securityScore (0-100) using this formula:
- Start at 100
- Subtract 15 for each HIGH bug
- Subtract 7 for each MEDIUM bug
- Subtract 3 for each LOW bug
- Minimum score is 0
Respond with ONLY a raw JSON object. No markdown, no code fences, no extra text.

{{
  "grade": "A/B/C/D/F with optional +/-",
  "securityScore": <integer 0-100>,
  "bugsFound": <length of bugs array>,
  "bugs": [
    {{
      "id": "bug-1",
      "severity": "HIGH|MEDIUM|LOW",
      "title": "<short descriptive title>",
      "type": "{allowed_str}",
      "reason": "<1-2 sentences with specific variable/function/column name>",
      "reproduction": "<numbered steps with actual file/endpoint/table names>",
      "recommendation": "<specific fix with corrected code or SQL>"
    }}
  ]
}}

Rules:
- Only report bugs relevant to your assigned audit categories above.
- "type" MUST be one of: {allowed_str}
- "bugsFound" MUST equal the exact length of the bugs array.
- Raw JSON only. No markdown.

{subject} to audit:
{all_code}"""

       
        log("Sending to Groq AI (llama-3.3-70b-versatile)...", 65)
        await asyncio.sleep(0.3)
        if abort_if_cancelled():
            return

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key or groq_key == "your_groq_api_key_here":
            raise Exception(
                "GROQ_API_KEY not configured. "
                "Edit backend/.env and set your Groq key from https://console.groq.com/keys, "
                "then restart the server."
            )

        client = Groq(api_key=groq_key)
        
        models_to_try = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]
        response = None
        for i, model_name in enumerate(models_to_try):
            try:
                if i > 0:
                    log(f"Sending to Groq AI ({model_name})...", 65)
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a strict technical auditor. "
                                "You ONLY report issues matching the requested test categories. "
                                "Output ONLY raw valid JSON. No markdown, no extra text."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0,
                    max_tokens=3500,
                )
                break
            except Exception as e:
                err_str = str(e).lower()
                if ("rate_limit" in err_str or "429" in err_str or "too many requests" in err_str) and i < len(models_to_try) - 1:
                    log(f"Rate limit hit for {model_name}. Falling back...", 65)
                    continue
                raise e

        raw = response.choices[0].message.content or ""
        log("Parsing AI response...", 85)
        await asyncio.sleep(0.3)
        if abort_if_cancelled():
            return

        result_dict = extract_json_robust(raw)

    
        for bug in result_dict.get("bugs", []):
            if isinstance(bug.get("reproduction"), list):
                bug["reproduction"] = "\n".join(str(s) for s in bug["reproduction"])

       
        allowed_set = allowed_types_for(selected_tests)
        
        def normalise_type(t: str) -> str:
            return t.strip().title() if t else ""

        original_bugs = result_dict.get("bugs", [])
        filtered_bugs = [
            b for b in original_bugs
            if normalise_type(b.get("type", "")) in {t.title() for t in allowed_set}
            or b.get("type", "") in allowed_set
        ]
        removed = len(original_bugs) - len(filtered_bugs)
        if removed > 0:
            log(f"Filtered out {removed} bug(s) outside selected test scope.", 90)

        result_dict["bugs"] = filtered_bugs

        # Score comes from the AI's own severity assignments via the rubric in the prompt.
        # Python only overrides the grade letter (deterministic mapping).
        raw_score = result_dict.get("securityScore", 50)
        try:
            score = max(0, min(100, int(raw_score)))
        except (TypeError, ValueError):
            score = compute_score(filtered_bugs)  # fallback if AI fails to produce a number
        result_dict["securityScore"] = score
        result_dict["grade"]         = score_to_grade(score)
        result_dict["bugsFound"]     = len(filtered_bugs)

        result_obj = TestResult(**result_dict)
        test_results[test_id] = result_obj

        # Persist to MongoDB
        target_label = active_tests[test_id]["config"].get("target", "uploaded file")
        await save_audit(test_id, input_type, selected_tests, target_label, result_obj)

        for bug in filtered_bugs:
            log(f"[{bug.get('severity', 'LOW').upper()}] {bug.get('title', 'Issue found')}", 95)

        log(f"Report ready: {len(filtered_bugs)} issue(s) found.", 100)
        active_tests[test_id]["status"] = "completed"

    except Exception as exc:
        if active_tests.get(test_id, {}).get("status") == "cancelled":
            return
        log(f"ERROR: {exc}", 100)
        active_tests[test_id]["status"] = "completed"
        test_results[test_id] = TestResult(
            grade="F",
            securityScore=0,
            bugsFound=1,
            bugs=[BugReport(
                id="error-1",
                severity="HIGH",
                title="Analysis Failure",
                type="Code Quality",
                reason=str(exc),
                reproduction="N/A",
                recommendation="Check backend/.env has a valid GROQ_API_KEY and restart the server.",
            )],
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/api/test/progress/{test_id}")
async def get_progress(test_id: str):
    async def stream():
        while True:
            if test_id not in active_tests:
                yield 'data: {"error": "test not found"}\n\n'
                break
            t = active_tests[test_id]
            payload = json.dumps({
                "progress":   t["progress"],
                "status":     t["status"],
                "latest_log": t["logs"][-1] if t["logs"] else "",
            })
            yield f"data: {payload}\n\n"
            if t["status"] in {"completed", "cancelled"}:
                break
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream")

@app.post("/cancel-scan/{scan_id}")
async def cancel_test(scan_id: str):
    test_id = scan_id
    if test_id not in active_tests:
        raise HTTPException(status_code=404, detail="Test not found")
    if active_tests[test_id]["status"] == "completed":
        return {"status": "completed"}
    active_tests[test_id]["status"] = "cancelled"
    if not active_tests[test_id]["logs"] or active_tests[test_id]["logs"][-1] != "Scan cancelled by user.":
        active_tests[test_id]["logs"].append("Scan cancelled by user.")
    
    t = active_tests[test_id]
    target_label = t.get("config", {}).get("target", "uploaded file")
    input_type = t.get("config", {}).get("inputType", "unknown")
    selected_tests = t.get("config", {}).get("selectedTests", [])
    
    empty_result = TestResult(
        grade="Cancelled",
        securityScore=0,
        bugsFound=0,
        bugs=[]
    )
    await save_audit(test_id, input_type, selected_tests, target_label, empty_result, status="cancelled")
    
    return {"status": "cancelled"}


# ══ Team Workspace Endpoints ═════════════════════════════════════════════
@app.post("/api/team/invite")
async def invite_team_member(
    background_tasks: BackgroundTasks,
    email: str = Form(...),
    inviterName: str = Form(...),
    workspaceName: str = Form(...),
):
    """Send invitation email to team member"""
    if not email or not email.strip():
        raise HTTPException(status_code=400, detail="Email is required")
    
    email = email.strip().lower()
    
    # Validate email format
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    
    # Send email in background
    background_tasks.add_task(
        send_invitation_email,
        email,
        inviterName or "A team member",
        workspaceName or "TestOps"
    )
    
    return {
        "success": True,
        "message": f"Invitation sent to {email}",
        "email": email,
    }


@app.get("/api/test/results/{test_id}", response_model=TestResult)
async def get_results(test_id: str):
    # Try in-memory first (hot path — avoids DB round-trip)
    if test_id in test_results:
        return test_results[test_id]
    # Fall back to MongoDB (survives server restarts)
    doc = await audits_col.find_one({"_id": test_id})
    if doc:
        return TestResult(**doc["results"])
    raise HTTPException(status_code=404, detail="Report not found")


# ── Audit History endpoints ───────────────────────────────────────────────
@app.get("/api/history")
async def get_history():
    cursor = audits_col.find(
        {},
        {"results": 0},          # exclude full results blob for speed
    ).sort("createdAt", -1).limit(50)
    history = []
    async for doc in cursor:
        history.append({
            "id":            doc["_id"],
            "createdAt":     doc.get("createdAt"),
            "inputType":     doc.get("inputType"),
            "selectedTests": doc.get("selectedTests", []),
            "target":        doc.get("target"),
            "grade":         doc.get("grade"),
            "securityScore": doc.get("securityScore"),
            "bugsFound":     doc.get("bugsFound"),
            "status":        doc.get("status", "completed"),
        })
    return history


@app.delete("/api/history")
async def clear_history():
    await audits_col.delete_many({})
    return {"cleared": True}


@app.get("/api/history/{test_id}", response_model=TestResult)
async def get_history_result(test_id: str):
    if test_id in test_results:
        return test_results[test_id]
    doc = await audits_col.find_one({"_id": test_id})
    if doc:
        return TestResult(**doc["results"])
    raise HTTPException(status_code=404, detail="Report not found")


@app.delete("/api/history/{test_id}")
async def delete_history_result(test_id: str):
    if test_id in test_results:
        del test_results[test_id]
    if test_id in active_tests:
        del active_tests[test_id]
        
    result = await audits_col.delete_one({"_id": test_id})
    if result.deleted_count == 0 and test_id not in test_results:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"deleted": True}


# ══ URL Scan ═════════════════════════════════════════════════════
# URL-specific test suite IDs and what they probe
URL_SUITE_FOCUS = {
    "headers":     "Security Headers: CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy",
    "ssl":         "SSL/TLS: certificate validity, expiry, TLS version, HTTPS enforcement, HTTP redirect chain",
    "auth":        "Authentication & Access Control: unprotected admin/api/dashboard paths, missing 401/403 enforcement",
    "cookies":     "Cookie Security: HttpOnly, Secure, SameSite flags on all Set-Cookie headers",
    "cors":        "CORS Configuration: wildcard origins, credentials with wildcard, overly permissive allow-headers",
    "disclosure":  "Information Disclosure: exposed .env/.git/swagger/api-docs, server/framework version in headers, verbose error pages",
    "ratelimit":   "Rate Limiting: repeated rapid requests to login/api endpoints to detect missing throttling",
}

URL_TYPE_FILTER = {
    "headers":    ["Security", "Configuration"],
    "ssl":        ["Security", "Configuration"],
    "auth":       ["Security", "Access Control"],
    "cookies":    ["Security", "Configuration"],
    "cors":       ["Security", "Configuration"],
    "disclosure": ["Security", "Information Disclosure"],
    "ratelimit":  ["Security", "Configuration"],
}


def is_loopback_target(hostname: str | None) -> bool:
    host = (hostname or "").strip("[]").lower()
    if host in {"localhost", "0.0.0.0", "host.docker.internal"}:
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


API_DOC_PATHS = {"/swagger", "/api/docs", "/api/swagger.json", "/openapi.json"}
ADMIN_PATHS = {"/admin", "/dashboard"}


def compact_body_fingerprint(text: str = "") -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:1200]


def filter_url_false_positives(result_dict: dict, findings: dict) -> dict:
    target_context = findings.get("target_context", {})
    cookies = findings.get("cookies", {})
    rate_limiting = findings.get("rate_limiting", {})
    cors = findings.get("cors", {})
    sensitive_paths = findings.get("sensitive_paths", {})
    exposed_paths = set(sensitive_paths.get("exposed_paths", []))

    filtered = []
    for bug in result_dict.get("bugs", []):
        text = " ".join(str(bug.get(k, "")) for k in ("title", "reason", "recommendation")).lower()

        if target_context.get("local_development_target") and any(
            token in text for token in ("https", "ssl", "tls", "certificate", "hsts", "strict-transport-security")
        ):
            continue

        if target_context.get("local_development_target") and any(
            token in text for token in ("content security policy", "csp", "unsafe-inline", "unsafe-eval")
        ):
            continue

        if not cookies.get("flags_applicable", False) and "cookie" in text:
            continue

        if not rate_limiting.get("tested_existing_endpoint", False) and any(
            token in text for token in ("rate limit", "rate-limit", "brute force", "brute-force")
        ):
            continue

        if not cors.get("permissive", False) and "cors" in text:
            continue

        if ("server header" in text and any(token in text for token in ("missing", "absent", "not present"))) or (
            "x-powered-by" in text and any(token in text for token in ("missing", "absent", "not present"))
        ):
            continue

        if not exposed_paths and any(token in text for token in ("exposed sensitive", "sensitive path", "sensitive paths")):
            continue

        if not exposed_paths.intersection(API_DOC_PATHS) and any(
            token in text for token in ("api documentation", "openapi", "swagger")
        ):
            continue

        if not exposed_paths.intersection(ADMIN_PATHS) and any(
            token in text for token in ("admin", "dashboard", "access control")
        ):
            continue

        filtered.append(bug)

    result_dict["bugs"] = filtered
    return result_dict


@app.post("/api/test/url-start")
async def start_url_test(
    background_tasks: BackgroundTasks,
    targetUrl:     str = Form(...),
    selectedTests: str = Form(...),
):
    test_id = str(uuid.uuid4())
    selected = [s.strip() for s in selectedTests.split(",") if s.strip()]

    active_tests[test_id] = {
        "status":   "running",
        "progress": 0,
        "logs":     [],
        "config":   {"inputType": "url", "selectedTests": selected, "target": targetUrl},
    }

    background_tasks.add_task(run_url_analysis, test_id, targetUrl, selected)
    return {"testId": test_id}


async def run_url_analysis(test_id: str, target_url: str, selected_tests: list):
    def log(msg: str, pct: int = None):
        active_tests[test_id]["logs"].append(msg)
        if pct is not None:
            active_tests[test_id]["progress"] = pct

    def is_cancelled() -> bool:
        return active_tests.get(test_id, {}).get("status") == "cancelled"

    def abort_if_cancelled() -> bool:
        if is_cancelled():
            if not active_tests[test_id]["logs"] or active_tests[test_id]["logs"][-1] != "Scan cancelled by user.":
                active_tests[test_id]["logs"].append("Scan cancelled by user.")
            active_tests[test_id]["status"] = "cancelled"
            return True
        return False

    # Ensure URL has scheme
    target_url = target_url.strip()
    if not target_url.lower().startswith(("http://", "https://")):
        target_url = "https://" + target_url

    findings = {}   # will hold all raw probe data
    parsed_target = urlparse(target_url)
    target_is_local = is_loopback_target(parsed_target.hostname)
    findings["target_context"] = {
        "hostname": parsed_target.hostname,
        "scheme": parsed_target.scheme,
        "local_development_target": target_is_local,
        "tls_checks_applicable": not target_is_local,
        "note": "Localhost/loopback targets are development endpoints; public HTTPS certificate enforcement is not applicable."
                if target_is_local else "Public or non-loopback target.",
    }

    try:
        log(f"Connecting to {target_url}...", 10)
        if abort_if_cancelled():
            return

        headers_to_send = {
            "User-Agent": "TestOps-SecurityAudit/2.0 (automated scan)",
            "Accept": "text/html,application/json,*/*",
        }

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15.0,
            verify=False,          # we check SSL separately
        ) as client:

            # ── Base request ──────────────────────────────────────────
            log("Fetching main page and response headers...", 18)
            if abort_if_cancelled():
                return
            resp = await client.get(target_url, headers=headers_to_send)
            resp_headers = dict(resp.headers)
            status_code  = resp.status_code

            # Redirect chain
            redirect_chain = [str(r.url) for r in resp.history] + [str(resp.url)]
            http_to_https  = any(str(r.url).startswith("http://") for r in resp.history)

            findings["status_code"]    = status_code
            findings["redirect_chain"] = redirect_chain
            findings["http_to_https"]  = http_to_https
            findings["response_headers"] = resp_headers

            # ── Security headers ──────────────────────────────────────
            log("Auditing security headers...", 28)
            if abort_if_cancelled():
                return
            security_headers_check = {
                "Content-Security-Policy":   resp_headers.get("content-security-policy"),
                "X-Frame-Options":           resp_headers.get("x-frame-options"),
                "Strict-Transport-Security": resp_headers.get("strict-transport-security"),
                "X-Content-Type-Options":    resp_headers.get("x-content-type-options"),
                "Referrer-Policy":           resp_headers.get("referrer-policy"),
                "Permissions-Policy":        resp_headers.get("permissions-policy"),
                "Server":                    resp_headers.get("server"),
                "X-Powered-By":              resp_headers.get("x-powered-by"),
                "HSTS-Applicable":           not target_is_local and str(resp.url).startswith("https://"),
            }
            findings["security_headers"] = security_headers_check

            # ── Cookie security ────────────────────────────────────────
            log("Inspecting cookies...", 36)
            if abort_if_cancelled():
                return
            cookies_found = []
            for k, v in resp.cookies.items():
                cookies_found.append({"name": k, "value_preview": v[:12] + "..." if len(v) > 12 else v})
            set_cookie_raw = resp_headers.get("set-cookie", "")
            missing_cookie_flags = []
            if set_cookie_raw:
                raw_cookie_lower = set_cookie_raw.lower()
                if "httponly" not in raw_cookie_lower:
                    missing_cookie_flags.append("HttpOnly")
                if "secure" not in raw_cookie_lower:
                    missing_cookie_flags.append("Secure")
                if "samesite" not in raw_cookie_lower:
                    missing_cookie_flags.append("SameSite")
            findings["cookies"] = {
                "count":         len(cookies_found),
                "names":         [c["name"] for c in cookies_found],
                "set_cookie_raw": set_cookie_raw,
                "has_httponly":  "httponly" in set_cookie_raw.lower(),
                "has_secure":    "secure" in set_cookie_raw.lower(),
                "has_samesite":  "samesite" in set_cookie_raw.lower(),
                "flags_applicable": bool(set_cookie_raw),
                "missing_flags": missing_cookie_flags,
                "note": "No Set-Cookie header observed; cookie flag checks are not applicable."
                        if not set_cookie_raw else "Set-Cookie header observed.",
            }

            # ── CORS ─────────────────────────────────────────────────
            log("Checking CORS configuration...", 44)
            if abort_if_cancelled():
                return
            cors_resp = await client.options(
                target_url,
                headers={**headers_to_send, "Origin": "https://evil-attacker.com",
                         "Access-Control-Request-Method": "GET"},
            )
            allow_origin = cors_resp.headers.get("access-control-allow-origin", "not set")
            allow_credentials = cors_resp.headers.get("access-control-allow-credentials", "not set")
            cors_permissive = allow_origin == "*" or allow_origin == "https://evil-attacker.com"
            findings["cors"] = {
                "allow_origin":      allow_origin,
                "allow_credentials": allow_credentials,
                "allow_methods":     cors_resp.headers.get("access-control-allow-methods", "not set"),
                "allow_headers":     cors_resp.headers.get("access-control-allow-headers", "not set"),
                "permissive":        cors_permissive,
                "credentials_with_permissive_origin": cors_permissive and allow_credentials.lower() == "true",
            }

            # ── Exposed sensitive paths ────────────────────────────────
            log("Probing sensitive paths...", 54)
            if abort_if_cancelled():
                return
            resolved_url = urlparse(str(resp.url))
            base = f"{resolved_url.scheme}://{resolved_url.netloc}"
            sensitive_paths = [
                "/.env", "/.git/config", "/robots.txt", "/swagger",
                "/api/docs", "/api/v1/users", "/admin", "/dashboard",
                "/config.json", "/phpinfo.php", "/.well-known/security.txt",
                "/api/swagger.json", "/openapi.json",
            ]
            path_results = {}
            root_is_html = "text/html" in resp_headers.get("content-type", "").lower()
            root_fingerprint = compact_body_fingerprint(resp.text) if root_is_html else ""
            for path in sensitive_paths:
                try:
                    pr = await client.get(base + path, headers=headers_to_send)
                    content_type = pr.headers.get("content-type", "")
                    is_html = "text/html" in content_type.lower()
                    same_spa_shell = (
                        pr.status_code == 200
                        and root_fingerprint
                        and is_html
                        and compact_body_fingerprint(pr.text) == root_fingerprint
                    )
                    public_metadata = path in {"/robots.txt", "/.well-known/security.txt"}
                    exposed = pr.status_code == 200 and not same_spa_shell and not public_metadata
                    path_results[path] = {
                        "status": pr.status_code,
                        "content_type": content_type or "not set",
                        "spa_fallback": same_spa_shell,
                        "public_metadata": public_metadata,
                        "exposed": exposed,
                    }
                except Exception:
                    path_results[path] = {"status": "error", "exposed": False, "spa_fallback": False}
            exposed_paths = [path for path, details in path_results.items() if details.get("exposed")]
            findings["sensitive_paths"] = {
                "paths": path_results,
                "exposed_paths": exposed_paths,
                "api_documentation_exposed": any(path in API_DOC_PATHS for path in exposed_paths),
                "admin_or_dashboard_exposed": any(path in ADMIN_PATHS for path in exposed_paths),
                "note": "HTML responses identical to the root document are treated as SPA fallback, not exposed resources.",
            }

            # ── Rate limiting ─────────────────────────────────────────
            log("Testing rate limiting...", 64)
            if abort_if_cancelled():
                return
            login_paths = ["/login", "/api/login", "/api/auth/login", "/auth/login", "/signin"]
            rate_path_results = {}
            for lp in login_paths:
                try:
                    statuses = []
                    for _ in range(6):
                        r = await client.post(base + lp, headers=headers_to_send,
                                              json={"username": "test", "password": "test"},
                                              timeout=4.0)
                        statuses.append(r.status_code)
                    endpoint_exists = any(s not in [404, 405] for s in statuses)
                    rate_path_results[lp] = {
                        "status_codes": statuses,
                        "endpoint_exists": endpoint_exists,
                        "rate_limited": any(s in [429, 503] for s in statuses),
                    }
                except Exception:
                    pass   # path doesn't exist, skip
            tested_existing_endpoint = any(r["endpoint_exists"] for r in rate_path_results.values())
            findings["rate_limiting"] = {
                "paths": rate_path_results,
                "tested_existing_endpoint": tested_existing_endpoint,
                "protected": any(r["rate_limited"] for r in rate_path_results.values() if r["endpoint_exists"]),
                "applicable": tested_existing_endpoint,
                "note": "No login/auth endpoint responded as present; rate-limit finding is not applicable."
                        if not tested_existing_endpoint else "At least one login/auth candidate responded as present.",
            }

        # ── SSL check (sync, separate context) ──────────────────────
        log("Checking SSL/TLS certificate...", 72)
        if abort_if_cancelled():
            return
        import socket
        ssl_info = {}
        parsed = urlparse(target_url)
        if target_is_local:
            ssl_info = {
                "applicable": False,
                "valid": None,
                "note": "Skipped for localhost/loopback development target.",
            }
        elif parsed.scheme != "https":
            ssl_info = {
                "applicable": True,
                "valid": False,
                "error": "Target URL uses HTTP; no TLS certificate was presented.",
            }
        else:
            try:
                host    = parsed.hostname
                port    = parsed.port or 443
                ctx     = ssl.create_default_context()
                conn    = ctx.wrap_socket(socket.socket(), server_hostname=host)
                conn.settimeout(8)
                conn.connect((host, port))
                cert        = conn.getpeercert()
                tls_version = conn.version() if hasattr(conn, "version") else "unknown"
                conn.close()
                import datetime
                expiry  = datetime.datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
                days_left = (expiry - datetime.datetime.utcnow()).days
                ssl_info = {
                    "applicable":       True,
                    "valid":            True,
                    "subject":          dict(x[0] for x in cert.get("subject", [])),
                    "issuer":           dict(x[0] for x in cert.get("issuer", [])),
                    "expires":          cert["notAfter"],
                    "days_until_expiry": days_left,
                    "tls_version":      tls_version,
                }
            except ssl.SSLCertVerificationError as e:
                ssl_info = {"applicable": True, "valid": False, "error": str(e)}
            except Exception as e:
                ssl_info = {"applicable": True, "valid": None, "error": str(e), "note": "Could not inspect certificate"}
        findings["ssl"] = ssl_info

        # ── Build AI prompt ──────────────────────────────────────────
        log("Sending findings to AI for analysis...", 80)
        if abort_if_cancelled():
            return

        scope_focus = "\n".join(
            f"- {URL_SUITE_FOCUS[t]}" for t in selected_tests if t in URL_SUITE_FOCUS
        ) or "\n".join(f"- {v}" for v in URL_SUITE_FOCUS.values())

        allowed_url_types = set()
        for t in selected_tests:
            allowed_url_types.update(URL_TYPE_FILTER.get(t, ["Security"]))
        allowed_url_str = "|".join(sorted(allowed_url_types)) or "Security"

        prompt = f"""You are a web security expert performing a black-box security audit of: {target_url}

Your audit scope:
{scope_focus}

For each bug, assign severity:
- HIGH: Directly exploitable — exposes data, allows unauthorised access, enables attacks
- MEDIUM: Degrades security posture, increases risk if combined with other issues
- LOW: Security best-practice violation, low immediate risk

After finding all bugs, compute securityScore (0-100):
- Start at 100, subtract 15 per HIGH, 7 per MEDIUM, 3 per LOW

RAW PROBE DATA COLLECTED (analyse this and report real findings only):
{json.dumps(findings, indent=2, default=str)[:8000]}

Respond with ONLY a raw JSON object:
{{
  "grade": "A/B/C/D/F with optional +/-",
  "securityScore": <integer 0-100>,
  "bugsFound": <length of bugs array>,
  "bugs": [
    {{
      "id": "bug-1",
      "severity": "HIGH|MEDIUM|LOW",
      "title": "<concise title>",
      "type": "{allowed_url_str}",
      "reason": "<what the probe found and why it matters>",
      "reproduction": "<exact HTTP request or browser steps to confirm>",
      "recommendation": "<specific header value, config change, or fix>"
    }}
  ]
}}

Rules:
- Only report issues ACTUALLY FOUND in the probe data above — do not invent issues
- "type" MUST be one of: {allowed_url_str}
- If target_context.local_development_target is true, do not report HTTPS enforcement, SSL/TLS certificate, or HSTS findings.
- Do not report missing cookie security flags when cookies.flags_applicable is false.
- Do not report missing rate limiting when rate_limiting.tested_existing_endpoint is false.
- Do not report CORS issues when cors.permissive is false.
- Do not report missing Server or X-Powered-By headers; their absence reduces version disclosure.
- Do not report paths where sensitive_paths.paths[path].spa_fallback is true; that is only the React SPA shell.
- Do not report API documentation exposure unless sensitive_paths.api_documentation_exposed is true.
- Do not report admin/dashboard exposure unless sensitive_paths.admin_or_dashboard_exposed is true.
- Raw JSON only, no markdown"""

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key or groq_key == "your_groq_api_key_here":
            raise Exception("GROQ_API_KEY not configured in backend/.env")

        client_groq = Groq(api_key=groq_key)
        
        models_to_try = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]
        response = None
        for i, model_name in enumerate(models_to_try):
            try:
                if i == 0:
                    log(f"Sending to Groq AI ({model_name})...", 85)
                else:
                    log(f"Sending to Groq AI ({model_name})...", 85)
                
                response = client_groq.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": "You are a strict web security auditor. Output ONLY raw valid JSON. No markdown."},
                        {"role": "user",   "content": prompt},
                    ],
                    temperature=0,
                    max_tokens=3500,
                )
                break
            except Exception as e:
                err_str = str(e).lower()
                if ("rate_limit" in err_str or "429" in err_str or "too many requests" in err_str) and i < len(models_to_try) - 1:
                    log(f"Rate limit hit for {model_name}. Falling back...", 85)
                    continue
                raise e

        raw = response.choices[0].message.content or ""
        log("Parsing AI analysis...", 90)

        result_dict = extract_json_robust(raw)
        for bug in result_dict.get("bugs", []):
            if isinstance(bug.get("reproduction"), list):
                bug["reproduction"] = "\n".join(str(s) for s in bug["reproduction"])

        result_dict = filter_url_false_positives(result_dict, findings)
        score = compute_score(result_dict.get("bugs", []))

        result_dict["securityScore"] = score
        result_dict["grade"]         = score_to_grade(score)
        result_dict["bugsFound"]     = len(result_dict.get("bugs", []))

        url_result = TestResult(**result_dict)
        test_results[test_id] = url_result

        # Persist to MongoDB
        await save_audit(test_id, "url", selected_tests, target_url, url_result)

        for bug in result_dict.get("bugs", []):
            log(f"[{bug.get('severity', 'LOW').upper()}] {bug.get('title', 'Issue found')}", 95)

        log(f"URL audit complete: {result_dict['bugsFound']} issue(s) found.", 100)
        active_tests[test_id]["status"] = "completed"

    except Exception as exc:
        if active_tests.get(test_id, {}).get("status") == "cancelled":
            return
        log(f"ERROR: {exc}", 100)
        active_tests[test_id]["status"] = "completed"
        test_results[test_id] = TestResult(
            grade="F", securityScore=0, bugsFound=1,
            bugs=[BugReport(
                id="url-error-1", severity="HIGH",
                title="URL Scan Failure", type="Security",
                reason=str(exc),
                reproduction="Check that the URL is reachable and the backend has internet access.",
                recommendation="Verify the target URL is correct and publicly accessible.",
            )],
        )

# ── TEMPLATES ─────────────────────────────────────────────────────────────
class Template(BaseModel):
    id: str
    name: str
    inputType: str
    selectedTests: list[str]
    targetUrl: str = None

@app.get("/api/templates")
async def get_templates():
    try:
        cursor = db.templates.find({}, {"_id": 0}).sort("createdAt", -1)
        return await cursor.to_list(length=100)
    except Exception as e:
        print(f"Error fetching templates: {e}")
        return []

@app.post("/api/templates")
async def create_template(template: Template):
    try:
        doc = template.dict()
        doc["createdAt"] = datetime.utcnow().isoformat()
        await db.templates.insert_one(doc)
        return {"status": "ok", "template": doc}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str):
    try:
        await db.templates.delete_one({"id": template_id})
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══ AI Security Assistant ════════════════════════════════════════════════

ASSISTANT_SYSTEM_PROMPT = """You are the AI Security Assistant built into TestPilot AI — a professional security audit and testing platform. You behave like a senior security engineer and product expert combined.

## CORE BEHAVIOUR

**Response length must match question complexity:**
- Simple/definition question ("What is XSS?") → 2–4 sentences max, no headers
- Moderate question ("How does JWT work?") → short paragraphs + 1 code example
- Complex/implementation question ("How do I implement rate limiting?") → structured answer with 1 focused code example
- Never dump textbook-length responses. Stop when the answer is complete.
- Never repeat the same point in different words.
- Never give multiple code examples for the same concept — pick the best one.

**Formatting rules:**
- Use `##` headers only for multi-section answers
- Use bullet points for lists of 3+ items
- Use fenced code blocks with language tag for all code
- Short paragraphs (2–3 sentences max each)
- Bold only key terms, not entire sentences

**Quality rules:**
- Always be specific — name the exact function, header, parameter, or pattern
- For vulnerabilities: what it is → why dangerous → fix (with code)
- For "how to" questions: direct steps + 1 code example
- Never say "I cannot help" for any topic in your domains
- Never expose internal errors or model details

---

## PLATFORM KNOWLEDGE (TestPilot AI)

You know this platform inside-out. Answer usage questions accurately:

**Scan types:** Codebase (ZIP upload), Database Schema (SQL/Prisma/JSON), Full Stack (both), Live URL Scan

**How to run a scan:**
1. Go to New Scan (sidebar)
2. Select input type → upload file or enter URL
3. Select test suites → click Next → Launch

**Test suites available:**
- Codebase: Unit Testing, Integration Testing, Security Analysis
- Database: Schema Validation, Query Optimization, Referential Integrity
- Full Stack: End-to-End Mapping, Full Stack Security, Data Flow Security
- URL: Security Headers, SSL/TLS, Access Control, Cookie Security, CORS Config, Info Disclosure, Rate Limiting

**Grading system (score → grade):**
- 90–100 → A+, 80–89 → A, 70–79 → B, 60–69 → C, 40–59 → D, 0–39 → F
- Score starts at 100, deducts: HIGH bug = -15, MEDIUM = -7, LOW = -3

**"Needs Review"** = completed scans with grade B or below (not A/A+, not cancelled)

**How to download a report:** Open any scan from History or Reports → click "Export PDF" button in the report header

**How to rerun a scan:** Go to New Scan → configure same settings → launch again (or use a saved template)

**Templates:** Save your test suite selection as a reusable template from the Test Suites step → "Save as template" button. Apply templates from Step 1 of New Scan.

**How to cancel a scan:** During an active scan, click the "Cancel Scan" button in the progress console

**Why a scan might fail:** Missing/invalid GROQ_API_KEY in backend .env, unsupported file format, empty ZIP archive, or backend not running

**Scan History:** Shows all past scans with grade, score, bug count. Click any row to open the full report.

**Reports page:** Lists all completed scans as cards. Click a card to open the full detailed report with vulnerability breakdown.

---

## TECHNICAL EXPERTISE

**Security:** OWASP Top 10, XSS, SQLi, CSRF, SSRF, RCE, IDOR, JWT attacks, OAuth misconfigs, TLS/SSL, CORS, CSP, security headers, cookie flags, brute force, rate limiting, secrets management, CVE/CVSS, VAPT methodology

**Programming:** Python, JavaScript/TypeScript, Java, Go, C/C++, SQL, shell scripting, REST APIs, async patterns, input validation, output encoding

**Databases:** MySQL, PostgreSQL, MongoDB, schema design, query optimization, indexing, transactions, ORM security

**DevOps:** Docker security, CI/CD pipelines, Git secrets, Linux hardening, Nginx config, environment variables

**Testing:** Unit, integration, API, UI testing, SAST/DAST, Playwright, Pytest, Jest

---

## SCAN REPORT CONTEXT

If a scan report is provided below, use it as the source of truth. When the user asks about "my scan", "last scan", "recent scan", "vulnerabilities found", or "my report" — answer using ONLY the data provided. Do not invent or estimate values.
"""

# ── Intent classifier — determines response token budget ─────────────────
def classify_intent(message: str) -> str:
    """Route the question to a response-size category."""
    msg = message.lower().strip()

    # Platform help questions → concise
    platform_keywords = [
        "how to", "how do i", "where is", "where can i", "what is the",
        "download", "export", "pdf", "rerun", "re-run", "cancel", "template",
        "upload", "grade", "score", "needs review", "history", "report page",
        "scan type", "what does", "what is a", "explain the grade",
        "why did", "why is", "failed", "not working",
    ]
    if any(k in msg for k in platform_keywords):
        return "platform"

    # Simple definition questions → short
    definition_keywords = [
        "what is ", "what are ", "define ", "explain ", "meaning of",
        "difference between", "vs ", "versus",
    ]
    if any(k in msg for k in definition_keywords) and len(msg) < 80:
        return "definition"

    # Scan/report analysis → medium
    scan_keywords = [
        "my scan", "last scan", "latest scan", "recent scan", "my report",
        "vulnerabilities found", "bugs found", "what was found", "scan result",
        "my grade", "my score", "fix this", "remediate",
    ]
    if any(k in msg for k in scan_keywords):
        return "report"

    # Implementation/how-to → medium with code
    impl_keywords = [
        "implement", "how to implement", "how to set up", "how to configure",
        "write a", "create a", "build a", "example of", "show me",
        "code for", "snippet", "sample",
    ]
    if any(k in msg for k in impl_keywords):
        return "implementation"

    # Default → standard
    return "standard"


# Token budgets per intent
TOKEN_BUDGETS = {
    "platform":       512,
    "definition":     400,
    "report":         800,
    "implementation": 900,
    "standard":       700,
}


class AssistantMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

    @field_validator("role", mode="before")
    @classmethod
    def normalise_role(cls, v):
        v = (v or "").strip().lower()
        return "assistant" if v in {"ai", "bot", "system"} else v

    @field_validator("content", mode="before")
    @classmethod
    def ensure_str(cls, v):
        return "" if v is None else str(v)

class AssistantRequest(BaseModel):
    messages: List[AssistantMessage]
    reportContext: Optional[dict] = None
    latestScan:    Optional[dict] = None   # real latest scan summary from history

@app.post("/api/assistant/chat")
async def assistant_chat(req: AssistantRequest):
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key or groq_key == "your_groq_api_key_here":
        raise HTTPException(status_code=503, detail="AI assistant is not configured.")

    # Determine intent from the last user message
    last_user_msg = ""
    for m in reversed(req.messages):
        if m.role == "user" and m.content.strip():
            last_user_msg = m.content.strip()
            break

    intent = classify_intent(last_user_msg)
    max_tokens = TOKEN_BUDGETS.get(intent, 700)

    # Build system prompt
    system_content = ASSISTANT_SYSTEM_PROMPT

    # Inject latest scan context (from frontend history fetch — always accurate)
    if req.latestScan:
        ls = req.latestScan
        system_content += f"""

## LATEST SCAN DATA (source of truth — use this for "last scan" / "recent scan" questions)
- Target: {ls.get('target', 'unknown')}
- Date: {ls.get('createdAt', 'unknown')}
- Input type: {ls.get('inputType', 'unknown')}
- Grade: {ls.get('grade', '?')}
- Security score: {ls.get('securityScore', '?')}/100
- Bugs found: {ls.get('bugsFound', 0)}
- Status: {ls.get('status', 'completed')}
- Test suites run: {', '.join(ls.get('selectedTests', []))}
"""

    # Inject open report context (when user is viewing a specific report)
    if req.reportContext:
        ctx = req.reportContext
        score = ctx.get("securityScore") or ctx.get("score", "?")
        grade = ctx.get("grade", "?")
        bugs  = ctx.get("bugs", [])
        target = ctx.get("target", "the scanned target")
        bug_lines = "\n".join(
            f"  - [{b.get('severity','?')}] {b.get('title','?')}: {b.get('reason','')}"
            for b in bugs[:12]
        )
        system_content += f"""

## CURRENTLY OPEN REPORT (user is viewing this report right now)
- Target: {target}
- Grade: {grade} | Score: {score}/100
- Total issues: {len(bugs)}
{bug_lines if bug_lines else '  No issues found.'}

When the user asks about vulnerabilities, fixes, or their report — reference this data directly.
"""

    # Sanitise and trim message history (keep last 16 turns)
    history = []
    for m in req.messages[-32:]:
        role = m.role if m.role in {"user", "assistant"} else "user"
        content = (m.content or "").strip()
        if content:
            history.append({"role": role, "content": content})

    if not history:
        raise HTTPException(status_code=400, detail="No messages provided.")

    # Retry logic: 2 attempts
    last_error = None
    for attempt in range(2):
        try:
            client = Groq(api_key=groq_key)
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": system_content},
                    *history,
                ],
                temperature=0.3,
                max_tokens=max_tokens,
            )
            answer = (response.choices[0].message.content or "").strip()
            if not answer:
                raise ValueError("Empty response from model")
            return {"answer": answer}
        except Exception as e:
            last_error = e
            if attempt == 0:
                await asyncio.sleep(0.8)

    # Both attempts failed — return a user-friendly message
    err_str = str(last_error).lower()
    print(f"[Assistant] Both attempts failed: {last_error}")

    if "rate_limit" in err_str or "429" in err_str or "tokens per day" in err_str:
        msg = (
            "The AI assistant has hit its daily token limit on the free Groq tier. "
            "It will reset automatically — usually within a few hours. "
            "To remove this limit, upgrade to the Groq Dev Tier at https://console.groq.com/settings/billing"
        )
    elif "503" in err_str or "unavailable" in err_str:
        msg = "The AI model is temporarily unavailable. Please try again in a minute."
    else:
        msg = "I'm having trouble reaching the AI engine right now. Please try again in a moment."

    return {"answer": msg}
