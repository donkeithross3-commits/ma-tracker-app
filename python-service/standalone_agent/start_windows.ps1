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
}

# Check if API key is set
if (-not $env:IB_PROVIDER_KEY) {
    Write-Host "ERROR: IB_PROVIDER_KEY is not set" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please edit config.env and add your API key:"
    Write-Host "IB_PROVIDER_KEY=your-api-key-here"
    Write-Host ""
    Write-Host "Get your API key from the MA Tracker web app."
    Read-Host "Press Enter to exit"
    exit 1
}

# Set defaults if not configured
if (-not $env:IB_HOST) { $env:IB_HOST = "127.0.0.1" }
if (-not $env:IB_PORT) { $env:IB_PORT = "7497" }
if (-not $env:RELAY_URL) { $env:RELAY_URL = "wss://dr3-dashboard.com/ws/data-provider" }

Write-Host "Starting IB Data Agent..." -ForegroundColor Green
Write-Host ""
Write-Host "IB TWS:    $($env:IB_HOST):$($env:IB_PORT)"
Write-Host "Relay URL: $($env:RELAY_URL)"
Write-Host ""
Write-Host "Press Ctrl+C to stop"
Write-Host "============================================"
Write-Host ""

# Run the agent
$agentPath = Join-Path $ScriptDir "ib_data_agent.py"
python $agentPath

Write-Host ""
Write-Host "Agent stopped."
Read-Host "Press Enter to exit"
