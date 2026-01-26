# IB TWS Rate Limiting Fix

**Date:** December 26, 2025  
**Issue:** Live test timing out with "No security definition" and "Can't find EId" errors

## Problem

The price agent's dry-run was successful (fetching 163 contracts for EA), but the live test timed out after 60 seconds with many IB errors:

```
IB Error 200: No security definition has been found for the request
IB Error 300: Can't find EId with tickerId
```

This indicated that IB TWS was being overwhelmed by too many concurrent requests.

## Root Cause

The batch processing logic in `python-service/app/scanner.py` was:
- **Batch size too large:** 50 contracts per batch
- **Requests sent too quickly:** 0.05s delay between submissions
- **Insufficient wait time:** Only 1.5-4.0s for batch responses

For a ticker like EA with ~300+ option contracts, this resulted in:
- 6-7 batches of 50 contracts each
- Rapid-fire submissions overwhelming IB's API
- Many contracts failing to resolve

## Solution

### 1. Reduced Batch Size
```python
batch_size = 10  # Reduced from 50
```

### 2. Increased Delays Between Submissions
```python
time.sleep(0.15)  # Increased from 0.05s
```

### 3. Increased Wait Time for Responses
```python
wait_time = min(5.0, 2.0 + len(batch) * 0.1)  # Increased from 4.0/1.5/0.05
```

### 4. Increased Delay Between Batches
```python
time.sleep(0.5)  # Increased from 0.2s
```

### 5. Better Error Logging
Added logging for failed contracts to help diagnose issues:
```python
logger.debug(f"No valid data for {ticker} {expiry} {strike}{right}")
```

### 6. Extended Test Timeout
Updated `test-price-agent-local.sh` to allow 180 seconds (up from 60) for larger option chains.

## Trade-offs

**Pros:**
- More reliable IB TWS connection
- Fewer "No security definition" errors
- Better compliance with IB rate limits

**Cons:**
- Slower overall processing time
- For 300 contracts: ~30 batches × (1.5s submission + 3.0s wait + 0.5s delay) = ~150 seconds
- Still well within the 180s timeout

## Testing

Run the updated test:
```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service
./scripts/test-price-agent-local.sh EA
```

Expected behavior:
- Dry-run: Completes in ~10-15 seconds
- Live test: Completes in ~120-180 seconds (depending on # of contracts)
- UI: Shows "IB TWS: Connected" with agent metadata

## Future Improvements

If rate limiting issues persist:
1. **Further reduce batch size** to 5 contracts
2. **Implement adaptive rate limiting** based on IB error responses
3. **Add retry logic** for failed contracts
4. **Filter out far OTM strikes** before submitting to IB

## Related Files

- `python-service/app/scanner.py` - Batch processing logic
- `scripts/test-price-agent-local.sh` - Test script with extended timeout
- `.claude-rules` - Updated with batch size parameters

