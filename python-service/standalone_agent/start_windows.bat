@echo off
setlocal enabledelayedexpansion

echo ============================================
echo IB Data Agent
echo ============================================
echo.

REM Get script directory
set "SCRIPT_DIR=%~dp0"

REM ============================================
REM Check if running from inside a ZIP file
REM Windows temp extraction paths contain "Temp" and random chars
REM ============================================
echo !SCRIPT_DIR! | findstr /i "\\Temp\\" >nul
if !errorlevel! equ 0 (
    echo ============================================
    echo PLEASE EXTRACT THE ZIP FILE FIRST
    echo ============================================
    echo.
    echo It looks like you're running this from inside the ZIP file.
    echo.
    echo To install the IB Data Agent:
    echo   1. Right-click on ib-data-agent.zip
    echo   2. Select "Extract All..."
    echo   3. Choose where to extract ^(Desktop is fine^)
    echo   4. Open the extracted folder
    echo   5. Double-click start_windows.bat
    echo.
    pause
    exit /b 1
)

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
    echo ============================================
    echo ERROR: config.env not found
    echo ============================================
    echo.
    echo This usually means you need to extract the ZIP file first.
    echo.
    echo To install the IB Data Agent:
    echo   1. Right-click on ib-data-agent.zip
    echo   2. Select "Extract All..."
    echo   3. Choose where to extract ^(Desktop is fine^)
    echo   4. Open the extracted folder
    echo   5. Double-click start_windows.bat
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
REM Check for desktop shortcut (first run)
REM ============================================
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\IB Data Agent.lnk"
set "FIRST_RUN_FLAG=%SCRIPT_DIR%.first_run_complete"

if not exist "%FIRST_RUN_FLAG%" (
    if not exist "%SHORTCUT_PATH%" (
        echo ============================================
        echo First Run Setup
        echo ============================================
        echo.
        set /p "CREATE_SHORTCUT=Would you like to create a desktop shortcut? (Y/N): "
        if /i "!CREATE_SHORTCUT!"=="Y" (
            call :create_shortcut
        )
        echo.
    )
    REM Mark first run as complete
    echo %date% %time% > "%FIRST_RUN_FLAG%"
)

REM ============================================
REM Check for updates
REM ============================================
call :check_for_updates
if !UPDATE_AVAILABLE!==1 (
    echo.
    echo ============================================
    echo UPDATE AVAILABLE - Installing automatically
    echo ============================================
    echo Current version: !CURRENT_VERSION!
    echo New version:     !SERVER_VERSION!
    echo.
    call :download_update
    if !UPDATE_SUCCESS!==1 (
        echo.
        echo Restarting with new version...
        echo.
        "%~f0"
        exit /b 0
    )
    echo.
)

REM ============================================
REM Option 1: Check for standalone executable (no Python needed)
REM ============================================
if exist "%SCRIPT_DIR%ib_data_agent.exe" (
    echo Starting IB Data Agent [standalone exe]...
    echo Press Ctrl+C to stop
    echo ============================================
    echo.
    "%SCRIPT_DIR%ib_data_agent.exe"
    goto :end
)

REM ============================================
REM Option 2: Check for bundled Python (no install needed)
REM ============================================
set "BUNDLED_PYTHON=%SCRIPT_DIR%python_bundle\python.exe"
if exist "%BUNDLED_PYTHON%" (
    echo Using bundled Python [no install required]
    "%BUNDLED_PYTHON%" --version
    echo.
    echo Starting IB Data Agent...
    echo Press Ctrl+C to stop
    echo ============================================
    echo.
    "%BUNDLED_PYTHON%" "%SCRIPT_DIR%run_agent.py"
    goto :end
)

REM ============================================
REM Option 3: Check for system Python
REM ============================================
where python >nul 2>nul
if %errorlevel% neq 0 goto :nopython

REM Python found, check version (need 3.8+)
python -c "import sys; exit(0 if sys.version_info >= (3, 8) else 1)" 2>nul
if !errorlevel! neq 0 (
    echo WARNING: Python found but version is too old (need 3.8+)
    python --version
    echo.
    goto :nopython
)

echo Using system Python
python --version

REM Python OK - check and install dependencies
echo Checking dependencies...
python -c "import websockets" 2>nul
if !errorlevel! neq 0 (
    echo Installing required packages...
    python -m pip install --quiet --disable-pip-version-check -r "%SCRIPT_DIR%requirements.txt"
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install dependencies
        echo Try running: python -m pip install websockets
        pause
        exit /b 1
    )
    echo Dependencies installed.
) else (
    echo Dependencies OK.
)
echo.

echo Starting IB Data Agent...
echo Press Ctrl+C to stop
echo ============================================
echo.
python "%SCRIPT_DIR%run_agent.py"
goto :end

:nopython
REM ============================================
REM No Python found - show helpful error
REM ============================================
echo ============================================
echo ERROR: Python not found
echo ============================================
echo.
echo The IB Data Agent requires Python to run, but no bundled
echo Python was found and no system Python is available.
echo.
echo Options:
echo   1. Re-download the agent (should include bundled Python)
echo   2. Install Python manually:
echo      - Go to https://www.python.org/downloads/
echo      - Download Python 3.11 (recommended)
echo      - IMPORTANT: Check "Add Python to PATH" during installation
echo      - Restart this script after installation
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
exit /b 0

