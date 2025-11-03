# M&A Options Scanner - Windows Setup Guide (TESTED)

**Last Updated:** November 3, 2024
**Tested On:** Windows 11 with Python 3.14.0
**Setup Time:** ~5 minutes

This guide has been battle-tested and includes solutions to all common Windows issues.

---

## What This Does

Powers your M&A arbitrage dashboard at https://ma-tracker-app.vercel.app/ with real-time options data from your Interactive Brokers account.

**Your Setup:**
- Python service (connects to IB Gateway) → Running on your PC
- ngrok tunnel (exposes service to internet) → Running on your PC
- Dashboard (web interface) → Hosted on Vercel

**Daily Effort:** Run one command: `~/start-scanner.sh`

---

## Prerequisites (Install These First)

### 1. Git for Windows

**Why:** Provides Git Bash (a Unix-like terminal) which is required for the setup script.

**Install:**
1. Download: https://git-scm.com/download/win
2. Run installer - **click Next through all options** (defaults are fine)
3. After installation, search for **"Git Bash"** in Start menu

**Test:**
```bash
# Open Git Bash and run:
git --version
```

### 2. Python 3

**Why:** Runs the options scanner service.

**Recommended:** Python 3.11-3.12
**Tested With:** Python 3.14.0 (newer versions work but may show warnings)

**Install:**
1. Download: https://www.python.org/downloads/
2. **CRITICAL:** Check ✅ **"Add Python to PATH"** during installation
3. Click "Install Now"

**Test:**
```bash
# Open Git Bash and run:
python --version
# OR
python3 --version
```

---

## Quick Setup (5 Minutes)

### Step 1: Download the Code

**Open Git Bash** (NOT Command Prompt!) and run these commands **ONE AT A TIME**:

```bash
cd ~
```

```bash
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
```

```bash
cd ma-tracker-app
```

### Step 2: Run Auto-Setup

```bash
bash setup-for-luis.sh
```

**What this does:**
- ✅ Checks Python version (warns if 3.13+, but continues)
- ✅ Auto-detects pip (tries pip3, pip, python -m pip)
- ✅ Installs Python packages
- ✅ Downloads and installs ngrok
- ✅ Creates startup script (`~/start-scanner.sh`)

**Expected output:**
```
✅ Setup Complete!
```

### Step 3: Get ngrok Auth Token (One-Time Only)

1. Sign up (free): https://dashboard.ngrok.com/signup
2. Get your token: https://dashboard.ngrok.com/get-started/your-authtoken
3. Run in Git Bash:

```bash
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### Step 4: Configure IB Gateway/TWS

**You probably already have this configured, but verify:**

1. Open IB Gateway or Trader Workstation
2. Go to: **Settings → API → Settings**
3. Enable: ✅ **"Enable ActiveX and Socket Clients"**
4. Set Port:
   - Paper trading: **7497**
   - Live trading: **7496**
5. Add Trusted IP: **127.0.0.1**
6. Click **OK**

---

## Daily Usage

### Start the Scanner

**Every day, before market opens:**

1. Open **Git Bash**
2. Run:

```bash
~/start-scanner.sh
```

**You'll see:**
```
=========================================
✅ SUCCESS! Scanner is running!
=========================================

Your public URL:
  https://YOUR-UNIQUE-URL.ngrok-free.dev

Keep this terminal open!
Press Ctrl+C to stop the scanner
```

### Update Dashboard (If URL Changed)

**⚠️ IMPORTANT:** ngrok free tier URLs change each time you restart!

If your URL changed, update it at:
https://vercel.com/donkeithross3-commits-projects/ma-tracker-app/settings/environment-variables

1. Set variable: `PYTHON_SERVICE_URL`
2. Set value: `https://YOUR-NEW-URL.ngrok-free.dev`
3. Click **Save**
4. **Redeploy** the site

### Test It Works

Visit your dashboard and try scanning a ticker:
https://ma-tracker-app.vercel.app/

---

## Troubleshooting

### "bash: command not found: git"

**Problem:** Git not installed or not in PATH.

**Solution:**
- Install Git for Windows: https://git-scm.com/download/win
- Make sure you're using **Git Bash**, not Command Prompt

### "Python 3 is not installed"

**Problem:** Python not installed or not in PATH.

**Solution:**
- Reinstall Python
- **CHECK THE BOX:** ✅ "Add Python to PATH"
- Restart Git Bash after installing

### "pip is not installed"

**Problem:** pip not found.

**Solution:**
The setup script auto-detects pip. If it still fails:
```bash
python -m pip install -r python-service/requirements.txt
```

