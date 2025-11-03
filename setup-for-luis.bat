@echo off
echo ==========================================
echo M&A Options Scanner - Quick Setup
echo ==========================================
echo.

REM Check for Python 3
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 is not installed
    echo.
    echo Please install Python 3 from: https://www.python.org/downloads/
    echo IMPORTANT: Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)
echo [OK] Python found:
python --version

REM Check for pip
pip --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] pip is not installed
    echo.
    echo Please reinstall Python and ensure pip is included
    echo.
    pause
    exit /b 1
)
echo [OK] pip found

echo.
echo ==========================================
echo Step 1/4: Installing Python dependencies...
echo ==========================================
cd python-service
pip install -q -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install Python dependencies
    echo Try manually: pip install -r requirements.txt
    pause
    exit /b 1
)
echo [OK] Python dependencies installed
cd ..

echo.
echo ==========================================
echo Step 2/4: Setting up ngrok...
echo ==========================================
where ngrok >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] ngrok already installed
) else (
    echo.
    echo ngrok needs to be installed manually on Windows:
    echo.
    echo 1. Download from: https://ngrok.com/download
    echo 2. Extract ngrok.exe to a folder
    echo 3. Add that folder to your PATH, or move ngrok.exe to C:\Windows\System32\
    echo.
    echo After installing ngrok, run this script again.
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo Step 3/4: Creating startup script...
echo ==========================================

(
echo @echo off
echo echo Starting M&A Options Scanner...
echo echo.
echo.
echo REM Find the repository directory
echo set REPO_DIR=%CD%
echo.
echo REM Start Python service
echo echo [1/2] Starting Python service...
echo cd "%REPO_DIR%\python-service"
echo start /B python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
echo timeout /t 3 /nobreak ^> nul
echo cd "%REPO_DIR%"
echo.
echo REM Check if Python service is running
echo curl -s http://localhost:8000/health ^> nul 2^>^&1
echo if %%ERRORLEVEL%% == 0 ^(
echo     echo [OK] Python service is healthy
echo ^) else ^(
echo     echo [WARNING] Python service may not be running correctly
echo     echo Check logs if needed
echo ^)
echo.
echo REM Check if ngrok is authenticated
echo ngrok config check ^> nul 2^>^&1
echo if %%ERRORLEVEL%% NEQ 0 ^(
echo     echo.
echo     echo [WARNING] ngrok is not authenticated yet!
echo     echo.
echo     echo Please do this once:
echo     echo 1. Sign up free at: https://dashboard.ngrok.com/signup
echo     echo 2. Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken
echo     echo 3. Run: ngrok config add-authtoken YOUR_TOKEN_HERE
echo     echo.
echo     echo Then run this script again: start-scanner.bat
echo     pause
echo     exit /b 0
echo ^)
echo.
echo REM Start ngrok tunnel
echo echo [2/2] Starting ngrok tunnel...
echo start /B ngrok http 8000
echo timeout /t 3 /nobreak ^> nul
echo.
echo echo ==========================================
echo echo SUCCESS! Scanner is running!
echo echo ==========================================
echo echo.
echo echo Your public URL is available at:
echo echo   http://localhost:4040
echo echo.
echo echo Open that link in your browser to see your ngrok URL
echo echo Share that URL with your team to update Vercel!
echo echo.
echo echo To check status:
echo echo   curl http://localhost:8000/health
echo echo.
echo echo Keep this window open!
echo echo Press Ctrl+C to stop the scanner
echo echo ==========================================
echo echo.
echo pause
) > start-scanner.bat

echo [OK] Startup script created at: start-scanner.bat

echo.
echo ==========================================
echo Step 4/4: Setup Complete!
echo ==========================================
echo.
echo Next steps for Luis:
echo.
echo 1. Start IB Gateway/TWS and configure API:
echo    - Settings -^> API -^> Settings
echo    - Enable 'Enable ActiveX and Socket Clients'
echo    - Port: 7497 (paper^) or 7496 (live^)
echo    - Trusted IPs: Add 127.0.0.1
echo.
echo 2. Get ngrok auth token (one time only^):
echo    - Sign up free: https://dashboard.ngrok.com/signup
echo    - Get token: https://dashboard.ngrok.com/get-started/your-authtoken
echo    - Run: ngrok config add-authtoken YOUR_TOKEN
echo.
echo 3. Start the scanner:
echo    start-scanner.bat
echo.
echo That's it! The script will:
echo   [OK] Start Python service
echo   [OK] Start ngrok tunnel
echo   [OK] Show your public URL
echo.
echo Total time: ~5 minutes
echo ==========================================
echo.
pause
