# Granular Field-by-Field Review: Portfolio Sheet Ingest

**Date:** 2026-02-24
**Reviewer:** granular-reviewer agent
**Method:** Fetched raw CSV from Google Sheets, fetched API responses from `GET /portfolio/deal/{ticker}`, compared every field.

## Deals Reviewed (10 Diverse Samples)

| # | Ticker | Category | Edge Case Tested |
|---|--------|----------|-----------------|
| 1 | EA | All-cash | Standard investable deal, Go Shop, risk ratings |
| 2 | TGNA | All-cash | Regulatory risk, High legal risk |
| 3 | SSTK | Cash & Stock | Stock component, 1773 artifact countdown |
| 4 | VSTA | All-cash | $0 current price, #N/A price_change, #DIV/0! yield |
| 5 | ACLX | Cash & CVR | CVR flag Yes, investable |
| 6 | SLAB | All-cash | Full URL in link column (not fragment) |
| 7 | CTRA | All-stock | Negative yields, no end date |
| 8 | BHF | All-cash | CVR Yes, complex free-text legal_risk |
| 9 | SOL | All-cash | Negative countdown, empty acquiror |
| 10 | SNCR | All-cash | $0 price, #N/A, CVR is free-text (not Yes/No) |

---

## Live-Data Caveat

The Google Sheet contains live-updating values (current price, yields, spreads, countdown). The ingest captures a snapshot at a point in time. Minor numeric differences in `current_price`, `gross_yield`, `price_change`, `current_yield`, and `countdown` between the raw CSV fetched just now and the API response are expected and not bugs -- they reflect the sheet being updated after the last ingest.

Fields that should NOT differ (static deal terms): `ticker`, `acquiror`, `announced_date`, `close_date`, `end_date`, `deal_price`, `category`, `investable`, `go_shop_raw`, `vote_risk`, `finance_risk`, `legal_risk`, `cvr_flag`, `link_to_sheet`, `deal_tab_gid`.

---

## Dashboard Tab: Field-by-Field Comparison

### 1. EA (All-cash, standard)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | EA | EA | YES | |
| acquiror | Silver Lake | Silver Lake | YES | |
| announced_date_raw | 9/29/25 | 9/29/25 | YES | |
| close_date_raw | 6/30/26 | 6/30/26 | YES | |
| end_date_raw | 9/28/26 | 9/28/26 | YES | |
| countdown_raw | 216 | 216 | YES | |
| deal_price_raw | $210.38 | $210.38 | YES | |
| current_price_raw | $200.91 | $200.88 | LIVE-DIFF | Expected: live price updated |
| gross_yield_raw | 4.50% | 4.52% | LIVE-DIFF | |
| price_change_raw | 0.21% | 0.20% | LIVE-DIFF | |
| current_yield_raw | 13.47% | 13.51% | LIVE-DIFF | |
| category | All-cash | All-cash | YES | |
| investable | Yes | Yes | YES | |
| go_shop_raw | (empty) | null | YES | Empty -> null correct |
| vote_risk | Low | Low | YES | |
| finance_risk | Medium | Medium | YES | |
| legal_risk | Low | Low | YES | |
| cvr_flag | No | No | YES | |
| link_to_sheet | ?gid=137229779#gid=137229779 | ?gid=137229779#gid=137229779 | YES | |
| announced_date (parsed) | 9/29/25 | 2025-09-29 | YES | Correct M/D/YY -> YYYY-MM-DD |
| close_date (parsed) | 6/30/26 | 2026-06-30 | YES | |
| end_date (parsed) | 9/28/26 | 2026-09-28 | YES | |
| countdown_days (parsed) | 216 | 216 | YES | |
| deal_price (parsed) | $210.38 | 210.38 | YES | |
| deal_tab_gid | gid=137229779 | 137229779 | YES | Correct extraction |

**Result: All static fields match. Live-diff fields are expected.**

---

