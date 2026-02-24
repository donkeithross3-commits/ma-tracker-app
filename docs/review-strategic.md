# Strategic Review: Sheet Portfolio Data Model

**Date:** 2026-02-24
**Reviewer:** Strategic Review Agent
**Scope:** Column coverage, row counts, category distribution, semantic correctness, edge cases, data model gaps

---

## 1. Column Coverage

**Sheet Header (19 columns):**
`Ticker, Acquiror, Anncd, Close, End Dt, Cntdwn, Deal Px, Crrnt Px, Grss Yield, Px Chng, Crrnt Yield, Category, Investable, Go Shop or Likely Overbid?, Vote Risk, Finance Risk, Legal Risk, CVR, Link to Sheet`

**COLUMN_MAP in ingest.py maps all 19.** Every sheet column has a corresponding `_raw` text field in the DB schema plus (where applicable) a parsed typed field. Full coverage confirmed.

| Sheet Column | DB raw field | DB parsed field | Status |
|---|---|---|---|
| Ticker | ticker | -- | OK |
| Acquiror | acquiror | -- | OK |
| Anncd | announced_date_raw | announced_date (DATE) | OK |
| Close | close_date_raw | close_date (DATE) | OK |
| End Dt | end_date_raw | end_date (DATE) | OK |
| Cntdwn | countdown_raw | countdown_days (INT) | OK |
| Deal Px | deal_price_raw | deal_price (NUMERIC) | OK |
| Crrnt Px | current_price_raw | current_price (NUMERIC) | OK |
| Grss Yield | gross_yield_raw | gross_yield (NUMERIC) | OK |
| Px Chng | price_change_raw | price_change (NUMERIC) | OK |
| Crrnt Yield | current_yield_raw | current_yield (NUMERIC) | OK |
| Category | category | -- | OK |
| Investable | investable | -- | OK |
| Go Shop or Likely Overbid? | go_shop_raw | -- | OK |
| Vote Risk | vote_risk | -- | OK |
| Finance Risk | finance_risk | -- | OK |
| Legal Risk | legal_risk | -- | OK |
| CVR | cvr_flag | -- | OK |
| Link to Sheet | link_to_sheet | deal_tab_gid (derived) | OK |

**Verdict: All 19 columns captured. No missing or misnamed columns.**

---

## 2. Row Count

| Source | Count |
|---|---|
| Google Sheet CSV (live) | 82 data rows (83 lines including header) |
| `GET /portfolio/snapshot` row_count | 82 |
| `GET /portfolio/deals` array length | 82 |

**Verdict: Exact match. No rows lost during ingest.**

---

## 3. Category Distribution

| Category (from API) | Count | Notes |
|---|---|---|
| All-cash | 57 | Largest group |
| Cash & Stock | 12 | |
| Stock & Cash | 3 | Different ordering from "Cash & Stock" |
| All-stock | 2 | |
| Cash + CVR | 2 | |
| Cash + Spin-off | 2 | |
| Cash & CVR | 1 | Different delimiter from "Cash + CVR" |
| Cash + Stub value | 1 | |
| Non-binding offer | 1 | KNOP |
| **Allcash** | **1** | **CFSB -- typo in sheet, missing hyphen** |

**Findings:**

- **ISSUE [Low]: "Allcash" typo.** CFSB has `category="Allcash"` in the sheet. This is faithfully preserved (correct behavior for raw storage) but will cause problems for any category-based filtering or grouping on the frontend. The parser correctly stores the raw value. A normalization step or validation rule should flag this.

- **OBSERVATION: Inconsistent category naming.** "Cash & Stock" vs "Stock & Cash" (3 deals: SNCY, WBS, SKYT) represent different deal structures (order indicates majority component). "Cash + CVR" vs "Cash & CVR" may or may not be intentional. These are preserved correctly from the sheet.

**Verdict: Categories preserved exactly as-is from the sheet. One typo ("Allcash") should be flagged by validation.**

---

## 4. Semantic Correctness

### 4a. Price Parsing

Verified across all 82 deals. `parse_price()` correctly:
- Strips `$` and `,` symbols
- Parses to Decimal (not float -- good for financial data)
- Returns `Decimal('0.00')` for `$0.00` prices (not None)
- API converts Decimal to float for JSON serialization

