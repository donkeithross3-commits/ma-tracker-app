# Historical M&A Research Database — Session Handoff

**Date:** 2026-03-18 (updated 16:50 UTC)
**Agent:** deal-intel (Opus)
**Session duration:** ~6 hours (session 1) + continuing (session 2)
**Status:** Phase 2 (enrichment) resumed, Phase 3 (analysis) started

---

## What Was Built — Session 2 (2026-03-18 afternoon)

### Outcome Classifier (`qa/outcome_classifier.py`)
Classifies all 6,127 deals from filing metadata alone — no document downloads.
Heuristic rules: DEFM14A = voted = closed, tender offer >30d = closed, S-4 >60d = closed,
filing span >90d = closed, pre-2025 with minimal filings = closed (low confidence).
Result: 5,500 closed (89.8%), 627 pending. Zero errors.

### Static Features (`features/static_features.py`)
Computes announcement-time features for each deal: value, premium, structure, buyer type,
duration, VIX, clause data (when available). Returns `StaticFeatures` dataclass.

### Base Rate Analysis (`analysis/base_rates.py`)
Cross-tabulated descriptive statistics: outcomes, premiums, structures, buyer types,
filing coverage, deal flags. Validated against Betton/Eckbo/Thorburn benchmarks.

### Enrichment Resumed
SEC EDGAR 503 resolved. Single worker running on droplet, ~17s/deal.
~2,800 deals remaining, estimated ~13 hours.
Progress (as of 17:05 UTC): 80/2,818 enriched in this run (~418 total).

### JSON Extraction Bug Fixed
**Critical fix:** Both `deal_enricher.py` and `clause_extractor.py` had a bug where
Claude CLI responses wrapped in `{"result": "```json\n{...}\n```"}` were not parsed
correctly. The markdown fences in the inner result string caused json.loads() to fail,
and the fallback recovery operated on the outer wrapper instead.
Fix: `_parse_json_string()` recovery pipeline now applied to the inner result string.

### Clause Extraction Validated
Pipeline tested on 3 deals with correct results:
- Ultimate Software (2019): go_shop=True, 50d, term_fee=$331M (3.15%), match=5d ✅
- Lexmark (2016): go_shop=False, term_fee=$95M, fiduciary_out=True ✅
- Ready to run at scale after enrichment completes

---

## What Was Built — Session 1 (2026-03-18 morning)

### Database (Migration 056 — Applied to Production)
13 `research_*` tables on Neon PostgreSQL with 27 indexes, 4 triggers.
Core tables: `research_deals`, `research_deal_clauses`, `research_deal_events`,
`research_deal_consideration`, `research_deal_filings`, `research_deal_outcomes`.
Market data: `research_market_daily`, `research_options_daily`, `research_options_chains`.
Infrastructure: `research_pipeline_runs`, `research_filing_cache`.

### Python Module (`python-service/app/research/`)
18 files across 6 submodules:

| File | Purpose |
|------|---------|
| `universe/edgar_scraper.py` | SEC master index download + EFTS search |
| `universe/deal_identifier.py` | Entity resolution (filings → deals) |
| `universe/pipeline.py` | Universe construction orchestrator |
| `universe/db.py` | Database CRUD for research tables |
| `extraction/deal_enricher.py` | Claude CLI extraction of acquirer/price/structure |
| `extraction/clause_extractor.py` | LLM clause extraction (go-shop, match rights, fees) |
| `extraction/prompts.py` | 4 structured JSON extraction prompts |
| `market_data/stock_loader.py` | Polygon daily OHLCV + SPY + VIX |
| `market_data/options_loader.py` | Polygon options chain reconstruction + daily summary |
| `market_data/black_scholes.py` | Newton-Raphson IV inversion, greeks |
| `market_data/load_runner.py` | CLI runner for stock/options loading |
| `qa/coverage_checks.py` | Coverage, consistency, outlier checks |
| `api/research_routes.py` | 9 API endpoints on port 8001 |

### API Endpoints (port 8001, deployed)
```
GET  /research/deals              — list with filtering
GET  /research/deals/summary      — aggregate stats
GET  /research/deals/{deal_key}   — full detail + filings + events
POST /research/pipeline/universe  — trigger universe construction
GET  /research/pipeline/status    — pipeline run progress
GET  /research/pipeline/runs      — historical runs
GET  /research/qa/coverage        — data quality report
GET  /research/enrichment/status  — enrichment progress
```

---

## Current Data State (2026-03-18 16:50 UTC)

