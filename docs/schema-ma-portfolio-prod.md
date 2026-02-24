# Proposed Schema: M&A Portfolio Production Support

> Extends the existing DR3 dashboard (Prisma + raw SQL on PostgreSQL / Neon Cloud).
> All tables below are **new raw-SQL migrations** (024+), following the existing
> numbered-migration pattern in `python-service/migrations/`.

---

## 1. New Tables

### 1.1 `sheet_snapshots` -- One row per daily ingest run

Captures metadata for each Google Sheet tab pull so we can detect duplicates
(via `raw_hash`) and track partial failures.

```sql
CREATE TABLE sheet_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date   DATE NOT NULL,
    tab_name        VARCHAR(50) NOT NULL,       -- 'Dashboard', 'EA', 'COMM', etc.
    tab_gid         VARCHAR(20) NOT NULL,       -- '0', '815650768', etc.
    row_count       INT,
    raw_hash        VARCHAR(64),                -- SHA-256 of CSV content for idempotency
    status          VARCHAR(20) NOT NULL DEFAULT 'complete',  -- complete / partial / failed
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_sheet_snapshots_date_tab UNIQUE (snapshot_date, tab_name)
);

CREATE INDEX idx_sheet_snapshots_date ON sheet_snapshots (snapshot_date DESC);
```

### 1.2 `sheet_rows` -- Individual deal rows from each snapshot

Full copy of every deal row per snapshot. Typed where possible, text for fields
whose sheet format varies.

```sql
CREATE TABLE sheet_rows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    row_index       INT NOT NULL,               -- position in sheet (0-based)
    target          VARCHAR(255),               -- target company name
    acquiror        VARCHAR(255),
    announced_date  TEXT,                       -- sheet format varies
    close_date      TEXT,
    end_date        TEXT,
    countdown       TEXT,
    deal_price      NUMERIC(10,4),
    current_price   NUMERIC(10,4),
    gross_yield     TEXT,                       -- may include % symbol
    price_change    TEXT,
    current_yield   TEXT,
    category        VARCHAR(50),
    investable      VARCHAR(50),
    deal_notes      TEXT,
    vote_risk       VARCHAR(20),
    finance_risk    VARCHAR(20),
    legal_risk      VARCHAR(20),
    cvr             TEXT,
    tab_link        TEXT,
    raw_json        JSONB,                      -- full row as-is for future-proofing

    CONSTRAINT uq_sheet_rows_snapshot_row UNIQUE (snapshot_id, row_index)
);

CREATE INDEX idx_sheet_rows_snapshot ON sheet_rows (snapshot_id);
CREATE INDEX idx_sheet_rows_target  ON sheet_rows (target);
```

### 1.3 `sheet_diffs` -- Row-level changes between consecutive snapshots

Only stores rows that changed (added, removed, or modified). The `changed_fields`
column records a per-field old/new diff for modified rows.

```sql
CREATE TABLE sheet_diffs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id       UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    prev_snapshot_id  UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    target            VARCHAR(255),
    diff_type         VARCHAR(20) NOT NULL,     -- 'added', 'removed', 'modified'
    changed_fields    JSONB,                    -- {"field": {"old": X, "new": Y}}
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sheet_diffs_snapshot  ON sheet_diffs (snapshot_id);
CREATE INDEX idx_sheet_diffs_type      ON sheet_diffs (diff_type);
CREATE INDEX idx_sheet_diffs_target    ON sheet_diffs (target);
```

### 1.4 `validation_issues` -- Issues found during reconciliation

Flagged by automated rules (e.g. "deal_price is NULL for active deal",
"close_date is in the past but deal still listed").

```sql
CREATE TABLE validation_issues (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id      UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    sheet_row_id     UUID REFERENCES sheet_rows(id) ON DELETE SET NULL,
    target           VARCHAR(255),
    severity         VARCHAR(20) NOT NULL,      -- 'error', 'warning', 'info'
    rule_name        VARCHAR(100) NOT NULL,     -- which validation rule fired
    message          TEXT NOT NULL,
    field_name       VARCHAR(50),               -- which field is problematic
    expected_value   TEXT,
    actual_value     TEXT,
    status           VARCHAR(20) NOT NULL DEFAULT 'open',  -- open / acknowledged / resolved / false_positive
    resolved_by      UUID,                      -- FK to users if user table exists
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_validation_issues_snapshot ON validation_issues (snapshot_id);
CREATE INDEX idx_validation_issues_status   ON validation_issues (status);
CREATE INDEX idx_validation_issues_severity ON validation_issues (severity);
CREATE INDEX idx_validation_issues_target   ON validation_issues (target);
```

