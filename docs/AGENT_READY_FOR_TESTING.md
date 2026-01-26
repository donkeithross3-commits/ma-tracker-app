# Price Agent: Ready for Testing Next Week

## Status: ✅ Implementation Complete, Pending Market Open Testing

**Date Completed**: December 26, 2024  
**Next Test Window**: Monday, December 30, 2024 (or next market open)

---

## What Was Fixed

### Problem
The price agent was failing to connect to IB TWS with error:
```
Unable to connect as the client id is already in use
```

This happened because:
1. The agent was using hardcoded client ID `100`
2. The status check was also trying to use client ID `100`
3. Multiple connections cannot share the same client ID

### Solution
Implemented **randomized client ID allocation** with separate ranges for different purposes:

| Component | ID Range | Assignment |
|-----------|----------|------------|
| Manual scripts | 100 | Hardcoded in `.env.local` |
| Status checks | 200-299 | Random on each check |
| Price agents | 300-399 | Random on spawn |

### Changes Made

1. **`python-service/price_agent.py`**
   - Added `import random`
   - Modified `connect_to_ib()` to use `random.randint(300, 399)`
   - Added logging to show which client ID is being used

2. **`app/api/ib-connection/status/route.ts`**
   - Already updated to use `random.randint(200, 299)`
   - Prevents conflicts with manual testing and agents

3. **Documentation**
   - Created `docs/IB_CLIENT_ID_GUIDE.md` - Comprehensive troubleshooting guide
   - Created `docs/AGENT_TESTING_CHECKLIST.md` - Step-by-step testing procedures
   - Updated `.claude-rules` - Added client ID allocation strategy

---

## How It Works Now

### Flow: User Clicks "Load Option Chain"

```
1. UI sends POST to /api/ma-options/fetch-chain
2. API checks for data < 2 seconds old
3. If no fresh data:
   a. API spawns price_agent.py as child process
   b. Agent generates random client ID (300-399)
   c. Agent connects to IB TWS
   d. Agent fetches option chain
   e. Agent POSTs data to /api/price-agent/ingest-chain
   f. Agent disconnects and exits
4. API retrieves fresh snapshot from database
5. UI displays option chain with age/source metadata
```

### Flow: Status Check (Every 30 seconds)

```
1. UI sends GET to /api/ib-connection/status
2. API spawns quick test script
3. Script uses random client ID (200-299)
4. Script attempts IB TWS connection
5. Script exits (connected: true/false)
6. UI shows green/red dot
```

### Why This Design?

- **No conflicts**: Different ID ranges prevent collisions
- **Concurrent support**: Multiple agents can run simultaneously
- **Simple**: No central ID allocator needed
- **Robust**: Random selection from 100-ID pool is collision-resistant

---

## Testing Plan for Next Week

### Prerequisites
Before testing, ensure:
- [ ] IB TWS is running and logged in
- [ ] TWS API is enabled (File → Global Configuration → API → Settings)
- [ ] Next.js dev server is running (`npm run dev`)
- [ ] PostgreSQL (Postgres.app) is running

### Quick Test (5 minutes)

1. **Check Connection Status**
   - Navigate to `/ma-options`
   - Verify green "IB TWS: Connected" indicator in top-right

2. **Load Single Option Chain**
   - Click on EA (Electronic Arts) deal
   - Click "Load Option Chain" button
   - Wait 10-15 seconds
   - Verify option chain appears with recent data

3. **Check Logs**
   - Server logs should show:
     ```
     Spawning price agent for EA...
     [AGENT-OUT] Using agent client ID: 3XX
     [AGENT-OUT] Connected to IB TWS
     POST /api/ma-options/fetch-chain 200 in ~10-15s
     ```

### Full Test (30 minutes)

Follow the comprehensive checklist in `docs/AGENT_TESTING_CHECKLIST.md`:
- [ ] Phase 1: Connection Status
- [ ] Phase 2: Single Ticker (Basic Flow)
- [ ] Phase 3: Multiple Tickers (Concurrency)
- [ ] Phase 4: Watched Spreads
- [ ] Phase 5: Edge Cases
- [ ] Phase 6: Cleanup & Monitoring

