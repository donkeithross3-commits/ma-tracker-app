# Multi-Instance Safety Plan

## Problem Statement

Currently, if multiple instances of the backend service run simultaneously (intentionally or accidentally), we risk:

1. **Duplicate Data Collection**: EDGAR monitor running on 2+ machines → duplicate filings
2. **Race Conditions**: Two instances processing the same staged deal simultaneously
3. **Duplicate Alerts**: Multiple instances sending the same email/notification
4. **Database Conflicts**: Concurrent writes causing deadlocks or data corruption
5. **API Rate Limit Exhaustion**: Multiple instances hitting SEC.gov → IP ban risk
6. **Wasted Resources**: Redundant work, duplicate API calls, higher costs

---

## Critical Services at Risk

### High Risk (MUST have protection):
1. **EDGAR Monitor** (`app/monitors/edgar_monitor.py`)
   - Polls SEC.gov every 60s
   - Risk: Duplicate filings in `edgar_filings` table
   - Impact: Database bloat, duplicate detection

2. **Halt Monitor** (`app/monitors/halt_monitor.py`)
   - Polls NASDAQ/NYSE every 10s
   - Risk: Duplicate halt events
   - Impact: Duplicate notifications, alert spam

3. **Intelligence Orchestrator** (`app/intelligence/orchestrator.py`)
   - Monitors Reuters, FTC, Seeking Alpha
   - Risk: Duplicate article processing
   - Impact: Duplicate deals, wasted AI API calls

4. **Research Worker** (`app/api/edgar_routes.py`)
   - Processes staged deals with AI
   - Risk: Same deal processed twice → duplicate research, double API costs
   - Impact: Wasted Anthropic API credits ($$$)

### Medium Risk (should have protection):
5. **Background cleanup jobs**
6. **Scheduled reports/emails**
7. **Database maintenance tasks**

---

## Solution Architecture

### Strategy 1: Distributed Locking (PostgreSQL-based)

**Best for**: Background monitors and workers that should only run on ONE instance at a time

**Implementation**: Use PostgreSQL advisory locks

```sql
-- Create locks table
CREATE TABLE IF NOT EXISTS service_locks (
    lock_name VARCHAR(255) PRIMARY KEY,
    instance_id VARCHAR(255) NOT NULL,
    hostname VARCHAR(255) NOT NULL,
    pid INTEGER NOT NULL,
    acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for expired lock cleanup
CREATE INDEX idx_service_locks_expires ON service_locks(expires_at);
```

**Python Implementation**:
```python
import asyncpg
import os
import socket
from datetime import datetime, timedelta

class DistributedLock:
    def __init__(self, lock_name: str, ttl_seconds: int = 300):
        self.lock_name = lock_name
        self.ttl_seconds = ttl_seconds
        self.instance_id = f"{socket.gethostname()}-{os.getpid()}"
        self.hostname = socket.gethostname()
        self.pid = os.getpid()
        self.acquired = False

    async def acquire(self, conn: asyncpg.Connection) -> bool:
        """Try to acquire lock. Returns True if successful."""
        try:
            # Clean up expired locks first
            await conn.execute("""
                DELETE FROM service_locks
                WHERE expires_at < NOW()
            """)

            # Try to insert lock
            await conn.execute("""
                INSERT INTO service_locks (
                    lock_name, instance_id, hostname, pid, expires_at
                )
                VALUES ($1, $2, $3, $4, NOW() + INTERVAL '%s seconds')
                ON CONFLICT (lock_name) DO NOTHING
            """ % self.ttl_seconds, self.lock_name, self.instance_id,
                self.hostname, self.pid)

            # Check if we got the lock
            result = await conn.fetchrow("""
                SELECT instance_id FROM service_locks
                WHERE lock_name = $1
            """, self.lock_name)

            if result and result['instance_id'] == self.instance_id:
                self.acquired = True
                print(f"✅ Acquired lock: {self.lock_name} (instance: {self.instance_id})")
                return True

            # Someone else has the lock
            print(f"⏸️  Lock held by another instance: {self.lock_name} (holder: {result['instance_id']})")
            return False

        except Exception as e:
            print(f"❌ Error acquiring lock {self.lock_name}: {e}")
            return False

    async def renew(self, conn: asyncpg.Connection) -> bool:
        """Renew lock (heartbeat). Call this periodically."""
        if not self.acquired:
            return False

        try:
            await conn.execute("""
                UPDATE service_locks
                SET last_heartbeat = NOW(),
                    expires_at = NOW() + INTERVAL '%s seconds'
                WHERE lock_name = $1 AND instance_id = $2
            """ % self.ttl_seconds, self.lock_name, self.instance_id)
            return True
        except Exception as e:
            print(f"❌ Error renewing lock {self.lock_name}: {e}")
            self.acquired = False
            return False

    async def release(self, conn: asyncpg.Connection):
        """Release lock when done."""
        if not self.acquired:
            return

        try:
            await conn.execute("""
                DELETE FROM service_locks
                WHERE lock_name = $1 AND instance_id = $2
            """, self.lock_name, self.instance_id)
            print(f"✅ Released lock: {self.lock_name}")
            self.acquired = False
        except Exception as e:
            print(f"❌ Error releasing lock {self.lock_name}: {e}")
```

