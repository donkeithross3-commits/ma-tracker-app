@echo off
REM M&A Tracker - Production Setup Script for Windows
REM This script automates the entire setup process

echo ========================================
echo M&A Tracker - Production Setup
echo ========================================
echo.

REM Check if running as Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo WARNING: Not running as Administrator
    echo Some operations may fail. Consider running as Admin.
    echo.
    pause
)

REM Step 1: Verify Python version
echo [1/10] Checking Python version...
python --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Python not found in PATH
    echo Please install Python 3.11 or 3.12 from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Python version: %PYTHON_VERSION%

REM Extract major.minor version
for /f "tokens=1,2 delims=." %%a in ("%PYTHON_VERSION%") do (
    set PYTHON_MAJOR=%%a
    set PYTHON_MINOR=%%b
)

if %PYTHON_MAJOR% lss 3 (
    echo ERROR: Python 3.11 or higher required
    pause
    exit /b 1
)

if %PYTHON_MAJOR% equ 3 if %PYTHON_MINOR% lss 11 (
    echo ERROR: Python 3.11 or higher required
    pause
    exit /b 1
)

if %PYTHON_MAJOR% equ 3 if %PYTHON_MINOR% geq 14 (
    echo ERROR: Python 3.14+ not supported. Please install Python 3.12 or 3.11
    pause
    exit /b 1
)

echo OK: Python %PYTHON_VERSION% is compatible
echo.

REM Step 2: Verify Node.js version
echo [2/10] Checking Node.js version...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%i in ('node --version') do set NODE_VERSION=%%i
echo Node.js version: %NODE_VERSION%

for /f "tokens=1 delims=." %%a in ("%NODE_VERSION%") do set NODE_MAJOR=%%a

if %NODE_MAJOR% lss 20 (
    echo ERROR: Node.js 20.x or higher required
    pause
    exit /b 1
)

echo OK: Node.js %NODE_VERSION% is compatible
echo.

REM Step 3: Install Python dependencies
echo [3/10] Installing Python dependencies...
cd python-service
python -m pip install -r requirements.txt --quiet
if %errorLevel% neq 0 (
    echo ERROR: Failed to install Python dependencies
    echo Try running: pip install -r requirements.txt
    pause
    exit /b 1
)
cd ..
echo OK: Python dependencies installed
echo.

REM Step 4: Install Node.js dependencies
echo [4/10] Installing Node.js dependencies...
call npm install --silent
if %errorLevel% neq 0 (
    echo ERROR: Failed to install Node.js dependencies
    pause
    exit /b 1
)
echo OK: Node.js dependencies installed
echo.

REM Step 5: Configure environment variables
echo [5/10] Configuring environment variables...
echo.
echo You will now be prompted for configuration values.
echo These will be saved to .env files (NOT committed to git).
echo.

REM Check if .env files already exist
if exist python-service\.env (
    echo Found existing python-service/.env
    set /p OVERWRITE_BACKEND="Overwrite? (y/n): "
    if /i not "%OVERWRITE_BACKEND%"=="y" goto SKIP_BACKEND_ENV
)

echo.
echo === Backend Configuration (python-service/.env) ===
echo.

set /p DATABASE_URL="Enter DATABASE_URL (from Neon.tech): "
set /p ANTHROPIC_API_KEY="Enter ANTHROPIC_API_KEY (from console.anthropic.com): "
set /p SENDGRID_API_KEY="Enter SENDGRID_API_KEY (optional, press Enter to skip): "

(
echo # Database
echo DATABASE_URL=%DATABASE_URL%
echo.
echo # AI Services
echo ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%
if not "%SENDGRID_API_KEY%"=="" (
    echo.
    echo # Email ^(optional^)
    echo SENDGRID_API_KEY=%SENDGRID_API_KEY%
)
) > python-service\.env

echo OK: Created python-service/.env
echo.

:SKIP_BACKEND_ENV

if exist .env (
    echo Found existing .env in root
    set /p OVERWRITE_FRONTEND="Overwrite? (y/n): "
    if /i not "%OVERWRITE_FRONTEND%"=="y" goto SKIP_FRONTEND_ENV
)

