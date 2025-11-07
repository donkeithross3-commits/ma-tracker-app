@echo off
REM M&A Tracker - Automated Installer for Windows
REM This script installs all prerequisites and sets up the application

echo ========================================
echo M&A Tracker - Automated Installer
echo ========================================
echo.
echo This will install:
echo   - Node.js (if not installed)
echo   - Python (if not installed)
echo   - Git (if not installed)
echo   - Application dependencies
echo.
echo Estimated time: 15-20 minutes
echo.
pause

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running as administrator
) else (
    echo [WARNING] Not running as administrator
    echo Some installations may fail without admin rights
    echo.
    echo Right-click this file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Step 1: Checking Prerequisites
echo ========================================
echo.

REM Check for winget
winget --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Windows Package Manager (winget) is not available
    echo Please update Windows to version 1809 or later
    echo.
    pause
    exit /b 1
)
echo [OK] Windows Package Manager available

echo.
echo ========================================
echo Step 2: Installing Node.js
echo ========================================
echo.

node --version >nul 2>&1
if %errorLevel% == 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo [OK] Node.js is already installed: %NODE_VERSION%
) else (
    echo [INSTALL] Installing Node.js LTS...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to install Node.js
        pause
        exit /b 1
    )
    echo [OK] Node.js installed successfully
    echo [INFO] Refreshing environment variables...
    REM Refresh PATH
    call refreshenv.cmd >nul 2>&1
)

echo.
echo ========================================
echo Step 3: Installing Python
echo ========================================
echo.

python --version >nul 2>&1
if %errorLevel% == 0 (
    for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
    echo [OK] Python is already installed: %PYTHON_VERSION%
) else (
    echo [INSTALL] Installing Python 3.12...
    winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to install Python
        pause
        exit /b 1
    )
    echo [OK] Python installed successfully
    echo [INFO] Refreshing environment variables...
    call refreshenv.cmd >nul 2>&1
)

echo.
echo ========================================
echo Step 4: Installing Git
echo ========================================
echo.

git --version >nul 2>&1
if %errorLevel% == 0 (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VERSION=%%i
    echo [OK] Git is already installed: %GIT_VERSION%
) else (
    echo [INSTALL] Installing Git...
    winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to install Git
        pause
        exit /b 1
    )
    echo [OK] Git installed successfully
    echo [INFO] Refreshing environment variables...
    call refreshenv.cmd >nul 2>&1
)

echo.
echo ========================================
echo Step 5: Verifying Installations
echo ========================================
echo.

REM Final verification
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not available. Please restart your terminal and try again.
    pause
    exit /b 1
)

python --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Python is not available. Please restart your terminal and try again.
    pause
    exit /b 1
)

git --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Git is not available. Please restart your terminal and try again.
    pause
    exit /b 1
)

echo [OK] All prerequisites verified!

echo.
echo ========================================
echo Step 6: Installing Node.js Dependencies
echo ========================================
echo.

if not exist "package.json" (
    echo [ERROR] package.json not found. Make sure you're in the ma-tracker-app directory.
    pause
    exit /b 1
)

echo [INSTALL] Installing Node.js packages (this may take 5-10 minutes)...
call npm install
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install Node.js packages
    pause
    exit /b 1
)
echo [OK] Node.js packages installed

echo.
echo ========================================
echo Step 7: Generating Prisma Client
echo ========================================
echo.

echo [GENERATE] Generating database client...
call npm run db:generate
if %errorLevel% neq 0 (
    echo [ERROR] Failed to generate Prisma client
    pause
    exit /b 1
)
echo [OK] Database client generated

echo.
echo ========================================
echo Step 8: Installing Python Dependencies
echo ========================================
echo.

if not exist "python-service" (
    echo [ERROR] python-service directory not found
    pause
    exit /b 1
)

cd python-service

echo [SETUP] Creating Python virtual environment...
python -m venv venv
if %errorLevel% neq 0 (
    echo [ERROR] Failed to create virtual environment
    cd ..
    pause
    exit /b 1
)
echo [OK] Virtual environment created

