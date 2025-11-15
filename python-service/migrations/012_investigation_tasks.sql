-- Migration 012: Investigation Tasks Support
-- Modifies alert_notifications to support investigation tasks without requiring deal_id
-- This enables automatic investigation of all material news halts

-- 1. Make deal_id nullable (investigation tasks don't have a deal yet)
ALTER TABLE alert_notifications ALTER COLUMN deal_id DROP NOT NULL;

-- 2. Make alert_channel nullable (not needed for investigation tasks)
ALTER TABLE alert_notifications ALTER COLUMN alert_channel DROP NOT NULL;

-- 3. Add metadata column for flexible data storage
ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. Add title column for task summaries
ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS title TEXT;

-- 5. Add severity column for prioritization
ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'high';

-- 6. Add message column (distinct from alert_body for investigation guidance)
ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS message TEXT;

-- 7. Update constraints to allow 'halt_investigation' and 'halt_alert' types
ALTER TABLE alert_notifications DROP CONSTRAINT IF EXISTS valid_alert_type;
ALTER TABLE alert_notifications ADD CONSTRAINT valid_alert_type
    CHECK (alert_type IN (
        'deal_announcement',
        'status_change',
        'material_event',
        'halt_investigation',
        'halt_alert'
    ));

-- 8. Update valid status values to include investigation workflows
ALTER TABLE alert_notifications DROP CONSTRAINT IF EXISTS valid_alert_status;
ALTER TABLE alert_notifications ADD CONSTRAINT valid_alert_status
    CHECK (status IN ('pending', 'sent', 'failed', 'reviewed', 'dismissed'));

-- 9. Update alert_channel constraint to be nullable-aware
ALTER TABLE alert_notifications DROP CONSTRAINT IF EXISTS valid_alert_channel;
ALTER TABLE alert_notifications ADD CONSTRAINT valid_alert_channel
    CHECK (alert_channel IS NULL OR alert_channel IN ('email', 'sms', 'webhook'));

-- 10. Add severity constraint
ALTER TABLE alert_notifications ADD CONSTRAINT valid_severity
    CHECK (severity IN ('low', 'medium', 'high', 'critical'));

-- 11. Create index on metadata for ticker lookups (investigation tasks)
CREATE INDEX IF NOT EXISTS idx_alert_notifications_metadata_ticker
    ON alert_notifications((metadata->>'ticker'));

-- 12. Create index on alert_type and status for filtering tasks
CREATE INDEX IF NOT EXISTS idx_alert_notifications_type_status
    ON alert_notifications(alert_type, status);

-- 13. Create index on severity for prioritization
CREATE INDEX IF NOT EXISTS idx_alert_notifications_severity
    ON alert_notifications(severity);

-- 14. Update the unique constraint to only apply when deal_id is present
DROP INDEX IF EXISTS idx_alert_notifications_unique_deal_type;
CREATE UNIQUE INDEX idx_alert_notifications_unique_deal_type
    ON alert_notifications(deal_id, alert_type)
    WHERE status = 'sent' AND deal_id IS NOT NULL;

-- 15. Add comment documenting the dual purpose
COMMENT ON TABLE alert_notifications IS
    'Stores both: (1) Deal-specific alerts sent to recipients, (2) Investigation tasks for untracked material news halts';

COMMENT ON COLUMN alert_notifications.deal_id IS
    'Optional: NULL for investigation tasks, populated for deal-specific alerts';

COMMENT ON COLUMN alert_notifications.metadata IS
    'For investigation tasks: stores ticker, halt_code, halt_time, company_name, exchange, etc.';

COMMENT ON COLUMN alert_notifications.title IS
    'Short summary for investigation tasks (e.g., "Investigate Halt: ABCD - News Pending")';

COMMENT ON COLUMN alert_notifications.message IS
    'Investigation guidance or alert content';

COMMENT ON COLUMN alert_notifications.severity IS
    'Priority level: high (tracked deal alerts), medium (investigation tasks), low (info)';
