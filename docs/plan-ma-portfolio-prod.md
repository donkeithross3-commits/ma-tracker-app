# M&A Portfolio Production Support System -- Architecture Plan

> Status: DRAFT | Author: architect agent | Date: 2026-02-24

## Goal

Ingest the business's live M&A portfolio from a Google Sheet every morning, replicate it
in the DR3 dashboard with identical rows/columns/semantics, and layer on intelligence:
validation, reconciliation, EDGAR/news enrichment, deal spread monitoring, options spread
monitoring, and trade idea generation.

**Non-goals:** New deal discovery. We do not redesign DR3. We extend it cleanly.

---

## Phase 0: Inventory

### What Exists (Reuse)

| Component | Location | Notes |
|-----------|----------|-------|
| Google Sheets CSV ingest | `py_proj/deals_ingest.py` | Fetches tabs as CSV via public export URL, upserts into SQLite. Column mapping for Target, Acquiror, Anncd, Close, End Dt, Cntdwn, Deal Px, Crrnt Px, Grss Yield, Px Chng, Crrnt Yield, Category, Investable, Deal Notes, Vote/Finance/Legal Risk, CVR. Sheet ID `148_gz88_...`. Tabs: Dashboard(0), EA, COMM, TRUE, IROQ, PLYM. |
| EDGAR RSS poller | `python-service/app/edgar/poller.py` | Polls SEC RSS every 60s, classifies M&A filings by type and priority. |
| EDGAR detector | `python-service/app/edgar/detector.py` | LLM + keyword detection on filings for M&A relevance. |
| Deal research generator | `python-service/app/edgar/deal_research_generator.py` | Claude AI analysis of filings -- extracts deal terms, consideration structure. |
| SEC EDGAR client (TS) | `lib/sec-edgar.ts` | CIK lookup, filing fetch, merger filing filter. |
| News monitors | `python-service/app/intelligence/monitors/` | Reuters, Seeking Alpha, GlobeNewswire, FTC monitors. |
| Intelligence orchestrator | `python-service/app/intelligence/orchestrator.py` | Coordinates all source monitors, feeds mentions to aggregator. |
| Intelligence aggregator | `python-service/app/intelligence/aggregator.py` | Entity resolution across sources, ticker normalization, confidence scoring. |
| Headline parser | `python-service/app/intelligence/headline_parser.py` | Rule-based M&A extraction (no AI). |
| Alert service | `python-service/app/services/alert_service.py` | SMTP email alerts with HTML templates, per-recipient preferences. |
| Options scanner | `python-service/app/scanner.py` | IB-based options chain analysis, strategy generation. |
| Polygon options | `python-service/app/options/polygon_options.py` | REST API fallback for options data (httpx async, retry/backoff). |
| Custom scheduler | `py_proj/big_move_convexity/scripts/scheduler.py` | Lightweight async Python scheduler (cron expr + interval). |
| Prisma schema | `prisma/schema.prisma` | Deal, DealVersion, DealPrice, DealSnapshot, OptionChainSnapshot, PortfolioPosition, WatchedSpread, ScannerDeal, etc. |
| Raw SQL migrations | `python-service/migrations/` | Numbered 003-023. Next: 024. |
| DB-backed queue | `researchqueue` table | Status polling pattern for async work. |
| Deployment | Docker compose (Next.js) + bare-metal uvicorn (FastAPI) on single DO droplet. |

### What Is New

| Component | Purpose |
|-----------|---------|
| Sheet snapshot & diff engine | Daily full-snapshot capture, hash-based change detection, row-level diffing. |
| Validation engine | Cross-check sheet values against EDGAR/market data; flag discrepancies. |
| Enrichment pipeline | Attach EDGAR filings, news, extracted facts to known deals. |
| Spread monitor | Intraday deal-spread and options-spread tracking with alerts. |
| Trade idea generator | AI-assisted suggestions: corrections, hedges, entry/exit ideas. |
| Portfolio dashboard page | New Next.js page replicating sheet layout + intelligence overlays. |

---

## 1. Target User Workflows

### 1.1 Morning Ingest (6:00 AM CT / 7:00 AM ET)

```
Cron fires at 07:00 ET
  -> Fetch all 6 Google Sheet tabs as CSV
  -> Store raw snapshot (SheetSnapshot + SheetRow[])
  -> Diff against yesterday's snapshot (SheetDiff[])
  -> Run validation pass (ValidationIssue[])
  -> Trigger enrichment pass for new/changed rows
  -> Send morning summary email to analysts
```

The analyst arrives pre-market and sees: "3 new deals, 2 removed, 5 fields changed,
1 validation warning (deal price stale by >1%), enrichment pending for 3 tickers."