### 1.5 `source_documents` -- EDGAR filings, news articles, press releases

Canonical registry of every external document we fetch.

```sql
CREATE TABLE source_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type       VARCHAR(50) NOT NULL,     -- 'edgar_filing', 'reuters', 'seeking_alpha',
                                                -- 'globenewswire', 'ftc', 'press_release'
    url               TEXT NOT NULL,
    accession_number  VARCHAR(30),              -- for EDGAR filings
    filing_type       VARCHAR(20),              -- 'DEFM14A', '8-K', 'SC TO', etc.
    title             TEXT,
    published_at      TIMESTAMPTZ,
    content_snippet   TEXT,                     -- first 2000 chars or relevant excerpt
    target            VARCHAR(255),             -- which deal this relates to
    ticker            VARCHAR(10),
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_source_documents_url UNIQUE (url)
);

CREATE INDEX idx_source_documents_target    ON source_documents (target);
CREATE INDEX idx_source_documents_ticker    ON source_documents (ticker);
CREATE INDEX idx_source_documents_type      ON source_documents (source_type);
CREATE INDEX idx_source_documents_published ON source_documents (published_at DESC);
```

### 1.6 `enriched_facts` -- Facts extracted from EDGAR / news about deals

Granular, typed facts with confidence and lineage back to a source document.

```sql
CREATE TABLE enriched_facts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target              VARCHAR(255),
    ticker              VARCHAR(10),
    fact_type           VARCHAR(50) NOT NULL,   -- 'consideration', 'close_date',
                                                -- 'termination_fee', 'regulatory_status',
                                                -- 'go_shop', 'collar_terms', 'financing',
                                                -- 'vote_date', 'condition', etc.
    fact_value          TEXT NOT NULL,
    confidence          NUMERIC(3,2),           -- 0.00 to 1.00
    source_document_id  UUID REFERENCES source_documents(id) ON DELETE SET NULL,
    extraction_method   VARCHAR(50),            -- 'ai_claude', 'rule_based', 'headline_parser'
    extracted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_by       UUID REFERENCES enriched_facts(id) ON DELETE SET NULL
);

CREATE INDEX idx_enriched_facts_target   ON enriched_facts (target);
CREATE INDEX idx_enriched_facts_ticker   ON enriched_facts (ticker);
CREATE INDEX idx_enriched_facts_type     ON enriched_facts (fact_type);
CREATE INDEX idx_enriched_facts_source   ON enriched_facts (source_document_id);
```

### 1.7 `suggestions` -- AI-generated suggestions for sheet corrections

Each suggestion ties back to the current sheet row and to the enriched facts
that support it.

```sql
CREATE TABLE suggestions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target            VARCHAR(255),
    sheet_row_id      UUID REFERENCES sheet_rows(id) ON DELETE SET NULL,
    suggestion_type   VARCHAR(50) NOT NULL,     -- 'field_correction', 'risk_update',
                                                -- 'new_info', 'date_update'
    field_name        VARCHAR(50),              -- which field to update
    current_value     TEXT,
    suggested_value   TEXT,
    confidence        NUMERIC(3,2),
    rationale         TEXT,
    evidence_fact_ids UUID[],                   -- array of enriched_fact IDs
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / accepted / rejected / deferred
    reviewed_by       UUID,
    reviewed_at       TIMESTAMPTZ,
    review_notes      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suggestions_status ON suggestions (status);
CREATE INDEX idx_suggestions_target ON suggestions (target);
CREATE INDEX idx_suggestions_type   ON suggestions (suggestion_type);
```

### 1.8 `trade_ideas` -- Generated trade opportunities

