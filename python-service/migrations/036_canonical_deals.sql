-- 036_canonical_deals.sql
-- Canonical deal model: unified deal entity, milestone timeline, and risk grades.
-- Phase A (dual-write): sits alongside existing tables, populated via sync functions.

-- ---------------------------------------------------------------
-- Milestone type enum
-- ---------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE milestone_type AS ENUM (
        'announcement',
        'hsr_filing',
        'hsr_clearance',
        'hsr_second_request',
        'eu_phase1',
        'eu_phase2',
        'cfius_filing',
        'cfius_clearance',
        'other_regulatory',
        'proxy_filing',
        'shareholder_vote',
        'go_shop_start',
        'go_shop_end',
        'financing_committed',
        'closing',
        'outside_date',
        'termination',
        'extension',
        'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE milestone_status AS ENUM (
        'pending',
        'completed',
        'failed',
        'extended',
        'waived'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------
-- canonical_deals — unified deal entity
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_deals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker                  VARCHAR(10) NOT NULL UNIQUE,

    -- Core identification
    target_name             TEXT,
    acquiror_name           TEXT,
    deal_structure          VARCHAR(50),         -- All-cash, Cash & Stock, etc.

    -- Pricing
    deal_price              NUMERIC(12,4),
    current_price           NUMERIC(12,4),

    -- Key dates
    announced_date          DATE,
    expected_close_date     DATE,
    outside_date            DATE,

    -- Deal terms
    cash_per_share          NUMERIC(12,4),
    stock_ratio             TEXT,
    stock_per_share         NUMERIC(12,4),
    dividends_other         NUMERIC(12,4),
    termination_fee         TEXT,
    termination_fee_pct     NUMERIC(6,4),

    -- Consideration (JSONB for type flexibility)
    -- {type, per_share, exchange_ratio, cvrs[], collar{}, election{}}
    consideration           JSONB,

    total_deal_value_mm     NUMERIC(15,2),

    -- Status
    status                  VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, closed, broke, withdrawn
    has_cvr                 BOOLEAN DEFAULT FALSE,
    sheet_investable        TEXT,
    investable_flag         BOOLEAN,

    -- Go shop
    go_shop_text            TEXT,
    go_shop_end_date        DATE,

    -- Detail tab reference
    sheet_detail_gid        VARCHAR(20),

    -- Qualitative fields from detail tab
    regulatory_approvals    TEXT,
    shareholder_vote        TEXT,
    financing_details       TEXT,
    mac_clauses             TEXT,
    closing_conditions      TEXT,
    target_business_desc    TEXT,

    -- Probability & risk from sheet
    sheet_prob_success      NUMERIC(6,4),
    sheet_break_price       NUMERIC(12,4),

    -- Cross-references to existing tables
    prisma_deal_id          UUID,
    intelligence_deal_id    UUID,

    -- Provenance: tracks source of each field group
    data_provenance         JSONB DEFAULT '{}',
    -- e.g. {"deal_price": {"source": "sheet", "date": "2026-02-24", "confidence": 0.9}}

    -- Sync timestamps
    sheet_last_updated      TIMESTAMPTZ,
    detail_last_updated     TIMESTAMPTZ,
    filing_last_updated     TIMESTAMPTZ,
    ai_last_assessed        TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- canonical_deal_milestones — timeline graph
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_deal_milestones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL REFERENCES canonical_deals(ticker) ON DELETE CASCADE,
    milestone_type      milestone_type NOT NULL,
    milestone_date      DATE,
    expected_date       DATE,
    status              milestone_status NOT NULL DEFAULT 'pending',
    source              VARCHAR(30),         -- sheet, filing, halt, ai, manual
    source_id           TEXT,                -- FK to source table (filing id, halt id, etc.)
    depends_on          UUID[],              -- IDs of prerequisite milestones
    risk_factor_affected TEXT,               -- which risk factor this milestone impacts
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate milestones of same type for same deal
    UNIQUE (ticker, milestone_type, COALESCE(milestone_date, '1970-01-01'))
);

-- ---------------------------------------------------------------
-- canonical_risk_grades — latest grades from all sources
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_risk_grades (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker                      VARCHAR(10) NOT NULL REFERENCES canonical_deals(ticker) ON DELETE CASCADE,
    assessed_date               DATE NOT NULL,

    -- Sheet grades (from sheet_rows)
    sheet_vote_grade            TEXT,
    sheet_financing_grade       TEXT,
    sheet_legal_grade           TEXT,

    -- AI grades with confidence and detail
    ai_vote_grade               TEXT,
    ai_vote_confidence          NUMERIC(4,3),
    ai_vote_detail              TEXT,
    ai_financing_grade          TEXT,
    ai_financing_confidence     NUMERIC(4,3),
    ai_financing_detail         TEXT,
    ai_legal_grade              TEXT,
    ai_legal_confidence         NUMERIC(4,3),
    ai_legal_detail             TEXT,
    ai_regulatory_grade         TEXT,
    ai_regulatory_confidence    NUMERIC(4,3),
    ai_regulatory_detail        TEXT,
    ai_mac_grade                TEXT,
    ai_mac_confidence           NUMERIC(4,3),
    ai_mac_detail               TEXT,

    -- Supplemental scores (AI only)
    ai_market_score             NUMERIC(4,2),
    ai_timing_score             NUMERIC(4,2),
    ai_competing_bid_score      NUMERIC(4,2),

    -- Probabilities
    sheet_prob_success          NUMERIC(6,4),
    ai_prob_success             NUMERIC(6,4),
    ai_prob_success_confidence  NUMERIC(4,3),

    -- Break price
    sheet_break_price           NUMERIC(12,4),
    ai_break_price              NUMERIC(12,4),

    -- Disagreement counts
    disagreement_count          INTEGER DEFAULT 0,
    material_disagreement_count INTEGER DEFAULT 0,

    -- Full AI response for detail access
    ai_response                 JSONB,

    -- Source assessment reference
    risk_assessment_id          UUID,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (ticker, assessed_date)
);

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------

-- canonical_deals
CREATE INDEX IF NOT EXISTS idx_canonical_deals_status
    ON canonical_deals (status);

CREATE INDEX IF NOT EXISTS idx_canonical_deals_updated
    ON canonical_deals (updated_at DESC);

-- canonical_deal_milestones
CREATE INDEX IF NOT EXISTS idx_canonical_milestones_ticker
    ON canonical_deal_milestones (ticker);

CREATE INDEX IF NOT EXISTS idx_canonical_milestones_status
    ON canonical_deal_milestones (ticker, status)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_canonical_milestones_type
    ON canonical_deal_milestones (milestone_type);

-- canonical_risk_grades
CREATE INDEX IF NOT EXISTS idx_canonical_grades_ticker_date
    ON canonical_risk_grades (ticker, assessed_date DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_grades_date
    ON canonical_risk_grades (assessed_date DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_grades_disagreements
    ON canonical_risk_grades (assessed_date, material_disagreement_count DESC)
    WHERE material_disagreement_count > 0;