### 1.2 Analyst Review (Pre-Market, 7:30-9:30 AM ET)

- Open Portfolio dashboard page.
- See sheet data replicated with same columns/semantics.
- Diff column highlights cells that changed since yesterday (green=new, yellow=changed, red=removed).
- Validation badges on rows with issues (stale price, missing close date, risk rating mismatch).
- Click a row to expand: EDGAR filings, news, extracted facts, AI suggestions.
- Accept/reject/modify suggestions via review queue. All actions logged in audit trail.

### 1.3 Intraday Monitoring (9:30 AM - 4:00 PM ET)

- Spread monitor polls every 5 minutes during market hours.
- Cash deals: `spread = deal_price - current_price`. Stock deals: `spread = target_price - (ratio * acquirer_price)`.
- Options monitor: track key strikes/tenors for watched deals, flag unusual volume, skew shifts.
- Alert when spread widens beyond threshold, unusual options activity, or breaking news on a deal ticker.

### 1.4 Alert Response

- Email alert arrives with deal name, alert type, current spread, threshold, link to dashboard.
- Analyst clicks through to deal detail page with full context.
- Suppression windows prevent alert storms (e.g., no repeat alerts for same deal+type within 30 min).
- Escalation: if spread exceeds critical threshold and no acknowledgment in 15 min, re-alert.

---

## 2. Data Flow Diagram

```
                           +-------------------+
                           |   Google Sheet    |
                           | (6 tabs, ~50-100  |
                           |  deals total)     |
                           +--------+----------+
                                    |
                          07:00 ET daily cron
                                    |
                                    v
                       +------------------------+
                       |   Sheet Ingest Worker   |
                       | - Fetch CSV per tab     |
                       | - Parse & normalize     |
                       | - Store SheetSnapshot   |
                       | - Compute SheetDiff     |
                       +--------+---------------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
          +----------------+     +-------------------+
          | Validation     |     | Enrichment        |
          | Engine         |     | Pipeline          |
          | - Price check  |     | - EDGAR lookup    |
          | - Date check   |     | - News search     |
          | - Risk rating  |     | - AI extraction   |
          |   consistency  |     | - Fact storage    |
          +-------+--------+     +--------+----------+
                  |                        |
                  v                        v
          +----------------+     +-------------------+
          | ValidationIssue|     | EnrichedFact      |
          | table          |     | SourceDocument    |
          +-------+--------+     +--------+----------+
                  |                        |
                  +----------+-------------+
                             |
                             v
                  +---------------------+
                  |   PostgreSQL (Neon)  |
                  | SheetSnapshot       |
                  | SheetRow            |
                  | SheetDiff           |
                  | ValidationIssue     |
                  | EnrichedFact        |
                  | SourceDocument      |
                  | SpreadObservation   |
                  | TradeIdea           |
                  | Alert / AlertSetting|
                  +----------+----------+
                             |
                    +--------+--------+
                    |                 |
                    v                 v
          +-----------------+  +------------------+
          | FastAPI (8000)  |  | Next.js (3000)   |
          | - REST API      |  | - Portfolio page |
          | - WebSocket     |  | - Deal detail    |
          |   relay         |  | - Diff view      |
          | - On-demand     |  | - Review queue   |
          |   enrichment    |  | - Alert config   |
          +---------+-------+  +--------+---------+
                    |                    |
                    v                    v
          +-----------------+  +------------------+
          | Spread Monitor  |  | Browser / User   |
          | (5-min poll)    |  +------------------+
          | - Deal spreads  |
          | - Options skew  |          ^
          | - Volume alerts |          |
          +--------+--------+   Email alerts
                   |            (SMTP via alert_service)
                   v
          +------------------+
          | SpreadObservation|
          | Alert            |
          +------------------+
```

---

## 3. Service Boundaries

### 3.1 Cron Jobs (scheduled, fire-and-forget)

| Job | Schedule | What It Does |
|-----|----------|--------------|
| Morning sheet ingest | 07:00 ET daily (weekdays) | Fetch sheet, snapshot, diff, validate |
| Daily enrichment pass | 07:15 ET daily (weekdays) | Enrich new/changed deals from morning diff |
| Stale-data cleanup | 02:00 ET daily | Archive snapshots >90 days, prune resolved issues |

Implementation: Use the existing `py_proj` scheduler (`ScheduleRule` with `cron_expr`)
or a simple cron entry on the droplet. The morning ingest and enrichment are separate
tasks so a failure in enrichment does not block the snapshot.

### 3.2 FastAPI (port 8000) -- Request-Response