**Usage in EDGAR Monitor**:
```python
class EdgarMonitor:
    def __init__(self):
        self.lock = DistributedLock("edgar_monitor", ttl_seconds=120)
        self.running = False

    async def start(self):
        conn = await asyncpg.connect(os.getenv("DATABASE_URL"))

        try:
            # Try to acquire lock
            if not await self.lock.acquire(conn):
                return {
                    "success": False,
                    "message": "Another instance is already running the EDGAR monitor"
                }

            self.running = True

            # Main monitoring loop
            while self.running:
                # Renew lock every 60 seconds
                await self.lock.renew(conn)

                # Do monitoring work
                await self.check_for_new_filings()

                await asyncio.sleep(60)

        finally:
            # Always release lock on shutdown
            await self.lock.release(conn)
            await conn.close()
```

---

### Strategy 2: Leader Election (PostgreSQL-based)

**Best for**: Services that need exactly ONE active instance at any time

**Implementation**: Use PostgreSQL for leader election with heartbeat

```python
class LeaderElection:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.instance_id = f"{socket.gethostname()}-{os.getpid()}"
        self.is_leader = False

    async def campaign(self, conn: asyncpg.Connection) -> bool:
        """Try to become leader. Returns True if we are the leader."""
        # Clean up dead leaders (no heartbeat in 60s)
        await conn.execute("""
            DELETE FROM service_locks
            WHERE lock_name = $1
            AND last_heartbeat < NOW() - INTERVAL '60 seconds'
        """, f"leader_{self.service_name}")

        # Try to become leader
        result = await conn.fetchrow("""
            INSERT INTO service_locks (lock_name, instance_id, hostname, pid, expires_at)
            VALUES ($1, $2, $3, $4, NOW() + INTERVAL '300 seconds')
            ON CONFLICT (lock_name) DO UPDATE
            SET last_heartbeat = NOW()
            WHERE service_locks.instance_id = $2
            RETURNING instance_id
        """, f"leader_{self.service_name}", self.instance_id,
            socket.gethostname(), os.getpid())

        # Check if we're the leader
        current_leader = await conn.fetchval("""
            SELECT instance_id FROM service_locks
            WHERE lock_name = $1
        """, f"leader_{self.service_name}")

        self.is_leader = (current_leader == self.instance_id)
        return self.is_leader
```

---

### Strategy 3: Idempotent Operations (Database Constraints)

**Best for**: Preventing duplicate data even if multiple instances write simultaneously

**Implementation**: Use UNIQUE constraints and ON CONFLICT

```sql
-- Prevent duplicate EDGAR filings
CREATE UNIQUE INDEX IF NOT EXISTS idx_edgar_filings_unique
ON edgar_filings(accession_number);

-- Prevent duplicate halt events
CREATE UNIQUE INDEX IF NOT EXISTS idx_halt_events_unique
ON halt_events(ticker, halt_time);

-- Prevent duplicate deal sources
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_sources_unique_url
ON deal_sources(deal_id, source_url);
```

**Python Code**:
```python
# Insert filing with conflict handling
async def insert_filing_safe(filing_data):
    try:
        await conn.execute("""
            INSERT INTO edgar_filings (
                accession_number, company_name, ticker, filing_type, filing_date, filing_url
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (accession_number) DO NOTHING
        """, filing_data.accession_number, filing_data.company_name, ...)
    except Exception as e:
        # Log but don't fail - this is expected in multi-instance setup
        logger.debug(f"Filing already exists: {filing_data.accession_number}")
```

---

### Strategy 4: Work Queue with Claim System

**Best for**: Distributing work across multiple instances (horizontal scaling)

**Implementation**: Use a `work_queue` table with claim/timeout mechanism

```sql
CREATE TABLE work_queue (
    id SERIAL PRIMARY KEY,
    work_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    claimed_by VARCHAR(255),
    claimed_at TIMESTAMP,
    completed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_work_queue_status ON work_queue(status, created_at);
```

**Worker Pattern**:
```python
async def claim_work(conn, worker_id):
    """Atomically claim next available work item."""
    result = await conn.fetchrow("""
        UPDATE work_queue
        SET status = 'processing',
            claimed_by = $1,
            claimed_at = NOW()
        WHERE id = (
            SELECT id FROM work_queue
            WHERE status = 'pending'
            OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '5 minutes')
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, work_type, payload
    """, worker_id)
    return result

async def worker_loop():
    while True:
        work = await claim_work(conn, instance_id)
        if work:
            await process_work(work)
            await mark_complete(conn, work['id'])
        else:
            await asyncio.sleep(5)
```

---

## Implementation Plan

### Phase 1: Critical Safety (Week 1)

**Priority**: Prevent duplicate data collection

