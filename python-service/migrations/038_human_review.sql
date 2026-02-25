-- 038_human_review.sql
-- Human review queue and annotation tables.
-- Idempotent (IF NOT EXISTS / ON CONFLICT safe).

-- ---------------------------------------------------------------
-- Review queue — items requiring human PM attention
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_review_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    review_date         DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Case type (why this is in the queue)
    case_type           VARCHAR(30) NOT NULL,
    -- Values: 'three_way_disagreement', 'significant_ai_change',
    --         'poor_prediction_score', 'new_milestone'

    -- Priority score (higher = review first)
    priority_score      NUMERIC(6,2) NOT NULL DEFAULT 50.0,

    -- Context snapshot (what the reviewer needs to see)
    context             JSONB NOT NULL DEFAULT '{}',

    -- Source references
    assessment_id       UUID REFERENCES deal_risk_assessments(id),
    prediction_id       UUID,

    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Values: 'pending', 'in_review', 'resolved', 'dismissed'
    assigned_to         VARCHAR(100),
    resolved_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_review_item UNIQUE (ticker, review_date, case_type)
);

CREATE INDEX IF NOT EXISTS idx_review_status
    ON human_review_items (status, priority_score DESC)
    WHERE status IN ('pending', 'in_review');

CREATE INDEX IF NOT EXISTS idx_review_date
    ON human_review_items (review_date DESC);

CREATE INDEX IF NOT EXISTS idx_review_ticker
    ON human_review_items (ticker, review_date DESC);

-- ---------------------------------------------------------------
-- Human annotations — corrections and judgments from the PM
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_annotations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_item_id      UUID NOT NULL REFERENCES human_review_items(id),
    ticker              VARCHAR(10) NOT NULL,
    annotation_date     DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Which signal was right?
    correct_signal      VARCHAR(20),
    -- Values: 'ai', 'sheet', 'options', 'none', 'partial'

    -- Grade corrections (NULL = no correction needed)
    corrected_grades    JSONB,

    -- Probability correction
    corrected_probability NUMERIC(6,4),
    probability_reasoning TEXT,

    -- Free-form reasoning the AI missed
    missed_reasoning    TEXT,

    -- Categorization of the error
    error_type          VARCHAR(30),
    -- Values: 'overconfident', 'underconfident', 'wrong_factor',
    --         'stale_data', 'missing_context', 'correct_no_change'

    -- How impactful was this error?
    impact              VARCHAR(10),
    -- Values: 'high', 'medium', 'low', 'none'

    annotated_by        VARCHAR(100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_ticker
    ON human_annotations (ticker, annotation_date DESC);

CREATE INDEX IF NOT EXISTS idx_annotations_error_type
    ON human_annotations (error_type);
