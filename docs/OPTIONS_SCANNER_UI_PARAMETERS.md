# M&A Options Scanner - UI Parameter Controls

## Overview

The M&A Options Scanner now exposes all key scanning parameters in the UI, allowing traders to fine-tune the option chain fetching and strategy generation process without modifying code.

## Accessing Parameters

When a deal is selected in the Curator tab, click the **"Show Parameters"** button next to the "Load Option Chain" button to reveal the advanced parameter controls.

## Available Parameters

### 1. Days Before Close
- **Default**: `0`
- **Range**: `0-90`
- **Description**: Controls which expirations are fetched relative to the deal close date.
  - `0`: Fetches exactly 2 expirations (latest before/at close + earliest after close)
  - `N > 0`: Fetches 2-3 expirations from `(close_date - N days)` onwards
- **Use Case**: 
  - Set to `0` for tight bracketing around the deal close
  - Set to `30` for a broader range of expirations (e.g., 30 days before close)

### 2. Strike Lower Bound
- **Default**: `20` (%)
- **Range**: `0-50%`
- **Description**: Percentage below the deal price to set the minimum strike price.
- **Formula**: `min_strike = deal_price × (1 - lower_bound / 100)`
- **Example**: With deal price of $100 and 20%, min strike = $80
- **Use Case**: 
  - Increase to narrow the strike range (fewer options, faster scan)
  - Decrease to widen the strike range (more options, slower scan)

### 3. Strike Upper Bound
- **Default**: `10` (%)
- **Range**: `0-50%`
- **Description**: Percentage above the deal/spot price to set the maximum strike price.
- **Formula**: `max_strike = max(spot_price, deal_price) × (1 + upper_bound / 100)`
- **Example**: With deal price of $100 and 10%, max strike = $110
- **Use Case**: 
  - Decrease to focus on near-the-money options
  - Increase to include more out-of-the-money options

### 4. Short Strike Lower
- **Default**: `95` (%)
- **Range**: `80-100%`
- **Description**: Minimum percentage of deal price for the short leg of spreads.
- **Formula**: `short_strike_min = deal_price × (short_strike_lower / 100)`
- **Example**: With deal price of $100 and 95%, short strike must be ≥ $95
- **Use Case**: 
  - **Critical for merger arbitrage**: The short strike should be at or near the expected deal price
  - Lower values (e.g., 90%) allow more aggressive spreads further from deal price
  - Higher values (e.g., 98%) tighten the range for conservative spreads

### 5. Short Strike Upper
- **Default**: `0.5` (%)
- **Range**: `0-5%`
- **Description**: Maximum percentage above the deal price for the short leg of spreads.
- **Formula**: `short_strike_max = deal_price × (1 + short_strike_upper / 100)`
- **Example**: With deal price of $100 and 0.5%, short strike must be ≤ $100.50
- **Use Case**: 
  - **Critical for merger arbitrage**: Allows a small buffer above deal price for short strikes
  - Increase to `1.0%` or `2.0%` for more flexibility
  - Decrease to `0.25%` for tighter control

### 6. Top Strategies Per Expiration
- **Default**: `5`
- **Range**: `1-20`
- **Description**: Number of best call spreads and put spreads to return per expiration.
- **Note**: The actual number of strategies returned may be higher if multiple expirations are scanned.
- **Use Case**: 
  - Increase to see more strategy options
  - Decrease to focus on only the best opportunities

### 7. Deal Confidence
- **Default**: `0.75` (75%)
- **Range**: `0-1` (0-100%)
- **Description**: Probability that the deal will close successfully.
- **Use Case**: 
  - Used in expected value calculations for strategy analysis
  - Increase for high-confidence deals (e.g., regulatory approved, no antitrust concerns)
  - Decrease for uncertain deals (e.g., pending regulatory review, hostile takeover)

## Parameter Interaction

### Strike Bounds vs. Short Strike Bounds

- **Strike Bounds** (`strikeLowerBound`, `strikeUpperBound`): Control which options are **fetched** from IB
- **Short Strike Bounds** (`shortStrikeLower`, `shortStrikeUpper`): Control which options are **used as short legs** in spreads

