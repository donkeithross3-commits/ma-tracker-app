-- 037_deal_predictions.sql
-- Prediction registry: explicit, scoreable AI predictions per deal.
-- Idempotent (IF NOT EXISTS / ON CONFLICT safe).

-- ---------------------------------------------------------------
-- Prediction type enum
-- ---------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE prediction_type AS ENUM (
        'deal_closes',
        'milestone_completion',
        'spread_direction',
        'break_price',
        'next_event'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE prediction_status AS ENUM (
        'open',
        'resolved_correct',
        'resolved_incorrect',
        'resolved_partial',
        'superseded',
        'expired'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------
-- deal_predictions
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    assessment_id       UUID REFERENCES deal_risk_assessments(id),
    assessment_date     DATE NOT NULL,

    -- Prediction content
    prediction_type     prediction_type NOT NULL,
    claim               TEXT NOT NULL,
    by_date             DATE,
    probability         NUMERIC(5,4),
    confidence          NUMERIC(4,3),
    evidence            JSONB,

    -- Resolution
    status              prediction_status NOT NULL DEFAULT 'open',
    resolved_at         TIMESTAMPTZ,
    actual_outcome      BOOLEAN,
    actual_value        NUMERIC(12,4),
    resolution_source   VARCHAR(50),
    resolution_detail   TEXT,

    -- Scoring
    brier_score         NUMERIC(8,6),
    calibration_bucket  VARCHAR(10),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pred_ticker_date
    ON deal_predictions (ticker, assessment_date DESC);

CREATE INDEX IF NOT EXISTS idx_pred_open
    ON deal_predictions (ticker, prediction_type) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pred_resolved
    ON deal_predictions (calibration_bucket, status)
    WHERE status IN ('resolved_correct', 'resolved_incorrect', 'resolved_partial');

CREATE INDEX IF NOT EXISTS idx_pred_assessment
    ON deal_predictions (assessment_id);

CREATE INDEX IF NOT EXISTS idx_pred_expiry
    ON deal_predictions (by_date) WHERE status = 'open';
