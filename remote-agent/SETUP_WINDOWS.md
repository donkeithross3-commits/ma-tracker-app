# Remote AI Agent - Windows Setup

Setup instructions for installing the Remote AI Agent on STAGING PC (Windows).

## Prerequisites

- Python 3.9+ installed
- Git installed
- Anaconda/Python environment

## Installation Steps

### 1. Clone Repository (if not already done)

```powershell
cd C:\Users\[YourUsername]\
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
cd ma-tracker-app\remote-agent
```

### 2. Create Virtual Environment

```powershell
# Using conda (recommended if Anaconda installed)
conda create -n remote-agent python=3.9
conda activate remote-agent

# OR using venv
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3. Install Dependencies

```powershell
pip install -r requirements.txt
```

### 4. Configure Environment Variables

```powershell
# Copy example env file
copy .env.example .env

# Edit .env file with your settings
notepad .env
```

**Required settings:**
```
ANTHROPIC_API_KEY=sk-ant-api03-...  # Your Anthropic API key
REMOTE_AGENT_API_KEY=your-secure-key-here  # Generate a secure key
REMOTE_AGENT_PORT=8001
```

**Generate secure API key:**
```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 5. Test the Agent

```powershell
# Start the agent
python main.py
```

You should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8001
```

### 6. Test Health Check

Open browser or use curl:
```
http://localhost:8001/health
```

Should return:
```json
{"status": "healthy", "timestamp": "..."}
```

## Running as Windows Service (Optional)

For production use, run as a Windows service so it starts automatically.

### Option A: Using NSSM (Non-Sucking Service Manager)

```powershell
# Download NSSM from https://nssm.cc/download
# Extract to C:\nssm

# Install as service
C:\nssm\nssm.exe install RemoteAgent

# Configure in GUI:
# - Path: C:\Users\[YourUsername]\anaconda3\envs\remote-agent\python.exe
# - Startup directory: C:\Users\[YourUsername]\ma-tracker-app\remote-agent
# - Arguments: main.py

# Start service
net start RemoteAgent
```

### Option B: Using Task Scheduler

Create a task that runs on startup:

```powershell
# Create scheduled task
schtasks /create /tn "RemoteAgent" /tr "C:\Users\[YourUsername]\ma-tracker-app\remote-agent\start-agent.bat" /sc onstart /ru SYSTEM
```

## Connecting to Mac DEV Environment

### 1. Expose via ngrok

```powershell
# Start ngrok tunnel (if not already running)
ngrok http 8001
```

Copy the ngrok URL (e.g., `https://abc123.ngrok-free.dev`)

### 2. Update Mac Environment

On Mac DEV, create `.env.local`:
```
STAGING_AGENT_URL=https://abc123.ngrok-free.dev
STAGING_AGENT_API_KEY=your-secure-key-here
```

## Testing from Mac

On Mac DEV:

```bash
# Test connection
curl https://abc123.ngrok-free.dev/health

# Test task execution (dry run)
curl -X POST https://abc123.ngrok-free.dev/execute-task \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secure-key-here" \
  -d '{
    "instruction": "Check if Python service is running",
    "dry_run": true
  }'
```

## Troubleshooting

### Agent won't start

**Error: `ModuleNotFoundError: No module named 'anthropic'`**
- Solution: `pip install -r requirements.txt`

**Error: `ANTHROPIC_API_KEY not configured`**
- Solution: Create `.env` file with your API key

### Can't connect from Mac

**Error: Connection refused**
- Check if agent is running: `tasklist | findstr python`
- Check if port 8001 is listening: `netstat -ano | findstr :8001`
- Verify firewall allows port 8001

**Error: ngrok tunnel closed**
- Restart ngrok: `ngrok http 8001`
- Update Mac .env with new ngrok URL

### Commands failing

**Error: "Forbidden pattern detected"**
- The command contains a dangerous pattern
- Check `FORBIDDEN_PATTERNS` in `main.py`
- Modify instruction to use safer approach

**Error: "Command timed out"**
- Command took longer than 30 seconds
- Check system resources
- Modify timeout in `execute_command()` if needed

## Logs

Agent logs are written to `remote-agent.log` in the same directory.

View recent logs:
```powershell
# View last 50 lines
Get-Content remote-agent.log -Tail 50

# Follow logs in real-time
Get-Content remote-agent.log -Wait
```

Or via API:
```
http://localhost:8001/logs?lines=100
```

## Security Notes

1. **API Key**: Keep `REMOTE_AGENT_API_KEY` secret. Don't commit to git.
2. **Firewall**: Only expose via ngrok, don't open port 8001 to internet directly
3. **Allowed Operations**: Review `ALLOWED_OPERATIONS` in `main.py`
4. **Command Whitelist**: All commands are validated before execution
5. **Logging**: All executed commands are logged for audit trail

## Updating the Agent

```powershell
cd C:\Users\[YourUsername]\ma-tracker-app
git pull origin main
cd remote-agent

# Restart agent
# If running manually: Ctrl+C then python main.py
# If running as service: net stop RemoteAgent && net start RemoteAgent
```

## Support

For issues:
1. Check logs: `remote-agent.log`
2. Test health endpoint: `http://localhost:8001/health`
3. Verify API key is set correctly
4. Check GitHub issues