| Endpoint Group | Purpose |
|----------------|---------|
| `GET /portfolio/snapshot/latest` | Return latest sheet data + diff + validation |
| `GET /portfolio/snapshot/{date}` | Historical snapshot for a given date |
| `GET /portfolio/deal/{ticker}/enrichment` | All enriched facts for a deal |
| `POST /portfolio/deal/{ticker}/enrich` | On-demand enrichment trigger |
| `GET /portfolio/diff/{date}` | Row-level changelog for a date |
| `GET /portfolio/validation/issues` | Open validation issues |
| `POST /portfolio/suggestion/{id}/accept` | Accept an AI suggestion |
| `POST /portfolio/suggestion/{id}/reject` | Reject an AI suggestion |
| `GET /portfolio/alerts/settings` | User alert preferences |
| `PUT /portfolio/alerts/settings` | Update alert preferences |
| `GET /portfolio/spreads/latest` | Latest spread observations |
| `GET /portfolio/trade-ideas` | Current trade ideas |
| WebSocket `/ws/spreads` | Real-time spread updates relay |

### 3.3 Background Workers (long-running, event-driven)

| Worker | Trigger | What It Does |
|--------|---------|--------------|
| EDGAR poller | Continuous (60s loop) | Already exists. Repurposed: match filings to known portfolio tickers, not discover new deals. |
| News monitors | Continuous (per-monitor interval) | Already exists. Repurposed: enrich known deals only. |
| Spread monitor | 5-min interval, market hours only | Poll Polygon/IB for target+acquirer prices, compute spreads, store SpreadObservation, check alert thresholds. |
| Options monitor | 5-min interval, market hours only | Fetch options chains for watched deals, detect unusual volume/skew, store observations. |
| Alert dispatcher | Event-driven (triggered by monitors) | Evaluate alert rules, dedup, send via SMTP, record in Alert table. |

---

## 4. Storage Design

### 4.1 New Entities