1. ✅ Create `service_locks` table migration
2. ✅ Implement `DistributedLock` class
3. ✅ Add locking to EDGAR Monitor
4. ✅ Add locking to Halt Monitor
5. ✅ Add locking to Intelligence Orchestrator
6. ✅ Add locking to Research Worker

### Phase 2: Idempotency (Week 2)

**Priority**: Handle concurrent writes gracefully

1. ✅ Add UNIQUE constraints to all critical tables
2. ✅ Update all INSERT statements to use ON CONFLICT
3. ✅ Add retry logic for transient failures
4. ✅ Test with 2+ instances running simultaneously

### Phase 3: Monitoring & Alerts (Week 3)

**Priority**: Visibility into multi-instance behavior

1. ✅ Add instance tracking to logs
2. ✅ Create `/health/instances` endpoint
3. ✅ Dashboard showing active instances
4. ✅ Alert if locks are held for too long (stuck process)
5. ✅ Alert if multiple instances claim same lock (bug!)

### Phase 4: Work Distribution (Optional - Future)

**Priority**: Horizontal scaling for high load

1. ✅ Implement work queue system
2. ✅ Allow multiple workers to share load
3. ✅ Add worker health monitoring
4. ✅ Auto-scaling based on queue depth

---

## Testing Strategy

### Manual Testing:
```bash
# Terminal 1
cd ma-tracker-app
./dev-start.sh

# Terminal 2 (different machine or port)
cd ma-tracker-app
PORT=8001 ./dev-start.sh

# Verify only ONE instance runs each monitor
curl http://localhost:8000/edgar/monitoring/status
curl http://localhost:8001/edgar/monitoring/status
# Should see: instance 1 running, instance 2 waiting for lock
```

### Automated Testing:
```python
# tests/test_distributed_locks.py
import pytest
import asyncio

async def test_only_one_instance_gets_lock():
    # Simulate 3 instances trying to acquire same lock
    tasks = [acquire_lock("test_lock") for _ in range(3)]
    results = await asyncio.gather(*tasks)

    # Exactly 1 should succeed
    assert sum(results) == 1

async def test_lock_expires_and_released():
    lock1 = await acquire_lock("test_lock", ttl=1)
    assert lock1 == True

    # Wait for expiry
    await asyncio.sleep(2)

    # Different instance should now get lock
    lock2 = await acquire_lock("test_lock", instance_id="different")
    assert lock2 == True
```

---

## Deployment Checklist

Before deploying to multi-instance setup:

- [ ] Run database migration to create `service_locks` table
- [ ] Update all monitors to use `DistributedLock`
- [ ] Add UNIQUE constraints to prevent duplicate data
- [ ] Test with 2 instances running locally
- [ ] Add monitoring/logging for lock acquisition
- [ ] Document runbook for "stuck lock" scenarios
- [ ] Add health check endpoint showing instance status
- [ ] Configure alerts for lock conflicts

---

## Runbook: Common Issues

### Issue: Lock is stuck (service crashed without releasing)

**Symptom**: Monitor won't start, says "another instance is running"

**Solution**:
```sql
-- Check current locks
SELECT * FROM service_locks;

-- Force release stuck lock
DELETE FROM service_locks WHERE lock_name = 'edgar_monitor';
```

### Issue: Both instances think they have the lock

**Symptom**: Duplicate data appearing

**Solution**: This is a BUG! Should never happen. Investigate:
```python
# Check lock implementation for race conditions
# Verify atomic operations are used
# Check database transaction isolation level
```

### Issue: Lock keeps expiring during long-running task

**Symptom**: Task gets interrupted mid-work

**Solution**: Increase TTL or add heartbeat renewal:
```python
# Renew lock every 60 seconds
while processing:
    await lock.renew(conn)
    await do_work()
    await asyncio.sleep(60)
```

---

## Cost-Benefit Analysis

### Current Risk (No Protection):
- **High**: Duplicate data, wasted API credits
- **Medium**: Race conditions, database conflicts
- **Low**: User confusion from duplicate alerts

### With Distributed Locks:
- **Eliminated**: Duplicate monitors running
- **Eliminated**: Wasted API calls
- **Reduced**: Database write conflicts
- **Cost**: +50 lines of code, +1 database table

### ROI:
- **One-time investment**: 1-2 days implementation
- **Ongoing cost**: Minimal (single table, simple queries)
- **Risk reduction**: Eliminates 90% of multi-instance issues

**Recommendation**: Implement Phase 1 & 2 immediately. High value, low cost.

---

## Future Enhancements

1. **Redis-based locks** (if scaling to 10+ instances)
2. **Kubernetes-native leader election** (if using K8s)
3. **Distributed tracing** (OpenTelemetry for request correlation)
4. **Circuit breakers** (prevent cascade failures)
5. **Rate limiting** (per-instance API quotas)

---

## References

- PostgreSQL Advisory Locks: https://www.postgresql.org/docs/current/explicit-locking.html
- Distributed Systems Patterns: https://martinfowler.com/articles/patterns-of-distributed-systems/
- Leader Election Algorithms: https://en.wikipedia.org/wiki/Leader_election
