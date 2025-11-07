# M&A Tracker - Windows Installation Script
# Run this script in PowerShell as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "M&A Tracker - Windows Installation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "⚠️  This script should be run as Administrator" -ForegroundColor Yellow
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to continue anyway or Ctrl+C to exit"
}

# Function to check if command exists
function Test-CommandExists {
    param($command)
    try {
        if (Get-Command $command -ErrorAction Stop) {
            return $true
        }
    }
    catch {
        return $false
    }
}

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
if (Test-CommandExists node) {
    $nodeVersion = node --version
    Write-Host "✅ Node.js is installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "❌ Node.js is NOT installed" -ForegroundColor Red
    Write-Host "Please download and install Node.js LTS from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check npm
Write-Host "Checking npm..." -ForegroundColor Yellow
if (Test-CommandExists npm) {
    $npmVersion = npm --version
    Write-Host "✅ npm is installed: $npmVersion" -ForegroundColor Green
} else {
    Write-Host "❌ npm is NOT installed" -ForegroundColor Red
    exit 1
}

# Check Python
Write-Host "Checking Python..." -ForegroundColor Yellow
if (Test-CommandExists python) {
    $pythonVersion = python --version
    Write-Host "✅ Python is installed: $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "❌ Python is NOT installed" -ForegroundColor Red
    Write-Host "Please download and install Python 3.9+ from: https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "Make sure to check 'Add Python to PATH' during installation" -ForegroundColor Yellow
    exit 1
}

# Check Git
Write-Host "Checking Git..." -ForegroundColor Yellow
if (Test-CommandExists git) {
    $gitVersion = git --version
    Write-Host "✅ Git is installed: $gitVersion" -ForegroundColor Green
} else {
    Write-Host "❌ Git is NOT installed" -ForegroundColor Red
    Write-Host "Please download and install Git from: https://git-scm.com/download/win" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "All prerequisites are installed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get current directory
$projectRoot = Get-Location

# Create .env.local if it doesn't exist
if (-not (Test-Path ".env.local")) {
    Write-Host "Creating .env.local file..." -ForegroundColor Yellow

    $envContent = @"
# Database (shared with all users)
DATABASE_URL="postgresql://neondb_owner:npg_KqyuD7zP3bVG@ep-late-credit-aew3q5lw-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# Python Options Scanner Service (local)
PYTHON_SERVICE_URL="http://localhost:8000"

# Anthropic API (optional - for AI research reports)
ANTHROPIC_API_KEY="sk-ant-api03-placeholder-replace-with-real-key"
"@

    Set-Content -Path ".env.local" -Value $envContent
    Write-Host "✅ Created .env.local" -ForegroundColor Green
} else {
    Write-Host "✅ .env.local already exists" -ForegroundColor Green
}

# Install Node.js dependencies
Write-Host ""
Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
Write-Host "(This may take 2-5 minutes)" -ForegroundColor Gray
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Node.js dependencies installed" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to install Node.js dependencies" -ForegroundColor Red
    exit 1
}

# Generate Prisma client
Write-Host ""
Write-Host "Generating Prisma client..." -ForegroundColor Yellow
npm run db:generate

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Prisma client generated" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to generate Prisma client" -ForegroundColor Red
    exit 1
}

# Set up Python virtual environment
Write-Host ""
Write-Host "Setting up Python virtual environment..." -ForegroundColor Yellow

if (-not (Test-Path "python-service\venv")) {
    Push-Location python-service

    python -m venv venv

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Python virtual environment created" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to create virtual environment" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    # Activate and install requirements
    Write-Host "Installing Python dependencies..." -ForegroundColor Yellow

    .\venv\Scripts\Activate.ps1
    pip install -r requirements.txt

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Python dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to install Python dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    Pop-Location
} else {
    Write-Host "✅ Python virtual environment already exists" -ForegroundColor Green
}

# Create convenience scripts
Write-Host ""
Write-Host "Creating startup scripts..." -ForegroundColor Yellow

# Start Python Service script
$startPythonContent = @"
@echo off
echo Starting Python Options Scanner Service...
cd python-service
call venv\Scripts\activate.bat
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
"@
Set-Content -Path "start-python-service.bat" -Value $startPythonContent

# Start Next.js script
$startNextContent = @"
@echo off
echo Starting Next.js Development Server...
npm run dev
pause
"@
Set-Content -Path "start-nextjs.bat" -Value $startNextContent

# Start All Services script
$startAllContent = @"
@echo off
echo =========================================
echo Starting M&A Tracker Application
echo =========================================
echo.
echo Starting Python Service...
start "Python Service" cmd /k "cd python-service && venv\Scripts\activate.bat && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 3 /nobreak
echo.
echo Starting Next.js App...
start "Next.js App" cmd /k "npm run dev"
echo.
echo =========================================
echo All services started!
echo =========================================
echo.
echo - Python Service: http://localhost:8000
echo - Next.js App: http://localhost:3000
echo.
echo Press any key to close this window (services will keep running)
pause
"@
Set-Content -Path "start-all-services.bat" -Value $startAllContent

Write-Host "✅ Startup scripts created" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Installation Complete! ✅" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Make sure Interactive Brokers TWS is running" -ForegroundColor White
Write-Host "   - Port: 7497 (paper trading)" -ForegroundColor Gray
Write-Host "   - Enable API in Settings" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Double-click 'start-all-services.bat' to run everything" -ForegroundColor White
Write-Host ""
Write-Host "3. Open browser to http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "OR run services separately:" -ForegroundColor Yellow
Write-Host "   - start-python-service.bat (for Python service only)" -ForegroundColor Gray
Write-Host "   - start-nextjs.bat (for Next.js app only)" -ForegroundColor Gray
Write-Host ""
Write-Host "Default Login:" -ForegroundColor Yellow
Write-Host "   Email: demo@example.com" -ForegroundColor Gray
Write-Host "   Password: demo123" -ForegroundColor Gray
Write-Host ""
Write-Host "For help, see DEPLOY_LUIS.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
