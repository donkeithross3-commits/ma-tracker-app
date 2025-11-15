# Staging Deployment Guide

**Environment:** Windows PC
**Purpose:** User acceptance testing and validation before production
**Created:** 2025-11-15

---

## Overview

This guide covers deploying the M&A Tracker application to the staging environment (Windows PC) for hands-on testing.

### Environment Architecture

- **Development (Mac)**: `/Users/donaldross/ma-tracker-app` - Active development, frequent changes
- **Staging (PC)**: TBD path - Testing and validation before production
- **Production**: Vercel (frontend) + Local backend (for IB Gateway)

### Shared Resources

- **Database**: Neon PostgreSQL (shared across all environments)
  - Consider separate schemas in future: `dev`, `staging`, `prod`
  - Currently all environments use same tables

---

## Prerequisites

### System Requirements (Windows PC)

1. **Git**
   - Install Git for Windows: https://git-scm.com/download/win
   - Verify: `git --version`

2. **Node.js (v18+)**
   - Install from: https://nodejs.org/
   - Verify: `node --version` and `npm --version`

3. **Python (3.9+)**
   - Install from: https://www.python.org/downloads/
   - Ensure "Add to PATH" is checked during installation
   - Verify: `python --version` or `python3 --version`

4. **pip (Python package manager)**
   - Usually included with Python
   - Verify: `pip --version`

5. **Port Availability**
   - Port 3000: Next.js frontend
   - Port 8000: FastAPI backend
   - Ensure no other services using these ports

### Required Credentials

You'll need access to:
- GitHub repository (for git clone/pull)
- Neon PostgreSQL connection string
- Anthropic API key
- (Optional) SendGrid API key for email notifications

---

## Initial Setup (First-Time Deployment)

### Step 1: Clone Repository

```powershell
# Navigate to desired location (e.g., C:\Projects)
cd C:\Projects

# Clone the repository
git clone https://github.com/YOUR_USERNAME/ma-tracker-app.git
cd ma-tracker-app

# Verify you're on main branch
git branch
```

### Step 2: Backend Setup (Python/FastAPI)

```powershell
# Navigate to Python service
cd python-service

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1
# On Windows Command Prompt:
.\venv\Scripts\activate.bat

# Install dependencies
pip install -r requirements.txt

# Create .env file
# Copy .env.example or create manually:
```

Create `python-service/.env`:
```
DATABASE_URL=postgresql://[username]:[password]@[host]/[database]
ANTHROPIC_API_KEY=sk-ant-...
SENDGRID_API_KEY=SG...  # Optional
```

**Important**: Use the same DATABASE_URL as development (shared Neon instance).

```powershell
# Verify environment variables
python start_server.py
# Should validate env vars and start uvicorn on port 8000
```

### Step 3: Frontend Setup (Next.js)

Open a **new terminal/PowerShell window**:

```powershell
# Navigate to project root
cd C:\Projects\ma-tracker-app

# Install Node dependencies
npm install

# Create .env.local (optional, defaults work)
# Create file with:
NEXT_PUBLIC_API_URL=http://localhost:8000

# Start development server
npm run dev
# Should start on port 3000
```

### Step 4: Verify Services

1. **Backend health check**:
   ```powershell
   curl http://localhost:8000/health
   # Should return: {"status":"healthy"}
   ```

2. **Frontend**:
   - Open browser: http://localhost:3000
   - Should see M&A Tracker homepage

3. **Database connectivity**:
   ```powershell
   curl http://localhost:8000/edgar/staged-deals?status=pending
   # Should return JSON array (empty or with staged deals)
   ```

---

## Updating Staging (Subsequent Deployments)

When new changes are pushed to GitHub from dev (Mac):

### Step 1: Pull Latest Changes

```powershell
cd C:\Projects\ma-tracker-app

# Ensure no local uncommitted changes
git status

# Pull latest from main
git pull origin main
```

### Step 2: Update Dependencies

```powershell
# Backend dependencies (if requirements.txt changed)
cd python-service
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend dependencies (if package.json changed)
cd ..
npm install
```

### Step 3: Database Migrations

Check `python-service/migrations/` for new migration files:

```powershell
# List migrations
dir python-service\migrations

# Apply new migrations (requires psql or Python script)
# Option 1: Using psql (if installed)
psql $env:DATABASE_URL -f python-service\migrations\021_new_migration.sql

# Option 2: Using Python asyncpg (create helper script if needed)
```

**Note**: Migrations are already applied in shared database from dev environment. Only needed if you have separate staging schema.

### Step 4: Restart Services

```powershell
# Stop services (Ctrl+C in each terminal)

# Backend terminal:
cd C:\Projects\ma-tracker-app\python-service
.\venv\Scripts\Activate.ps1
python start_server.py

# Frontend terminal:
cd C:\Projects\ma-tracker-app
npm run dev
```

