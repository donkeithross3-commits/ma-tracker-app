@echo off
setlocal enabledelayedexpansion

echo ============================================
echo IB Data Agent
echo ============================================
echo.

REM Get script directory
set "SCRIPT_DIR=%~dp0"

REM Load environment variables from config.env if it exists
if exist "%SCRIPT_DIR%config.env" (
    echo Loading config.env...
    for /f "usebackq tokens=1,* delims==" %%a in ("%SCRIPT_DIR%config.env") do (
        REM Skip comments and empty lines
        set "LINE=%%a"
        if not "!LINE!"=="" (
            if not "!LINE:~0,1!"=="#" (
                set "%%a=%%b"
            )
        )
    )
    echo.
) else (
    echo ERROR: config.env not found
    echo.
    echo The config.env file should have been included in your download.
    echo Please re-download the agent from the MA Tracker web app.
    echo.
    pause
    exit /b 1
)

REM Check if API key is set
if "%IB_PROVIDER_KEY%"=="" (
    echo ERROR: IB_PROVIDER_KEY is not set in config.env
    echo.
    echo Your config.env file appears to be incomplete.
    echo Please re-download the agent from the MA Tracker web app.
    echo.
    pause
    exit /b 1
)

if "%IB_PROVIDER_KEY%"=="your-api-key-here" (
    echo ERROR: API key not configured
    echo.
    echo Your config.env still has the placeholder API key.
    echo Please re-download the agent from the MA Tracker web app
    echo to get a pre-configured version with your API key.
    echo.
    pause
    exit /b 1
)

REM Set defaults if not configured
if "%IB_HOST%"=="" set "IB_HOST=127.0.0.1"
if "%IB_PORT%"=="" set "IB_PORT=7497"
if "%RELAY_URL%"=="" set "RELAY_URL=wss://dr3-dashboard.com/ws/data-provider"

echo IB TWS:    %IB_HOST%:%IB_PORT%
echo Relay URL: %RELAY_URL%
echo.

REM ============================================
REM Option 1: Check for standalone executable (no Python needed)
REM ============================================
if exist "%SCRIPT_DIR%ib_data_agent.exe" (
    echo Starting IB Data Agent (standalone)...
    echo Press Ctrl+C to stop
    echo ============================================
    echo.
    "%SCRIPT_DIR%ib_data_agent.exe"
    goto :end
)

REM ============================================
REM Option 2: Check for Python
REM ============================================
where python >nul 2>nul
if %errorlevel% equ 0 (
    REM Python found, check version
    python -c "import sys; exit(0 if sys.version_info >= (3, 9) else 1)" 2>nul
    if !errorlevel! equ 0 (
        echo Starting IB Data Agent (Python)...
        echo Press Ctrl+C to stop
        echo ============================================
        echo.
        python "%SCRIPT_DIR%ib_data_agent.py"
        goto :end
    ) else (
        echo WARNING: Python found but version is too old (need 3.9+)
        python --version
        echo.
    )
)

REM ============================================
REM No Python found - show helpful error
REM ============================================
echo ============================================
echo ERROR: Python 3.9+ is required
echo ============================================
echo.
echo The IB Data Agent requires Python to run.
echo.
echo To install Python:
echo   1. Go to https://www.python.org/downloads/
echo   2. Download Python 3.11 or newer
echo   3. IMPORTANT: Check "Add Python to PATH" during installation
echo   4. Restart this script after installation
echo.
echo.
set /p "OPEN_URL=Would you like to open the Python download page? (Y/N): "
if /i "%OPEN_URL%"=="Y" (
    start https://www.python.org/downloads/
)
echo.
pause
exit /b 1

:end
echo.
echo Agent stopped.
pause