echo [ACTIVATE] Activating virtual environment...
call venv\Scripts\activate.bat

echo [INSTALL] Installing Python packages...
pip install --upgrade pip
pip install -r requirements.txt
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install Python packages
    cd ..
    pause
    exit /b 1
)
echo [OK] Python packages installed

cd ..

echo.
echo ========================================
echo Step 9: Creating Configuration Files
echo ========================================
echo.

REM Create .env.local if it doesn't exist
if not exist ".env.local" (
    echo [CREATE] Creating .env.local file...
    (
        echo # Database Configuration
        echo DATABASE_URL="postgresql://neondb_owner:npg_KqyuD7zP3bVG@ep-late-credit-aew3q5lw-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"
        echo.
        echo # NextAuth Configuration
        echo NEXTAUTH_URL="http://localhost:3000"
        echo NEXTAUTH_SECRET="demo-secret-key-change-in-production"
        echo.
        echo # Python Service Configuration
        echo PYTHON_SERVICE_URL="http://localhost:8000"
        echo.
        echo # Optional: Anthropic API Key ^(for AI features^)
        echo ANTHROPIC_API_KEY="sk-ant-api03-placeholder-replace-with-real-key"
    ) > .env.local
    echo [OK] .env.local created
) else (
    echo [OK] .env.local already exists
)

echo.
echo ========================================
echo Step 10: Creating Startup Scripts
echo ========================================
echo.

REM Create start-python-service.bat
echo [CREATE] Creating start-python-service.bat...
(
    echo @echo off
    echo title M^&A Tracker - Python Service
    echo cd python-service
    echo call venv\Scripts\activate.bat
    echo echo Starting Python service on port 8000...
    echo python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    echo pause
) > start-python-service.bat
echo [OK] start-python-service.bat created

REM Create start-nextjs.bat
echo [CREATE] Creating start-nextjs.bat...
(
    echo @echo off
    echo title M^&A Tracker - Next.js Web App
    echo echo Starting Next.js on port 3000...
    echo call npm run dev
    echo pause
) > start-nextjs.bat
echo [OK] start-nextjs.bat created

REM Create start-all-services.bat
echo [CREATE] Creating start-all-services.bat...
(
    echo @echo off
    echo title M^&A Tracker - Service Launcher
    echo echo Starting M^&A Tracker Services...
    echo echo.
    echo echo [1/2] Starting Python service...
    echo start "Python Service" cmd /c start-python-service.bat
    echo timeout /t 3 /nobreak ^>nul
    echo.
    echo echo [2/2] Starting Next.js web app...
    echo start "Next.js App" cmd /c start-nextjs.bat
    echo.
    echo echo.
    echo echo ========================================
    echo echo Services are starting!
    echo echo ========================================
    echo echo.
    echo echo Python Service: http://localhost:8000
    echo echo Web Application: http://localhost:3000
    echo echo.
    echo echo Wait 30-60 seconds for services to start,
    echo echo then open http://localhost:3000 in your browser
    echo echo.
    echo echo Login credentials:
    echo echo   Email: demo@example.com
    echo echo   Password: demo123
    echo echo.
    echo echo Keep the service windows open while using the app.
    echo echo Close this window when done.
    echo echo.
    echo pause
) > start-all-services.bat
echo [OK] start-all-services.bat created

echo.
echo ========================================
echo Installation Complete! ✓
echo ========================================
echo.
echo Next steps:
echo   1. Make sure TWS is running and configured
echo      - Enable API in TWS settings
echo      - Port 7497 (paper) or 7496 (live)
echo      - Add 127.0.0.1 to trusted IPs
echo.
echo   2. Double-click: start-all-services.bat
echo.
echo   3. Wait 30-60 seconds for services to start
echo.
echo   4. Open browser to: http://localhost:3000
echo.
echo   5. Login with:
echo      Email: demo@example.com
echo      Password: demo123
echo.
echo Installation log saved to: installation.log
echo.
echo ========================================
echo.
pause
