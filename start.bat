@echo off
echo ===================================================
echo Starting UK IVA Cold Calling & CRM Platform
echo ===================================================

start cmd /k "echo Starting Backend API... && cd backend && npm start"
timeout /t 3 >nul
start cmd /k "echo Starting React CRM Frontend... && cd frontend && npm run dev"

echo Platform started! Open http://localhost:5173 in your browser.
