# Development Environment Startup

This project has multiple startup options depending on your needs.

## Quick Start (Recommended)

```bash
npm run dev
```

**Starts:**
- ✅ Python strategy analyzer (port 8000)
- ✅ Next.js dev server (port 3000)

**Use this for:** Local development with full functionality including option spread detection.

---

## Alternative Startup Options

### 1. Next.js Only (No Python Service)

```bash
npm run dev:next-only
```

**Starts:** Next.js only

**Limitations:**
- ❌ Strategy generation won't work (0 candidates)
- ✅ Price fetching still works (uses IB TWS directly)
- ✅ Refresh prices still works

**Use this for:** UI development when you don't need the strategy analyzer.

---

### 2. Full Stack (with Cloudflare Tunnel)

```bash
npm run dev-full
```

**Starts:**
- ✅ Python strategy analyzer (port 8000)
- ✅ Cloudflare tunnel (public URL)
- ✅ Next.js dev server (port 3000)

**Use this for:** Testing with external access or sharing your dev environment.

---

## What's Running Where

| Service | Port | Purpose |
|---------|------|---------|
| **Next.js** | 3000 | Frontend & API routes |
| **Python Strategy Analyzer** | 8000 | Option spread detection & analysis |
| **IB TWS** | 7497 | Interactive Brokers API (external) |
| **PostgreSQL** | 5432 | Database (via Postgres.app) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ User clicks "Load Option Chain" in Curate Tab              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js API: /api/ma-options/fetch-chain                   │
│ - Spawns price_agent.py                                    │
│ - Connects to IB TWS (port 7497)                           │
│ - Fetches full option chain                                │
│ - Saves to database (OptionChainSnapshot)                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js API: /api/ma-options/generate-candidates           │
│ - Calls Python service at http://localhost:8000            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Python Service: POST /options/generate-strategies          │
│ - MergerArbAnalyzer.find_best_opportunities()              │
│ - Analyzes spreads based on deal price & parameters        │
│ - Returns candidate strategies                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ UI displays candidate spreads                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Point:** Strategy generation REQUIRES the Python service on port 8000. Without it, you'll see 0 candidates even if option chain data was fetched successfully.

---

## Troubleshooting

### No strategy candidates appear

**Symptom:** Option chain loads, but 0 candidates shown

**Cause:** Python service not running

**Fix:**
```bash
# Check if Python service is running
curl http://localhost:8000/health

# If it fails, restart dev environment
npm run dev-kill
npm run dev
```

---

### Port 8000 already in use

**Symptom:** Python service fails to start

**Fix:**
```bash
# Find what's using port 8000
lsof -i:8000

# Kill it
kill -9 <PID>

# Or use the kill script
npm run dev-kill
```

---

### IB TWS not connected

**Symptom:** "IB TWS: Disconnected" indicator

**Fix:**
1. Start Interactive Brokers TWS or Gateway
2. Enable API connections in TWS settings
3. Ensure port 7497 is configured
4. Refresh your browser

---

## Related Scripts

- `./scripts/start-dev-with-python.sh` - Simple startup (Python + Next.js)
- `./scripts/start-full-dev.sh` - Full startup (Python + Cloudflare + Next.js)
- `./scripts/kill-dev-processes.sh` - Kill all dev processes

---

## Production Deployment

For production deployment on the DigitalOcean droplet, see:
- `/Users/donaldross/dev/ma-tracker-app/docs/PRODUCTION_DEPLOYMENT.md`