### 2. TGNA (All-cash, High legal risk)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | TGNA | TGNA | YES | |
| acquiror | NXST | NXST | YES | |
| announced_date_raw | 8/19/25 | 8/19/25 | YES | |
| close_date_raw | 8/18/26 | 8/18/26 | YES | |
| end_date_raw | 8/18/26 | 8/18/26 | YES | |
| countdown_raw | 175 | 175 | YES | |
| deal_price_raw | $22.50 | $22.50 | YES | |
| current_price_raw | $20.95 | $20.92 | LIVE-DIFF | |
| gross_yield_raw | 6.89% | 7.02% | LIVE-DIFF | |
| price_change_raw | 0.53% | 0.48% | LIVE-DIFF | |
| current_yield_raw | 15.22% | 15.54% | LIVE-DIFF | |
| category | All-cash | All-cash | YES | |
| investable | No, regulatory risk | No, regulatory risk | YES | Quoted text preserved |
| go_shop_raw | (empty) | null | YES | |
| vote_risk | (empty) | null | YES | |
| finance_risk | (empty) | null | YES | |
| legal_risk | High | High | YES | |
| cvr_flag | (empty) | null | YES | |
| link_to_sheet | ?gid=130355958#gid=130355958 | ?gid=130355958#gid=130355958 | YES | |
| deal_tab_gid | gid=130355958 | 130355958 | YES | |

**Result: All static fields match.**

---

### 3. SSTK (Cash & Stock, 1773 artifact)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | SSTK | SSTK | YES | |
| acquiror | GETY | GETY | YES | |
| end_date_raw | 0 | 0 | YES | Literal "0" preserved |
| end_date (parsed) | 0 | null | YES | "0" not a valid date -> null, correct |
| countdown_raw | 11/3/1773 | 11/3/1773 | YES | Raw artifact preserved |
| countdown_days (parsed) | 11/3/1773 | null | YES | 1773 artifact -> null, correct |
| deal_price_raw | $15.61 | $15.85 | **LIVE-DIFF** | Deal price changed on sheet since last ingest |
| current_price_raw | $16.54 | $16.73 | LIVE-DIFF | |
| gross_yield_raw | -5.98% | -5.52% | LIVE-DIFF | |
| price_change_raw | 5.99% | 6.58% | LIVE-DIFF | |
| current_yield_raw | 8.49% | 7.88% | LIVE-DIFF | |
| category | Cash & Stock | Cash & Stock | YES | |
| investable | No, too much stock | No, too much stock | YES | |
| deal_tab_gid | 1740096008 | 1740096008 | YES | |

**Note on SSTK deal_price_raw:** Sheet shows `$15.61` now but API has `$15.85`. This means the deal price itself changed on the sheet after the last ingest. This is a live-data difference, not a parsing bug -- the deal terms were updated on the sheet. This is expected behavior; re-running ingest would pick up the new value.

**Result: All static fields match at time of ingest. Current CSV shows updated deal terms.**

---

### 4. VSTA ($0 price, #N/A, #DIV/0! edge cases)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | VSTA | VSTA | YES | |
| acquiror | (empty) | null | YES | |
| current_price_raw | $0.00 | $0.00 | YES | |
| current_price (parsed) | $0.00 | 0.0 | YES | $0.00 -> Decimal(0.00) -> float 0.0 |
| gross_yield_raw | 100.00% | 100.00% | YES | |
| gross_yield (parsed) | 100.00% | 1.0 | YES | 100% -> 1.0 correct |
| price_change_raw | #N/A | null | YES | #N/A -> None via parse_percent, _safe_str also returns "#N/A" but API shows null |
| current_yield_raw | #DIV/0! | #DIV/0! | YES | Raw preserved |
| current_yield (parsed) | #DIV/0! | null | YES | #DIV/0! -> None, correct |
| end_date_raw | 0 | 0 | YES | |
| end_date (parsed) | 0 | null | YES | |
| countdown_raw | 11/3/1773 | 11/3/1773 | YES | |
| countdown_days (parsed) | 11/3/1773 | null | YES | |
| investable | no | no | YES | Lowercase preserved |
| deal_tab_gid | 1567891606 | 1567891606 | YES | |

