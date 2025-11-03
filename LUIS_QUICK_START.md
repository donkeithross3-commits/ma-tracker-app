# Quick Start for Luis (5 Minutes!)

## Super Simple Setup

Just run these commands. That's it!

---

## Step 1: Get the Code (1 minute)

```bash
cd ~/Documents
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
cd ma-tracker-app
```

---

## Step 2: Run Setup Script (2 minutes)

```bash
chmod +x setup-for-luis.sh
./setup-for-luis.sh
```

This automatically:
- ✅ Installs Python dependencies
- ✅ Downloads ngrok
- ✅ Creates startup script
- ✅ Tells you what to do next

---

## Step 3: Get ngrok Token (1 minute - ONE TIME ONLY)

1. Go to: https://dashboard.ngrok.com/signup
2. Sign up (free, takes 30 seconds)
3. Copy your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken
4. Run:
   ```bash
   ~/bin/ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

**That's it for setup!** You never have to do this again.

---

## Step 4: Configure IB Gateway (1 minute)

You probably already know this, but just in case:

1. Open IB Gateway (or TWS)
2. Go to: **Settings → API → Settings**
3. Check these boxes:
   - ✅ Enable ActiveX and Socket Clients
   - ✅ Port: **7497** (paper) or **7496** (live)
   - ✅ Trusted IPs: Add **127.0.0.1**
4. Click **OK**

---

## Done! Now Just Start It

Every time you want to run the scanner:

```bash
~/start-scanner.sh
```

**That's it!** The script will:
1. Start the Python service
2. Start ngrok tunnel
3. Show you the public URL

**Example output**:
```
==========================================
✅ SUCCESS! Scanner is running!
==========================================

Your public URL:
  https://abc123.ngrok-free.app

Share this URL with your team to update Vercel!
==========================================
```

---

## What to Share With Team

After running `~/start-scanner.sh`, you'll see a URL like:
```
https://abc123.ngrok-free.app
```

**Send this URL** to the team. They'll add it to Vercel and everyone can use the scanner!

---

## Daily Use

### Starting the Scanner

```bash
# 1. Start IB Gateway (if not already running)
# 2. Run:
~/start-scanner.sh
```

Keep the terminal open. You'll see logs.

### Checking Status

```bash
# In a new terminal:
curl http://localhost:8000/health
```

Should show:
```json
{"status":"healthy","ib_connected":true}
```

### Stopping the Scanner

Press **Ctrl+C** in the terminal running `start-scanner.sh`

Or:
```bash
pkill -f uvicorn
pkill ngrok
```

---

## Troubleshooting

### "Python dependencies failed"
```bash
cd ~/Documents/ma-tracker-app/python-service
pip3 install -r requirements.txt
```

### "ngrok not authenticated"
You forgot step 3! Get your token from https://dashboard.ngrok.com/get-started/your-authtoken

### "IB not connected"
- Make sure IB Gateway is running
- Check API settings are enabled (Step 4)
- Verify port is 7497 (paper) or 7496 (live)

### "Can't find repository"
Update the path in `~/start-scanner.sh`:
```bash
nano ~/start-scanner.sh
# Change REPO_DIR to wherever you cloned the repo
```

---

## That's It!

**Total time**: ~5 minutes
**Daily effort**: Run one command
**Team benefit**: Everyone gets your superior market data!

Simple as that. No complex cloud setup, no VMs, no hassle.
