# M&A Tracker Setup Guide

This guide walks you through setting up the M&A Tracker application on your local machine.

## Prerequisites (Install These First)

Before running the application, you need to install these tools manually:

### 1. Python 3.11 or 3.12 (Required)

**Why**: The backend API service requires Python 3.11 or 3.12. Python 3.14+ is not yet supported due to package compatibility.

**Installation**:

- **Windows**:
  - Download from https://www.python.org/downloads/
  - Choose Python 3.12.x (recommended) or 3.11.x
  - ✅ **IMPORTANT**: Check "Add Python to PATH" during installation

- **Mac**:
  - Already installed (this project uses Python 3.12)
  - Or install via Homebrew: `brew install python@3.12`

- **Linux**:
  - `sudo apt install python3.12` (Ubuntu/Debian)
  - `sudo dnf install python3.12` (Fedora)

**Verify**:
```bash
python --version  # or python3 --version
# Should show: Python 3.11.x or Python 3.12.x

# On Windows with multiple versions:
py -3.11 --version
# or
py -3.12 --version
```

### 2. Node.js 20.x or 22.x LTS (Required)

**Why**: The frontend is a Next.js application which requires Node.js and npm.

**Installation**:

- **All platforms**: Download from https://nodejs.org/
  - Choose the **LTS (Long Term Support)** version
  - This includes npm (Node Package Manager)
  - ✅ **IMPORTANT**: Make sure "Add to PATH" is checked

**Verify**:
```bash
node --version
# Should show: v20.x.x or v22.x.x

npm --version
# Should show: 10.x.x or higher
```

### 3. PostgreSQL Database (Required)

**Why**: The application stores all data in a PostgreSQL database.

**Option A - Neon (Recommended - Cloud-hosted)**:
1. Sign up at https://neon.tech (free tier available)
2. Create a new project
3. Copy the connection string (looks like: `postgresql://user:pass@host/dbname`)
4. Save this for the `.env` file setup below

**Option B - Local PostgreSQL**:
- **Windows**: Download from https://www.postgresql.org/download/windows/
- **Mac**: `brew install postgresql@15`
- **Linux**: `sudo apt install postgresql-15`

**Note**: If using local PostgreSQL, your connection string will be:
```
postgresql://username:password@localhost:5432/ma_tracker
```

### 4. Git (Required for cloning the repository)

**Why**: To download the code and receive updates.

**Installation**:
- **Windows**: Download from https://git-scm.com/download/win
- **Mac**: Already installed, or `brew install git`
- **Linux**: `sudo apt install git`

**Verify**:
```bash
git --version
# Should show: git version 2.x.x
```

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
cd ma-tracker-app
```

### 2. Set Up Environment Variables

#### Backend Environment (.env)

Create a `.env` file in the `python-service/` directory:

```bash
cd python-service
```

**Windows (Command Prompt)**:
```cmd
copy nul .env
notepad .env
```

**Windows (PowerShell)**:
```powershell
New-Item .env
notepad .env
```

**Mac/Linux**:
```bash
touch .env
nano .env
```

Add the following content (replace with your actual values):

```env
# Database Connection (REQUIRED)
DATABASE_URL=postgresql://your_username:your_password@your_host/your_database

# Anthropic API Key (REQUIRED for AI features)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# SendGrid API Key (OPTIONAL - for email notifications)
SENDGRID_API_KEY=SG.your-key-here
```

**Where to get these**:
- **DATABASE_URL**: From Neon dashboard or your local PostgreSQL setup
- **ANTHROPIC_API_KEY**: Sign up at https://console.anthropic.com/
- **SENDGRID_API_KEY**: Optional, sign up at https://sendgrid.com/

#### Frontend Environment (Optional)

Create `.env.local` in the root directory (only if you need to customize):

```bash
cd ..  # Back to root directory
```

**Windows**:
```cmd
copy nul .env.local
notepad .env.local
```

**Mac/Linux**:
```bash
touch .env.local
nano .env.local
```

Add (optional):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Install Python Dependencies

```bash
cd python-service

# Windows (with multiple Python versions):
py -3.11 -m pip install -r requirements.txt
# or
py -3.12 -m pip install -r requirements.txt

