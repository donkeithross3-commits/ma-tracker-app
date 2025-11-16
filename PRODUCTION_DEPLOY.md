# M&A Tracker - Production Deployment Guide

This guide provides a streamlined setup process for deploying M&A Tracker to a production environment.

## Overview

**Deployment Strategy:**
- **Frontend**: Vercel (already configured)
- **Backend**: Local Windows/Mac server (for IB Gateway access)
- **Database**: Neon PostgreSQL (cloud-hosted)

---

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] **Python 3.11 or 3.12** installed (NOT 3.14+)
- [ ] **Node.js 20.x or 22.x LTS** installed
- [ ] **Git** installed
- [ ] **Database connection string** from Neon.tech
- [ ] **Anthropic API key** from console.anthropic.com
- [ ] **(Optional)** SendGrid API key for email notifications
- [ ] **(Optional)** Interactive Brokers account and TWS/Gateway installed

---

## Quick Start (Automated Setup)

### Windows

1. **Clone the repository**:
   ```cmd
   git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
   cd ma-tracker-app
   ```

2. **Run the automated setup**:
   ```cmd
   setup-production.bat
   ```

   This script will:
   - Verify Python version (3.11-3.13)
   - Verify Node.js version (20.x or 22.x)
   - Install all Python dependencies
   - Install all Node.js dependencies
   - Generate Prisma client
   - Prompt for environment variables
   - Create `.env` files with production values
   - Verify database connectivity
   - Run a health check

3. **Start the application**:
   ```cmd
   start-production.bat
   ```

### Mac/Linux

1. **Clone the repository**:
   ```bash
   git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
   cd ma-tracker-app
   ```

2. **Run the automated setup**:
   ```bash
   chmod +x setup-production.sh
   ./setup-production.sh
   ```

3. **Start the application**:
   ```bash
   ./start-production.sh
   ```

---

## Manual Setup (If Automated Fails)

### Step 1: Verify System Requirements

**Python Version Check**:
```bash
python --version  # Should show 3.11.x or 3.12.x
```

**Node.js Version Check**:
```bash
node --version  # Should show v20.x.x or v22.x.x
```

If versions are incorrect, install the required versions from:
- Python: https://www.python.org/downloads/
- Node.js: https://nodejs.org/

### Step 2: Configure Environment Variables

Create `python-service/.env`:
```env
# Database (REQUIRED)
DATABASE_URL=postgresql://your_neon_connection_string

# AI Services (REQUIRED)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Email (OPTIONAL)
SENDGRID_API_KEY=SG.your-key-here
```

Create `.env` in root directory:
```env
# Database (REQUIRED - same as python-service/.env)
DATABASE_URL=postgresql://your_neon_connection_string

# Auth (REQUIRED - generate a strong random string)
AUTH_SECRET=your-production-secret-minimum-32-characters-random-string

# URLs
NEXTAUTH_URL=http://localhost:3000
PYTHON_SERVICE_URL=http://localhost:8000
```

**IMPORTANT**:
- Use the SAME `DATABASE_URL` in both files
- Generate a strong `AUTH_SECRET` (32+ characters)
- Never commit these files to git

### Step 3: Install Dependencies

**Python**:
```bash
cd python-service
pip install -r requirements.txt
cd ..
```

**Node.js**:
```bash
npm install
npm run db:generate
```

### Step 4: Verify Database Connection

```bash
# Test backend connection
cd python-service
python start_server.py
# Should start without errors, Ctrl+C to stop

# Test frontend connection
cd ..
npm run db:studio
# Should open Prisma Studio
```

### Step 5: Start Production Services

**Option A: Automated (Recommended)**
```bash
# Windows
start-production.bat

# Mac/Linux
./start-production.sh
```

**Option B: Manual (Separate Terminals)**

Terminal 1 - Backend:
```bash
cd python-service
python start_server.py
```

Terminal 2 - Frontend:
```bash
npm run build
npm run start
```

---

## Production Configuration

### Security Checklist

- [ ] Strong `AUTH_SECRET` generated (use `openssl rand -base64 32`)
- [ ] Database uses SSL (`?sslmode=require` in connection string)
- [ ] API keys stored in `.env` files (NOT in code)
- [ ] `.env` and `.env.local` files in `.gitignore`
- [ ] Firewall configured (allow ports 3000, 8000 only from localhost)
- [ ] Regular database backups configured in Neon

### Performance Optimization

**For Production Deployment:**

1. **Build Next.js for production**:
   ```bash
   npm run build
   npm run start  # Uses production build
   ```

2. **Enable backend auto-restart** (using systemd on Linux or Task Scheduler on Windows)

3. **Configure log rotation**:
   - Logs are in `logs/python-backend.log` and `logs/nextjs-frontend.log`
   - Set up logrotate or equivalent

### Monitoring Setup

Monitor these endpoints for health:
- **Backend**: `GET http://localhost:8000/` (should return service status)
- **Frontend**: `GET http://localhost:3000/api/health` (if health endpoint exists)
- **Database**: Check Neon dashboard for connection metrics