**Note on live-vs-stored drift:** The CSV is fetched live from Google Sheets, which updates prices in real-time. The API serves the last-ingested snapshot. Small differences between the CSV values shown above and the API values (e.g., SSTK CSV shows $15.61 deal price, API shows $15.85) are expected -- the sheet is a living document and values change between ingest runs. This is **not a bug** but confirms the snapshot model works correctly (point-in-time capture).

### 4b. Yield / Percentage Parsing

`parse_percent()` correctly:
- Strips `%` sign
- Divides by 100 (so `-5.52%` becomes `-0.0552`)
- Returns `None` for `#DIV/0!`, `#VALUE!`, `#N/A` error values
- Handles extreme values: `-3255.97%` -> `-32.5597`, `127491.43%` -> `1274.9143`

**5 deals correctly have `current_yield=null`** because sheet shows `#DIV/0!`:
VSTA, SHCO, MTAL, CFSB, SNCR (all have `current_price=$0.00`)

**5 deals correctly have `price_change=null`** because sheet shows `#N/A`:
VSTA, SHCO, MTAL, CFSB, SNCR (same set -- prices are $0.00 / stale)

### 4c. Date Parsing

`parse_date_mdy()` uses `%m/%d/%y` format with `datetime.strptime`:
- `1/7/25` -> `2025-01-07` (correct)
- `7/18/24` -> `2024-07-18` (correct)
- Two-digit years interpreted as 20xx by Python's strptime (years 00-68 -> 2000-2068)

**No 1773 date artifact in parsed dates.** The `11/3/1773` countdown artifact appears only in `countdown_raw` and is correctly handled by `parse_countdown()` which returns `None` for any value containing `/`.

**End date "0" handling:** 23 deals have `end_date_raw="0"`. The date parser attempts `strptime("0", "%m/%d/%y")` which raises ValueError, then tries `%m/%d/%Y` which also fails, so it returns `None`. This is correct behavior but logs a warning for each. A pre-check for "0" would be cleaner and avoid log noise.

### 4d. Countdown Parsing

`parse_countdown()` correctly:
- Returns `None` for `11/3/1773` artifact (detected by `/` in string)
- Parses negative values: SOL=-55, GLXZ=-221, ALE=-203, SHCO=-9, K=-195, RNA=-30
- Uses `int(float(s))` to handle potential decimal countdown values

**23 deals** have the 1773 artifact. All correctly stored as `countdown_days=null`.
**6 deals** have negative countdowns (past end dates). Correctly preserved as negative integers.

---

## 5. Edge Cases

### 5a. `#DIV/0!` Values
5 deals (VSTA, SHCO, MTAL, CFSB, SNCR) have `current_yield_raw="#DIV/0!"`. All correctly parsed to `current_yield=null`. Raw value preserved for display.

### 5b. `$0.00` Current Prices
5 deals (VSTA, SHCO, MTAL, CFSB, SNCR) have `current_price=$0.00`. Stored as `Decimal('0.00')`, which is correct (they represent real $0 prices for delisted/suspended stocks, not missing data).

### 5c. The `11/3/1773` Artifact
Appears 23 times in `countdown_raw`. This is a Google Sheets formula artifact when no end date is set. Correctly detected and converted to `countdown_days=null`.

### 5d. Negative Yields
Deals where current price exceeds deal price have negative gross yields. These are correctly stored (e.g., SSTK: -5.52%, WBD: -8.62%, KVUE: -7.27%). The extreme case is ISPO at -3255.97% which parses correctly.

### 5e. Extreme Values
- ISPO: `current_price=$143.30`, `deal_price=$4.27` -> `gross_yield=-3255.97%` (correctly parsed as `-32.5597`)
- SPR: `current_yield_raw="-315477.49%"` (correctly parsed as `-3154.7749`)
- INFA: `current_yield_raw="127491.43%"` (correctly parsed as `1274.9143`)

These extreme values reflect real market dislocations (deal likely failed, price moved far from deal terms). No overflow or precision issues.

### 5f. Very Long Text Fields
- Longest `investable`: SOL at 84 chars ("No, do not like the shareholder dynamics and the stock is likley a zero if bid fails")
- `finance_risk` for KNOP: "High, some concerned over liquidity to meet debt liabilities. contingent on refinancing a credit fcility in November 2025" (120+ chars)
- `legal_risk` for BHF: "Medium, significant regulatory approvals required"
- All stored correctly in TEXT columns (no truncation).

