# Scan Parameters Update

## Overview

Updated default scan parameters and standardized the `shortStrikeLower` parameter to use percentage below deal price (consistent with other parameters).

## New Default Parameters

| Parameter | Old Default | New Default | Unit | Description |
|-----------|-------------|-------------|------|-------------|
| `daysBeforeClose` | 0 | **60** | days | How many days before deal close to consider expirations |
| `strikeLowerBound` | 20 | **20** | % below | Minimum strike to fetch (% below deal price) |
| `strikeUpperBound` | 10 | **10** | % above | Maximum strike to fetch (% above deal/spot price) |
| `shortStrikeLower` | 95% of price | **10** | % below | Minimum strike for short leg (% below deal price) |
| `shortStrikeUpper` | 0.5 | **20** | % above | Maximum strike for short leg (% above deal price) |
| `topStrategiesPerExpiration` | 5 | **5** | count | Number of best strategies to show per expiration |
| `dealConfidence` | 0.75 | **0.75** | 0-1 | Probability of deal closing successfully |

## Key Changes

### 1. Days Before Close: 0 → 60
- **Old**: Only considered expirations closest to deal close date
- **New**: Considers expirations up to 60 days before deal close
- **Impact**: More expiration dates will be included in the scan
- **Example**: If deal closes on March 1, now considers expirations from January 1 onwards

### 2. Short Strike Lower: 95% of price → 10% below
- **Old**: `95` meant 95% of deal price (e.g., $95 for $100 deal)
- **New**: `10` means 10% below deal price (e.g., $90 for $100 deal)
- **Impact**: Wider range of short strikes considered
- **Consistency**: Now matches the format of other percentage parameters

### 3. Short Strike Upper: 0.5% → 20%
- **Old**: `0.5` meant 0.5% above deal price (e.g., $100.50 for $100 deal)
- **New**: `20` means 20% above deal price (e.g., $120 for $100 deal)
- **Impact**: Much wider range of short strikes considered
- **Rationale**: Allows for more aggressive spreads if deal price uncertainty is high

## Parameter Consistency

All strike-related parameters now use the same format:

```typescript
// All parameters are now percentages (0-50 range)
strikeLowerBound: 20    // 20% below deal price
strikeUpperBound: 10    // 10% above deal/spot price
shortStrikeLower: 10    // 10% below deal price
shortStrikeUpper: 20    // 20% above deal price
```

## Example Calculation

For a deal with:
- **Ticker**: ATVI
- **Deal Price**: $95.00
- **Expected Close**: March 1, 2025

### Old Parameters (0 days, 95% of price, 0.5% above)
```
Expirations: Only Feb 28 or March 7 (closest to March 1)
Strike Range (fetch): $76.00 - $104.50 (20% below to 10% above)
Short Strike Range: $90.25 - $95.48 (95% of $95 to 0.5% above $95)
```

### New Parameters (60 days, 10% below, 20% above)
```
Expirations: Jan 1 onwards (60 days before March 1)
Strike Range (fetch): $76.00 - $104.50 (20% below to 10% above)
Short Strike Range: $85.50 - $114.00 (10% below to 20% above $95)
```

## Backend Changes

### Python Service (`scanner.py`)

Updated `find_best_opportunities` method:

```python
def find_best_opportunities(self, options: List[OptionData],
                           current_price: float,
                           top_n: int = 10,
                           short_strike_lower_pct: float = 0.10,  # Changed from 0.95
                           short_strike_upper_pct: float = 0.20) -> List[TradeOpportunity]:  # Changed from 0.005
    """
    Args:
        short_strike_lower_pct: Percentage BELOW deal price (e.g., 0.10 = 10% below)
        short_strike_upper_pct: Percentage ABOVE deal price (e.g., 0.20 = 20% above)
    """
    # Convert percentage below/above to actual multipliers
    short_strike_lower_multiplier = 1.0 - short_strike_lower_pct  # e.g., 0.10 -> 0.90
    short_strike_upper_multiplier = 1.0 + short_strike_upper_pct  # e.g., 0.20 -> 1.20
    
    # Use multipliers in strike filtering
    if (short_call.strike >= self.deal.total_deal_value * short_strike_lower_multiplier and
        short_call.strike <= self.deal.total_deal_value * short_strike_upper_multiplier):
        # Analyze spread...
```

