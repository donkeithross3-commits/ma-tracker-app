# Historical M&A Research Database & Higher-Bid Dynamics Study

## Implementation Plan for the Deal Intelligence Agent Team

**Date:** 2026-03-17
**Author:** Deal Intelligence Agent (Opus)
**Status:** Ready for implementation
**Scope:** 10-year historical research database + first empirical study

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Research-Universe Definition](#2-research-universe-definition)
3. [Data Architecture](#3-data-architecture)
4. [Event Taxonomy](#4-event-taxonomy)
5. [Filing Extraction Framework](#5-filing-extraction-framework)
6. [Market Data Framework](#6-market-data-framework)
7. [Feature Library](#7-feature-library)
8. [First-Study Design: Higher-Bid Dynamics](#8-first-study-design-higher-bid-dynamics)
9. [Backtesting / Research Methodology](#9-backtesting--research-methodology)
10. [Data Quality / QA Plan](#10-data-quality--qa-plan)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Highest-Value Shortcuts](#12-highest-value-shortcuts)
13. [Appendices](#13-appendices)

---

## 1. Executive Summary

### What we are building

A 10-year institutional-grade historical research database of U.S.-listed acquisition deals, integrated with our existing live deal-monitoring platform at dr3-dashboard.com. This database will capture approximately 3,000-4,000 formally announced acquisitions of U.S.-listed public targets from 2016 through 2026, including their complete lifecycle events, deal-protection clause details, regulatory milestones, market data, and outcomes.

### Why it matters

Merger arbitrage is one of the few strategy families where the underlying events are discrete, documentable, and public-record. Yet most participants rely on anecdotal pattern matching or expensive third-party databases (SDC Platinum, Bloomberg MA<GO>) that they cannot customize or interrogate programmatically. By building our own research-grade database directly from primary sources (SEC EDGAR filings, Polygon market data), we create:

1. **A proprietary research asset** — we can ask questions no one else can ask, because no one else has structured the data this way
2. **A living database** — new deals automatically flow in from our existing EDGAR monitor, so the research database grows daily
3. **A backtesting platform** — every feature we compute for live deals can be backtested against 10 years of history
4. **A training corpus** — for improving our AI risk assessment prompts with calibrated historical outcomes

### The first study: higher-bid dynamics

Our immediate research question: **What patterns predict whether an announced acquisition will receive a higher bid, and does the market price this correctly?**

This question matters because the "higher-bid optionality" embedded in merger targets is one of the most discussed but least rigorously quantified edges in merger arbitrage. Specifically:

- **Go-shop provisions** were once thought to generate 12.5% jump rates (Subramanian 2008, N=48 PE deals), but recent evidence shows a steep decline: 6.1% (2010-19) and 4.3% (2015-19) per Subramanian & Zhao 2020 (Harvard Law Review Vol. 133)
- **Base competing bid rate** is ~5% for public competing bids (Betton, Eckbo, Thorburn 2008, N=35,000+), though ~50% of targets are auctioned privately pre-public (Boone & Mulherin 2007)
- **Increased considerations** (bid bumps) ran at ~5% historically but dropped to 1% in 2023 (AlphaRank)
- **Termination fees** may NOT deter competing bids — Officer (2003, JFE) found deals WITH fees have higher premiums and completion rates
- **Options markets** contain predictive content beyond stock prices alone for deal outcomes (Van Tassel 2016, NY Fed; Bester/Martinez/Rosu 2023, JFEC)
- **The critical gap in the literature:** No published model specifically predicts COMPETING BIDS. All existing ML/statistical work (78-79% accuracy) predicts deal completion or target identification. **Predicting topping bids is a novel contribution.**

We want the data to tell us what is true. Not to confirm a thesis.

### System design philosophy

The historical research database is a **separate schema namespace** (`research.*`) that lives in our existing Neon PostgreSQL database alongside the production tables. It shares the same connection pool but uses different table prefixes to maintain clean separation. The research tables are optimized for analytical queries (wide rows, materialized views, point-in-time reconstruction) rather than the transactional patterns of the production system.

The key architectural decision: **the research database is built FROM primary sources, not copied from third-party databases.** Every fact traces back to an SEC filing accession number or a Polygon data timestamp. This makes the database auditable, reproducible, and extensible.

---

## 2. Research-Universe Definition

### Inclusion criteria (all must be met)

| Criterion | Rule | Rationale |
|-----------|------|-----------|
| **Target** | U.S.-listed public company (common stock traded on NYSE, NASDAQ, or NYSE American) | Ensures EDGAR filings exist and market data is available |
| **Announcement** | Formally announced via SEC filing (8-K Item 1.01, SC TO-T, DEFM14A, or equivalent) | Filters out rumors and LOIs |
| **Date range** | Announcement date between 2016-01-01 and present | ~10 years; aligns with Polygon options data availability (~2019) |
| **Transaction type** | Acquisition of control (>50% of voting shares) | Excludes minority investments, partial tenders, open-market programs |
| **Consideration** | Cash, stock, mixed, or CVR-enhanced | All consideration types included |
| **Deal value** | Total equity value >= $50M at announcement | Excludes micro-cap noise; ensures meaningful options liquidity |
| **Filing evidence** | At least one M&A-related SEC filing exists for the target CIK | Verifies the deal is real and documented |

### Exclusion criteria (any one excludes)

| Criterion | Rationale |
|-----------|-----------|
| SPAC business combinations (de-SPAC mergers) | Different dynamics — no "target" in the traditional sense |
| Mutual company conversions | Not public-company acquisitions |
| REstructuring/spin-off transactions misclassified as M&A | Different economics |
| Non-U.S. targets that happen to cross-list (e.g., dual-listed ADRs where primary listing is foreign) | EDGAR coverage may be incomplete; regulatory framework differs |
| Deals where the "acquirer" is actually a holding company already owning >50% (squeeze-out/going-private by existing controller) | No meaningful competing-bid dynamics |
| Announced deals with no SEC filing within 30 days of press announcement | Likely rumor or abandoned before formal process |

### Edge cases — include with flags

| Situation | Treatment |
|-----------|-----------|
| Management buyouts (MBOs) | Include; flag `is_mbo = true` |
| PE-backed take-privates | Include; flag `buyer_type = 'financial_sponsor'` |
| Hostile/unsolicited offers | Include; flag `is_hostile = true` |
| Mergers of equals | Include if one party is clearly the acquirer; exclude true 50/50 structures |
| Deals that convert between merger and tender offer | Include as single deal with `structure_changed` event |
| Deals with CVRs | Include; flag `has_cvr = true`; CVR details in `deal_consideration` |
| Club deals (consortium buyers) | Include; primary buyer in `acquirer_name`; consortium in `acquirer_group` JSONB |

### Expected universe size

Based on SEC filing volumes for M&A-related form types (SC TO-T, DEFM14A, PREM14A) and the $50M threshold:

| Year range | Estimated deals/year | Total |
|-----------|---------------------|-------|
| 2016-2019 | 250-350 | ~1,200 |
| 2020-2021 | 200-300 (COVID dip + recovery) | ~500 |
| 2022-2024 | 250-400 (rate cycle) | ~900 |
| 2025-2026 | 300-400 (current cycle) | ~600 |
| **Total** | | **~3,200** |

---

## 3. Data Architecture

### Schema namespace

All research tables use the `research_` prefix to avoid collision with production tables. They live in the same Neon PostgreSQL database.

### Entity-relationship overview

```
research_deals (1)
  ├── research_deal_events (N)         -- lifecycle events
  ├── research_deal_clauses (1)        -- deal protection terms
  ├── research_deal_consideration (N)  -- price/terms (versioned)
  ├── research_deal_filings (N)        -- linked SEC filings
  ├── research_deal_parties (N)        -- buyers, targets, advisors
  ├── research_deal_regulatory (N)     -- regulatory milestones
  ├── research_market_daily (N)        -- daily stock data
  ├── research_options_daily (N)       -- daily options summary
  ├── research_options_chains (N)      -- event-window chain snapshots
  └── research_deal_outcomes (1)       -- final outcome + labels
```

### Core tables

#### `research_deals` — Master deal record

```sql
CREATE TABLE research_deals (
    deal_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_key            VARCHAR(30) NOT NULL UNIQUE,  -- e.g., "2024-ATVI-MSFT"

    -- Target identification
    target_ticker       VARCHAR(10) NOT NULL,
    target_name         TEXT NOT NULL,
    target_cik          VARCHAR(10),           -- SEC CIK (zero-padded 10-digit)
    target_sic          VARCHAR(4),            -- SIC industry code
    target_exchange     VARCHAR(10),           -- NYSE, NASDAQ, NYSE_AMER

    -- Acquirer identification
    acquirer_name       TEXT NOT NULL,
    acquirer_ticker     VARCHAR(10),           -- NULL for private acquirers
    acquirer_cik        VARCHAR(10),
    acquirer_type       VARCHAR(30) NOT NULL,  -- see enum below
    acquirer_group      JSONB,                 -- for consortium/club deals

    -- Deal classification
    deal_type           VARCHAR(30) NOT NULL,  -- see enum below
    deal_structure      VARCHAR(30) NOT NULL,  -- see enum below
    is_hostile          BOOLEAN DEFAULT FALSE,
    is_mbo              BOOLEAN DEFAULT FALSE,
    is_going_private    BOOLEAN DEFAULT FALSE,
    has_cvr             BOOLEAN DEFAULT FALSE,

    -- Key dates (point-in-time; may be revised via events)
    announced_date      DATE NOT NULL,
    signing_date        DATE,                  -- may differ from announced
    expected_close_date DATE,
    outside_date        DATE,
    actual_close_date   DATE,
    terminated_date     DATE,

    -- Final status
    outcome             VARCHAR(20) NOT NULL DEFAULT 'pending',  -- see enum below
    outcome_reason      TEXT,                  -- why it closed/broke/was amended

    -- Value metrics (at announcement)
    initial_deal_value_mm   NUMERIC(15,2),     -- total equity value at announcement
    initial_premium_1d_pct  NUMERIC(6,2),      -- premium to prior day close
    initial_premium_30d_pct NUMERIC(6,2),      -- premium to 30-day VWAP

    -- Data completeness tracking
    has_merger_agreement    BOOLEAN DEFAULT FALSE,
    has_proxy_statement     BOOLEAN DEFAULT FALSE,
    has_tender_offer        BOOLEAN DEFAULT FALSE,
    clause_extraction_status VARCHAR(20) DEFAULT 'pending',  -- pending/partial/complete/failed
    market_data_status      VARCHAR(20) DEFAULT 'pending',

    -- Provenance
    discovery_source    VARCHAR(30),           -- edgar_efts, edgar_index, manual, production_sync
    discovery_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_enriched       TIMESTAMPTZ,

    -- Cross-reference to production system
    production_deal_id  UUID,                  -- FK to deal_intelligence.deal_id if exists
    canonical_deal_id   UUID,                  -- FK to canonical_deals.id if exists

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_research_deals_ticker ON research_deals(target_ticker);
CREATE INDEX idx_research_deals_announced ON research_deals(announced_date DESC);
CREATE INDEX idx_research_deals_outcome ON research_deals(outcome);
CREATE INDEX idx_research_deals_type ON research_deals(deal_type, deal_structure);
CREATE INDEX idx_research_deals_cik ON research_deals(target_cik);
```

**Enum values:**

```sql
-- acquirer_type
CHECK (acquirer_type IN (
    'strategic_public',      -- public company acquirer
    'strategic_private',     -- private company acquirer
    'financial_sponsor',     -- PE fund / financial buyer
    'consortium',            -- multiple buyers (club deal)
    'management',            -- MBO
    'government',            -- sovereign / government entity
    'spac',                  -- included but flagged separately
    'other'
))

-- deal_type
CHECK (deal_type IN (
    'merger',               -- one-step merger
    'tender_offer',         -- two-step: tender + back-end merger
    'tender_only',          -- tender offer (no back-end)
    'asset_acquisition',    -- included only if substantially all assets
    'scheme',               -- scheme of arrangement (rare for US)
    'other'
))

-- deal_structure
CHECK (deal_structure IN (
    'all_cash',
    'all_stock',
    'cash_and_stock',
    'cash_and_cvr',
    'stock_and_cvr',
    'cash_stock_cvr',
    'election',             -- shareholder can elect cash or stock
    'other'
))

-- outcome
CHECK (outcome IN (
    'pending',              -- still active
    'closed',               -- completed as announced
    'closed_amended',       -- completed but terms changed
    'closed_higher_bid',    -- completed after a competing/higher bid
    'terminated_mutual',    -- terminated by mutual consent
    'terminated_target',    -- target walked away
    'terminated_acquirer',  -- acquirer walked away
    'terminated_regulatory',-- blocked by regulators
    'terminated_vote',      -- shareholders voted it down
    'terminated_litigation',-- blocked by court/litigation
    'terminated_financing', -- acquirer couldn't finance
    'terminated_other',
    'withdrawn'             -- offer withdrawn before any formal process
))
```

#### `research_deal_clauses` — Deal protection terms

This is the single most important table for the higher-bid study. One row per deal, capturing the full protection architecture.

```sql
CREATE TABLE research_deal_clauses (
    deal_id                 UUID PRIMARY KEY REFERENCES research_deals(deal_id),

    -- Go-shop / No-shop
    has_go_shop             BOOLEAN,
    go_shop_period_days     INTEGER,           -- calendar days
    go_shop_start_date      DATE,
    go_shop_end_date        DATE,
    go_shop_bidder_emerged  BOOLEAN,           -- did anyone appear during go-shop?
    post_go_shop_match      BOOLEAN,           -- do match rights apply post-go-shop?

    -- No-shop details (when no go-shop)
    no_shop_strength        VARCHAR(20),       -- standard, strong, weak
    fiduciary_out           BOOLEAN,           -- can board change recommendation?
    fiduciary_out_type      VARCHAR(30),       -- superior_proposal_only, intervening_event, both
    superior_proposal_def   TEXT,              -- extracted definition (abbreviated)
    window_shop_allowed     BOOLEAN,           -- passive: can respond to unsolicited?

    -- Match rights
    has_match_right         BOOLEAN,
    match_right_days        INTEGER,           -- days acquirer has to match
    match_right_rounds      INTEGER,           -- how many rounds of matching
    match_right_type        VARCHAR(30),       -- initial_only, unlimited, none

    -- Termination fees
    target_termination_fee_mm    NUMERIC(12,2),
    target_termination_fee_pct   NUMERIC(5,2),  -- as % of deal value
    acquirer_termination_fee_mm  NUMERIC(12,2), -- reverse termination fee
    acquirer_termination_fee_pct NUMERIC(5,2),
    two_tier_fee                 BOOLEAN,       -- lower fee during go-shop?
    go_shop_fee_mm               NUMERIC(12,2),
    go_shop_fee_pct              NUMERIC(5,2),

    -- Force-the-vote
    force_the_vote          BOOLEAN,           -- must hold vote even if board changes rec?

    -- Financing conditions
    has_financing_condition BOOLEAN,           -- is closing conditioned on financing?
    financing_committed     BOOLEAN,           -- are commitment letters filed?
    financing_sources       TEXT[],            -- 'committed_debt', 'cash_on_hand', etc.

    -- Regulatory conditions
    requires_hsr            BOOLEAN,
    requires_cfius          BOOLEAN,
    requires_eu_merger      BOOLEAN,
    requires_other_regulatory TEXT[],          -- sector-specific (FCC, state insurance, etc.)
    regulatory_complexity   VARCHAR(20),       -- low, medium, high, extreme

    -- MAC clause
    mac_exclusion_breadth   VARCHAR(20),       -- narrow, standard, broad
    pandemic_carveout       BOOLEAN,           -- post-2020 relevance
    industry_carveout       BOOLEAN,

    -- Collar provisions (stock deals)
    has_collar              BOOLEAN,
    collar_type             VARCHAR(20),       -- fixed_ratio, floating, symmetric, asymmetric
    collar_floor            NUMERIC(12,4),
    collar_ceiling          NUMERIC(12,4),
    walk_away_right         BOOLEAN,           -- can either party walk if collar breached?

    -- Extraction metadata
    extraction_method       VARCHAR(30),       -- llm_claude, regex, manual, hybrid
    extraction_confidence   NUMERIC(3,2),      -- 0.00 to 1.00
    extraction_source       TEXT,              -- filing accession number
    manually_verified       BOOLEAN DEFAULT FALSE,
    verified_by             VARCHAR(100),
    verified_at             TIMESTAMPTZ,
    verification_notes      TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `research_deal_events` — Lifecycle event log

Event-sourced: every meaningful thing that happens to a deal gets a row.

```sql
CREATE TABLE research_deal_events (
    event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),

    event_type          VARCHAR(50) NOT NULL,  -- see taxonomy in Section 4
    event_subtype       VARCHAR(50),
    event_date          DATE NOT NULL,
    event_time          TIME,                  -- when available (e.g., halt times)
    event_timestamp     TIMESTAMPTZ,           -- precise timestamp when known

    -- Event details
    summary             TEXT NOT NULL,          -- human-readable description
    details             JSONB,                 -- structured event-specific data

    -- Price/value changes (when applicable)
    new_price           NUMERIC(12,4),         -- new offer price (if changed)
    old_price           NUMERIC(12,4),
    new_premium_pct     NUMERIC(6,2),
    price_change_pct    NUMERIC(6,2),

    -- Source attribution
    source_type         VARCHAR(30) NOT NULL,  -- filing, news, halt, manual, derived
    source_filing_accession VARCHAR(25),        -- SEC accession number
    source_url          TEXT,
    source_text         TEXT,                  -- relevant excerpt (<=1000 chars)

    -- Competing bid tracking
    competing_bidder    TEXT,                   -- name of competing bidder (if applicable)
    is_competing_bid    BOOLEAN DEFAULT FALSE,

    -- Ordering
    event_sequence      INTEGER,               -- ordering within same date
    supersedes_event_id UUID,                  -- if this event amends a prior event

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_events_deal ON research_deal_events(deal_id, event_date);
CREATE INDEX idx_research_events_type ON research_deal_events(event_type, event_date);
CREATE INDEX idx_research_events_competing ON research_deal_events(deal_id)
    WHERE is_competing_bid = TRUE;
```

#### `research_deal_consideration` — Versioned price/terms

Each amendment or topping bid creates a new row. The latest row is the current terms.

```sql
CREATE TABLE research_deal_consideration (
    consideration_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),
    version             INTEGER NOT NULL DEFAULT 1,

    -- Who is offering?
    bidder_name         TEXT NOT NULL,
    is_original_bidder  BOOLEAN DEFAULT TRUE,
    is_topping_bid      BOOLEAN DEFAULT FALSE,

    -- Terms
    cash_per_share      NUMERIC(12,4),
    stock_ratio         NUMERIC(12,6),        -- exchange ratio (stock deals)
    stock_reference     VARCHAR(10),           -- ticker of stock being offered
    mixed_cash_pct      NUMERIC(5,2),          -- % of consideration in cash
    cvr_value_est       NUMERIC(12,4),         -- estimated CVR value
    total_per_share     NUMERIC(12,4),         -- total blended per-share value
    total_deal_value_mm NUMERIC(15,2),

    -- Premium
    premium_to_prior_close  NUMERIC(6,2),
    premium_to_30d_avg      NUMERIC(6,2),
    premium_to_prior_bid    NUMERIC(6,2),      -- premium vs previous bid (topping bids)

    -- Effective dates
    effective_date      DATE NOT NULL,
    announced_date      DATE NOT NULL,
    source_event_id     UUID REFERENCES research_deal_events(event_id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(deal_id, version)
);
```

#### `research_deal_filings` — SEC filing links

```sql
CREATE TABLE research_deal_filings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),

    -- Filing identification
    accession_number    VARCHAR(25) NOT NULL UNIQUE,
    filing_type         VARCHAR(20) NOT NULL,  -- 8-K, DEFM14A, SC TO-T, etc.
    filing_date         DATE NOT NULL,
    filed_by_cik        VARCHAR(10),
    filed_by_name       TEXT,
    filed_by_role       VARCHAR(20),           -- target, acquirer, third_party

    -- Content
    filing_url          TEXT,
    primary_doc_url     TEXT,
    filing_description  TEXT,

    -- What we extracted from it
    extracted_fields    TEXT[],                 -- which clause/event fields came from this
    extraction_status   VARCHAR(20) DEFAULT 'pending',  -- pending, extracted, failed, skipped
    extraction_notes    TEXT,

    -- Classification
    is_merger_agreement BOOLEAN DEFAULT FALSE,
    is_amendment        BOOLEAN DEFAULT FALSE,
    is_supplement       BOOLEAN DEFAULT FALSE,
    amendment_number    INTEGER,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_filings_deal ON research_deal_filings(deal_id, filing_date);
CREATE INDEX idx_research_filings_type ON research_deal_filings(filing_type);
CREATE INDEX idx_research_filings_accession ON research_deal_filings(accession_number);
```

#### `research_market_daily` — Daily stock data

```sql
CREATE TABLE research_market_daily (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),
    ticker              VARCHAR(10) NOT NULL,
    trade_date          DATE NOT NULL,

    -- OHLCV
    open                NUMERIC(12,4),
    high                NUMERIC(12,4),
    low                 NUMERIC(12,4),
    close               NUMERIC(12,4) NOT NULL,
    volume              BIGINT,
    vwap                NUMERIC(12,4),

    -- Computed spread metrics (relative to deal terms on this date)
    deal_price_on_date  NUMERIC(12,4),         -- the offer price as of this date
    gross_spread        NUMERIC(12,4),         -- deal_price - close
    gross_spread_pct    NUMERIC(8,4),          -- as percentage
    annualized_spread   NUMERIC(8,4),          -- annualized return to close

    -- Context
    days_since_announce INTEGER,
    days_to_expected_close INTEGER,
    sp500_close         NUMERIC(12,4),         -- for market-adjusted returns
    vix_close           NUMERIC(8,4),

    -- Data source
    source              VARCHAR(20) DEFAULT 'polygon',

    UNIQUE(deal_id, ticker, trade_date)
);

CREATE INDEX idx_research_market_deal_date ON research_market_daily(deal_id, trade_date);
CREATE INDEX idx_research_market_ticker ON research_market_daily(ticker, trade_date);
```

#### `research_options_daily` — Daily options summary per deal

One row per deal per day. Captures the key signals without storing raw chains.

```sql
CREATE TABLE research_options_daily (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),
    ticker              VARCHAR(10) NOT NULL,
    trade_date          DATE NOT NULL,

    -- Stock price context
    stock_close         NUMERIC(12,4),
    deal_price          NUMERIC(12,4),

    -- ATM implied volatility
    atm_call_iv         NUMERIC(8,4),
    atm_put_iv          NUMERIC(8,4),

    -- Skew metrics
    upside_call_iv      NUMERIC(8,4),          -- IV of call at deal price strike
    downside_put_iv     NUMERIC(8,4),          -- IV of put at break price strike
    call_skew_25d       NUMERIC(8,4),          -- 25-delta call IV - ATM IV
    put_skew_25d        NUMERIC(8,4),          -- 25-delta put IV - ATM IV
    skew_ratio          NUMERIC(8,4),          -- upside/downside IV ratio

    -- Volume and OI
    total_call_volume   INTEGER,
    total_put_volume    INTEGER,
    put_call_ratio      NUMERIC(8,4),
    total_call_oi       INTEGER,
    total_put_oi        INTEGER,

    -- Above-deal-price calls (higher-bid signal)
    above_deal_call_volume  INTEGER,           -- volume of calls with strike > deal price
    above_deal_call_oi      INTEGER,           -- OI of calls with strike > deal price
    above_deal_call_iv_avg  NUMERIC(8,4),      -- avg IV of those calls

    -- Term structure
    front_month_iv      NUMERIC(8,4),
    back_month_iv       NUMERIC(8,4),          -- nearest month after expected close
    term_structure_slope NUMERIC(8,4),         -- back - front

    -- Implied probabilities (computed features, not raw data)
    impl_prob_deal_close    NUMERIC(6,4),      -- from merger-arb spread model
    impl_prob_higher_bid    NUMERIC(6,4),      -- from above-deal call pricing

    -- Data quality
    chain_depth         INTEGER,               -- number of contracts in chain
    source              VARCHAR(20) DEFAULT 'polygon',

    UNIQUE(deal_id, ticker, trade_date)
);

CREATE INDEX idx_research_options_deal_date ON research_options_daily(deal_id, trade_date);
```

#### `research_options_chains` — Event-window chain snapshots

Full chain snapshots stored only around key events (announcement, topping bids, regulatory decisions). This is the expensive table — stored selectively, not daily.

```sql
CREATE TABLE research_options_chains (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id),
    ticker              VARCHAR(10) NOT NULL,
    snapshot_date       DATE NOT NULL,
    snapshot_reason     VARCHAR(30) NOT NULL,   -- announcement, topping_bid, regulatory, close, break, weekly

    -- Contract details
    contract_symbol     VARCHAR(30),            -- OCC symbol
    expiration_date     DATE NOT NULL,
    strike              NUMERIC(12,4) NOT NULL,
    option_type         CHAR(1) NOT NULL,       -- C or P

    -- Prices
    bid                 NUMERIC(10,4),
    ask                 NUMERIC(10,4),
    mid                 NUMERIC(10,4),
    last                NUMERIC(10,4),

    -- Greeks
    implied_vol         NUMERIC(8,4),
    delta               NUMERIC(8,4),
    gamma               NUMERIC(8,4),
    theta               NUMERIC(8,4),
    vega                NUMERIC(8,4),

    -- Activity
    volume              INTEGER,
    open_interest       INTEGER,

    -- Context
    underlying_close    NUMERIC(12,4),
    deal_price          NUMERIC(12,4),

    source              VARCHAR(20) DEFAULT 'polygon'
);

-- Partition hint: this table will be large. Consider partitioning by year.
CREATE INDEX idx_research_chains_deal_date ON research_options_chains(deal_id, snapshot_date);
CREATE INDEX idx_research_chains_ticker ON research_options_chains(ticker, snapshot_date);
CREATE INDEX idx_research_chains_reason ON research_options_chains(snapshot_reason);
```

#### `research_deal_outcomes` — Research labels

The final labeled outcome for each deal, computed after the deal concludes.

```sql
CREATE TABLE research_deal_outcomes (
    deal_id                 UUID PRIMARY KEY REFERENCES research_deals(deal_id),

    -- Primary labels
    received_higher_bid     BOOLEAN NOT NULL,    -- THE key label
    received_competing_bid  BOOLEAN NOT NULL,    -- includes bids that didn't win
    deal_completed          BOOLEAN NOT NULL,
    terms_amended           BOOLEAN NOT NULL,

    -- Higher-bid details (when applicable)
    num_competing_bids      INTEGER DEFAULT 0,
    winning_bidder_type     VARCHAR(30),         -- original, topping, white_knight
    final_price             NUMERIC(12,4),
    initial_price           NUMERIC(12,4),
    price_improvement_pct   NUMERIC(6,2),        -- (final - initial) / initial
    days_to_first_competing INTEGER,             -- days from announcement to first competing bid
    competing_bid_during_go_shop BOOLEAN,

    -- Outcome timing
    days_to_close           INTEGER,             -- announcement to close/termination
    close_date_vs_expected  INTEGER,             -- actual - expected (positive = delayed)

    -- Break details (when applicable)
    break_reason_primary    VARCHAR(50),          -- regulatory, vote, financing, mac, litigation, competing, mutual, other
    break_reason_secondary  VARCHAR(50),
    termination_fee_paid    BOOLEAN,
    termination_fee_amount  NUMERIC(12,2),
    fee_paid_by             VARCHAR(20),          -- target, acquirer

    -- Market impact labels
    announcement_return_1d  NUMERIC(8,4),        -- target return on announcement day
    announcement_return_5d  NUMERIC(8,4),
    spread_at_announcement  NUMERIC(8,4),        -- first post-announcement spread
    max_spread_during_deal  NUMERIC(8,4),
    min_spread_during_deal  NUMERIC(8,4),

    -- Returns for different strategies (computed after deal concludes)
    stock_return_announce_to_close  NUMERIC(8,4),
    stock_return_t1_to_close        NUMERIC(8,4),  -- from T+1 (post-announcement)
    excess_return_vs_sp500          NUMERIC(8,4),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Relationship to existing production tables

```
Production System                     Research System
─────────────────                     ──────────────
deal_intelligence ─ production_deal_id ── research_deals
canonical_deals ──── canonical_deal_id ── research_deals
deal_attributes ──── (enriches) ──────── research_deal_clauses
edgar_filings ────── (linked via) ────── research_deal_filings
deal_research ────── (informs) ───────── research_deal_events
```

**Sync strategy:** New deals that enter our production pipeline (via staged_deals → deal_intelligence) automatically get research_deals records created. Historical deals are backfilled from EDGAR independently.

---

## 4. Event Taxonomy

### Event type hierarchy

Every event in `research_deal_events` uses a two-level classification: `event_type` and `event_subtype`.

```
ANNOUNCEMENT
├── initial_announcement          -- first public announcement
├── formal_agreement              -- definitive agreement signed/filed
├── letter_of_intent              -- LOI or non-binding indication
└── hostile_approach              -- unsolicited/hostile bid

PRICE_CHANGE
├── price_increase                -- acquirer raises price
├── price_decrease                -- acquirer lowers price (rare)
├── consideration_change          -- structure change (cash→stock, etc.)
├── cvr_addition                  -- CVR added to deal
├── collar_adjustment             -- collar terms changed
├── topping_bid                   -- competing bidder offers more  *** KEY ***
├── matching_bid                  -- original acquirer matches competing bid
└── best_and_final                -- bidder declares best and final offer

COMPETING_BID
├── competing_bid_announced       -- new bidder formally enters
├── competing_bid_withdrawn       -- competing bidder drops out
├── competing_bid_increased       -- competing bidder raises their offer
├── bidding_war_round             -- another round in multi-bidder contest
└── white_knight                  -- friendly competing bidder invited by target

REGULATORY
├── hsr_filing                    -- HSR filing made
├── hsr_early_termination         -- HSR waiting period terminated early
├── hsr_second_request            -- second request issued (deep review)
├── hsr_clearance                 -- HSR cleared
├── doj_challenge                 -- DOJ files to block
├── ftc_challenge                 -- FTC files to block
├── cfius_filing                  -- CFIUS voluntary notice
├── cfius_clearance               -- CFIUS cleared
├── cfius_block                   -- CFIUS recommends/orders block
├── eu_phase1_clearance
├── eu_phase2_investigation
├── eu_clearance_conditions       -- approved with divestitures
├── state_regulatory              -- state-level approval
├── sector_regulatory             -- FCC, state insurance, banking, etc.
├── regulatory_remedy             -- divestiture or behavioral remedy proposed
└── regulatory_block              -- deal blocked by any regulator

SHAREHOLDER
├── proxy_filed                   -- preliminary proxy filed
├── definitive_proxy              -- definitive proxy filed
├── vote_scheduled                -- vote date announced
├── vote_adjourned                -- vote postponed
├── vote_approved                 -- shareholders approve
├── vote_rejected                 -- shareholders reject
├── recommendation_change         -- board changes its recommendation
├── dissident_campaign            -- activist opposes deal
└── appraisal_demand              -- significant appraisal demands filed

FINANCING
├── financing_committed           -- commitment letters filed/confirmed
├── financing_updated             -- terms of financing changed
├── financing_concern             -- public doubt about financing
└── financing_failed              -- financing fell through

LEGAL
├── litigation_filed              -- lawsuit challenging deal
├── preliminary_injunction        -- injunction sought
├── injunction_granted            -- court blocks deal
├── injunction_denied             -- court allows deal to proceed
├── litigation_settled            -- lawsuits settled
├── sec_review                    -- SEC comments on proxy/registration
└── sec_clearance                 -- SEC declares effective

GO_SHOP
├── go_shop_started               -- go-shop window opens
├── go_shop_inquiry               -- third party contacts during go-shop
├── go_shop_bidder_emerged        -- qualified bidder found in go-shop
├── go_shop_expired               -- go-shop window closed, no bidder
└── go_shop_extended              -- go-shop period extended

TIMELINE
├── expected_close_updated        -- expected close date changed
├── outside_date_extended         -- termination/outside date extended
├── closing_condition_waived      -- material condition waived
└── material_delay                -- material delay without date change

TERMINATION
├── mutual_termination            -- both parties agree to terminate
├── target_termination            -- target terminates (often for superior proposal)
├── acquirer_termination          -- acquirer walks away
├── regulatory_termination        -- terminated due to regulatory block
├── vote_failure_termination      -- terminated after vote fails
├── mac_termination               -- terminated under MAC clause
├── litigation_termination        -- terminated due to legal block
├── financing_termination         -- terminated due to financing failure
└── expiration                    -- tender offer or agreement expires

COMPLETION
├── closing                       -- deal closes
├── tender_offer_completed        -- tender offer accepted/completed
├── squeeze_out_merger            -- back-end merger after tender
├── effective_date                -- merger becomes effective
└── delisting                     -- target stock delisted/deregistered
```

### Event details JSONB structure (by event type)

```python
# PRICE_CHANGE events
{
    "old_price": 45.00,
    "new_price": 48.50,
    "change_pct": 7.78,
    "old_structure": "all_cash",
    "new_structure": "all_cash",
    "premium_to_undisturbed": 32.5  # premium to pre-announcement price
}

# COMPETING_BID events
{
    "bidder_name": "Rival Corp",
    "bidder_type": "strategic_public",
    "bid_price": 50.00,
    "premium_to_current_bid": 10.5,
    "bid_structure": "all_cash",
    "is_solicited": False,          # was this an unsolicited competing bid?
    "during_go_shop": True          # did this emerge during go-shop period?
}

# REGULATORY events
{
    "agency": "DOJ",
    "review_type": "second_request",
    "estimated_timeline_days": 90,
    "divestitures_required": ["Widget Division"],
    "countries_affected": ["US", "EU"]
}

# SHAREHOLDER VOTE events
{
    "vote_date": "2024-06-15",
    "votes_for_pct": 87.3,
    "votes_against_pct": 10.2,
    "votes_abstain_pct": 2.5,
    "quorum_met": True,
    "threshold_required": 50.0
}
```

---

## 5. Filing Extraction Framework

### Filing type priority matrix

| Filing Type | M&A Relevance | Fields Extractable | Extraction Method | Priority |
|-------------|---------------|-------------------|-------------------|----------|
| **Merger agreement (8-K Ex. 2.1)** | Critical | All clauses, terms, fees, conditions | LLM + regex | **P0** |
| **DEFM14A** (definitive proxy) | Critical | Vote details, fairness opinion, background, go-shop results | LLM + regex | **P0** |
| **SC TO-T** (tender offer) | Critical | Offer terms, conditions, financing | LLM + regex | **P0** |
| **SC 14D-9** (target response) | High | Board recommendation, reasons, fairness opinion | LLM + regex | **P1** |
| **PREM14A** (preliminary proxy) | High | Early terms, risk factors | LLM | **P1** |
| **8-K Item 1.01** | High | Announcement, terms summary | Regex + LLM | **P1** |
| **S-4/F-4** (registration stmt) | Medium | Stock deal terms, risk factors | LLM | **P2** |
| **SC 13D/A** | Medium | Activist positions, deal opposition | LLM | **P2** |
| **8-K Item 2.01** | Medium | Completion confirmation | Regex | **P2** |
| **DEFA14A** (additional proxy) | Low | Supplements, amendments | LLM | **P3** |
| **425** (prospectus comm.) | Low | Communications about deal | Skim | **P3** |

### Extraction architecture

```
Filing HTML/Text
    ↓
Phase 1: Section Extraction (regex — our existing filing_extractor.py)
    ↓ key sections identified and extracted
Phase 2: Clause Extraction (LLM — Claude Sonnet via CLI)
    ↓ structured JSON output with confidence scores
Phase 3: Cross-Validation (rule-based)
    ↓ consistency checks across filing types
Phase 4: Human Review Queue (for high-value/low-confidence extractions)
    ↓ manual verification of critical clauses
Phase 5: Storage (research_deal_clauses + research_deal_events)
```

### LLM extraction prompt design

**Key lesson from our existing risk assessment prompts:** give the model a JOB, not a topic. The extraction prompt must produce a JSON schema with required fields — not prose.

```python
CLAUSE_EXTRACTION_SYSTEM_PROMPT = """You are an M&A clause extraction specialist.
Your job is to extract specific deal protection terms from SEC filing text.

You MUST return valid JSON matching the schema below.
If a field is not found in the text, use null — never guess.
If a field is ambiguous, set the confidence to < 0.5 and explain in the notes field.

Output schema:
{
    "go_shop": {
        "has_go_shop": bool | null,
        "period_days": int | null,
        "end_date": "YYYY-MM-DD" | null,
        "reduced_termination_fee_during_go_shop": bool | null,
        "go_shop_fee_pct": float | null,
        "confidence": float  // 0.0 to 1.0
    },
    "no_shop": {
        "has_no_shop": bool | null,
        "fiduciary_out": bool | null,
        "fiduciary_out_type": "superior_proposal_only" | "intervening_event" | "both" | null,
        "window_shop": bool | null,
        "confidence": float
    },
    "match_rights": {
        "has_match_right": bool | null,
        "match_period_days": int | null,
        "match_rounds": int | null,
        "confidence": float
    },
    "termination_fees": {
        "target_fee_mm": float | null,
        "target_fee_pct": float | null,
        "acquirer_fee_mm": float | null,
        "acquirer_fee_pct": float | null,
        "two_tier": bool | null,
        "confidence": float
    },
    "financing": {
        "has_financing_condition": bool | null,
        "committed": bool | null,
        "sources": [str] | null,
        "confidence": float
    },
    "force_the_vote": bool | null,
    "collar": {
        "has_collar": bool | null,
        "type": str | null,
        "floor": float | null,
        "ceiling": float | null,
        "walk_away": bool | null,
        "confidence": float
    },
    "regulatory": {
        "requires_hsr": bool | null,
        "requires_cfius": bool | null,
        "requires_eu": bool | null,
        "other_approvals": [str] | null,
        "complexity": "low" | "medium" | "high" | "extreme" | null,
        "confidence": float
    },
    "extraction_notes": str  // any ambiguities or caveats
}
"""
```

### Confidence scoring and QA tiers

| Confidence | Meaning | QA Action |
|------------|---------|-----------|
| >= 0.9 | Clear, unambiguous language | Auto-accept |
| 0.7 - 0.9 | Likely correct but some nuance | Sample audit (10%) |
| 0.5 - 0.7 | Ambiguous or partially extracted | Manual review queue |
| < 0.5 | Low confidence or contradictory | Mandatory manual review |

### Citation trail

Every extracted field traces back to a source:

```python
# In research_deal_clauses, the extraction_source field stores:
"0001193125-24-123456"  # accession number of the filing

# In research_deal_events, the source_text field stores:
"The Company shall have the right...to solicit, initiate, or knowingly
facilitate...Alternative Acquisition Proposals during the period beginning
on the date of this Agreement and ending at 11:59 p.m. (New York City time)
on January 15, 2025 (the 'Go-Shop Period End Date')."
```

### What should be manually reviewed

**Always manually review:**
1. Go-shop provisions — too important for the study to risk extraction errors
2. Match rights — nuanced language, high study impact
3. Termination fee two-tier structures — easy to misread
4. Any deal where `extraction_confidence < 0.7` on 2+ fields

**Sample audit (10%):**
1. Standard no-shop / fiduciary out provisions
2. HSR / regulatory requirements
3. Financing commitment status

**Auto-accept:**
1. Deal price / consideration (cross-checked against 8-K and press release)
2. Filing dates (from EDGAR metadata, not extraction)
3. Binary fields with high confidence

### Cost estimate for extraction

Using Claude CLI (Opus via Max subscription, $0 marginal cost):
- ~3,200 deals × ~2 filings per deal needing extraction = ~6,400 extraction calls
- At ~75 seconds per call (medium effort) = ~133 hours of compute
- Parallelizable across 3-4 CLI instances = ~35 hours wall time
- **Cost: $0** (Max subscription)

---

## 6. Market Data Framework

### Data sources and availability

| Data Type | Source | Historical Depth | Granularity | Cost |
|-----------|--------|-----------------|-------------|------|
| Stock OHLCV | Polygon | 15+ years (2004+) | Daily / Minute | Included in current plan |
| Options chains | Polygon | ~7-10 years (varies) | Daily snapshots | Included in current plan |
| Options greeks | Polygon | ~7-10 years | Daily | Included in current plan |
| VIX | Polygon or CBOE | 30+ years | Daily | Free |
| S&P 500 | Polygon | 15+ years | Daily | Included |

### What to store: the three-tier approach

#### Tier 1: Daily stock data (ALL deals, ALL days during deal life)

Store in `research_market_daily`. For each deal, store daily OHLCV from 30 trading days before announcement through close/termination + 5 days.

**Volume:** ~3,200 deals × ~120 trading days average = ~384,000 rows
**Storage:** ~50 MB (trivial)

**Polygon endpoint:** `GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}`

#### Tier 2: Daily options summary (ALL deals, ALL days when options exist)

Store in `research_options_daily`. Computed from Polygon chain snapshots. One row per deal per trading day.

**Key signals to compute daily:**
- ATM IV (call and put separately)
- IV of the call at the deal-price strike (the "higher-bid call")
- IV of the put at the estimated break price (the "deal-break put")
- Above-deal-price call volume and OI (directional higher-bid signal)
- Put/call volume ratio
- Term structure (front month vs back month IV)

**Volume:** ~3,200 deals × ~80 trading days with options = ~256,000 rows
**Storage:** ~30 MB

**Challenge — no historical chain snapshots from Polygon:**
Polygon's `/v3/snapshot/options/{underlying}` endpoint returns the CURRENT chain only. There is no
"give me the chain for ATVI on 2023-01-15 with greeks" endpoint. Historical greeks/IV must be
self-computed from OHLCV + underlying price + Black-Scholes. The practical approach:

```python
# Pseudocode for historical options data collection
async def collect_historical_options(ticker, date_range):
    # Step 1: Get list of historical contracts (active AND expired)
    # Endpoint: /v3/reference/options/contracts
    # Key params: underlying_ticker, expired=true, as_of (point-in-time)
    # Max 1,000 per page, paginated
    contracts = await polygon.list_options_contracts(
        underlying_ticker=ticker,
        expired=True,
        expiration_date_gte=date_range.start,
        expiration_date_lte=date_range.end + timedelta(days=180)
    )

    # Step 2: For each contract, get daily OHLCV aggregates
    # Ticker format: O:{UNDERLYING}{YYMMDD}{C/P}{STRIKE*1000}
    # e.g., "O:ATVI230120C00070000" for ATVI $70 Call exp 2023-01-20
    for contract in contracts:
        bars = await polygon.get_aggs(
            ticker=contract.ticker,
            multiplier=1,
            timespan="day",
            from_=max(contract.listing_date, date_range.start),
            to=min(contract.expiration_date, date_range.end)
        )
        # bars give us OHLCV per day — must self-compute IV via Black-Scholes

    # Step 3: Compute implied volatility ourselves
    # For each contract on each day: use contract OHLCV close + underlying close
    # + risk-free rate + time to expiry → Black-Scholes inversion → IV
    # This is compute-intensive but one-time for historical backfill
```

**Practical constraint:** For a typical M&A target with 100-300 active option contracts,
reconstructing the chain for a single date requires 100-300 API calls (one per contract).
For ~3,200 deals × ~20 event-window dates × ~200 contracts = ~12.8M API calls.
At Polygon's practical ~100 req/s (paid tier), this is ~36 hours of API calls.
Manageable as a one-time backfill but should be batched over several days.

**Alternative: Polygon flat files** (Business tier $799+/mo) provide daily OHLCV for ALL
U.S. options contracts. This would be faster for bulk backfill but expensive for a one-time project.
Recommendation: start with API-based approach; escalate to flat files only if API proves too slow.

#### Tier 3: Full chain snapshots (SELECTIVE — event windows only)

Store in `research_options_chains`. Full chain snapshots ONLY around:

1. **Announcement day** (T-1, T, T+1, T+5) — 4 snapshots
2. **Topping bid day** (T-1, T, T+1) — 3 snapshots per event
3. **Regulatory decision day** — 2 snapshots
4. **Close/break day** — 2 snapshots
5. **Weekly samples** — every Friday during deal life (for research flexibility)

**Volume estimate:**
- 3,200 deals × ~20 snapshots per deal × ~50 contracts per snapshot = ~3.2M rows
- **Storage:** ~400 MB (still manageable for PostgreSQL)

### Implied probability computation

Two key implied probabilities to compute:

#### 1. Deal-completion probability (from stock spread)

```python
def implied_deal_completion_prob(stock_price, deal_price, break_price,
                                  risk_free_rate, days_to_close):
    """Classic risk-neutral deal completion probability."""
    upside = deal_price - stock_price    # if deal closes
    downside = stock_price - break_price  # if deal breaks
    # P * upside - (1-P) * downside = risk_free_return
    # Solving for P:
    rf_return = stock_price * risk_free_rate * (days_to_close / 365)
    prob = (downside + rf_return) / (upside + downside)
    return max(0, min(1, prob))
```

#### 2. Higher-bid probability (from above-deal-price calls)

This is more nuanced. The idea: calls struck ABOVE the deal price should be nearly worthless if the market expects the deal to close at the offered price. If those calls have meaningful value, the market is pricing some probability of a price above the deal price.

```python
def implied_higher_bid_prob(call_price, deal_price, strike, stock_price,
                             risk_free_rate, days_to_expiry):
    """Estimate higher-bid probability from above-deal-price calls.

    Model: the call value = P(higher_bid) * E[payout | higher_bid]
    For a call struck at deal_price + X:
    - If deal closes at deal_price → call is worthless
    - If deal breaks → call has residual value (use break-price model)
    - If higher bid → call has intrinsic value

    Simplified: P(higher) ≈ call_price / E[higher_bid_premium]
    where E[higher_bid_premium] is estimated from historical bid bumps.
    """
    # Historical average bid bump: ~15-20% above initial price
    expected_bump = 0.15 * deal_price
    if strike > deal_price:
        expected_payout = max(0, deal_price + expected_bump - strike)
    else:
        expected_payout = expected_bump

    if expected_payout <= 0:
        return None

    prob = call_price / (expected_payout * math.exp(-risk_free_rate * days_to_expiry / 365))
    return max(0, min(1, prob))
```

### Storage cost estimate

| Table | Rows | Size | Notes |
|-------|------|------|-------|
| research_market_daily | ~384K | ~50 MB | All deals, all days |
| research_options_daily | ~256K | ~30 MB | All deals with options |
| research_options_chains | ~3.2M | ~400 MB | Event windows + weekly |
| **Total** | ~3.8M | **~480 MB** | Well within PostgreSQL capacity |

---

## 7. Feature Library

### Feature categories

All features should be computable at any point in time during a deal's life (point-in-time discipline). No future information leakage.

#### A. Static deal features (fixed at announcement)

| Feature | Source | Why it matters |
|---------|--------|---------------|
| `deal_value_mm` | Filings | Larger deals attract more competing interest |
| `initial_premium_1d_pct` | Market data | Low premiums invite competing bids |
| `initial_premium_30d_pct` | Market data | Controls for pre-announcement run-up |
| `deal_structure` | Filings | Cash deals are different from stock deals |
| `buyer_type` | Classification | PE vs strategic have different dynamics |
| `is_hostile` | Classification | Hostile deals invite white knights |
| `target_sic_sector` | EDGAR | Sector-specific patterns |
| `target_market_cap_mm` | Market data | Size affects competing interest |
| `has_go_shop` | Merger agreement | THE key clause variable |
| `go_shop_period_days` | Merger agreement | Window length matters |
| `has_match_right` | Merger agreement | Match rights deter competitors |
| `match_right_days` | Merger agreement | Longer match periods are more deterrent |
| `termination_fee_pct` | Merger agreement | Higher fees deter competing bids |
| `reverse_termination_fee_pct` | Merger agreement | Signals acquirer commitment |
| `has_financing_condition` | Merger agreement | Conditioned deals are more vulnerable |
| `regulatory_complexity` | Classification | Complex regulatory paths increase uncertainty |
| `fiduciary_out_type` | Merger agreement | Determines target board flexibility |
| `force_the_vote` | Merger agreement | Limits target's ability to switch deals |
| `num_bidders_pre_signing` | Background section | Was there a pre-signing auction? |
| `had_pre_signing_auction` | Background section | Auction vs single-bidder process |

#### B. Dynamic event features (change over deal life)

| Feature | Source | Computation |
|---------|--------|-------------|
| `days_since_announce` | Calendar | Linear days count |
| `days_to_expected_close` | Events | Countdown (may change with extensions) |
| `pct_timeline_elapsed` | Calendar | days_elapsed / expected_days |
| `go_shop_active` | Calendar | Boolean: is go-shop window still open? |
| `go_shop_days_remaining` | Calendar | Days left in go-shop window |
| `hsr_filed` | Events | Boolean milestone |
| `hsr_cleared` | Events | Boolean milestone |
| `proxy_filed` | Events | Boolean milestone |
| `vote_scheduled` | Events | Boolean milestone |
| `num_regulatory_cleared` | Events | Count of cleared regulatory hurdles |
| `num_regulatory_remaining` | Events | Count of pending hurdles |
| `has_litigation` | Events | Any lawsuits filed? |
| `board_recommendation_changed` | Events | Board switched its recommendation? |
| `num_amendments` | Events | Count of deal amendments |
| `num_extensions` | Events | Count of outside date extensions |

#### C. Market-implied features (from daily market data)

| Feature | Source | Why it matters |
|---------|--------|---------------|
| `current_spread_pct` | Stock price | Market's real-time deal-completion confidence |
| `spread_z_score` | Rolling stats | Is spread unusually wide or tight? |
| `spread_momentum_5d` | Stock price | Is spread widening or tightening? |
| `spread_vs_risk_free` | Stock + rates | Is spread compensating for risk? |
| `stock_volume_ratio` | Stock volume | Volume vs 20-day avg (unusual activity?) |
| `atm_iv` | Options | Overall uncertainty level |
| `above_deal_call_value` | Options | Total value of above-deal-price calls |
| `above_deal_call_oi_change` | Options | Are traders building above-deal positions? |
| `upside_call_skew` | Options | Skew toward higher prices |
| `impl_prob_deal_close` | Computed | From spread model |
| `impl_prob_higher_bid` | Computed | From above-deal call model |
| `put_call_ratio` | Options | Bearish vs bullish sentiment |
| `term_structure_slope` | Options | Is uncertainty front-loaded or back-loaded? |

#### D. Text-derived features (from filing analysis)

| Feature | Source | Extraction method |
|---------|--------|-------------------|
| `background_section_bidder_count` | Proxy/DEFM14A | LLM extraction: how many parties were contacted? |
| `background_auction_type` | Proxy/DEFM14A | LLM: broad auction, targeted, single-bidder |
| `fairness_opinion_premium_range` | Proxy/DEFM14A | LLM/regex: DCF range from fairness opinion |
| `superior_proposal_definition_breadth` | Merger agreement | LLM: how broadly is "superior proposal" defined? |
| `mac_exclusion_breadth` | Merger agreement | LLM: narrow, standard, or broad MAC carveouts |
| `management_retention_agreements` | Filings | LLM: do managers have golden parachute/retention deals? |
| `insider_ownership_pct` | Proxy/13D | Regex: % owned by insiders (alignment signal) |

#### E. Regime / context features

| Feature | Source | Why it matters |
|---------|--------|---------------|
| `vix_at_announcement` | VIX data | Market regime affects competing bid likelihood |
| `credit_spread_at_announcement` | Market data | Financing availability for competing bids |
| `sp500_return_trailing_3m` | Market data | Bull vs bear market |
| `m_and_a_volume_trailing_3m` | Research DB | Hot vs cold M&A market |
| `same_sector_deal_count_trailing_6m` | Research DB | Sector consolidation waves |
| `year` | Calendar | Structural breaks over time |
| `is_election_year` | Calendar | Political uncertainty |
| `fed_funds_rate` | Macro data | Interest rate environment |
| `antitrust_regime` | Classification | Lax vs strict enforcement administration |

---

## 8. First-Study Design: Higher-Bid Dynamics

### Study overview

**Title:** "When Do Announced Acquisitions Receive Higher Bids? Evidence from 10 Years of U.S. Public M&A"

**Research question:** What deal characteristics, clause provisions, and market signals predict whether an announced acquisition will receive a competing or higher bid, and does the options market correctly price this probability?

### Target variable definition

**Primary label:** `received_higher_bid` (Boolean)

Definition: TRUE if any of the following occur after the initial definitive agreement:
1. A bona fide competing bid is publicly announced by a third party
2. The original acquirer raises its price in response to (actual or threatened) competition
3. The original acquirer raises its price for other reasons (shareholder pressure, adequacy concerns)

**Secondary labels:**
- `received_competing_bid` — TRUE if a third-party competing bid was announced (regardless of outcome)
- `bid_increased_any_reason` — TRUE if final price > initial price (any cause)
- `price_improvement_pct` — continuous: (final_price - initial_price) / initial_price
- `days_to_first_competing_bid` — survival analysis target

### Label construction methodology

```python
def label_deal(deal_id, events, considerations):
    """Construct research labels from event and consideration history.

    CRITICAL: Labels are constructed ONLY from events that occurred.
    No future information leakage.
    """
    initial_price = considerations[0].total_per_share  # version 1
    final_price = considerations[-1].total_per_share    # last version

    competing_events = [e for e in events if e.event_type == 'COMPETING_BID']
    price_changes = [e for e in events if e.event_type == 'PRICE_CHANGE']
    topping_bids = [e for e in price_changes if e.event_subtype == 'topping_bid']

    return {
        'received_higher_bid': len(topping_bids) > 0 or final_price > initial_price * 1.005,
        'received_competing_bid': len(competing_events) > 0,
        'bid_increased_any_reason': final_price > initial_price * 1.005,  # 0.5% threshold
        'price_improvement_pct': (final_price - initial_price) / initial_price,
        'num_competing_bids': len(competing_events),
        'days_to_first_competing': (
            (competing_events[0].event_date - deal.announced_date).days
            if competing_events else None
        ),
        'competing_during_go_shop': any(
            e.details.get('during_go_shop') for e in competing_events
        ),
    }
```

### Analysis plan

#### Part A: Descriptive statistics and base rates

1. **Unconditional base rates** (academic benchmarks for comparison):
   - % of deals receiving any PUBLIC competing bid (academic benchmark: ~5%, Betton/Eckbo/Thorburn 2008)
   - % of deals where final price > initial price (expected: ~8-12%; distressed years like 2009 saw 16%)
   - % of deals with price improvement > 5% (expected: ~3-5%)
   - Distribution of price improvement (conditional on increase)
   - Note: Boone & Mulherin (2007) showed ~50% of targets are auctioned privately PRE-public announcement. Our post-announcement study will see the ~5% public competing rate, but proxy background sections reveal the pre-signing auction history.

2. **Base rates by category:**

   | Split variable | Expected finding |
   |---------------|-----------------|
   | Year (2016-2026) | Declining competing bid rates (Subramanian: 12.5%→6.1%→4.3%) |
   | Go-shop vs no-shop | Go-shop: higher initial rates, declining over time (4.3% in 2015-19) |
   | Cash vs stock | Cash deals: lower competing bid rate |
   | PE vs strategic buyer | PE deals: historically higher go-shop rate |
   | Deal size buckets | Mid-cap ($500M-$5B): highest competing bid rate |
   | Premium buckets | Low premium (<20%): highest competing bid rate |
   | Sector | Tech, healthcare: higher rates |
   | With vs without match rights | Match rights: lower competing bid rate |
   | Termination fee size | Higher fees: lower competing bid rate |
   | Had pre-signing auction | Auction deals: lower post-signing competing rate |
   | Hostile vs friendly | Hostile: higher competing bid rate |

3. **Cross-tabulations:**
   - Go-shop × match rights (Subramanian's key interaction)
   - Go-shop × pre-signing auction (substitution effect?)
   - Premium × go-shop (do low-premium go-shops work better?)
   - Year × go-shop effectiveness (temporal degradation)

#### Part B: Clause-effect estimation

**Model 1: Logistic regression**

```python
# Base specification
y = received_higher_bid  # binary

X_base = [
    'has_go_shop',
    'go_shop_period_days_z',           # standardized
    'has_match_right',
    'match_right_days_z',
    'termination_fee_pct_z',
    'initial_premium_1d_pct_z',
    'log_deal_value_mm',
    'buyer_type_dummies',              # PE, strategic, consortium
    'deal_structure_dummies',          # cash, stock, mixed
    'had_pre_signing_auction',
    'regulatory_complexity_dummies',
    'year_fixed_effects'
]

# Interaction specification
X_interactions = X_base + [
    'has_go_shop * has_match_right',
    'has_go_shop * match_right_days_z',
    'has_go_shop * initial_premium_1d_pct_z',
    'has_go_shop * year_trend',
    'has_go_shop * buyer_type_PE',
]
```

**Model 2: Gradient-boosted trees (XGBoost)**

Full feature set (all categories A-E above). Primary advantage: captures non-linear interactions and thresholds that logistic regression misses.

```python
# Feature importance analysis
# Goal: which features ACTUALLY predict topping bids?
model = XGBClassifier(
    n_estimators=500,
    max_depth=4,
    learning_rate=0.05,
    min_child_weight=5,         # prevent overfitting to rare events
    scale_pos_weight=ratio,     # handle class imbalance (~5-8% positive)
    subsample=0.8,
    colsample_bytree=0.8,
)

# Use time-based cross-validation (not random)
# Train on 2016-2022, validate on 2023, test on 2024-2025
```

**Model 3: Survival analysis (Cox proportional hazards)**

For the time-to-first-competing-bid question:

```python
from lifelines import CoxPHFitter

# Duration: days from announcement to first competing bid (or censoring)
# Event: competing_bid_arrived (1) or censored (0 = deal closed/broke without competing bid)

cph = CoxPHFitter()
cph.fit(data, duration_col='duration_days', event_col='competing_bid_arrived')
```

#### Part C: Market-implied information analysis

**Q1: Does the market distinguish real from ceremonial go-shops?**

```python
# Compare:
# Group 1: Go-shop deals that actually got a topping bid
# Group 2: Go-shop deals that did NOT get a topping bid
# Group 3: No-shop deals

# Metric: above-deal-price call premium on day T+5 (post-announcement)
# If market is efficient: Group 1 should have HIGHER call premium than Group 2
# If market is inefficient: no difference, or wrong direction

# Test: Welch's t-test on above_deal_call_value between groups
# Robustness: control for ATM IV, deal size, sector
```

**Q2: Are above-deal-price calls overpriced or underpriced?**

```python
# For each deal, compute at T+5:
# - Market-implied probability of higher bid (from above-deal calls)
# - Actual outcome: did a higher bid occur?

# Calibration analysis:
# Bucket deals by implied probability deciles
# Compare implied prob vs realized frequency
# If calibrated: p-hat ≈ actual frequency in each bucket
# If overpriced: implied > actual (sell those calls)
# If underpriced: implied < actual (buy those calls)

# Plot: calibration curve with confidence intervals
```

**Q3: Options term structure around higher-bid events**

```python
# Event study: for deals that DID receive a topping bid
# Align to event date (first competing bid announcement)

# Examine T-20 to T+10:
# - ATM IV trend (does uncertainty build pre-event?)
# - Above-deal call OI (does "smart money" build positions before?)
# - Skew shift (does call skew steepen before the event?)

# Compare to control group: similar deals that did NOT receive competing bids
# (matched on deal size, premium, sector, time period)
```

#### Part D: Trade-expression analysis

For deals where a higher bid is expected/likely, what is the best trade?

```python
# For each deal in sample, compute hypothetical returns for:

strategies = {
    'long_stock': {
        'entry': 'buy target stock at T+1 close',
        'exit': 'sell at deal close or T+60, whichever first',
        'return': (exit_price - entry_price) / entry_price
    },
    'long_atm_call': {
        'entry': 'buy ATM call at T+1',
        'exit': 'sell at topping bid announcement or expiry',
        'return': (exit_value - entry_cost) / entry_cost
    },
    'long_deal_strike_call': {
        'entry': 'buy call struck at deal price at T+1',
        'exit': 'sell at topping bid or expiry',
        'return': (exit_value - entry_cost) / entry_cost
    },
    'covered_call_overwrite': {
        'entry': 'long stock + sell deal-price call at T+1',
        'exit': 'unwind at close or T+60',
        'return': 'stock return + call premium - assignment risk'
    },
    'do_nothing': {
        'return': 0  # benchmark
    }
}

# For each strategy, compute:
# 1. Average return (unconditional)
# 2. Average return (conditional on higher bid occurring)
# 3. Average return (conditional on NO higher bid)
# 4. Sharpe ratio
# 5. Win rate
# 6. Max drawdown
```

#### Part E: Regime analysis

Split the sample into periods and test for structural breaks:

| Period | Regime | Expected characteristics |
|--------|--------|------------------------|
| 2016-2019 | Normal M&A | Baseline |
| 2020-2021 | COVID + recovery | Fewer competing bids, wider spreads |
| 2022-2023 | Rising rates | PE constrained, fewer LBOs |
| 2024-2026 | Current cycle | Recovery, more strategic deals |

Also test:
- VIX regime: low (<15), medium (15-25), high (>25)
- Antitrust regime: Obama (2016), Trump-1 (2017-2020), Biden (2021-2024), Trump-2 (2025+)
- Credit conditions: tight vs loose (credit spread z-score)

### Robustness checks

1. **Alternative label definitions:** vary the 0.5% price improvement threshold (try 0%, 1%, 2%, 5%)
2. **Excluding hostile deals:** re-run without hostile offers
3. **Excluding MBOs:** re-run without management buyouts
4. **Winsorized premiums:** trim extreme premiums (>100%)
5. **Clustered standard errors:** cluster by year, sector, and buyer type
6. **Propensity score matching:** match go-shop vs no-shop deals on observables
7. **Instrumental variables:** use buyer type (PE tends to include go-shops) as instrument
8. **Placebo tests:** scramble go-shop assignment, verify coefficients disappear
9. **Out-of-sample validation:** train on 2016-2022, validate 2023, test 2024-2025

---

## 9. Backtesting / Research Methodology

### Point-in-time discipline

**The cardinal sin of M&A research is using information that was not available at the time.**

Rules:
1. **Features are computed ONLY from data available on the feature date.** A feature computed on day T uses only events and market data from day T and before.
2. **Labels are computed ONLY after the deal concludes.** No peeking at outcomes during feature computation.
3. **Filing dates use the FILING date, not the event date.** If a merger agreement was signed on Dec 15 but filed on Dec 18, the market couldn't see the terms until Dec 18.
4. **Options data uses settlement prices, not intraday.** Avoids bid-ask bounce and timing ambiguity.
5. **Time-based train/test splits only.** Never random splits — M&A regimes are non-stationary.

### Bias prevention

| Bias | Risk | Mitigation |
|------|------|------------|
| **Survivorship bias** | Only studying deals that closed | Include ALL announced deals regardless of outcome |
| **Selection bias** | Only studying deals with clean data | Track data completeness explicitly; report results with and without incomplete deals |
| **Look-ahead bias** | Using future information in features | Strict timestamp discipline; all features must be computable in real-time |
| **Label contamination** | Ambiguous outcome classification | Rules-based label construction with explicit thresholds |
| **Hindsight bias** | Overfitting model to known outcomes | Time-based cross-validation; out-of-period testing |
| **Multiple comparisons** | Testing many hypotheses, finding spurious patterns | Pre-register hypotheses; report all tests (not just significant ones) |
| **Small sample bias** | ~3,200 deals with ~5-8% positive rate = ~200 positive cases | Use regularized models; report confidence intervals; acknowledge power limitations |
| **Timestamp errors** | Incorrect event dates | Cross-reference filing dates with EDGAR metadata; flag discrepancies |

### Cross-validation strategy

```
2016  2017  2018  2019  2020  2021  2022  2023  2024  2025  2026
|------ TRAIN (expanding window) ------|-- VAL --|-- TEST --|

Fold 1: Train 2016-2020 | Val 2021 | Test 2022
Fold 2: Train 2016-2021 | Val 2022 | Test 2023
Fold 3: Train 2016-2022 | Val 2023 | Test 2024
Fold 4: Train 2016-2023 | Val 2024 | Test 2025

Final model: Train 2016-2024 | Test 2025-2026
```

---

## 10. Data Quality / QA Plan

### Coverage validation

| Check | Method | Frequency |
|-------|--------|-----------|
| Universe completeness | Cross-reference our deal count by year against published M&A stats (MergerStat, Bloomberg) | Once during initial build |
| Filing coverage | Every research_deal should have >= 1 filing in research_deal_filings | Continuous |
| Market data coverage | Every research_deal should have stock data for announcement day | Continuous |
| Clause extraction | Track extraction_status: what % is complete, partial, failed? | Dashboard metric |
| Outcome labeling | Every closed/terminated deal must have a research_deal_outcomes row | Continuous |

### Correctness validation

| Check | Method | Pass criteria |
|-------|--------|---------------|
| Deal price sanity | Compare extracted deal price to announcement-day stock price; should be within 50% | No outliers > 50% |
| Premium sanity | Premium should be -10% to +200% (flag outliers) | Review outliers manually |
| Date ordering | announced_date <= signing_date <= expected_close_date <= outside_date | No violations |
| Event ordering | Events within a deal should be chronologically consistent | No future-dated events relative to later events |
| Clause consistency | If has_go_shop = TRUE, go_shop_period_days should be NOT NULL | No NULL violations |
| Termination fee range | Fee should be 1-5% of deal value (flag outliers) | Review outliers |
| Filing-deal linkage | Every filing should link to exactly one deal | No orphan filings |

### Automated QA queries

```sql
-- Deals with no events
SELECT deal_id FROM research_deals
WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_events);

-- Deals with no filings
SELECT deal_id FROM research_deals
WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_filings);

-- Deals with impossible premiums
SELECT deal_id, initial_premium_1d_pct
FROM research_deals
WHERE initial_premium_1d_pct > 200 OR initial_premium_1d_pct < -10;

-- Clauses with low confidence that haven't been reviewed
SELECT d.deal_key, c.*
FROM research_deal_clauses c
JOIN research_deals d ON d.deal_id = c.deal_id
WHERE c.extraction_confidence < 0.7
  AND c.manually_verified = FALSE;

-- Event ordering violations
SELECT e1.deal_id, e1.event_type, e1.event_date,
       e2.event_type, e2.event_date
FROM research_deal_events e1
JOIN research_deal_events e2 ON e1.deal_id = e2.deal_id
WHERE e1.event_type = 'ANNOUNCEMENT' AND e1.event_subtype = 'initial_announcement'
  AND e2.event_type = 'COMPLETION' AND e2.event_subtype = 'closing'
  AND e1.event_date > e2.event_date;

-- Market data gaps
SELECT d.deal_key, d.announced_date,
       MIN(m.trade_date) as first_market_date,
       MAX(m.trade_date) as last_market_date,
       COUNT(*) as trading_days
FROM research_deals d
LEFT JOIN research_market_daily m ON d.deal_id = m.deal_id
GROUP BY d.deal_id, d.deal_key, d.announced_date
HAVING COUNT(*) < 20;  -- suspiciously few trading days
```

### Human review process

For the higher-bid study, these fields MUST be manually verified for all ~200 positive cases (deals that received higher bids):

1. `received_higher_bid` — is the label correct?
2. `go_shop` details — were clauses extracted correctly?
3. `match_rights` — are match right details accurate?
4. `competing_bid` events — are all competing bids captured?
5. `price_improvement_pct` — is the price change correctly computed?

Estimated effort: ~200 deals × 15 minutes = 50 hours of manual review. **This is non-negotiable — the positive cases are the entire study.**

---

## 11. Implementation Roadmap

### Phase 1: Universe Construction (Weeks 1-3)

**Goal:** Identify and catalog every qualifying M&A deal from 2016-2026.

**Tasks:**

1.1. **Build EDGAR master-index scraper (PRIMARY — zero result cap)**
   - Download quarterly `master.idx` files from `sec.gov/Archives/edgar/full-index/{YEAR}/QTR{Q}/`
   - 40 files total (2016 Q1 through 2026 Q1), pipe-delimited, ~100K filings per file
   - Filter `Form Type` column for M&A forms: SC TO-T, SC TO-I, SC 14D9, DEFM14A, PREM14A, DEFM14C, S-4, F-4
   - Extract CIK, company name, form type, filing date, accession number
   - **Why primary:** Master index has NO result cap (unlike EFTS's 10K hard limit per query)
   - Expected yield: ~2,000-4,000 M&A-specific filings per year across all form types
   - Also available pre-aggregated from Notre Dame SRAF: `MasterIndex_Aggregate_1993-2024.txt`

1.2. **Supplement with EFTS for 8-K coverage (SECONDARY)**
   - Query `efts.sec.gov/LATEST/search-index` for `"merger agreement" OR "agreement and plan of merger"` within 8-K filings
   - **Critical:** EFTS has a hard 10K result cap per query — partition by year to stay under limit
   - Rate limit: 10 req/sec, must include `User-Agent: "DR3 Research admin@dr3-dashboard.com"`
   - This catches 8-K Item 1.01 announcements that precede proxy filings
   - NOTE: Our codebase has NO existing EFTS implementation despite references in docs — this is new code
   - 100 results per page, paginate with `from` parameter

1.3. **Entity resolution — group filings into deals (HARD PART)**
   - Group filings by target CIK + overlapping date window (±180 days) = same deal
   - Cross-reference acquirer from filing text (LLM extraction)
   - Apply deal-value filter ($50M minimum) using 8-K filing data or proxy premiums
   - Assign stable `deal_key` identifiers (format: `{YEAR}-{TARGET_TICKER}-{ACQUIRER_TICKER}`)
   - Handle linked deal variants (amendments, topping bids for same target)
   - Use `data.sec.gov/submissions/CIK{cik}.json` for company metadata (tickers, SIC, exchange)

1.4. **Enrich from data.sec.gov**
   - Pull company facts (SIC code, state, exchange) for each target CIK
   - Pull filer submission history for cross-referencing
   - Map CIK → ticker using `sec.gov/files/company_tickers.json` (already cached in our codebase)

1.5. **Cross-reference with production data**
   - Match historical deals to existing `deal_intelligence` and `canonical_deals` records
   - Set `production_deal_id` and `canonical_deal_id` cross-references
   - NOTE: Two separate filing tables exist in production (`edgar_filings` from discovery pipeline,
     `portfolio_edgar_filings` from portfolio watcher) with NO shared key — research tables will unify these

**Deliverable:** `research_deals` table populated with ~3,200 deals, basic metadata, and filing links.

**Migration:** `python-service/migrations/060_research_database.sql`

### Phase 2: Lifecycle / Event Schema (Weeks 3-5)

**Goal:** Build the event-sourced deal lifecycle for every deal.

**Tasks:**

2.1. **Automated event extraction from filing metadata**
   - Filing dates → `proxy_filed`, `definitive_proxy`, etc.
   - 8-K Item types → `formal_agreement`, `closing`, `termination`
   - SC TO filings → `tender_offer` events

2.2. **Key date extraction from filing text**
   - Parse announcement dates, expected close dates, outside dates from 8-K text
   - Use regex + LLM hybrid (our existing `filing_extractor.py` as base)

2.3. **Outcome determination**
   - Delisted = closed (check EDGAR filer status)
   - Amended 8-K with "termination" = terminated
   - Cross-reference with simple web searches for ambiguous cases

2.4. **Build consideration version chain**
   - For each deal, extract initial terms and any amendments
   - Populate `research_deal_consideration` with versioned rows

**Deliverable:** `research_deal_events` and `research_deal_consideration` populated.

### Phase 3: Filing Extraction / Clause Database (Weeks 5-10)

**Goal:** Extract deal-protection clauses from merger agreements and proxy statements.

**Tasks:**

3.1. **Download and store merger agreements**
   - For each deal, identify the merger agreement filing (8-K Ex. 2.1 or equivalent)
   - Download full text, store path reference

3.2. **Build clause extraction pipeline**
   - Extend existing `filing_extractor.py` with merger-agreement-specific patterns
   - Build LLM extraction prompt (see Section 5)
   - Run Claude CLI extraction on all merger agreements

3.3. **Build QA pipeline**
   - Auto-flag low-confidence extractions
   - Generate human review queue
   - Build review interface (or use a simple script + spreadsheet)

3.4. **Manual review of critical cases**
   - All go-shop provisions
   - All match rights
   - All two-tier termination fee structures
   - All deals that received higher bids (once identified)

**Deliverable:** `research_deal_clauses` populated with extracted and verified clauses.

### Phase 4: Market Data Ingestion (Weeks 6-10, overlapping with Phase 3)

**Goal:** Build the historical market data layer.

**Tasks:**

4.1. **Daily stock data ingestion**
   - For each deal, pull daily OHLCV from Polygon for the deal window
   - Compute spread metrics relative to deal price
   - Store in `research_market_daily`

4.2. **Historical options data collection**
   - For deals from ~2019+ (Polygon options history): pull daily chain summaries
   - Compute daily options features (ATM IV, skew, above-deal call metrics)
   - Store in `research_options_daily`

4.3. **Event-window chain snapshots**
   - For key events (announcements, topping bids, regulatory decisions): pull full chains
   - Store in `research_options_chains`

4.4. **Context data ingestion**
   - Daily VIX and S&P 500 (one-time pull, shared across all deals)
   - Fed funds rate time series

**Deliverable:** All market data tables populated.

### Phase 5: First-Study Analysis (Weeks 10-14)

**Goal:** Execute the higher-bid dynamics study.

**Tasks:**

5.1. **Feature engineering pipeline**
   - Build Python module: `research/features.py`
   - Compute all features from Section 7 for each deal
   - Store in materialized view or feature table

5.2. **Descriptive statistics**
   - Base rates by all categories (Part A of study design)
   - Generate tables and charts
   - Identify surprising patterns

5.3. **Model estimation**
   - Logistic regression (Part B)
   - XGBoost with feature importance (Part B)
   - Survival analysis (Part B)

5.4. **Options market analysis**
   - Calibration analysis (Part C)
   - Event study around topping bids (Part C)
   - Market efficiency tests (Part C)

5.5. **Trade-expression analysis**
   - Backtested strategy returns (Part D)
   - Sharpe ratios and risk metrics

5.6. **Write-up and visualization**
   - Research report with tables, figures, key findings
   - Dashboard integration for key results

**Deliverable:** Completed research study with findings.

### Phase 6: Productionization (Weeks 14-16)

**Goal:** Integrate research findings into the live deal-monitoring system.

**Tasks:**

6.1. **Higher-bid probability score for live deals**
   - Use the trained model to compute a real-time "higher-bid probability" for each active deal
   - Add to the AI risk assessment pipeline (new section in prompts.py)
   - Display on deal cards in the dashboard

6.2. **Options signal monitoring**
   - Add above-deal-price call monitoring to the morning options report
   - Alert when implied higher-bid probability crosses thresholds

6.3. **Clause extraction for new deals**
   - Automatically extract clauses when new merger agreements are filed
   - Add to the existing EDGAR filing impact pipeline

6.4. **Auto-sync pipeline**
   - New production deals automatically create research_deals records
   - New events automatically create research_deal_events records
   - Keep the research database growing

---

## 12. Highest-Value Shortcuts

### Where 80/20 shortcuts are ACCEPTABLE

| Shortcut | Why it's OK | Risk if skipped |
|----------|-------------|-----------------|
| **Use Polygon for options instead of OPRA** | Polygon is good enough for daily signals; OPRA raw tick data is overkill for this study | None for this study |
| **Skip intraday options data** | Daily EOD chain data captures 95% of the signal; intraday is expensive and rarely changes conclusions | Minor precision loss |
| **Use LLM extraction instead of manual for most clauses** | Claude at 90%+ accuracy on structured extraction; sample audit catches errors | Small error rate |
| **Skip pre-2019 options data** | Options coverage before 2019 is spotty; stock-based features still work for the full 10-year period | Reduced statistical power for options-specific analysis |
| **Use SEC filing dates as event dates** | True event dates might be a day earlier (signing vs filing), but for cross-sectional analysis this doesn't matter | Small timestamp noise |
| **Classify deal outcomes from filing metadata first** | Most outcomes (closed/terminated) are evident from EDGAR without reading filing text | Rare ambiguous cases need manual review |
| **Use annual VIX/rates as regime proxies** | Rather than building a full macro factor model, use simple regime variables | Minor loss of granularity |

### Where 80/20 shortcuts would be DANGEROUS

| Area | Why you cannot shortcut | What happens if you do |
|------|------------------------|------------------------|
| **Go-shop clause extraction** | This IS the study — accuracy matters enormously | Wrong labels → wrong conclusions → bad trades |
| **Match rights extraction** | Subramanian showed match rights are the key moderator | Miss the interaction that matters most |
| **Competing bid identification** | The primary label depends on this | Wrong labels ruin the entire study |
| **Point-in-time discipline** | Look-ahead bias is the #1 destroyer of backtests | Results look great, real trading loses money |
| **Manual review of positive cases** | Only ~200 deals received higher bids — each one matters | A few mislabeled positives distort everything |
| **Time-based train/test splits** | M&A regimes change over time; random splits overfit | Overstate predictive power |
| **Pre-signing auction history** | Whether there was a pre-signing market check is critical context for interpreting go-shop effectiveness | Conflate auction-process go-shops with protective go-shops |
| **Two-tier termination fee structures** | Go-shop period may have different (lower) fee; ignoring this understates the economic incentive for competing bids | Misattribute go-shop effectiveness |

---

## 13. Appendices

### A. Minimal Viable Version (MVP)

If we need to ship something fast, here's the smallest useful version:

**MVP scope: 500 deals, stock-only, go-shop focus**

1. Manually identify ~500 deals from 2019-2025 (most recent, best data)
2. Extract go-shop/no-shop status and termination fees ONLY (skip other clauses)
3. Pull daily stock data from Polygon (no options data)
4. Label outcomes: higher bid received or not
5. Run the base-rate analysis and logistic regression

**MVP timeline:** 4-6 weeks
**MVP cost:** $0 (Claude CLI + Polygon existing plan)

**What MVP gives you:** Answers the core question — do go-shops predict topping bids in recent data? — without the full infrastructure.

**What MVP misses:** Options analysis, full clause architecture, historical depth, regime analysis, trade-expression analysis.

### B. Recommended Full Version

The full implementation as described in this document:

- **3,200+ deals** from 2016-2026
- **Complete clause extraction** for all deals with merger agreements
- **Full options analysis** for 2019+ deals
- **All five study parts** (A through E)
- **Productionized** higher-bid scoring for live deals

**Full timeline:** 14-16 weeks
**Full cost:** ~$0 incremental (Claude CLI for extraction, Polygon plan already paid)

### C. Top 5 Research Questions After the Higher-Bid Study

1. **Regulatory risk pricing:** Do merger spreads correctly price the probability of regulatory challenge? (Use our regulatory event taxonomy + market data to build a calibrated regulatory risk model.)

2. **Optimal spread entry timing:** When is the best time to enter a merger-arb position — at announcement, after go-shop expires, after HSR clearance, or after proxy filing? (Survival analysis of deal breaks by milestone.)

3. **CVR mispricing:** Are contingent value rights (CVRs) systematically mispriced? What is the realized value of CVRs vs their market price? (Requires adding CVR market data tracking.)

4. **Merger-arb factor exposure:** What systematic risk factors explain merger-arb returns? (Build a factor model using deal characteristics + market regimes.)

5. **Deal-break prediction:** Can we predict which deals will break before the market prices the risk? (The inverse of the higher-bid question — equally valuable, larger sample of positive cases.)

### D. Top 10 Mistakes That Would Ruin Research Integrity

1. **Using Bloomberg/SDC deal data without verifying against SEC filings.** Third-party databases have errors. Our database is built from primary sources for a reason.

2. **Defining "higher bid" loosely.** If the label is fuzzy (e.g., counting 0.1% price adjustments as "higher bids"), the entire study is noise. Use explicit thresholds and report sensitivity.

3. **Look-ahead bias in feature construction.** Computing features using information that was not public on the feature date. The most common form: using the FINAL deal terms to compute features for the ENTIRE deal life.

4. **Treating go-shop as a single variable.** Go-shop × match rights, go-shop × window length, go-shop × fee structure all matter. A single binary variable misses the interaction effects that Subramanian documented.

5. **Ignoring the pre-signing process.** A deal that went through a full pre-signing auction and then includes a go-shop is VERY different from a deal where the buyer demanded exclusivity from day one. The background section of the proxy reveals the pre-signing process.

6. **Random cross-validation instead of temporal.** M&A regimes change. A model trained on random 80% of 2016-2025 data and tested on the remaining 20% will overfit to regime-spanning patterns. ONLY use time-based splits.

7. **Ignoring class imbalance.** With ~5-8% positive rate, a model that predicts "no higher bid" for everything is 92-95% accurate. Use proper class-weighted evaluation (AUC-PR, not accuracy).

8. **Not manually verifying the positive cases.** The ~200 deals that DID receive higher bids are worth more to the study than the ~3,000 that didn't. Every one must be manually verified.

9. **Assuming options markets are efficient or inefficient before testing.** The study must TEST efficiency, not assume it. Define specific testable predictions of efficiency and inefficiency, then let the data adjudicate.

10. **Over-engineering the schema before collecting data.** Start with the MVP, discover what data actually exists and what's hard to extract, then iterate the schema. The plan in this document is comprehensive, but implementation should be incremental.

### E. Example: How a Deal Lifecycle Looks in the Database

**Deal: Figma acquisition by Adobe (2022-2024)**

```
research_deals:
  deal_key: "2022-FIGM-ADBE"
  target_ticker: FIGM (private — actually this was private, bad example)
```

**Better example: Activision Blizzard acquisition by Microsoft (2022-2023)**

```
research_deals:
  deal_key: "2022-ATVI-MSFT"
  target_ticker: ATVI
  acquirer_name: Microsoft Corporation
  acquirer_type: strategic_public
  deal_type: merger
  deal_structure: all_cash
  announced_date: 2022-01-18
  expected_close_date: 2023-06-30
  actual_close_date: 2023-10-13
  outcome: closed
  initial_deal_value_mm: 68700.00
  initial_premium_1d_pct: 45.3

research_deal_clauses:
  has_go_shop: FALSE
  no_shop_strength: standard
  fiduciary_out: TRUE
  fiduciary_out_type: superior_proposal_only
  has_match_right: TRUE
  match_right_days: 4
  target_termination_fee_mm: 2500
  target_termination_fee_pct: 3.64
  acquirer_termination_fee_mm: 3000
  acquirer_termination_fee_pct: 4.37
  requires_hsr: TRUE
  requires_cfius: FALSE
  requires_eu_merger: TRUE
  regulatory_complexity: extreme

research_deal_events (selected):
  2022-01-18  ANNOUNCEMENT/initial_announcement     "Microsoft to acquire ATVI for $95/share"
  2022-02-01  REGULATORY/hsr_filing                  "HSR filing submitted"
  2022-03-01  LEGAL/litigation_filed                 "Shareholder lawsuit challenging price"
  2022-04-26  SHAREHOLDER/proxy_filed                "PREM14A filed"
  2022-07-06  SHAREHOLDER/definitive_proxy           "DEFM14A filed"
  2022-12-08  REGULATORY/ftc_challenge               "FTC sues to block acquisition"
  2023-01-01  REGULATORY/eu_phase2_investigation     "EU opens Phase 2 investigation"
  2023-04-21  SHAREHOLDER/vote_approved              "Shareholders approve, 98% for"
  2023-05-15  REGULATORY/eu_clearance_conditions     "EU approves with cloud gaming remedy"
  2023-07-11  LEGAL/injunction_denied                "FTC injunction denied by Judge Corley"
  2023-07-14  REGULATORY/regulatory_block            "CMA blocks acquisition"
  2023-08-22  TIMELINE/outside_date_extended          "Outside date extended to Oct 18"
  2023-08-21  PRICE_CHANGE/consideration_change       "Restructured: ATVI divests cloud rights to Ubisoft"
  2023-09-22  REGULATORY/regulatory_remedy            "CMA provisionally approves restructured deal"
  2023-10-13  COMPLETION/closing                      "Deal closes at $95/share"

research_deal_consideration:
  v1: 2022-01-18  cash_per_share=$95.00  total=$68,700M  (original bid)
  v2: 2023-08-21  cash_per_share=$95.00  total=$68,700M  (same price, restructured terms)

research_deal_outcomes:
  received_higher_bid: FALSE
  received_competing_bid: FALSE
  deal_completed: TRUE
  terms_amended: TRUE (restructured for CMA)
  days_to_close: 634
  close_date_vs_expected: +105 days
  announcement_return_1d: +25.8%
  stock_return_t1_to_close: +7.2%
```

---

## Implementation Notes for the Deal-Intel Agent

### Agent orchestration strategy

This plan should be implemented by the deal-intel agent coordinating with:

- **ops-deploy**: For database migrations and production deployment
- **dashboard-ui**: For building research data viewing interfaces (Phase 6)
- **deal-intel** (self): For all EDGAR scraping, extraction, and analysis work

### Key implementation decisions

1. **All extraction uses Claude CLI** (`claude -p` with Opus) — $0 marginal cost via Max subscription
2. **Database migrations** follow the existing pattern: `python-service/migrations/060_research_database.sql` and sequential
3. **Polygon API calls** use the existing `PolygonOptionsClient` class, extended with historical aggregates
4. **EDGAR API calls** use the existing EDGAR monitoring infrastructure, extended with EFTS historical search
5. **The research pipeline is a new Python module**: `python-service/app/research/` with submodules for universe construction, extraction, market data, features, and analysis
6. **Feature computation** produces a flat CSV/parquet for analysis — the research_deals tables are the source of truth, but analysis works on denormalized feature matrices

### File structure

```
python-service/app/research/
├── __init__.py
├── universe/
│   ├── edgar_scraper.py          -- EFTS + full-index historical scraping
│   ├── deal_identifier.py        -- grouping filings into deals
│   └── deduplicator.py           -- merging and deduplicating
├── extraction/
│   ├── clause_extractor.py       -- LLM-powered clause extraction
│   ├── event_extractor.py        -- event extraction from filings
│   ├── consideration_parser.py   -- price/terms versioning
│   └── prompts.py                -- extraction prompt templates
├── market_data/
│   ├── stock_loader.py           -- Polygon daily stock data
│   ├── options_loader.py         -- Polygon options data
│   └── context_loader.py         -- VIX, S&P, rates
├── features/
│   ├── static_features.py        -- deal-level features
│   ├── dynamic_features.py       -- time-varying features
│   ├── market_features.py        -- market-implied features
│   ├── text_features.py          -- filing-derived features
│   └── feature_matrix.py         -- assembles the full matrix
├── analysis/
│   ├── base_rates.py             -- descriptive statistics
│   ├── models.py                 -- logistic, XGBoost, Cox
│   ├── options_study.py          -- options market analysis
│   ├── trade_analysis.py         -- strategy backtesting
│   └── reporting.py              -- tables, figures, write-up
└── qa/
    ├── coverage_checks.py        -- data completeness
    ├── consistency_checks.py     -- logical consistency
    └── review_queue.py           -- human review management
```

### Environment variables

```bash
# Already configured:
POLYGON_API_KEY=...          # existing
DATABASE_URL=...             # existing
USE_CLI_ASSESSMENT=true      # existing

# New:
RESEARCH_BATCH_SIZE=50       # deals to process per batch
RESEARCH_EXTRACTION_MODEL=opus  # or sonnet for speed
SEC_USER_AGENT="DR3 Research research@dr3-dashboard.com"  # required by SEC
```

### Existing codebase gaps to address during implementation

These issues were identified during pre-implementation research and should be fixed as part of the project:

1. **No EFTS implementation exists** — Despite references in docs/memory, there is zero code calling `efts.sec.gov`. The EDGAR monitor uses RSS feeds only; the portfolio watcher uses CIK-based submissions API. EFTS search is entirely new code for this project.

2. **Two separate filing tables with no linkage** — `edgar_filings` (discovery pipeline) and `portfolio_edgar_filings` (portfolio watcher) store filings independently. The `research_deal_filings` table will unify these under a single `accession_number` key.

3. **Stale model IDs** — `extractor.py` and `deal_research_generator.py` both use `claude-sonnet-4-20250514` (Sonnet 4.5). Should be `claude-sonnet-4-6`. Fix during Phase 3.

4. **Filing extractor not used by filing_impact.py** — `filing_extractor.py` exists but `filing_impact.py` sends raw first-50K-chars to the LLM rather than targeted sections. The research pipeline should use the section extractor for efficient context.

5. **No exhibit/attachment parsing** — Current system fetches primary documents only. Merger agreements are typically filed as exhibits to 8-K (Exhibit 2.1). The research pipeline must fetch exhibits specifically.

6. **RSS poller has narrower type coverage than portfolio watcher** — The RSS poller misses SC TO-I, DEFC14A, DFAN14A, DEFA14A, SC 13D, SC 13G. Not critical for the research project (we use master index) but worth aligning.

7. **No filing content caching** — Every SEC.gov access is a fresh HTTP request. For 30K+ historical filings, we need local caching (disk-based, keyed by accession number).

8. **Historical options: no greeks from Polygon** — Polygon does not store historical greeks or IV. We must self-compute IV from OHLCV + Black-Scholes inversion. This is the most compute-intensive part of Phase 4.

---

### F. Key Academic References

A full literature review was written during plan preparation and is available at
`research/higher-bid-literature-review.md`. Key papers for this study:

| Paper | Key Finding | Relevance |
|-------|-------------|-----------|
| Subramanian & Zhao (2020), Harvard Law Review 133 | Go-shop jump rates declined 12.5%→4.3%; match rights, shorter windows, and banker conflicts explain the decline | **Core study reference** — our study will validate/extend with our own data |
| Betton, Eckbo, Thorburn (2008), Handbook of Empirical Corporate Finance | ~5% public competing bid rate across 35K+ US takeover contests 1980-2005 | Base rate benchmark |
| Boone & Mulherin (2007), JFE | ~50% of targets auctioned privately pre-public; private process shapes post-announcement dynamics | Background section extraction is essential |
| Van Tassel (2016), NY Fed Staff Report 761 | Dynamic model using joint stock+option prices to forecast deal outcomes; options contain predictive content beyond stock | Options-implied probability methodology |
| Bester, Martinez, Rosu (2023), JFEC | MCMC state-space model; target IV kink at offer price proportional to success probability | IV analysis methodology |
| Officer (2003), JFE | Termination fees only weakly deter competing bids; deals WITH fees have higher premiums | Challenges conventional wisdom on fee deterrence |
| Bates & Lemmon (2003), JFE | Termination fees are efficient contracting devices | Fee calibration analysis |
| Restrepo & Subramanian (2017), JLE | UK banned deal protections in 2011; M&A volumes dropped ~50% with no benefits | Natural experiment on protection value |
| Mitchell & Pulvino (2001), JF | 4% excess annual merger arb returns; returns resemble selling uncovered index puts | Market efficiency baseline |
| Baker & Savasoglu (2002), JFE | 7-11% abnormal annual returns; driven by limited arbitrage capital | Limited arbitrage framework |
| Gorbenko & Malenko (2014), JF | Strategic bidders value targets higher in 77.6% of cases; PE higher in 22.4% | Buyer-type decomposition |
| Braun, Han, Wang (2023), FRL | Neural nets achieve 78-79% accuracy on deal completion prediction | ML methodology benchmark |

**The novel contribution:** No published model specifically predicts COMPETING BIDS. All existing work
predicts deal completion or target identification. Our study fills this gap.

---

*This plan was produced by the deal-intel agent after comprehensive analysis of the existing codebase (55+ migration files, 18 table categories), SEC EDGAR capabilities (EFTS, master index, submissions API), Polygon API documentation (6 endpoint families, options chain reconstruction feasibility), and academic M&A research literature (20+ papers). Five parallel research agents contributed findings. It is designed to be implemented incrementally, starting with the MVP (Phase 1 + simplified Phase 5) and building to the full version.*
