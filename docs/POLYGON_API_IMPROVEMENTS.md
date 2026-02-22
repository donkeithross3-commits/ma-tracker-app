# Polygon API: Research and Improvement Plan

## Context

- We moved from a **free** Polygon account to a **paid Developer** tier.
- Free tier: strict rate limits (e.g. 5 req/min), limited history.
- Paid Developer: higher or "unlimited" API calls, more history (e.g. 10 years for daily aggs).
- We had no explicit **retries**, **429 handling**, or **batch options** in several places, leading to missing signals in the weekly run when the batch hit limits or transient errors.

## Research Summary

### REST API (what we use)

- **Endpoint**: `GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}`
- **Limit**: Up to 50,000 candles per request (we request ~35 days → well under).
- **Rate limits**: Paid tiers have higher limits; 429 can still occur under burst. Best practice: exponential backoff on 429/5xx.
- **Official docs**: [Custom Bars (OHLC) – Polygon/Massive](https://polygon.io/docs/stocks/get_v2_aggs_ticker__stocksticker__range__multiplier___timespan___from___to).

### Batch / bulk options

- **Polygon Python SDK** (`polygon-api-client`): `get_aggregate_bars(..., full_range=True)` can chunk date ranges and run **parallel** workers. Our `dr3_data_libs.get_daily_data()` uses sequential `get_aggs()` per ticker with sleep — we could explore parallel in a future iteration.
- **Flat files**: Polygon offers daily-aggregate CSVs via S3 for all US equities. Could replace per-ticker REST for the weekly "all tickers" run but requires a different pipeline (download → parse → merge). Not implemented here.
- **Single-ticker on-demand** (dashboard "Request signal"): No batch; one request per ticker. Improvements are retries + 429 handling so transient failures succeed on retry.

### 429 and retries

- Polygon returns **429 Too Many Requests** when rate limits are hit.
- Their Python client has limited built-in retry; users report `MaxRetryError` after many 429s.
- **Recommendation**: Explicit retry with exponential backoff (e.g. 1s, 2s, 4s) and treat 429/5xx as retriable; optionally respect `Retry-After` if present.

### Env and naming

- We use **`POLYGON_API_KEY`** everywhere (ma-tracker-app Python service, scripts, py_proj). No change.

---

## Improvement Plan (Executed)

### 1. ma-tracker-app: Python single-ticker signal (`python-service/app/krj/single_ticker.py`)

- **Before**: Single `httpx` GET, no retries; any 4xx/5xx raised and surfaced to user.
- **After**:
  - Retry loop (e.g. 3 attempts) with exponential backoff.
  - On **429**: backoff (e.g. 2s, 4s, 8s); optional use of `Retry-After` header.
  - On **5xx**: retry with backoff; after max attempts raise `SignalError` with a clear message.
  - Configurable timeout via env `KRJ_POLYGON_TIMEOUT` (default 30s).
  - Log 429/5xx and attempt number for debugging.

### 2. ma-tracker-app: Market cap script (`scripts/fetch-krj-market-caps.ts`)

- **Before**: One fetch per ticker, 220ms delay; no retries.
- **After**:
  - Retry up to 3 times on 429 or 5xx with exponential backoff.
  - Keep 220ms between tickers (safe for paid tier); backoff only on failure.

### 3. py_proj: Batch daily download (`dr3_data_libs.get_daily_data`)

- **Before**: `max_retries=3`, exponential backoff on generic exception; no explicit 429 handling. `sleep_duration` fixed by caller (e.g. 13s in backtester).
- **After**:
  - Detect **429** in exception (message or status); use longer backoff for 429 (e.g. 5s base) and optionally respect `Retry-After`.
  - Increase `max_retries` to 5 when 429 is detected (same ticker retried more).
  - Keep existing "no data" / "not found" logic (no retry).
  - Document that paid tier can use lower `sleep_duration` (e.g. 0.2–1s) for throughput.

### 4. py_proj: Weekly backtester (`KRJ_backtester_updated.py`)

- **Before**: `sleep_duration=13` (conservative for free tier).
- **After**:
  - Use **configurable** sleep via env `KRJ_POLYGON_SLEEP` (default `1.0` for paid tier).
  - In-script comment: free tier may need 5–13s; paid tier 0.2–1s.

### 5. Optional (not done in this pass)

- **Parallel batch in py_proj**: Use Polygon SDK `get_aggregate_bars(..., full_range=True, run_parallel=True)` or a thread pool to fetch multiple tickers concurrently (with global rate limit). Reduces weekly run time.
- **Flat files**: Evaluate S3 daily-aggregates for "all tickers one week" to avoid N REST calls.
- **Second pass for missing signals**: After weekly run, optionally call single-ticker for any constituent with no signal (same as dashboard "Request signal") and merge into CSVs.

---

## Files Touched

| Repo           | File                              | Changes |
|----------------|-----------------------------------|--------|
| ma-tracker-app | `docs/POLYGON_API_IMPROVEMENTS.md`| New: plan + research |
| ma-tracker-app | `python-service/app/krj/single_ticker.py` | Retries, 429/5xx backoff, timeout env, logging |
| ma-tracker-app | `scripts/fetch-krj-market-caps.ts`       | Retries + backoff for 429/5xx |
| py_proj        | `dr3_data_libs.py` (get_daily_data)       | 429 detection, longer backoff, more retries for 429 |
| py_proj        | `KRJ_backtester_updated.py`               | Configurable sleep (env), default 1.0s for paid tier |
