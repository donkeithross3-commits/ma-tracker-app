@echo off
echo ============================================
echo IB Data Agent
echo ============================================
echo.

REM Check if Python is available
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python not found in PATH
    echo.
    echo Please install Python 3.9 or newer from:
    echo https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

REM Check Python version
python -c "import sys; exit(0 if sys.version_info >= (3, 9) else 1)" 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python 3.9 or newer is required
    echo.
    python --version
    echo.
    pause
    exit /b 1
)

REM Load environment variables from config.env if it exists
if exist "%~dp0config.env" (
    echo Loading config.env...
    for /f "usebackq tokens=1,2 delims==" %%a in ("%~dp0config.env") do (
        REM Skip comments and empty lines
        echo %%a | findstr /r "^#" >nul || (
            if not "%%a"=="" set "%%a=%%b"
        )
    )
    echo.
)

REM Check if API key is set
if "%IB_PROVIDER_KEY%"=="" (
    echo ERROR: IB_PROVIDER_KEY is not set
    echo.
    echo Please edit config.env and add your API key:
    echo IB_PROVIDER_KEY=your-api-key-here
    echo.
    echo Get your API key from the MA Tracker web app.
    echo.
    pause
    exit /b 1
)

echo Starting IB Data Agent...
echo.
echo IB TWS:    %IB_HOST%:%IB_PORT%
echo Relay URL: %RELAY_URL%
echo.
echo Press Ctrl+C to stop
echo ============================================
echo.

REM Run the agent
python "%~dp0ib_data_agent.py"

echo.
echo Agent stopped.
pause