**Example**:
- Deal Price: $100
- Strike Lower Bound: 20% → Fetches strikes from $80
- Strike Upper Bound: 10% → Fetches strikes up to $110
- Short Strike Lower: 95% → Short leg must be ≥ $95
- Short Strike Upper: $0.50 → Short leg must be ≤ $100.50

**Result**: The scanner fetches options from $80 to $110, but only considers strikes between $95 and $100.50 for the short leg of spreads.

## Resetting to Defaults

Click the **"Reset to Defaults"** button at the bottom of the parameters section to restore all values to their default settings.

## Quick Guide (In-UI)

The UI includes a quick reference guide at the bottom of the parameters section with key tips:
- **Days Before Close = 0**: Only 2 expirations (before & after close)
- **Strike Bounds**: Range of strikes to fetch from IB
- **Short Strike Range**: Where to sell the short leg (at-the-money)
- **Top Strategies**: Best N spreads per expiration by annualized return

## Technical Details

### Backend Implementation

The parameters are passed from the UI through the following flow:

1. **UI** (`DealInfo.tsx`): User adjusts parameters
2. **Frontend** (`CuratorTab.tsx`): Passes `ScanParameters` to API
3. **Next.js API** (`/api/ma-options/fetch-chain`, `/api/ma-options/generate-candidates`): Forwards parameters to Python service
4. **Python Service** (`options_routes.py`): Applies parameters to scanner
5. **Scanner** (`scanner.py`): Uses parameters in `fetch_option_chain` and `find_best_opportunities`

### Parameter Defaults in Code

If parameters are not provided by the UI, the following defaults are used:

```python
class ScanParameters(BaseModel):
    daysBeforeClose: Optional[int] = 0
    strikeLowerBound: Optional[float] = 20.0
    strikeUpperBound: Optional[float] = 10.0
    shortStrikeLower: Optional[float] = 95.0
    shortStrikeUpper: Optional[float] = 0.50
    topStrategiesPerExpiration: Optional[int] = 5
    dealConfidence: Optional[float] = 0.75
```

## Best Practices

### Conservative Merger Arbitrage
- Days Before Close: `0`
- Strike Bounds: `20%` / `10%`
- Short Strike: `98%` / `$0.25`
- Top Strategies: `3`
- Deal Confidence: `0.85`

### Aggressive Merger Arbitrage
- Days Before Close: `30`
- Strike Bounds: `30%` / `15%`
- Short Strike: `90%` / `$1.00`
- Top Strategies: `10`
- Deal Confidence: `0.60`

### High-Confidence Deal (e.g., regulatory approved)
- Days Before Close: `0`
- Strike Bounds: `15%` / `5%`
- Short Strike: `98%` / `$0.25`
- Top Strategies: `5`
- Deal Confidence: `0.95`

### Uncertain Deal (e.g., pending antitrust review)
- Days Before Close: `30`
- Strike Bounds: `30%` / `20%`
- Short Strike: `90%` / `$2.00`
- Top Strategies: `10`
- Deal Confidence: `0.50`

## Troubleshooting

### No Strategies Generated
- **Check Strike Bounds**: Ensure they're wide enough to capture relevant options
- **Check Short Strike Bounds**: Ensure they're not too restrictive
- **Check Days Before Close**: Try increasing to capture more expirations

### Too Many Strategies
- **Decrease Top Strategies Per Expiration**: Reduce from 5 to 3
- **Tighten Short Strike Bounds**: Increase `shortStrikeLower` to 98% or decrease `shortStrikeUpper` to $0.25

### Slow Scanning
- **Narrow Strike Bounds**: Reduce `strikeLowerBound` and `strikeUpperBound`
- **Reduce Days Before Close**: Set to `0` for only 2 expirations

## Future Enhancements

Potential future additions:
- **Max Spread Width**: Limit the maximum width of vertical spreads (currently hardcoded to $5)
- **Min Liquidity Score**: Filter strategies by minimum liquidity threshold
- **Min Annualized Yield**: Filter strategies by minimum expected return
- **Save Parameter Presets**: Save and load custom parameter sets
- **Parameter Recommendations**: AI-suggested parameters based on deal characteristics

