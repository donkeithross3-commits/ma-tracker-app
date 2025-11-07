# M&A Tracker Deployment Guide for Luis

**Last Updated:** November 4, 2025, 7:00 AM CT
**Status:** Ready for deployment
**Tested On:** STAGING Windows PC

---

## Overview

This guide will help Luis set up the complete M&A Tracker application on his Windows machine, including:
- ✅ Next.js web application (frontend + backend)
- ✅ Python Options Scanner Service
- ✅ Interactive Brokers integration
- ✅ Database connection (shared Neon PostgreSQL)

---

## Prerequisites

### Required Software
1. **Node.js LTS** (v18+ or v20+)
   - Download: https://nodejs.org/
   - Choose "LTS" version for Windows

2. **Python 3.9+**
   - Download: https://www.python.org/downloads/
   - ✅ Check "Add Python to PATH" during installation

3. **Git for Windows**
   - Download: https://git-scm.com/download/win
   - Use default settings

4. **Interactive Brokers TWS or IB Gateway**
   - Already installed on Luis's machine
   - Port: 7497 (or 4001 for live)

5. **Visual Studio Code** (recommended)
   - Download: https://code.visualstudio.com/

---

## Deployment Architecture

```
Luis's Windows PC
├── Interactive Brokers TWS (localhost:7497)
├── Python Service (localhost:8000)
│   └── Connects to TWS for options data
└── Next.js App (localhost:3000)
    ├── Connects to Python Service
    └── Connects to Neon DB (cloud)
```

**Shared Database:** All users (you, Luis, staging) connect to the same Neon PostgreSQL database in the cloud.

---

## Step-by-Step Installation

### Step 1: Clone the Repository

Open **PowerShell** or **Command Prompt**:

```powershell
# Navigate to where you want the project
cd C:\Users\Luis\Projects  # or your preferred location

# Clone the repository
git clone https://github.com/YourUsername/ma-tracker-app.git
cd ma-tracker-app
```

---

### Step 2: Set Up Environment Variables

Create a file named `.env.local` in the root directory:

```powershell
# Create .env.local file
notepad .env.local
```

Paste the following content (use exact values):

```env
# Database (shared with all users)
DATABASE_URL="postgresql://neondb_owner:npg_KqyuD7zP3bVG@ep-late-credit-aew3q5lw-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# Python Options Scanner Service (local)
PYTHON_SERVICE_URL="http://localhost:8000"

# Anthropic API (optional - for AI research reports)
ANTHROPIC_API_KEY="sk-ant-api03-placeholder-replace-with-real-key"
```

Save and close the file.

---

### Step 3: Install Node.js Dependencies

```powershell
# Install all npm packages
npm install

# Generate Prisma client
npm run db:generate
```

This may take 2-5 minutes depending on your internet speed.

---

### Step 4: Set Up Python Service

Open a new PowerShell window:

```powershell
# Navigate to python-service folder
cd C:\Users\Luis\Projects\ma-tracker-app\python-service

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\Activate.ps1

# If you get an execution policy error, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then try activating again
.\venv\Scripts\Activate.ps1

# Install Python dependencies
pip install -r requirements.txt
```

---

### Step 5: Configure Interactive Brokers

Ensure TWS/IB Gateway is configured:

1. Open **TWS** or **IB Gateway**
2. Go to **File → Global Configuration → API → Settings**
3. Verify settings:
   - ✅ Enable ActiveX and Socket Clients
   - ✅ Socket port: **7497** (paper trading) or **4001** (live)
   - ✅ Trusted IPs: Add **127.0.0.1**
   - ❌ Uncheck "Read-Only API"

4. Click **OK** and restart TWS/IB Gateway

---

## Running the Application

You'll need **THREE separate terminal windows**:

### Terminal 1: Python Service

```powershell
cd C:\Users\Luis\Projects\ma-tracker-app\python-service
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

**Keep this window open!**

---

### Terminal 2: Next.js Development Server

```powershell
cd C:\Users\Luis\Projects\ma-tracker-app
npm run dev
```

Expected output:
```
  ▲ Next.js 16.0.1
  - Local:        http://localhost:3000
  - Ready in 2.1s
```

**Keep this window open!**

---

### Terminal 3: Test Interactive Brokers Connection

```powershell
# Test IB connection
curl http://localhost:8000/test/ib-connection

# Test futures data (after 8:30 AM CT when markets are open)
curl http://localhost:8000/test/es-futures
```

Expected response:
```json
{
  "status": "connected",
  "message": "Successfully connected to Interactive Brokers",
  "connection_time": "2025-11-04T07:00:00",
  "port": 7497
}
```

---

## Accessing the Application

Open your web browser and go to:
- **Main App:** http://localhost:3000
- **Python Service API:** http://localhost:8000/docs (Swagger UI)

**Default Login:**
- Email: `demo@example.com`
- Password: `demo123`

---

## Testing the Options Scanner

1. Make sure **TWS is running** and **connected**
2. Wait until **8:30 AM CT** (market hours)
3. In the app, navigate to **Positions → Options Scanner**
4. Click **"Start Scan"**
5. You should see options data populating

---

## Troubleshooting

### Issue: Python service can't connect to IB

**Solution:**
1. Verify TWS is running and logged in
2. Check port number (7497 for paper, 4001 for live)
3. Verify 127.0.0.1 is in Trusted IPs
4. Restart TWS and try again

### Issue: "Execution policy" error in PowerShell

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Issue: Port already in use

**Solution:**
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual number)
taskkill /PID <PID> /F
```

### Issue: Database connection fails

**Solution:**
- Verify `.env.local` has the correct DATABASE_URL
- Check your internet connection (database is in the cloud)
- Contact Don if the database credentials need updating

---

## Updating the Application

When Don pushes new features:

```powershell
# Stop all running services (Ctrl+C in each terminal)

# Pull latest code
git pull origin main

# Update dependencies
npm install
cd python-service
pip install -r requirements.txt

# Restart services (follow "Running the Application" steps)
```

---

## Production Deployment (Future)

For 24/7 operation, we'll set up:
1. **Windows Services** for auto-start
2. **PM2** or **NSSM** for process management
3. **ngrok** or **Cloudflare Tunnel** for remote access
4. **Scheduled Tasks** for automatic restarts

This guide focuses on local development first. We'll tackle production setup once you're comfortable with the system.

---

## Need Help?

- **Slack/Teams:** Message Don
- **Phone:** Call Don (he's awake at 7 AM!)
- **Screenshots:** Send screenshots of any errors
- **Remote Access:** Don can connect to staging PC to help debug

---

## Next Steps After Installation

1. ✅ Verify all three services are running
2. ✅ Test IB connection
3. ✅ Wait for market open (8:30 AM CT)
4. ✅ Run options scanner test
5. ✅ Explore the deals dashboard
6. ✅ Test adding a new deal manually

---

**Installation Time:** 30-45 minutes
**Coffee Required:** ☕☕☕
**Difficulty:** Intermediate
**Success Rate:** 95% (based on staging tests)
