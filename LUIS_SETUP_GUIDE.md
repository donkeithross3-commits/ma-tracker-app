# Setup Guide for Luis's Machine (IB Gateway + Python Service)

## Overview

This is Luis's M&A arbitrage dashboard - a trading strategy he's been running for 5 years. Luis will run the Python service on his machine alongside IB Gateway to power his dashboard at https://ma-tracker-app.vercel.app/ with his premium IB market data subscriptions. Team members can optionally leverage his data if he chooses to share.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Team Members (Web Browsers)                             │
│   ↓                                                      │
│ Next.js App (Vercel)                                    │
│ https://ma-tracker-6xtep91ya-don-ross-projects...      │
│   ↓ HTTPS API Calls                                     │
│ Cloudflare Tunnel (Public URL)                          │
│   ↓                                                      │
│ Luis's Machine                                          │
│   ├── IB Gateway (with best market data subscriptions) │
│   └── Python FastAPI Service (localhost:8000)          │
└─────────────────────────────────────────────────────────┘
```

**Benefits**:
- ✅ Luis's entire M&A dashboard powered by his premium IB subscriptions
- ✅ Real-time market data for deal analysis and options scanning
- ✅ Luis controls when service runs
- ✅ Team can optionally leverage his data via web app (no setup needed for them)
- ✅ Secure tunnel (no port forwarding needed)

---

## Prerequisites for Luis

Before starting, Luis needs:

1. **IB Gateway or TWS installed** ✅ (Already has)
2. **Python 3.9 or higher** (Check: `python3 --version`)
3. **Git installed** (To clone the repository)
4. **30 minutes for setup** (One-time)

---

## Part 1: Initial Setup (One-Time)

### Step 1: Clone the Repository

Luis needs to get the code on his machine:

```bash
# Choose a location (e.g., Documents)
cd ~/Documents

# Clone the repository
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git

# Navigate to Python service
cd ma-tracker-app/python-service
```

### Step 2: Install Python Dependencies

```bash
# Install required packages
pip3 install -r requirements.txt
```

**Expected output**: Should install FastAPI, uvicorn, pandas, numpy, scipy, ibapi

**If Luis gets errors**:
- **Mac**: May need Xcode Command Line Tools: `xcode-select --install`
- **Windows**: May need Microsoft C++ Build Tools
- **Permission errors**: Try `pip3 install --user -r requirements.txt`

### Step 3: Configure IB Gateway

Luis should configure IB Gateway for API access:

1. **Launch IB Gateway** (or TWS)
2. **Go to**: Settings → API → Settings
3. **Enable**:
   - ✅ "Enable ActiveX and Socket Clients"
   - ✅ "Allow connections from localhost only" (for security)
4. **Set Socket Port**:
   - Paper trading: **7497**
   - Live trading: **7496**
5. **Trusted IP Addresses**: Add `127.0.0.1`
6. **Click**: OK
7. **Restart IB Gateway** for changes to take effect

### Step 4: Test Python Service Locally

```bash
# From the python-service directory
cd ~/Documents/ma-tracker-app/python-service

# Start the service
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Expected output**:
```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 5: Verify IB Connection

Open a new terminal and test:

```bash
curl http://localhost:8000/health
```

**Expected output**:
```json
{
  "status": "healthy",
  "ib_connected": true    ← Should be true!
}
```

**If `ib_connected` is false**:
- Make sure IB Gateway is running
- Verify API settings are enabled
- Check port is 7497 (or 7496 for live)
- Restart IB Gateway

### Step 6: Test a Scan

```bash
curl -X POST http://localhost:8000/scan \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "MSFT",
    "deal_price": 380.00,
    "expected_close_date": "2025-06-30",
    "confidence": 0.75
  }'
```

**Expected**: Should return option opportunities (if market is open) or error if market is closed.

**Success!** The Python service is working on Luis's machine. Now let's expose it to the internet.

---

## Part 2: Expose Service to Internet (Cloudflare Tunnel)

We'll use Cloudflare Tunnel because it's:
- ✅ **Free**
- ✅ **Secure** (no port forwarding)
- ✅ **Persistent URL** (doesn't change)
- ✅ **Works behind firewalls**
- ✅ **No router configuration needed**

### Step 1: Install Cloudflare Tunnel

**For Mac**:
```bash
# Download cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64 -o cloudflared

# Make executable
chmod +x cloudflared

# Move to system path
sudo mv cloudflared /usr/local/bin/
```

**For Windows**:
Download from: https://github.com/cloudflare/cloudflared/releases/latest
Install the `.msi` file

**For Linux**:
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This will:
1. Open a browser
2. Ask Luis to log in to Cloudflare (free account)
3. Authorize the tunnel
4. Download credentials to `~/.cloudflared/`

**If Luis doesn't have a Cloudflare account**:
- Sign up free at: https://dash.cloudflare.com/sign-up
- No domain or website needed!

### Step 3: Create a Tunnel

```bash
# Create tunnel named "ma-options-scanner"
cloudflared tunnel create ma-options-scanner
```

**Output will show**:
```
Tunnel credentials written to: ~/.cloudflared/UUID.json
Created tunnel ma-options-scanner with id UUID
```

**Important**: Save the tunnel ID (UUID) shown

### Step 4: Configure the Tunnel

Create configuration file:

```bash
# Create config directory if it doesn't exist
mkdir -p ~/.cloudflared

