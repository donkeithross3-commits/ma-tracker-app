# M&A Intelligence Tracker - Development Guide

This guide provides comprehensive instructions for local development and testing.

## Quick Start

### 1. Start Development Environment

```bash
./dev-start.sh
```

This unified script will:
- ✓ Validate environment files exist
- ✓ Stop any existing services
- ✓ Start Python backend (port 8000) using `start_server.py`
- ✓ Start Next.js frontend (port 3000)
- ✓ Create logs in `logs/` directory
- ✓ Display comprehensive service status

### 2. Stop Development Environment

```bash
./dev-stop.sh
```

This will cleanly stop all services and free up ports.

---

## Service URLs

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:3000 | Next.js app |
| **Backend API** | http://localhost:8000 | FastAPI server |
| **API Docs** | http://localhost:8000/docs | Interactive API documentation |
| **Health Check** | http://localhost:8000/health | Service health status |

---

## Environment Setup

### Required Files

#### 1. `python-service/.env`
```env
DATABASE_URL=postgresql://user:password@host:port/database
ANTHROPIC_API_KEY=sk-ant-...
SENDGRID_API_KEY=SG...  # Optional
```

#### 2. `.env.local` (Frontend - Optional)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### First-Time Setup

1. Clone the repository
2. Create environment files (see above)
3. Install Python dependencies:
   ```bash
   cd python-service
   pip install -r requirements.txt
   ```
4. Install Node dependencies:
   ```bash
   npm install
   ```
5. Start development environment:
   ```bash
   ./dev-start.sh
   ```

---

## Development Workflow

### Starting a New Session

1. **Use the session initializer:**
   ```bash
   ./start-claude-session.sh
   ```
   This will show you:
   - Git status and recent commits
   - Current session state from `.claude-session`
   - Service status (backend/frontend)
   - Available slash commands

2. **Start your services:**
   ```bash
   ./dev-start.sh
   ```

3. **Check logs in real-time:**
   ```bash
   # Backend logs
   tail -f logs/python-backend.log

   # Frontend logs
   tail -f logs/nextjs-frontend.log
   ```

### Testing Workflow

Follow the comprehensive testing plan:
1. Read `python-service/TESTING_PLAN.md`
2. Execute tests for each component
3. Document findings in `python-service/TESTING_FINDINGS.md`
4. Update `.claude-session` with progress

### Available Slash Commands (Claude Code)

Use these in your Claude Code sessions:
- `/init` - Initialize session with project context
- `/verify` - Verification mode (explore code)
- `/bug-fix` - Bug fix workflow
- `/feature` - Feature development workflow
- `/db-migration` - Database migration helper
- `/monitor` - Monitor service workflow

---

## Monitoring Services

The application includes three background monitoring services:

### 1. EDGAR Monitor
Polls SEC.gov every 60 seconds for M&A-related filings.

**Start:**
```bash
curl -X POST http://localhost:8000/edgar/monitoring/start
```

**Status:**
```bash
curl http://localhost:8000/edgar/monitoring/status | python3 -m json.tool
```

**Stop:**
```bash
curl -X POST http://localhost:8000/edgar/monitoring/stop
```

### 2. Halt Monitor
Polls NASDAQ/NYSE every 2 seconds for trading halts.

**Status:**
```bash
curl http://localhost:8000/halts/status | python3 -m json.tool
```

### 3. Research Worker
Processes queued deals and generates AI-powered research reports.

**Start:**
```bash
curl -X POST http://localhost:8000/edgar/research-worker/start
```

**Status:**
```bash
curl http://localhost:8000/edgar/research-worker/status | python3 -m json.tool
```

---

## Testing

### Manual API Testing

```bash
# Health check
curl http://localhost:8000/health | python3 -m json.tool

# Get recent EDGAR filings
curl http://localhost:8000/edgar/filings/recent | python3 -m json.tool

# Get recent halt events
curl http://localhost:8000/halts/recent | python3 -m json.tool

# Get staged deals
curl http://localhost:8000/edgar/staged-deals | python3 -m json.tool
```

### Database Testing

Connect to PostgreSQL using the DATABASE_URL from `.env`:

```bash
psql $DATABASE_URL
```

