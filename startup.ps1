# TestOps Platform — Unified Startup Script

Write-Host "TestOps Platform - Starting Backend & Frontend..." -ForegroundColor Cyan
Write-Host ""

# Verify folders

if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
Write-Host "Error: Run this from project root." -ForegroundColor Red
exit 1
}

# Install root dependencies

if (-not (Test-Path "node_modules")) {
Write-Host "Installing root dependencies..." -ForegroundColor Yellow
npm install
}

# Setup backend venv

if (-not (Test-Path "backend/venv")) {
Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
}

# Setup frontend dependencies

if (-not (Test-Path "frontend/node_modules")) {
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
cd frontend
npm install
cd ..
}

Write-Host ""
Write-Host "Backend: http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Green
Write-Host ""

# Start platform

npm run dev