### "ngrok is not authenticated"

**Problem:** Missing ngrok auth token.

**Solution:**
1. Get token: https://dashboard.ngrok.com/get-started/your-authtoken
2. Run: `ngrok config add-authtoken YOUR_TOKEN`

**Windows Store ngrok location:**
If you installed ngrok from Windows Store, config is at:
```
C:\Users\YOUR_USERNAME\AppData\Local\Packages\ngrok.ngrok_XXX\LocalCache\Local\ngrok\ngrok.yml
```

### "Cannot connect to Interactive Brokers"

**Problem:** IB Gateway not running or API not enabled.

**Solution:**
1. Start IB Gateway/TWS
2. Check: Settings → API → Settings
3. Verify: ✅ "Enable ActiveX and Socket Clients"
4. Verify port: 7497 (paper) or 7496 (live)
5. Verify trusted IP: 127.0.0.1

### Scanner Returns "No option data available"

**Problem:** May be outside market hours or no data subscription.

**Solution:**
- Try during market hours (9:30 AM - 4:00 PM ET)
- Verify you have options data subscription in IB account
- Check that IB Gateway is connected and logged in

### "UnicodeEncodeError" or Strange Characters

**Problem:** Windows console encoding issue (FIXED in code).

**Solution:**
- Pull latest code: `git pull origin main`
- All Unicode characters have been removed from output

---

## Known Limitations

### ngrok Free Tier

**URL Changes:** Every time you restart `~/start-scanner.sh`, you get a new ngrok URL.

**Workarounds:**
1. **Keep scanner running** - minimize the terminal window, don't close it
2. **Update Vercel when URL changes** (see "Update Dashboard" above)
3. **Upgrade ngrok** ($8/month) for a permanent URL

**Free Tier Limits:**
- ✅ Unlimited connections
- ✅ HTTPS tunnels
- ❌ URL changes on restart
- ❌ 40 requests/minute (plenty for this use case)

---

## Architecture

```
IB Gateway (Port 7497/7496)
    ↓
Python Scanner (localhost:8000)
    ↓
ngrok Tunnel (https://xxx.ngrok-free.dev)
    ↓
Vercel Dashboard (https://ma-tracker-app.vercel.app)
```

**All on your PC:**
- IB Gateway provides market data
- Python scanner fetches and analyzes options
- ngrok exposes scanner to internet
- Dashboard calls scanner via ngrok URL

---

## Files Reference

- `~/start-scanner.sh` - Daily startup script (created by setup)
- `~/ma-tracker-app/python-service/` - Python scanner code
- `~/ma-tracker-app/python-service/requirements.txt` - Python dependencies
- `~/ma-tracker-app/setup-for-luis.sh` - One-time setup script

---

## Getting Help

**Logs:**
```bash
# Python service log:
tail -f /tmp/scanner.log

# ngrok log:
tail -f /tmp/ngrok.log

# ngrok web interface:
http://localhost:4040
```

**Test scanner directly:**
```bash
# Health check:
curl http://localhost:8000/health

# Test scan:
curl http://localhost:8000/test-scan/AAPL
```

**Stop scanner:**
```bash
# In the terminal where scanner is running:
Press Ctrl+C
```

---

## What We Fixed

Based on real testing, these issues have been resolved:

✅ **Python 3.14 compatibility** - Updated requirements to use >= instead of ==
✅ **Windows path issues** - Changed to Git Bash instead of Command Prompt
✅ **pip detection** - Auto-detects pip3, pip, or python -m pip
✅ **ngrok Windows Store** - Detects both standard and Store installations
✅ **Unicode errors** - Removed ✓/✗ characters that crashed Windows console
✅ **Option strike prices** - Fixed to use $5 increments (255, 260, 265...)
✅ **Missing tick handlers** - Added price and size handlers for options
✅ **ngrok browser warning** - Added skip header to API calls
✅ **Unrealistic test data** - Test endpoint now uses current price + 5% premium

---

## Success Checklist

- [ ] Git Bash opens and shows a prompt
- [ ] `python --version` shows Python 3.9+
- [ ] `pip --version` or `python -m pip --version` works
- [ ] IB Gateway is running with API enabled
- [ ] `~/start-scanner.sh` shows "SUCCESS! Scanner is running!"
- [ ] ngrok URL is displayed
- [ ] Dashboard at https://ma-tracker-app.vercel.app/ loads
- [ ] Options scanner returns data (during market hours)

**Total time from start to finish: ~5 minutes**

---

*This guide was created from actual Windows testing and includes all real issues encountered and fixed.*