# Create/edit config file
nano ~/.cloudflared/config.yml
```

**Paste this configuration**:
```yaml
tunnel: ma-options-scanner
credentials-file: /Users/luis/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: ma-scanner.YOUR_NAME.workers.dev
    service: http://localhost:8000
  - service: http_status:404
```

**Replace**:
- `YOUR_TUNNEL_ID` with the UUID from Step 3
- `YOUR_NAME` with any unique name (e.g., "luis-options" or "ma-tracker-prod")
- `/Users/luis/` with Luis's actual home directory path

**For Windows**, the path would be: `C:\Users\Luis\.cloudflared\UUID.json`

**Save and exit**: Ctrl+O, Enter, Ctrl+X (in nano)

### Step 5: Route DNS (Get Public URL)

```bash
cloudflared tunnel route dns ma-options-scanner ma-scanner.YOUR_NAME.workers.dev
```

**Replace** `YOUR_NAME` with the same name from Step 4.

**This creates a public URL**: `https://ma-scanner.YOUR_NAME.workers.dev`

### Step 6: Test the Tunnel

```bash
# Start the tunnel
cloudflared tunnel run ma-options-scanner
```

**Expected output**:
```
Registered tunnel connection
```

**From another machine** (or phone), test:
```bash
curl https://ma-scanner.YOUR_NAME.workers.dev/health
```

**Should return**:
```json
{"status":"healthy","ib_connected":true}
```

**Success!** Luis's Python service is now accessible from anywhere!

---

## Part 3: Run Service on Startup (Recommended)

So Luis doesn't have to manually start everything:

### Option A: macOS Launch Agent (Recommended for Mac)

Create a launch agent to start both services automatically:

```bash
# Create launch agent directory
mkdir -p ~/Library/LaunchAgents

# Create service file
nano ~/Library/LaunchAgents/com.matracker.options-scanner.plist
```

**Paste this**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.matracker.options-scanner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>-m</string>
        <string>uvicorn</string>
        <string>app.main:app</string>
        <string>--host</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>8000</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/luis/Documents/ma-tracker-app/python-service</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/options-scanner.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/options-scanner-error.log</string>
</dict>
</plist>
```

**Adjust paths** for Luis's system!

**Load the service**:
```bash
launchctl load ~/Library/LaunchAgents/com.matracker.options-scanner.plist
```

**Similarly for Cloudflare tunnel**:
```bash
nano ~/Library/LaunchAgents/com.matracker.cloudflared.plist
```

**Paste**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.matracker.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>ma-options-scanner</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cloudflared-error.log</string>
</dict>
</plist>
```

**Load it**:
```bash
launchctl load ~/Library/LaunchAgents/com.matracker.cloudflared.plist
```

Now both services start automatically when Luis logs in!

### Option B: Simple Startup Script (Any OS)

Create a startup script:

```bash
# Create script
nano ~/start-options-scanner.sh
```

**Paste**:
```bash
#!/bin/bash

# Start Python service
cd ~/Documents/ma-tracker-app/python-service
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# Wait a moment
sleep 3

# Start Cloudflare tunnel
cloudflared tunnel run ma-options-scanner &

echo "Options scanner services started!"
echo "Python service: http://localhost:8000"
echo "Public URL: https://ma-scanner.YOUR_NAME.workers.dev"
```

**Make executable**:
```bash
chmod +x ~/start-options-scanner.sh
```

**To start both services**:
```bash
~/start-options-scanner.sh
```

**Add to login items** (Mac):
System Preferences → Users & Groups → Login Items → Add `start-options-scanner.sh`

---

## Part 4: Update Vercel Environment Variable

Once Luis has the tunnel running and you have the public URL:

```bash
# From your machine (not Luis's)
cd /Users/donaldross/ma-tracker-app

# Add the environment variable
vercel env add PYTHON_SERVICE_URL production

# When prompted, enter:
https://ma-scanner.YOUR_NAME.workers.dev
```

**Redeploy**:
```bash
vercel --prod
```

**That's it!** The production app now connects to Luis's machine.

---

## Daily Operation for Luis

### Starting Everything (If Not Auto-Starting)

**Option 1 - Using startup script**:
```bash
~/start-options-scanner.sh
```

**Option 2 - Manual**:
```bash
# Terminal 1: Start Python service
cd ~/Documents/ma-tracker-app/python-service
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2: Start Cloudflare tunnel
cloudflared tunnel run ma-options-scanner
```

### Checking Status

```bash
# Check if Python service is running
curl http://localhost:8000/health

# Check if tunnel is running
curl https://ma-scanner.YOUR_NAME.workers.dev/health
```

### Viewing Logs

