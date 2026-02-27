-- Fix FK constraints on deal_risk_assessments child tables.
-- The upsert in engine.py previously did `SET id = EXCLUDED.id` on conflict,
-- which changed the PK of existing rows. Child tables blocked this with RESTRICT.
-- Even though we've removed `id = EXCLUDED.id`, adding CASCADE is a safety net
-- and also enables clean assessment deletion without orphan cleanup.

-- risk_factor_changes: lifecycle tied to assessment
ALTER TABLE risk_factor_changes
    DROP CONSTRAINT IF EXISTS risk_factor_changes_assessment_id_fkey,
    ADD CONSTRAINT risk_factor_changes_assessment_id_fkey
        FOREIGN KEY (assessment_id) REFERENCES deal_risk_assessments(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

-- human_review_items: lifecycle tied to assessment
ALTER TABLE human_review_items
    DROP CONSTRAINT IF EXISTS human_review_items_assessment_id_fkey,
    ADD CONSTRAINT human_review_items_assessment_id_fkey
        FOREIGN KEY (assessment_id) REFERENCES deal_risk_assessments(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

-- deal_predictions: own lifecycle (open/resolved/expired), survive assessment deletion
ALTER TABLE deal_predictions
    DROP CONSTRAINT IF EXISTS deal_predictions_assessment_id_fkey,
    ADD CONSTRAINT deal_predictions_assessment_id_fkey
        FOREIGN KEY (assessment_id) REFERENCES deal_risk_assessments(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