```sql
CREATE TABLE trade_ideas (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target            VARCHAR(255),
    ticker            VARCHAR(10),
    idea_type         VARCHAR(50) NOT NULL,     -- 'spread_entry', 'spread_exit',
                                                -- 'options_trade', 'hedge', 'pair_trade'
    direction         VARCHAR(10),              -- 'long', 'short', 'neutral'
    rationale         TEXT,
    evidence_fact_ids UUID[],
    confidence        NUMERIC(3,2),
    entry_price       NUMERIC(10,4),
    target_price      NUMERIC(10,4),
    stop_price        NUMERIC(10,4),
    expected_return   NUMERIC(10,4),
    risk_reward       NUMERIC(10,4),
    expiry_date       DATE,                     -- when this idea expires
    status            VARCHAR(20) NOT NULL DEFAULT 'active',  -- active / expired / executed / cancelled
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trade_ideas_status ON trade_ideas (status);
CREATE INDEX idx_trade_ideas_target ON trade_ideas (target);
CREATE INDEX idx_trade_ideas_ticker ON trade_ideas (ticker);
```

### 1.9 `spread_observations` -- Time-series spread data for intraday monitoring

High-frequency price observations keyed by ticker and timestamp.

```sql
CREATE TABLE spread_observations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target            VARCHAR(255),
    ticker            VARCHAR(10) NOT NULL,
    observation_time  TIMESTAMPTZ NOT NULL,
    target_price      NUMERIC(10,4),
    acquiror_price    NUMERIC(10,4),            -- for stock-component deals
    deal_price        NUMERIC(10,4),
    gross_spread      NUMERIC(10,6),            -- (deal_price - target_price) / target_price
    net_spread        NUMERIC(10,6),
    days_to_close     INT,
    annualized_spread NUMERIC(10,6),
    source            VARCHAR(20) NOT NULL DEFAULT 'polygon'  -- polygon / ib
);

CREATE INDEX idx_spread_obs_ticker_time ON spread_observations (ticker, observation_time DESC);
CREATE INDEX idx_spread_obs_target      ON spread_observations (target);
CREATE INDEX idx_spread_obs_time        ON spread_observations (observation_time DESC);
```

### 1.10 `portfolio_alerts` -- Alert configuration and history

Extends the existing `alert_notifications` concept with richer trigger
conditions and acknowledgment tracking.

```sql
CREATE TABLE portfolio_alerts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target            VARCHAR(255),
    ticker            VARCHAR(10),
    alert_type        VARCHAR(50) NOT NULL,     -- 'spread_widen', 'spread_narrow',
                                                -- 'price_drop', 'volume_spike',
                                                -- 'options_unusual', 'new_filing',
                                                -- 'validation_error'
    trigger_condition JSONB,                    -- {"field": "gross_spread", "operator": ">", "value": 0.05}
    message           TEXT,
    severity          VARCHAR(20) NOT NULL,     -- 'critical', 'warning', 'info'
    triggered_at      TIMESTAMPTZ NOT NULL,
    acknowledged_at   TIMESTAMPTZ,
    acknowledged_by   UUID,
    suppressed_until  TIMESTAMPTZ
);

CREATE INDEX idx_portfolio_alerts_ticker    ON portfolio_alerts (ticker);
CREATE INDEX idx_portfolio_alerts_type      ON portfolio_alerts (alert_type);
CREATE INDEX idx_portfolio_alerts_triggered ON portfolio_alerts (triggered_at DESC);
CREATE INDEX idx_portfolio_alerts_severity  ON portfolio_alerts (severity);
```

### 1.11 `alert_settings` -- Per-deal alert configuration

```sql
CREATE TABLE alert_settings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL,            -- FK to users
    target            VARCHAR(255),             -- NULL = global default
    ticker            VARCHAR(10),
    alert_type        VARCHAR(50) NOT NULL,
    enabled           BOOLEAN NOT NULL DEFAULT true,
    threshold         JSONB,                    -- configurable per alert type
    cooldown_minutes  INT NOT NULL DEFAULT 30,
    channels          VARCHAR(50)[] NOT NULL DEFAULT '{dashboard}',  -- dashboard / email
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_alert_settings UNIQUE (user_id, target, alert_type)
);

CREATE INDEX idx_alert_settings_user ON alert_settings (user_id);
```