Key tables to check:
- `edgar_filings` - SEC filing data
- `staged_deals` - Deals awaiting approval
- `deal_intelligence` - Approved active deals
- `halt_events` - Trading halt data

### Pytest Test Suite

*Note: Test suite creation is in progress (see TESTING_PLAN.md)*

```bash
cd python-service
pytest tests/ -v
```

---

## Common Development Tasks

### Viewing Logs

All logs are written to the `logs/` directory:

```bash
# Backend logs (Python/FastAPI)
tail -f logs/python-backend.log

# Frontend logs (Next.js)
tail -f logs/nextjs-frontend.log
```

### Debugging

1. **Backend issues:**
   - Check `logs/python-backend.log`
   - Verify environment variables in `python-service/.env`
   - Test database connection: `psql $DATABASE_URL`

2. **Frontend issues:**
   - Check `logs/nextjs-frontend.log`
   - Clear Next.js cache: `rm -rf .next`
   - Reinstall dependencies: `rm -rf node_modules && npm install`

3. **Port conflicts:**
   - Kill processes manually: `lsof -ti :8000 | xargs kill -9`
   - Or use the stop script: `./dev-stop.sh`

### Database Migrations

The system uses raw SQL migrations in `python-service/migrations/`:

1. Create new migration: `migrations/XXX_description.sql`
2. Apply migration: Run SQL via psql or Python script
3. Document in migration log

---

## Project Structure

```
ma-tracker-app/
├── dev-start.sh              # Unified development startup
├── dev-stop.sh               # Stop all development services
├── start-claude-session.sh   # Session context generator
├── .claude-session           # Current session state (gitignored)
├── DEVELOPMENT.md            # This file
│
├── python-service/           # Backend (FastAPI)
│   ├── start_server.py       # Python startup script (env validation)
│   ├── requirements.txt      # Python dependencies
│   ├── .env                  # Environment variables (gitignored)
│   ├── app/
│   │   ├── main.py           # FastAPI application
│   │   ├── api/              # API routes
│   │   ├── monitors/         # Background monitoring services
│   │   └── intelligence/     # AI orchestration
│   ├── migrations/           # Database migrations
│   ├── TESTING_PLAN.md       # Comprehensive testing roadmap
│   └── TESTING_FINDINGS.md   # Testing results documentation
│
├── app/                      # Frontend (Next.js)
│   ├── page.tsx              # Home page
│   ├── deals/                # Deal-related pages
│   └── ...
│
└── logs/                     # Development logs (gitignored)
    ├── python-backend.log
    ├── nextjs-frontend.log
    ├── python.pid
    └── nextjs.pid
```

---

## Troubleshooting

### "Port already in use" error

```bash
# Stop everything cleanly
./dev-stop.sh

# Or manually kill processes
lsof -ti :8000 | xargs kill -9  # Python backend
lsof -ti :3000 | xargs kill -9  # Next.js frontend
```

### "Environment variable not set" error

Make sure `python-service/.env` exists with required variables:
```bash
cat python-service/.env
# Should contain DATABASE_URL and ANTHROPIC_API_KEY
```

### Database connection errors

```bash
# Test connection directly
psql $DATABASE_URL

# If fails, check:
# 1. DATABASE_URL is correct in .env
# 2. Database is accessible (firewall, VPN)
# 3. Credentials are valid
```

### Python module not found errors

```bash
cd python-service
pip install -r requirements.txt

# Or reinstall everything
pip install --force-reinstall -r requirements.txt
```

---

## Development Standards

See `.claude/` directory for:
- Coding standards
- Git workflow
- Testing guidelines
- Documentation templates

---

## Getting Help

1. Check `TESTING_FINDINGS.md` for known issues
2. Review logs in `logs/` directory
3. Use `/help` slash command in Claude Code sessions
4. Check API documentation: http://localhost:8000/docs

---

## Next Steps

- [ ] Complete pytest test suite (see TESTING_PLAN.md)
- [ ] Add frontend component tests
- [ ] Set up CI/CD pipeline
- [ ] Add performance monitoring
- [ ] Implement auto-start for monitors

---

*Last Updated: 2025-11-09*
*See .claude-session for current session state*
