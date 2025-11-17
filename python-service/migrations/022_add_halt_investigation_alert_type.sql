-- Add 'halt_investigation' to alert_type constraint
-- Migration: 022_add_halt_investigation_alert_type.sql
-- Allows halt monitor to create investigation tasks in alert_notifications table

-- Drop the old constraint
ALTER TABLE alert_notifications DROP CONSTRAINT IF EXISTS valid_alert_type;

-- Add the new constraint with 'halt_investigation' included
ALTER TABLE alert_notifications ADD CONSTRAINT valid_alert_type
CHECK (alert_type IN ('deal_announcement', 'status_change', 'material_event', 'halt_investigation'));

-- Also need to modify the table schema to allow null deal_id and alert_channel for halt investigations
-- (halt investigations are not tied to specific deals initially, and don't always use alert channels)
ALTER TABLE alert_notifications ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE alert_notifications ALTER COLUMN alert_channel DROP NOT NULL;
