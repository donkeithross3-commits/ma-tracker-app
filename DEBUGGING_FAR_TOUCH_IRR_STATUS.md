# Debugging Far Touch IRR - Current Status

## Problem

Far Touch IRR is showing 0.0% in the UI even though:
- Midpoint IRR shows correctly (37.5%)
- Far Touch Cost and Profit are calculating correctly
- The backend has the `annualizedYieldFarTouch` field

## What I've Done

### 1. Added Comprehensive Debug Logging

**Location:** `python-service/app/scanner.py`

**For Call Spreads (line ~835):**
```python
print(f"DEBUG FT CALL: {long_call.strike}/{short_call.strike}")
print(f"  spread_cost_ft={spread_cost_ft:.2f}, expected_return_ft={expected_return_ft:.2f}")
print(f"  years_to_expiry={years_to_expiry:.3f}, days_to_close={self.deal.days_to_close}")
print(f"  annualized_return_mid={annualized_return_mid:.4f}, annualized_return_ft={annualized_return_ft:.4f}")
```

**For Put Spreads (line ~925):**
```python
print(f"DEBUG PUT FT: {long_put.strike}/{short_put.strike}")
print(f"  max_loss_ft={max_loss_ft:.2f}, expected_return_ft={expected_return_ft:.2f}")
print(f"  years_to_expiry={years_to_expiry:.3f}, days_to_close={self.deal.days_to_close}")
print(f"  annualized_return_mid={annualized_return_mid:.4f}, annualized_return_ft={annualized_return_ft:.4f}")
```

### 2. Restarted Python Service

- ✅ Killed old processes on port 8000
- ✅ Started new service with debug logging
- ✅ Service is running (with some database errors that don't affect options scanning)
- ✅ Output redirected to `/tmp/python_service.log`

### 3. Verified API Integration

- ✅ `annualizedYieldFarTouch` field added to TypeScript interface
- ✅ `annualizedYieldFarTouch` field added to Python model
- ✅ `annualizedYieldFarTouch=opp.annualized_return_ft` in API response
- ✅ Frontend uses `candidate.annualizedYieldFarTouch || 0`

## Current Hypothesis

The backend calculation might be returning 0 because:

1. **`years_to_expiry` is 0 or negative** - If `days_to_close` is calculated incorrectly
2. **`spread_cost_ft` is 0** - If far touch pricing is missing
3. **The condition is failing** - The `if years_to_expiry > 0 and spread_cost_ft > 0` check

The formula is:
```python
annualized_return_ft = (expected_return_ft / spread_cost_ft) / years_to_expiry \
    if years_to_expiry > 0 and spread_cost_ft > 0 else 0
```

## What Needs to Happen Next

**USER ACTION REQUIRED:**

1. **In the UI, click "Load Option Chain"** for the EA deal (or any deal)

2. **The strategies will regenerate** with the new debug code

3. **Check `/tmp/python_service.log`** for output like:
   ```
   DEBUG FT CALL: 200.0/210.0
     spread_cost_ft=8.65, expected_return_ft=1.35
     years_to_expiry=0.500, days_to_close=183
     annualized_return_mid=0.3747, annualized_return_ft=0.XXXX
   ```

4. **Share the debug output** so I can see what values are being calculated

## Expected Debug Output

For the 200/210 spread shown in the screenshot:

**What we expect to see:**
```
DEBUG FT CALL: 200.0/210.0
  spread_cost_ft=8.65, expected_return_ft=1.35
  years_to_expiry=0.500, days_to_close=183
  annualized_return_mid=0.3747, annualized_return_ft=0.3121
```

**If `annualized_return_ft=0.0000`**, then one of these is true:
- `years_to_expiry` is 0 or negative
- `spread_cost_ft` is 0
- The condition check is failing for some other reason

## How to Check the Log

**Option 1: From terminal**
```bash
tail -100 /tmp/python_service.log | grep -A 4 "DEBUG FT CALL"
```

**Option 2: I can check it**
Just let me know when you've regenerated the strategies and I'll check the log.

## Next Steps After Debug Output

Once we see the debug output, we'll know:
1. What values are being calculated
2. Why `annualized_return_ft` is 0
3. How to fix the calculation

## Status

🔄 **WAITING FOR USER**: Please regenerate strategies in the UI so we can see the debug output.