---

## 2. Example Queries

### 2.1 Latest snapshot for each tab

```sql
SELECT DISTINCT ON (tab_name)
       id, snapshot_date, tab_name, tab_gid, row_count, status
  FROM sheet_snapshots
 WHERE status = 'complete'
 ORDER BY tab_name, snapshot_date DESC;
```

### 2.2 All rows for the latest snapshot with computed spreads

```sql
WITH latest AS (
    SELECT DISTINCT ON (tab_name)
           id
      FROM sheet_snapshots
     WHERE status = 'complete'
     ORDER BY tab_name, snapshot_date DESC
)
SELECT r.target,
       r.acquiror,
       r.deal_price,
       r.current_price,
       r.category,
       r.investable,
       r.vote_risk,
       r.finance_risk,
       r.legal_risk,
       CASE WHEN r.deal_price > 0 AND r.current_price > 0
            THEN ROUND((r.deal_price - r.current_price) / r.current_price, 6)
            ELSE NULL
       END AS computed_gross_spread,
       r.gross_yield,
       r.current_yield,
       r.deal_notes,
       r.cvr
  FROM sheet_rows r
  JOIN latest l ON r.snapshot_id = l.id
 ORDER BY r.target;
```

### 2.3 Diff between today and yesterday

```sql
SELECT d.target,
       d.diff_type,
       d.changed_fields,
       d.created_at
  FROM sheet_diffs d
  JOIN sheet_snapshots s ON d.snapshot_id = s.id
 WHERE s.snapshot_date = CURRENT_DATE
 ORDER BY d.diff_type, d.target;
```

### 2.4 Open validation issues sorted by severity

```sql
SELECT vi.target,
       vi.severity,
       vi.rule_name,
       vi.message,
       vi.field_name,
       vi.expected_value,
       vi.actual_value,
       vi.created_at
  FROM validation_issues vi
  JOIN sheet_snapshots s ON vi.snapshot_id = s.id
 WHERE vi.status = 'open'
 ORDER BY
       CASE vi.severity
           WHEN 'error'   THEN 1
           WHEN 'warning' THEN 2
           WHEN 'info'    THEN 3
       END,
       vi.created_at DESC;
```

### 2.5 Enrichment timeline for a specific deal

```sql
SELECT ef.fact_type,
       ef.fact_value,
       ef.confidence,
       ef.extraction_method,
       ef.extracted_at,
       sd.source_type,
       sd.title,
       sd.url,
       sd.published_at
  FROM enriched_facts ef
  LEFT JOIN source_documents sd ON ef.source_document_id = sd.id
 WHERE ef.target = $1             -- parameter: target name
   AND ef.superseded_by IS NULL   -- only current facts
 ORDER BY ef.extracted_at DESC;
```

### 2.6 Pending suggestions with evidence

```sql
SELECT s.target,
       s.suggestion_type,
       s.field_name,
       s.current_value,
       s.suggested_value,
       s.confidence,
       s.rationale,
       s.created_at,
       COALESCE(
           json_agg(
               json_build_object(
                   'fact_type', ef.fact_type,
                   'fact_value', ef.fact_value,
                   'source_url', sd.url,
                   'source_title', sd.title
               )
           ) FILTER (WHERE ef.id IS NOT NULL),
           '[]'::json
       ) AS evidence
  FROM suggestions s
  LEFT JOIN enriched_facts ef ON ef.id = ANY(s.evidence_fact_ids)
  LEFT JOIN source_documents sd ON ef.source_document_id = sd.id
 WHERE s.status = 'pending'
 GROUP BY s.id
 ORDER BY s.confidence DESC, s.created_at;
```

### 2.7 Active trade ideas

```sql
SELECT ti.target,
       ti.ticker,
       ti.idea_type,
       ti.direction,
       ti.rationale,
       ti.confidence,
       ti.entry_price,
       ti.target_price,
       ti.stop_price,
       ti.expected_return,
       ti.risk_reward,
       ti.expiry_date,
       ti.created_at
  FROM trade_ideas ti
 WHERE ti.status = 'active'
   AND (ti.expiry_date IS NULL OR ti.expiry_date >= CURRENT_DATE)
 ORDER BY ti.confidence DESC, ti.created_at DESC;
```

