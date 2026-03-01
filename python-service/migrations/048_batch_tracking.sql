-- Migration 048: Batch tracking for orphan recovery
-- Records active batch_id on risk_assessment_runs so we can recover
-- costs from batches that completed while the container was restarting.

ALTER TABLE risk_assessment_runs ADD COLUMN IF NOT EXISTS batch_id VARCHAR(100);
