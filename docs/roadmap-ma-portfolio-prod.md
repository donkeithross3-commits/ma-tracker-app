# M&A Portfolio Production Support System — Implementation Roadmap

## Overview

Ingest the Google Sheet M&A portfolio, replicate it in DR3, layer on intelligence (validation, EDGAR/news enrichment, suggestions), and monitor spreads intraday. This system operates on **known deals only** — it does not discover new deals.

### Source Sheet Structure

| Column | Description |
|--------|-------------|
| Target | Target company |
| Acquiror | Acquiring company |
| Anncd | Announcement date |
| Close | Expected close date |
| End Dt | End date |
| Cntdwn | Countdown to close |
| Deal Px | Deal price / consideration |
| Crrnt Px | Current market price |
| Grss Yield | Gross spread yield |
| Px Chng | Price change |
| Crrnt Yield | Current annualized yield |
| Category | Deal category |
| Investable | Investable flag |
| Deal Notes | Free-text notes |
| Vote Risk | Shareholder vote risk |
| Finance Risk | Financing risk |
| Legal Risk | Legal/regulatory risk |
| CVR | Contingent value rights |

**Tabs:** Dashboard, EA, COMM, TRUE, IROQ, PLYM

---

## Critical Path

```
Phase 0 (COMPLETE)
    |
    v
Phase 1  ──────────────────────────────┐
    |                                   |
    v                                   v
Phase 2                            Phase 3
(Validation/Diff)              (EDGAR/News Enrichment)
    |                                   |
    └──────────┬────────────────────────┘
               v
           Phase 4
       (Suggestion Engine)
               |
               v
           Phase 5
     (Intraday Monitoring)
```

Phase 2 and Phase 3 can run in parallel once Phase 1 is complete. Phase 4 requires both Phase 2 and Phase 3. Phase 5 requires Phase 1 and Phase 3.

---

## Phase 0: Repo Discovery + Inventory of Reusable Components

**Status: COMPLETE**
**Complexity: Low**

An inventory of all reusable components across `ma-tracker-app` and `py_proj` has been produced. Key reusable assets identified:

- `py_proj/deals_ingest.py` — Google Sheets CSV ingest (needs migration from SQLite to PostgreSQL)
- EDGAR poller, detector, research generator
- News monitors: Reuters, Seeking Alpha, GlobeNewswire, FTC
- Intelligence orchestrator and aggregator
- Options scanner
- Alert service (SMTP-based)
- Polygon data integration
- Custom scheduler

**Acceptance Criteria:**
- [x] Inventory document produced listing all reusable components

---

## Phase 1: Google Sheet Ingestion + Storage + UI Replication

**Status: NOT STARTED**
**Complexity: Medium**
**Dependencies: None (greenfield)**

### What to Build

1. **Migrate `deals_ingest.py` from SQLite to PostgreSQL (Neon)**
   - Rewrite storage layer to target Neon PostgreSQL
   - Preserve existing parsing logic; swap out the persistence backend

2. **Google Sheets auth decision**
   - Option A: Add proper Google Sheets API auth via service account (preferred for automation)
   - Option B: Keep CSV export approach (simpler, fewer moving parts)
   - Decide based on reliability requirements for unattended daily runs

3. **New database tables (migration 024+)**
   - `SheetSnapshot` — one row per ingest run (timestamp, tab, row count, status)
   - `SheetRow` — one row per deal per snapshot (all sheet columns stored, plus snapshot FK)

4. **Daily cron job**
   - Runs at **7:00 AM ET** (before market open)
   - Ingests all 6 tabs from the Google Sheet
   - Creates a new `SheetSnapshot` per tab, inserts all `SheetRow` records
   - Manual refresh button available in UI

5. **Next.js `/ma-portfolio` page**
   - Table displaying all deals from the latest snapshot
   - Match sheet columns exactly
   - Add computed columns: spread (`Deal Px - Crrnt Px`), annualized yield
   - Column chooser (show/hide columns)
   - Comfort mode support (per existing DR3 patterns)
   - Tab selector for all 6 tabs (Dashboard, EA, COMM, TRUE, IROQ, PLYM)

### Acceptance Criteria

- [ ] Sheet data appears in dashboard within 30 minutes of market open
- [ ] All 6 tabs represented and selectable
- [ ] Computed columns (spread, annualized yield) match expected values
- [ ] Manual refresh button works and triggers a new ingest
- [ ] Data persists across deploys (stored in Neon PostgreSQL)

---

## Phase 2: Validation + Reconciliation + Daily Diff/Changelog

**Status: NOT STARTED**
**Complexity: Medium**
**Dependencies: Phase 1**

### What to Build

1. **Row-level diff engine**
   - Compare today's snapshot vs yesterday's snapshot, field by field
   - Produce a structured diff: added rows, removed rows, changed fields per row

2. **Changelog view**
   - New deals highlighted
   - Removed deals highlighted
   - Changed fields shown with before/after values

3. **Validation rules**
   - Missing required fields (Target, Acquiror, Deal Px, etc.)
   - Suspicious prices: deal price < current price anomalies
   - Expired close dates (close date in the past, deal still active)
   - Impossible yields (negative, > 100%, etc.)
   - Category mismatches

4. **New database table: `ValidationIssue`**
   - Fields: deal reference, field, rule violated, severity, status (open/resolved), timestamp
   - UI queue showing all open issues sorted by severity

5. **Daily reconciliation job**
   - Runs after ingest completes
   - Executes all validation rules against latest snapshot
   - Generates diff against previous snapshot
   - Creates `ValidationIssue` records for any findings

6. **Deal-level history timeline**
   - Per-deal view showing all historical field values across snapshots
   - Visual timeline of changes

