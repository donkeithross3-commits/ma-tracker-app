# Team Instructions - Using Luis's M&A Dashboard

## Overview

This is Luis's M&A arbitrage dashboard - a trading strategy he's been running for 5 years. Luis runs the Python service on his machine with his premium IB market data subscriptions, which powers the entire dashboard at https://ma-tracker-app.vercel.app/.

Everyone else just uses the web app - no setup required! You'll be able to leverage Luis's superior market data for deal analysis and options scanning.

---

## For Everyone Except Luis

### How to Use the Options Scanner

1. **Navigate to the web app**:
   https://ma-tracker-6xtep91ya-don-ross-projects.vercel.app

2. **Go to any deal**:
   - Click "Deals" in navigation
   - Click on any M&A deal

3. **Open the Options tab**:
   - You'll see tabs: Overview | Deal Terms | **Options** | CVRs | Positions | Notes
   - Click the **Options** tab

4. **Scan for opportunities**:
   - Click the **"Scan Options"** button
   - Wait 10-15 seconds (IB API is slow)
   - View the results!

### What You'll See

The scanner shows:
- **Top 10 option opportunities** sorted by annualized return
- **Strategy type**: Call or Spread
- **Entry cost**: What you'd pay to enter
- **Max profit**: Maximum potential profit
- **Expected return**: Probability-weighted expected profit
- **Annualized return**: Return per year (e.g., 82.5%)
- **Probability of profit**: Based on deal confidence
- **Edge vs market**: Your advantage over market pricing
- **Contract details**: Strikes, expiry dates, Greeks (Delta, IV, etc.)

### Example Output

```
#1 CALL                                    +82.5% Annualized
Buy MSFT 175 Call @ $5.50, Max profit $10.00

Entry Cost: $5.50        Expected Return: $7.50
Max Profit: $10.00       Probability: 75%
Breakeven: $180.50       Edge vs Market: +15%

Contract Details:
MSFT $175.00 Call  Exp: Dec 15, 2025
Bid/Ask: $5.40 / $5.60  IV: 28%  Δ: 0.65
```

---

## When Can You Use It?

### Requires

1. **Luis's services running** (Python + IB Gateway)
2. **Market hours** (or IB delayed data subscription)
3. **Valid ticker** in the deal

### If You See Errors

**"Cannot connect to options scanner service"**
- Luis's Python service might be down
- Contact Luis to restart services
- Check: `LUIS_SETUP_GUIDE.md` for Luis

**"Cannot connect to Interactive Brokers"**
- IB Gateway not running on Luis's machine
- Contact Luis to start IB Gateway
- May happen if Luis restarts his computer

**"No option data available"**
- Market might be closed
- Ticker might not have options
- IB might not have data for that security

**"No profitable opportunities found"**
- Scanner found options but none were attractive
- Try adjusting deal parameters
- This is normal for some deals

---

## Best Practices

### For Best Results

1. **Ensure deal data is accurate**:
   - Correct deal price
   - Accurate expected close date
   - Realistic confidence level (0.7-0.9)

2. **Scan during market hours**:
   - NYSE: 9:30 AM - 4:00 PM ET
   - After-hours data may be stale

3. **Update deal data regularly**:
   - Prices change
   - Deal timelines shift
   - Re-scan after updates

4. **Check multiple deals**:
   - Scanner limited to prevent IB rate limits
   - Better opportunities on some deals than others

### Understanding the Results

**Annualized Return**:
- Higher is better
- 50%+ is very attractive
- 100%+ is exceptional (rare)

**Probability of Profit**:
- Based on deal confidence
- Higher confidence = higher probability
- Accounts for deal risk

**Edge vs Market**:
- Positive = you have an advantage
- Negative = market is pricing better odds than you
- Larger positive edge = better opportunity

**Strategy Types**:
- **Call**: Buy one call option (higher risk, higher reward)
- **Spread**: Buy one call, sell another (limited risk, limited reward)

---

## Limitations

### What the Scanner CANNOT Do

1. **Execute trades** - Analysis only, you must trade manually
2. **Guarantee profits** - Markets are unpredictable
3. **Account for all risks** - Deals can fail
4. **Provide real-time streaming** - Must click "Scan" each time
5. **Analyze unlimited options** - Limited to avoid IB rate limits

### Known Constraints

- **~9 option contracts** per scan (IB rate limit)
- **10-15 second** scan time (IB API is slow)
- **Market hours** for real-time data
- **Requires Luis's services** running

---

## Team Workflow

### Recommended Process

1. **Research deal** in Overview tab
2. **Review terms** in Deal Terms tab
3. **Scan options** in Options tab
4. **Evaluate opportunities**:
   - Compare annualized returns
   - Check probability of profit
   - Review contract details
5. **Add notes** in Notes tab
6. **Track position** in Positions tab if you trade

### Sharing Insights

- Add investable notes about good opportunities
- Update deal confidence based on new information
- Share findings with team in deal notes

---

## FAQ

**Q: Do I need IB Gateway on my computer?**
A: No! Luis runs it. You just use the web app.

**Q: Do I need an IB account?**
A: Only if you want to trade. The scanner works for everyone.

**Q: How often should I scan?**
A: Whenever deal parameters change or you need updated prices.

**Q: Can I scan multiple deals at once?**
A: No, one at a time. Each scan takes 10-15 seconds.

**Q: What if Luis's computer is off?**
A: Scanner won't work. Contact Luis.

**Q: Is this real-time data?**
A: Yes, during market hours (via Luis's IB subscription).

**Q: Can I save favorite opportunities?**
A: Not yet - future enhancement. For now, use deal notes.

**Q: Why does it take 10-15 seconds?**
A: IB API fetches real market data, calculates Greeks, etc. It's slow but accurate.

**Q: What's "implied volatility" (IV)?**
A: Market's expectation of future volatility. Higher IV = more expensive options.

**Q: What's Delta (Δ)?**
A: How much option price changes per $1 stock move. 0.65 = $0.65 move per $1 stock move.

---

## Troubleshooting

### If Scanner Doesn't Work

1. **Check if app is loading**: Can you see other tabs?
2. **Try refreshing the page**: Clear browser cache if needed
3. **Check browser console**: F12 → Console tab for errors
4. **Contact Luis**: His services may be down
5. **Contact team lead**: Report persistent issues

### If Results Look Wrong

1. **Verify deal data**: Is the deal price correct?
2. **Check close date**: Is it in the future?
3. **Update ticker**: Is it the right symbol?
4. **Re-scan**: Data may have been from earlier

---

## Support

**For scanner issues**: Contact Luis (check his services)
**For deal data issues**: Update in Deal Terms tab
**For questions**: Ask team lead or check documentation
**For IB trading**: Contact your broker

---

## Future Enhancements

Planned improvements:
- [ ] Save favorite opportunities
- [ ] Email alerts for attractive setups
- [ ] Automated scanning on price updates
- [ ] More strategy types (puts, spreads, etc.)
- [ ] Backtesting capabilities
- [ ] Position sizing recommendations

---

## Summary

**For everyone except Luis**:
- ✅ Just use the web app at https://ma-tracker-app.vercel.app/
- ✅ Click "Scan Options" button to leverage Luis's data
- ✅ No setup required
- ✅ All scans use Luis's superior IB subscription

**That's it!** This is Luis's M&A dashboard that he's been running for 5 years. You can leverage his premium IB data while he handles the infrastructure.

Happy scanning! 📊
