# AGENTS.md — ma-tracker-app

> Instruction file for Codex, OpenClaw, and other agents that discover `AGENTS.md` at repo root.
> For Claude Code, see `CLAUDE.md`. For Cursor, see `.cursorrules` and `.cursor/rules/*.mdc`.

---

## System Overview

This is **ma-tracker-app**, one half of a two-repo system serving https://dr3-dashboard.com.

| Repo | Purpose | Branch | Language |
|------|---------|--------|----------|
| `ma-tracker-app` | Next.js dashboard, FastAPI backend, IB data agent | `main` | TypeScript / Python |
| `py_proj` | KRJ backtester, BMC intraday ML pipeline, market state, research | `cursor-dev` | Python 3.11 |

---

## Architecture

**Three-tier on a single DigitalOcean droplet + Neon DB:**

1. **Frontend** — Next.js 16 (App Router) in Docker on droplet (port 3000)
2. **Backend** — FastAPI/uvicorn on droplet host (port 8000)
3. **Database** — Neon PostgreSQL (cloud-hosted)

```
Browser → Next.js Docker (3000) → FastAPI (8000) → Neon PostgreSQL
                                      ↑ WebSocket
                            Local IB Agents (users' machines)
```

---

## Two Integrated Systems

### System 1: Intelligence Platform (Python/FastAPI)
- **EDGAR Monitor:** Polls SEC.gov every 60s for M&A filings
- **Halt Monitor:** Polls NASDAQ/NYSE every 2s for trading halts
- **Research Worker:** AI-powered deal analysis via Claude API
- Data flow: SEC.gov → staged_deals → human approval → deal_intelligence → research

### System 2: Portfolio Management (Next.js + Prisma)
- Manual deal tracking, position management, option strategy analysis
- IB Data Agent: connects to users' local IB TWS via WebSocket relay
- Execution engine: 100ms eval loop for automated strategies

---

## Cross-Repo BMC Dependency

The IB Data Agent imports BMC modules from py_proj via `BMC_PATH` env var.

**Strategy file:** `python-service/standalone_agent/strategies/big_move_convexity.py`

### 9 Imports from py_proj (Breaking Change Boundary)

```python
from big_move_convexity.live.data_store import LiveDataStore
from big_move_convexity.bars.bar_accumulator import BarAccumulator
from big_move_convexity.ml.model_registry import ModelRegistry
from big_move_convexity.live.daily_bootstrap import DailyBootstrap
from big_move_convexity.dpal.polygon_ws import PolygonWebSocketProvider
from big_move_convexity.dpal.polygon_ws_client import PolygonWSClient
from big_move_convexity.features.feature_stack import assemble_feature_vector
from big_move_convexity.ml.inference import predict_single
from big_move_convexity.signal.signal_generator import Signal, SignalConfig, generate_signal
```

If py_proj changes any of these interfaces, this repo's strategy file must be updated in the same session.

---

## Key Commands

```bash
# Development
./dev-start.sh          # Start both backend + frontend
./dev-stop.sh           # Stop all services

# Frontend (Next.js)
npm run dev             # Dev server (port 3000)
npm run build           # Production build
npm run db:push         # Push Prisma schema
npm run db:studio       # Open Prisma Studio

# Backend (FastAPI)
cd python-service && source venv/bin/activate
python3 start_server.py # Start server (port 8000)

# Deploy
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && cd ~/apps && docker compose build --no-cache web && docker compose up -d --force-recreate web'

# Python-only deploy (no Docker rebuild)
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && kill $(lsof -t -i :8000) 2>/dev/null; sleep 2 && cd python-service && source .venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &'
```

---

## IB Data Agent

- Runs on users' local machines, connects to IB TWS/Gateway
- Communicates with server via WebSocket relay
- Multi-agent support: each user has their own agent
- Auto-update system: version.txt checked on startup

**Agent files:** `python-service/standalone_agent/`
**Strategy files:** `python-service/standalone_agent/strategies/`

---

## Constraints

### Security
- Never commit API keys or secrets. Use env vars and `<PLACEHOLDER>`.
- Never use `allow_origins=["*"]` in production CORS.
- Validate all ticker input via `validate_ticker()` (pattern: `^[A-Z]{1,10}$`).
- Security headers enabled by default in `next.config.ts`.

### Docker Build Rules
- ALWAYS use `docker compose build` (never bare `docker build`).
- ALWAYS pass `--no-cache` when deploying.
- ALWAYS pass `--force-recreate` to `docker compose up`.

### Data Pipeline
- Never overwrite production KRJ data during deploys.
- `~/apps/data/krj/` on droplet is owned by the Saturday cron job.
- Preserve CSV filenames and column names.

### Release Notes (MANDATORY)
- Every user-visible change MUST be documented in `release-notes/YYYY-MM-DD.json`.
- Generate screenshots with `python-service/tools/release_screenshots.py`.
- Never skip this step.

### Code Quality
- Read before writing. Minimal diffs only.
- Auto-deploy after completing code changes (push + Docker rebuild).
- Use `threading.Event` for IB data waits, not `time.sleep()`.
- All IB relay endpoints must have `RequestTimer` instrumentation.

### UI Design
- High-density trader dashboards: minimize vertical space.
- Dark, high-contrast theme (bg-gray-950, text-gray-100).
- Every data table gets a column chooser.
- SEC EDGAR autocomplete on all ticker inputs.

---

## Agent Coordination

- Multiple agents (Claude Code, Cursor, Codex) work on this repo.
- Check `.claude-session` and recent commits before architectural changes.
- Guidance changes affecting both repos must update `docs/agent/SHARED_BLOCK.md` in both.
- Run `docs/agent/check_sync.sh` to verify sync.