---

## Service Management

### Starting All Services

**Backend** (Terminal 1):
```powershell
cd C:\Projects\ma-tracker-app\python-service
.\venv\Scripts\Activate.ps1
python start_server.py
```

**Frontend** (Terminal 2):
```powershell
cd C:\Projects\ma-tracker-app
npm run dev
```

### Stopping Services

- Press `Ctrl+C` in each terminal window
- Or close the terminal windows

### Viewing Logs

**Backend logs**:
```powershell
# If logs directory exists
type logs\python-backend.log

# Or check terminal output directly
```

**Frontend logs**:
- Check terminal output
- Or `logs\nextjs-frontend.log` if logging to file

### Background Monitors

These must be manually started via API:

1. **EDGAR Monitor** (polls SEC.gov every 60s):
   ```powershell
   curl -X POST http://localhost:8000/edgar/monitoring/start
   ```

2. **Intelligence Monitors** (Reuters, FTC, etc.):
   ```powershell
   curl -X POST http://localhost:8000/intelligence/monitoring/start
   ```

3. **Research Worker** (AI-powered deal analysis):
   ```powershell
   curl -X POST http://localhost:8000/edgar/research-worker/start
   ```

Check status:
```powershell
curl http://localhost:8000/edgar/monitoring/status
curl http://localhost:8000/intelligence/monitoring/status
```

Stop monitors:
```powershell
curl -X POST http://localhost:8000/edgar/monitoring/stop
curl -X POST http://localhost:8000/intelligence/monitoring/stop
```

---

## Testing Checklist

### Core Functionality Tests

