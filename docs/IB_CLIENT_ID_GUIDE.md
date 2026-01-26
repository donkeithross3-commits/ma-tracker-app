# IB TWS Client ID Allocation Guide

## Overview

Interactive Brokers TWS requires each connection to use a unique **client ID**. Multiple connections with the same client ID will conflict, causing "client id already in use" errors.

## Client ID Allocation Strategy

Our system uses different ID ranges for different purposes:

| Range | Purpose | Assignment Method |
|-------|---------|-------------------|
| **100** | Manual testing / local scripts | Hardcoded in `.env.local` |
| **200-299** | Status checks | Randomized on each check |
| **300-399** | Price agents | Randomized on spawn |

### Why This Works

- **Status checks** (200-299) use random IDs to avoid conflicts with each other
- **Price agents** (300-399) use random IDs to support concurrent operations
- **Manual testing** (100) is separate so you can always run test scripts

## Common Errors and Solutions

### Error: "client id already in use"

**Symptom**: Connection fails with "Unable to connect as the client id is already in use"

**Causes**:
1. Another connection is using the same client ID
2. Previous connection didn't disconnect cleanly
3. TWS has stale connection records

**Solutions**:

1. **Wait 10 seconds** - TWS may still be cleaning up a previous connection
2. **Check running processes**:
   ```bash
   # Find Python processes that might be holding connections
   ps aux | grep python3 | grep price_agent
   
   # Kill if necessary
   kill <PID>
   ```
3. **Restart TWS** - This clears all connection records
4. **Use a different client ID** - If testing manually, increment the ID in `.env.local`

### Error: Agent fails to spawn

**Symptom**: "Price agent failed for EA (exit code: 1)" with client ID conflict

**Solution**: 
- Verify `price_agent.py` is using random IDs (300-399)
- Check that no other agents are stuck running
- Restart the Next.js dev server

## Manual Testing with Specific Client IDs

If you need to use a specific client ID for debugging:

**Option 1: Modify `.env.local`**
```bash
# In python-service/.env.local
IB_CLIENT_ID=150  # Use any ID you want
```

**Option 2: Pass via command line**
```bash
# Not currently supported, but could be added
python3 price_agent.py --client-id 150 --ticker EA ...
```

## How to Check Active Connections

### From TWS:
1. Open **TWS**
2. Go to **File → Global Configuration → API → Settings**
3. Look at **Active Client Connections** list
4. You'll see client IDs and connection times

### From Code:
The system automatically logs the client ID it's using:
```
2025-12-26 14:59:35 - __main__ - INFO - Using agent client ID: 342
```

## Troubleshooting Checklist

When debugging connection issues:

- [ ] Is TWS running and logged in?
- [ ] Is TWS API enabled? (File → Global Configuration → API → Settings → Enable ActiveX and Socket Clients)
- [ ] Is the port correct? (Default: 7497 for paper, 7496 for live)
- [ ] Check server logs for client ID conflicts
- [ ] Try restarting TWS to clear stale connections
- [ ] Verify no zombie Python processes are running

## What to Do If You Run Out of IDs

If you somehow exhaust all available IDs in a range (highly unlikely):

1. **Restart TWS** - This clears all connection records
2. **Expand the range** - Modify `price_agent.py` to use 300-499
3. **Implement connection pooling** - Reuse connections instead of creating new ones

## Architecture Notes

### Why Random Instead of Sequential?

- **Simplicity**: No need for a central ID allocator
- **Concurrency**: Multiple agents can spawn simultaneously without coordination
- **Robustness**: No risk of "next ID" state getting out of sync

### Why Not Reuse Connections?

- **Isolation**: Each agent operation is independent
- **Reliability**: No shared state between requests
- **Debugging**: Clear logs for each operation

### Future Enhancements

If concurrent usage increases significantly:

1. **Connection pooling** - Maintain 2-3 persistent connections per user
2. **ID reservation** - Database-backed ID allocation for guaranteed uniqueness
3. **Health checks** - Automatic detection and cleanup of stale connections

## Related Files

- [`python-service/price_agent.py`](../python-service/price_agent.py) - Agent implementation (uses 300-399)
- [`app/api/ib-connection/status/route.ts`](../app/api/ib-connection/status/route.ts) - Status check (uses 200-299)
- [`python-service/agent_config.py`](../python-service/agent_config.py) - Configuration loader
- [`python-service/.env.local`](../python-service/.env.local) - Local config (not in git)

## Reference

- [IB API Documentation](https://interactivebrokers.github.io/tws-api/)
- [Client ID Parameter](https://interactivebrokers.github.io/tws-api/connection.html#gsc.tab=0)