### 2.8 Spread time-series for intraday chart

```sql
SELECT observation_time,
       target_price,
       acquiror_price,
       deal_price,
       gross_spread,
       annualized_spread,
       source
  FROM spread_observations
 WHERE ticker = $1                               -- parameter: ticker
   AND observation_time >= $2                    -- parameter: start timestamp
   AND observation_time <= $3                    -- parameter: end timestamp
 ORDER BY observation_time ASC;
```

### 2.9 Alert history for a deal

```sql
SELECT pa.alert_type,
       pa.severity,
       pa.message,
       pa.trigger_condition,
       pa.triggered_at,
       pa.acknowledged_at
  FROM portfolio_alerts pa
 WHERE pa.ticker = $1               -- parameter: ticker
 ORDER BY pa.triggered_at DESC
 LIMIT 50;
```

### 2.10 Alert settings for a user

```sql
SELECT als.target,
       als.ticker,
       als.alert_type,
       als.enabled,
       als.threshold,
       als.cooldown_minutes,
       als.channels
  FROM alert_settings als
 WHERE als.user_id = $1             -- parameter: user_id
 ORDER BY als.target NULLS FIRST, als.alert_type;
```

### 2.11 Dashboard summary: deal count, issue count, suggestion count, alert count

```sql
WITH latest_snapshot AS (
    SELECT DISTINCT ON (tab_name) id
      FROM sheet_snapshots
     WHERE status = 'complete'
     ORDER BY tab_name, snapshot_date DESC
)
SELECT
    (SELECT COUNT(DISTINCT r.target)
       FROM sheet_rows r
       JOIN latest_snapshot ls ON r.snapshot_id = ls.id)              AS deal_count,

    (SELECT COUNT(*)
       FROM validation_issues vi
      WHERE vi.status = 'open')                                       AS open_issue_count,

    (SELECT COUNT(*)
       FROM suggestions s
      WHERE s.status = 'pending')                                     AS pending_suggestion_count,

    (SELECT COUNT(*)
       FROM portfolio_alerts pa
      WHERE pa.acknowledged_at IS NULL
        AND pa.triggered_at >= NOW() - INTERVAL '24 hours')           AS unack_alert_count_24h,

    (SELECT COUNT(*)
       FROM trade_ideas ti
      WHERE ti.status = 'active'
        AND (ti.expiry_date IS NULL OR ti.expiry_date >= CURRENT_DATE)) AS active_trade_ideas,

    (SELECT COUNT(*)
       FROM sheet_diffs d
       JOIN sheet_snapshots s ON d.snapshot_id = s.id
      WHERE s.snapshot_date = CURRENT_DATE)                            AS changes_today;
```

---

## 3. Evidence Storage Design

The evidence chain follows a three-layer model:

```
suggestions / trade_ideas
        |
        | evidence_fact_ids UUID[]
        v
  enriched_facts
        |
        | source_document_id UUID FK
        v
  source_documents
        |
        +-- url              (canonical link)
        +-- accession_number (EDGAR filings)
        +-- content_snippet  (first 2000 chars or relevant excerpt)
        +-- published_at     (original publication timestamp)
        +-- fetched_at       (when we retrieved it)
```

### Evidence chain walkthrough

1. **Source Document** is fetched and stored with its URL, accession number
   (for EDGAR), filing type, title, and a content snippet. The `url` column
   has a unique constraint so we never store the same document twice.

2. **Enriched Fact** is extracted from a source document (either by Claude AI,
   a rule-based parser, or a headline parser). Each fact records:
   - What it is (`fact_type` + `fact_value`)
   - How confident we are (`confidence`)
   - Where it came from (`source_document_id`)
   - How it was extracted (`extraction_method`)
   - Whether it has been superseded by a newer fact (`superseded_by`)

3. **Suggestion / Trade Idea** references one or more enriched facts via the
   `evidence_fact_ids` UUID array. The UI can join through to source documents
   to show clickable links:

