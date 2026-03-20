-- Migration 057: Additional deal attributes for research database
-- Adds fields identified in gap analysis: target listing status, non-binding offers,
-- activist involvement, CVR/earnout detail, cash distribution deals, litigation detail,
-- toehold stakes, shareholder approval thresholds, tax treatment, and more.

BEGIN;

-- ============================================================================
-- research_deals — New columns on master deal record
-- ============================================================================

-- Target listing classification
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS target_listing_status VARCHAR(30)
    CHECK (target_listing_status IN (
        'us_domestic',           -- US company listed on US exchange
        'us_foreign_private',    -- Foreign company listed in US (F-20 filer, ADR)
        'otc',                   -- OTC Markets (Pink Sheets, OTCQX, OTCQB)
        'other',
        NULL
    ));
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS target_incorporation VARCHAR(30);  -- State/country: Delaware, New York, etc.
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS is_foreign_private_issuer BOOLEAN;

-- Deal dynamics
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS is_non_binding_offer BOOLEAN DEFAULT FALSE;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS is_cash_distribution BOOLEAN DEFAULT FALSE;  -- majority sold, cash returned via dividend/distribution
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS is_bankruptcy_363 BOOLEAN DEFAULT FALSE;      -- Section 363 sale in bankruptcy
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS has_earnout BOOLEAN DEFAULT FALSE;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS has_activist_involvement BOOLEAN DEFAULT FALSE;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS buyer_attempted_walkaway BOOLEAN DEFAULT FALSE;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS mac_invoked BOOLEAN DEFAULT FALSE;

-- Acquirer pre-existing position
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS acquirer_toehold_pct NUMERIC(6,2);  -- % owned before announcement

-- Shareholder vote
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS shareholder_approval_threshold VARCHAR(20)
    CHECK (shareholder_approval_threshold IN (
        'simple_majority',    -- >50%
        'supermajority',      -- 66.7% or higher
        'tender_majority',    -- tender offer threshold (typically 50%+)
        'written_consent',    -- no vote needed
        'not_required',
        NULL
    ));

-- Tax treatment
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20)
    CHECK (tax_treatment IN (
        'taxable',
        'tax_free',
        'mixed',              -- partially taxable (e.g., cash + stock)
        NULL
    ));


-- ============================================================================
-- research_deal_clauses — New columns for deal protection detail
-- ============================================================================

-- CVR detail (expand beyond has_cvr boolean)
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS cvr_description TEXT;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS cvr_trigger_type VARCHAR(30);  -- regulatory_approval, milestone, revenue, litigation
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS cvr_max_value NUMERIC(15,2);
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS cvr_expiration_date DATE;

-- Earnout detail
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS has_earnout BOOLEAN;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS earnout_max_value_mm NUMERIC(15,2);
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS earnout_description TEXT;

-- Appraisal / dissenter rights
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS appraisal_rights_available BOOLEAN;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS appraisal_state VARCHAR(5);  -- jurisdiction (DE, NY, etc.)

-- Golden parachute / management alignment
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS has_golden_parachute BOOLEAN;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS management_retention_agreements BOOLEAN;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS golden_parachute_total_mm NUMERIC(15,2);

-- Specific performance vs damages
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS target_has_specific_performance BOOLEAN;
ALTER TABLE research_deal_clauses ADD COLUMN IF NOT EXISTS acquirer_has_specific_performance BOOLEAN;


-- ============================================================================
-- research_deal_events — Expand event taxonomy
-- Add these as comments (events are free-form varchar, not enum-constrained):
--
-- NEW event types/subtypes to use:
--   ACTIVIST: activist_stake_disclosed, activist_opposition, activist_campaign,
--             activist_settlement, activist_board_seats
--   WALKAWAY: mac_invocation, buyer_walkaway_attempt, buyer_walkaway_litigation,
--             specific_performance_suit
--   ARBITRATION: arbitration_filed, arbitration_ruling, arbitration_settlement
--   LEGAL (expanded): shareholder_litigation, regulatory_litigation,
--                      counterparty_litigation, appraisal_petition
-- ============================================================================

-- Add litigation_party_type for richer legal event tracking
ALTER TABLE research_deal_events ADD COLUMN IF NOT EXISTS litigation_party_type VARCHAR(30);
-- Values: 'shareholder', 'regulator_doj', 'regulator_ftc', 'regulator_state_ag',
--         'regulator_sec', 'counterparty', 'target_board', 'acquirer', 'other'

ALTER TABLE research_deal_events ADD COLUMN IF NOT EXISTS is_arbitration BOOLEAN DEFAULT FALSE;
ALTER TABLE research_deal_events ADD COLUMN IF NOT EXISTS activist_name TEXT;


-- ============================================================================
-- Indexes for new filterable columns
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_research_deals_listing ON research_deals (target_listing_status)
    WHERE target_listing_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_deals_activist ON research_deals (has_activist_involvement)
    WHERE has_activist_involvement = true;
CREATE INDEX IF NOT EXISTS idx_research_deals_walkaway ON research_deals (buyer_attempted_walkaway)
    WHERE buyer_attempted_walkaway = true;
CREATE INDEX IF NOT EXISTS idx_research_deals_tax ON research_deals (tax_treatment)
    WHERE tax_treatment IS NOT NULL;

COMMIT;