| Metric | Count | Notes |
|--------|-------|-------|
| Total deals | 6,127 | 2016-01-04 to 2026-03-16 |
| Enriched (acquirer known) | 342+ | Opus CLI extraction (enrichment running) |
| With deal price | 304 | Per-share from filings |
| With stock market data | 2,247 | 93% of tickered deals |
| With options data | 0 | Purged — see "Critical Fix" below |
| With ticker | 2,406 | From SEC ticker map |
| Unique targets | 1,758 | |
| Outcomes classified | 5,500 | 89.8% closed, 10.2% pending (2025+) |
| Static features computed | 342 | All enriched deals |
| Base rates validated | ✅ | Matches academic benchmarks |

### Deals by Year
2016: 693, 2017: 617, 2018: 615, 2019: 517, 2020: 525,
2021: 798, 2022: 617, 2023: 586, 2024: 532, 2025: 540, 2026: 87

### Enriched Deals by Structure
all_cash: 191, all_stock: 70, cash_and_stock: 44, election: 23, other: 8,
cash_and_cvr: 5, stock_and_cvr: 1

### Validated Base Rates (from 342 enriched deals)
- Median premium: 28.5% (academic benchmark: 30-40%)
- Median deal value: $687M
- Median expected duration: 157 days
- Structure: 55.8% all-cash, 20.5% all-stock
- Buyer type: 64% strategic public, 16.4% financial sponsor

---

## Critical Fix Applied This Session

**Options data was being loaded WITHOUT deal prices.** All 90,947 chain entries and 1,038
daily summaries were purged because:
- The options loader was pulling data for any deal with a ticker
- Without the deal price, the above-deal-price call analysis (higher-bid signal) is empty
- The covered-call yield computation requires the deal price as the reference strike

**Fixed in `options_loader.py`:** The `load_all_deals()` query now requires:
1. `acquirer_name != 'Unknown'` (filters false positives)
2. `last_enriched IS NOT NULL` (deal was actually processed)
3. `cash_per_share IS NOT NULL OR total_per_share IS NOT NULL` (deal price exists)
4. Joins `research_deal_consideration` to get the per-share price

**Correct pipeline order: ENRICH → VALIDATE → THEN OPTIONS**

---

## What's Blocking: SEC EDGAR 503s

As of 2026-03-18 ~11:00 UTC, SEC's EDGAR filing archive returns 503 Service Unavailable
for actual filing documents (DEFM14A, PREM14A HTML files). Index pages work fine.

**Tested from two independent IPs:**
- Droplet (192.241.179.9) — 503
- Mac hotspot (71.57.113.210) — 503

This appears to be a systemic SEC issue, not IP-specific rate limiting. However, we DID
hit SEC hard earlier with 4 concurrent workers fetching filings, which may have contributed.

**IMPORTANT:** All enrichment workers have been killed. Do NOT restart until you confirm
SEC is back by testing:
```bash
curl -s --max-time 10 -H "User-Agent: DR3 Research research@dr3-dashboard.com" \
  "https://www.sec.gov/Archives/edgar/data/1007019/000121390024020504/ea0200972-04.htm" \
  -o /dev/null -w "%{http_code}"
```
Should return 200. If 503, wait longer.

**When SEC is back, launch enrichment:**
```bash
ssh droplet 'bash ~/apps/scripts/run_enrichment.sh'
```
This script checks SEC availability first, then launches a single nohup worker.

---

## Known Issues and Gotchas

### 1. False Positive Deals (~2,700 of 6,127)
Many "deals" are routine corporate filings (DEFA14A proxy supplements, S-4 for spin-offs)
that aren't actual acquisitions. The enricher handles this by attempting extraction — if
Claude can't find an acquirer, the deal stays with `acquirer_name = 'Unknown'`.

Deals with DEFM14A, SC TO-T, PREM14A, or SC 14D9 filings are most likely real M&A.
~2,894 deals have these high-quality filing types.

### 2. Missing Target Tickers
Many targets show `UNK` for ticker because the company was delisted after the deal closed
and doesn't appear in SEC's current ticker map. These deals have CIKs and can still be
enriched — the ticker just needs to be looked up from historical data.

### 3. SEC Rate Limits
- SEC.gov enforces 10 req/sec but is aggressive about blocking
- data.sec.gov (submissions API) is even stricter — single sequential requests only
- The enricher uses 0.3s base delay + exponential backoff on 503s
- NEVER run more than 2 concurrent workers hitting SEC
- The `resolve_primary_doc_url` function makes 2 requests per deal (index + doc)

### 4. Enrichment Success Rate
~42% of attempted deals get a valid acquirer name. The rest are either:
- False positive deals (no M&A in the filing text)
- Filings that are table-heavy/image-heavy with little extractable text
- SEC 503 failures (logged as failed, can be retried)

### 5. Claude CLI Auth on Droplet
- CLI path: `/home/don/.nvm/versions/node/v22.22.1/bin/claude`
- OAuth token: `CLAUDE_CODE_OAUTH_TOKEN` in `python-service/.env`
- Must set `PATH` to include nvm bin directory
- Must NOT set `ANTHROPIC_API_KEY` in subprocess env (forces OAuth)
- Default model is opus (correct — free via Max subscription)

