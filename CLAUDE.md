# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start Commands

### Development Environment

```bash
# Start both backend and frontend services
./dev-start.sh

# Stop all services
./dev-stop.sh

# View logs
tail -f logs/python-backend.log
tail -f logs/nextjs-frontend.log
```

### Python Backend (FastAPI - Port 8000)

**IMPORTANT: Always use the venv Python (Python 3.11+)**

```bash
cd python-service

# Activate venv first (required for all Python commands)
source venv/bin/activate

# Start server (validates env, starts uvicorn)
python3 start_server.py

# Install dependencies
pip install -r requirements.txt

# Run pytest tests (when available)
pytest tests/ -v
```

### Frontend (Next.js - Port 3000)

```bash
# Development server
npm run dev

# Production build
npm run build && npm run start

# Database operations
npm run db:push      # Push schema changes
npm run db:studio    # Open Prisma Studio GUI
npm run db:generate  # Generate Prisma Client
npm run db:seed      # Seed database

# Linting
npm run lint
```

### Background Monitors (via API)

```bash
# Start EDGAR monitor (polls SEC.gov every 60s)
curl -X POST http://localhost:8000/edgar/monitoring/start

# Start Research Worker (processes staged deals with AI)
curl -X POST http://localhost:8000/edgar/research-worker/start

# Check statuses
curl http://localhost:8000/edgar/monitoring/status | python3 -m json.tool
curl http://localhost:8000/halts/status | python3 -m json.tool
```

### Database Migrations

```bash
# Migrations are raw SQL in python-service/migrations/
# Apply via psql:
psql $DATABASE_URL < python-service/migrations/XXX_description.sql

# Or via Python async script (see existing migration application patterns)
```

---

## System Architecture

This is a **dual-architecture M&A deal tracker** with two distinct but integrated systems:

### System 1: Intelligence Platform (Python/FastAPI Backend)

**Purpose**: Autonomous M&A deal discovery, monitoring, and AI-powered analysis

**Core Components**:

1. **EDGAR Monitor** (`app/api/edgar_routes.py`)
   - Polls SEC.gov every 60 seconds for M&A filings (8-K, S-4, 425, 14D-9, DEFM14A)
   - Detects deal relevance using keyword matching
   - Creates "staged deals" requiring human approval
   - Stores in `edgar_filings` and `staged_deals` tables

2. **Halt Monitor** (`app/monitors/halt_monitor.py`)
   - Polls NASDAQ/NYSE every 2 seconds for trading halts
   - Auto-starts on server startup (see `app/main.py` startup event)
   - Links M1/M2 halt codes (merger-related) to active deals
   - Stores in `halt_events` table

3. **Research Worker** (edgar_routes.py research functions)
   - Processes approved staged deals
   - Uses Claude AI to generate comprehensive deal reports
   - Fetches related SEC filings and performs deep analysis
   - Stores in `deal_research` table
   - Must be manually started via API endpoint

4. **Intelligence Orchestrator** (`app/intelligence/orchestrator.py`)
   - Monitors external news sources (Reuters, FTC, Seeking Alpha)
   - Cross-references EDGAR filings with news
   - Creates staged deals from non-SEC sources
   - Aggregates deal intelligence across sources

**Data Flow**:
```
SEC.gov → EDGAR Monitor → staged_deals (pending approval)
                              ↓
                         Human approves via API
                              ↓
                      deal_intelligence (active deals)
                              ↓
                      Research Worker (AI analysis)
                              ↓
                      deal_research (comprehensive reports)
```

**Key Tables** (PostgreSQL/Neon):
- `edgar_filings`: Raw SEC filing data
- `staged_deals`: Detected deals awaiting approval (status: pending/approved/rejected)
- `deal_intelligence`: Approved active deals being tracked
- `deal_sources`: Source attribution (which filing/article detected each deal)
- `deal_research`: AI-generated research reports
- `halt_events`: Trading halt data linked to deals
- `production_deal_suggestions`: Suggestions for updating production deal data

### System 2: Portfolio Management (Next.js Frontend + Prisma)

**Purpose**: Manual deal tracking, position management, option strategy analysis

**Core Components**:

1. **Deal Management** (`app/deals/`)
   - Manual deal entry and editing
   - CVR (Contingent Value Rights) tracking
   - Version history (every edit creates new version)
   - Deal snapshots at key moments

2. **Portfolio Tracking** (`app/portfolio/`)
   - Current positions
   - Position history
   - P&L calculations

3. **Options Scanner** (`python-service/app/scanner.py`)
   - Connects to Interactive Brokers API (ibapi)
   - Analyzes merger arbitrage option strategies
   - Works when TWS/IB Gateway is running
   - Calculates expected returns, breakevens, edge vs market

