# IB Data Agent - PowerShell Starter
# ==================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "IB Data Agent" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if Python is available
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "ERROR: Python not found in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Python 3.9 or newer from:"
    Write-Host "https://www.python.org/downloads/"
    Write-Host ""
    Write-Host "Make sure to check 'Add Python to PATH' during installation."
    Read-Host "Press Enter to exit"
    exit 1
}

# Check Python version
$version = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$versionParts = $version -split '\.'
if ([int]$versionParts[0] -lt 3 -or ([int]$versionParts[0] -eq 3 -and [int]$versionParts[1] -lt 9)) {
    Write-Host "ERROR: Python 3.9 or newer is required" -ForegroundColor Red
    Write-Host "Found: Python $version"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Python $version detected" -ForegroundColor Green

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

# Set defaults if not configured
if (-not $env:IB_HOST) { $env:IB_HOST = "127.0.0.1" }
if (-not $env:IB_PORT) { $env:IB_PORT = "7497" }
if (-not $env:RELAY_URL) { $env:RELAY_URL = "wss://dr3-dashboard.com/ws/data-provider" }

Write-Host "IB TWS:    $($env:IB_HOST):$($env:IB_PORT)"
Write-Host "Relay URL: $($env:RELAY_URL)"
Write-Host ""

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

# Run the agent
$agentPath = Join-Path $ScriptDir "ib_data_agent.py"
python $agentPath

Write-Host ""
Write-Host "Agent stopped."
Read-Host "Press Enter to exit"