---

## Starting Intelligence Monitors

Once the application is running, start the monitoring services via API:

```bash
# Start EDGAR monitor (polls SEC every 60s)
curl -X POST http://localhost:8000/edgar/monitoring/start

# Start Intelligence orchestrator (monitors news sources)
curl -X POST http://localhost:8000/intelligence/monitoring/start

# Check status
curl http://localhost:8000/edgar/monitoring/status
curl http://localhost:8000/intelligence/monitoring/status
```

**Note**: Monitors run continuously once started. They persist across application restarts.

---

## Troubleshooting

### Common Issues

**1. "DATABASE_URL not found"**
- Ensure `.env` file exists in BOTH root directory AND `python-service/`
- Both files must have identical `DATABASE_URL` values
- No quotes around the URL value
- No spaces in `sslmode=require`

**2. "Python version not supported"**
- Python 3.14+ is not compatible (asyncpg issue)
- Downgrade to Python 3.12 or 3.11
- Set `python-service/.python-version` to `3.12`

**3. "Port already in use"**
- Backend (8000) or Frontend (3000) port is occupied
- Stop other services using those ports
- Or change ports in configuration

**4. "fetch failed" errors in frontend**
- Backend is not running
- Check `logs/python-backend.log` for startup errors
- Verify `python start_server.py` works

**5. Prisma Client errors**
- Run `npm run db:generate` after any environment changes
- Delete `.next` folder and restart
- Verify `DATABASE_URL` is accessible

### Health Check Commands

```bash
# Check if backend is running
curl http://localhost:8000

# Check if frontend is running
curl http://localhost:3000

# Check database connection
npm run db:studio

# View backend logs
tail -f logs/python-backend.log

# View frontend logs
tail -f logs/nextjs-frontend.log
```

---

## Stopping the Application

```bash
# Windows
stop-production.bat

# Mac/Linux
./stop-production.sh
```

Or manually:
```bash
# Kill processes
# Windows
taskkill /F /IM python.exe
taskkill /F /IM node.exe

# Mac/Linux
pkill -f "python.*start_server"
pkill -f "next.*start"
```

---

## Backup and Recovery

### Database Backups

Neon provides automatic daily backups. To create manual backup:
1. Go to Neon dashboard
2. Select your project
3. Click "Backups" → "Create backup"

### Application Backups

1. **Code**: Committed to Git (no local backup needed)
2. **Environment files**: Back up `.env` files to secure location
3. **Logs**: Optional, archive `logs/` directory periodically

---

## Updating the Application

```bash
# Pull latest changes
git pull origin main

# Update Python dependencies
cd python-service
pip install -r requirements.txt --upgrade
cd ..

# Update Node.js dependencies
npm install
npm run db:generate

# Rebuild frontend
npm run build

# Restart services
./stop-production.sh && ./start-production.sh
```

---

## Support

For issues during deployment:
1. Check this troubleshooting guide
2. Review `logs/python-backend.log` and `logs/nextjs-frontend.log`
3. Verify all prerequisites are installed correctly
4. Ensure `.env` files have correct values
5. Contact support with error logs

---

## Architecture Notes

### Services Overview

- **Next.js Frontend (Port 3000)**: Web UI, user authentication, deal management
- **Python Backend (Port 8000)**: Intelligence monitors, options scanner, AI research
- **PostgreSQL Database**: Neon cloud-hosted, stores all persistent data
- **Interactive Brokers**: Optional, connects via IB Gateway for options data

### Data Flow

```
User → Next.js (3000) → Prisma → PostgreSQL (Neon)
                      ↓
                 Python API (8000) → asyncpg → PostgreSQL (Neon)
                      ↓
                 External APIs (SEC, News, Anthropic)
```

### Why Local Backend?

The Python backend runs locally (not deployed) because:
1. Connects to Interactive Brokers Gateway (requires local install)
2. Long-running monitoring processes
3. More cost-effective than cloud hosting for 24/7 operations
4. Direct filesystem access for logs

---

## Production Best Practices

1. **Use strong AUTH_SECRET**: Minimum 32 random characters
2. **Enable SSL/TLS**: Database connection uses `sslmode=require`
3. **Regular backups**: Neon automatic + manual before major changes
4. **Monitor logs**: Set up log rotation and monitoring
5. **Update regularly**: Pull latest code and dependency updates monthly
6. **Test before deploy**: Always test in staging environment first
7. **Document changes**: Keep track of custom configurations
8. **Secure API keys**: Never commit to git, use environment variables only

---

## Next Steps

After successful deployment:
1. Configure Interactive Brokers (if using options scanner)
2. Start intelligence monitors via API endpoints
3. Set up scheduled database backups
4. Configure log monitoring/alerts
5. Test all major workflows (deal creation, monitoring, research)

For more details, see:
- `SETUP.md` - Detailed setup instructions
- `CLAUDE.md` - Development workflows
- `ARCHITECTURE.md` - System design documentation
