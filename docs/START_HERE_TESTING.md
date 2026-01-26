# START HERE: Price Agent Testing

**Status**: Markets Open ✅ | IB TWS Connected ✅ | Ready to Test ✅

---

## Quick Start (5 Minutes)

### Prerequisites Check
```bash
# ✅ IB TWS running and logged in?
# ✅ Postgres.app running?

# Start development environment (Python service + Next.js)
npm run dev
```

**Note**: `npm run dev` now automatically starts both the Python strategy analyzer (port 8000) and Next.js (port 3000). See [DEV_STARTUP.md](DEV_STARTUP.md) for details.

### Test 1: Verify Connection Status
1. Go to http://localhost:3000/ma-options
2. Look top-right corner
3. Should see: **"IB TWS: Connected"** (green)

**If red**: See [IB_CLIENT_ID_GUIDE.md](IB_CLIENT_ID_GUIDE.md)

---

### Test 2: Load Option Chain
1. Click on **EA** deal in the list
2. Click **"Load Option Chain"** button
3. Wait 10-30 seconds

**Expected**: Option chain appears with strikes, expirations, and "source: agent"

**If fails**: Check server logs for errors

---

### Test 3: Verify No Zombie Processes
```bash
ps aux | grep price_agent | grep -v grep
```

**Expected**: Empty output (no processes)

---

## If All 3 Tests Pass ✅

**Congrats!** The client ID fix works. Now:

1. **Document Results**: Note timing, any warnings
2. **Try More Tickers**: Load AL, CSGS, etc.
3. **Read Full Plan**: [AGENT_TESTING_PLAN_COMPREHENSIVE.md](AGENT_TESTING_PLAN_COMPREHENSIVE.md)

---

## If Any Test Fails ❌

1. **Capture Logs**: Copy server terminal output
2. **Check Errors**: Look for "client id already in use"
3. **Document**: Write down exact error, steps to reproduce
4. **Debug**: See [IB_CLIENT_ID_GUIDE.md](IB_CLIENT_ID_GUIDE.md)

---

## Next Steps

### Today (30 minutes)
- [ ] Run 3 quick tests above
- [ ] Try 2-3 different tickers
- [ ] Check for zombie processes
- [ ] Document any issues

### This Week
- [ ] Read [AGENT_TESTING_PLAN_COMPREHENSIVE.md](AGENT_TESTING_PLAN_COMPREHENSIVE.md)
- [ ] Run Phase 2 edge case tests
- [ ] Implement Python unit tests
- [ ] Add agent timeout

### This Month
- [ ] Set up automated testing
- [ ] Create CI/CD pipeline
- [ ] Build monitoring dashboard

---

## Key Documents

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **This File** | Quick 5-minute test | Right now |
| [AGENT_TESTING_PLAN_COMPREHENSIVE.md](AGENT_TESTING_PLAN_COMPREHENSIVE.md) | Full testing strategy | After quick test passes |
| [AGENT_TESTING_CHECKLIST.md](AGENT_TESTING_CHECKLIST.md) | Detailed manual tests | Comprehensive validation |
| [IB_CLIENT_ID_GUIDE.md](IB_CLIENT_ID_GUIDE.md) | Troubleshooting | When errors occur |
| [AGENT_READY_FOR_TESTING.md](AGENT_READY_FOR_TESTING.md) | Context & background | Understanding the fix |

---

## Quick Troubleshooting

**"client id already in use"**
→ Wait 10 seconds, try again. If persists, see [IB_CLIENT_ID_GUIDE.md](IB_CLIENT_ID_GUIDE.md)

**Status shows "Disconnected"**
→ Check TWS is running, API enabled, restart dev server

**"Could not fetch price"**
→ IB may be slow, check TWS is logged in, try again

**Timeout after 30s**
→ Normal during high volatility, wait and retry

**Empty option chain**
→ Ticker may not have options available (expected for some)

---

## Success Criteria

✅ **Minimum viable**: Tests 1-3 above all pass

✅ **Solid confidence**: Load 3+ different tickers successfully

✅ **Production ready**: Run full Phase 1-2 tests from comprehensive plan

---

**Let's test it!** 🚀

