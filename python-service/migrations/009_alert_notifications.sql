-- Alert Notifications Table
-- Migration: 009_alert_notifications.sql
-- Tracks which deals have been alerted to prevent duplicate notifications

CREATE TABLE IF NOT EXISTS alert_notifications (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,

    -- Alert details
    alert_type VARCHAR(50) NOT NULL,  -- 'deal_announcement', 'status_change', 'material_event'
    alert_channel VARCHAR(20) NOT NULL,  -- 'email', 'sms', 'webhook'

    -- Recipient info
    recipient_email VARCHAR(255),
    recipient_phone VARCHAR(20),

    -- Alert content snapshot
    alert_subject TEXT,
    alert_body TEXT,

    -- Delivery status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
    sent_at TIMESTAMP,
    error_message TEXT,

    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_alert_status CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT valid_alert_type CHECK (alert_type IN ('deal_announcement', 'status_change', 'material_event')),
    CONSTRAINT valid_alert_channel CHECK (alert_channel IN ('email', 'sms', 'webhook'))
);

-- Indexes
CREATE INDEX idx_alert_notifications_deal_id ON alert_notifications(deal_id);
CREATE INDEX idx_alert_notifications_status ON alert_notifications(status);
CREATE INDEX idx_alert_notifications_created_at ON alert_notifications(created_at DESC);
CREATE INDEX idx_alert_notifications_type_channel ON alert_notifications(alert_type, alert_channel);

-- Prevent duplicate alerts for same deal and type
CREATE UNIQUE INDEX idx_alert_notifications_unique_deal_type ON alert_notifications(deal_id, alert_type)
WHERE status = 'sent';

-- Alert recipients configuration table
CREATE TABLE IF NOT EXISTS alert_recipients (
    recipient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contact info
    email VARCHAR(255),
    phone VARCHAR(20),
    name VARCHAR(255),

    -- Preferences
    enabled BOOLEAN NOT NULL DEFAULT true,
    alert_types TEXT[] NOT NULL DEFAULT ARRAY['deal_announcement'],  -- Which alert types to receive
    min_confidence_score DECIMAL(3,2) DEFAULT 0.80,  -- Minimum confidence to alert
    deal_tiers TEXT[] NOT NULL DEFAULT ARRAY['active'],  -- Which deal tiers to alert on

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for recipients
CREATE INDEX idx_alert_recipients_enabled ON alert_recipients(enabled);
CREATE INDEX idx_alert_recipients_email ON alert_recipients(email);
