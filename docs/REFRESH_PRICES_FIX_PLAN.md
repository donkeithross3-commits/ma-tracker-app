# Fix Plan: "Refresh Prices" Functionality

## Problem Statement
The "Refresh Prices" button on the Monitor tab is not working reliably:
1. **Agent spawning fails** - `update-spread-prices` route spawns agents incorrectly (wrong python, wrong cwd)
2. **No automatic UI updates** - When fresh data arrives, the Monitor tab doesn't refresh automatically
3. **Stale data reuse** - Freshness window prevents refetching when user explicitly requests refresh

## Root Causes (Confirmed by Debug Logs)

### 1. Agent Spawn Configuration Mismatch
- **`fetch-chain` route (WORKS):**
  - Uses: `python-service/.venv/bin/python3`
  - CWD: `python-service/`
  - Result: `.env.local` is found ✓
  
- **`update-spread-prices` route (FAILS):**
  - Uses: `python3` (system python)
  - CWD: `/Users/donaldross/dev/ma-tracker-app`
  - Result: `.env.local` not found, missing dependencies ✗
  - Error: `"AGENT_ID must be set in .env.local"`

### 2. Freshness Logic Issues
- Current: 4-hour window prevents refetching
- User expectation: **Always fetch fresh data when explicitly requested**
- Current behavior violates user's intent

### 3. No Real-Time UI Updates
- When new snapshots are created (e.g., from Curate tab), Monitor tab doesn't know
- User must manually click "Refresh Prices" to see updates
- No polling, no websockets, no server-sent events

## Desired Behavior (User Requirements)

1. **Always fetch fresh data on explicit refresh**
   - "Refresh Prices" button → always call IB API
   - "Load Option Chain" button → always call IB API
   - No caching/staleness checks when user explicitly requests data

2. **Automatic UI updates**
   - When new snapshots are created anywhere in the app, Monitor tab should update automatically
   - No manual refresh needed

3. **Persist all price data**
   - Every price fetch saves to database with timestamp
   - Historical audit trail preserved

## Implementation Plan

### Phase 1: Fix Agent Spawning (CRITICAL - BLOCKING)
**File:** `/app/api/ma-options/update-spread-prices/route.ts`

**Changes:**
1. Copy the `spawnPriceAgent` function from `fetch-chain/route.ts`
2. Use venv python: `python-service/.venv/bin/python3`
3. Set `cwd: pythonServicePath` 
4. Add 3-minute timeout
5. Check for `RESULT_SUCCESS: True` in stdout

**Why:** This matches the working implementation in `fetch-chain`

**Test:** Click "Refresh Prices" → agents should succeed (check logs for exit code 0)

---

### Phase 2: Remove Freshness Checks on Explicit Refresh
**Files:** 
- `/app/api/ma-options/update-spread-prices/route.ts`
- `/app/api/ma-options/fetch-chain/route.ts`

**Current Logic:**
```typescript
// Check for recent snapshots (4 hours)
const recentSnapshot = await prisma.optionChainSnapshot.findFirst({
  where: { snapshotDate: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } }
});
if (recentSnapshot) {
  return cached data; // DON'T REFETCH
}
```

**New Logic:**
```typescript
// When user clicks "Refresh" or "Load", ALWAYS spawn agent
// No freshness checks - user is explicitly requesting fresh data
await spawnPriceAgent(ticker, dealPrice, closeDate);

// Then fetch the newly created snapshot
const freshSnapshot = await prisma.optionChainSnapshot.findFirst({
  where: { 
    ticker, 
    snapshotDate: { gte: new Date(Date.now() - 10 * 1000) } // Last 10 seconds
  }
});
```

**Why:** User clicking a button is an explicit request for fresh data, not a passive cache lookup

