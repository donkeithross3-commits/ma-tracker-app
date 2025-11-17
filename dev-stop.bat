@echo off
REM Development shutdown script for Windows
REM Stops both Python backend and Next.js frontend

echo ========================================
echo Stopping MA Tracker Development Environment
echo ========================================
echo.

echo Stopping Python backend (uvicorn)...
taskkill /F /IM python.exe 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Python backend stopped
) else (
    echo No Python backend process found
)

echo Stopping Next.js frontend (node)...
taskkill /F /IM node.exe 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Next.js frontend stopped
) else (
    echo No Node.js processes found
)

echo.
echo ========================================
echo Services stopped
echo ========================================
