# IB Data Agent - PowerShell Starter
# ==================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "IB Data Agent" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load config.env if it exists
$configPath = Join-Path $ScriptDir "config.env"
if (Test-Path $configPath) {
    Write-Host "Loading config.env..."
    Get-Content $configPath | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            if ($name -and $value) {
                Set-Item -Path "env:$name" -Value $value
            }
        }
    }
    Write-Host ""
} else {
    Write-Host "ERROR: config.env not found" -ForegroundColor Red
    Write-Host "Please re-download the agent from the MA Tracker web app."
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if API key is set
if (-not $env:IB_PROVIDER_KEY -or $env:IB_PROVIDER_KEY -eq "your-api-key-here") {
    Write-Host "ERROR: API key not configured" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please re-download the agent from the MA Tracker web app"
    Write-Host "to get a pre-configured version with your API key."
    Read-Host "Press Enter to exit"
    exit 1
}

# Set defaults if not configured (IB_MODE=live -> 7496, paper -> 7497)
if (-not $env:IB_HOST) { $env:IB_HOST = "127.0.0.1" }
if (-not $env:IB_PORT) {
    if ($env:IB_MODE -eq "live") { $env:IB_PORT = "7496" } else { $env:IB_PORT = "7497" }
}
if (-not $env:RELAY_URL) { $env:RELAY_URL = "wss://dr3-dashboard.com/ws/data-provider" }

Write-Host "IB TWS:    $($env:IB_HOST):$($env:IB_PORT)"
Write-Host "Relay URL: $($env:RELAY_URL)"
Write-Host ""

# ============================================
# Option 1: Check for standalone executable
# ============================================
$exePath = Join-Path $ScriptDir "ib_data_agent.exe"
if (Test-Path $exePath) {
    Write-Host "Starting IB Data Agent [standalone exe]..." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop"
    Write-Host "============================================"
    Write-Host ""
    & $exePath
    exit 0
}

# ============================================
# Option 2: Check for bundled Python
# ============================================
$bundledPython = Join-Path $ScriptDir "python_bundle\python.exe"
if (Test-Path $bundledPython) {
    Write-Host "Using bundled Python [no install required]" -ForegroundColor Green
    & $bundledPython --version
    Write-Host ""
    Write-Host "Starting IB Data Agent..." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop"
    Write-Host "============================================"
    Write-Host ""
    
    $runAgentPath = Join-Path $ScriptDir "run_agent.py"
    & $bundledPython $runAgentPath
    exit 0
}

# ============================================
# Option 3: Check for system Python
# ============================================
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "ERROR: Python not found" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "The IB Data Agent requires Python to run, but no bundled"
    Write-Host "Python was found and no system Python is available."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  1. Re-download the agent (should include bundled Python)"
    Write-Host "  2. Install Python manually:"
    Write-Host "     - Go to https://www.python.org/downloads/"
    Write-Host "     - Download Python 3.11 (recommended)"
    Write-Host "     - IMPORTANT: Check 'Add Python to PATH' during installation"
    Write-Host "     - Restart this script after installation"
    Read-Host "Press Enter to exit"
    exit 1
}

# Check Python version (need 3.8+)
$version = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$versionParts = $version -split '\.'
if ([int]$versionParts[0] -lt 3 -or ([int]$versionParts[0] -eq 3 -and [int]$versionParts[1] -lt 8)) {
    Write-Host "ERROR: Python 3.8 or newer is required" -ForegroundColor Red
    Write-Host "Found: Python $version"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Using system Python" -ForegroundColor Green
Write-Host "Python $version"

# Install dependencies if needed
Write-Host "Checking dependencies..." -ForegroundColor Yellow
$reqPath = Join-Path $ScriptDir "requirements.txt"
if (Test-Path $reqPath) {
    # Check if websockets is installed
    $wsCheck = python -c "import websockets" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing required packages..." -ForegroundColor Yellow
        python -m pip install --quiet --disable-pip-version-check -r $reqPath
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
            Write-Host "Try running: python -m pip install websockets"
            Read-Host "Press Enter to exit"
            exit 1
        }
        Write-Host "Dependencies installed." -ForegroundColor Green
    } else {
        Write-Host "Dependencies OK." -ForegroundColor Green
    }
}
Write-Host ""

Write-Host "Starting IB Data Agent..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop"
Write-Host "============================================"
Write-Host ""

# Run the agent (run_agent.py exec's into agent for clean Ctrl+C exit)
$runAgentPath = Join-Path $ScriptDir "run_agent.py"
python $runAgentPath