**Trade-offs:**
- ✓ User gets exactly what they asked for
- ✓ No confusion about why data isn't updating
- ✗ More IB API calls (but that's the intent)
- ✗ Slower (~30-60s per ticker vs instant cache)

**Test:** 
1. Click "Load Option Chain" for a ticker
2. Wait 5 seconds
3. Click "Load Option Chain" again for same ticker
4. Verify: Agent runs both times, timestamps are different

---

### Phase 3: Automatic UI Updates (Nice-to-Have)
**Options:**

#### Option A: Polling (Simplest)
**File:** `/components/ma-options/MonitoringTab.tsx`

**Changes:**
```typescript
// Current: 30-second auto-refresh of WATCHED spreads only
useEffect(() => {
  const interval = setInterval(() => {
    refreshPrices(); // Calls update-spread-prices API
  }, 30000);
  return () => clearInterval(interval);
}, []);

// Keep this - it's good
// But add: Check for NEW snapshots for watched tickers
useEffect(() => {
  const interval = setInterval(async () => {
    // For each watched spread, check if a newer snapshot exists
    const watchedTickers = [...new Set(spreads.map(s => s.dealTicker))];
    const response = await fetch('/api/ma-options/check-new-snapshots', {
      method: 'POST',
      body: JSON.stringify({ tickers: watchedTickers, since: lastUpdateTime })
    });
    
    if (response.ok) {
      const { hasUpdates } = await response.json();
      if (hasUpdates) {
        refreshPrices(); // Trigger a refresh
      }
    }
  }, 10000); // Check every 10 seconds
  return () => clearInterval(interval);
}, [spreads]);
```

**New API:** `/api/ma-options/check-new-snapshots`
- Input: `tickers[]`, `since` (timestamp)
- Output: `{ hasUpdates: boolean }`
- Logic: Query for snapshots where `ticker IN (...)` AND `snapshotDate > since`

**Pros:** Simple, works across tabs
**Cons:** Polling overhead (negligible for local dev)

---

#### Option B: WebSockets (Overkill for now)
- Requires WebSocket server
- Real-time push notifications
- More complex, but eliminates polling

**Recommendation:** Start with Option A (polling), upgrade to WebSockets later if needed

---

### Phase 4: Add Date to "Last Updated" Timestamp
**File:** `/components/ma-options/WatchedSpreadsTable.tsx`

**Current:**
```typescript
{spread.lastUpdated ? formatTime(spread.lastUpdated) : "Never"}
```

**New:**
```typescript
{spread.lastUpdated ? formatDateTime(spread.lastUpdated) : "Never"}

// Helper function
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }); // "1/7/26, 12:07 PM"
}
```

**Why:** User requested this - timestamps currently only show time, not date

---

## Implementation Order

1. **Phase 1 (BLOCKING):** Fix agent spawning in `update-spread-prices` → Copy working logic from `fetch-chain`
2. **Phase 2 (HIGH PRIORITY):** Remove freshness checks on explicit refresh → Always spawn agents
3. **Phase 4 (QUICK WIN):** Add date to timestamps → 5-minute fix
4. **Phase 3 (NICE-TO-HAVE):** Automatic UI updates → Can be done later

---

## Testing Strategy

### Test 1: Agent Spawning
1. Click "Refresh Prices" on Monitor tab
2. Check server logs for: `"✓ Price agent completed successfully"`
3. Verify: All watched tickers get fresh data
4. Verify: Exit code 0 in debug logs

### Test 2: Explicit Refresh Always Fetches
1. Click "Load Option Chain" for EA
2. Note timestamp
3. Wait 5 seconds
4. Click "Load Option Chain" for EA again
5. Verify: Timestamp is different (new fetch occurred)

### Test 3: Monitor Tab Updates
1. Click "Load Option Chain" for CYBR on Curate tab
2. Switch to Monitor tab
3. Click "Refresh Prices"
4. Verify: CYBR spread shows new data

### Test 4: Timestamp Display
1. Check Monitor tab
2. Verify: "Last Updated" column shows date + time (e.g., "1/7/26, 12:07 PM")

---

## Risks & Mitigation

### Risk 1: Too many IB API calls
- **Risk:** Removing freshness checks → more calls → rate limiting
- **Mitigation:** IB allows ~50 requests/second for market data; we're nowhere near that
- **Monitoring:** Log all agent spawns, track failures

### Risk 2: Slow UI (waiting for agents)
- **Risk:** "Refresh Prices" takes 30-60s per ticker
- **Mitigation:** 
  - Show loading spinner
  - Spawn agents in parallel (already doing this)
  - Consider: Return immediately, poll for updates (Phase 3)

### Risk 3: Multiple concurrent spawns
- **Risk:** User clicks "Refresh" twice quickly → 2 agents for same ticker
- **Mitigation:** 
  - Check for in-progress spawns (map of `ticker → Promise`)
  - Debounce button clicks (UI)

---

## Success Criteria

- [ ] "Refresh Prices" button spawns agents successfully (no `.env.local` errors)
- [ ] All watched tickers get updated on refresh
- [ ] Clicking "Load Option Chain" twice fetches fresh data both times
- [ ] Monitor tab shows updates after Curate tab actions (with manual refresh)
- [ ] "Last Updated" column shows full date + time
- [ ] No regression in existing functionality

---

## Future Enhancements (Post-MVP)

1. **Real-time updates** - WebSockets for instant UI refresh
2. **Batch optimization** - Single agent fetch for multiple spreads on same ticker
3. **Error recovery** - Retry failed agents with exponential backoff
4. **User notifications** - Toast messages for "Fetching fresh data..." and "Updated!"
5. **Audit log** - Track all refresh actions for debugging

