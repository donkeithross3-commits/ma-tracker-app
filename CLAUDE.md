# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

> Full agent contract: [docs/agent/AGENTS.md](docs/agent/AGENTS.md)

---

## Operational Rules

<!-- BEGIN SHARED BLOCK — DO NOT EDIT — source: docs/agent/SHARED_BLOCK.md -->
## Cross-Repo Agent Contract (Shared Block)

> **Canonical source:** `docs/agent/SHARED_BLOCK.md` in each repo.
> This block MUST appear identically in `.cursorrules` and `CLAUDE.md` in BOTH repos.
> Run `docs/agent/check_sync.sh` to verify sync. See `docs/agent/AGENTS.md` for full contract.

### Two-Repo System

This codebase is ONE HALF of a two-repo system. Both repos serve https://dr3-dashboard.com.

| Repo | Purpose | Branch | Language |
|------|---------|--------|----------|
| `ma-tracker-app` | Next.js dashboard, FastAPI backend, IB agent | `main` | TypeScript / Python |
| `py_proj` | KRJ backtester, market state pipelines, research | `cursor-dev` | Python |

**Shared infra:** Droplet `134.199.204.12` (SSH alias: `droplet`), Neon PostgreSQL, Docker.

### Multi-Device Sync

- Before ending a session, commit and push all changes.
- Use `pushall` to sync both repos before switching machines.
- Production domain: https://dr3-dashboard.com

### Security & Privacy

- **Never log, print, or commit secrets** (API keys, DB credentials, auth tokens). Use `***` to confirm a secret is set.
- **Never commit real API keys or passwords** to source files, markdown, or comments. Use `<PLACEHOLDER>` or env vars.
- **Never use `allow_origins=["*"]`** in production CORS config.
- **Validate all user input** at system boundaries (ticker symbols, query params, form data).
- **Do not expose internal paths, IPs, or infra details** in client-facing code or public docs.

### Release Notes (MANDATORY)

The dashboard has a continuous release notes system. Every user-visible change MUST be documented:

1. Create or update `release-notes/YYYY-MM-DD.json` in `ma-tracker-app` (see format in CLAUDE.md).
2. Generate screenshots with `python-service/tools/release_screenshots.py` when applicable.
3. Commit JSON + PNGs together. The changelog pages (`/changelog`) pick them up automatically.
4. **Never skip this step.** Users rely on the changelog to understand what changed.

### Agent Coordination

- **You are not the only agent working on this system.** Both Claude Code and Cursor work on these repos.
- Before making architectural changes, check for in-progress work in `.claude-session` or recent commits.
- Guidance changes that affect both repos must update BOTH copies of `SHARED_BLOCK.md` and re-embed.
- Repo-specific guidance stays in that repo's `.cursorrules` / `CLAUDE.md` only.
- Read `docs/agent/AGENTS.md` for the full contract including onboarding and change protocol.
<!-- END SHARED BLOCK -->

### Push and Deploy on Task Completion (AUTO-DEPLOY)

When you **complete a task** that changed code in this repo:

1. **Commit** the relevant files with a clear message.
2. **Push** to `origin main`: `git push origin main`
3. **Deploy** to production via the flock-gated deploy script:
   ```bash
   # Web/full deploy:
   ssh droplet 'DR3_AGENT=claude bash ~/apps/scripts/deploy.sh web'

   # Python-service-only deploy (no Docker rebuild):
   ssh droplet 'DR3_AGENT=claude bash ~/apps/scripts/deploy.sh python-service'

   # Portfolio container only:
   ssh droplet 'DR3_AGENT=claude bash ~/apps/scripts/deploy.sh portfolio'
   ```
   **Do NOT copy repo `data/krj/` into `~/apps/data/krj/` on deploy.** Production KRJ data is owned by the Saturday cron job on the droplet (`/home/don/apps/scripts/run_krj_weekly.sh` — full pipeline: backtester + copy). If deploy runs `cp -r ... data/krj/* ... data/krj/`, it overwrites the job's output with stale repo data and reverts the dashboard to old dates.

Do this **automatically** at the end of the task -- do not wait for the user to ask. The agent has permission to push and deploy.

- `deploy.sh` handles git pull, --no-cache, --force-recreate, and health checks automatically.
- If the deploy fails with a lock error, another deploy is in progress — wait and retry.
- **NEVER run raw `docker compose build` or `docker compose up` on the droplet.** Always use `deploy.sh`.

### Security and Latency Non-Negotiables

These rules apply to ALL code changes in this repository.

**Security:**
- **Never log secrets.** Do not print, log, or expose API keys, database credentials, auth tokens, or their prefixes. Use `***` if you need to confirm a secret is set.
- **Never use `allow_origins=["*"]` in production.** CORS origins are configured via the `CORS_ALLOWED_ORIGINS` env var. Default: `https://dr3-dashboard.com,http://localhost:3000`.
- **Never commit real API keys or passwords** to source files, markdown docs, or comments. Use `<PLACEHOLDER>` or env vars.
- **Always validate ticker input.** Use `validate_ticker()` (in `options_routes.py`) for query params or the `_pydantic_ticker_validator` field_validator for Pydantic models. Tickers must match `^[A-Z]{1,10}$`.
- **Security headers are enabled by default** via `next.config.ts`. Disable with `ENABLE_SECURITY_HEADERS=false` only if debugging.

**Latency / Instrumentation:**
- **All IB relay endpoints must have `RequestTimer` instrumentation** (from `app/utils/timing.py`). Log `[perf]` lines with operation name, per-stage timing, and payload size.
- **Use `threading.Event` for IB data waits, not `time.sleep()`.** IB returns tick data via callbacks on a separate thread; `Event.wait(timeout=N)` exits instantly when the callback fires (typically 50-100ms) while still having a safety timeout. See `fetch_underlying_data` in `ib_scanner.py` as the reference pattern: set `self._underlying_done = Event()` before `reqMktData`, call `.wait(timeout=3.0)`, and `.set()` in `tickPrice` when the LAST price arrives.
- **Polling intervals** in React components must skip ticks when `document.hidden` to avoid wasting resources when the tab is backgrounded.
- **The `computeGroups()` call in `IBPositionsTab.tsx`** must be wrapped in `useMemo` keyed on `filteredPositions`.