```sql
-- Full snapshot of the Google Sheet at a point in time
CREATE TABLE sheet_snapshots (
    snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date   DATE NOT NULL,
    tab_name        TEXT NOT NULL,           -- 'Dashboard', 'EA', 'COMM', etc.
    tab_gid         TEXT NOT NULL,
    row_count       INT NOT NULL,
    content_hash    TEXT NOT NULL,           -- SHA-256 of sorted CSV content
    raw_csv         TEXT,                    -- optional: full CSV for audit
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(snapshot_date, tab_name)
);

-- Individual rows from the sheet, one per deal per snapshot
CREATE TABLE sheet_rows (
    row_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     UUID NOT NULL REFERENCES sheet_snapshots(snapshot_id),
    row_index       INT NOT NULL,           -- position in sheet
    target          TEXT,
    acquiror        TEXT,
    announced_date  TEXT,
    close_date      TEXT,
    end_date        TEXT,
    countdown       TEXT,
    deal_price      NUMERIC(10,4),
    current_price   NUMERIC(10,4),
    gross_yield     TEXT,
    price_change    TEXT,
    current_yield   TEXT,
    category        TEXT,
    investable      TEXT,
    deal_notes      TEXT,
    vote_risk       TEXT,
    finance_risk    TEXT,
    legal_risk      TEXT,
    cvr             TEXT,
    row_hash        TEXT NOT NULL,           -- SHA-256 of all field values
    matched_deal_id UUID,                    -- FK to deals table (if matched)
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sheet_rows_snapshot ON sheet_rows(snapshot_id);
CREATE INDEX idx_sheet_rows_target ON sheet_rows(target);

-- Row-level changes between consecutive snapshots
CREATE TABLE sheet_diffs (
    diff_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     UUID NOT NULL REFERENCES sheet_snapshots(snapshot_id),
    prev_snapshot_id UUID REFERENCES sheet_snapshots(snapshot_id),
    target          TEXT NOT NULL,
    diff_type       TEXT NOT NULL,           -- 'added', 'removed', 'changed'
    changed_fields  JSONB,                   -- {"deal_price": {"old": 45.00, "new": 46.50}}
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sheet_diffs_snapshot ON sheet_diffs(snapshot_id);
CREATE INDEX idx_sheet_diffs_type ON sheet_diffs(diff_type);

-- Validation issues detected during ingest or enrichment
CREATE TABLE validation_issues (
    issue_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     UUID REFERENCES sheet_snapshots(snapshot_id),
    row_id          UUID REFERENCES sheet_rows(row_id),
    target          TEXT NOT NULL,
    issue_type      TEXT NOT NULL,           -- 'stale_price', 'missing_close_date',
                                             -- 'risk_mismatch', 'price_discrepancy'
    severity        TEXT NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'error'
    description     TEXT NOT NULL,
    expected_value  TEXT,
    actual_value    TEXT,
    resolved        BOOLEAN DEFAULT false,
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_validation_issues_snapshot ON validation_issues(snapshot_id);
CREATE INDEX idx_validation_issues_resolved ON validation_issues(resolved);

-- Facts extracted from EDGAR, news, or AI analysis
CREATE TABLE enriched_facts (
    fact_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target          TEXT NOT NULL,           -- deal target name (join key to sheet)
    ticker          TEXT,
    fact_type       TEXT NOT NULL,           -- 'deal_price', 'consideration_structure',
                                             -- 'collar_terms', 'go_shop', 'termination_fee',
                                             -- 'conditions', 'expected_close', 'regulatory_risk',
                                             -- 'financing'
    fact_value      TEXT NOT NULL,
    confidence      NUMERIC(3,2),            -- 0.00-1.00
    source_doc_id   UUID REFERENCES source_documents(doc_id),
    extraction_method TEXT,                  -- 'ai_claude', 'rule_based', 'manual'
    superseded_by   UUID,                    -- newer fact that replaces this one
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_enriched_facts_target ON enriched_facts(target);
CREATE INDEX idx_enriched_facts_ticker ON enriched_facts(ticker);
CREATE INDEX idx_enriched_facts_type ON enriched_facts(fact_type);

-- Source documents backing enriched facts
CREATE TABLE source_documents (
    doc_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type     TEXT NOT NULL,           -- 'edgar_filing', 'press_release',
                                             -- 'news_article', 'sec_rss'
    source_name     TEXT,                    -- 'SEC EDGAR', 'Reuters', 'Seeking Alpha'
    url             TEXT NOT NULL,
    title           TEXT,
    published_at    TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ DEFAULT now(),
    content_hash    TEXT,                    -- for dedup
    content_excerpt TEXT,                    -- first 500 chars
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_source_documents_type ON source_documents(source_type);
CREATE UNIQUE INDEX idx_source_documents_url ON source_documents(url);

-- Intraday spread observations
CREATE TABLE spread_observations (
    obs_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target          TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    acquiror_ticker TEXT,
    obs_time        TIMESTAMPTZ NOT NULL,
    deal_type       TEXT NOT NULL,           -- 'cash', 'stock', 'mixed'
    deal_price      NUMERIC(10,4),
    target_price    NUMERIC(10,4) NOT NULL,
    acquiror_price  NUMERIC(10,4),
    stock_ratio     NUMERIC(10,6),
    spread_dollar   NUMERIC(10,4),           -- absolute spread
    spread_pct      NUMERIC(10,6),           -- spread as % of deal price
    source          TEXT DEFAULT 'polygon',  -- 'polygon', 'ib'
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_spread_obs_ticker ON spread_observations(ticker, obs_time DESC);
CREATE INDEX idx_spread_obs_time ON spread_observations(obs_time DESC);

-- AI-generated trade ideas and suggestions
CREATE TABLE trade_ideas (
    idea_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target          TEXT NOT NULL,
    ticker          TEXT,
    idea_type       TEXT NOT NULL,           -- 'correction', 'hedge', 'entry', 'exit',
                                             -- 'options_trade'
    summary         TEXT NOT NULL,
    detail          TEXT,
    confidence      NUMERIC(3,2),
    evidence_facts  UUID[],                  -- references to enriched_facts
    status          TEXT DEFAULT 'pending',  -- 'pending', 'accepted', 'rejected', 'expired'
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trade_ideas_status ON trade_ideas(status);
CREATE INDEX idx_trade_ideas_target ON trade_ideas(target);

-- Alert definitions and preferences
CREATE TABLE portfolio_alert_settings (
    setting_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    alert_type      TEXT NOT NULL,           -- 'spread_widen', 'spread_narrow',
                                             -- 'unusual_volume', 'news_break',
                                             -- 'validation_error', 'new_deal', 'deal_removed'
    target          TEXT,                    -- NULL = all deals
    threshold_pct   NUMERIC(10,4),           -- e.g., 0.02 = 2%
    threshold_abs   NUMERIC(10,4),           -- e.g., $0.50
    channel         TEXT DEFAULT 'email',    -- 'email', 'websocket', 'both'
    enabled         BOOLEAN DEFAULT true,
    suppression_minutes INT DEFAULT 30,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_alert_settings_user ON portfolio_alert_settings(user_id);

-- Fired alerts (audit log)
CREATE TABLE portfolio_alerts (
    alert_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_id      UUID REFERENCES portfolio_alert_settings(setting_id),
    alert_type      TEXT NOT NULL,
    target          TEXT NOT NULL,
    ticker          TEXT,
    message         TEXT NOT NULL,
    severity        TEXT DEFAULT 'info',     -- 'info', 'warning', 'critical'
    spread_value    NUMERIC(10,4),
    threshold_value NUMERIC(10,4),
    channel         TEXT NOT NULL,
    status          TEXT DEFAULT 'sent',     -- 'sent', 'acknowledged', 'suppressed'
    sent_at         TIMESTAMPTZ DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX idx_portfolio_alerts_target ON portfolio_alerts(target, sent_at DESC);
CREATE INDEX idx_portfolio_alerts_status ON portfolio_alerts(status);
```