- [ ] **Homepage loads** (http://localhost:3000)
- [ ] **Staging page displays** (http://localhost:3000/staging)
  - [ ] Staged deals table loads
  - [ ] Intelligence deals table loads
  - [ ] Date formatting is compact (two-line)
  - [ ] Sort order is newest first
- [ ] **Rumored deals page** (http://localhost:3000/rumored-deals)
  - [ ] Deals load correctly
  - [ ] Published date + detected date both show
  - [ ] Formatting matches EDGAR side
- [ ] **EDGAR page** (http://localhost:3000/edgar)
  - [ ] Recent filings display
  - [ ] Can create staged deals from filings

### Backend API Tests

```powershell
# Health check
curl http://localhost:8000/health

# Get staged deals
curl http://localhost:8000/edgar/staged-deals?status=pending

# Get intelligence deals
curl http://localhost:8000/intelligence/deals

# Get rumored deals
curl http://localhost:8000/intelligence/deals?tier=watchlist

# Trading halts
curl http://localhost:8000/halts
```

### Intelligence Platform Tests

- [ ] **Start EDGAR monitor**
  - Verify it polls SEC.gov
  - Check logs for "Monitoring cycle complete"
- [ ] **Start Intelligence monitors**
  - Verify Reuters/FTC/GlobeNewswire sources fetch
  - Check for new deals created
- [ ] **Approve staged deal**
  - Create or use existing pending staged deal
  - Approve via API or UI
  - Verify appears in intelligence deals
- [ ] **Research Worker**
  - Start worker
  - Verify AI analysis runs on approved deals
  - Check for research reports generated

### Options Scanner (Requires Market Hours + IB Gateway)

**Note**: Can only test Monday-Friday during market hours when IB Gateway is running.

- [ ] **IB Gateway running** (if applicable on PC)
- [ ] **Scan endpoint works**:
  ```powershell
  curl -X POST http://localhost:8000/scan -H "Content-Type: application/json" -d '{\"ticker\":\"EA\",\"deal_price\":210.0,\"expected_close_date\":\"2026-09-30\",\"dividend_before_close\":0.0,\"ctr_value\":0.0,\"confidence\":0.75,\"days_before_close\":0}'
  ```
- [ ] **Results include option strategies**
- [ ] **UI scanner component displays results**

---

## Known Issues & Limitations

### Shared Database

All environments (dev, staging, production) currently share the same Neon PostgreSQL database.

**Implications**:
- Changes in dev affect staging/prod
- Test data mixes with production data
- No true isolation between environments

**Future improvement**: Implement separate schemas or databases per environment.

### Options Scanner

- **Status**: Reported as broken in some functionality
- **Blocker**: Cannot test without market data (weekdays only)
- **Files**: `python-service/app/scanner.py`, `components/options-scanner.tsx`
- **Action**: Debug during market hours with IB Gateway connected

### Test Coverage

- **Status**: Minimal automated tests
- **Current**: 1 Jest test file (`app/api/deals/prepare/route.test.ts`)
- **Needed**: Pytest for Python backend, more Jest tests for frontend
- **See**: `TESTING_PLAN.md` for roadmap

---

## Rollback Procedure

If deployment causes issues:

### Option 1: Roll Back Git

```powershell
# View recent commits
git log --oneline -10

# Roll back to previous commit
git reset --hard <commit-hash>

# Restart services
```

### Option 2: Revert to Last Working Version

```powershell
# Create backup branch
git branch staging-backup

# Checkout specific working commit
git checkout <working-commit-hash>

# Restart services
```

### Option 3: Stop Services

If critical issues:
```powershell
# Stop all services (Ctrl+C)

# Stop background monitors
curl -X POST http://localhost:8000/edgar/monitoring/stop
curl -X POST http://localhost:8000/intelligence/monitoring/stop
curl -X POST http://localhost:8000/edgar/research-worker/stop
```

---

## Environment-Specific Configuration

### Windows vs Mac Differences

| Aspect | Mac (Dev) | Windows (Staging) |
|--------|-----------|-------------------|
| Python command | `/Users/donaldross/opt/anaconda3/bin/python3` | `python` or `python3` |
| Virtual env activation | `source venv/bin/activate` | `.\venv\Scripts\Activate.ps1` |
| Shell | zsh/bash | PowerShell/cmd |
| Path separators | `/` | `\` |
| Startup scripts | `./dev-start.sh` | Manual (create .bat/.ps1 if needed) |

### Creating Windows Startup Scripts (Optional)

**start-backend.bat**:
```batch
@echo off
cd C:\Projects\ma-tracker-app\python-service
call venv\Scripts\activate.bat
python start_server.py
```

**start-frontend.bat**:
```batch
@echo off
cd C:\Projects\ma-tracker-app
npm run dev
```

---

## Troubleshooting

### Port Already in Use

```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process (use PID from previous command)
taskkill /PID <PID> /F

# Repeat for port 8000
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### Python Module Not Found

```powershell
# Ensure virtual environment is activated
.\venv\Scripts\Activate.ps1

# Reinstall dependencies
pip install -r requirements.txt

# Verify installation
pip list
```

### Database Connection Failed

```powershell
# Verify DATABASE_URL in .env
type python-service\.env

# Test connection (requires psql or Python)
python -c "import asyncpg; import asyncio; import os; asyncio.run(asyncpg.connect(os.getenv('DATABASE_URL')))"
```

### Git Pull Conflicts

```powershell
# Stash local changes
git stash

# Pull latest
git pull origin main

# Reapply changes (if needed)
git stash pop
```

### Environment Variables Not Loading

```powershell
# Verify .env file exists
dir python-service\.env

# Check content (be careful with secrets)
type python-service\.env

# Ensure no extra spaces or quotes
# Restart terminal/PowerShell after changes
```

---

## Security Considerations

### Environment Files

- **Never commit** `.env` or `.env.local` to git
- Verify `.gitignore` includes these files
- Keep API keys secure and rotated

### Exposed Secrets

If you accidentally commit secrets:
1. Immediately rotate the compromised keys
2. Remove from git history using `git filter-branch` or BFG Repo-Cleaner
3. Force push (coordinate with team)

### Database Access

- Use read-only credentials for staging if possible
- Consider separate staging schema to avoid production data corruption

---

## Validation Checklist

After deployment, verify:

- [ ] Services start without errors
- [ ] Frontend loads at http://localhost:3000
- [ ] Backend responds at http://localhost:8000/health
- [ ] Database queries return expected data
- [ ] Logs show no critical errors
- [ ] Date formatting is consistent across pages
- [ ] Sort order is newest first
- [ ] Published dates display correctly
- [ ] No console errors in browser
- [ ] API endpoints respond correctly

---

## Next Steps After Staging Validation

1. **Document any environment-specific issues**
2. **Test all critical user workflows**
3. **Validate recent feature additions**:
   - Rule-based M&A detection
   - GlobeNewswire monitor
   - False positive filtering
   - Date formatting improvements
4. **Create bug reports** for any issues found
5. **Update this document** with findings
6. **Plan production deployment** (frontend to Vercel)

---

## Support & Resources

- **Development Status**: See `DEVELOPMENT_STATUS.md`
- **Testing Plan**: See `TESTING_PLAN.md`
- **Architecture**: See `ARCHITECTURE.md`
- **Claude Instructions**: See `CLAUDE.md`
- **General Development**: See `DEVELOPMENT.md`

---

## Deployment Log

### 2025-11-15 - Initial Staging Deployment
- **Commit**: fd13400 - "Enhanced intelligence platform with rule-based detection and UI improvements"
- **Files Changed**: 90 files, 21,190 insertions, 4,799 deletions
- **Key Features**:
  - Rule-based M&A detection system
  - GlobeNewswire monitor integration
  - Shared date formatting utilities
  - Intelligence platform sort order fix
  - Published date + detected date display
  - Database migrations 011-020 applied
- **Known Issues**: Options scanner functionality to be debugged
- **Status**: Ready for validation testing
