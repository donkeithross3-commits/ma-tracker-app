# Leg Prices Column Addition

## Overview

Added a new "Leg Prices" column to the Candidate Strategies table that shows the expected price to pay for each individual leg of the spread, for both midpoint and far touch entry scenarios.

## New Column Layout

```
┌─────────┬───────────────────┬──────────────────────┬──────────────────────┬─────┬────────┐
│ Strikes │   Leg Prices      │  Midpoint Entry      │  Far Touch Entry     │ Liq │ Action │
│         │                   ├──────┬───────┬───────┼──────┬───────┬───────┤     │        │
│         │                   │ Cost │Profit │  IRR  │ Cost │Profit │  IRR  │     │        │
└─────────┴───────────────────┴──────┴───────┴───────┴──────┴───────┴───────┴─────┴────────┘
```

## Column Details

### Leg Prices Column

Displays two rows of information:
1. **Mid**: Leg prices using midpoint (average of bid/ask)
2. **Far**: Leg prices using far touch (ask for buys, bid for sells)

#### Format
- **Sign**: `-` for BUY legs (money out), `+` for SELL legs (money in)
- **Price**: Dollar amount per contract
- **Separator**: Space between legs

#### Examples

**Call Vertical Spread (Buy 245, Sell 250)**
```
Mid: -$5.00 +$2.50
Far: -$5.05 +$2.45
```
- Buy 245 Call @ $5.00 mid (or $5.05 ask)
- Sell 250 Call @ $2.50 mid (or $2.45 bid)

**Put Vertical Spread (Buy 240, Sell 245)**
```
Mid: -$1.50 +$3.00
Far: -$1.55 +$2.95
```
- Buy 240 Put @ $1.50 mid (or $1.55 ask)
- Sell 245 Put @ $3.00 mid (or $2.95 bid)

**Long Call (Buy 245)**
```
Mid: -$5.00
Far: -$5.05
```
- Buy 245 Call @ $5.00 mid (or $5.05 ask)

## Implementation Details

### Data Extraction

```typescript
// Midpoint prices (average of bid/ask)
const legPricesMid = candidate.legs.map((leg) => {
  const price = leg.mid || 0;
  const sign = leg.side === "BUY" ? "-" : "+";
  return `${sign}$${price.toFixed(2)}`;
}).join(" ");

// Far touch prices (ask for buys, bid for sells)
const legPricesFar = candidate.legs.map((leg) => {
  const price = leg.side === "BUY" ? (leg.ask || 0) : (leg.bid || 0);
  const sign = leg.side === "BUY" ? "-" : "+";
  return `${sign}$${price.toFixed(2)}`;
}).join(" ");
```

### Display

```tsx
<td className="py-2 px-2 text-gray-400 font-mono text-xs">
  <div className="text-[10px]" title={`Midpoint: ${legPricesMid}`}>
    Mid: {legPricesMid}
  </div>
  <div className="text-[10px] text-gray-500" title={`Far Touch: ${legPricesFar}`}>
    Far: {legPricesFar}
  </div>
</td>
```

### Styling
- **Font**: Monospace for alignment
- **Size**: 10px (extra small) to keep compact
- **Color**: 
  - Midpoint: `text-gray-400` (medium gray)
  - Far Touch: `text-gray-500` (lighter gray)
- **Tooltip**: Full text on hover for clarity

## Use Cases

### 1. Execution Planning
Traders can see exactly what prices they need to hit for each leg:
```
Strikes: 245.00 / 250.00
Leg Prices:
  Mid: -$5.00 +$2.50
  Far: -$5.05 +$2.45
```
**Action**: Place limit orders at $5.00 for the 245 call and $2.50 for the 250 call.

### 2. Slippage Assessment
Compare midpoint vs far touch to understand execution risk:
```
Mid: -$5.00 +$2.50  (net: $2.50 debit)
Far: -$5.05 +$2.45  (net: $2.60 debit)
Slippage: $0.10 per spread
```