### Frontend (`DealInfo.tsx`)

Updated default state:

```typescript
const [params, setParams] = useState<ScanParameters>({
  daysBeforeClose: 60,        // Was 0
  strikeLowerBound: 20,       // Unchanged
  strikeUpperBound: 10,       // Unchanged
  shortStrikeLower: 10,       // Was 95 (different meaning)
  shortStrikeUpper: 20,       // Was 0.5
  topStrategiesPerExpiration: 5,
  dealConfidence: 0.75,
});
```

Updated input field for `shortStrikeLower`:

```tsx
<label>
  Short Strike Lower
  <span>(% below deal price)</span>  {/* Was "% of deal price" */}
</label>
<input
  type="number"
  min="0"    {/* Was 80 */}
  max="50"   {/* Was 100 */}
  value={params.shortStrikeLower}
  onChange={(e) => setParams({ ...params, shortStrikeLower: parseInt(e.target.value) || 10 })}
/>
<div>
  ${(deal.dealPrice * (1 - params.shortStrikeLower / 100)).toFixed(2)}
  {/* Was: deal.dealPrice * (params.shortStrikeLower / 100) */}
</div>
```

## Impact on Strategy Generation

### More Expirations Considered
With `daysBeforeClose: 60`, the scanner will now consider more expiration dates, giving traders more choices for timing their positions.

### Wider Short Strike Range
The new short strike bounds (10% below to 20% above) allow for:
1. **More conservative spreads**: Short strikes further below deal price for lower risk
2. **More aggressive spreads**: Short strikes above deal price for higher return potential
3. **Better liquidity**: More strikes to choose from means better chance of finding liquid options

### Example Strategies Generated

For ATVI @ $95 deal price:

**Old Parameters** (95% to 0.5% above = $90.25 to $95.48):
- 90/95 Call Spread ✓
- 92.5/95 Call Spread ✓
- 95/97.5 Call Spread ✗ (short strike too high)

**New Parameters** (10% below to 20% above = $85.50 to $114):
- 85/90 Call Spread ✓ (more conservative)
- 90/95 Call Spread ✓
- 92.5/95 Call Spread ✓
- 95/100 Call Spread ✓ (now included!)
- 95/105 Call Spread ✓ (now included!)
- 95/110 Call Spread ✓ (more aggressive)

## UI Display

The parameter input fields now show:

```
┌─────────────────────────────────────────────────────┐
│ Days Before Close (Expiration)                      │
│ How many days before deal close to consider...      │
│ [60]                                                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Short Strike Lower (% below deal price)             │
│ Min strike for short leg. e.g., 10% below $100...   │
│ [10]                                                 │
│ Current: $85.50 (approx)                            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Short Strike Upper (% above deal price)             │
│ Max strike for short leg. e.g., 20% above $100...   │
│ [20]                                                 │
│ Current: $114.00 (approx)                           │
└─────────────────────────────────────────────────────┘
```

## Testing Recommendations

1. **Test with different deal prices**: Verify strike ranges calculate correctly
2. **Test with different close dates**: Verify expiration filtering works with 60-day window
3. **Compare old vs new**: Run same deal with old parameters (0, 95, 0.5) vs new (60, 10, 20)
4. **Check edge cases**: Very low deal prices (<$10), very high deal prices (>$500)

## Rollback Instructions

If needed, revert to old parameters by changing defaults in:

1. **Frontend** (`components/ma-options/DealInfo.tsx`):
   ```typescript
   daysBeforeClose: 0,
   shortStrikeLower: 95,  // But note: this is now % below, not % of
   shortStrikeUpper: 0.5,
   ```

2. **Backend** (`python-service/app/options/models.py`):
   ```python
   daysBeforeClose: Optional[int] = 0
   shortStrikeLower: Optional[float] = 95.0
   shortStrikeUpper: Optional[float] = 0.5
   ```

3. **Backend Logic** (`python-service/app/scanner.py`):
   ```python
   short_strike_lower_pct: float = 0.95,  # Back to multiplier
   short_strike_upper_pct: float = 0.005
   ```

## Status

✅ **COMPLETE**: All default parameters updated and `shortStrikeLower` converted to percentage below format.

