# Staging Quick Start (PC)

**Last Updated**: 2025-11-15
**Commit**: fd13400

## Step 1: Clone Repository (First Time Only)

```powershell
# Open PowerShell as regular user (not admin)
cd C:\
mkdir Projects
cd Projects

# Clone the repo
git clone https://github.com/YOUR_USERNAME/ma-tracker-app.git
cd ma-tracker-app
```

## Step 2: Verify Prerequisites

```powershell
# Check versions
git --version        # Should see git version
node --version       # Should see v18+
npm --version        # Should see 9+
python --version     # Should see 3.9+
pip --version        # Should see pip 20+
```

**If any are missing, install from:**
- Git: https://git-scm.com/download/win
- Node.js: https://nodejs.org/ (use LTS version)
- Python: https://www.python.org/downloads/ (check "Add to PATH")

## Step 3: Backend Setup

```powershell
cd C:\Projects\ma-tracker-app\python-service

# Create virtual environment
python -m venv venv

# Activate it (PowerShell)
.\venv\Scripts\Activate.ps1

# If you get execution policy error, run:
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install dependencies
pip install -r requirements.txt
```

### Create .env File

Create `python-service\.env` with:
```
DATABASE_URL=postgresql://YOUR_CONNECTION_STRING_HERE
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
SENDGRID_API_KEY=SG.YOUR_KEY_HERE
```

**Get these from Mac** - They're in `/Users/donaldross/ma-tracker-app/python-service/.env`

### Test Backend

```powershell
# Should validate env and start on port 8000
python start_server.py
```

Keep this terminal open. You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

## Step 4: Frontend Setup (New Terminal)

Open a **second PowerShell window**:

```powershell
cd C:\Projects\ma-tracker-app

# Install dependencies
npm install

# Start dev server
npm run dev
```

You should see:
```
- ready started server on 0.0.0.0:3000
```

## Step 5: Quick Validation

Open browser to: **http://localhost:3000**

You should see the M&A Tracker homepage.

### API Test

Open third terminal:
```powershell
curl http://localhost:8000/health
# Should return: {"status":"healthy"}

curl http://localhost:8000/edgar/staged-deals?status=pending
# Should return JSON array
```

## Step 6: Start Monitors (Optional)

If you want to test the intelligence platform:

```powershell
# EDGAR monitor
curl -X POST http://localhost:8000/edgar/monitoring/start

# Intelligence monitors
curl -X POST http://localhost:8000/intelligence/monitoring/start

# Check status
curl http://localhost:8000/edgar/monitoring/status
```

## Common Issues

### Port Already in Use

```powershell
# Find what's using port 8000
netstat -ano | findstr :8000
# Kill it (use PID from output)
taskkill /PID <PID> /F
```

### Python Command Not Found

Try `python3` instead of `python`, or reinstall Python with "Add to PATH" checked.

### Cannot Run PowerShell Scripts

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Module Not Found Errors

Make sure virtual environment is activated:
```powershell
.\venv\Scripts\Activate.ps1
# Prompt should show (venv) at the start
pip install -r requirements.txt
```

## Success Criteria

- [ ] Backend running on port 8000
- [ ] Frontend running on port 3000
- [ ] Homepage loads in browser
- [ ] `/health` endpoint returns healthy
- [ ] No errors in terminal outputs

## Next Steps

Once running, test the key features:
1. Navigate to http://localhost:3000/staging
2. Check intelligence deals display
3. Verify date formatting (two lines, published + detected)
4. Check sort order (newest first)
5. Navigate to rumored deals page

Report any issues you find!

## Full Documentation

See `STAGING_DEPLOYMENT.md` for complete guide with troubleshooting.