```sql
-- Full evidence chain for a suggestion
SELECT s.suggested_value,
       s.rationale,
       ef.fact_type,
       ef.fact_value,
       ef.confidence       AS fact_confidence,
       ef.extraction_method,
       sd.source_type,
       sd.url,
       sd.accession_number,
       sd.title,
       sd.published_at,
       sd.content_snippet
  FROM suggestions s
  CROSS JOIN LATERAL unnest(s.evidence_fact_ids) AS fact_id
  JOIN enriched_facts ef ON ef.id = fact_id
  LEFT JOIN source_documents sd ON ef.source_document_id = sd.id
 WHERE s.id = $1;
```

### Supersession

When a newer filing or article updates a previously extracted fact, we:
1. Insert a new `enriched_facts` row with the updated value.
2. Set `superseded_by` on the old row to point to the new row.
3. Queries filter on `superseded_by IS NULL` to show only current facts.

This preserves the full history of extracted facts while always surfacing the
most recent information.

---

## 4. Snapshot and Diff Storage Strategy

### 4.1 Full-copy snapshots

Each daily ingest creates a complete copy of every row in `sheet_rows`. This
"snapshot-per-day" model is chosen over a change-only model because:

- The Google Sheet is the source of truth; any field can change without notice.
- Full copies allow point-in-time reconstruction of the sheet on any date.
- Reconciliation queries can compare any two snapshots without complex logic.

### 4.2 Storage estimates

| Metric                        | Estimate                              |
|-------------------------------|---------------------------------------|
| Deals per tab (avg)           | ~50                                   |
| Tabs                          | 6                                     |
| Rows per day                  | ~300 (50 x 6)                         |
| Days per year                 | ~260 (trading days)                   |
| Rows per year in `sheet_rows` | ~78,000                               |
| Avg row size (with JSONB)     | ~2 KB                                 |
| Annual storage for rows       | ~156 MB                               |
| Diff rows per day (avg)       | ~15 (5% of deals change daily)        |
| Diff rows per year            | ~3,900                                |
| Annual storage for diffs      | ~4 MB                                 |

Total annual storage for snapshots + diffs is well under 200 MB -- trivial for
PostgreSQL / Neon Cloud.

### 4.3 Diff computation

Diffs are computed at ingest time by comparing the current snapshot to the
previous snapshot for the same tab:

1. **Added**: target appears in today but not in yesterday.
2. **Removed**: target appears in yesterday but not in today.
3. **Modified**: target appears in both; compare all typed fields. Any
   difference is recorded in `changed_fields` as JSONB:
   ```json
   {
     "deal_price": {"old": "45.50", "new": "46.00"},
     "vote_risk": {"old": "Low", "new": "Medium"}
   }
   ```

Matching is done on the `target` column (company name). If target names are
inconsistent across snapshots, the ingest pipeline should normalize them
before diffing.

### 4.4 Retention policy

| Table                 | Retention                                        |
|-----------------------|--------------------------------------------------|
| `sheet_snapshots`     | Indefinite (lightweight metadata)                |
| `sheet_rows`          | 2 years rolling; archive older rows to cold store|
| `sheet_diffs`         | Indefinite (very small volume)                   |
| `validation_issues`   | Indefinite (audit trail)                         |
| `enriched_facts`      | Indefinite (knowledge base)                      |
| `source_documents`    | Indefinite (document registry)                   |
| `suggestions`         | 1 year after resolution                          |
| `trade_ideas`         | 1 year after expiry/cancellation                 |
| `spread_observations` | 1 year rolling; downsample older to hourly       |
| `portfolio_alerts`    | 1 year rolling                                   |
| `alert_settings`      | Indefinite (active config)                       |

For `spread_observations`, the highest-volume table, a background job can
downsample observations older than 90 days from per-minute to hourly
aggregates, reducing long-term storage by ~60x.

### 4.5 Migration numbering

These tables should be created in two migration files following the existing
pattern:

- `024_sheet_ingest_tables.sql` -- `sheet_snapshots`, `sheet_rows`,
  `sheet_diffs`, `validation_issues`
- `025_enrichment_and_alerts.sql` -- `source_documents`, `enriched_facts`,
  `suggestions`, `trade_ideas`, `spread_observations`, `portfolio_alerts`,
  `alert_settings`
