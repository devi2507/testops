"""
TestOps Platform — Backend
FastAPI + Groq (llama-3.1-8b-instant)
API key is loaded from .env — users never need to enter one.
"""

import asyncio, uuid, os, zipfile, tempfile, shutil, json, re, ssl, time
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, BackgroundTasks, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
        }
        await audits_col.replace_one({"_id": test_id}, doc, upsert=True)
    except Exception as exc:
        print(f"[MongoDB] Failed to save audit {test_id}: {exc}")


app = FastAPI(title="TestOps Platform", version="2.0")

# ── CORS Configuration ─────────────────────────────────────────
# For development: allow all origins. For production: set ALLOWED_ORIGINS env var
allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
allowed_origins = [origin.strip() for origin in allowed_origins if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins != ["*"] else ["*"],
    allow_credentials=True,
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

@app.post("/api/assistant/chat", response_model=AssistantChatResponse)
async def assistant_chat(payload: AssistantChatRequest):
    """
    General-purpose AI Security/Testing assistant with optional report awareness.
    Keeps frontend architecture unchanged: the UI calls this endpoint and sends a rolling message history.
    """
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key or groq_key == "your_groq_api_key_here":
        # Log clearly so operators see misconfiguration
        print("[AssistantChat] GROQ_API_KEY not configured in environment or backend/.env")
        return AssistantChatResponse(
            answer="The AI assistant backend is not configured on this server (missing GROQ_API_KEY). "
                   "Ask your administrator to set the Groq API key in backend/.env.",
            isUnrelated=False,
        )

    # Defensive: limit size (frontend should already keep it small)
    history = (payload.messages or [])[-16:]
    report_ctx = payload.reportContext or None

    system_prompt = (
        "You are TestOps Engineering Assistant — an AI assistant that behaves like:\n"
        "- a senior cybersecurity engineer,\n"
        "- a QA / software testing expert,\n"
        "- and a DevSecOps-focused engineering partner.\n"
        "\n"
        "You are specialized in:\n"
        "- Application & infrastructure security (TLS, JWT, OAuth, OWASP Top 10, CORS/CSRF, authn vs authz, secrets management, encryption at rest/in transit)\n"
        "- Software testing (unit, integration, e2e, test strategy, CI test pipelines, debugging failing or flaky tests)\n"
        "- Backend and API design (REST, GraphQL, microservices, versioning, rate limiting, idempotency)\n"
        "- Frontend concepts (SPAs, browser security model, CORS, cookies, local/session storage)\n"
        "- Databases and SQL (foreign keys, normalization, indexing, transactions, isolation levels, ORMs)\n"
        "- DevOps / DevSecOps (CI/CD, static/dynamic analysis, SBOM, secrets scanning, shift-left security)\n"
        "- General debugging & modern programming practices.\n"
        "\n"
        "You should naturally and directly answer educational technical questions such as:\n"
        "- \"What is a hardcoded secret key?\"\n"
        "- \"What is a foreign key?\"\n"
        "- \"What is normalization?\"\n"
        "- \"Difference between REST and GraphQL?\"\n"
        "- \"What is CORS?\" / \"Explain TLS\" / \"Explain JWT\"\n"
        "- \"What is dependency injection?\" / \"What is Docker?\"\n"
        "For these, explain what it is, why it matters, the risks or trade-offs, and give a small concrete example plus safer alternatives when relevant.\n"
        "\n"
        "Report awareness:\n"
        "- If the user's question is clearly about the current scan/report (specific findings, severities, root causes, reproductions, recommended fixes), use the provided report context to answer precisely.\n"
        "- If it is NOT about the report, answer normally using your general engineering knowledge (do NOT force the report into the answer).\n"
        "\n"
        "Style guidelines:\n"
        "- Explain acronyms on first use (e.g., TLS = Transport Layer Security).\n"
        "- Be concise but informative. Give clear definitions, explain risks/impact, and show a short example or scenario when helpful.\n"
        "- Sound natural and intelligent; avoid boilerplate like \"please check the report\" unless it truly adds value.\n"
        "\n"
        "Unrelated questions:\n"
        "- ONLY treat a question as unrelated if it is obviously outside software / security / IT / engineering (e.g., cooking recipes, movie rankings, celebrity gossip).\n"
        "- In those rare cases, you may set isUnrelated=true and your answer should briefly redirect the user back to software/security/testing topics.\n"
        "- Normal questions about security, testing, authentication, APIs, vulnerabilities, encryption, DevOps, backend/frontend, OWASP, databases, CI/CD, or debugging are ALWAYS considered in-scope and should be answered directly.\n"
        "\n"
        "Return ONLY valid JSON with this shape:\n"
        "{ \"answer\": \"<string>\", \"isUnrelated\": <true|false> }\n"
        "No markdown, no code fences, no extra keys."
    )

    msgs = [{"role": "system", "content": system_prompt}]
    if report_ctx:
        # Keep report context compact; the frontend should send only essentials.
        msgs.append({
            "role": "system",
            "content": "Current scan/report context (use ONLY when relevant):\n" + json.dumps(report_ctx, ensure_ascii=False)[:12000],
        })

    for m in history:
        role = (m.role or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = (m.content or "").strip()
        if not content:
            continue
        msgs.append({"role": role, "content": content[:4000]})

    client = Groq(api_key=groq_key)

    last_error: Optional[Exception] = None
    raw: str = ""

    for attempt in range(2):  # initial try + one retry
        try:
            print(f"[AssistantChat] Sending request to Groq (attempt {attempt + 1})")
            resp = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=msgs,
                temperature=0.2,
                max_tokens=900,
            )
            raw = (resp.choices[0].message.content or "").strip()
            break
        except Exception as exc:
            last_error = exc
            print(f"[AssistantChat] Groq API error on attempt {attempt + 1}: {exc}")
            # small delay before retry to avoid hammering
            time.sleep(0.4)

    if not raw:
        # After retries we still have no content; return a graceful answer instead of HTTP 502
        msg = "The AI assistant could not be reached right now. Please try again in a moment."
        if last_error:
            print(f"[AssistantChat] Giving up after retries. Last error: {last_error}")
        return AssistantChatResponse(answer=msg, isUnrelated=False)

    obj = extract_assistant_json_robust(raw)

    answer = str(obj.get("answer", "")).strip()
    is_unrelated = bool(obj.get("isUnrelated", False))
    if not answer:
        print("[AssistantChat] Parsed response had empty 'answer' field; falling back to raw content.")
        answer = raw

    return AssistantChatResponse(answer=answer, isUnrelated=is_unrelated)

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

    try:
        input_type     = active_tests[test_id]["config"]["inputType"]
        selected_tests = active_tests[test_id]["config"]["selectedTests"]

        
        log("Inspecting uploaded archive...", 10)
        await asyncio.sleep(0.5)

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

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key or groq_key == "your_groq_api_key_here":
            raise Exception(
                "GROQ_API_KEY not configured. "
                "Edit backend/.env and set your Groq key from https://console.groq.com/keys, "
                "then restart the server."
            )

        client = Groq(api_key=groq_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
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
        raw = response.choices[0].message.content or ""
        log("Parsing AI response...", 85)
        await asyncio.sleep(0.3)

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

        log(f"Report ready: {len(filtered_bugs)} issue(s) found.", 100)
        active_tests[test_id]["status"] = "completed"

    except Exception as exc:
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
            if t["status"] == "completed":
                break
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream")


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

    # Ensure URL has scheme
    if not target_url.startswith(("http://", "https://")):
        target_url = "https://" + target_url

    findings = {}   # will hold all raw probe data

    try:
        log(f"Connecting to {target_url}...", 10)

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
            security_headers_check = {
                "Content-Security-Policy":   resp_headers.get("content-security-policy"),
                "X-Frame-Options":           resp_headers.get("x-frame-options"),
                "Strict-Transport-Security": resp_headers.get("strict-transport-security"),
                "X-Content-Type-Options":    resp_headers.get("x-content-type-options"),
                "Referrer-Policy":           resp_headers.get("referrer-policy"),
                "Permissions-Policy":        resp_headers.get("permissions-policy"),
                "Server":                    resp_headers.get("server"),
                "X-Powered-By":              resp_headers.get("x-powered-by"),
            }
            findings["security_headers"] = security_headers_check

            # ── Cookie security ────────────────────────────────────────
            log("Inspecting cookies...", 36)
            cookies_found = []
            for k, v in resp.cookies.items():
                cookies_found.append({"name": k, "value_preview": v[:12] + "..." if len(v) > 12 else v})
            set_cookie_raw = resp_headers.get("set-cookie", "")
            findings["cookies"] = {
                "count":         len(cookies_found),
                "names":         [c["name"] for c in cookies_found],
                "set_cookie_raw": set_cookie_raw,
                "has_httponly":  "httponly" in set_cookie_raw.lower(),
                "has_secure":    "secure" in set_cookie_raw.lower(),
                "has_samesite":  "samesite" in set_cookie_raw.lower(),
            }

            # ── CORS ─────────────────────────────────────────────────
            log("Checking CORS configuration...", 44)
            cors_resp = await client.options(
                target_url,
                headers={**headers_to_send, "Origin": "https://evil-attacker.com",
                         "Access-Control-Request-Method": "GET"},
            )
            findings["cors"] = {
                "allow_origin":      cors_resp.headers.get("access-control-allow-origin", "not set"),
                "allow_credentials": cors_resp.headers.get("access-control-allow-credentials", "not set"),
                "allow_methods":     cors_resp.headers.get("access-control-allow-methods", "not set"),
                "allow_headers":     cors_resp.headers.get("access-control-allow-headers", "not set"),
            }

            # ── Exposed sensitive paths ────────────────────────────────
            log("Probing sensitive paths...", 54)
            base = f"{resp.url.scheme}://{resp.url.host}"
            sensitive_paths = [
                "/.env", "/.git/config", "/robots.txt", "/swagger",
                "/api/docs", "/api/v1/users", "/admin", "/dashboard",
                "/config.json", "/phpinfo.php", "/.well-known/security.txt",
                "/api/swagger.json", "/openapi.json",
            ]
            path_results = {}
            for path in sensitive_paths:
                try:
                    pr = await client.get(base + path, headers=headers_to_send)
                    path_results[path] = {"status": pr.status_code, "exposed": pr.status_code == 200}
                except Exception:
                    path_results[path] = {"status": "error", "exposed": False}
            findings["sensitive_paths"] = path_results

            # ── Rate limiting ─────────────────────────────────────────
            log("Testing rate limiting...", 64)
            login_paths = ["/login", "/api/login", "/api/auth/login", "/auth/login", "/signin"]
            rate_results = {}
            for lp in login_paths:
                try:
                    statuses = []
                    for _ in range(6):
                        r = await client.post(base + lp, headers=headers_to_send,
                                              json={"username": "test", "password": "test"},
                                              timeout=4.0)
                        statuses.append(r.status_code)
                    rate_results[lp] = {
                        "status_codes": statuses,
                        "rate_limited": any(s in [429, 503] for s in statuses),
                    }
                except Exception:
                    pass   # path doesn't exist, skip
            findings["rate_limiting"] = rate_results

        # ── SSL check (sync, separate context) ──────────────────────
        log("Checking SSL/TLS certificate...", 72)
        import socket
        from urllib.parse import urlparse
        ssl_info = {}
        try:
            parsed  = urlparse(target_url)
            host    = parsed.hostname
            port    = parsed.port or 443
            ctx     = ssl.create_default_context()
            conn    = ctx.wrap_socket(socket.socket(), server_hostname=host)
            conn.settimeout(8)
            conn.connect((host, port))
            cert    = conn.getpeercert()
            conn.close()
            import datetime
            expiry  = datetime.datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
            days_left = (expiry - datetime.datetime.utcnow()).days
            ssl_info = {
                "valid":            True,
                "subject":          dict(x[0] for x in cert.get("subject", [])),
                "issuer":           dict(x[0] for x in cert.get("issuer", [])),
                "expires":          cert["notAfter"],
                "days_until_expiry": days_left,
                "tls_version":      conn.version() if hasattr(conn, "version") else "unknown",
            }
        except ssl.SSLCertVerificationError as e:
            ssl_info = {"valid": False, "error": str(e)}
        except Exception as e:
            ssl_info = {"valid": None, "error": str(e), "note": "Could not inspect certificate"}
        findings["ssl"] = ssl_info

        # ── Build AI prompt ──────────────────────────────────────────
        log("Sending findings to AI for analysis...", 80)

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
- Raw JSON only, no markdown"""

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key or groq_key == "your_groq_api_key_here":
            raise Exception("GROQ_API_KEY not configured in backend/.env")

        client_groq = Groq(api_key=groq_key)
        response = client_groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a strict web security auditor. Output ONLY raw valid JSON. No markdown."},
                {"role": "user",   "content": prompt},
            ],
            temperature=0,
            max_tokens=3500,
        )
        raw = response.choices[0].message.content or ""
        log("Parsing AI analysis...", 90)

        result_dict = extract_json_robust(raw)
        for bug in result_dict.get("bugs", []):
            if isinstance(bug.get("reproduction"), list):
                bug["reproduction"] = "\n".join(str(s) for s in bug["reproduction"])

        # Validate score
        raw_score = result_dict.get("securityScore", 50)
        try:
            score = max(0, min(100, int(raw_score)))
        except Exception:
            score = compute_score(result_dict.get("bugs", []))

        result_dict["securityScore"] = score
        result_dict["grade"]         = score_to_grade(score)
        result_dict["bugsFound"]     = len(result_dict.get("bugs", []))

        url_result = TestResult(**result_dict)
        test_results[test_id] = url_result

        # Persist to MongoDB
        await save_audit(test_id, "url", selected_tests, target_url, url_result)

        log(f"URL audit complete: {result_dict['bugsFound']} issue(s) found.", 100)
        active_tests[test_id]["status"] = "completed"

    except Exception as exc:
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
