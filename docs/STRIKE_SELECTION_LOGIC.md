# Business Logic: Strike Price Selection for M&A Option Spreads

## Overview
The system uses a multi-stage process to determine which strike prices to consider when generating option spreads for merger arbitrage deals. The logic involves fetching available strikes from IB TWS, filtering them based on deal parameters, and then constructing spreads with specific rules.

---

## Part 1: Determining Which Strikes Exist

### 1.1 IB TWS API Call (`securityDefinitionOptionParameter`)

**Location:** `python-service/app/scanner.py` lines 488-522

**Process:**
```python
self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)
```

**What IB Returns:**
- **All available expirations** for the underlying stock
- **All available strike prices** (applies to ALL expirations)
- Returns as a `SetOfFloat` (set of strike prices)

**Example Response:**
```python
expirations = ['20260115', '20260122', '20260219', ...]  # All available expiry dates
strikes = [30.0, 32.5, 35.0, 37.5, 40.0, 42.5, 45.0, ...]  # ALL strikes for this underlying
```

**Storage:**
```python
self.available_strikes[expiration] = strike_list  # Stored per expiration
```

### 1.2 Fallback for Missing Data

**Location:** `python-service/app/scanner.py` lines 404-408

If IB doesn't return strikes (rare but possible):
```python
strikes = [price_to_use * 0.95, price_to_use, price_to_use * 1.05]
strikes = [round(s / 5) * 5 for s in strikes]  # Round to $5 increments
```

---

## Part 2: Filtering Strikes for Option Chain Fetch

### 2.1 Strike Bounds Calculation

**Location:** `python-service/app/scanner.py` lines 385-393

**Parameters (User-Configurable in UI):**
- `strike_lower_pct`: Default 20% (e.g., 0.20)
- `strike_upper_pct`: Default 10% (e.g., 0.10)
- `deal_price`: User-editable deal price

**Calculation Logic:**
```python
if deal_price:
    min_strike = deal_price * (1 - strike_lower_pct)  # Deal price - 20%
    max_strike = max(spot_price, deal_price) * (1 + strike_upper_pct)  # Max of spot/deal + 10%
else:
    min_strike = spot_price * (1 - strike_lower_pct)
    max_strike = spot_price * (1 + strike_upper_pct)
```

**Example with EA (deal price = $37.50, spot = $37.10):**
```
min_strike = $37.50 * (1 - 0.20) = $30.00
max_strike = max($37.10, $37.50) * (1 + 0.10) = $41.25
```

### 2.2 Filter Application

**Location:** `python-service/app/scanner.py` line 394

```python
relevant_strikes = [s for s in available_strikes if min_strike <= s <= max_strike]
```

**Result:** Only strikes between $30.00 and $41.25 are considered for fetching option data.

**Critical Note:** ALL strikes in this range are fetched, not limited to a specific number. This ensures comprehensive coverage for strategy generation.

---

## Part 3: Strike Selection for Spread Construction

### 3.1 Call Spread Strike Rules

**Location:** `python-service/app/scanner.py` lines 1044-1083

**Long Strike (Buy Call):**
```python
if long_call.strike >= self.deal.total_deal_value:
    continue  # Skip - only consider long strikes BELOW deal price
```

**Short Strike (Sell Call):**

Parameters (User-Configurable):
- `short_strike_lower_pct`: Default 10% (percentage BELOW deal price)
- `short_strike_upper_pct`: Default 20% (percentage ABOVE deal price)

```python
short_strike_lower_multiplier = 1.0 - short_strike_lower_pct  # e.g., 0.90
short_strike_upper_multiplier = 1.0 + short_strike_upper_pct  # e.g., 1.20

if (short_call.strike >= deal_price * short_strike_lower_multiplier and
    short_call.strike <= deal_price * short_strike_upper_multiplier):
    # Valid spread candidate
```

**Example with EA ($37.50 deal price):**
```
Short strike range: $37.50 * 0.90 to $37.50 * 1.20
                  = $33.75 to $45.00
```

**Spread Construction Logic:**
1. Sort all calls by strike price
2. For each potential long call (strike < deal price):
   - Look at next 4 higher strikes only
   - Check if short call is in valid range ($33.75 - $45.00)
   - If yes, analyze this spread

**Example Valid Spreads for EA:**
```
Long $35 / Short $37.50  ✓ (long < deal, short in range)
Long $35 / Short $40.00  ✓ (long < deal, short in range)
Long $30 / Short $37.50  ✓ (long < deal, short in range)
Long $37.50 / Short $40  ✗ (long not < deal price)
Long $35 / Short $50     ✗ (short > upper bound)
```