### 4.2 Relationship to Existing Entities

```
sheet_rows.matched_deal_id  -->  deals.deal_id           (link sheet row to existing Deal)
enriched_facts.ticker       -->  deals.ticker             (join on ticker)
spread_observations.ticker  -->  deals.ticker             (join on ticker)
spread_observations         -->  deal_prices              (complementary: deal_prices = daily close,
                                                           spread_observations = intraday)
enriched_facts              -->  deal_intelligence        (enrichment may reference intelligence-
                                                           discovered deals)
source_documents            -->  edgar_filings            (source_documents is a superset:
                                                           EDGAR + news + press releases)
portfolio_alerts            -->  alert_notifications      (parallel table; portfolio_alerts is
                                                           specifically for spread/portfolio events,
                                                           alert_notifications for discovery events)
OptionChainSnapshot         -->  spread_observations      (options chain data feeds into options
                                                           spread monitoring)
```

---

## 5. Idempotency + Versioning Strategy

### 5.1 Daily Sheet Snapshots

- Each morning ingest creates exactly one `sheet_snapshot` per tab per date.
- If the ingest runs twice on the same date, it checks `content_hash`. If identical,
  skip. If different (sheet was updated), replace the snapshot and recompute diffs.
- The `UNIQUE(snapshot_date, tab_name)` constraint enforces one-snapshot-per-day-per-tab.

### 5.2 Hash-Based Change Detection

Every `sheet_row` gets a `row_hash = SHA-256(sorted(field_name:field_value))`.

Reconciliation algorithm:

```
today_rows   = {target -> row_hash}   from today's snapshot
yesterday_rows = {target -> row_hash} from yesterday's snapshot

added   = today_rows.keys() - yesterday_rows.keys()
removed = yesterday_rows.keys() - today_rows.keys()
changed = {t for t in (today_rows.keys() & yesterday_rows.keys())
           if today_rows[t] != yesterday_rows[t]}
```

This is deterministic -- running the diff twice on the same pair of snapshots produces
identical results.

### 5.3 Row-Level Diffing

For each `changed` row, compute field-level diff:

```python
for field in ALL_FIELDS:
    old_val = yesterday_row[field]
    new_val = today_row[field]
    if old_val != new_val:
        changed_fields[field] = {"old": old_val, "new": new_val}
```

Store in `sheet_diffs.changed_fields` as JSONB.

### 5.4 Handling Edge Cases

| Scenario | Handling |
|----------|----------|
| New deal appears | `diff_type = 'added'`, trigger enrichment for all fields. |
| Deal removed from sheet | `diff_type = 'removed'`, mark existing Deal as `status = 'closed'` (if matched). Do NOT delete data. |
| Field value changes | `diff_type = 'changed'`, store old/new. If deal_price changed, trigger validation against market data. |
| Deal name spelling change | Use fuzzy matching (target name similarity > 0.85) to avoid creating duplicate deals. |
| Tab restructured | Content hash changes; full re-snapshot. Diff against previous will show many changes -- flag for manual review. |
| Google API down | Retry 3x with exponential backoff (2s, 4s, 8s). If all fail, log error, send alert, skip day. Yesterday's data remains current. |

---

## 6. EDGAR + News Ingestion Approach

### 6.1 Repurposed Monitors (Enrichment, Not Discovery)

The existing EDGAR poller and news monitors were built for deal **discovery**. We repurpose
them for deal **enrichment** of known portfolio deals:

```
BEFORE (discovery mode):
  SEC RSS -> parse all filings -> detect M&A -> create staged_deal

AFTER (enrichment mode, additive):
  SEC RSS -> parse all filings -> filter to KNOWN tickers only -> attach to deal as EnrichedFact
  News monitors -> scan headlines -> filter to KNOWN tickers only -> attach as EnrichedFact
```

The discovery pipeline continues to run unchanged. The enrichment pipeline is a new
consumer of the same data streams, filtering by the set of tickers in the current
portfolio sheet.

### 6.2 Rate Limiting and Caching

| Service | Rate Limit | Our Pattern |
|---------|-----------|-------------|
| SEC EDGAR | 10 req/sec | Already respected in poller.py (60s poll interval). For enrichment batch, use 5 req/sec with 200ms sleep. |
| Polygon | 5 req/sec (paid) | Existing backoff in `polygon_options.py`. Spread monitor: 1 req per deal per 5-min cycle. |
| News sources | Varies | Existing monitor intervals. No change needed. |
| Claude AI | Per-token billing | Batch enrichment: max 10 deals/day for AI extraction. On-demand: 1 at a time. |

