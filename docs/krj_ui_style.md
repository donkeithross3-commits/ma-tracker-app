# KRJ UI Style Guidelines

Audience: active traders scanning cross-sectional signals.

Goals:
- Max information per vertical pixel while still readable.
- Make it easy to compare **down a column** and **across a row**.
- No “cute” UI chrome; everything on screen either carries data or improves legibility.

Table layout:
- Compact row height, but with enough padding that rows are distinguishable.
- Header row:
  - Sticky when scrolling.
  - Bold, high-contrast text.
- Zebra striping on rows; subtle hover highlight.
- Numeric columns **right-aligned** with consistent decimals.

Number formatting:
- Prices: 2 decimals.
- Signal values and volatility: shown as % with 1 decimal (e.g. `3.2%`).
- ADV in shares: compact “12.3M”.
- ADV in notional: compact “0.45B”.
- No more than 2–3 decimal places anywhere on screen.

Color:
- Dark background, light text.
- Yellow summary card for signal counts is acceptable, but avoid random colors.
- Use color sparingly to encode meaning (e.g. long/short/neutral) if we add that later.

General:
- Prefer tables over cards.
- Avoid wrapping text; tickers and labels should stay on a single line.
- Don’t add animations, charts, or icons unless explicitly requested.

- Avoid horizontal scroll in data tables whenever possible.
- Column headers may wrap to multiple lines; do not keep long labels on a single line if it forces wide, sparse columns.
- Summary cards (like signal counts) should sit above or below the main table, not steal horizontal space from it.
