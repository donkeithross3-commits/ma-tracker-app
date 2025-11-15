# Initialize Development Session

You are working on the **M&A Intelligence Tracker** project.

## Project Context

**Stack:** Next.js 13+ (App Router) + FastAPI (Python) + PostgreSQL (Neon)
**Purpose:** Real-time M&A deal tracking with intelligence gathering from SEC filings, news sources, and trading halts

## Current Architecture

### Frontend (`/ma-tracker-app`)
- Next.js 13+ with App Router
- TypeScript, React, Tailwind CSS
- Server Components by default
- API integration at `http://localhost:8000`

### Backend (`/python-service`)
- FastAPI service (port 8000)
- Python 3.9 with asyncpg for PostgreSQL
- Background monitors (auto-start on service launch):
  - **EDGAR Monitor** (60s polling)
  - **Intelligence Orchestrator** (external sources)
  - **Halt Monitor** (2s polling NASDAQ/NYSE)
  - **Research Worker** (Claude AI deal analysis)

### Database
- PostgreSQL (Neon hosted)
- Migrations in `/python-service/migrations/` (numbered 001-010)
- Key tables: `deal_intelligence`, `staged_deals`, `deal_sources`, `edgar_filings`, `halt_events`, `alert_notifications`

## Service Management

```bash
# Frontend (from /ma-tracker-app)
npm run dev              # Port 3000

# Backend (from /ma-tracker-app/python-service)
python3 start_server.py  # Port 8000

# Health Checks
http://localhost:3000
http://localhost:8000/health
http://localhost:8000/edgar/status
http://localhost:8000/halts/status
```

## Development Principles

1. **Test-First Development** - Write tests before implementation when applicable
2. **Fail Early, Fail Often** - Small, testable steps only (max 15 min per task)
3. **Explicit Over Implicit** - Clear error messages, no silent failures
4. **Atomic Commits** - One logical change per commit
5. **Database First** - All schema changes via numbered migrations

## Common Workflows

Use these slash commands for specific tasks:
- `/verify` - Verification mode (check existing code)
- `/bug-fix` - Bug fix workflow
- `/feature` - Feature development workflow
- `/db-migration` - Database migration helper
- `/monitor` - Monitor service workflow

## Current State Check

Please check:
1. Git branch and last commit
2. Any uncommitted changes
3. Service status (frontend/backend running?)
4. Recent database migrations applied

## What are you working on today?