**Feature Flags:**
```python
# Python: env-var flags
FEATURE = os.environ.get("FEATURE_NAME", "default_value")
```
```typescript
// Next.js: env-var flags
const FEATURE = process.env.FEATURE_NAME !== "false"
```

---

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

## Deployment Architecture

### Production Environment

**Three-tier architecture on a single DigitalOcean droplet + Neon DB**:

1. **Frontend** (Next.js in Docker on Droplet)
   - URL: https://dr3-dashboard.com
   - Runs as `ma-tracker-app-web` container via `docker-compose.yml`
   - Image tag: `ma-tracker-app-prod:latest` (defined in `docker-compose.yml`)
   - Built from `Dockerfile.prod` (multi-stage: builder -> runner)

2. **Backend** (FastAPI on Droplet -- bare metal, not Docker)
   - Runs directly on the droplet host via uvicorn on port 8000
   - The Docker container reaches the host via `host.docker.internal`
   - Also runs on Windows locally for IB TWS access during development

3. **Database** (PostgreSQL on Neon)
   - Cloud-hosted PostgreSQL database
   - Accessed by both frontend and backend via `DATABASE_URL`

### Architecture Diagram
```
User Browser
    |
Next.js Docker container (port 3000, droplet)
    | API calls via host.docker.internal
FastAPI (port 8000, droplet host)
    |                          ^ WebSocket
PostgreSQL (Neon Cloud)    Local IB Agents (users' machines)
```

### Docker Build -- Critical Rules

- **ALWAYS use `docker compose build`**, never bare `docker build`.
  `docker-compose.yml` defines the image tag as `ma-tracker-app-prod:latest`.
  A bare `docker build -t <anything-else>` produces an image that compose ignores --
  the container keeps running the old `ma-tracker-app-prod:latest` image silently.
- **ALWAYS pass `--no-cache`** when deploying. BuildKit layer caching can serve stale
  copies of `COPY . .` even after `git pull` updates files on disk.
- **ALWAYS pass `--force-recreate`** to `docker compose up`. Without it, compose may
  decide the existing container already matches and skip replacement.
- The standalone agent bundle (`python-service/standalone_agent/`) is copied into the
  Docker image at build time. The `/api/ma-options/agent-version` endpoint reads
  `version.txt` from inside the running container, NOT from disk. So a `git pull` alone
  does nothing -- the image must be rebuilt and the container recreated.
- **Static assets (images, PNGs) in `public/` are baked into the Docker image.**
  After regenerating screenshots or other assets, you MUST rebuild + recreate the container.
  Even then, **browsers cache images aggressively** -- if the URL doesn't change, users see
  stale content. The changelog system handles this with mtime-based `?v=` cache-busting
  (see `app/changelog/[date]/page.tsx`). Apply the same pattern for any other static assets
  that change after initial deployment.

**`.dockerignore` and the agent bundle:**
- `python-service/` is excluded from the Docker build context
- `!python-service/standalone_agent/` re-includes the agent directory
- This means only `standalone_agent/` is available inside the image -- the rest of `python-service/` is not

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
SEC.gov -> EDGAR Monitor -> staged_deals (pending approval)
                                |
                           Human approves via API
                                |
                        deal_intelligence (active deals)
                                |
                        Research Worker (AI analysis)
                                |
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

## IB Data Agent Architecture

### Overview
The IB Data Agent runs on users' local machines and connects to their IB TWS/Gateway.
It communicates with the server via WebSocket relay, allowing the dashboard to fetch
real-time options data through users' own IB accounts.

### Data Flow
```
User's Browser <---> Next.js API <---> Python Service <--WebSocket--> Local IB Agent <---> IB TWS
```

### Key Components

**Server-side (python-service/app/api/):**
- `ws_relay.py` - WebSocket relay that manages agent connections
  - `DataProviderRegistry` - Tracks all connected agents by provider_id and user_id
  - `validate_api_key()` - Checks API key against database or legacy key
  - Agents authenticate with their API key on WebSocket connect
- `options_routes.py` - HTTP endpoints that forward requests to agents
  - `/relay/ib-status` - Queries ALL connected agents, returns connected=true if ANY has IB
  - `/relay/test-futures` - Finds agent with IB connected, sends request there
  - `/relay/fetch-chain` - Fetches option chain via agent (passes user_id for routing)

**Client-side (python-service/standalone_agent/):**
- `ib_data_agent.py` - Main agent that connects to WebSocket relay and IB TWS
- `ib_scanner.py` - IB API wrapper for fetching quotes and option chains
- `start_windows.bat` - Windows launcher with auto-update, shortcut creation
- `start_unix.sh` - Mac/Linux launcher with same features
- `config.env` - User's API key and IB connection settings (generated per-user)
- `version.txt` - Current version (NO trailing newline -- use `printf "x.y.z" > version.txt`)

**Download endpoints (app/api/ma-options/):**
- `download-agent/route.ts` - Initial download (requires auth, includes config.env with API key)
- `download-agent-update/route.ts` - Update download (uses API key auth, excludes config.env)
- `agent-version/route.ts` - Returns current version (public endpoint for update checks)

### Multi-Agent Support
- Multiple agents can connect simultaneously (each user has their own)
- Each agent is identified by provider_id (random UUID) and user_id (from API key)
- When fetching data, requests are routed to the user's own agent if available
- Status checks query ALL agents and return connected=true if ANY has IB connected

