# Debug Far Touch IRR Showing Zero

## Current Status

The Far Touch IRR is showing 0.0% in the UI even though:
- Midpoint IRR is showing correctly (37.5%)
- We've added the `annualizedYieldFarTouch` field to the API
- The backend is calculating it

## Debug Steps Added

### 1. Added Debug Logging to Call Spreads

**Location:** `python-service/app/scanner.py` line ~835

```python
# FAR-TOUCH calculations
expected_return_ft = value_at_deal_close - spread_cost_ft
annualized_return_ft = (expected_return_ft / spread_cost_ft) / years_to_expiry if years_to_expiry > 0 and spread_cost_ft > 0 else 0

# Debug logging for far touch
print(f"DEBUG FT: spread_cost_ft={spread_cost_ft}, expected_return_ft={expected_return_ft}, "
      f"years_to_expiry={years_to_expiry}, annualized_return_ft={annualized_return_ft}")
```

### 2. Added Debug Logging to Put Spreads

**Location:** `python-service/app/scanner.py` line ~924

```python
annualized_return_ft = (expected_return_ft / max_loss_ft) / years_to_expiry if years_to_expiry > 0 and max_loss_ft > 0 else 0

# Debug logging for far touch
print(f"DEBUG PUT FT: max_loss_ft={max_loss_ft}, expected_return_ft={expected_return_ft}, "
      f"years_to_expiry={years_to_expiry}, annualized_return_ft={annualized_return_ft}")
```

## How to Debug

1. **Restart the Python service** (if it's not auto-reloading):
   ```bash
   # Kill the current process
   # Restart with: cd python-service && python3 start_server.py
   ```

2. **In the UI, click "Load Option Chain"** for a deal

3. **Click "Generate Strategies"**

4. **Check the Python service terminal** for debug output like:
   ```
   DEBUG FT: spread_cost_ft=8.65, expected_return_ft=1.35, years_to_expiry=0.246, annualized_return_ft=0.635
   ```

## Possible Causes

### Cause 1: `spread_cost_ft` is 0
If the far touch cost is 0, the division would fail and return 0.

**Check:** Look for `spread_cost_ft=0.0` in debug output

### Cause 2: `expected_return_ft` is negative
If the far touch cost exceeds the strike width, the expected return would be negative, but the condition should still calculate it.

**Check:** Look for negative `expected_return_ft` values

### Cause 3: `years_to_expiry` is 0
If days to close is 0, years would be 0 and the condition would fail.

**Check:** Look for `years_to_expiry=0.0` in debug output

### Cause 4: Calculation is correct but not being sent
The backend might be calculating it correctly but the API might not be sending it.

**Check:** Add logging in `options_routes.py` to see what value is being sent

## Expected Debug Output

For the 200/210 spread in your screenshot:

**Midpoint:**
- Cost: $8.32
- Profit: $1.68
- IRR: 37.5%

**Far Touch:**
- Cost: $8.65
- Profit: $1.35
- IRR: Should be ~31-32% (not 0%)

**Debug output should show:**
```
DEBUG FT: spread_cost_ft=8.65, expected_return_ft=1.35, years_to_expiry=0.246, annualized_return_ft=0.31-0.32
```

If `annualized_return_ft=0.0`, then we know the backend calculation is failing.

## Next Steps

1. **Check debug output** in Python service terminal
2. **If `annualized_return_ft=0.0`**, investigate why the condition is failing
3. **If `annualized_return_ft` has a value**, check if it's being sent in the API response
4. **If it's being sent**, check if the frontend is receiving it

## Formula Reference

**Call Spread Annualized Return:**
```python
spread_cost_ft = long_call.ask - short_call.bid
expected_return_ft = value_at_deal_close - spread_cost_ft
annualized_return_ft = (expected_return_ft / spread_cost_ft) / years_to_expiry
```

**Example:**
```
spread_cost_ft = 8.65
expected_return_ft = 10.00 - 8.65 = 1.35
years_to_expiry = 90 / 365 = 0.246
annualized_return_ft = (1.35 / 8.65) / 0.246 = 0.156 / 0.246 = 0.634 (63.4%)
```

Wait... that doesn't match 37.5% either. Let me recalculate...

Actually, if midpoint is 37.5%, that's:
```
annualized_return_mid = (1.68 / 8.32) / 0.246 = 0.202 / 0.246 = 0.82 (82%)
```

That's not 37.5% either. Something is wrong with my understanding of the formula.

## Status

🔍 **DEBUGGING**: Added logging to identify why far touch IRR is 0. Need to check Python service output.