**Key Tables** (Prisma schema):
- `deals`: Manually entered deals
- `dealVersions`: Complete version history
- `dealPrices`: Time-series price data
- `cvrs`: Contingent value rights
- `portfolioPositions`: Actual positions held

### How the Two Systems Integrate

The Intelligence Platform discovers deals automatically, while the Portfolio Management system tracks them manually. They share the same database but operate independently:

- **Intelligence tables**: `deal_intelligence`, `staged_deals`, `edgar_filings`
- **Portfolio tables**: `deals`, `dealVersions`, `portfolioPositions`
- **Shared**: Both can reference the same tickers/companies

---

## Critical Architectural Patterns

### 1. Staged Deal Approval Workflow

**Never automatically create production deals**. All detected deals go through human review:

```python
# WRONG: Directly create deal
deal = await create_deal_intelligence(...)

# RIGHT: Create staged deal for approval
staged = await create_staged_deal(...)
# Human approves via POST /edgar/staged-deals/{id}/approve
# Only then does it become a deal_intelligence record
```

### 2. Background Service Management

All monitors/workers are **manually controlled** via API endpoints:

- Halt Monitor: Auto-starts on server startup
- EDGAR Monitor: Must call `/edgar/monitoring/start`
- Research Worker: Must call `/edgar/research-worker/start`

This prevents runaway API usage and gives control over when services run.

### 3. Database Migrations

**Use raw SQL migrations** in `python-service/migrations/`:

- Number sequentially: `010_description.sql`
- Apply via psql or Python asyncpg script
- Never use Prisma migrations (frontend uses Prisma, backend uses raw SQL)

### 4. AI Integration (Claude API)

Research Worker uses Claude for analysis:

```python
# Pattern: Always pass filing text + context
response = await anthropic_client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=4000,
    messages=[{
        "role": "user",
        "content": f"Analyze this M&A filing:\n\n{filing_text}\n\nExtract: ..."
    }]
)
```

Cost management:
- Research Worker processes queue one at a time
- Must be manually started
- Can be stopped mid-process

### 5. Deal Source Attribution

Every deal must track **which sources detected it**:

```python
# When creating staged deal, always create deal_sources entries
async with conn.transaction():
    deal_id = await create_staged_deal(...)
    await create_deal_source(deal_id, source_url, source_name, headline)
```

This enables multi-source verification and confidence scoring.

---

## Important Constraints and Gotchas

### Environment Variables

**Backend** (`python-service/.env`):
```
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
SENDGRID_API_KEY=SG...  # Optional
```

**Frontend** (`.env.local` - optional):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The backend's `start_server.py` validates env vars exist before starting.

### Database Access Patterns

**Backend**: Direct asyncpg queries (no ORM)
```python
import asyncpg
conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
rows = await conn.fetch("SELECT * FROM staged_deals WHERE status = $1", "pending")
```

**Frontend**: Prisma ORM
```typescript
import { prisma } from "@/lib/db"
const deals = await prisma.deals.findMany()
```

### File Paths and Absolute Paths

- Python uses **absolute path to Anaconda**: `/Users/donaldross/opt/anaconda3/bin/python3`
- All scripts expect to be run from project root: `/Users/donaldross/ma-tracker-app`

### Windows-Specific Considerations

**The backend runs on Windows** in staging/production environments:

1. **Encoding**: Always use UTF-8 for console output
   - Windows console defaults to `cp1252` encoding
   - Avoid unicode symbols (✓, ✗, etc.) in print statements
   - Wrap stdout/stderr with UTF-8 TextIOWrapper if needed

2. **File Paths**: Use cross-platform path handling
   ```python
   from pathlib import Path
   # Good: Path("logs") / "backend.log"
   # Bad: "logs\\backend.log"  # Unix incompatible
   ```

3. **Line Endings**: Git handles CRLF/LF conversion automatically
   - Python files: LF (Unix)
   - Batch files: CRLF (Windows)

4. **Process Management**:
   - Use `dev-start.bat` and `dev-stop.bat` for Windows
   - Use `dev-start.sh` and `dev-stop.sh` for Mac/Linux (development)

5. **Deployment**: The `deploy-staging.bat` script handles Windows backend deployment
   - Always test encoding-sensitive code on Windows before deploying
   - Check `logs/python-backend.log` after deployment for errors

### Testing Infrastructure

**Test framework**: pytest (tests not yet written - see TESTING_PLAN.md)

Current testing approach:
1. Manual API testing via curl
2. Database verification via psql
3. Functional testing (documented in TESTING_FINDINGS.md)

**Do not assume tests exist** - they are planned but not implemented.

### Logging and Debugging

All logs go to:
- `logs/python-backend.log` - FastAPI/uvicorn output
- `logs/nextjs-frontend.log` - Next.js dev server output

Backend uses Python `logging` module:
```python
import logging
logger = logging.getLogger(__name__)
logger.info("...")
```

---

## Session State Tracking