---

## Expected Behavior

### ✅ Success Looks Like:
- Green "Connected" indicator shows reliably
- Option chains load within 10-15 seconds
- Server logs show agent client IDs in 300-399 range
- No "client id already in use" errors
- Multiple tickers can be loaded sequentially
- Watched spreads can be created and refreshed

### ⚠️ Known Acceptable Issues:
- Occasional "No security definition" errors for out-of-range strikes (normal)
- IB rate limiting if you click too fast (wait 30s and retry)
- Slower performance during market open (IB is busy)

### ❌ Critical Failures Requiring Fixes:
- Persistent client ID conflicts
- Agent processes hanging indefinitely
- UI crashes or freezes
- Status showing "Disconnected" when TWS is running

---

## Troubleshooting Reference

### If Status Shows "Disconnected" (Red Dot)

1. **Check TWS is Running**
   ```bash
   # TWS should be visible in Applications
   # Login should be complete (paper or live)
   ```

2. **Check TWS API is Enabled**
   - TWS: File → Global Configuration → API → Settings
   - ✅ Enable ActiveX and Socket Clients
   - ✅ Trusted IP: 127.0.0.1

3. **Restart Next.js Dev Server**
   ```bash
   # Kill existing server
   # npm run dev
   ```

### If Agent Fails to Spawn

1. **Check Server Logs**
   - Look for "Spawning price agent for {ticker}"
   - Look for Python errors or stack traces

2. **Test Agent Manually**
   ```bash
   cd python-service
   source .venv/bin/activate
   python3 price_agent.py --ticker EA --deal-price 210.57 --close-date 2025-09-17
   ```

3. **Check for Zombie Processes**
   ```bash
   ps aux | grep price_agent
   # Kill any stale processes
   kill <PID>
   ```

### If Client ID Conflicts Persist

See `docs/IB_CLIENT_ID_GUIDE.md` for:
- How to check active TWS connections
- How to force disconnect stale connections
- How to manually specify a client ID for testing

---

## Files to Reference

### Implementation
- `python-service/price_agent.py` - Agent with random client ID (300-399)
- `app/api/ib-connection/status/route.ts` - Status check with random ID (200-299)
- `app/api/ma-options/fetch-chain/route.ts` - On-demand agent spawning

### Documentation
- `docs/IB_CLIENT_ID_GUIDE.md` - Client ID troubleshooting
- `docs/AGENT_TESTING_CHECKLIST.md` - Comprehensive testing procedures
- `docs/STRIKE_SELECTION_LOGIC.md` - Understanding what data is fetched
- `.claude-rules` - Project architecture and conventions

### Configuration
- `python-service/.env.local` - Agent config (not in git, create from example)
- `.env.development` - Server config with `AGENT_API_KEY`

---

## Next Steps

### Immediate (Next Market Open)
1. Run quick test to verify green status indicator
2. Load one option chain to verify end-to-end flow
3. Check logs for client ID usage (should be 300-399)

### After Successful Testing
1. Update `AGENT_TESTING_CHECKLIST.md` with actual timings
2. Document any observations or edge cases in `.claude-rules`
3. Consider whether to deploy to droplet (if needed)

### Future Enhancements (Not Urgent)
- Connection pooling (reuse connections instead of spawning)
- Configurable client ID ranges via env vars
- Health check endpoint for agent status
- Metrics/monitoring for agent spawn frequency

---

## Success Criteria

**This implementation is successful if:**
- ✅ Status checks work reliably without conflicts
- ✅ Agents spawn on-demand without conflicts
- ✅ Option chains load consistently during market hours
- ✅ Multiple tickers can be loaded without errors
- ✅ System is ready for regular use

**Ready to test on Monday!** 🚀

---

## Questions?

If you encounter issues during testing:
1. Check `docs/IB_CLIENT_ID_GUIDE.md` for troubleshooting
2. Review server logs for specific error messages
3. Test agent manually to isolate IB connection vs. API issues
4. Document any new edge cases for future reference