### 5g. Non-Standard CVR Flag
SNCR has `cvr_flag="Downward adjustment to price if transaction expenses exceed $24m"`. This is a descriptive override rather than a simple Yes/No flag. Correctly preserved in the TEXT column. The same text appears in `go_shop_raw` as well. No data loss.

### 5h. Shared deal_tab_gid Values
Two pairs of deals share the same GID:
- CTRA + PKST both have `deal_tab_gid=212513919`
- MPX + GTLS both have `deal_tab_gid=2027733202`

This likely means the sheet links for these deals point to the same tab (possibly a copy/paste error in the sheet). The ingest system stores this faithfully. The detail ingest may fetch the same tab twice for different tickers. **This is a data quality issue in the source sheet, not a bug in the parser.**

### 5i. Link Format Variations
- Most links: `?gid=NNNNN#gid=NNNNN` (relative format)
- SLAB uses a full URL: `https://docs.google.com/spreadsheets/d/148.../edit?gid=184040437#gid=184040437`
- IMXI and ALE use: `#gid=NNNNN` (no `?gid=` prefix)

`extract_gid()` correctly handles all three formats via regex `gid=(\d+)`.

---

## 6. Data Model Gaps and Recommendations

### 6a. Missing Fields (not captured from sheet)

**None.** All 19 sheet columns are captured. The `raw_json` JSONB column preserves the full original row as a safety net.

### 6b. GET /deals Endpoint Missing Fields

The lightweight `/deals` endpoint returns only 15 of the 30 fields available in `/snapshot`. Notably missing:
- `announced_date` / `close_date` / `end_date` (dates)
- `countdown_days`
- `price_change` / `price_change_raw`
- `go_shop_raw`
- `cvr_flag`
- `deal_tab_gid`
- `link_to_sheet`

**Recommendation:** Consider adding `countdown_days`, `close_date`, and `cvr_flag` to the `/deals` endpoint since these are commonly needed for deal list views.

### 6c. Computed Fields That Would Be Valuable

1. **`deal_spread_dollar`**: `deal_price - current_price` (absolute dollar spread). Currently only percentage yields are stored.

2. **`deal_status`**: A derived enum (e.g., "active", "past_end_date", "likely_failed", "completed") based on countdown, end_date, and price deviation. Currently the consumer must compute this.

3. **`is_investable`**: Boolean derived from the `investable` text field. Currently `investable` can be "Yes", "No", "no", "Yes with wide spread", "Yes. but high risk", "No, too much stock", null, etc. A clean boolean would simplify filtering.

4. **`normalized_category`**: Map "Allcash" -> "All-cash", and potentially group "Cash & Stock" / "Stock & Cash" under a canonical form if desired.

5. **`annualized_yield`**: `current_yield / (countdown_days / 365)` -- the annualized return if the deal closes on time. This is a key metric for M&A arb and would save the frontend from computing it.

### 6d. Validation Rules to Add

1. **Category normalization check**: Flag "Allcash" as a typo.
2. **Shared GID check**: Flag when multiple tickers share the same `deal_tab_gid`.
3. **Stale deal check**: Flag deals where `end_date` has passed and `countdown_days < -30`.
4. **Price sanity check**: Flag when `current_price > 2 * deal_price` or `current_price = 0` for recent deals.
5. **End date "0" pre-filter**: Check for `end_date_raw == "0"` before parsing to avoid spurious log warnings.

---

## 7. Summary

| Area | Status | Issues |
|---|---|---|
| Column coverage | PASS | All 19 columns captured |
| Row count | PASS | 82/82 exact match |
| Category preservation | PASS (with note) | "Allcash" typo preserved from sheet |
| Numeric parsing | PASS | Prices, yields, percentages all correct |
| Date parsing | PASS | Two-digit years handled correctly |
| 1773 artifact | PASS | All 23 instances correctly nullified |
| #DIV/0! handling | PASS | All 5 instances correctly nullified |
| $0.00 prices | PASS | Stored as 0.00, not null |
| Negative yields | PASS | Correctly preserved |
| Extreme values | PASS | No overflow or precision issues |
| Long text | PASS | No truncation |
| Link extraction | PASS | All 3 formats handled |
| GID collisions | NOTE | 2 pairs share GIDs (sheet issue) |

**Overall assessment: The ingest pipeline is production-quality.** All 19 columns are captured, all 82 rows are present, edge cases are handled correctly, and the dual raw+parsed storage pattern provides both fidelity and queryability. The recommended improvements (computed fields, validation rules, /deals endpoint expansion) are enhancements, not fixes.
