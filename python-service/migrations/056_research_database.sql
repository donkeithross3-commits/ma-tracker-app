-- Migration 056: Historical M&A Research Database
-- Creates the research_* table namespace for the 10-year historical deal database.
-- These tables support the higher-bid dynamics study and future M&A research.
--
-- Tables created:
--   research_deals              - Master deal record (~3,200 deals)
--   research_deal_clauses       - Deal protection terms (1:1 with deals)
--   research_deal_events        - Lifecycle event log (N per deal)
--   research_deal_consideration - Versioned price/terms (N per deal)
--   research_deal_filings       - SEC filing links (N per deal)
--   research_deal_parties       - Deal participants (N per deal)
--   research_deal_regulatory    - Regulatory milestones (N per deal)
--   research_market_daily       - Daily stock data (N per deal)
--   research_options_daily      - Daily options summary (N per deal)
--   research_options_chains     - Event-window chain snapshots (selective)
--   research_deal_outcomes      - Final outcome + research labels (1:1 with deals)

BEGIN;

-- ============================================================================
-- research_deals — Master deal record
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deals (
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
    acquirer_type       VARCHAR(30) NOT NULL
        CHECK (acquirer_type IN (
            'strategic_public', 'strategic_private', 'financial_sponsor',
            'consortium', 'management', 'government', 'spac', 'other'
        )),
    acquirer_group      JSONB,                 -- for consortium/club deals

    -- Deal classification
    deal_type           VARCHAR(30) NOT NULL
        CHECK (deal_type IN (
            'merger', 'tender_offer', 'tender_only',
            'asset_acquisition', 'scheme', 'other'
        )),
    deal_structure      VARCHAR(30) NOT NULL
        CHECK (deal_structure IN (
            'all_cash', 'all_stock', 'cash_and_stock',
            'cash_and_cvr', 'stock_and_cvr', 'cash_stock_cvr',
            'election', 'other'
        )),
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
    outcome             VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (outcome IN (
            'pending', 'closed', 'closed_amended', 'closed_higher_bid',
            'terminated_mutual', 'terminated_target', 'terminated_acquirer',
            'terminated_regulatory', 'terminated_vote', 'terminated_litigation',
            'terminated_financing', 'terminated_other', 'withdrawn'
        )),
    outcome_reason      TEXT,

    -- Value metrics (at announcement)
    initial_deal_value_mm   NUMERIC(15,2),
    initial_premium_1d_pct  NUMERIC(6,2),
    initial_premium_30d_pct NUMERIC(6,2),

    -- Data completeness tracking
    has_merger_agreement    BOOLEAN DEFAULT FALSE,
    has_proxy_statement     BOOLEAN DEFAULT FALSE,
    has_tender_offer        BOOLEAN DEFAULT FALSE,
    clause_extraction_status VARCHAR(20) DEFAULT 'pending'
        CHECK (clause_extraction_status IN ('pending', 'partial', 'complete', 'failed')),
    market_data_status      VARCHAR(20) DEFAULT 'pending'
        CHECK (market_data_status IN ('pending', 'partial', 'complete', 'failed')),

    -- Provenance
    discovery_source    VARCHAR(30),           -- edgar_master_idx, edgar_efts, manual, production_sync
    discovery_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_enriched       TIMESTAMPTZ,

    -- Cross-reference to production system
    production_deal_id  UUID,                  -- FK to deal_intelligence.deal_id if exists
    canonical_deal_id   UUID,                  -- FK to canonical_deals.id if exists

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_deals_ticker ON research_deals(target_ticker);
CREATE INDEX idx_research_deals_announced ON research_deals(announced_date DESC);
CREATE INDEX idx_research_deals_outcome ON research_deals(outcome);
CREATE INDEX idx_research_deals_type ON research_deals(deal_type, deal_structure);
CREATE INDEX idx_research_deals_cik ON research_deals(target_cik);
CREATE INDEX idx_research_deals_acquirer ON research_deals(acquirer_ticker);
CREATE INDEX idx_research_deals_discovery ON research_deals(discovery_source);


-- ============================================================================
-- research_deal_clauses — Deal protection terms (1:1 with deals)
-- The single most important table for the higher-bid study.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_clauses (
    deal_id                 UUID PRIMARY KEY REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    -- Go-shop / No-shop
    has_go_shop             BOOLEAN,
    go_shop_period_days     INTEGER,
    go_shop_start_date      DATE,
    go_shop_end_date        DATE,
    go_shop_bidder_emerged  BOOLEAN,
    post_go_shop_match      BOOLEAN,

    -- No-shop details (when no go-shop)
    no_shop_strength        VARCHAR(20),       -- standard, strong, weak
    fiduciary_out           BOOLEAN,
    fiduciary_out_type      VARCHAR(30),       -- superior_proposal_only, intervening_event, both
    superior_proposal_def   TEXT,
    window_shop_allowed     BOOLEAN,

    -- Match rights
    has_match_right         BOOLEAN,
    match_right_days        INTEGER,
    match_right_rounds      INTEGER,
    match_right_type        VARCHAR(30),       -- initial_only, unlimited, none

    -- Termination fees
    target_termination_fee_mm    NUMERIC(12,2),
    target_termination_fee_pct   NUMERIC(5,2),
    acquirer_termination_fee_mm  NUMERIC(12,2),
    acquirer_termination_fee_pct NUMERIC(5,2),
    two_tier_fee                 BOOLEAN,
    go_shop_fee_mm               NUMERIC(12,2),
    go_shop_fee_pct              NUMERIC(5,2),

    -- Force-the-vote
    force_the_vote          BOOLEAN,

    -- Financing conditions
    has_financing_condition BOOLEAN,
    financing_committed     BOOLEAN,
    financing_sources       TEXT[],

    -- Regulatory conditions
    requires_hsr            BOOLEAN,
    requires_cfius          BOOLEAN,
    requires_eu_merger      BOOLEAN,
    requires_other_regulatory TEXT[],
    regulatory_complexity   VARCHAR(20),       -- low, medium, high, extreme

    -- MAC clause
    mac_exclusion_breadth   VARCHAR(20),       -- narrow, standard, broad
    pandemic_carveout       BOOLEAN,
    industry_carveout       BOOLEAN,

    -- Collar provisions (stock deals)
    has_collar              BOOLEAN,
    collar_type             VARCHAR(20),       -- fixed_ratio, floating, symmetric, asymmetric
    collar_floor            NUMERIC(12,4),
    collar_ceiling          NUMERIC(12,4),
    walk_away_right         BOOLEAN,

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


-- ============================================================================
-- research_deal_events — Lifecycle event log (event-sourced)
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_events (
    event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    event_type          VARCHAR(50) NOT NULL,  -- ANNOUNCEMENT, PRICE_CHANGE, COMPETING_BID, etc.
    event_subtype       VARCHAR(50),
    event_date          DATE NOT NULL,
    event_time          TIME,
    event_timestamp     TIMESTAMPTZ,

    -- Event details
    summary             TEXT NOT NULL,
    details             JSONB,

    -- Price/value changes (when applicable)
    new_price           NUMERIC(12,4),
    old_price           NUMERIC(12,4),
    new_premium_pct     NUMERIC(6,2),
    price_change_pct    NUMERIC(6,2),

    -- Source attribution
    source_type         VARCHAR(30) NOT NULL,  -- filing, news, halt, manual, derived
    source_filing_accession VARCHAR(25),
    source_url          TEXT,
    source_text         TEXT,

    -- Competing bid tracking
    competing_bidder    TEXT,
    is_competing_bid    BOOLEAN DEFAULT FALSE,

    -- Ordering
    event_sequence      INTEGER,
    supersedes_event_id UUID,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_events_deal ON research_deal_events(deal_id, event_date);
CREATE INDEX idx_research_events_type ON research_deal_events(event_type, event_date);
CREATE INDEX idx_research_events_competing ON research_deal_events(deal_id)
    WHERE is_competing_bid = TRUE;
CREATE INDEX idx_research_events_source ON research_deal_events(source_filing_accession)
    WHERE source_filing_accession IS NOT NULL;


-- ============================================================================
-- research_deal_consideration — Versioned price/terms
-- Each amendment or topping bid creates a new row.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_consideration (
    consideration_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,
    version             INTEGER NOT NULL DEFAULT 1,

    -- Who is offering?
    bidder_name         TEXT NOT NULL,
    is_original_bidder  BOOLEAN DEFAULT TRUE,
    is_topping_bid      BOOLEAN DEFAULT FALSE,

    -- Terms
    cash_per_share      NUMERIC(12,4),
    stock_ratio         NUMERIC(12,6),
    stock_reference     VARCHAR(10),
    mixed_cash_pct      NUMERIC(5,2),
    cvr_value_est       NUMERIC(12,4),
    total_per_share     NUMERIC(12,4),
    total_deal_value_mm NUMERIC(15,2),

    -- Premium
    premium_to_prior_close  NUMERIC(6,2),
    premium_to_30d_avg      NUMERIC(6,2),
    premium_to_prior_bid    NUMERIC(6,2),

    -- Effective dates
    effective_date      DATE NOT NULL,
    announced_date      DATE NOT NULL,
    source_event_id     UUID REFERENCES research_deal_events(event_id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(deal_id, version)
);

CREATE INDEX idx_research_consideration_deal ON research_deal_consideration(deal_id, version);


-- ============================================================================
-- research_deal_filings — SEC filing links
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_filings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    -- Filing identification
    accession_number    VARCHAR(25) NOT NULL,
    filing_type         VARCHAR(20) NOT NULL,
    filing_date         DATE NOT NULL,
    filed_by_cik        VARCHAR(10),
    filed_by_name       TEXT,
    filed_by_role       VARCHAR(20),           -- target, acquirer, third_party

    -- Content
    filing_url          TEXT,
    primary_doc_url     TEXT,
    filing_description  TEXT,

    -- What we extracted from it
    extracted_fields    TEXT[],
    extraction_status   VARCHAR(20) DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'extracted', 'failed', 'skipped')),
    extraction_notes    TEXT,

    -- Classification
    is_merger_agreement BOOLEAN DEFAULT FALSE,
    is_amendment        BOOLEAN DEFAULT FALSE,
    is_supplement       BOOLEAN DEFAULT FALSE,
    amendment_number    INTEGER,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Accession number should be unique across the research database
    CONSTRAINT uq_research_filings_accession UNIQUE(accession_number)
);

CREATE INDEX idx_research_filings_deal ON research_deal_filings(deal_id, filing_date);
CREATE INDEX idx_research_filings_type ON research_deal_filings(filing_type);
CREATE INDEX idx_research_filings_cik ON research_deal_filings(filed_by_cik);


-- ============================================================================
-- research_deal_parties — Deal participants (buyers, targets, advisors)
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_parties (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    party_role          VARCHAR(30) NOT NULL
        CHECK (party_role IN (
            'target', 'acquirer', 'competing_bidder', 'white_knight',
            'target_advisor', 'acquirer_advisor', 'target_counsel',
            'acquirer_counsel', 'financing_source', 'other'
        )),
    party_name          TEXT NOT NULL,
    party_ticker        VARCHAR(10),
    party_cik           VARCHAR(10),

    -- Advisory details
    advisory_firm       TEXT,                  -- bank / law firm name
    advisory_role_detail TEXT,                 -- e.g., "lead financial advisor"

    -- For competing bidders
    bid_price           NUMERIC(12,4),
    bid_date            DATE,
    bid_outcome         VARCHAR(20),           -- won, lost, withdrawn

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_parties_deal ON research_deal_parties(deal_id);
CREATE INDEX idx_research_parties_role ON research_deal_parties(party_role);


-- ============================================================================
-- research_deal_regulatory — Regulatory milestone tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_regulatory (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    agency              VARCHAR(50) NOT NULL,  -- DOJ, FTC, CFIUS, EU_Commission, CMA, etc.
    review_type         VARCHAR(30) NOT NULL,  -- initial, second_request, phase2, etc.
    status              VARCHAR(30) NOT NULL
        CHECK (status IN (
            'filed', 'under_review', 'cleared', 'cleared_conditions',
            'challenged', 'blocked', 'withdrawn', 'expired'
        )),

    filed_date          DATE,
    decision_date       DATE,
    expected_date       DATE,

    conditions          JSONB,                 -- divestitures, behavioral remedies, etc.
    notes               TEXT,
    source_event_id     UUID REFERENCES research_deal_events(event_id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_regulatory_deal ON research_deal_regulatory(deal_id);
CREATE INDEX idx_research_regulatory_agency ON research_deal_regulatory(agency, status);


-- ============================================================================
-- research_market_daily — Daily stock data for deal windows
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_market_daily (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,
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
    deal_price_on_date  NUMERIC(12,4),
    gross_spread        NUMERIC(12,4),
    gross_spread_pct    NUMERIC(8,4),
    annualized_spread   NUMERIC(8,4),

    -- Context
    days_since_announce INTEGER,
    days_to_expected_close INTEGER,
    sp500_close         NUMERIC(12,4),
    vix_close           NUMERIC(8,4),

    -- Data source
    source              VARCHAR(20) DEFAULT 'polygon',

    UNIQUE(deal_id, ticker, trade_date)
);

CREATE INDEX idx_research_market_deal_date ON research_market_daily(deal_id, trade_date);
CREATE INDEX idx_research_market_ticker ON research_market_daily(ticker, trade_date);


-- ============================================================================
-- research_options_daily — Daily options summary per deal
-- One row per deal per day. Key signals without storing raw chains.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_options_daily (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,
    ticker              VARCHAR(10) NOT NULL,
    trade_date          DATE NOT NULL,

    -- Stock price context
    stock_close         NUMERIC(12,4),
    deal_price          NUMERIC(12,4),

    -- ATM implied volatility
    atm_call_iv         NUMERIC(8,4),
    atm_put_iv          NUMERIC(8,4),

    -- Skew metrics
    upside_call_iv      NUMERIC(8,4),
    downside_put_iv     NUMERIC(8,4),
    call_skew_25d       NUMERIC(8,4),
    put_skew_25d        NUMERIC(8,4),
    skew_ratio          NUMERIC(8,4),

    -- Volume and OI
    total_call_volume   INTEGER,
    total_put_volume    INTEGER,
    put_call_ratio      NUMERIC(8,4),
    total_call_oi       INTEGER,
    total_put_oi        INTEGER,

    -- Above-deal-price calls (higher-bid signal)
    above_deal_call_volume  INTEGER,
    above_deal_call_oi      INTEGER,
    above_deal_call_iv_avg  NUMERIC(8,4),

    -- Term structure
    front_month_iv      NUMERIC(8,4),
    back_month_iv       NUMERIC(8,4),
    term_structure_slope NUMERIC(8,4),

    -- Implied probabilities (computed features)
    impl_prob_deal_close    NUMERIC(6,4),
    impl_prob_higher_bid    NUMERIC(6,4),

    -- Data quality
    chain_depth         INTEGER,
    source              VARCHAR(20) DEFAULT 'polygon',

    UNIQUE(deal_id, ticker, trade_date)
);

CREATE INDEX idx_research_options_deal_date ON research_options_daily(deal_id, trade_date);


-- ============================================================================
-- research_options_chains — Event-window chain snapshots (selective storage)
-- Full chain snapshots only around key events. This is the large table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_options_chains (
    id                  BIGSERIAL PRIMARY KEY,
    deal_id             UUID NOT NULL REFERENCES research_deals(deal_id) ON DELETE CASCADE,
    ticker              VARCHAR(10) NOT NULL,
    snapshot_date       DATE NOT NULL,
    snapshot_reason     VARCHAR(30) NOT NULL,   -- announcement, topping_bid, regulatory, close, break, weekly

    -- Contract details
    contract_symbol     VARCHAR(30),            -- OCC symbol
    expiration_date     DATE NOT NULL,
    strike              NUMERIC(12,4) NOT NULL,
    option_type         CHAR(1) NOT NULL CHECK (option_type IN ('C', 'P')),

    -- Prices
    bid                 NUMERIC(10,4),
    ask                 NUMERIC(10,4),
    mid                 NUMERIC(10,4),
    last                NUMERIC(10,4),

    -- Greeks (self-computed from Black-Scholes for historical data)
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

CREATE INDEX idx_research_chains_deal_date ON research_options_chains(deal_id, snapshot_date);
CREATE INDEX idx_research_chains_ticker ON research_options_chains(ticker, snapshot_date);
CREATE INDEX idx_research_chains_reason ON research_options_chains(snapshot_reason);


-- ============================================================================
-- research_deal_outcomes — Final research labels (1:1 with deals)
-- Computed AFTER the deal concludes. The primary analysis target.
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_deal_outcomes (
    deal_id                 UUID PRIMARY KEY REFERENCES research_deals(deal_id) ON DELETE CASCADE,

    -- Primary labels
    received_higher_bid     BOOLEAN NOT NULL,
    received_competing_bid  BOOLEAN NOT NULL,
    deal_completed          BOOLEAN NOT NULL,
    terms_amended           BOOLEAN NOT NULL,

    -- Higher-bid details (when applicable)
    num_competing_bids      INTEGER DEFAULT 0,
    winning_bidder_type     VARCHAR(30),         -- original, topping, white_knight
    final_price             NUMERIC(12,4),
    initial_price           NUMERIC(12,4),
    price_improvement_pct   NUMERIC(6,2),
    days_to_first_competing INTEGER,
    competing_bid_during_go_shop BOOLEAN,

    -- Outcome timing
    days_to_close           INTEGER,
    close_date_vs_expected  INTEGER,

    -- Break details (when applicable)
    break_reason_primary    VARCHAR(50),
    break_reason_secondary  VARCHAR(50),
    termination_fee_paid    BOOLEAN,
    termination_fee_amount  NUMERIC(12,2),
    fee_paid_by             VARCHAR(20),

    -- Market impact labels
    announcement_return_1d  NUMERIC(8,4),
    announcement_return_5d  NUMERIC(8,4),
    spread_at_announcement  NUMERIC(8,4),
    max_spread_during_deal  NUMERIC(8,4),
    min_spread_during_deal  NUMERIC(8,4),

    -- Returns for different strategies
    stock_return_announce_to_close  NUMERIC(8,4),
    stock_return_t1_to_close        NUMERIC(8,4),
    excess_return_vs_sp500          NUMERIC(8,4),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- research_pipeline_runs — Track pipeline execution history
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_pipeline_runs (
    run_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_name       VARCHAR(50) NOT NULL,  -- universe_construction, clause_extraction, market_data, etc.
    phase               VARCHAR(30),           -- master_index, efts_search, entity_resolution, etc.

    status              VARCHAR(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,

    -- Progress tracking
    total_items         INTEGER,
    processed_items     INTEGER DEFAULT 0,
    failed_items        INTEGER DEFAULT 0,
    skipped_items       INTEGER DEFAULT 0,

    -- Results
    deals_created       INTEGER DEFAULT 0,
    deals_updated       INTEGER DEFAULT 0,
    filings_linked      INTEGER DEFAULT 0,
    events_created      INTEGER DEFAULT 0,

    -- Error tracking
    last_error          TEXT,
    error_details       JSONB,

    -- Configuration
    config              JSONB,                 -- parameters used for this run

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_pipeline_name ON research_pipeline_runs(pipeline_name, started_at DESC);


-- ============================================================================
-- research_filing_cache — Local cache of SEC filing content
-- Avoids re-downloading filings from SEC.gov
-- ============================================================================
CREATE TABLE IF NOT EXISTS research_filing_cache (
    accession_number    VARCHAR(25) PRIMARY KEY,
    filing_type         VARCHAR(20) NOT NULL,
    filing_url          TEXT NOT NULL,
    content_text        TEXT,                  -- extracted text content
    content_length      INTEGER,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extraction_method   VARCHAR(20),           -- html_to_text, raw, pdf
    has_exhibits        BOOLEAN DEFAULT FALSE,
    exhibit_urls        JSONB                  -- list of exhibit URLs identified
);

CREATE INDEX idx_research_cache_type ON research_filing_cache(filing_type);


-- ============================================================================
-- Updated timestamp trigger function (reuse existing if available)
-- ============================================================================
CREATE OR REPLACE FUNCTION research_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER trg_research_deals_updated
    BEFORE UPDATE ON research_deals
    FOR EACH ROW EXECUTE FUNCTION research_update_timestamp();

CREATE TRIGGER trg_research_clauses_updated
    BEFORE UPDATE ON research_deal_clauses
    FOR EACH ROW EXECUTE FUNCTION research_update_timestamp();

CREATE TRIGGER trg_research_regulatory_updated
    BEFORE UPDATE ON research_deal_regulatory
    FOR EACH ROW EXECUTE FUNCTION research_update_timestamp();

CREATE TRIGGER trg_research_outcomes_updated
    BEFORE UPDATE ON research_deal_outcomes
    FOR EACH ROW EXECUTE FUNCTION research_update_timestamp();


COMMIT;
