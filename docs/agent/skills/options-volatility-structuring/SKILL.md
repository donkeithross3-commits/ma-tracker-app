---
name: options-volatility-structuring
description: Analyze and implement options-chain selection, pricing, and volatility-aware strategy logic for M&A and intraday workflows. Use for strike/expiry filters, liquidity gates, spread controls, IV-aware thresholds, and option data quality decisions.
---

# Options Volatility Structuring

## Quick Start

1. Confirm data source path (Polygon primary, IB fallback, or both).
2. Validate chain quality before strategy logic changes.
3. Keep liquidity and spread safety constraints explicit.
4. Document any changed assumptions on DTE/expiry/strike filtering.

## DR3 Hot Paths

- `python-service/app/api/options_routes.py`
- `python-service/standalone_agent/ib_scanner.py`
- `python-service/standalone_agent/strategies/big_move_convexity.py`

## Workflow

### 1) Data Integrity

- Verify symbol/right/expiry/strike normalization.
- Verify null/NaN handling for IV and Greeks.
- Verify fallback behavior between Polygon and IB.

### 2) Selection Logic

- Re-check strike bands, DTE windows, and scan time windows.
- Re-check bid/ask spread caps and premium bounds.
- Ensure result ordering and filtering are deterministic.

### 3) Risk-Aware Constraints

- Keep wide-spread and illiquid contracts gated.
- Keep account-sensitive behavior separated from quote-only paths.
- Preserve explicit user-facing error messages on market-data gaps.

### 4) Validation

- Compare pre/post contract counts and latency.
- Validate sample tickers across open/closed market contexts.
- Validate that strategy ranking fields remain coherent.

## Guardrails

- Do not silently broaden strike/DTE ranges in live paths.
- Do not remove spread/liquidity constraints without replacement.
- Do not mix up display-only timestamps and ordering timestamps.

## Output Contract

Return:

1. Data source and selection changes
2. Risk/liquidity impact
3. Validation samples and outcomes
4. Remaining assumptions requiring market-open verification