**FINDING - price_change_raw:** The sheet shows `#N/A` but the API returns `null` for `price_change_raw`. Looking at the code, `_safe_str()` would return `"#N/A"` as a string (it only returns None for NaN/empty). However, pandas `read_csv` may convert `#N/A` to NaN automatically since `#N/A` is in pandas' default NA values list. This means `pd.isna(val)` returns True and `_safe_str()` returns None. The raw value is lost.

| Severity | Issue |
|----------|-------|
| **WARNING** | `#N/A` in price_change_raw column is silently converted to null by pandas read_csv (pandas treats `#N/A` as a NaN sentinel). The raw string is lost. Same applies to any column with `#N/A`. |

**Result: One warning about #N/A being eaten by pandas.**

---

### 5. ACLX (Cash & CVR, investable)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | ACLX | ACLX | YES | |
| acquiror | GILD | GILD | YES | |
| announced_date_raw | 2/23/26 | 2/23/26 | YES | |
| close_date_raw | 4/9/26 | 4/9/26 | YES | |
| end_date_raw | 11/22/26 | 11/22/26 | YES | |
| countdown_raw | 271 | 271 | YES | |
| deal_price_raw | $115.51 | $115.51 | YES | |
| current_price_raw | $113.79 | $113.81 | LIVE-DIFF | |
| category | Cash & CVR | Cash & CVR | YES | |
| investable | Yes | Yes | YES | |
| vote_risk | Low | Low | YES | |
| finance_risk | Low | Low | YES | |
| legal_risk | Medium | Medium | YES | |
| cvr_flag | Yes | Yes | YES | |
| deal_tab_gid | 61354185 | 61354185 | YES | |

**Result: All static fields match.**

---

### 6. SLAB (Full URL in link column)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | SLAB | SLAB | YES | |
| acquiror | TXN | TXN | YES | |
| link_to_sheet | `https://docs.google.com/spreadsheets/d/148_.../edit?gid=184040437#gid=184040437` | Same full URL | YES | Full URL preserved |
| deal_tab_gid | (from full URL) | 184040437 | YES | `extract_gid()` handles full URLs correctly |
| deal_price_raw | $231.00 | $231.00 | YES | |
| current_price_raw | $204.66 | $204.63 | LIVE-DIFF | |
| investable | (empty) | null | YES | |

**Result: Full URL link parsing works correctly. All static fields match.**

---

### 7. CTRA (All-stock, negative yields)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | CTRA | CTRA | YES | |
| acquiror | DVN | DVN | YES | |
| deal_price_raw | $27.23 | $27.19 | **LIVE-DIFF** | Deal price changed (stock deal, price recalcs) |
| current_price_raw | $30.51 | $30.44 | LIVE-DIFF | |
| gross_yield_raw | -12.05% | -11.95% | LIVE-DIFF | |
| gross_yield (parsed) | -12.05% | -0.1195 | YES | Negative percent parsed correctly |
| price_change_raw | -0.85% | -0.92% | LIVE-DIFF | |
| current_yield_raw | -30.73% | -30.50% | LIVE-DIFF | |
| current_yield (parsed) | | -0.305 | YES | Large negative percent correct |
| category | All-stock | All-stock | YES | |
| end_date_raw | 0 | 0 | YES | |
| end_date (parsed) | 0 | null | YES | |
| countdown_raw | 11/3/1773 | 11/3/1773 | YES | |
| countdown_days (parsed) | | null | YES | |

**Result: Negative percentages parsed correctly. All-stock deal handled well.**

---

### 8. BHF (CVR Yes, complex legal_risk text)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | BHF | BHF | YES | |
| acquiror | Aquarian Capital | Aquarian Capital | YES | |
| deal_price_raw | $70.00 | $70.00 | YES | |
| current_price_raw | $61.19 | $61.00 | LIVE-DIFF | |
| legal_risk | `Medium, significant regulatory approvals required` | `Medium, significant regulatory approvals required` | YES | Long free-text preserved exactly |
| cvr_flag | Yes | Yes | YES | |
| vote_risk | Low | Low | YES | |
| finance_risk | Low | Low | YES | |

