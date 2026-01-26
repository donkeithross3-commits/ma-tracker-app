# M&A Options Scanner - Parameters Summary

## Overview
This document details all parameters involved in determining which options to scan and which strategies to generate when the "Load Option Chain" button is clicked.

**🎉 NEW**: All parameters are now exposed in the UI! Click "Show Parameters" in the Deal Info section to adjust them without modifying code.

**Quick Links:**
- [Quick Reference Card](./PARAMETER_QUICK_REFERENCE.md) - Cheat sheet for common scenarios
- [UI Parameters Guide](./OPTIONS_SCANNER_UI_PARAMETERS.md) - Detailed UI documentation
- [Implementation Summary](../PARAMETER_EXPOSURE_SUMMARY.md) - Technical details

---

## 1. EXPIRATION SELECTION PARAMETERS

### Primary Parameter: `days_before_close`
**Current Setting:** `0`  
**Location:** `python-service/app/api/options_routes.py` line 115

**Behavior:**
- **`0` (current)**: Selects exactly 2 expirations:
  - Latest expiration BEFORE deal close date (closest to close)
  - Earliest expiration AT/AFTER deal close date (closest after close)
  - This brackets the deal close date
  
- **`N > 0`**: Allows expirations from `(deal_close_date - N days)` onwards
  - Selects up to 3 expirations in this range
  - Example: `days_before_close=30` would include expirations 30 days before close

**Rationale:** Merger arb options should expire close to the deal close date to minimize time decay while capturing the deal completion.

### Fallback Parameter: `expiry_months`
**Current Setting:** `6`  
**Location:** `python-service/app/api/options_routes.py` line 112

**Behavior:** Only used if `deal_close_date` is not provided. Fetches expirations up to 6 months from today.

---

## 2. STRIKE SELECTION PARAMETERS

### Strike Range - Lower Bound
**Current Setting:** `deal_price * 0.80` (20% below deal price)  
**Location:** `python-service/app/scanner.py` line 376

**Behavior:** Minimum strike to fetch = 80% of deal price

**Example:** If deal price is $100, minimum strike = $80

### Strike Range - Upper Bound
**Current Setting:** `max(current_price, deal_price) * 1.10` (10% above current/deal)  
**Location:** `python-service/app/scanner.py` line 377

**Behavior:** Maximum strike to fetch = 110% of the higher of current price or deal price

**Example:** 
- Deal price: $100, Current price: $95 → Max strike = $110
- Deal price: $100, Current price: $105 → Max strike = $115.50

**Rationale:** Captures all potential profitable spreads while avoiding far OTM strikes with no liquidity.

---

## 3. SPREAD CONSTRUCTION PARAMETERS

### Call Spread - Long Strike Filter
**Current Setting:** `long_strike < deal_price`  
**Location:** `python-service/app/scanner.py` line 1020

**Behavior:** Only considers buying calls BELOW the deal price

**Rationale:** For merger arb, you want to buy calls that will be ITM when deal closes.

### Call Spread - Short Strike Range
**Current Setting:** 
- **Lower:** `deal_price * 0.95` (95% of deal price)
- **Upper:** `deal_price + 0.50` ($0.50 above deal price)

**Location:** `python-service/app/scanner.py` lines 1030-1031

**Behavior:** Only sells calls at or very near the deal price

**Rationale:** Stock will converge to deal price, not exceed it. Short strike should be at the target.

### Call Spread - Width Limit
**Current Setting:** Look at next 4 strikes only  
**Location:** `python-service/app/scanner.py` line 1023

**Behavior:** For each long strike, only considers the next 4 higher strikes as potential short strikes

**Rationale:** Limits spread width to reasonable ranges, avoids very wide spreads with poor risk/reward.

### Put Spread - Parameters
**Same as call spreads:**
- Long strike < deal price
- Short strike: 95% to 100.5% of deal price
- Look at next 4 strikes

**Location:** `python-service/app/scanner.py` lines 1071-1081

---

## 4. STRATEGY FILTERING PARAMETERS

### Top Strategies Per Expiration
**Current Setting:** Top 5 per expiration  
**Location:** `python-service/app/scanner.py` lines 1044, 1096

**Behavior:** 
- Returns top 5 call spreads from each expiration (sorted by annualized return)
- Returns top 5 put spreads from each expiration (sorted by annualized return)

