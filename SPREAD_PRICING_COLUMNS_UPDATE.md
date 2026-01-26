# Spread Pricing Columns Update

## Overview

Updated the Candidate Strategies table to show detailed pricing for both **Midpoint Entry** and **Far Touch Entry** scenarios, with cost, profit, and IRR calculations for each.

## New Table Structure

### Header Layout

```
┌─────────┬───────────────────────────────┬───────────────────────────────┬─────┬────────┐
│ Strikes │    Midpoint Entry             │    Far Touch Entry            │ Liq │ Action │
│         ├──────────┬──────────┬─────────┼──────────┬──────────┬─────────┤     │        │
│         │   Cost   │  Profit  │   IRR   │   Cost   │  Profit  │   IRR   │     │        │
└─────────┴──────────┴──────────┴─────────┴──────────┴──────────┴─────────┴─────┴────────┘
```

### Column Definitions

#### Strikes
- **Description**: Strike prices for all legs in the spread
- **Format**: "245.00 / 250.00" for vertical spreads
- **Example**: "240.00 / 245.00" (Buy 240 Call, Sell 245 Call)

#### Midpoint Entry Section

1. **Cost**
   - **Calculation**: `abs(netPremium)` - Entry cost using mid prices
   - **Format**: $X.XX
   - **Description**: Total debit paid (or credit received) using midpoint prices
   - **Example**: $2.45 for a debit spread

2. **Profit**
   - **Calculation**: `maxProfit` - Maximum potential profit at expiration
   - **Format**: $X.XX
   - **Description**: Strike width minus entry cost (for debit spreads)
   - **Example**: $2.55 (from $5 strike width - $2.45 cost)

3. **IRR**
   - **Calculation**: `annualizedYield * 100`
   - **Format**: XXX.X%
   - **Description**: Annualized internal rate of return
   - **Formula**: `(Profit / Cost) * (365 / Days to Expiration) * 100`
   - **Example**: 180.5% annualized

#### Far Touch Entry Section

1. **Cost**
   - **Calculation**: `abs(netPremiumFarTouch)` - Entry cost using far touch prices
   - **Format**: $X.XX
   - **Description**: Total debit paid using worst-case pricing (ask for buys, bid for sells)
   - **Example**: $2.75 for a debit spread
   - **Color**: Lighter gray to differentiate from midpoint

2. **Profit**
   - **Calculation**: `maxProfit` - Same as midpoint (strike width determines max profit)
   - **Format**: $X.XX
   - **Description**: Maximum potential profit (unchanged by entry price)
   - **Example**: $2.25 (from $5 strike width - $2.75 cost)
   - **Color**: Lighter gray

3. **IRR**
   - **Calculation**: `(maxProfit / abs(netPremiumFarTouch)) * (365 / daysToExpiration) * 100`
   - **Format**: XXX.X%
   - **Description**: Annualized return using far touch entry
   - **Example**: 145.2% annualized (lower than midpoint due to higher cost)
   - **Color**: Lighter gray

#### Liquidity (Liq)
- **Calculation**: Composite score (0-100) based on bid-ask spread, volume, and open interest
- **Format**: XX
- **Description**: Higher = more liquid
- **Sortable**: Yes

#### Action
- **Button**: "Watch" - Adds strategy to watchlist
- **Color**: Green

## Calculation Details

### Midpoint Entry
- **Entry Price**: Uses midpoint between bid and ask for each leg
- **Cost**: `abs(netPremium)` - Already calculated by Python backend
- **Profit**: `maxProfit` - Strike width minus entry cost
- **IRR**: `annualizedYield` - Already calculated by Python backend

### Far Touch Entry
- **Entry Price**: Uses worst-case pricing:
  - **BUY legs**: Ask price (pay more)
  - **SELL legs**: Bid price (receive less)