REM ============================================
REM SUBROUTINES
REM ============================================

:create_shortcut
echo Creating desktop shortcut...
REM Use PowerShell to create the shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%SCRIPT_DIR%start_windows.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'IB Data Agent for MA Tracker'; $s.Save()"
if exist "%SHORTCUT_PATH%" (
    echo Desktop shortcut created successfully!
) else (
    echo Note: Could not create shortcut automatically.
    echo You can manually create one by right-clicking start_windows.bat
    echo and selecting "Create shortcut", then move it to your desktop.
)
goto :eof

:check_for_updates
set "UPDATE_AVAILABLE=0"
set "CURRENT_VERSION=unknown"
set "SERVER_VERSION=unknown"

REM Read current version and trim whitespace
if exist "%SCRIPT_DIR%version.txt" (
    for /f "usebackq tokens=* delims=" %%a in ("%SCRIPT_DIR%version.txt") do set "CURRENT_VERSION=%%a"
) else (
    set "CURRENT_VERSION=0.0.0"
)

REM Trim any trailing spaces/CR from version
for /f "tokens=1" %%a in ("!CURRENT_VERSION!") do set "CURRENT_VERSION=%%a"

echo Checking for updates... (current: !CURRENT_VERSION!)

REM Fetch server version using PowerShell and parse JSON in one call
for /f "usebackq tokens=*" %%i in (`powershell -Command "try { $r = Invoke-WebRequest -Uri 'https://dr3-dashboard.com/api/ma-options/agent-version' -UseBasicParsing -TimeoutSec 5; ($r.Content | ConvertFrom-Json).version } catch { '' }"`) do set "SERVER_VERSION=%%i"

if "!SERVER_VERSION!"=="" (
    echo Could not check for updates ^(offline or server unavailable^)
    goto :eof
)

REM Trim any trailing spaces from server version
for /f "tokens=1" %%a in ("!SERVER_VERSION!") do set "SERVER_VERSION=%%a"

echo Server version: !SERVER_VERSION!

REM Compare versions
if "!CURRENT_VERSION!"=="!SERVER_VERSION!" (
    echo Already up to date.
    goto :eof
)

set "UPDATE_AVAILABLE=1"
goto :eof

:download_update
set "UPDATE_SUCCESS=0"
echo.
echo Downloading update...

REM Create temp directory for download
set "TEMP_DIR=%TEMP%\ib_agent_update_%RANDOM%"
mkdir "%TEMP_DIR%" 2>nul

REM Download the new agent zip using API key for authentication
set "ZIP_PATH=%TEMP_DIR%\ib-data-agent-update.zip"
set "UPDATE_URL=https://dr3-dashboard.com/api/ma-options/download-agent-update?key=!IB_PROVIDER_KEY!"
powershell -Command "try { Invoke-WebRequest -Uri '!UPDATE_URL!' -OutFile '%ZIP_PATH%' -TimeoutSec 60 } catch { Write-Host 'Download failed:' $_.Exception.Message }"

if not exist "%ZIP_PATH%" (
    echo ERROR: Failed to download update
    rmdir /s /q "%TEMP_DIR%" 2>nul
    goto :eof
)

REM Check if file is actually a ZIP (not an error page)
for %%A in ("%ZIP_PATH%") do set "ZIP_SIZE=%%~zA"
if !ZIP_SIZE! LSS 1000 (
    echo ERROR: Download failed - received invalid response
    type "%ZIP_PATH%" 2>nul
    rmdir /s /q "%TEMP_DIR%" 2>nul
    goto :eof
)

echo Download complete. Installing update...

REM Extract new files (overwrite existing)
powershell -Command "try { Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%TEMP_DIR%\extracted' -Force } catch { Write-Host 'Extract failed:' $_.Exception.Message; exit 1 }"
if !errorlevel! neq 0 (
    echo ERROR: Failed to extract update
    rmdir /s /q "%TEMP_DIR%" 2>nul
    goto :eof
)

REM Check if extraction created a subfolder
if exist "%TEMP_DIR%\extracted\ib-data-agent" (
    set "EXTRACT_SRC=%TEMP_DIR%\extracted\ib-data-agent"
) else (
    set "EXTRACT_SRC=%TEMP_DIR%\extracted"
)

REM Copy new files to agent directory (but NOT config.env)
for %%f in ("%EXTRACT_SRC%\*") do (
    if /i not "%%~nxf"=="config.env" (
        copy /y "%%f" "%SCRIPT_DIR%" >nul 2>nul
    )
)

REM Copy directories (python_bundle, ibapi, etc.)
if exist "%EXTRACT_SRC%\python_bundle" (
    xcopy /s /e /y /q "%EXTRACT_SRC%\python_bundle" "%SCRIPT_DIR%python_bundle\" >nul 2>nul
)
if exist "%EXTRACT_SRC%\ibapi" (
    xcopy /s /e /y /q "%EXTRACT_SRC%\ibapi" "%SCRIPT_DIR%ibapi\" >nul 2>nul
)

REM Cleanup
rmdir /s /q "%TEMP_DIR%" 2>nul

echo Update installed successfully!
set "UPDATE_SUCCESS=1"
goto :eof
