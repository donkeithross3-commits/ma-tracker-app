# How to Start the AI Agent on Staging PC

**Goal:** Get the remote AI agent running on the Windows staging PC so we can test the deployment remotely.

---

## Option 1: Remote Desktop Access (Recommended)

If you have TeamViewer, AnyDesk, or Windows Remote Desktop access to the staging PC:

### Step 1: Connect to Staging PC

1. Open your remote desktop tool
2. Connect to the staging Windows PC
3. Login with credentials

### Step 2: Locate the AI Agent

The agent was set up last night. It's likely in one of these locations:

```
C:\Projects\ai-agent\
C:\Users\[Username]\ai-agent\
C:\staging\ai-agent\
```

Or search for the agent files:
```powershell
# Search for the agent
cd C:\
dir agent*.py /s

# Or search for recently modified Python files
Get-ChildItem -Path C:\ -Filter "*.py" -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.Name -like "*agent*"} | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

### Step 3: Start the Agent

Once you find the agent directory:

```powershell
cd C:\Path\To\AI-Agent

# If there's a virtual environment
.\venv\Scripts\Activate.ps1

# Start the agent (adjust filename as needed)
python agent-service.py --port 8001

# OR if it's a different file
python main.py --port 8001
python app.py --port 8001
```

### Step 4: Verify It's Running

In another PowerShell window:

```powershell
# Check if port 8001 is listening
netstat -an | findstr :8001

# Test locally
curl http://localhost:8001/health
```

### Step 5: Test from Your Mac

Back on your Mac:

```bash
curl https://charissa-gesticulatory-grovelingly.ngrok-free.dev/health
```

You should get a response (not an HTML error page)!

---

## Option 2: Create the Agent (If Not Found)

If the agent doesn't exist or we can't find it, we can quickly recreate it:

### Quick Agent Service

Create a file `C:\staging\agent-service.py`:

```python
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import subprocess
import os
from typing import Optional

app = FastAPI(title="Windows Remote Agent")

API_KEY = "<YOUR_STAGING_AGENT_API_KEY>"

class CommandRequest(BaseModel):
    command: str
    timeout: int = 120

def verify_api_key(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

@app.get("/health")
def health():
    return {"status": "healthy", "agent": "staging-windows"}

@app.post("/execute")
def execute_command(
    request: CommandRequest,
    authorization: str = Header(None)
):
    verify_api_key(authorization)

    try:
        result = subprocess.run(
            ["powershell", "-Command", request.command],
            capture_output=True,
            text=True,
            timeout=request.timeout,
            shell=True
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Command timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

### Install Dependencies

```powershell
pip install fastapi uvicorn pydantic
```

### Run the Agent

```powershell
python C:\staging\agent-service.py
```

### Verify ngrok is Pointing to Port 8001

```powershell
# Check ngrok config
ngrok config check

# If ngrok isn't running, start it
ngrok http 8001
```

---

## Option 3: Check if ngrok is Pointing to Wrong Port

Maybe the agent IS running but on a different port:

### Check What's Running

```powershell
# Check all Python processes
Get-Process python

# Check what ports are in use
netstat -an | findstr LISTENING

# Check common ports
curl http://localhost:8000/health
curl http://localhost:8001/health
curl http://localhost:3000/health
curl http://localhost:5000/health
```

### Update ngrok to Point to the Right Port

If the agent is running on port 8000 (for example):

```powershell
# Stop ngrok
taskkill /F /IM ngrok.exe

# Start ngrok pointing to the correct port
ngrok http 8000
```

You'll get a new URL - update the STAGING_AGENT_URL in .env.local!

---

## Option 4: Use Task Agent to Start It

If we have some way to execute commands remotely (even if the health endpoint isn't working), we can try using a Task agent to start the service.

---

## Troubleshooting

### Agent Won't Start

**Error:** "Port already in use"
```powershell
# Find what's using port 8001
netstat -ano | findstr :8001

# Kill the process (replace PID)
taskkill /PID <PID> /F
```

**Error:** "Module not found"
```powershell
# Install required packages
pip install fastapi uvicorn pydantic
```

**Error:** "Permission denied"
```powershell
# Run PowerShell as Administrator
```

### ngrok Issues

**Error:** "ngrok not found"
```powershell
# Download ngrok
# https://ngrok.com/download

# Add to PATH or run from download folder
```

**Error:** "Session expired"
```powershell
# Login to ngrok
ngrok config add-authtoken YOUR_TOKEN

# Restart tunnel
ngrok http 8001
```

---

## Once Agent is Running

Run this from your Mac to verify:

```bash
# Test health endpoint
curl https://charissa-gesticulatory-grovelingly.ngrok-free.dev/health

# Expected response:
# {"status":"healthy","agent":"staging-windows"}

# Test command execution
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer <YOUR_STAGING_AGENT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"command": "node --version"}'

# Expected response:
# {"success":true,"stdout":"v20.x.x\n","stderr":"","returncode":0}
```

If those work, we're ready to run the full deployment test! 🎉

---

## Next Steps After Agent is Running

1. Check prerequisites on staging
2. Test git clone/pull
3. Run the installation script
4. Verify services start
5. Document any Windows-specific issues

See **STAGING_TEST_PLAN.md** for the full test procedure.