Cache layer: `source_documents` table with `content_hash` prevents re-fetching identical
documents. EDGAR filing URLs are stable -- once fetched, content never changes.

### 6.3 Source-of-Truth: Citations

Every `enriched_fact` must have a `source_doc_id` pointing to a `source_document` with
a real URL. No facts without citations. The UI always shows "Source: SEC Filing 8-K
(2026-02-15)" or "Source: Reuters (2026-02-20)" next to extracted data.

### 6.4 Legitimate Access

- SEC EDGAR: Public data, proper User-Agent header (already configured).
- Reuters/Seeking Alpha: Headline scraping from public RSS/pages only. No paywall bypass.
- GlobeNewswire: Public press releases.
- FTC: Public early termination notices.
- All access patterns match what a human analyst would do manually.

---

## 7. AI Pipeline Design

### 7.1 Pipeline Stages

```
  INPUTS                RETRIEVAL              EXTRACTION
  +-----------+         +-----------+          +-----------+
  | Sheet row |-------->| EDGAR     |--------->| AI Extract|
  | (target,  |         | filings   |          | - price   |
  |  acquiror,|         | for known |          | - consid. |
  |  deal_px) |         | ticker    |          | - collar  |
  +-----------+         +-----------+          | - go-shop |
       |                     |                 | - term fee|
       v                     v                 | - close dt|
  +-----------+         +-----------+          | - regs    |
  | Prior     |         | Press     |          | - finance |
  | snapshots |         | releases  |          +-----------+
  | (history) |         | News      |               |
  +-----------+         +-----------+               v
                                              VALIDATION
                                             +-----------+
                                             | Compare   |
                                             | extracted |
                                             | vs sheet  |
                                             | values    |
                                             +-----------+
                                                  |
                                                  v
                                             SUGGESTION
                                             +-----------+
                                             | Generate  |
                                             | corrections|
                                             | with conf.|
                                             | + evidence|
                                             +-----------+
                                                  |
                                                  v
                                             HUMAN REVIEW
                                             +-----------+
                                             | Review    |
                                             | queue     |
                                             | accept /  |
                                             | reject /  |
                                             | modify    |
                                             +-----------+
```

### 7.2 Input Assembly

For each deal to enrich, assemble a context bundle:

```python
context = {
    "sheet_row": current_sheet_row,          # today's values
    "prior_rows": last_5_sheet_rows,         # historical values from snapshots
    "deal_metadata": matched_deal_version,   # from deals/deal_versions tables
    "existing_facts": current_enriched_facts # what we already know
}
```

### 7.3 Retrieval (Known Tickers Only)

For each target ticker in the portfolio:
1. EDGAR: Fetch recent filings (8-K, DEFM14A, S-4, SC TO, 425) for target CIK and acquirer CIK.
2. Press releases: Search GlobeNewswire for target and acquirer names.
3. News: Search Reuters/Seeking Alpha headlines for target ticker.

**Scope guard:** Only fetch for tickers that appear in the current sheet. Never broaden
to discover new deals through this pipeline.

### 7.4 Extraction (Claude AI)

Prompt pattern (reuse `DealResearchGenerator` structure):

```
Given the following M&A deal and source documents, extract:
- Cash consideration per share
- Stock exchange ratio (if any)
- Collar terms (floor, ceiling)
- Go-shop period and end date
- Termination fee ($ and % of deal value)
- Conditions precedent (regulatory approvals, shareholder vote, financing)
- Expected closing date
- Regulatory risks (HSR, CFIUS, foreign competition)
- Financing details (committed, conditional)

For each extracted fact, provide:
- The exact value
- Confidence (0.0 - 1.0)
- The exact quote from the source document supporting this fact

Source documents:
{filing_text}

Current sheet values for comparison:
{sheet_row_json}
```

### 7.5 Validation

Compare AI-extracted facts against sheet values:

```python
discrepancies = []
if extracted.deal_price and sheet.deal_price:
    diff_pct = abs(extracted.deal_price - sheet.deal_price) / sheet.deal_price
    if diff_pct > 0.001:  # >0.1% difference
        discrepancies.append(ValidationIssue(
            issue_type='price_discrepancy',
            expected_value=str(extracted.deal_price),
            actual_value=str(sheet.deal_price),
            description=f"EDGAR filing shows ${extracted.deal_price}, sheet shows ${sheet.deal_price}"
        ))
```

### 7.6 Suggestion Generation