**Example:** With 2 expirations, you'd get up to 10 call spreads + 10 put spreads = 20 total strategies

### Single Calls Filter
**Current Setting:** `expected_return > 0` AND `strike < deal_price`  
**Location:** `python-service/app/scanner.py` lines 992-994

**Behavior:** Only shows single call options that:
- Have positive expected return
- Strike below deal price

---

## 5. DEAL CONFIDENCE PARAMETER

**Current Setting:** `0.75` (75%)  
**Location:** `python-service/app/api/options_routes.py` line 162 (in generate-strategies)

**Behavior:** Used in probability calculations for expected returns

**Rationale:** Assumes 75% probability the deal closes successfully. This affects:
- Expected return calculations
- Probability of profit estimates
- Edge vs market calculations

---

## 6. BATCH PROCESSING PARAMETERS

### Batch Size
**Current Setting:** `50` contracts per batch  
**Location:** `python-service/app/scanner.py` line 631

**Behavior:** Fetches option prices in batches of 50 to avoid overwhelming IB API

### Wait Times
- **Per contract in batch:** `0.05` seconds (50ms)
- **Per batch:** `0.5 + (batch_size * 0.02)` seconds
- **Between batches:** `0.2` seconds

**Location:** `python-service/app/scanner.py` lines 677, 680, 695

**Rationale:** Respects IB API rate limits while maintaining reasonable speed.

---

## SUMMARY TABLE

| Parameter | Current Value | Location | Impact |
|-----------|--------------|----------|--------|
| **Expiration Selection** |
| `days_before_close` | `0` | options_routes.py:115 | Only 2 expirations (before & after close) |
| `expiry_months` | `6` | options_routes.py:112 | Fallback if no close date |
| **Strike Selection** |
| Strike lower bound | `deal_price * 0.80` | scanner.py:376 | 20% below deal |
| Strike upper bound | `max(spot, deal) * 1.10` | scanner.py:377 | 10% above |
| **Spread Construction** |
| Long strike filter | `< deal_price` | scanner.py:1020 | Only ITM at close |
| Short strike lower | `deal_price * 0.95` | scanner.py:1030 | 95% of deal |
| Short strike upper | `deal_price + 0.50` | scanner.py:1031 | $0.50 above deal |
| Strike lookahead | `4` strikes | scanner.py:1023 | Next 4 only |
| **Strategy Selection** |
| Top per expiration | `5` | scanner.py:1044,1096 | Top 5 each type |
| Deal confidence | `0.75` | options_routes.py:162 | 75% probability |
| **Performance** |
| Batch size | `50` | scanner.py:631 | 50 contracts/batch |
| Delay per contract | `0.05s` | scanner.py:677 | Rate limiting |

---

## RECOMMENDATIONS FOR TUNING

### To Get More Strategies:
1. Increase `days_before_close` from `0` to `30` → More expirations
2. Increase top strategies from `5` to `10` → More strategies per expiration
3. Widen short strike range from `±5%` to `±10%` → More spread combinations

### To Get Tighter Spreads:
1. Reduce strike lookahead from `4` to `2` → Narrower spreads only
2. Tighten short strike range to `deal_price ± 0.25` → Closer to ATM

### To Focus on Highest Quality:
1. Add minimum liquidity filter (volume > 100, OI > 500)
2. Reduce top strategies from `5` to `3` → Only best 3 per expiration
3. Add minimum expected return threshold (e.g., > 5%)

### To Speed Up Scanning:
1. Reduce batch wait time from `0.05s` to `0.03s` per contract
2. Reduce strike range to `±15%` instead of `20%/10%`

---

## NEXT STEPS

**✅ DONE**: All key parameters are now exposed in the UI!

To modify parameters:
1. **Via UI (Recommended):** Click "Show Parameters" in the Deal Info section
2. **Via Code (Advanced):** Edit `python-service/app/scanner.py` for hardcoded limits (e.g., max spread width)

**UI-Exposed Parameters:**
- Days Before Close
- Strike Lower/Upper Bounds
- Short Strike Lower/Upper Bounds
- Top Strategies Per Expiration
- Deal Confidence

**Still Hardcoded:**
- Max Spread Width ($5)
- Batch wait time (0.05s)
- Liquidity thresholds

See [OPTIONS_SCANNER_UI_PARAMETERS.md](./OPTIONS_SCANNER_UI_PARAMETERS.md) for full UI documentation.

