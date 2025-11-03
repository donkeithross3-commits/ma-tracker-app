# Quick Start for Luis (5 Minutes!)

## Super Simple Setup

Just run these commands. That's it!

---

## Step 0: Prerequisites (2 minutes - if needed)

Make sure you have these installed:

### Check if you have them:
```bash
git --version
python3 --version
```

### If you need to install:

**Windows - IMPORTANT:**

When you install Git for Windows, you get "Git Bash" - a terminal that lets you run the commands in this guide. After installing Git, search for **"Git Bash"** in your Start menu and use that (not Command Prompt).

1. **Install Git for Windows**: https://git-scm.com/download/win
   - Just click Next through all the options - defaults are fine!

2. **Install Python 3**: https://www.python.org/downloads/
   - ⚠️ **IMPORTANT**: Check "Add Python to PATH" during installation

After installation, open **Git Bash** (not Command Prompt) to run the commands below.

**Mac:**
```bash
# Option 1: Xcode Command Line Tools (includes git)
xcode-select --install

# Option 2: Homebrew (installs both)
brew install git python3
```

**Linux:**
```bash
sudo apt-get install git python3 python3-pip
```

---

## Step 1: Get the Code (1 minute)

**Windows**: Open "Git Bash" from Start menu
**Mac/Linux**: Open Terminal

Then copy-paste these commands **ONE AT A TIME** (press Enter after each):

```bash
cd ~
```

```bash
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
```

```bash
cd ma-tracker-app
```

**⚠️ IMPORTANT**: Copy each command separately, one at a time. Don't copy-paste multiple lines at once.

---

## Step 2: Run Setup Script (2 minutes)

```bash
bash setup-for-luis.sh
```

**Note**: Make sure you're in Git Bash (not Command Prompt) if on Windows!

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
   ngrok config add-authtoken YOUR_TOKEN_HERE
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

## Connecting Your Dashboard

After running `~/start-scanner.sh`, you'll see a URL like:
```
https://abc123.ngrok-free.app
```

This URL connects your IB Gateway to your dashboard at https://ma-tracker-app.vercel.app/

**Optional**: If you want your team to leverage your data, send this URL to them so they can update the Vercel configuration.

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
**Your benefit**: Your 5-year M&A strategy now has a full dashboard with real-time IB data!
**Optional benefit**: Team can leverage your data if you choose to share

Simple as that. No complex cloud setup, no VMs, no hassle.
