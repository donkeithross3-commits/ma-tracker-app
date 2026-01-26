# Development Workflow

## Quick Start

Start the entire development environment with a single command:

```bash
npm run dev-full
```

This will:
1. ✅ Kill any stale development processes
2. ✅ Start Python FastAPI service (background, port 8000)
3. ✅ Start Cloudflare tunnel (background, required for external access)
4. ✅ Start Next.js dev server (foreground, port 3000)

## Available Commands

### Primary Development Commands

```bash
# Start full development environment (recommended)
npm run dev-full

# Kill all development processes
npm run dev-kill

# Start only Next.js (legacy, not recommended)
npm run dev
```

### What Gets Started

| Service | Port | Mode | Log Location |
|---------|------|------|--------------|
| Python FastAPI | 8000 | Background | `.logs/python-service.log` |
| Cloudflare Tunnel | N/A | Background | `.logs/tunnel.log` |
| Next.js | 3000 | Foreground | Terminal output |

## Prerequisites

Before running `npm run dev-full`, ensure you have:

1. **Python 3.11+** installed
   ```bash
   python3 --version
   ```

2. **Node.js 18+** installed
   ```bash
   node --version
   ```

3. **Cloudflare CLI** installed
   ```bash
   brew install cloudflared
   ```

4. **PostgreSQL** running
   ```bash
   # Database should be accessible at localhost:5432
   ```

5. **IB TWS** (Optional, for options scanner)
   - If using the M&A Options Scanner, IB TWS must be running on port 7497
   - The startup script will warn if IB TWS is not detected but will continue

## Startup Process

### Step 1: Cleanup
The script automatically kills existing processes:
- Next.js dev server (port 3000)
- Python FastAPI service (port 8000)
- Cloudflare tunnel processes
- Any stray processes from previous runs

### Step 2: Prerequisites Check
Validates:
- Python 3.11+ is installed
- Node.js is installed
- Cloudflare CLI is installed
- Ports 3000 and 8000 are available
- IB TWS connection (warning only)

### Step 3: Start Background Services

**Python FastAPI Service:**
- Starts on port 8000
- Logs to `.logs/python-service.log`
- API docs available at http://localhost:8000/docs
- Health check: http://localhost:8000/health

**Cloudflare Tunnel:**
- Provides external access to the app
- Two modes:
  - **Named Tunnel** (preferred): Stable URL at `https://krj-dev.dr3-dashboard.com`
  - **Quick Tunnel** (fallback): Temporary URL like `https://xxx.trycloudflare.com`
- Logs to `.logs/tunnel.log`

### Step 4: Start Next.js (Foreground)
- Runs in foreground so you can see live compilation
- Press Ctrl+C to stop all services
- Automatically cleans up background services on exit

## Accessing Your Application

### Local Access
- **Main App**: http://localhost:3000
- **KRJ Page**: http://localhost:3000/krj
- **Options Scanner**: http://localhost:3000/ma-options
- **Python API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### External Access (via Cloudflare Tunnel)
- **Named Tunnel**: https://krj-dev.dr3-dashboard.com
- **Quick Tunnel**: Check terminal output or `.logs/tunnel.log` for URL

## Stopping the Environment

### Graceful Shutdown
Press `Ctrl+C` in the terminal running `npm run dev-full`

This will:
1. Stop Next.js dev server
2. Stop Python service
3. Stop Cloudflare tunnel
4. Clean up all background processes

### Force Kill All Processes
If processes get stuck:

```bash
npm run dev-kill
```

This forcefully terminates all development processes.

## Troubleshooting

### Port Already in Use

**Error**: "Port 3000 is already in use"

**Solution**:
```bash
# Kill all dev processes
npm run dev-kill

# Or manually check what's using the port
lsof -i:3000
lsof -i:8000
```

### Python Service Won't Start

**Check the logs**:
```bash
tail -f .logs/python-service.log
```

**Common issues**:
- Database not running: Check PostgreSQL
- Missing dependencies: Run `pip3 install -r python-service/requirements.txt`
- Port 8000 in use: Run `npm run dev-kill`

### Cloudflare Tunnel Issues

**Check the logs**:
```bash
tail -f .logs/tunnel.log
```

**Common issues**:
- `cloudflared` not installed: Run `brew install cloudflared`
- Named tunnel not configured: The script will fall back to Quick Tunnel
- To set up Named Tunnel: Run `./scripts/setup-named-tunnel.sh`

### IB TWS Not Connected

**Warning**: "IB TWS not detected on port 7497"

**Impact**: M&A Options Scanner won't work

**Solution**:
1. Start IB Trader Workstation (TWS)
2. Enable API connections in TWS settings
3. Ensure TWS is listening on port 7497

## Log Files

All logs are stored in `.logs/` directory:

```bash
# View Python service logs
tail -f .logs/python-service.log

# View Cloudflare tunnel logs
tail -f .logs/tunnel.log

# View all logs
tail -f .logs/*.log
```

## Development Tips

### Recommended Workflow

1. **Start environment**:
   ```bash
   npm run dev-full
   ```

2. **Make changes** to code (hot reload works for both Next.js and Python)

3. **View logs** in separate terminal windows:
   ```bash
   # Terminal 2
   tail -f .logs/python-service.log
   
   # Terminal 3
   tail -f .logs/tunnel.log
   ```

4. **Stop environment** when done:
   - Press `Ctrl+C` in the main terminal

### Quick Restart

If you need to restart everything:

```bash
# Stop all services
npm run dev-kill

# Start everything again
npm run dev-full
```

### Individual Service Management

If you need to run services individually (not recommended):

```bash
# Python service only
./scripts/start-python-service.sh

# Cloudflare tunnel only
./scripts/start-tunnel.sh

# Next.js only
npm run dev
```

## Environment Variables

### Next.js (.env.local)
- `DATABASE_URL`: PostgreSQL connection string
- `KRJ_BASIC_USER`: Basic auth username for /krj
- `KRJ_BASIC_PASS`: Basic auth password for /krj
- `PYTHON_SERVICE_URL`: Python service URL (default: http://localhost:8000)

### Python Service (python-service/.env)
- `DATABASE_URL`: PostgreSQL connection string
- `IB_HOST`: IB TWS host (default: 127.0.0.1)
- `IB_PORT`: IB TWS port (default: 7497)
- `PORT`: Python service port (default: 8000)
- `ALLOWED_ORIGINS`: CORS origins (default: http://localhost:3000)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    npm run dev-full                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   1. Kill existing processes          │
        │   (scripts/kill-dev-processes.sh)     │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   2. Check prerequisites              │
        │   (Python, Node, cloudflared, ports)  │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   3. Start Python Service (bg)        │
        │   → Port 8000                         │
        │   → Log: .logs/python-service.log     │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   4. Start Cloudflare Tunnel (bg)     │
        │   → Named or Quick mode               │
        │   → Log: .logs/tunnel.log             │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │   5. Start Next.js (foreground)       │
        │   → Port 3000                         │
        │   → Terminal output                   │
        └───────────────────────────────────────┘
```

## Next Steps

- **First time setup**: See [README.md](../README.md) for initial setup
- **Database migrations**: See [DATABASE.md](./DATABASE.md)
- **Cloudflare tunnel setup**: Run `./scripts/setup-named-tunnel.sh`
- **Options scanner**: See [MA_OPTIONS_SCANNER.md](./MA_OPTIONS_SCANNER.md)

