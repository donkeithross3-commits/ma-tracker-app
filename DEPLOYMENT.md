# M&A Tracker Deployment Guide

## System Overview

The M&A Tracker is a full-stack application for analyzing merger arbitrage opportunities using options strategies. The system consists of:

- **Frontend**: Next.js application (TypeScript, React, Tailwind CSS)
- **Backend**: Python FastAPI service with IB Gateway integration
- **Database**: PostgreSQL with Prisma ORM
- **Market Data**: Interactive Brokers Gateway (Paper Trading)

## Architecture

```
┌─────────────────────┐
│   Next.js Frontend  │  (Vercel Production / localhost:3000 Dev)
│   (User Interface)  │
└──────────┬──────────┘
           │ HTTP API
           ▼
┌─────────────────────┐
│  Python FastAPI     │  (Windows STAGING: localhost:8000)
│  Options Scanner    │
└──────────┬──────────┘
           │ IB API (ibapi)
           ▼
┌─────────────────────┐
│   IB Gateway        │  (Windows STAGING: localhost:7497)
│  (Paper Trading)    │
└──────────┬──────────┘
           │ Market Data Feed
           ▼
     [IB Servers]
```

## Environments

### DEV Environment (Mac)
- **Location**: macOS developer machine
- **Purpose**: Development, code changes, git operations
- **Components**:
  - Next.js dev server (`npm run dev`)
  - PostgreSQL database (local or cloud)
  - Prisma Studio (database GUI)
  - Git repository

### STAGING Environment (Windows PC)
- **Location**: Windows machine with TWS/IB Gateway
- **Purpose**: Production Python service, IB Gateway connection
- **Components**:
  - Python service (FastAPI + uvicorn)
  - IB Gateway (Paper Trading, port 7497)
  - Real-time market data feed

## Prerequisites

### DEV Environment (Mac)
```bash
# Required software
- Node.js 18+ (via nvm)
- PostgreSQL 14+
- Git
- Python 3.9+ (for local testing)

# Verify installations
node --version     # v18.x.x or higher
npm --version      # 9.x.x or higher
psql --version     # PostgreSQL 14.x
python3 --version  # Python 3.9.x or higher
```

### STAGING Environment (Windows)
```powershell
# Required software
- Python 3.9+
- IB Gateway (Paper Trading)
- Git for Windows

# Verify installations
python --version   # Python 3.9.x or higher
git --version      # git version 2.x.x
```

## Initial Setup

### 1. Database Setup (DEV)

```bash
# Create PostgreSQL database
createdb ma_tracker

# Set environment variables (create .env.local)
cat > .env.local <<EOF
DATABASE_URL="postgresql://username:password@localhost:5432/ma_tracker"
NEXT_PUBLIC_PYTHON_SERVICE_URL="http://localhost:8000"
EOF

# Run Prisma migrations
npm run db:push

# (Optional) Seed with sample data
npm run db:seed
```

### 2. Python Service Setup (STAGING Windows)

```powershell
# Navigate to project
cd C:\Users\<USERNAME>\ma-tracker-app\python-service

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Verify IB API installation
python -c "import ibapi; print('IB API installed successfully')"
```

### 3. IB Gateway Configuration (STAGING Windows)

1. **Install IB Gateway**
   - Download from: https://www.interactivebrokers.com/en/trading/ibgateway-stable.php
   - Install Paper Trading version

2. **Configure API Settings**
   - Launch IB Gateway
   - Go to: **File → Global Configuration → API → Settings**
   - Enable **ActiveX and Socket Clients**
   - **Uncheck** "Read-Only API"
   - Set **Socket port**: `7497`
   - Add **Trusted IP**: `127.0.0.1`
   - Click **OK** and restart IB Gateway

3. **Login**
   - Use Paper Trading account credentials
   - Ensure "IB API" status shows **Ready**

## Running the Application

### Start Python Service (STAGING Windows)

```powershell
# Navigate to python-service directory
cd C:\Users\<USERNAME>\ma-tracker-app\python-service

# Activate virtual environment (if not already active)
.\venv\Scripts\activate

# Start the FastAPI service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Service will be available at http://localhost:8000
# API docs at http://localhost:8000/docs
```

### Start Next.js Frontend (DEV Mac)

```bash
# Navigate to project root
cd /Users/<USERNAME>/ma-tracker-app

# Install dependencies (first time only)
npm install

# Start development server
npm run dev

# Application will be available at http://localhost:3000
```

## Testing

### 1. Test IB Gateway Connection (STAGING)

**Simple Socket Test:**
```powershell
cd C:\Users\<USERNAME>\ma-tracker-app\python-service
python socket_test.py
```
Expected output: `SUCCESS: Port 7497 is open and accepting connections`

**Quick API Test:**
```powershell
python quick_test.py
```
Expected output: `SUCCESS: Connected to IB Gateway! OrderID: <number>`

**Verbose Test (with diagnostics):**
```powershell
python verbose_test.py
```
Expected output: Full connection handshake details

### 2. Test ES Futures Data Feed (STAGING)

**Direct API Test:**
```powershell
python test_ib_connection.py
```
Expected output: ES futures price data for December 2025 contract

**Via FastAPI Endpoint:**
```powershell
curl http://localhost:8000/test-futures
```
Expected response:
```json
{
  "success": true,
  "message": "ES futures data retrieved successfully",
  "data": {
    "success": true,
    "contract": "ESZ5 (Dec 2025)",
    "last_price": 6848.5,
    "bid": 6848.25,
    "ask": 6848.5,
    "mid": 6848.375
  }
}
```