### 3. Leg-by-Leg Entry
For traders who prefer to leg into spreads:
```
Step 1: Buy 245 call @ $5.00 (or better)
Step 2: Sell 250 call @ $2.50 (or better)
Target net debit: $2.50
```

### 4. Market Making
See the bid-ask spread for each leg:
```
245 Call: Bid $4.95, Ask $5.05 (spread: $0.10)
250 Call: Bid $2.45, Ask $2.55 (spread: $0.10)
```

## Example Scenarios

### Scenario 1: Tight Spread (Liquid Options)
```
Strikes: 95.00 / 100.00
Leg Prices:
  Mid: -$7.50 +$4.50
  Far: -$7.55 +$4.45
Cost (Mid): $3.00
Cost (Far): $3.10
Slippage: $0.10 (3.3%)
```
**Interpretation**: Very liquid, small slippage expected.

### Scenario 2: Wide Spread (Illiquid Options)
```
Strikes: 95.00 / 100.00
Leg Prices:
  Mid: -$7.50 +$4.50
  Far: -$8.00 +$4.00
Cost (Mid): $3.00
Cost (Far): $4.00
Slippage: $1.00 (33%)
```
**Interpretation**: Illiquid, significant slippage risk. May want to skip this strategy.

### Scenario 3: Credit Spread
```
Strikes: 240.00 / 245.00 (Put Spread)
Leg Prices:
  Mid: -$1.50 +$3.00
  Far: -$1.55 +$2.95
Credit (Mid): $1.50
Credit (Far): $1.40
Slippage: $0.10 (6.7% less credit)
```
**Interpretation**: Receive $1.50 credit at mid, but only $1.40 at far touch.

## Benefits

1. **Transparency**: See exactly what you're paying for each leg
2. **Execution Confidence**: Know the target prices before placing orders
3. **Slippage Awareness**: Compare mid vs far to understand execution risk
4. **Leg-by-Leg Strategy**: Can enter legs separately with clear targets
5. **Quick Validation**: Verify that leg prices add up to the total cost

## Visual Design

### Compact Two-Row Format
```
┌─────────────────────────────┐
│ Leg Prices                  │
├─────────────────────────────┤
│ Mid: -$5.00 +$2.50          │
│ Far: -$5.05 +$2.45          │
└─────────────────────────────┘
```

### Color Hierarchy
- **Mid**: Medium gray (`text-gray-400`) - primary reference
- **Far**: Light gray (`text-gray-500`) - secondary reference

### Font Size
- **10px**: Keeps the column compact while remaining readable

### Tooltip
- Hover over the cell to see full text if truncated
- Useful for complex strategies with 3+ legs

## Edge Cases Handled

### 1. Missing Prices
```typescript
const price = leg.mid || 0;  // Default to 0 if missing
```

### 2. Single Leg Strategies
```
Mid: -$5.00
Far: -$5.05
```
Only one price shown (no second leg).

### 3. Multi-Leg Strategies (3+ legs)
```
Mid: -$10.00 +$7.00 +$4.00
Far: -$10.10 +$6.90 +$3.95
```
All legs shown with proper signs.

## Testing Recommendations

1. **Two-Leg Spreads**: Verify both legs show with correct signs
2. **Single-Leg**: Verify only one price shows
3. **Credit Spreads**: Verify signs are correct (BUY is -, SELL is +)
4. **Wide Bid-Ask**: Verify far touch shows significant difference from mid
5. **Tight Bid-Ask**: Verify far touch is close to mid
6. **Missing Data**: Verify defaults to $0.00 gracefully

## Future Enhancements

Potential improvements:
1. **Color-code legs**: Green for SELL, red for BUY
2. **Show bid-ask spread**: Display spread width for each leg
3. **Highlight wide spreads**: Warning color for illiquid legs
4. **Show Greeks**: Delta, theta for each leg
5. **Interactive tooltips**: Click to see full option details

## Status

✅ **COMPLETE**: Leg Prices column added with midpoint and far touch pricing for all strategies.

