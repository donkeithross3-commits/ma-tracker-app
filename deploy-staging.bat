@echo off
REM Staging deployment script for Windows
REM Ensures clean deployment with no cache issues

echo ========================================
echo MA Tracker - Staging Deployment
echo ========================================
echo.

REM Step 1: Stop all services
echo [1/6] Stopping services...
call dev-stop.bat
timeout /t 2 /nobreak >nul

REM Step 2: Clean Python cache
echo [2/6] Cleaning Python bytecode cache...
FOR /d /r python-service %%d IN (__pycache__) DO @IF EXIST "%%d" rd /s /q "%%d"
del /s /q python-service\*.pyc 2>nul
echo Python cache cleaned

REM Step 3: Pull latest code
echo [3/6] Pulling latest code from main...
git fetch origin
git reset --hard origin/main
echo Code updated to latest main

REM Step 4: Clean logs
echo [4/6] Cleaning old logs...
if exist logs\python-backend.log del logs\python-backend.log
if exist logs\nextjs-frontend.log del logs\nextjs-frontend.log
echo Logs cleaned

REM Step 5: Install/update dependencies (optional, uncomment if needed)
REM echo [5/6] Updating Python dependencies...
REM cd python-service
REM py -3.11 -m pip install -r requirements.txt --upgrade
REM cd ..

echo [5/6] Skipping dependency installation (not needed)

REM Step 6: Start services
echo [6/6] Starting services...
call dev-start.bat

echo.
echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo Services should be starting up...
echo Check logs for any errors:
echo   type logs\python-backend.log
echo   type logs\nextjs-frontend.log
echo.
echo After services start, run:
echo   curl -X POST http://localhost:8000/intelligence/monitoring/start
echo.