### Auto-Update System
1. Agent starts, reads local `version.txt`
2. Calls `/api/ma-options/agent-version` to get server version
3. If different, prompts user to update
4. Downloads from `/api/ma-options/download-agent-update?key=xxx`
5. Extracts new files (preserves config.env with user's API key)
6. User restarts to use new version

### Versioning Rules
When making changes to agent files in `python-service/standalone_agent/`:
1. Edit the files
2. **BUMP THE VERSION** in `version.txt` using: `printf "x.y.z" > version.txt`
3. Deploy as normal -- users' agents auto-update on next startup

Version format: MAJOR.MINOR.PATCH
- PATCH: Bug fixes, minor improvements (1.0.2 -> 1.0.3)
- MINOR: New features, non-breaking changes (1.0.3 -> 1.1.0)
- MAJOR: Breaking changes requiring manual intervention (1.1.0 -> 2.0.0)

### Files Included in Agent Download
See `app/api/ma-options/download-agent/route.ts`:
- Python files: ib_data_agent.py, ib_scanner.py, install.py
- Scripts: start_windows.bat, start_windows.ps1, start_unix.sh
- Config: requirements.txt, README.md, config.env.template, version.txt
- Directories: python_bundle/ (Windows Python), ibapi/ (IB API library)

### Public Endpoints (no auth required)
Defined in `auth.config.ts` under `isInternalAPI`:
- `/api/ma-options/validate-agent-key` - Called by Python service to validate keys
- `/api/ma-options/agent-version` - Called by agent for update checks
- `/api/ma-options/download-agent-update` - Called by agent for updates (uses API key param)

### Troubleshooting
- **Agent shows connected but dashboard says disconnected**: (1) Call `GET /api/ib-connection/relay-registry` (or `GET /options/relay/registry` on Python). If `providers_connected` is 0, the agent is not registered (wrong RELAY_URL or auth failed). If > 0, call `GET /options/relay/ib-status` and check `provider_statuses` for timeout/error. (2) Python relay must run with a single uvicorn worker (in-memory registry is per-process). (3) Hover the red status dot for the last error (e.g. relay timeout).
- **Agent connected, market data works, but orders fail / order book empty**: Read-Only API is checked in TWS. Uncheck it, Apply, restart agent.
- **Update downloads but extraction fails**: Check ZIP is valid (not HTML error page), file size > 1KB
- **Version always shows update available**: Check for whitespace in version.txt (use printf, not echo)

---

## Execution Engine Architecture

### Component Map

| File | Role | Thread |
|------|------|--------|
| `resource_manager.py` | IB market data line accounting (100 lines shared) | Any (thread-safe) |
| `quote_cache.py` | Persistent streaming subscriptions via `reqMktData(snapshot=False)` | IB msg thread writes, exec thread reads |
| `execution_engine.py` | Strategy eval loop (100ms) + async order placement | `exec-engine` (eval), `order-exec` (orders) |
| `ib_scanner.py` | Scan requests (batch request-sleep-cancel) + streaming tick routing | IB msg thread for callbacks |
| `ib_data_agent.py` | Orchestrator: creates all components, dispatches requests, sends telemetry | Async event loop |
| `ws_relay.py` | Server-side: priority tiers, per-provider scan semaphore, telemetry storage | FastAPI async |
| `options_routes.py` | HTTP endpoints: `/relay/execution/*` and `/relay/agent-state` | FastAPI async |

### Critical Path (Latency-Sensitive)

The execution loop runs entirely local -- no network in the critical path:
```
IB TWS -> tickPrice callback -> quote_cache.update_price -> Quote object (in-memory)
exec-engine thread -> quote_cache.get -> strategy.evaluate -> OrderAction
                                                                  | (non-blocking submit)
order-exec thread -> scanner.place_order_sync -> IB TWS
```
The eval loop NEVER blocks on IB order acknowledgment. Order placement runs on a
dedicated single-worker `order-exec` thread via `ThreadPoolExecutor(max_workers=1)`.

Latency budget (DEFAULT_EVAL_INTERVAL=100ms):
- Quote-to-eval: 0-100ms (uniform, dominated by sleep interval; median ~50ms)
- Eval-to-order-submit: <0.1ms (non-blocking queue submission)
- Order-submit-to-TWS-ack: ~5-50ms (on order-exec thread, does NOT stall eval)

Safety caps:
- `MAX_INFLIGHT_ORDERS = 10` -- if exceeded, order actions are dropped
- `ORDER_TIMEOUT_SEC = 10.0` -- per-order TWS acknowledgment timeout

Never add network calls or blocking I/O to the eval loop.

### Resource Management Rules

- Standard IB account: 100 simultaneous market data lines, shared across TWS + all API clients
- `ResourceManager` tracks execution streaming lines vs scan lines
- Scanner reads `resource_manager.scan_batch_size` (dynamic, max 50) for chunk sizing
- When execution holds N lines, scans get `100 - N - 10(buffer)` lines
- `accept_external_scans` is `False` when available lines < 10

### Priority Tiers (ws_relay.py)

| Tier | Request Types | Throttling |
|------|--------------|------------|
| 1 (account) | `get_positions`, `place_order`, `modify_order`, `cancel_order`, `get_open_orders` | Never delayed, never fallback |
| 2 (scan) | `fetch_chain`, `fetch_prices`, `sell_scan`, `fetch_underlying`, `test_futures` | Semaphore(1) for external borrowers on exec-active agents |
| 3 (status) | `ib_status`, `check_availability` | No throttling |
| 4 (execution) | `execution_start`, `execution_stop`, `execution_status`, `execution_config` | Own agent only |

### Adding a New Strategy

1. Create a class extending `ExecutionStrategy` in a new file (e.g., `strategies/spread_entry.py`)
2. Implement `get_subscriptions(config)`, `evaluate(quotes, config)`, `on_fill(order_id, fill_data, config)`
3. Register in `_create_strategy()` in `ib_data_agent.py`
4. Strategy receives quotes as `Dict[cache_key, Quote]` -- all subscribed instruments
5. Return `List[OrderAction]` from `evaluate()` -- empty list = do nothing
6. **Duplicate prevention**: Order placement is async (non-blocking). A strategy returning
   the same OrderAction on consecutive evals will queue duplicate orders. Strategies must
   track their own order state (e.g., "order pending for AAPL") and suppress duplicates.
   Check `StrategyState.inflight_orders` to see how many are in the pipeline.

### Tick Routing in ib_scanner.py

Every `tickPrice`/`tickSize`/`tickOptionComputation` callback checks streaming cache first:
```python
if self.streaming_cache is not None and self.streaming_cache.is_streaming_req_id(reqId):
    self.streaming_cache.update_price(reqId, tickType, price)
    return  # <-- fast path, skip scan logic
# ... existing scan logic unchanged ...
```
The two paths are distinguished by which dict the reqId appears in. Never mix them.

### Agent State Protocol

Agent sends `agent_state` with every heartbeat (~10s) and `execution_telemetry` every ~20s when engine is running. Server stores latest values on `DataProvider` for low-latency dashboard queries.

### Version Bumping

Any change to agent files requires bumping `version.txt` (use `printf`, not `echo`):
- PATCH for bug fixes: `printf "1.1.1" > version.txt`
- MINOR for new features: `printf "1.2.0" > version.txt`
- New .py files must be added to BOTH download routes (`download-agent/route.ts` and `download-agent-update/route.ts`)

---

## Real-Time Account Event Push Architecture

### Data Flow (target: <500ms end-to-end)

```
IB TWS thread (orderStatus/execDetails callback)
  -> scanner._account_event_callback()              [instant, same thread]
  -> loop.call_soon_threadsafe(asyncio.ensure_future, _push())  [~1ms]
  -> agent pushes JSON over WebSocket to relay       [~10-50ms]
  -> ws_relay.py stores in per-user deque            [instant]
  -> frontend polls GET /relay/account-events every 500ms
  -> detects new events -> triggers fetchPositions() + fetchOpenOrders()
```

### Three Layers

1. **Scanner** (`ib_scanner.py`): Queues events in `_account_events` deque (thread-safe
   with Lock). Also calls `_account_event_callback` if set -- this is the instant path.

2. **Agent** (`ib_data_agent.py`): Registers the callback at startup via
   `scanner.set_account_event_callback()`. The callback uses `call_soon_threadsafe` to
   bridge the IB thread to the asyncio event loop, then sends over WebSocket. A fallback
   `_account_event_push_loop` (10s interval) drains any events the callback missed.

3. **Relay** (`ws_relay.py`): Stores events in `ProviderRegistry._account_events`
   (per-user deque, maxlen=200). The `GET /relay/account-events?user_id=X&since=T`
   endpoint returns events newer than timestamp T.

### Key Design Decisions

- **Callback + fallback, not just polling.** The instant callback handles 99% of events.
  The 10s fallback loop is a safety net for edge cases (WebSocket briefly disconnected).
- **`call_soon_threadsafe` is critical.** The IB API callbacks run on a non-asyncio thread.
  You cannot `await` inside them. The only safe way to schedule async work (like WebSocket
  send) is `loop.call_soon_threadsafe(asyncio.ensure_future, coroutine)`.
- **Frontend polls, not WebSocket.** The frontend uses simple HTTP polling (500ms) rather
  than a separate WebSocket connection. This keeps the frontend simple and avoids managing
  another persistent connection. The polling endpoint is lightweight (no DB query, just
  in-memory deque filter).
- **Events are ephemeral.** The deque has maxlen=200. Events older than a few minutes are
  dropped. The frontend uses them only as a trigger to refresh -- it doesn't parse event
  details for display.

---

## IB TWS API Settings -- Required Configuration

When working on the IB Data Agent or any code that connects to IB TWS via the API,
these three TWS settings (under File -> Global Configuration -> API -> Settings) must be
correctly configured. Reference this when debugging agent connectivity or onboarding users.

### 1. Enable ActiveX and Socket Clients -- Must be CHECKED

The master API switch. When off (the TWS default), TWS refuses all incoming socket
connections. Our agent's `EClient.connect()` will fail. Nothing works without this.

- TWS default: **OFF**
- IB Gateway default: **ON**

### 2. Read-Only API -- Must be UNCHECKED

When checked (the IB default), TWS blocks:
- Order placement: `placeOrder`, `cancelOrder`
- Order information: `reqOpenOrders`, `reqAutoOpenOrders`, `openOrder`/`orderStatus` callbacks

When checked, these still work normally:
- Market data: `reqMktData`, `reqMarketDataType`
- Contract lookups: `reqContractDetails`, `reqSecDefOptParams`
- Positions: `reqPositions`
- Account data: `reqAccountUpdates`

Our agent calls `reqAutoOpenOrders(True)` and `reqOpenOrders()` on connect
(`ib_scanner.py` `connect_to_ib`). With Read-Only enabled these silently return
nothing -- the live order book stays empty and `placeOrder` is rejected.

**Key debugging insight**: If a user reports "agent is connected, market data works,
but orders fail / order book is empty", the first thing to check is Read-Only API.

### 3. Socket Port

| Application | Live | Paper |
|-------------|------|-------|
| TWS         | 7496 | 7497  |
| IB Gateway  | 4001 | 4002  |

Our agent defaults to port 7497 (paper) via `config.env`. The code is not sensitive
to paper vs live -- all API calls work identically on both. The port just determines
which TWS session receives the connection.

Users must ensure:
1. The port in `config.env` matches the port shown in TWS API Settings
2. If running both paper and live TWS, they connect to the intended one

### Optional but Recommended
- **Trusted IP Addresses**: Add `127.0.0.1` to avoid the TWS confirmation popup on each connect.
- **Master Client ID**: Leave unset (our agent uses clientId=0 for `reqAutoOpenOrders` compatibility).

---

## IB Contract Resolution -- Lessons Learned

### conId Is King, But Exchange Is Still Required for Futures

When resolving a contract via `conId`:
- Set **only** `contract.conId` and `contract.exchange`. Do NOT set `symbol`, `secType`,
  `lastTradeDateOrContractMonth`, or `multiplier`. IB validates ALL fields together and
  returns Error 200 ("no security definition") if any field conflicts with the conId.
- Futures **always** need an explicit exchange -- `SMART` routing does not work for futures.
  Without it, IB returns Error 321 ("Please enter exchange").

### Futures Exchange Mapping

IB uses specific exchange names that don't always match common expectations:

| Futures | IB Exchange | Note |
|---------|-------------|------|
| ES, NQ, RTY, MES, MNQ, M2K, YM, MYM | CME | E-mini / Micro indices |
| SI, GC, HG, SIL, MGC | **COMEX** | Metals -- NOT NYMEX |
| PL, PA | NYMEX | Platinum, Palladium |
| CL, NG, RB, HO, MCL | NYMEX | Energy |
| ZB, ZN, ZF, ZT, UB | CBOT | Treasuries |
| ZC, ZS, ZW, ZM, ZL | CBOT | Grains |
| 6E, 6J, 6B, 6A, 6C, 6S | CME | FX futures |

The mapping lives in `_FUTURES_EXCHANGE` in `ib_data_agent.py`. When adding new futures,
look up the exact exchange in TWS contract details -- don't assume NYMEX for metals.

### Frontend -> Agent Data Flow for Quotes

When fetching prices for non-stock instruments (futures, options), the full contract
metadata must travel the entire chain:

```
IBPositionsTab.tsx (fetchQuote with contractMeta + conId)
  -> /api/ma-options/stock-quote/route.ts (pass-through)
  -> options_routes.py relay_stock_quote (pass-through)
  -> ib_data_agent.py _handle_fetch_underlying (builds Contract)
  -> ib_scanner.py fetch_underlying_data (executes reqMktData)
```

If any link drops the metadata, the agent defaults to `STK` on `SMART` which fails
for futures. Always pass `conId` when available -- it's the most reliable identifier.

### Deduplication of Frontend Requests

Multiple `useEffect` hooks and callbacks in `IBPositionsTab.tsx` can trigger `fetchQuote`
for the same ticker simultaneously. Use a `useRef<Set<string>>` (e.g., `inFlightQuotesRef`)
to track in-flight requests and skip duplicates. Without this, the agent processes requests
sequentially, and N duplicate requests for one ticker block all other tickers for N x RTT.

### Event-Based Early Exit Pattern

For any IB request that uses callbacks (market data, contract details, etc.):

```python
self._done_event = Event()
self.reqMktData(req_id, contract, "", False, False, [])
self._done_event.wait(timeout=3.0)   # exits in ~50ms when tick arrives
self._done_event = None
self.cancelMktData(req_id)
```

Signal the event in the callback (e.g., `tickPrice`) when the critical data arrives.
This cuts latency from the timeout value to the actual IB response time.

---

## Framework & Conventions

- This is a **Next.js 16** app using the **App Router**.
- `/app/krj/page.tsx`:
  - Reads CSVs from `data/krj/*.csv`.
  - Should remain read-only (no mutations), just a report viewer for KRJ signals.
  - Do not change the CSV location or naming scheme without explicit instruction.
- `middleware.ts`:
  - Provides NextAuth v5 authentication. Protected routes redirect to `/login`.
  - Do not remove or relax this auth without explicit instruction.
- Styling:
  - Use Tailwind utility classes consistent with existing patterns.

### Ticker Input Convention -- SEC EDGAR Autocomplete

**Every UI where a user types a ticker symbol MUST use the SEC EDGAR autocomplete pattern.**
- API endpoint: `GET /api/ticker-lookup?q=<query>` (returns `{ matches: { ticker, name }[] }`)
- Debounced search (300ms) with loading spinner
- Dropdown shows ticker (monospace, blue) + company name
- Keyboard navigation: ArrowUp/Down to move, Enter to select, Escape to close
- Click-outside closes dropdown
- On submit/add, validate exact ticker match exists in SEC EDGAR; show error if not found:
  `"Ticker not found in SEC EDGAR. Type a few letters and pick from the list."`
- Current implementations (follow these as reference):
  - `components/ma-options/AddDealForm.tsx` -- Add Deal form
  - `components/ma-options/IBPositionsTab.tsx` -- Add manual ticker modal
  - `components/krj/TickerEditorModal.tsx` -- Edit ticker lists (DRC, ETFs/FX, etc.)

---

## UI Design Principles -- HIGH DENSITY TRADER DASHBOARDS

- **Ruthlessly minimize vertical space**: Every pixel counts on trading dashboards.
  - Page padding: `px-3 py-2` (not `p-4` or larger)
  - Margins between sections: `mb-1` to `mb-3` (not `mb-4` or `mb-6`)
  - Tab lists: `mb-3` after tabs, `py-1.5` for tab triggers
  - Filter/control rows: inline layout with `py-1.5 px-3`, not stacked with `p-4`
  - Section spacing: `space-y-3` (not `space-y-6`)
- **Combine related elements on single rows**:
  - Title + subtitle on same row block (subtitle below title, no extra margin)
  - Status indicators + action buttons + user menu all on one header row
  - Filter labels inline with filter controls, not stacked
- **Keep font sizes readable but reduce surrounding whitespace**:
  - Maintain text-2xl for page titles, text-sm for body text
  - Reduce padding/margin around text, not the text size itself
- **Dark, high-contrast theme**: bg-gray-950, text-gray-100, no decorative fluff
- **Right-aligned numeric columns** with limited decimals and compact units
- **Allow header labels to wrap** rather than adding horizontal scroll
- **Place summary elements above/below tables**, not at the side
- **User-controlled column visibility on every data table** -- see UI Configurability below

- `/app/krj/page.tsx` is a trader-facing report. Follow `docs/krj_ui_style.md`.
- Do not change CSV loading or data logic without explicit request.
- Styling changes should be implemented via Tailwind classes and small formatting helpers only.

---

## UI Configurability Architecture

### Philosophy

Two users with opposite needs use the same dashboard:
- **Compact / Power User**: wants maximum data density, many columns visible, small padding.
  This is the default mode. KRJ signals page is the reference implementation.
- **Comfort / Accessible User**: has Parkinson's, needs larger touch targets (44px min),
  bigger text, more padding. IBPositionsTab (trade buttons, position boxes) is the reference.

Each screen has a **native density** -- it was originally designed for one user type.
The Comfort Mode toggle provides an optimized alternate view, not a uniform scale.

Key design rules:
- **Never auto-hide columns.** If content overflows, shrink font/padding fluidly. The user
  decides which columns to remove via the Column Chooser.
- **Comfort mode must scale intelligently** with screen width and visible column count.
  Fixed breakpoints break on external monitors / varying column selections.
- **Keep the system lightweight.** One JSONB column, one React context, one CSS density layer.
  No per-table persistence endpoints, no database migrations for new tables.

### System Components

#### 1. Database Layer

Single JSONB column on `user_preferences`:
```sql
ALTER TABLE user_preferences ADD COLUMN ui_prefs JSONB DEFAULT '{}';
```

Schema in `prisma/schema.prisma`:
```prisma
uiPrefs Json? @map("ui_prefs")
```

Shape of `uiPrefs`:
```typescript
interface UIPrefs {
  densityMode?: "compact" | "comfort" | null   // null = compact (default)
  columnVisibility?: {
    [tableKey: string]: string[]  // ordered array of visible column keys
  }
}
```

Adding a new table's columns requires NO migration -- just use a new key in `columnVisibility`.

#### 2. API Layer

`/api/user/preferences` (GET / PUT) -- existing endpoint extended with `uiPrefs` field.
All preference categories (maOptionsPrefs, dealListPrefs, uiPrefs, customTickers) are
fetched in one call and persisted atomically via upsert.

#### 3. React Context -- `UIPreferencesProvider`

**File:** `lib/ui-preferences.tsx`

Wraps the app in `app/layout.tsx` inside `<SessionProvider>`. Provides:
- `prefs` / `loaded` -- full preferences object and loading state
- `isComfort` / `toggleDensity()` -- density mode state and toggle
- `getVisibleColumns(pageKey)` -- returns `string[] | null` (null = use defaults)
- `setVisibleColumns(pageKey, columns)` -- persists column selection
- `updatePrefs(partial)` -- generic deep-merge for any preference category

**Persistence strategy:**
- All updates are debounced (600ms) to avoid chatty API calls
- On unmount / navigation, `sendBeacon` flushes any pending save
- Single source of truth -- eliminates read-modify-write race conditions

**Density attribute:**
- Sets `data-density="comfort"` on `<html>` immediately on state change
- CSS custom properties in `globals.css` respond to this attribute

#### 4. CSS Density System

**File:** `app/globals.css`

Two tiers of CSS custom properties:
```
:root                        -> compact defaults (KRJ-calibrated)
[data-density="comfort"]     -> comfort overrides (IB Positions-calibrated)
```

Variables: `--d-table-py`, `--d-table-px`, `--d-table-font`, `--d-header-font`,
`--d-row-min-h`, `--d-btn-*`, `--d-action-btn-*`, `--d-section-gap`, `--d-card-*`

**Fluid table scaling (comfort mode only):**
```css
.d-table-wrap { container-type: inline-size; }

[data-density="comfort"] .d-table th,
[data-density="comfort"] .d-table td {
  font-size: clamp(0.875rem, calc(100cqi / var(--visible-cols, 15) / 6), 1.375rem);
  /* similar clamp() for padding */
}
```

Tables opt in by:
1. Wrapping in `<div className="d-table-wrap" style={{ "--visible-cols": N }}>`
2. Adding `className="d-table"` to the `<table>`

The `--visible-cols` CSS variable is set by React from the length of the visible columns
array, enabling font/padding to scale proportionally as columns are added/removed.

**Global interactive element scaling (comfort mode):**

| Selector | Compact | Comfort |
|----------|---------|---------|
| `button` | native | 44px min-height, larger font |
| `button > svg` | h-3.5 to h-4 | 20px (1.25rem) !important |
| `input`, `textarea`, `select` | native | 44px min-height, 1rem font |
| `[role="checkbox"]` | 16px (h-4 w-4) | 24px (1.5rem) !important |
| `[role="menuitem"]` etc. | native | 44px rows, 1rem font |
| `[role="tab"]` | native | 44px, 1.125rem, 0.625rem padding |
| `[role="dialog"]` | p-6 | 1.5rem padding, 1.375rem titles |
| `.cursor-grab > svg` | h-4 w-4 | 24px (1.5rem) !important |
| `.divide-y > div/li` | native | 44px min-height, flex center |
| `.text-xs` | 0.75rem | promoted to 0.875rem !important |

These rules live in `@layer components` so they have correct specificity. Elements
inside `.d-table` are excluded to avoid double-scaling with the fluid table system.

**Escape hatches:**
- `.no-density` class on any element opts it out of all comfort scaling
- `.inline-edit` class on inputs opts them out of comfort min-height/font scaling.
  Use on compact inline editing inputs (e.g. order qty/price fields in tables).
  Unlike `.no-density` which suppresses ALL comfort rules, `.inline-edit` targets
  only the input sizing rules that break tight inline layouts.
- `.d-table input` elements are automatically excluded via a CSS override rule
  (higher specificity beats the global input rule). This works reliably across
  browsers, unlike the previous `:not(.d-table input)` complex selector in `:not()`.

#### 5. ColumnChooser Component

**File:** `components/ui/ColumnChooser.tsx`

Fully generic, reusable Radix dropdown with checkboxes. Props:
- `columns: ColumnDef[]` -- all available columns (key + label)
- `visible: string[]` -- currently visible keys (order-preserved)
- `defaults: string[]` -- default set (used by "Reset to defaults" action)
- `onChange: (keys: string[]) => void` -- callback when visibility changes
- `locked?: string[]` -- columns that cannot be hidden (greyed out checkbox)
- `size?: "sm" | "md"` -- button size variant

Behavior:
- Toggling a column inserts it at its position in the master column order
- Cannot hide all columns (at least 1 must remain)
- "Reset to defaults" button appears only when current differs from defaults
- Menu stays open on toggle (onSelect preventDefault)

#### 6. Comfort Mode Toggle

**File:** `components/UserMenu.tsx`

A switch in the user menu dropdown. Uses `useUIPreferences()` for `isComfort` and
`toggleDensity`. Available on every page since UserMenu is in the global header.

### Adding Column Chooser to a New Table -- Step by Step

```typescript
// 1. Import
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

// 2. Define columns outside the component (module-level constants)
const MY_COLUMNS: ColumnDef[] = [
  { key: "ticker", label: "Ticker" },
  { key: "price", label: "Price" },
  { key: "volume", label: "Volume" },
  // ...
];
const MY_DEFAULTS = MY_COLUMNS.map(c => c.key);  // or a subset
const MY_LOCKED = ["ticker"];  // can't be hidden

// 3. Inside the component
const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
const savedCols = getVisibleColumns("myTableKey");
const visibleKeys = useMemo(() => savedCols ?? MY_DEFAULTS, [savedCols]);
const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
const handleColsChange = useCallback(
  (keys: string[]) => setVisibleColumns("myTableKey", keys),
  [setVisibleColumns]
);

// 4. Render the chooser (typically in a header/toolbar area)
<ColumnChooser
  columns={MY_COLUMNS}
  visible={visibleKeys}
  defaults={MY_DEFAULTS}
  onChange={handleColsChange}
  locked={MY_LOCKED}
/>

// 5. Wrap the table for comfort-mode fluid scaling
<div className="overflow-x-auto d-table-wrap"
     style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
  <table className="w-full text-sm d-table">
    <thead>
      <tr>
        {visibleSet.has("ticker") && <th>Ticker</th>}
        {visibleSet.has("price") && <th>Price</th>}
        {/* ... */}
      </tr>
    </thead>
    <tbody>
      {rows.map(row => (
        <tr key={row.id}>
          {visibleSet.has("ticker") && <td>{row.ticker}</td>}
          {visibleSet.has("price") && <td>{row.price}</td>}
          {/* ... */}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Tables with Column Choosers (current inventory)

| Table Key            | Component                        | Page/Tab           | Locked Columns       |
|----------------------|----------------------------------|--------------------|----------------------|
| `krj`                | KrjTabsClient                    | /krj               | ticker               |
| `watchedSpreads`     | WatchedSpreadsTable              | M&A Options Monitor| ticker               |
| `candidateStrategies`| CandidateStrategiesTable         | M&A Options Curator| ticker               |
| `optionChain`        | OptionChainViewer                | M&A Options Curator| strike               |
| `dealSelector`       | ScannerDealSelector              | M&A Options Curator| ticker, actions      |
| `ibPositions`        | IBPositionsTab (positions)       | M&A Options Account| symbol, trade        |
| `ibOrders`           | IBPositionsTab (working orders)  | M&A Options Account| symbol, action       |

### Strategy Sub-Columns (Shared)

`StrategyColumns.tsx` exports shared header/cell components used by both
WatchedSpreadsTable and CandidateStrategiesTable. These accept an optional
`visibleCols?: Set<string>` prop. When undefined, all columns render
(backward-compatible). The strategy column keys are:
`strikes`, `legPrices`, `market`, `midEntry`, `farEntry`

The `midEntry` and `farEntry` groups are treated as atomic units -- each controls
3 sub-columns (Cost, Profit, IRR) together. The `colSpan` for their grouped
header row dynamically counts visible sub-columns.

### Print Layout Integration

`KrjPrintLayout` accepts `visibleColumns` and only renders columns the user has
selected. Column abbreviations and formatting are handled within the print layout
to keep printed output readable at any column count.

When adding print support to other tables, follow the same pattern: pass the
visible column set to the print component and filter accordingly.

### Components with Targeted Comfort Mode Logic

- **TickerEditorModal** (`components/krj/TickerEditorModal.tsx`): Uses `isComfort` from
  `useUIPreferences()` to switch up/down arrow buttons from stacked vertical (`flex-col`)
  to horizontal (`flex-row`) layout, increase icon sizes, add padding/hover backgrounds,
  enlarge drag handles, and scale autocomplete suggestion row padding. The `.no-density`
  class is used on the arrow/delete buttons to prevent the global CSS from adding
  `min-height: 44px` (which would distort the stacked layout in compact mode).

- **Trade Ticket** (`components/ma-options/IBPositionsTab.tsx`): Already designed with
  44px+ touch targets from the start (min-h-[52px] to min-h-[72px], text-xl to text-4xl).
  No comfort mode branching needed -- it's inherently accessible.

### Gotchas and Lessons Learned

1. **The `ColumnChooser` is a named export**, not a default export.
   Use: `import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser"`

2. **Always define column constants at module level**, not inside the component.
   This avoids re-creating arrays on every render and prevents infinite loops with
   `useMemo` dependencies.

3. **`colSpan` in grouped headers must be dynamic.** If a table has grouped headers
   (e.g. "Midpoint Entry" spanning Cost/Profit/IRR), compute colSpan by counting
   how many sub-columns are visible: `colSpan={["cost","profit","irr"].filter(k => visibleSet.has(k)).length}`

4. **Footer/totals `colSpan` must also be dynamic.** If the first N columns are
   spanned with "Totals", count how many of those are actually visible.

5. **Comfort mode CSS only activates on opted-in tables** -- those with `d-table-wrap`
   and `d-table` classes. This means existing tables that haven't been converted yet
   are unaffected by the density toggle.

6. **Don't fight the fluid scaling.** In comfort mode, `clamp()` handles font sizing.
   Don't add fixed `text-xs` or `text-sm` classes to cells inside a `d-table` -- they
   override the fluid values. Use them only in compact mode or on non-table elements.

7. **The global comfort CSS uses `!important` on SVG sizes and checkboxes.** This is
   necessary because Tailwind utility classes (`h-3.5`, `w-4`) have single-class
   specificity that beats `[data-density="comfort"] button > svg`. If a component needs
   to override, use the `.no-density` escape hatch and manage sizing with `isComfort`.

8. **Elements inside `.d-table` are excluded from global scaling.** The fluid table
   system handles its own font/padding via container queries. Adding global button/input
   scaling inside tables would cause double-scaling. If a table needs larger controls
   (like in-cell edit inputs), handle it with component-level `isComfort` checks.

9. **Position box persistence uses `updatePrefs` directly**, not `setVisibleColumns`.
   The IBPositionsTab's selected ticker boxes are stored in `maOptionsPrefs.selectedTickers`,
   not in `columnVisibility`. The column chooser is a separate concern from position
   box selection.

10. **Prefer global CSS over per-component comfort logic.** The broad CSS selectors in
    `globals.css` handle ~90% of interactive elements automatically. Only add `isComfort`
    branching in a component if the global CSS causes layout breakage (e.g., stacked
    icon buttons that need a layout change, not just a size change). This keeps the
    codebase lightweight and prevents comfort-mode boilerplate from spreading.

11. **Use `.no-density` with `isComfort` together.** When a component needs custom
    comfort logic, add `.no-density` to the element to suppress the global CSS rules,
    then use `isComfort` to apply the right classes. Example: the TickerEditorModal
    arrow buttons use `.no-density` to prevent 44px min-height (which breaks the
    stacked layout), then conditionally apply `p-1.5 rounded hover:bg-gray-700` and
    larger icon sizes when `isComfort` is true.

12. **ARIA roles power the global selectors.** The comfort CSS targets `[role="tab"]`,
    `[role="checkbox"]`, `[role="menuitem"]`, `[role="dialog"]`, etc. Components using
    Radix UI primitives get these roles automatically. Custom components that don't use
    Radix may need explicit `role` attributes to benefit from global scaling.

13. **The trade ticket was designed accessible-first.** Unlike other screens where compact
    is the default, the IBPositionsTab trade ticket uses 52-72px buttons and text-xl to
    text-4xl fonts. This is the gold standard for what comfort mode should feel like.
    When designing new interactive overlays (order entry, risk dialogs), use the trade
    ticket sizing as the reference, not the compact KRJ table sizing.

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

### Windows-Specific Considerations

**The backend runs on Windows** in staging/production environments:

1. **Encoding**: Always use UTF-8 for console output
   - Windows console defaults to `cp1252` encoding
   - Avoid unicode symbols in print statements
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

**Do not assume tests exist** -- they are planned but not implemented.

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

## Changelog & Release Notes System

### Overview

Weekly release notes live at `/changelog` (summary) and `/changelog/[date]` (detail with large images and accessible fonts). Screenshots are generated programmatically from production using Playwright + Pillow.

### Architecture

- **Release data**: `release-notes/YYYY-MM-DD.json` -- one JSON file per release
- **Screenshots**: `public/changelog/YYYY-MM-DD/*.png` -- generated annotated images
- **Data reader**: `lib/changelog.ts` -- server-side utility (reads from filesystem)
- **Pages**: `app/changelog/page.tsx` (summary), `app/changelog/[date]/page.tsx` (detail)
- **Screenshot tool**: `python-service/tools/release_screenshots.py`
- **Tool deps**: `python-service/tools/requirements.txt` (playwright, Pillow -- dev only)
- **Docker**: `Dockerfile.prod` copies `release-notes/` into the runner stage
- **Cache-busting**: Detail page uses `unoptimized` Image + mtime-based `?v=` query params

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
3. Commit everything (JSON + PNGs) and deploy -- the changelog page picks it up automatically

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

2. **The Annotator handles DPR scaling automatically.** It compares actual image dimensions to the CSS viewport to detect the device pixel ratio. All coordinates passed to annotations should be in CSS pixels -- scaling is internal.

3. **Use `from_offset` for arrow annotations.** Instead of absolute `from` coordinates, use `"from_offset": [-60, -50]` to position the arrow start relative to the target element. This keeps arrows anchored even if the target moves.

4. **Headless Chromium on macOS defaults to DPR=1**, but the tool is DPR-aware as a safety net. Font sizes, stroke widths, and padding all scale proportionally.

5. **The DR3_dev account (`don.keith.ross3@gmail.com`) is used for screenshots** because it has the default password. Features requiring IB connectivity (Account tab, trade ticket, working orders) cannot be captured with this account -- leave those as `"screenshot": null` and the detail page shows a "screenshot pending" placeholder.

6. **Category badges**: signals (blue), positions (emerald), intel (purple), portfolio (amber), options (cyan), general (gray). Defined in `lib/changelog.ts` `getCategoryStyle()`.

7. **Image caching will bite you.** Next.js `<Image>` serves optimized images through `/_next/image` which browsers cache aggressively. If you regenerate screenshots but keep the same URL, users see stale images. The fix has two parts:
   - The `<Image>` component uses `unoptimized` to bypass the `/_next/image` proxy entirely
   - `imageSrcWithCacheBust()` in `app/changelog/[date]/page.tsx` appends `?v={mtime}` to every image URL based on the file's modification timestamp -- so when PNGs change on disk, the URL changes and browsers fetch fresh copies
   - **This is why regenerating screenshots and redeploying "just works"** -- no need to ask users to hard-refresh

8. **Always verify screenshots from the actual served URL, not just locally.** When debugging annotation positioning, fetch the image directly from production AND from the `/_next/image` proxy URL. Compare both to rule out server-side vs browser-side caching.

9. **The screenshot tool produces deterministic output.** Given the same page state and selectors, the tool generates byte-identical PNGs. If `git diff` shows no changes to PNGs after re-running the tool, the annotations were already correct -- the issue is elsewhere (usually caching).

### Release Note JSON Format

```json
{
  "date": "2026-02-08",
  "title": "Week of Feb 2-8, 2026",
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

## Cross-Repo BMC Dependency

The IB Data Agent's `BigMoveConvexityStrategy` imports modules from `py_proj` via the `BMC_PATH` environment variable.

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

If py_proj changes any of these interfaces, the strategy file in this repo must be updated in the same session.

**BMC_PATH resolution:** Defaults to `../../py_proj` relative to `standalone_agent/`. Override with `BMC_PATH` env var.

---

## Session State Tracking

This project uses `.claude-session` (gitignored) to track progress across sessions. When working:

1. Read `.claude-session` at start of session to understand current state
2. Update it as you make progress
3. Note completed tasks, blockers, and next steps

See `start-claude-session.sh` for session initialization.

---

## Documentation References

- `DEVELOPMENT.md`: Comprehensive development guide
- `TESTING_PLAN.md`: Systematic testing roadmap
- `TESTING_FINDINGS.md`: Test results and known issues
- `.claude-session`: Current session state
- `README.md`: Project overview