This project uses `.claude-session` (gitignored) to track progress across sessions. When working:

1. Read `.claude-session` at start of session to understand current state
2. Update it as you make progress
3. Note completed tasks, blockers, and next steps

See `start-claude-session.sh` for session initialization.

---

## Common Workflows

### Adding a New Monitor Service

1. Create monitor class in `app/monitors/`
2. Add API routes in `app/api/` for start/stop/status
3. Create database tables in new migration
4. Register routes in `app/main.py`
5. Add startup/shutdown hooks if needed

### Adding a Database Migration

1. Create `python-service/migrations/XXX_description.sql`
2. Write SQL with proper constraints and indexes
3. Test locally: `psql $DATABASE_URL < migrations/XXX_description.sql`
4. Document in migration log

### Testing a New Feature

1. Check TESTING_PLAN.md for component
2. Run manual tests first (curl, psql)
3. Document findings in TESTING_FINDINGS.md
4. Create pytest tests (when test suite exists)
5. Update `.claude-session` with progress

---

## External Services

- **SEC EDGAR**: Public API, rate-limited (10 requests/sec)
- **NASDAQ/NYSE Halt Pages**: Scraped with BeautifulSoup
- **Interactive Brokers**: Requires TWS/Gateway running locally
- **Anthropic Claude**: API key required, costs money per request
- **SendGrid**: Optional email service
- **Neon PostgreSQL**: Cloud-hosted database

---

## Deployment Architecture

### Production Environment

**Three-tier architecture on a single DigitalOcean droplet + Neon DB**:

1. **Frontend** (Next.js in Docker on Droplet)
   - URL: https://dr3-dashboard.com
   - Runs as `ma-tracker-app-web` container via `docker-compose.yml`
   - Image tag: `ma-tracker-app-prod:latest` (defined in `docker-compose.yml`)
   - Built from `Dockerfile.prod` (multi-stage: builder → runner)

2. **Backend** (FastAPI on Droplet — bare metal, not Docker)
   - Runs directly on the droplet host via uvicorn on port 8000
   - The Docker container reaches the host via `host.docker.internal`
   - Also runs on Windows locally for IB TWS access during development

3. **Database** (PostgreSQL on Neon)
   - Cloud-hosted PostgreSQL database
   - Accessed by both frontend and backend via `DATABASE_URL`

### Architecture Diagram
```
User Browser
    ↓
Next.js Docker container (port 3000, droplet)
    ↓ API calls via host.docker.internal
FastAPI (port 8000, droplet host)
    ↓                          ↑ WebSocket
PostgreSQL (Neon Cloud)    Local IB Agents (users' machines)
```

### Docker Build System — How It Works

The Next.js frontend runs inside a Docker container on the droplet.
Understanding how this build pipeline works is critical to avoid deployment bugs.

**Image lifecycle:**
1. `docker compose build web` builds from `Dockerfile.prod` and tags as `ma-tracker-app-prod:latest`
2. `docker compose up -d --force-recreate web` stops the old container and starts a new one from that image
3. Files inside the container are **baked in at build time** — they do NOT update when you `git pull`

**Key facts:**
- The `docker-compose.yml` (in `~/apps/`) defines `image: ma-tracker-app-prod:latest`
- You MUST use `docker compose build` (not bare `docker build`) so the image gets the correct tag
- A bare `docker build -t ma-tracker-app-dev .` creates an image that compose **silently ignores**
- The standalone agent bundle is copied into the image (`Dockerfile.prod` line: `COPY ... standalone_agent`)
- The `/api/ma-options/agent-version` endpoint reads `version.txt` from **inside the container**, not from the host filesystem
- So `git pull` alone does NOT update the agent version — you must rebuild the image

**Correct deploy command:**
```bash
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && cd ~/apps && docker compose build --no-cache web && docker compose up -d --force-recreate web'
```

**Why `--no-cache`?** BuildKit layer caching can serve stale `COPY . .` content even after `git pull` changes files on disk.

**Why `--force-recreate`?** Without it, compose may decide the container already matches and skip replacement.

**`.dockerignore` and the agent bundle:**
- `python-service/` is excluded from the Docker build context
- `!python-service/standalone_agent/` re-includes the agent directory
- This means only `standalone_agent/` is available inside the image — the rest of `python-service/` is not

### Deployment Process

**Full deploy** (Next.js + agent bundle changes):
```bash
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && cd ~/apps && docker compose build --no-cache web && docker compose up -d --force-recreate web'
```

**Python service only** (no Docker rebuild needed):
```bash
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && kill $(lsof -t -i :8000) 2>/dev/null; sleep 2 && cd python-service && source .venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &'
```

### IB Gateway Access

