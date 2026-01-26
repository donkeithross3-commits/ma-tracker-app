# On-Demand Price Agent Implementation

**Date:** December 26, 2025  
**Feature:** Automatic agent spawning when "Load Option Chain" is clicked

## Overview

The "Load Option Chain" button now automatically fetches fresh data from IB TWS by spawning the price agent on-demand. Users no longer need to manually run the agent before clicking the button.

## How It Works

### Flow Diagram

```
User clicks "Load Option Chain"
         ↓
Check for data within 2 seconds? (debounce)
         ↓ No
Spawn price agent as child process
         ↓
Agent connects to IB TWS
         ↓
Agent fetches option chain
         ↓
Agent POSTs data to /api/price-agent/ingest-chain
         ↓
Data stored in database
         ↓
API fetches and returns fresh data to UI
         ↓
UI displays option chain
```

### Priority Order

1. **2-second cache** (debounce): If data was just fetched, return it immediately
2. **Spawn agent**: Run price agent to fetch fresh data from IB TWS (60-120 seconds)
3. **30-minute cache**: If agent fails, return cached data if < 30 minutes old
4. **Error message**: If all else fails, show helpful error with instructions

## Implementation Details

### New Function: `spawnPriceAgent()`

Located in: `app/api/ma-options/fetch-chain/route.ts`

**Parameters:**
- `ticker`: Stock symbol (e.g., "EA", "AL")
- `dealPrice`: Deal price for strike range calculation
- `closeDate`: Expected close date (YYYY-MM-DD)

**Returns:**
- `Promise<boolean>`: `true` if agent completed successfully, `false` otherwise

**Features:**
- Spawns Python agent as child process
- 3-minute timeout for safety
- Captures stdout/stderr for debugging
- Checks for `RESULT_SUCCESS: True` in output
- Logs progress and errors

### Code Location

**File:** `app/api/ma-options/fetch-chain/route.ts`

**Key sections:**
- Lines 27-93: `spawnPriceAgent()` function
- Lines 167-210: On-demand spawning logic
- Lines 212-350: Fallback to Python service and cached data

## User Experience

### Before (Manual Workflow)
1. Open terminal
2. `cd python-service && source .venv/bin/activate`
3. `python3 price_agent.py --ticker AL --deal-price 35.00 --close-date 2026-02-19`
4. Wait 60-120 seconds
5. Go to UI and click "Load Option Chain"

### After (Automatic Workflow)
1. Click "Load Option Chain" in UI
2. Wait 60-120 seconds (progress shown in UI)
3. Option chain appears automatically

## Performance

### Timing
- **First fetch (cold):** 60-120 seconds (depends on # of contracts)
- **Subsequent fetches (< 2 seconds):** Instant (debounce)
- **Cached data (< 30 minutes):** ~10-20ms

### Resource Usage
- Spawns one Python process per request
- Process terminates after completion
- Maximum 3-minute runtime per request
- IB TWS connection reused across requests

## Error Handling

### Agent Spawn Failures
- Logs error to console
- Falls back to cached data if available
- Returns 503 with helpful error message if no cache

### IB TWS Offline
- Agent will fail after attempting connection
- Falls back to cached data
- Error message indicates IB TWS is not connected

### Timeout (3 minutes)
- Agent process is killed
- Falls back to cached data
- Logs timeout event

## Configuration

### Environment Variables
None required - uses existing configuration from `python-service/.env.local`

### Paths
- Python service: `{projectRoot}/python-service`
- Python executable: `{projectRoot}/python-service/.venv/bin/python3`
- Agent script: `{projectRoot}/python-service/price_agent.py`

## Testing

### Manual Test
1. Ensure IB TWS is running and connected
2. Navigate to `/ma-options` in UI
3. Select a deal (e.g., AL)
4. Click "Load Option Chain"
5. Wait for progress indicator
6. Verify option chain loads successfully

### Expected Logs
```
No recent data for AL, spawning price agent...
Spawning price agent for AL...
✓ Price agent completed successfully for AL
✓ Returning fresh agent data for AL (XX contracts)
POST /api/ma-options/fetch-chain 200 in XXXXms
```

## Future Improvements

### Short-term
- Add progress indicator in UI showing agent is running
- Show estimated time remaining
- Allow cancellation of in-progress fetch

### Long-term
- Queue multiple requests to avoid spawning multiple agents
- Implement agent pooling for better resource management
- Add WebSocket for real-time progress updates
- Cache agent process for faster subsequent requests

## Troubleshooting

### "Failed to fetch option chain" after 3 minutes
- Check if IB TWS is running
- Verify IB TWS is accepting API connections
- Check python-service logs for errors

### Agent spawns but no data appears
- Check database for recent snapshot
- Verify agent completed successfully (look for `RESULT_SUCCESS: True`)
- Check server logs for POST to `/api/price-agent/ingest-chain`

### Slow performance
- Normal for first fetch (60-120 seconds)
- Check IB TWS connection quality
- Reduce strike range or expiration count if needed

## Related Files

- `app/api/ma-options/fetch-chain/route.ts` - Main implementation
- `python-service/price_agent.py` - Agent script
- `app/api/price-agent/ingest-chain/route.ts` - Data ingestion endpoint
- `docs/IB_RATE_LIMITING_FIX.md` - Agent optimization details
- `docs/STRIKE_RANGE_OPTIMIZATION.md` - Strike selection logic

