@echo off
REM Development shutdown script for Windows
REM Stops both Python backend and Next.js frontend

echo ========================================
echo Stopping MA Tracker Development Environment
echo ========================================
echo.

echo Stopping Python backend (uvicorn)...
taskkill /F /FI "WINDOWTITLE eq MA Tracker Backend*" 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Python backend stopped
) else (
    echo No Python backend process found
)

echo Stopping Next.js frontend (node)...
taskkill /F /FI "WINDOWTITLE eq MA Tracker Frontend*" 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Next.js frontend stopped
) else (
    echo No Next.js process found
)

REM More aggressive cleanup - kill all node and python processes if needed
REM Uncomment these lines if the above doesn't work:
REM taskkill /F /IM node.exe 2>nul
REM taskkill /F /IM python.exe 2>nul

echo.
echo ========================================
echo Services stopped
echo ========================================
