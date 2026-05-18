# TestOps Platform

AI-powered automated testing and security audit platform built for developers, startups, and engineering teams.

TestOps Platform helps users analyze codebases, database schemas, full-stack applications, and live URLs using AI-assisted testing workflows, real-time execution monitoring, and detailed vulnerability reporting.

---

# Features

- AI-powered vulnerability analysis
- Codebase security testing
- Database schema validation
- Full-stack audit workflows
- URL/application scanning
- Real-time scan execution logs
- Security grading system (F → A+)
- AI-generated remediation insights
- Scan history and report management
- PDF report export
- Cancel running scans
- Light/Dark theme support
- AI Security Assistant chat
- Template-based scan configuration
- Secure file upload validation
- Shareable report URLs

---

# Tech Stack

## Frontend
- React.js
- Context API
- CSS Modules / Custom CSS
- SSE (Server-Sent Events)

## Backend
- FastAPI
- Python
- MongoDB Atlas
- Groq API
- JWT Authentication

---

# Project Structure

```bash
auto-test-platform/
├── backend/                 # FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   ├── routes/
│   ├── services/
│   └── utils/
│
├── frontend/                # React frontend
│   ├── src/
│   ├── public/
│   ├── components/
│   ├── pages/
│   └── services/
│
├── package.json
└── README.md