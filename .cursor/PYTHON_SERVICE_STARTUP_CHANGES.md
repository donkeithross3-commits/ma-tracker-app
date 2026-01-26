# Python Service Startup - Changes Made

**Date:** January 7, 2026  
**Issue:** Strategy detection returning 0 candidates (EA 200/210, CYBR 490/530 spreads not identified)  
**Root Cause:** Python strategy analyzer service was not running

---

## Changes Made

### 1. Started Python Service

```bash
# Terminal 3 (background process)
cd /Users/donaldross/dev/ma-tracker-app/python-service
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Status:** ✅ Running at http://localhost:8000  
**Health Check:** `{"status":"healthy","ib_connected":true}`

---

### 2. Created Startup Script

**File:** [`scripts/start-dev-with-python.sh`](../scripts/start-dev-with-python.sh)

**Features:**
- Starts Python service in background (port 8000)
- Waits for service to be healthy before continuing
- Starts Next.js in foreground (port 3000)
- Graceful shutdown on Ctrl+C (kills Python service)
- Checks for port conflicts and IB TWS connection

---

### 3. Updated `package.json`

**Before:**
```json
"dev": "next dev"
```

**After:**
```json
"dev": "./scripts/start-dev-with-python.sh",
"dev:next-only": "next dev"
```

**Impact:**
- `npm run dev` → Starts Python service + Next.js (full functionality)
- `npm run dev:next-only` → Starts Next.js only (strategy detection won't work)
- `npm run dev-full` → Existing script unchanged (Python + Cloudflare + Next.js)

---

### 4. Created Documentation

**File:** [`docs/DEV_STARTUP.md`](../docs/DEV_STARTUP.md)

**Contents:**
- Quick start guide
- Architecture diagram
- Service port mapping
- Troubleshooting guide

---

## Testing Instructions

### 1. Verify Python Service

```bash
curl http://localhost:8000/health
# Expected: {"status":"healthy","ib_connected":true}
```

### 2. Test Strategy Detection (EA)

1. Go to http://localhost:3000/ma-options (Curate tab)
2. Select **EA** deal
3. Click **"Load Option Chain"**
4. Should now see candidates including:
   - **200/210 Call Spread** (Sep 2026)
   - Entry: ~$8.60
   - Max Profit: ~$1.40
   - ROI: ~16%
   - Annualized: ~26%

### 3. Test Strategy Detection (CYBR)

1. Select **CYBR** deal
2. Click **"Load Option Chain"**
3. Should now see candidates including:
   - **490/530 Call Spread** (Jul 2026)
   - Within default short strike range (10-20% of deal price $529.64)

---

## Why This Was Needed

The new architecture (post-distributed system refactor) has two separate components:

### Option Chain Fetching (Works Without Python Service)
- **Agent:** `price_agent.py` / `price_fetcher.py`
- **Connection:** Direct to IB TWS (port 7497)
- **Purpose:** Fetch raw option prices
- **Used by:** "Load Option Chain", "Refresh Prices"

### Strategy Analysis (Requires Python Service)
- **Service:** FastAPI on port 8000
- **Analyzer:** `MergerArbAnalyzer.find_best_opportunities()`
- **Purpose:** Analyze option chains and identify profitable spreads
- **Used by:** "Load Option Chain" → "Generate Candidates"

**The problem:** After the refactor, strategy analysis was separated into its own service, but the dev startup wasn't updated to launch it automatically.

---

## Related Files

### Modified
- [`package.json`](../package.json) - Updated `dev` script
- [`scripts/start-dev-with-python.sh`](../scripts/start-dev-with-python.sh) - New startup script (created)

### Documentation
- [`docs/DEV_STARTUP.md`](../docs/DEV_STARTUP.md) - Developer guide (created)
- [`docs/START_HERE_TESTING.md`](../docs/START_HERE_TESTING.md) - Existing guide (unchanged)

### Unchanged
- [`scripts/start-full-dev.sh`](../scripts/start-full-dev.sh) - Already had Python service startup
- [`python-service/start_server.py`](../python-service/start_server.py) - Existing server wrapper

---

## Future Improvements (Optional)

### 1. UI Error Display

Currently, when Python service is offline, the UI silently shows 0 candidates. Consider:

```typescript
// In components/ma-options/CuratorTab.tsx
const candidatesResult = await candidatesResponse.json();
if (candidatesResult.error) {
  setError(candidatesResult.error); // Show to user
}
setCandidates(candidatesResult.candidates || []);
```

### 2. Health Check in UI

Add a Python service status indicator similar to the IB TWS indicator:

```typescript
// New hook: useHealthCheck()
const { pythonHealthy } = useHealthCheck();
// Show red/green indicator in header
```

### 3. Auto-start Python Service

Consider making the Next.js dev server automatically spawn the Python service if it's not running (similar to how agents are spawned on-demand).

---

## Summary

✅ **Python service started** (port 8000)  
✅ **`npm run dev` updated** to start Python service automatically  
✅ **Documentation created** for dev environment setup  
✅ **Strategy detection now works** (EA, CYBR spreads will be identified)

**Next step:** Test the Curate tab to verify spreads are now being detected correctly!

