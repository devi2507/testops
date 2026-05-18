# TestOps Platform

AI-powered security audit system with React frontend and FastAPI backend.

## Quick Start

### First-time Setup

1. Install all dependencies:
   ```powershell
   npm run install-all
   ```

### Starting the Platform

#### Option 1: PowerShell Script (Recommended for Windows)
```powershell
cd c:\path\to\auto-test-platform
.\startup.ps1
```

This starts both backend and frontend automatically.

#### Option 2: Manual — Two Terminals

**Terminal 1 (Backend):**
```powershell
cd c:\path\to\auto-test-platform\backend
.\venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload --port 8000
```

**Terminal 2 (Frontend):**
```powershell
cd c:\path\to\auto-test-platform\frontend
npm start
```

#### Option 3: npm Command (if you have concurrently installed)
```powershell
npm run dev
```

### Accessing the Platform

- **Frontend**: http://localhost:3000
- **Backend API Docs**: http://localhost:8000/docs

## What Happens on Startup

1. **Backend** starts on port 8000 with hot-reload enabled
2. **Frontend** starts on port 3000 and waits for the backend to be ready
3. Frontend automatically retries backend health checks if the backend is slow to start
4. Once both are running, open http://localhost:3000 in your browser

## Troubleshooting

### "Backend is offline" message

The frontend will show this temporarily while the backend is starting. It will automatically reconnect when the backend comes up.

If it persists:
- Ensure backend is running: http://localhost:8000/docs
- Check that the backend process did not crash
- Look at the terminal output for error messages

### Missing dependencies

If you see `ModuleNotFoundError` in the backend:
```powershell
cd backend
pip install -r requirements.txt
```

If you see `npm ERR!` in the frontend:
```powershell
cd frontend
npm install
```

### Port already in use

If port 8000 or 3000 is already in use:
- For backend: Edit `startup.ps1` or the uvicorn command to use a different `--port`
- For frontend: Set `PORT=3001` before running `npm start` in the frontend terminal

## Project Structure

```
auto-test-platform/
├── backend/           # FastAPI server
│   ├── main.py
│   ├── requirements.txt
│   └── venv/          # Python virtual environment
├── frontend/          # React application
│   ├── src/
│   ├── package.json
│   └── public/
├── package.json       # Root npm config (for unified startup)
└── startup.ps1        # Windows startup script
```

## Key Features

- **Multi-input Testing**: Codebase, database schema, full stack, or URL scans
- **AI-powered Analysis**: Groq integration for intelligent vulnerability detection
- **Security Scoring**: Automatic grading from F to A+
- **Audit History**: Persistent MongoDB storage of all scans
- **Real-time Progress**: Live streaming logs during scan execution
- **Assistant Chat**: AI-powered report analysis and Q&A

## Environment Variables

### Frontend (`.env` in frontend folder)
```
REACT_APP_API_URL=http://localhost:8000
```

### Backend (`.env` in backend folder)
```
MONGODB_URI=mongodb://localhost:27017
GROQ_API_KEY=your-api-key-here
ALLOWED_ORIGINS=http://localhost:3000
```

## Development Notes

- Backend uses `--reload` flag for hot-module reloading on code changes
- Frontend uses Create React App development server with hot reload
- Changes are instantly reflected without restarting the servers

## Production Deployment

See `backend/RENDER_DEPLOYMENT.md` for deploying to Render.

---

**Questions?** Check the backend and frontend folder READMEs for more details.