**Python service logs**:
```bash
tail -f /tmp/options-scanner.log
```

**Cloudflare tunnel logs**:
```bash
tail -f /tmp/cloudflared.log
```

### Stopping Services

**If using launch agents**:
```bash
launchctl unload ~/Library/LaunchAgents/com.matracker.options-scanner.plist
launchctl unload ~/Library/LaunchAgents/com.matracker.cloudflared.plist
```

**If running manually**:
```bash
# Find and kill Python service
lsof -ti :8000 | xargs kill -9

# Find and kill cloudflared
pkill cloudflared
```

---

## Troubleshooting

### Python Service Won't Start

**Check Python version**:
```bash
python3 --version  # Need 3.9+
```

**Check if port 8000 is in use**:
```bash
lsof -i :8000
# If something is using it:
lsof -ti :8000 | xargs kill -9
```

**Reinstall dependencies**:
```bash
cd ~/Documents/ma-tracker-app/python-service
pip3 install --upgrade -r requirements.txt
```

### IB Gateway Not Connecting

1. **Verify IB Gateway is running**
2. **Check API settings** are enabled
3. **Confirm port**: 7497 (paper) or 7496 (live)
4. **Check credentials**: Luis's IB account must be logged in
5. **Restart IB Gateway**

### Cloudflare Tunnel Issues

**Tunnel won't start**:
```bash
# Check if cloudflared is installed
which cloudflared

# Check tunnel exists
cloudflared tunnel list

# Recreate if needed
cloudflared tunnel delete ma-options-scanner
cloudflared tunnel create ma-options-scanner
```

**Can't access public URL**:
```bash
# Check tunnel is running
ps aux | grep cloudflared

# Test locally first
curl http://localhost:8000/health

# Then test tunnel
curl https://ma-scanner.YOUR_NAME.workers.dev/health
```

### Market Data Issues

**If scans fail with data errors**:
1. Verify Luis's IB account has market data subscriptions
2. Check if market is open
3. Try a different ticker
4. Check IB Gateway logs

---

## Security Considerations

### Recommended Security Measures

1. **Firewall**: Cloudflare tunnel handles this (no ports open)
2. **HTTPS**: Automatically enabled by Cloudflare
3. **Authentication**: Currently none on Python API

### Optional: Add API Key Authentication

If you want to secure the Python API, I can help add:
- API key authentication
- Rate limiting
- IP allowlisting

---

## Monitoring

### Health Check Endpoint

Anyone can check if Luis's service is running:

```bash
curl https://ma-scanner.YOUR_NAME.workers.dev/health
```

**Response**:
```json
{
  "status": "healthy",
  "ib_connected": true  ← Most important!
}
```

### Setting Up Monitoring (Optional)

**UptimeRobot** (free):
1. Sign up at https://uptimerobot.com
2. Add monitor for: `https://ma-scanner.YOUR_NAME.workers.dev/health`
3. Get email/SMS alerts if service goes down

---

## Cost Summary

Everything is **FREE**:
- ✅ Cloudflare Tunnel: Free
- ✅ Python/FastAPI: Free
- ✅ Git repository: Free
- ✅ Vercel hosting: Free tier (already using)

**Only cost**: Luis's IB account market data subscriptions (already paying)

---

## Support for Luis

### Quick Reference Commands

```bash
# Start services (if using script)
~/start-options-scanner.sh

# Check Python service
curl http://localhost:8000/health

# Check public tunnel
curl https://ma-scanner.YOUR_NAME.workers.dev/health

# View Python logs
tail -f /tmp/options-scanner.log

# View tunnel logs
tail -f /tmp/cloudflared.log

# Stop services
launchctl unload ~/Library/LaunchAgents/com.matracker.*.plist
```

### Who to Contact

**For setup issues**: Contact team (they have full documentation)
**For IB account issues**: Contact Interactive Brokers
**For Cloudflare issues**: Check https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

---

## What Happens Next

Once Luis completes this setup:

1. **Luis's machine** runs Python service + IB Gateway
2. **Cloudflare tunnel** exposes service to internet
3. **Vercel app** connects to tunnel URL at https://ma-tracker-app.vercel.app/
4. **Luis's M&A dashboard** powered by his premium IB subscriptions
5. **Team members** can optionally leverage Luis's data if he chooses to share

**This is Luis's M&A arbitrage dashboard - a strategy he's been running for 5 years!**

---

## Summary for Luis

**Time investment**: 30 minutes one-time setup
**Daily effort**: Optionally start IB Gateway (if not auto-starting)
**Benefit to you**: Your entire M&A dashboard powered by your premium IB data
**Optional benefit**: Team can leverage your data if you choose to share

**Services to keep running**:
1. IB Gateway (for market data)
2. Python service (runs automatically if configured)
3. Cloudflare tunnel (runs automatically if configured)

**Luis can check everything is working**:
```bash
curl http://localhost:8000/health
# Should show: "ib_connected": true
```

That's it! Once set up, it runs automatically and requires minimal maintenance.