echo === Frontend Configuration (root .env) ===
echo.

REM Generate random AUTH_SECRET if not provided
set /p AUTH_SECRET="Enter AUTH_SECRET (or press Enter to auto-generate): "
if "%AUTH_SECRET%"=="" (
    REM Generate random 32-character string
    set AUTH_SECRET=prod-%RANDOM%-%RANDOM%-%RANDOM%-%RANDOM%-secret
    echo Generated AUTH_SECRET: %AUTH_SECRET%
)

(
echo # Database ^(same as python-service/.env^)
echo DATABASE_URL=%DATABASE_URL%
echo.
echo # Authentication
echo AUTH_SECRET=%AUTH_SECRET%
echo NEXTAUTH_URL=http://localhost:3000
echo.
echo # Backend API
echo PYTHON_SERVICE_URL=http://localhost:8000
) > .env

echo OK: Created .env in root
echo.

:SKIP_FRONTEND_ENV

REM Step 6: Generate Prisma Client
echo [6/10] Generating Prisma client...
call npm run db:generate >nul 2>&1
if %errorLevel% neq 0 (
    echo WARNING: Prisma generation failed. This may be okay if database isn't accessible yet.
) else (
    echo OK: Prisma client generated
)
echo.

REM Step 7: Test database connection
echo [7/10] Testing database connection...
cd python-service
python -c "import os; from dotenv import load_dotenv; load_dotenv('.env'); print('DATABASE_URL loaded:', os.getenv('DATABASE_URL')[:50] + '...')" 2>nul
if %errorLevel% neq 0 (
    echo WARNING: Could not verify database connection
) else (
    echo OK: Environment variables loaded
)
cd ..
echo.

REM Step 8: Build Next.js for production
echo [8/10] Building Next.js application...
echo This may take a few minutes...
call npm run build
if %errorLevel% neq 0 (
    echo WARNING: Build failed. You can still use development mode.
    echo Run 'npm run dev' instead of 'npm run start'
) else (
    echo OK: Production build complete
)
echo.

REM Step 9: Create production start/stop scripts
echo [9/10] Creating start/stop scripts...

REM Create start script
(
echo @echo off
echo echo Starting M&A Tracker ^(Production Mode^)...
echo echo.
echo if not exist logs mkdir logs
echo.
echo echo Starting Python backend...
echo start /B cmd /c "cd python-service && python start_server.py > ..\\logs\\python-backend.log 2>&1"
echo.
echo timeout /t 3 /nobreak ^>nul
echo.
echo echo Starting Next.js frontend ^(production^)...
echo start /B cmd /c "npm run start > logs\\nextjs-frontend.log 2>&1"
echo.
echo echo.
echo echo ========================================
echo echo Services started!
echo echo ========================================
echo echo Frontend: http://localhost:3000
echo echo Backend: http://localhost:8000
echo echo.
echo echo Logs:
echo echo - Backend: logs\\python-backend.log
echo echo - Frontend: logs\\nextjs-frontend.log
echo echo.
echo echo To stop: run stop-production.bat
echo echo ========================================
) > start-production.bat

REM Create stop script
(
echo @echo off
echo echo Stopping M&A Tracker...
echo taskkill /F /IM python.exe 2^>nul
echo taskkill /F /IM node.exe 2^>nul
echo echo Services stopped
) > stop-production.bat

echo OK: Created start-production.bat and stop-production.bat
echo.

REM Step 10: Final summary
echo [10/10] Setup complete!
echo.
echo ========================================
echo Setup Summary
echo ========================================
echo Python version: %PYTHON_VERSION%
echo Node.js version: v%NODE_VERSION%
echo Database: Configured
echo Environment files: Created
echo.
echo Next steps:
echo 1. Start the application: start-production.bat
echo 2. Open in browser: http://localhost:3000
echo 3. Check logs if issues: type logs\\python-backend.log
echo.
echo For detailed documentation, see:
echo - PRODUCTION_DEPLOY.md
echo - SETUP.md
echo ========================================
echo.
pause