### 3. Test Complete Scanner Flow (STAGING)

**Health Check:**
```powershell
curl http://localhost:8000/health
```

**Test Scan (example with AAPL):**
```powershell
curl http://localhost:8000/test-scan/AAPL
```

## API Endpoints

### Python FastAPI Service (Port 8000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info |
| `/health` | GET | Health check + IB connection status |
| `/scan` | POST | Scan merger deal for options opportunities |
| `/test-scan/{ticker}` | GET | Quick test scan with default parameters |
| `/test-futures` | GET | Test ES futures data feed (overnight testing) |
| `/docs` | GET | Interactive API documentation (Swagger UI) |

### Example: Scan a Deal

```bash
curl -X POST http://localhost:8000/scan \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "deal_price": 185.50,
    "expected_close_date": "2025-05-15",
    "dividend_before_close": 0.0,
    "ctr_value": 0.0,
    "confidence": 0.75
  }'
```

## Troubleshooting

### IB Gateway Connection Issues

**Problem: Connection hangs, never receives nextValidId**

Solution:
1. Restart IB Gateway completely
2. Wait 10-15 seconds for full startup
3. Check for popup dialogs (connection requests)
4. Verify no stale connections (IB Gateway limits: 32 total, 8 per client)

**Problem: "Read-Only API" error**

Solution:
1. Open IB Gateway → File → Global Configuration → API → Settings
2. **Uncheck** "Read-Only API"
3. Click OK and restart IB Gateway

**Problem: Port 7497 not accessible**

Solution:
1. Verify IB Gateway is running in Paper Trading mode
2. Check socket port in settings (should be 7497 for paper trading)
3. Ensure 127.0.0.1 is in Trusted IPs list
4. Check Windows Firewall isn't blocking the port

### Python Service Issues

**Problem: Module not found errors**

Solution:
```powershell
# Ensure virtual environment is activated
.\venv\Scripts\activate

# Reinstall dependencies
pip install -r requirements.txt
```

**Problem: Service won't start**

Solution:
```powershell
# Check if port 8000 is already in use
netstat -ano | findstr :8000

# Kill the process if needed
taskkill /PID <process_id> /F

# Restart the service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Market Data Issues

**Problem: No option data returned**

Possible causes:
1. Options market closed (use `/test-futures` for overnight testing)
2. Invalid ticker symbol
3. No market data subscription for that symbol
4. Contract month expired

**Problem: Futures data test fails**

Solution:
1. Update contract month in code (check current front month)
2. Ensure futures market is open (23 hours/day, closes 5-6pm ET)
3. Verify market data subscriptions include ES futures

## Deployment Notes

### Git Workflow

```bash
# DEV (Mac) - Make changes and commit
git add .
git commit -m "Description of changes"
git push

# STAGING (Windows) - Pull latest changes
git pull

# Restart Python service after pulling code changes
```

### Environment Variables

**DEV (.env.local):**
```bash
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_PYTHON_SERVICE_URL="http://localhost:8000"
```

**STAGING:**
- Python service uses default ports (no .env needed for basic setup)
- IB Gateway uses port 7497 (paper trading)

### Remote Agent (Optional)

The remote agent allows autonomous task execution on STAGING from DEV machine.

**Start Remote Agent (STAGING):**
```powershell
cd C:\Users\<USERNAME>\ma-tracker-app\remote-agent
python main.py
```

**Access via ngrok (for remote access):**
```powershell
ngrok http 8001
```

## Performance Notes

### IB API Rate Limits

- **Market Data Requests**: Limited to ~100 instruments at a time
- **Connection Limit**: Max 32 total connections, 8 per client ID
- **Request Pacing**: Add 0.5-1 second delays between requests

### Optimization Tips

1. **Reuse Scanner Instances**: The FastAPI service reuses scanner connections
2. **Limited Option Chain Fetching**: Code limits strikes/expirations to avoid IB limits
3. **Separate Client IDs**: Futures scanner uses client ID 2, main scanner uses ID 1
4. **Connection Pooling**: Maintain persistent connections, avoid reconnecting per request

## Overnight Testing

When options markets are closed (weekends, after 4pm ET), use ES futures endpoint:

```bash
# Test connectivity and data flow 23 hours/day
curl http://localhost:8000/test-futures
```

ES futures trade nearly 24/7 (except ~5-6pm ET daily maintenance), making them ideal for:
- Overnight deployment testing
- Connection verification
- Data feed validation

## Support & Documentation

- **IB API Documentation**: https://interactivebrokers.github.io/tws-api/
- **FastAPI Docs**: http://localhost:8000/docs (when service running)
- **Project Repository**: https://github.com/donkeithross3-commits/ma-tracker-app

## Quick Reference Commands

### Start Everything (Quick Start)

**STAGING Windows:**
```powershell
# 1. Start IB Gateway (manual - launch application)
# 2. Start Python Service
cd C:\Users\<USERNAME>\ma-tracker-app\python-service
.\venv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**DEV Mac:**
```bash
# Start Next.js
cd /Users/<USERNAME>/ma-tracker-app
npm run dev
```

### Stop Everything

**STAGING Windows:**
```powershell
# Press Ctrl+C in Python service terminal
# Close IB Gateway application
```

**DEV Mac:**
```bash
# Press Ctrl+C in Next.js terminal
```

### Quick Health Checks

```bash
# Check Python service
curl http://localhost:8000/health

# Check Next.js
curl http://localhost:3000

# Check IB Gateway
curl http://localhost:8000/test-futures
```

---

**Last Updated**: 2025-01-03
**Version**: 1.0.0