For each discrepancy or missing value, generate a `TradeIdea` with:
- `idea_type = 'correction'` -- "Update deal price from $45.00 to $46.50 per DEFM14A"
- `confidence` -- based on source quality (EDGAR > press release > news)
- `evidence_facts` -- list of `enriched_fact` IDs supporting the suggestion

### 7.7 Human-in-the-Loop

All suggestions land in a review queue (the `trade_ideas` table with `status = 'pending'`).
Analysts can:
- **Accept**: Apply the correction. Log in `audit_logs`.
- **Reject**: Mark rejected with reason. No data change.
- **Modify**: Edit the suggestion before applying. Both original and modified values logged.

---

## 8. Intraday Monitoring Design

### 8.1 Deal Spread Monitoring

**Cash deals:**
```
spread = deal_price - target_current_price
spread_pct = spread / deal_price
```

**Stock deals:**
```
implied_deal_value = stock_ratio * acquirer_current_price
spread = implied_deal_value - target_current_price
spread_pct = spread / implied_deal_value
```

**Mixed deals:**
```
implied_deal_value = cash_component + (stock_ratio * acquirer_current_price)
spread = implied_deal_value - target_current_price
```

Data sources (priority order):
1. Polygon REST API (`/v2/aggs/ticker/{ticker}/prev` for last close, `/v2/last/trade/{ticker}` for intraday)
2. IB via WebSocket relay (fallback when Polygon unavailable)

### 8.2 Options Monitoring

For each watched deal, track:
- **Key strikes**: ATM, deal-price strike, and one strike above/below.
- **Key tenors**: Nearest monthly, and expiration closest to expected close date.
- **Metrics per contract**: bid/ask, volume, open interest, implied vol, delta.

Detect:
- **Unusual volume**: Volume > 2x 20-day average for a specific strike/tenor.
- **Skew shifts**: Put IV - Call IV change > 5 vol points intraday.
- **Borrow/HTB signals**: Steep put skew + negative put-call parity divergence.

Implementation: Extend existing `PolygonOptionsClient` to fetch snapshot chains
for specific tickers. Store in `OptionChainSnapshot` (already exists) + new
`spread_observations` for the derived metrics.

### 8.3 Alert Rules

| Alert Type | Condition | Default Threshold | Suppression |
|------------|-----------|-------------------|-------------|
| `spread_widen` | spread_pct > threshold | 2% of deal value | 30 min |
| `spread_narrow` | spread_pct < threshold | 0.5% (near close) | 30 min |
| `unusual_volume` | volume > 2x avg | 2x 20d avg | 60 min |
| `skew_shift` | put-call IV diff > X | 5 vol points | 60 min |
| `news_break` | new headline for deal ticker | any new | 15 min |
| `validation_error` | new issue severity='error' | any error | no suppression |

### 8.4 Deduplication and Escalation

- Each alert is keyed on `(target, alert_type, date)`.
- Within suppression window, new triggers are logged but not sent.
- Escalation: if `severity = 'critical'` and no `acknowledged_at` within 15 minutes,
  re-send with `[ESCALATION]` prefix.
- Dedup: Before sending, check `portfolio_alerts` for same `(target, alert_type)` with
  `sent_at` within suppression window.

---

## 9. Observability + Reliability

### 9.1 Logging

All services use Python `logging` module. Log levels:
- `INFO`: Job start/complete, deals processed, alerts sent.
- `WARNING`: Partial failures (one tab fetch failed, one enrichment timed out).
- `ERROR`: Full job failure, API errors, DB connection issues.

**Never log:** API keys, database credentials, email addresses in plain text, sheet content.

Structured log format:
```
[2026-02-24 07:00:15 ET] [sheet_ingest] INFO: Snapshot complete. tabs=6 rows=87 hash=abc123
[2026-02-24 07:00:16 ET] [sheet_ingest] INFO: Diff complete. added=2 removed=0 changed=4
[2026-02-24 07:00:17 ET] [validation]   WARN: Price stale for ATVI. sheet=$95.00 market=$94.25 diff=0.8%
```

### 9.2 Metrics

| Metric | Source | Alert If |
|--------|--------|----------|
| `sheet_ingest_last_success` | Timestamp of last successful ingest | > 26 hours ago |
| `sheet_ingest_row_count` | Rows in latest snapshot | Drops > 20% from previous |
| `enrichment_coverage_pct` | Deals with >= 1 enriched fact / total deals | < 50% |
| `spread_monitor_last_run` | Timestamp of last spread poll | > 10 min during market hours |
| `open_validation_issues` | Count of unresolved issues | > 20 |
| `alert_send_failures` | Count of SMTP failures in last hour | > 0 |
| `edgar_poll_last_success` | Timestamp of last successful EDGAR poll | > 5 min |

