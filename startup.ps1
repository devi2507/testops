# TestOps Platform — Unified Startup Script
# For Windows PowerShell
# Usage: .\startup.ps1

Write-Host "TestOps Platform - Starting Backend & Frontend..." -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "Error: Please run this script from the project root directory." -ForegroundColor Red
    exit 1
}

# Install concurrently if not already installed
if (-not (Test-Path "node_modules/concurrently")) {
    Write-Host "Installing concurrently..." -ForegroundColor Yellow
    npm install concurrently
}

Write-Host "Starting both backend and frontend..." -ForegroundColor Green
Write-Host "Backend will run on http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend will run on http://localhost:3000" -ForegroundColor Green
Write-Host ""

# Run using npm with concurrently
npm run dev
