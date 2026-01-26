# Price Agent Testing Checklist

## Pre-Testing Setup

**When**: Monday morning (or next market open)  
**Where**: Local Mac dev environment  
**Prerequisites**:
- [ ] IB TWS is running and logged in
- [ ] TWS API is enabled (File → Global Configuration → API → Settings)
- [ ] Next.js dev server is running (`npm run dev`)
- [ ] PostgreSQL (Postgres.app) is running
- [ ] Python venv is activated for manual tests

## Phase 1: Connection Status

### Test 1.1: Basic Status Check
- [ ] Navigate to `/ma-options`
- [ ] Verify top-right status shows **"IB TWS: Connected"** (green dot)
- [ ] If red: Check TWS is running, API enabled, and restart dev server

**Expected Logs**:
```
GET /api/ib-connection/status 200 in ~2-3s
```

### Test 1.2: Status Persistence
- [ ] Wait 30 seconds
- [ ] Status should remain green (auto-refreshes)
- [ ] No errors in server logs

## Phase 2: Single Ticker (Basic Flow)

### Test 2.1: Load Option Chain - Single Deal
**Ticker**: EA (Electronic Arts)

- [ ] Click on EA deal in the list
- [ ] Click **"Load Option Chain"** button
- [ ] Wait for agent to spawn (may take 5-10 seconds)

**Expected Behavior**:
- [ ] Loading spinner appears
- [ ] Agent spawns in background (check logs)
- [ ] Option chain loads successfully
- [ ] Data shows `source: agent` with recent timestamp (< 1 minute)
- [ ] Expirations and strikes are populated

**Expected Logs**:
```
No recent data for EA, spawning price agent...
Spawning price agent for EA...
[AGENT-OUT] Using agent client ID: 3XX (300-399 range)
[AGENT-OUT] Connected to IB TWS
[AGENT-OUT] Fetching option chain for EA
POST /api/ma-options/fetch-chain 200 in ~10-15s
```

**Red Flags**:
- ❌ "client id already in use" error → See IB_CLIENT_ID_GUIDE.md
- ❌ Timeout > 30s → IB may be slow, check TWS responsiveness
- ❌ "Could not fetch price" → Market may be closed or ticker invalid

### Test 2.2: Verify Data Quality
- [ ] Spot price is reasonable (matches market)
- [ ] Multiple expirations are shown
- [ ] Strikes span a reasonable range around spot price
- [ ] Bid/ask spreads look normal
- [ ] Age shows "< 1 minute"

## Phase 3: Multiple Tickers (Concurrency)

### Test 3.1: Sequential Loading
Load chains for 3 different tickers in sequence:

- [ ] **Ticker 1**: EA
  - Wait for completion
  - Verify data loads
- [ ] **Ticker 2**: AL (Air Lease)
  - Should use cached data if < 2 seconds old
  - Or spawn new agent if no recent data
- [ ] **Ticker 3**: CSGS (CSG Systems)
  - Same as above

**Expected Behavior**:
- [ ] Each ticker loads independently
- [ ] No client ID conflicts (different random IDs)
- [ ] All three show fresh data

