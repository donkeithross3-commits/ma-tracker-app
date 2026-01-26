# Date Format Bug Fix - M&A Options Scanner

## Problem

The M&A Options Scanner was failing with a **400 Bad Request** error when trying to load option chains, even though:
- ✅ Python service was running
- ✅ IB TWS was connected
- ✅ Direct curl requests to Python service worked

## Root Cause

**Date format mismatch** between Next.js and Python service:

- **Next.js was sending**: `"2025-12-08T00:00:00.000Z"` (ISO 8601 format)
- **Python service expected**: `"2025-12-08"` (YYYY-MM-DD format)

The Python service's date validation was rejecting the ISO format:

```python
# python-service/app/api/options_routes.py line 106-108
try:
    close_date = datetime.strptime(request.expectedCloseDate, "%Y-%m-%d")
except ValueError:
    raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
```

## Solution

Added date format conversion in both Next.js API routes before sending to Python service:

### 1. `/api/ma-options/fetch-chain/route.ts`

```typescript
// Convert ISO date to YYYY-MM-DD format for Python service
const closeDateObj = new Date(expectedCloseDate);
const formattedCloseDate = closeDateObj.toISOString().split('T')[0];

// Call Python service with formatted date
body: JSON.stringify({
  ticker,
  dealPrice,
  expectedCloseDate: formattedCloseDate,  // Now "YYYY-MM-DD"
  scanParams: scanParams || {},
}),
```

### 2. `/api/ma-options/generate-candidates/route.ts`

```typescript
// Convert ISO date to YYYY-MM-DD format for Python service
const formattedCloseDate = version.expectedCloseDate.toISOString().split('T')[0];

// Call Python service with formatted date
body: JSON.stringify({
  ticker: snapshot.ticker,
  dealPrice: snapshot.dealPrice.toNumber(),
  expectedCloseDate: formattedCloseDate,  // Now "YYYY-MM-DD"
  chainData: {...},
  scanParams: scanParams || {},
}),
```

## Verification

After the fix, the flow should work:

1. User selects deal (e.g., "EA" with close date `2026-03-31T00:00:00.000Z`)
2. Next.js converts to `"2026-03-31"`
3. Python service accepts the date
4. IB TWS fetches option chain
5. Data returns successfully

## Testing

To verify the fix works:

1. Navigate to `http://localhost:3000/ma-options`
2. Select any deal
3. Click "Load Option Chain"
4. Should now successfully fetch options from IB TWS

## Files Modified

- `app/api/ma-options/fetch-chain/route.ts` - Added date format conversion
- `app/api/ma-options/generate-candidates/route.ts` - Added date format conversion

## Related Issues

This bug only affected the options scanner because:
- The deal data in the database stores dates as PostgreSQL `DATE` type
- Prisma returns these as JavaScript `Date` objects
- When serialized to JSON for API responses, they become ISO 8601 strings
- The Python service was written to expect simple `YYYY-MM-DD` format

## Prevention

Future API integrations between Next.js and Python should:
1. Document expected date formats in API contracts
2. Use consistent date serialization (e.g., always ISO 8601 or always YYYY-MM-DD)
3. Add validation/conversion at API boundaries
4. Include date format in Pydantic models with examples

## Status

✅ **FIXED**: Date format conversion added to both API routes. The M&A Options Scanner should now work correctly with IB TWS.