Implementation: A `/health` endpoint on FastAPI that returns all metrics as JSON.
Optionally expose as Prometheus-compatible `/metrics` endpoint later.

### 9.3 Health Checks

```python
@app.get("/portfolio/health")
async def portfolio_health():
    return {
        "sheet_ingest": {
            "last_success": last_ingest_timestamp,
            "status": "ok" if within_26h else "stale"
        },
        "enrichment": {
            "coverage_pct": enrichment_coverage,
            "status": "ok" if coverage > 0.5 else "low"
        },
        "spread_monitor": {
            "last_run": last_spread_timestamp,
            "status": "ok" if within_10m_or_outside_hours else "stale"
        },
        "edgar_poller": {
            "last_poll": last_edgar_poll,
            "status": "ok" if within_5m else "stale"
        },
        "database": {
            "connected": db_ping_ok,
            "status": "ok" if db_ping_ok else "down"
        }
    }
```

### 9.4 Runbooks

**Google Sheets API fails:**
1. Check if sheet is still publicly accessible (try the export URL in browser).
2. Check if Google is experiencing an outage (status.cloud.google.com).
3. If sheet was made private, re-enable "Anyone with the link can view."
4. If persistent, the morning ingest will retry 3x then skip. Yesterday's data remains.

**EDGAR throttles (429 or connection reset):**
1. Poller automatically backs off (60s -> 300s outside market hours).
2. If persistent, check SEC status page.
3. Verify User-Agent header is set correctly.
4. Reduce enrichment batch size from 5 req/sec to 2 req/sec.

**Polygon rate-limited:**
1. Check `POLYGON_API_KEY` tier (paid vs free).
2. Reduce spread monitor frequency from 5-min to 15-min.
3. Fallback to IB for real-time prices (if agent connected).

**DB connection issues:**
1. Check Neon dashboard for outage/maintenance.
2. Verify `DATABASE_URL` env var is set.
3. Check connection pool exhaustion (max connections in asyncpg pool).
4. Restart FastAPI if pool is corrupted.

---

## 10. Deployment Plan

### 10.1 Schedule

| Time (ET) | Event |
|-----------|-------|
| 07:00 | Morning sheet ingest cron fires |
| 07:15 | Daily enrichment pass begins |
| 09:25 | Spread monitor starts (5 min before open) |
| 09:30 - 16:00 | Spread + options monitor active (5-min polls) |
| 16:05 | Spread monitor stops |
| 02:00 | Stale data cleanup |

### 10.2 Migrations

New migrations starting at `024_`:

```
024_sheet_snapshots.sql          -- sheet_snapshots, sheet_rows tables
025_sheet_diffs.sql              -- sheet_diffs table
026_validation_issues.sql        -- validation_issues table
027_enriched_facts.sql           -- enriched_facts, source_documents tables
028_spread_observations.sql      -- spread_observations table
029_trade_ideas.sql              -- trade_ideas table
030_portfolio_alerts.sql         -- portfolio_alert_settings, portfolio_alerts tables
```

Each migration is additive (CREATE TABLE, CREATE INDEX). No ALTER on existing tables.
No data migration required.

### 10.3 Roll-Forward / Roll-Back

**Roll-forward:**
- All schema changes are additive (new tables, new indexes).
- New API endpoints are behind a feature flag: `FEATURE_PORTFOLIO_SUPPORT=true`.
- When flag is `false`, endpoints return 404 and cron jobs skip.
- Enable flag after confirming migrations applied and first ingest succeeds.

**Roll-back:**
- Disable feature flag. All new functionality becomes unreachable.
- New tables can remain (no harm, just unused).
- If critical, `DROP TABLE` the new tables (024-030 are independent of existing tables).
- No existing tables or data are modified, so rollback never affects current functionality.

### 10.4 Deployment Sequence

```
1. Apply migrations 024-030 via psql on Neon
2. Deploy Python service with new ingest/enrichment/monitor code
     (kill/restart uvicorn pattern)
3. Deploy Next.js with new portfolio page (docker compose build + recreate)
4. Set FEATURE_PORTFOLIO_SUPPORT=true in env
5. Run manual sheet ingest to verify: curl -X POST localhost:8000/portfolio/ingest
6. Verify snapshot in DB: psql -c "SELECT * FROM sheet_snapshots ORDER BY created_at DESC LIMIT 1"
7. Enable cron job for morning ingest
8. Monitor /portfolio/health for 24h before enabling alerts
```

### 10.5 Minimal Downtime

- All deployments happen outside market hours (after 4:30 PM ET or before 7:00 AM ET).
- The morning ingest cron fires at 7:00 AM ET, well before market open.
- Spread monitor only runs during market hours; deploying outside hours causes zero disruption.
- Feature flag allows deploying code without activating it, then flipping on after verification.