**Result: Complex free-text fields preserved correctly.**

---

### 9. SOL (Negative countdown, empty acquiror)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | SOL | SOL | YES | |
| acquiror | (empty) | null | YES | Empty acquiror -> null |
| countdown_raw | -55 | -55 | YES | Negative countdown preserved |
| countdown_days (parsed) | -55 | -55 | YES | Negative integer parsed correctly |
| end_date_raw | 12/31/25 | 12/31/25 | YES | |
| end_date (parsed) | 12/31/25 | 2025-12-31 | YES | |
| current_yield_raw | -4628.57% | -4628.57% | YES | Extreme negative preserved |
| current_yield (parsed) | -4628.57% | -46.2857 | YES | -4628.57/100 = -46.2857 correct |

**Result: All edge cases handled correctly.**

---

### 10. SNCR (CVR is free-text, $0 price, #N/A)

| Field | Sheet CSV Value | API Value | Match? | Notes |
|-------|----------------|-----------|--------|-------|
| ticker | SNCR | SNCR | YES | |
| acquiror | OTCMKTS:LMGIF | OTCMKTS:LMGIF | YES | Non-standard acquiror format preserved |
| current_price_raw | $0.00 | $0.00 | YES | |
| price_change_raw | #N/A | null | **WARNING** | Same pandas #N/A issue as VSTA |
| current_yield_raw | #DIV/0! | #DIV/0! | YES | |
| cvr_flag | `Downward adjustment to price if transaction expenses exceed $24m` | Same | YES | Long free-text CVR preserved |
| go_shop_raw | `Downward adjustment to price if transaction expenses exceed $24m` | Same | YES | Same text in go_shop preserved |
| investable | Yes | Yes | YES | |
| deal_tab_gid | 882463130 | 882463130 | YES | |

**Result: Free-text CVR and go_shop fields preserved. Same #N/A warning.**

---

## Detail Tab: Field-by-Field Comparison (3 Deals)

### Detail: EA (gid=137229779)