### Acceptance Criteria

- [ ] Every field change between snapshots is captured and visible in the changelog
- [ ] Validation catches: blank required fields, deal price < current price anomalies, expired close dates, impossible yields
- [ ] Issues queue shows all open issues with severity levels
- [ ] Can compare any two arbitrary snapshots side-by-side

---

## Phase 3: Enrichment via EDGAR/News + Evidence Capture

**Status: NOT STARTED**
**Complexity: High**
**Dependencies: Phase 1 (deals must exist in DB); partially Phase 2 (validation provides context)**

### What to Build

1. **Enrichment worker**
   - For each deal in the portfolio, fetch recent EDGAR filings and news
   - Reuse existing EDGAR poller, detector, and monitors — scoped to **known tickers only** (no discovery)
   - Runs on a schedule (daily + on-demand)

2. **New database tables**
   - `EnrichedFact` — extracted fact (consideration structure, regulatory status, expected close, termination fees, etc.), linked to deal + source
   - `SourceDocument` — URL, accession number, document type, fetched timestamp, raw snippet

3. **Evidence capture**
   - Every enriched fact links back to its source document
   - Store: URLs, EDGAR accession numbers, extracted text snippets, timestamps
   - Full evidence chain: fact -> source document -> URL

4. **Per-deal enrichment page**
   - Timeline of filings, news articles, and key facts
   - Grouped by source type (EDGAR, Reuters, SA, GlobeNewswire, FTC)
   - Searchable and filterable

5. **Claude AI extraction pipeline**
   - Extract structured deal terms from EDGAR filings (merger agreements, proxy statements)
   - Fields extracted: consideration structure, conditions to closing, regulatory approvals needed, termination fees, walk-away provisions, expected close date

### Acceptance Criteria

- [ ] Every active deal has enrichment data within 24 hours of appearing in the sheet
- [ ] EDGAR filings linked to deals with accession numbers
- [ ] News articles linked with URLs and timestamps
- [ ] Extracted facts include: consideration structure, regulatory status, expected close date, termination fees
- [ ] Evidence chain is fully traceable: fact -> source document -> URL

---

## Phase 4: Suggestion Engine + Trade Ideas

**Status: NOT STARTED**
**Complexity: High**
**Dependencies: Phase 3 (enrichment data required)**

### What to Build

1. **Suggestion generator**
   - Compare enriched facts against current sheet data
   - Identify discrepancies and generate typed suggestions:
     - **Field corrections** — enrichment data contradicts sheet value
     - **Risk updates** — new filing or news changes risk profile
     - **New information alerts** — material facts not reflected in sheet

2. **Confidence scoring**
   - Score each suggestion based on evidence strength
   - Factors: number of corroborating sources, recency, source authority
   - Display confidence level alongside each suggestion

3. **Human review queue**
   - Accept / reject / modify workflow
   - Bulk actions for low-severity suggestions
   - Audit trail: who accepted/rejected, when, with what modifications

4. **Trade idea generator**
   - Based on spread analysis + enrichment signals
   - `TradeIdea` table: ticker, direction, rationale, evidence links, confidence, risk factors
   - Clear rationale required — no black-box outputs

### Acceptance Criteria

- [ ] Suggestions generated with evidence links and confidence scores
- [ ] Review queue with accept/reject/modify workflow
- [ ] Accepted suggestions create audit log entries
- [ ] Trade ideas include clear rationale and risk factors
- [ ] Every suggestion has a human-readable explanation (no black-box outputs)

---

## Phase 5: Intraday Monitoring + Alerts

**Status: NOT STARTED**
**Complexity: High**
**Dependencies: Phase 1 (deals in DB), Phase 3 (enrichment for alert context)**

### What to Build

1. **Spread monitor**
   - Poll deal prices every 5 minutes during market hours (9:30 AM - 4:00 PM ET)
   - `SpreadObservation` table: deal FK, timestamp, current price, deal price, spread, yield
   - Time-series data for spread charting

2. **Options monitor**
   - Track key strikes and tenors for portfolio deals
   - Detect unusual options activity (volume spikes, IV changes)
   - Flag for review

3. **Alert engine**
   - Configurable thresholds per deal (absolute spread change, percentage change, yield change)
   - Alert channels: email (existing SMTP infrastructure), dashboard notifications
   - Alert suppression: deduplication, cooldown windows (no repeat alert for same event within N minutes)

4. **Intraday monitor dashboard page**
   - Live spreads for all portfolio deals
   - Color-coded by spread direction (widening = red, tightening = green)
   - Sparkline charts for intraday spread movement

5. **Alert history + settings page**
   - Searchable log of all past alerts
   - Per-deal and per-user alert threshold configuration
   - Enable/disable alerts per deal

### Acceptance Criteria

- [ ] Spread changes exceeding threshold trigger alerts within 5 minutes
- [ ] Unusual options activity detected and flagged
- [ ] Alerts deduplicated — no spam for the same event
- [ ] Alert settings configurable per deal and per user
- [ ] Historical alert log is searchable and filterable

---

## Complexity Summary

| Phase | Description | Complexity | Dependencies | Status |
|-------|-------------|------------|--------------|--------|
| 0 | Repo Discovery + Inventory | Low | None | COMPLETE |
| 1 | Sheet Ingestion + Storage + UI | Medium | None | Not Started |
| 2 | Validation + Diff/Changelog | Medium | Phase 1 | Not Started |
| 3 | EDGAR/News Enrichment | High | Phase 1 | Not Started |
| 4 | Suggestion Engine + Trade Ideas | High | Phase 3 | Not Started |
| 5 | Intraday Monitoring + Alerts | High | Phase 1, Phase 3 | Not Started |