The IB Data Agent architecture means the backend no longer needs direct IB TWS access:
- Users run a local agent on their own machine (Windows/Mac) with IB TWS
- The agent connects to the server via WebSocket relay
- The server routes requests to the user's own agent
- See "IB Data Agent Architecture" in `.cursorrules` for full details

---

## Changelog & Release Notes System

### Overview

Weekly release notes live at `/changelog` (summary) and `/changelog/[date]` (detail with large images and accessible fonts). Screenshots are generated programmatically from production using Playwright + Pillow.

### Architecture

- **Release data**: `release-notes/YYYY-MM-DD.json` — one JSON file per release
- **Screenshots**: `public/changelog/YYYY-MM-DD/*.png` — generated annotated images
- **Data reader**: `lib/changelog.ts` — server-side utility (reads from filesystem)
- **Pages**: `app/changelog/page.tsx` (summary), `app/changelog/[date]/page.tsx` (detail)
- **Screenshot tool**: `python-service/tools/release_screenshots.py`
- **Tool deps**: `python-service/tools/requirements.txt` (playwright, Pillow — dev only)
- **Docker**: `Dockerfile.prod` copies `release-notes/` into the runner stage

### Weekly Release Note Workflow

1. Create `release-notes/YYYY-MM-DD.json` describing the week's features
2. Run the screenshot tool to generate annotated images:
   ```bash
   cd python-service
   source .venv/bin/activate
   python tools/release_screenshots.py \
     --config ../release-notes/YYYY-MM-DD.json \
     --email "don.keith.ross3@gmail.com" --password "limitless2025"
   ```
3. Commit everything (JSON + PNGs) and deploy — the changelog page picks it up automatically

### Screenshot Tool Usage

```bash
# Against production (default)
python tools/release_screenshots.py --config ../release-notes/2026-02-08.json --email EMAIL --password PASS

# Against local dev
python tools/release_screenshots.py --config ../release-notes/2026-02-08.json --base-url http://localhost:3000 --email EMAIL --password PASS

# Debug mode (visible browser)
python tools/release_screenshots.py --config ../release-notes/2026-02-08.json --headed --email EMAIL --password PASS

# Prerequisites (one-time)
pip install playwright Pillow
playwright install chromium
```

### Annotation Best Practices (Lessons Learned)

1. **Always use element selectors over manual bbox coordinates.** Selectors like `button:has-text('NDX100')` or `th:has-text('Mkt Cap')` resolve to real DOM elements at runtime. Manual pixel coordinates are fragile and break when layout shifts.

2. **The Annotator handles DPR scaling automatically.** It compares actual image dimensions to the CSS viewport to detect the device pixel ratio. All coordinates passed to annotations should be in CSS pixels — scaling is internal.

3. **Use `from_offset` for arrow annotations.** Instead of absolute `from` coordinates, use `"from_offset": [-60, -50]` to position the arrow start relative to the target element. This keeps arrows anchored even if the target moves.

4. **Headless Chromium on macOS defaults to DPR=1**, but the tool is DPR-aware as a safety net. Font sizes, stroke widths, and padding all scale proportionally.

5. **The DR3_dev account (`don.keith.ross3@gmail.com`) is used for screenshots** because it has the default password. Features requiring IB connectivity (Account tab, trade ticket, working orders) cannot be captured with this account — leave those as `"screenshot": null` and the detail page shows a "screenshot pending" placeholder.

6. **Category badges**: signals (blue), positions (emerald), intel (purple), portfolio (amber), options (cyan), general (gray). Defined in `lib/changelog.ts` `getCategoryStyle()`.

### Release Note JSON Format

```json
{
  "date": "2026-02-08",
  "title": "Week of Feb 2–8, 2026",
  "summary": "One-line release summary.",
  "features": [
    {
      "id": "feature-slug",
      "title": "Feature Title",
      "summary": "One-liner for the summary page",
      "description": "Detailed description with \\n\\n for paragraphs",
      "category": "signals|positions|options|intel|portfolio|general",
      "image": "/changelog/2026-02-08/feature-slug.png",
      "screenshot": {
        "path": "/krj",
        "actions": [
          { "type": "wait", "ms": 2000 },
          { "type": "click", "selector": "text=NDX100" },
          { "type": "wait", "ms": 2000 }
        ],
        "viewport": { "width": 1400, "height": 900 },
        "annotations": [
          {
            "type": "circle",
            "selector": "button:has-text('NDX100')",
            "label": "Annotation label"
          },
          {
            "type": "arrow",
            "selector": "th:has-text('Mkt Cap')",
            "label": "Arrow label",
            "from_offset": [-60, -50]
          }
        ]
      }
    }
  ]
}
```

---

## Documentation References

- `DEVELOPMENT.md`: Comprehensive development guide
- `TESTING_PLAN.md`: Systematic testing roadmap
- `TESTING_FINDINGS.md`: Test results and known issues
- `.claude-session`: Current session state
- `README.md`: Project overview