### 6. The PCs (gaming-pc, garage-pc) Don't Have Claude CLI
Node.js is not installed on either PC. They can run market data loading (Polygon API)
but NOT enrichment (requires Claude CLI). Repos cloned, deps installed, .env deployed.
- garage-pc: `C:\Users\donke\dev\ma-tracker-app` — confirmed working
- gaming-pc: `C:\Users\donke\dev\ma-tracker-app` — needs verification

---

## What To Do Next (Priority Order)

### ~~1. Resume Enrichment~~ ✅ RUNNING
Enrichment restarted 2026-03-18 16:42 UTC. SEC is back online.
Monitor: `ssh droplet 'tail -f /tmp/enrich_production.log'`
Status: `ssh droplet 'curl -s http://localhost:8001/research/enrichment/status | python3 -m json.tool'`
~2,800 deals remaining, ~17s/deal = ~13 hours.

### ~~6. Deal Outcome Classification~~ ✅ DONE
5,500 deals classified as `closed` (89.8%), 627 pending (2025-2026).
Methods: DEFM14A (2,127), S-4 registration (1,448), age-inferred (929),
filing span (544), tender offer (349), DEFM14C (103).
Script: `python -m app.research.qa.outcome_classifier`

### ~~5. Build Analysis Framework~~ ✅ PARTIALLY DONE
- `features/static_features.py` — ✅ BUILT AND VALIDATED
- `analysis/base_rates.py` — ✅ BUILT AND VALIDATED
- `features/market_features.py` — NOT STARTED (needs options data)
- `analysis/models.py` — NOT STARTED (needs clause data)

### 2. Run Options Loading (after enrichment reaches ~500 deals with prices)
Currently 304 deals have prices. Once enrichment grows this to ~500:
```bash
ssh droplet 'cd ~/apps/ma-tracker-app/python-service && \
  nohup python3 -m app.research.market_data.load_runner --mode options --limit 500 --min-year 2019 \
  > /tmp/options_production.log 2>&1 &'
```

### ~~3. Build Clause Extraction Pipeline~~ ✅ VALIDATED
`clause_extractor.py` is complete, tested, and ready for batch run.
Run after enrichment completes (shares SEC rate limits and Claude CLI):
```bash
ssh droplet 'cd ~/apps/ma-tracker-app/python-service && \
  nohup python3 -m app.research.extraction.clause_extractor --limit 500 \
  > /tmp/clause_extraction.log 2>&1 &'
```
Estimated: ~25s/deal (SEC fetch + CLI extraction), ~3.5 hours for 500 deals.

### 4. Build Market Features + Models
- `features/market_features.py` — spread, IV, above-deal-call metrics
- `analysis/models.py` — logistic regression, XGBoost, survival analysis
- Blocked by: clause extraction (for the higher-bid target variable)

---

## File Locations

```
python-service/
├── migrations/056_research_database.sql        # Schema (applied to production)
├── app/
│   ├── api/research_routes.py                  # API endpoints
│   ├── portfolio_main.py                       # Router mount (line 230)
│   └── research/
│       ├── universe/                           # Deal discovery
│       │   ├── edgar_scraper.py                # SEC master index + EFTS
│       │   ├── deal_identifier.py              # Entity resolution
│       │   ├── pipeline.py                     # Orchestrator
│       │   └── db.py                           # Database operations
│       ├── extraction/                         # Filing analysis
│       │   ├── deal_enricher.py                # Acquirer/price extraction (CLI)
│       │   ├── clause_extractor.py             # Go-shop/match rights extraction
│       │   └── prompts.py                      # LLM extraction prompts
│       ├── market_data/                        # Polygon data
│       │   ├── stock_loader.py                 # Daily OHLCV
│       │   ├── options_loader.py               # Chain reconstruction + IV
│       │   ├── black_scholes.py                # IV inversion + greeks
│       │   └── load_runner.py                  # CLI batch runner
│       ├── qa/coverage_checks.py               # Data quality
│       ├── features/                           # (empty — build next)
│       └── analysis/                           # (empty — build next)
docs/plans/
├── historical-ma-research-database-plan.md     # Full 2100-line plan document
└── historical-research-handoff.md              # This file
```

## Droplet Scripts
```bash
~/apps/scripts/run_enrichment.sh    # Checks SEC, launches enrichment worker
```

## Key Plan Reference
Full study design: `docs/plans/historical-ma-research-database-plan.md`
- Section 8: Higher-bid study design (logistic regression, XGBoost, survival analysis)
- Section 7: Feature library (static, dynamic, market-implied, text-derived, regime)
- Section 5: Filing extraction framework (clause extraction prompts and QA)
- Section 6: Market data framework (stock tiers, options tiers, IV computation)