### 3.2 Put Spread Strike Rules

**Location:** `python-service/app/scanner.py` lines 1085-1135

**Long Put (Buy Put):**
```python
if long_put.strike >= self.deal.total_deal_value:
    continue  # Only consider long strikes BELOW deal price
```

**Short Put (Sell Put):**

Uses same `short_strike_lower_pct` and `short_strike_upper_pct` as call spreads:
```python
if (short_put.strike >= deal_price * short_strike_lower_multiplier and
    short_put.strike <= deal_price * short_strike_upper_multiplier):
    # Valid put spread candidate
```

**Put Spread Logic:**
- Buy lower strike put (long put)
- Sell higher strike put (short put)
- Creates a **credit spread** (collect premium)
- Short put should be at/near deal price
- Uses same strike bounds as call spreads for consistency

---

## Part 4: Strategy Selection and Ranking

### 4.1 Per-Expiration Top 5

**Location:** `python-service/app/scanner.py` lines 1077-1135

**Process:**
1. Group all valid spreads by expiration date
2. Sort each expiration's spreads by annualized return (highest first)
3. Take top 5 call spreads from each expiration
4. Take top 5 put spreads from each expiration
5. Return all (not globally limited)

**Result:** If there are 2 expirations, you get:
- Up to 10 call spreads (5 per expiration)
- Up to 10 put spreads (5 per expiration)
- Total: Up to 20 spreads displayed

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────┐
│ 1. User Loads Option Chain              │
│    - Ticker: EA                          │
│    - Deal Price: $37.50                  │
│    - Strike Lower: 20%                   │
│    - Strike Upper: 10%                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 2. IB TWS Query (securityDefinitionOptionParameter)│
│    Returns ALL available strikes:        │
│    [25, 27.5, 30, 32.5, 35, 37.5, 40,   │
│     42.5, 45, 47.5, 50, ...]             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 3. Filter by Strike Bounds               │
│    min = $37.50 * 0.80 = $30.00          │
│    max = $37.50 * 1.10 = $41.25          │
│    Filtered: [30, 32.5, 35, 37.5, 40]    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 4. Fetch Option Data for Filtered Strikes│
│    Fetch calls & puts for:               │
│    30C, 30P, 32.5C, 32.5P, ...          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 5. Generate Spread Candidates            │
│    For Call Spreads:                     │
│    - Long strike < $37.50 (deal)         │
│    - Short strike: $33.75 - $45.00       │
│    Analyze: 30/35, 30/37.5, 30/40,      │
│             32.5/35, 32.5/37.5, ...      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ 6. Rank and Select Top 5 Per Expiration │
│    Sort by annualized IRR                │
│    Return top performers                 │
└─────────────────────────────────────────┘
```

---

## Key Configuration Parameters

| Parameter | UI Label | Default | Purpose |
|-----------|----------|---------|---------|
| `strike_lower_pct` | Strike Lower Bound | 20% | How far below deal/spot to fetch strikes |
| `strike_upper_pct` | Strike Upper Bound | 10% | How far above deal/spot to fetch strikes |
| `short_strike_lower_pct` | Short Strike Lower | 10% | Minimum short strike (% below deal) |
| `short_strike_upper_pct` | Short Strike Upper | 20% | Maximum short strike (% above deal) |
| `days_before_close` | Days Before Close | 60 | How early before close to consider expirations |
| `top_strategies_per_expiration` | Top Strategies Per Expiration | 5 | How many spreads to show per expiration |

---

## Summary

### Strike Determination:
1. IB TWS provides ALL available strikes for the underlying
2. System filters to relevant range based on deal/spot price ±bounds
3. Fetches option data only for filtered strikes (efficiency)

### Spread Construction:
4. Long leg must be below deal price
5. Short leg must be within ±bounds of deal price
6. Both legs must have same expiration
7. System evaluates all valid combinations

### Final Selection:
8. Rank by annualized return
9. Return top 5 per expiration per strategy type
10. Display to user for curation

This ensures comprehensive coverage of viable merger arbitrage spreads while respecting IB's data limits and focusing on the most profitable opportunities.

---

## Related Files

- `python-service/app/scanner.py` - Core strike filtering and spread generation logic
- `python-service/app/api/options_routes.py` - API endpoints for option chain and strategy generation
- `python-service/app/options/models.py` - Data models including `ScanParameters`
- `components/ma-options/DealInfo.tsx` - UI for configuring scan parameters
- `docs/OPTIONS_SCANNER_UI_PARAMETERS.md` - UI parameter documentation

---

*Last Updated: December 2024*

