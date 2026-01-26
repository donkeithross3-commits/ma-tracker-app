# M&A Options Scanner - Parameter Quick Reference Card

## 🎯 Quick Start

**Default settings work for most deals.** Only adjust if you need to:
- Widen/narrow the search range
- Focus on specific expirations
- Adjust for deal confidence

---

## 📊 Parameter Cheat Sheet

| Parameter | Default | When to Increase | When to Decrease |
|-----------|---------|------------------|------------------|
| **Days Before Close** | 0 | Want more expirations | Want tight bracketing |
| **Strike Lower Bound** | 20% | Want more OTM options | Want faster scan |
| **Strike Upper Bound** | 10% | Want more OTM options | Want faster scan |
| **Short Strike Lower** | 95% | More aggressive spreads | Tighter at-the-money |
| **Short Strike Upper** | 0.5% | More flexibility | Tighter at-the-money |
| **Top Strategies** | 5 | See more options | Focus on best only |
| **Deal Confidence** | 75% | High-confidence deal | Uncertain deal |

---

## 🔧 Common Scenarios

### Scenario 1: High-Confidence Deal (Regulatory Approved)
```
Days Before Close:    0
Strike Lower Bound:   15%
Strike Upper Bound:   5%
Short Strike Lower:   98%
Short Strike Upper:   0.25%
Top Strategies:       3
Deal Confidence:      95%
```
**Why**: Tight focus on at-the-money options, high confidence in deal closing.

---

### Scenario 2: Uncertain Deal (Pending Regulatory Review)
```
Days Before Close:    30
Strike Lower Bound:   30%
Strike Upper Bound:   20%
Short Strike Lower:   90%
Short Strike Upper:   2.0%
Top Strategies:       10
Deal Confidence:      50%
```
**Why**: Broader search, more flexibility, lower confidence.

---

### Scenario 3: Near-Term Close (< 30 days)
```
Days Before Close:    0
Strike Lower Bound:   20%
Strike Upper Bound:   10%
Short Strike Lower:   95%
Short Strike Upper:   0.5%
Top Strategies:       5
Deal Confidence:      80%
```
**Why**: Default settings, focus on expirations around close date.

---

### Scenario 4: Long-Term Close (> 90 days)
```
Days Before Close:    30
Strike Lower Bound:   25%
Strike Upper Bound:   15%
Short Strike Lower:   92%
Short Strike Upper:   1.0%
Top Strategies:       8
Deal Confidence:      70%
```
**Why**: Wider search to capture more expirations, more flexibility.

---

## 🎓 Understanding the Parameters

### Strike Bounds (What to Fetch)
- **Lower Bound**: How far below deal price to search
  - 20% = $100 deal → $80 min strike
- **Upper Bound**: How far above deal price to search
  - 10% = $100 deal → $110 max strike

### Short Strike Bounds (Where to Sell)
- **Lower**: Minimum % of deal price for short leg
  - 95% = $100 deal → $95 min short strike
- **Upper**: Maximum % above deal price for short leg
  - 0.5% = $100 deal → $100.50 max short strike

**Key Insight**: Short strike should be AT or NEAR deal price for merger arbitrage.

---

## 🚨 Troubleshooting

### Problem: No Strategies Generated
**Solution**:
1. Widen strike bounds (increase lower/upper)
2. Increase days before close
3. Loosen short strike bounds

### Problem: Too Many Strategies
**Solution**:
1. Reduce "Top Strategies" to 3
2. Tighten short strike bounds (98% / $0.25)
3. Narrow strike bounds

### Problem: Scan is Slow
**Solution**:
1. Narrow strike bounds (reduce lower/upper)
2. Set days before close to 0
3. Reduce top strategies to 3

---

## 💡 Pro Tips

1. **Start with defaults** → Only adjust if needed
2. **Short strike is critical** → Should be at/near deal price for merger arb
3. **Deal confidence matters** → Affects expected value calculations
4. **More expirations ≠ better** → Focus on expirations around close date
5. **Use "Reset to Defaults"** → If you get lost

---

## 📈 Parameter Impact on Results

### Days Before Close
- **0**: 2 expirations (bracket close date)
- **30**: 2-3 expirations (30 days before to close)
- **60**: 3-4 expirations (60 days before to close)

### Strike Bounds
- **Narrow (10%/5%)**: ~10-20 strikes per expiration
- **Default (20%/10%)**: ~20-40 strikes per expiration
- **Wide (30%/20%)**: ~40-80 strikes per expiration

### Short Strike Bounds
- **Tight (98%/0.25%)**: 1-2 short strikes per expiration
- **Default (95%/0.5%)**: 2-4 short strikes per expiration
- **Loose (90%/2.0%)**: 4-8 short strikes per expiration

---

## 🔍 What's Happening Behind the Scenes

1. **Fetch Option Chain** (using Strike Bounds)
   - Query IB TWS for options in the strike range
   - Filter by expiration (using Days Before Close)
   - Store in database

2. **Generate Strategies** (using Short Strike Bounds)
   - Build call spreads (long < deal price, short at deal price)
   - Build put spreads (long < deal price, short at deal price)
   - Rank by annualized return
   - Return top N per expiration

3. **Calculate Metrics**
   - Expected value (using Deal Confidence)
   - Max profit/loss
   - Return on risk
   - Annualized yield

---

## 📞 Need Help?

- **In-UI Guide**: Click "Show Parameters" → scroll to bottom
- **Full Documentation**: `docs/OPTIONS_SCANNER_UI_PARAMETERS.md`
- **Technical Details**: `docs/OPTIONS_SCANNER_PARAMETERS.md`

---

## 🎯 TL;DR

**Most deals**: Use defaults, just click "Load Option Chain"

**High confidence**: Tighten short strike (98%/0.25%), increase confidence (95%)

**Low confidence**: Widen search (30 days before, 30%/20% bounds), decrease confidence (50%)

**Slow scan**: Narrow bounds (15%/5%), set days to 0

**No results**: Widen bounds (30%/20%), increase days to 30

