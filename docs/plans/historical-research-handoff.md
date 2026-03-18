# Historical M&A Research Database — Session Handoff

**Date:** 2026-03-18
**Agent:** deal-intel (Opus)
**Session duration:** ~6 hours
**Status:** Phase 1 complete, Phase 2 (enrichment) in progress, blocked by SEC EDGAR 503s

---

## What Was Built This Session

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

## Current Data State (2026-03-18 11:30 UTC)

| Metric | Count | Notes |
|--------|-------|-------|
| Total deals | 6,127 | 2016-01-04 to 2026-03-16 |
| Enriched (acquirer known) | 336 | Opus CLI extraction |
| With deal price | 214 | Per-share from filings |
| With stock market data | 2,247 | 93% of tickered deals |
| With options data | 0 | Purged — see "Critical Fix" below |
| With ticker | 2,406 | From SEC ticker map |
| Unique targets | 1,758 | |

### Deals by Year
2016: 693, 2017: 617, 2018: 615, 2019: 517, 2020: 525,
2021: 798, 2022: 617, 2023: 586, 2024: 532, 2025: 540, 2026: 87

### Enriched Deals by Structure
all_cash: 145, all_stock: 47, cash_and_stock: 38, election: 18, other: 8,
cash_and_cvr: 3, stock_and_cvr: 1

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

### 1. Resume Enrichment (when SEC is back)
```bash
ssh droplet 'bash ~/apps/scripts/run_enrichment.sh'
```
This is THE bottleneck. At ~20s/deal with opus, 2,894 remaining deals = ~16 hours for 1 worker.
Can run 2 workers max (SEC rate limit). Use `--offset` for partitioning:
```bash
# Worker 1
nohup python3 -m app.research.extraction.deal_enricher --limit 1500 --offset 0 > /tmp/enrich_1.log 2>&1 &
# Worker 2
nohup python3 -m app.research.extraction.deal_enricher --limit 1500 --offset 1500 > /tmp/enrich_2.log 2>&1 &
```

### 2. Run Options Loading (after enrichment grows)
Once ~500+ deals have prices, run:
```bash
ssh droplet 'cd ~/apps/ma-tracker-app/python-service && \
  nohup python3 -m app.research.market_data.load_runner --mode options --limit 500 --min-year 2019 \
  > /tmp/options_production.log 2>&1 &'
```
The loader now correctly joins `research_deal_consideration` to get deal prices and filters
for enriched deals only.

### 3. Finish Stock Data Loading
2,247 of 2,406 tickered deals have stock data. The remaining ~159 either have bad tickers
or the stock was delisted before Polygon's coverage. Low priority — 93% coverage is fine.

### 4. Build Clause Extraction Pipeline
The `clause_extractor.py` is scaffolded but not yet run at scale. This extracts go-shop
provisions, match rights, termination fees — the core data for the higher-bid study.
Same bottleneck as enrichment (Claude CLI + SEC filing downloads).

### 5. Build Analysis Framework
The `analysis/` and `features/` submodules are empty placeholders. Need:
- `features/static_features.py` — deal-level features from enriched data
- `features/market_features.py` — spread, IV, above-deal-call metrics
- `analysis/base_rates.py` — descriptive stats on higher-bid frequency
- `analysis/models.py` — logistic regression, XGBoost, survival analysis

### 6. Deal Outcome Classification
All 6,127 deals have `outcome = 'pending'`. Need to classify closed/terminated using
filing metadata (8-K Item 2.01 for completion, termination filings for breaks).
This doesn't require filing document downloads — just filing TYPE analysis.

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