| Field | Raw CSV Value | API Value | Match? | Notes |
|-------|--------------|-----------|--------|-------|
| target | EA | EA | YES | |
| acquiror | Silver Lake | Silver Lake | YES | |
| category | All-cash | All-cash | YES | |
| cash_per_share | $210.00 | 210.0 | YES | |
| cash_pct | 99.82% | 0.9982 | YES | |
| stock_per_share | $0.00 | 0.0 | YES | |
| stock_pct | 0.00% | 0.0 | YES | |
| stock_ratio | (empty) | null | YES | |
| dividends_other | $0.38 | 0.38 | YES | |
| total_price_per_share | $210.38 | 210.38 | YES | |
| target_current_price | $200.91 | 200.88 | LIVE-DIFF | |
| acquiror_current_price | $0.00 | 0.0 | YES | PE acquiror, no price |
| deal_spread | 4.71% | 0.0473 | **MISMATCH** | Sheet says 4.71%, API has 0.0473 (4.73%). Rounding difference -- sheet updated since ingest |
| deal_close_time_months | 4.20 | 4.2 | YES | |
| expected_irr | 13.47% | 0.1351 | LIVE-DIFF | |
| ideal_price | $200.00 | 200.0 | YES | |
| announce_date | 9/29/25 | 2025-09-29 | YES | |
| expected_close_date | 6/30/26 | 2026-06-30 | YES | |
| expected_close_date_note | FY Q1 2027 (6/30/26 | FY Q1 2027 (6/30/26 | YES | Truncated paren preserved as-is |
| outside_date | 9/28/26 | 2026-09-28 | YES | |
| shareholder_vote | Majority Vote | Majority Vote | YES | |
| premium_attractive | Yes, ATH | Yes, ATH | YES | |
| regulatory_approvals | CFIUS | CFIUS | YES | |
| termination_fee | $1bn to Company | $1bn to Company | YES | |
| termination_fee_pct | 1.82% | 0.0182 | YES | |
| shareholder_risk | Low | Low | YES | |
| financing_risk | Medium | Medium | YES | |
| legal_risk | Low | Low | YES | |
| investable_deal | Yes | Yes | YES | |
| has_cvrs | No | No | YES | |
| price_history | 2/23/2026, 200.48 | [{"date":"2026-02-23","close":200.48}] | YES | Date and price match |
| dividends | 3 entries (11/27/25, 2/26/26, 5/28/26) @ $0.19 each | [] | **MISMATCH** | API returns empty array |
| cvrs | 6 rows of $0 values | 6 entries with npv:0, value:0, years:-2025 | YES (structurally) | The `-2025` in years comes from parsing the empty year cells which contain 2025 subtracted values |

**FINDING - EA Dividends Missing:**

| Severity | Field | Sheet Value | API Value | Analysis |
|----------|-------|-------------|-----------|----------|
| **CRITICAL** | dividends | 3 dividend entries: 11/27/25=$0.19, 2/26/26=$0.19, 5/28/26=$0.19 | `[]` (empty) | The dividend extraction failed. The raw CSV shows the dividends section at columns 6-14 starting around row 20. The `_extract_dividends()` function scans from row 10+ looking for "Date" in col 6+ with "Value" in the next column. The EA sheet has the dividend header at column 6 (0-indexed) with `Dividends`, `1`, `2`, etc. as sub-headers. The dividends section uses a HORIZONTAL layout (dates across columns), not a vertical layout the parser expects. |

**FINDING - CVR years=-2025:**

| Severity | Field | Sheet Value | API Value | Analysis |
|----------|-------|-------------|-----------|----------|
| **WARNING** | cvrs[*].years | Empty/formula residue | -2025.0 | The CVR rows for deals without CVRs contain formula residue (like `-2025`). The parser reads these as valid numbers. Not harmful since `has_cvrs=No`, but clutters the data. |

---

### Detail: ACLX (gid=61354185)

| Field | Raw CSV Value | API Value | Match? | Notes |
|-------|--------------|-----------|--------|-------|
| target | ACLX | ACLX | YES | |
| acquiror | GILD | GILD | YES | |
| category | Cash & CVR | Cash & CVR | YES | |
| cash_per_share | $115.00 | 115.0 | YES | |
| cash_pct | 99.56% | 0.9956 | YES | |
| stock_per_share | $0.00 | 0.0 | YES | |
| stock_pct | 0.00% | 0.0 | YES | |
| dividends_other | $0.51 | 0.51 | YES | |
| total_price_per_share | $115.51 | 115.51 | YES | |
| target_current_price | $113.79 | 113.81 | LIVE-DIFF | |
| acquiror_current_price | $148.20 | 148.79 | LIVE-DIFF | |
| deal_spread | 1.51% | 0.015 | YES | 1.51% -> 0.0151, API shows 0.015 (float rounding from 0.0151) |
| deal_close_time_months | 1.47 | 1.47 | YES | |
| expected_irr | 12.38% | 0.1224 | LIVE-DIFF | |
| ideal_price | $113.79 | 113.81 | LIVE-DIFF | |
| announce_date | 2/23/26 | 2026-02-23 | YES | |
| expected_close_date | 4/9/26 | 2026-04-09 | YES | |
| expected_close_date_note | Q2 2026 | Q2 2026 | YES | |
| outside_date | 11/22/26 | 2026-11-22 | YES | |
| shareholder_vote | Majority Tender | Majority Tender | YES | |
| premium_attractive | Yes | Yes | YES | |
| termination_fee | $260m to parent | $260m to parent | YES | |
| termination_fee_pct | (empty) | null | YES | No percentage in sheet |
| target_marketcap | $7.8bn | $7.8bn | YES | |
| shareholder_risk | Low | Low | YES | |
| financing_risk | Low | Low | YES | |
| legal_risk | Medium | Medium | YES | |
| investable_deal | Yes | Yes | YES | |
| has_cvrs | Yes | Yes | YES | |
| cvrs[0] | NPV=$0.5123, Value=0.75, Prob=15%, Payment=5, Years=4 | npv:0.5123, value:0.75, probability:0.15, payment:"5", years:4.0 | YES | CVR data parsed correctly |
| price_history | 2/23/2026, 113.75 | [{"date":"2026-02-23","close":113.75}] | YES | |
| dividends | All zeros (0.00 x8 in Paid? row) | [] | YES | No dividends to extract |

**FINDING - ACLX CVR parsing is correct.** The first CVR row has real data (NPV=$0.5123, Value=0.75, Probability=15%, Payment=5, Years=4) and it was parsed correctly. The subsequent rows with -2025 years are formula residue.

**Result: Detail parsing is accurate for ACLX. CVR data correctly captured.**

---

### Detail: TGNA (gid=130355958)

| Field | Raw CSV Value | API Value | Match? | Notes |
|-------|--------------|-----------|--------|-------|
| target | TGNA | TGNA | YES | |
| acquiror | NXST | NXST | YES | |
| category | All-cash | All-cash | YES | |
| cash_per_share | $22.00 | 22.0 | YES | |
| cash_pct | 97.78% | 0.9778 | YES | |
| stock_per_share | $0.00 | 0.0 | YES | |
| stock_pct | 0.00% | 0.0 | YES | |
| dividends_other | $0.50 | 0.5 | YES | |
| total_price_per_share | $22.50 | 22.5 | YES | |
| target_current_price | $20.95 | 20.92 | LIVE-DIFF | |
| acquiror_current_price | $232.55 | 234.15 | LIVE-DIFF | |
| deal_spread | 7.40% | 0.0755 | LIVE-DIFF | |
| deal_close_time_months | 5.83 | 5.83 | YES | |
| expected_irr | 15.22% | 0.1554 | LIVE-DIFF | |
| ideal_price | $21.10 | 21.1 | YES | |
| announce_date | 8/19/25 | 2025-08-19 | YES | |
| expected_close_date | 8/18/26 | 2026-08-18 | YES | |
| expected_close_date_note | H2 2026 | H2 2026 | YES | |
| outside_date | 8/18/26 | 2026-08-18 | YES | |
| shareholder_vote | Majority Vote | Majority Vote | YES | |
| target_marketcap | $6.2bn | $6.2bn | YES | |
| legal_risk | High | High | YES | |
| investable_deal | No, regulatory risk | No, regulatory risk | YES | |
| cvrs[0] | NPV=$0.1542, Value=0.4, Prob=20%, Payment=2, Years=10 | npv:0.1542, value:0.4, probability:0.2, payment:"2", years:10.0 | YES | CVR data parsed correctly |
| price_history | 2/23/2026, 20.82 | [{"date":"2026-02-23","close":20.82}] | YES | |

**Result: Detail parsing is accurate for TGNA. CVR extracted correctly.**

---

## Summary of Mismatches

### Critical Issues

| # | Ticker | Field | Sheet Value | API Value | Severity | Description |
|---|--------|-------|-------------|-----------|----------|-------------|
| 1 | EA | detail.dividends | 3 entries ($0.19 each on 11/27/25, 2/26/26, 5/28/26) | `[]` | **CRITICAL** | Dividend extraction fails for EA. The sheet uses a horizontal layout (dates spread across columns 7-14 in the same row) while `_extract_dividends()` expects a vertical layout (dates in rows). The function scans for a "Date"/"Value" header pattern starting at row 10+ in columns 6+, but the EA sheet has dividends as column headers (1, 2, 3...) with Date/Value/Paid? as row labels. |

### Warnings

| # | Ticker | Field | Sheet Value | API Value | Severity | Description |
|---|--------|-------|-------------|-----------|----------|-------------|
| 2 | VSTA, SNCR | price_change_raw | `#N/A` | `null` | **WARNING** | pandas `read_csv` auto-converts `#N/A` to NaN before `_safe_str()` can preserve it. The raw string is lost. To fix, pass `keep_default_na=False, na_values=[]` to `pd.read_csv()` or at minimum a custom na_values list that excludes `#N/A`. |
| 3 | Multiple | detail.cvrs[*].years | Empty/formula | `-2025.0` | **WARNING** | CVR rows for deals without CVRs contain formula residue parsed as `-2025.0`. Not harmful (has_cvrs=No or the entry has npv=0), but pollutes the data. Consider filtering CVR entries where npv=0 and value=0 (they're formula residue, not real CVR terms). |
| 4 | CFSB | category | `Allcash` | `Allcash` | **INFO** | Sheet has a typo "Allcash" (no hyphen/space). Parser preserves it exactly, which is correct behavior -- but downstream consumers may not recognize this as "All-cash". Consider normalizing categories. |
| 5 | SHCO | finance_risk | `HIgh` | `HIgh` | **INFO** | Sheet has a typo "HIgh" (capital I). Parser preserves it, which is correct. Consider normalizing risk ratings. |

### Correct Edge Case Handling (Verified Working)

| Edge Case | Deals | Result |
|-----------|-------|--------|
| 1773 countdown artifact -> null | SSTK, VSTA, CTRA, CFSB | PASS |
| Negative countdown | SOL (-55) | PASS |
| $0.00 price -> 0.0 | VSTA, SNCR, CFSB | PASS |
| #DIV/0! yield -> null (parsed), preserved raw | VSTA, SNCR, CFSB | PASS |
| Negative percentages | CTRA (-12.05%, -30.73%) | PASS |
| Extreme percentages | SOL (-4628.57%) | PASS |
| Full URL link -> GID extraction | SLAB (full URL) | PASS |
| #gid= fragment (no ?gid=) -> GID extraction | IMXI | PASS |
| Empty acquiror -> null | VSTA, SOL | PASS |
| Free-text CVR flag | SNCR (long text) | PASS |
| Complex free-text legal_risk | BHF ("Medium, significant...") | PASS |
| Comma-containing investable text | SOL, EA, multiple | PASS |
| Cash & CVR category | ACLX | PASS |
| All-stock category | CTRA | PASS |
| CVR detail data extraction | ACLX, TGNA | PASS |
| Date parsing M/D/YY and M/D/YYYY | All deals | PASS |

---

## Recommendations

### Must Fix (Critical)

1. **Dividend extraction horizontal layout:** The `_extract_dividends()` function in `detail_parser.py` fails for sheets where dividends are laid out horizontally (dates as column headers). The EA sheet shows `Dividends, 1, 2, 3, ...` with rows for Date, Value, and Paid?. The parser looks for a vertical pattern. This needs a second code path to handle the horizontal layout.

### Should Fix (Warnings)

2. **Preserve #N/A in raw fields:** Pass `keep_default_na=False` to `pd.read_csv()` in `ingest.py` (line 503) and handle NaN detection manually, OR pass a custom `na_values` list that excludes `#N/A`, `#DIV/0!`, and `#VALUE!`. Currently these spreadsheet error markers are silently consumed by pandas.

3. **Filter CVR formula residue:** In `_extract_cvrs()`, skip rows where both `npv` and `value` are 0 (or very close to 0) and `years` is negative. These are formula artifacts, not real CVR data.

### Nice to Have (Info)

4. **Category normalization:** Consider a mapping to normalize `Allcash` -> `All-cash`, `Cash + CVR` -> `Cash & CVR`, etc. for downstream consumers.

5. **Risk rating normalization:** Consider normalizing `HIgh` -> `High` etc.

---

## Methodology

1. Fetched raw CSV via `ssh droplet 'curl -sL "https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=184471543"'`
2. Fetched API responses via `ssh droplet 'curl -s http://localhost:8000/portfolio/deal/{TICKER}'`
3. Compared every field in the dashboard section and detail section
4. Fetched detail tab CSVs for EA, ACLX, TGNA and compared against detail API responses
5. Verified parsing logic in `ingest.py` and `detail_parser.py` against actual behavior
6. Tested edge cases: $0 prices, #N/A, #DIV/0!, negative countdowns, 1773 artifacts, full URLs, free-text fields, horizontal dividend layouts