### Test 3.2: Rapid Successive Clicks
- [ ] Click "Load Option Chain" on EA
- [ ] Immediately click on AL (don't wait)
- [ ] Check server logs for concurrent agent spawns

**Expected Behavior**:
- [ ] Both agents spawn with different client IDs
- [ ] No conflicts or errors
- [ ] Both chains load successfully (may take longer)

**Acceptable Outcome**:
- One agent completes, the other may timeout/fail (IB rate limits)
- No crashes or hung processes

## Phase 4: Watched Spreads

### Test 4.1: Create Watched Spread
- [ ] Load option chain for EA
- [ ] Click **"Scan"** to generate candidates (if available)
- [ ] Add a candidate to watched spreads
- [ ] Verify spread appears in the list

### Test 4.2: Refresh Spread Prices
- [ ] Click **"Refresh Prices"** on the watched spreads table
- [ ] Verify prices update
- [ ] Check "Last Updated" timestamp is recent

**Expected Behavior**:
- [ ] Spread legs match against recent snapshot data
- [ ] Net premium is recalculated
- [ ] No "Leg not found" errors

**Known Issue**:
- If spread was created with old data (different expirations), legs may not match
- This is expected; spread should be recreated with fresh data

## Phase 5: Edge Cases

### Test 5.1: No Options Available
**Ticker**: Pick a deal with a very small/illiquid ticker

- [ ] Load option chain
- [ ] Should return empty chain gracefully
- [ ] No crashes or hung processes

### Test 5.2: Market Closed
**Time**: After 4:00 PM ET or before 9:30 AM ET

- [ ] Try to load option chain
- [ ] IB may return stale/delayed prices
- [ ] Agent should still complete successfully

### Test 5.3: TWS Disconnect During Fetch
**Manually close TWS mid-fetch**:

- [ ] Start loading a chain
- [ ] Close TWS while agent is running
- [ ] Agent should fail gracefully
- [ ] UI should show error message
- [ ] No hung processes

## Phase 6: Cleanup & Monitoring

### Test 6.1: Check for Zombie Processes
```bash
ps aux | grep python3 | grep price_agent
```
- [ ] No stale agent processes should be running
- [ ] All agents should have exited cleanly

### Test 6.2: Check TWS Active Connections
- [ ] Open TWS → File → Global Configuration → API → Settings
- [ ] Look at "Active Client Connections"
- [ ] Should see only 0-1 connections (or status check only)
- [ ] No connections with IDs in 300-399 range (agents should disconnect)

### Test 6.3: Review Logs for Warnings
- [ ] Check Next.js server logs for errors
- [ ] Check for repeated "IB Error 200" (no security definition)
- [ ] Check for "IB Error 300" (can't find EId)
- [ ] These are normal for non-existent strikes, but shouldn't be excessive

## Success Criteria

✅ **All tests pass if**:
- Status shows "Connected" reliably
- Option chains load for at least 2-3 different tickers
- No client ID conflicts in logs
- Fresh data appears within 10-15 seconds
- Watched spreads can be created and refreshed
- No hung processes after testing

⚠️ **Acceptable partial success**:
- Some tickers fail due to IB rate limits (wait and retry)
- Occasional timeouts on concurrent requests (IB limitation)
- "No security definition" errors for out-of-range strikes (normal)

❌ **Critical failures requiring fixes**:
- Persistent client ID conflicts
- Agent processes hanging indefinitely
- UI crashes or freezes
- Status showing "Disconnected" when TWS is running

## Next Steps After Testing

### If All Tests Pass:
1. Document any observations in `.claude-rules`
2. Update `AGENT_TESTING_CHECKLIST.md` with actual timings
3. Consider deploying to droplet (if needed in future)

### If Tests Fail:
1. Review `IB_CLIENT_ID_GUIDE.md` for troubleshooting
2. Check IB TWS logs (File → Log)
3. Capture error logs and share with dev team
4. Consider adjusting timeout values in `scanner.py`

## Monitoring for Production

Once in regular use, monitor:
- **Agent spawn frequency**: Should be low (data is cached)
- **Average fetch time**: Should be 10-15 seconds
- **Error rate**: Should be < 5% (IB can be flaky)
- **Client ID conflicts**: Should be zero with randomization

## Related Documentation

- [IB_CLIENT_ID_GUIDE.md](IB_CLIENT_ID_GUIDE.md) - Troubleshooting client ID issues
- [MA_OPTIONS_DISTRIBUTED_ARCHITECTURE.md](../python-service/MA_OPTIONS_DISTRIBUTED_ARCHITECTURE.md) - System design
- [STRIKE_SELECTION_LOGIC.md](STRIKE_SELECTION_LOGIC.md) - Understanding strike range selection

