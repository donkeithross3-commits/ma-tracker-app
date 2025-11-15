@echo off
REM Development startup script for Windows
REM Starts both Python backend and Next.js frontend

echo ========================================
echo Starting M&A Tracker Development Environment
echo ========================================
echo.

REM Create logs directory if it doesn't exist
if not exist logs mkdir logs

REM Start Python backend in background
echo Starting Python backend (port 8000)...
start /B cmd /c "cd python-service && py -3.11 start_server.py > ..\logs\python-backend.log 2>&1"

REM Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

REM Start Next.js frontend in background
echo Starting Next.js frontend (port 3000)...
start /B cmd /c "npm run dev > logs\nextjs-frontend.log 2>&1"

echo.
echo ========================================
echo Services started!
echo ========================================
echo Python Backend: http://localhost:8000
echo Next.js Frontend: http://localhost:3000
echo.
echo Logs:
echo - Backend: logs\python-backend.log
echo - Frontend: logs\nextjs-frontend.log
echo.
echo To view logs in real-time:
echo   tail -f logs\python-backend.log
echo   tail -f logs\nextjs-frontend.log
echo.
echo To stop services, run: dev-stop.bat
echo ========================================