# Mac/Linux:
pip install -r requirements.txt
# or
pip3 install -r requirements.txt
```

**What this installs automatically**:
- FastAPI, Uvicorn (web framework)
- asyncpg (database driver)
- anthropic (AI client)
- pandas, numpy, scipy (data processing)
- beautifulsoup4, httpx (web scraping)
- google-api-python-client (Gmail integration)
- All other dependencies listed in `requirements.txt`

### 4. Install Node.js Dependencies

```bash
cd ..  # Back to root directory
npm install
```

**What this installs automatically**:
- Next.js, React (frontend framework)
- Prisma (database ORM for frontend)
- UI components (Radix UI, Tailwind CSS)
- All other dependencies listed in `package.json`

### 5. Generate Prisma Client

```bash
npm run db:generate
```

This creates the TypeScript types for your database schema.

### 6. Apply Database Migrations

**Backend migrations** (in `python-service/migrations/`):

```bash
# Connect to your database and apply migrations
psql $DATABASE_URL -f python-service/migrations/001_initial_schema.sql
# Continue with other migration files in order...
```

Or use the migration application scripts provided in `python-service/`.

---

## Running the Application

### Quick Start (Recommended)

**Windows**:
```bash
dev-start.bat
```

**Mac/Linux**:
```bash
./dev-start.sh
```

This starts both the backend and frontend services.

### Manual Start (Alternative)

If you prefer to run services separately:

**Terminal 1 - Backend (Python)**:
```bash
cd python-service

# Windows:
py -3.11 start_server.py

# Mac/Linux:
python3 start_server.py
```

**Terminal 2 - Frontend (Next.js)**:
```bash
# From root directory
npm run dev
```

### Access the Application

Once both services are running:

- **Frontend (Main UI)**: http://localhost:3000
  - `/deals` - M&A Dashboard
  - `/portfolio` - Portfolio tracker
  - `/intelligence/deals` - Intelligence deals
  - `/staging` - Staged deals for approval

- **Backend (API)**: http://localhost:8000
  - `/docs` - Interactive API documentation

### Stopping the Application

**Windows**:
```bash
dev-stop.bat
```

**Mac/Linux**:
```bash
./dev-stop.sh
```

---

## Verification Checklist

After installation, verify everything works:

- [ ] Python version is 3.11.x or 3.12.x
- [ ] Node.js version is 20.x or 22.x
- [ ] Database connection string is in `python-service/.env`
- [ ] Backend starts without errors (port 8000)
- [ ] Frontend starts without errors (port 3000)
- [ ] Can access http://localhost:3000/deals in browser
- [ ] API docs load at http://localhost:8000/docs

---

## Troubleshooting

### "python is not recognized" (Windows)

- Python not in PATH. Reinstall Python with "Add to PATH" checked.
- Or use `py -3.11` or `py -3.12` instead of `python`

### "npm is not recognized" (Windows)

- Node.js not in PATH. Reinstall Node.js with default settings.
- Restart your terminal after installation.

### "ModuleNotFoundError: No module named 'google'"

- Missing dependencies. Run: `pip install -r requirements.txt` again.
- Make sure you're using the correct Python version.

### "DATABASE_URL not set"

- Missing `.env` file in `python-service/` directory.
- Check file exists: `ls python-service/.env` (Mac/Linux) or `dir python-service\.env` (Windows)

### Python 3.14 errors with asyncpg

- Python 3.14 is too new. Uninstall and install Python 3.12 instead.
- The `.python-version` file in `python-service/` enforces this.

### Port already in use

- Another service is using port 8000 or 3000.
- Stop other services or change ports in configuration.

---

## Next Steps

After successful setup:

1. Review `CLAUDE.md` for development workflows
2. Review `DEVELOPMENT.md` for architecture details
3. Explore the API at http://localhost:8000/docs
4. Check `ARCHITECTURE.md` to understand the system design

---

## Getting Help

- Check existing documentation in the repository
- Review error messages carefully
- Ensure all prerequisites are installed correctly
- Verify environment variables are set

---

## Optional Components

### Interactive Brokers (for Options Scanner)

**Not required for basic functionality**

If you want to use the options scanner feature:

1. Install IB Gateway or TWS from https://www.interactivebrokers.com/
2. Configure API access in IB settings
3. Run IB Gateway before starting the options scanner

The options scanner will gracefully handle IB Gateway being unavailable.
