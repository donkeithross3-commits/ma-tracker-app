-- Multi-Instance Safety: Service Locks Table
-- Created: 2025-11-17
-- Purpose: Enable distributed locking to prevent multiple backend instances
--          from running the same background services simultaneously

-- Main locks table
CREATE TABLE IF NOT EXISTS service_locks (
    lock_name VARCHAR(255) PRIMARY KEY,
    instance_id VARCHAR(255) NOT NULL,
    hostname VARCHAR(255) NOT NULL,
    pid INTEGER NOT NULL,
    acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Index for finding expired locks (cleanup)
CREATE INDEX IF NOT EXISTS idx_service_locks_expires
ON service_locks(expires_at);

-- Index for monitoring active locks
CREATE INDEX IF NOT EXISTS idx_service_locks_heartbeat
ON service_locks(last_heartbeat);

-- Add comment describing table purpose
COMMENT ON TABLE service_locks IS 'Distributed locks for preventing duplicate background services across multiple backend instances';

-- Add comments for key columns
COMMENT ON COLUMN service_locks.lock_name IS 'Unique identifier for the lock (e.g., edgar_monitor, halt_monitor)';
COMMENT ON COLUMN service_locks.instance_id IS 'Unique identifier for the instance holding the lock (hostname-pid)';
COMMENT ON COLUMN service_locks.expires_at IS 'When this lock expires if heartbeat is not renewed';
COMMENT ON COLUMN service_locks.last_heartbeat IS 'Last time the lock holder sent a heartbeat';
COMMENT ON COLUMN service_locks.metadata IS 'Additional context about the lock (for debugging)';

-- Create function to automatically clean up expired locks
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM service_locks
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add check to ensure TTL is reasonable (at least 30 seconds)
ALTER TABLE service_locks
ADD CONSTRAINT check_reasonable_ttl
CHECK (expires_at > acquired_at + INTERVAL '30 seconds');
