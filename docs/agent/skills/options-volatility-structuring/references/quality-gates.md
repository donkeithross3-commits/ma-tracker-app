# Option Data Quality Gates

## Contract Normalization

1. `ticker` uppercase and validated
2. `expiry` normalized to `YYYY-MM-DD` (or explicit converter)
3. `right` constrained to call/put conventions
4. `strike` numeric and precision-safe

## Liquidity and Spread Gates

1. Reject contracts above max spread threshold.
2. Reject contracts below minimum premium threshold.
3. Reject stale/missing bid+ask unless explicit fallback exists.

## Fallback Discipline

1. Prefer Polygon when configured and healthy.
2. Fall back to IB only with explicit observability.
3. Return actionable error text when both paths fail.