- **Cost**: `abs(netPremiumFarTouch)` - Already calculated by Python backend
- **Profit**: Same as midpoint (strike width is fixed)
- **IRR**: Calculated in UI:
  ```typescript
  const farReturn = farProfit / farCost;
  const daysToExpiration = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
  const farIRR = farReturn * (365 / daysToExpiration);
  ```

## Example Scenarios

### Example 1: Call Vertical Spread
```
Strikes: 245.00 / 250.00
Strategy: Buy 245 Call, Sell 250 Call

Midpoint Entry:
- Buy 245 Call @ $5.00 (mid)
- Sell 250 Call @ $2.50 (mid)
- Cost: $2.50
- Max Profit: $2.50 (strike width $5.00 - cost $2.50)
- IRR: 200% (if 45 days to expiration)

Far Touch Entry:
- Buy 245 Call @ $5.05 (ask)
- Sell 250 Call @ $2.45 (bid)
- Cost: $2.60
- Max Profit: $2.40 (strike width $5.00 - cost $2.60)
- IRR: 185% (if 45 days to expiration)
```

### Example 2: Put Vertical Spread
```
Strikes: 240.00 / 245.00
Strategy: Buy 240 Put, Sell 245 Put

Midpoint Entry:
- Buy 240 Put @ $1.50 (mid)
- Sell 245 Put @ $3.00 (mid)
- Cost: $1.50 (net credit, but shown as cost)
- Max Profit: $3.50 (strike width $5.00 - cost $1.50)
- IRR: 467% (if 45 days to expiration)

Far Touch Entry:
- Buy 240 Put @ $1.55 (ask)
- Sell 245 Put @ $2.95 (bid)
- Cost: $1.60
- Max Profit: $3.40 (strike width $5.00 - cost $1.60)
- IRR: 425% (if 45 days to expiration)
```

## Visual Design

### Color Coding
- **Midpoint columns**: Bright white text (`text-gray-100`)
- **Far Touch columns**: Lighter gray text (`text-gray-300`)
- **Headers**: Gray text (`text-gray-400`)
- **Sub-headers**: Extra small font (`text-[10px]`)

### Spacing
- **Row padding**: `py-2 px-2`
- **Header padding**: `py-1 px-2` (sub-headers), `py-2 px-2` (main headers)
- **Font size**: `text-xs` (10px) for data, `text-[10px]` for sub-headers

### Alignment
- **Strikes**: Left-aligned
- **All numeric columns**: Right-aligned
- **Action button**: Center-aligned

## Benefits

1. **Realistic Pricing**: Shows both optimistic (midpoint) and realistic (far touch) entry scenarios
2. **Quick Comparison**: Easy to see the impact of slippage on returns
3. **Informed Decisions**: Traders can assess whether the spread is worth the execution risk
4. **Consistent Metrics**: Cost, Profit, and IRR shown for both scenarios
5. **Compact Layout**: All information visible without scrolling

## Implementation Notes

### Data Source
- **Midpoint data**: `netPremium`, `maxProfit`, `annualizedYield` from Python backend
- **Far touch data**: `netPremiumFarTouch` from Python backend, IRR calculated in UI

### Performance
- Calculations are simple and fast (no API calls)
- `useMemo` ensures grouping only recalculates when data changes
- No impact on rendering performance

### Sorting
- Sorting still works on `annualizedYield` (midpoint IRR)
- Click "IRR" column header under "Midpoint Entry" to sort
- Far touch IRR is not sortable (would require backend calculation)

## Future Enhancements

Potential improvements:
1. **Highlight Best Scenario**: Bold the better entry scenario
2. **Probability Weighting**: Show expected value based on fill probability
3. **Historical Fill Rates**: Show % of time midpoint vs far touch is achieved
4. **Bid-Ask Spread %**: Show spread width as % of mid price
5. **Slippage Cost**: Show dollar difference between midpoint and far touch

## Status

✅ **COMPLETE**: New column structure implemented with midpoint and far touch pricing for all strategies.

