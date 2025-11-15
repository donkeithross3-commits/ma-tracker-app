# Monitor Service Mode

You are in **MONITOR SERVICE MODE** for the M&A Intelligence Tracker project.

## Your Mission

Build, debug, or enhance background monitoring services that continuously track M&A data sources.

## M&A Tracker Monitors

### Current Monitors

1. **EDGAR Monitor** - SEC filing tracker
   - Location: `app/api/edgar_routes.py`
   - Polls: SEC.gov every 60 seconds
   - Tracks: 8-K, S-4, 14D-9 filings
   - Storage: `edgar_filings` table

2. **Intelligence Orchestrator** - External news sources
   - Location: `app/intelligence/orchestrator.py`
   - Sources: Bloomberg Law, etc.
   - Storage: `staged_deals` table

3. **Halt Monitor** - Trading halt detection
   - Location: `app/monitors/halt_monitor.py`
   - Polls: NASDAQ/NYSE every 2 seconds
   - Tracks: T1, T2, M1, M2 halt codes
   - Storage: `halt_events` table

4. **Research Worker** - AI deal analysis
   - Location: `app/api/edgar_routes.py` (research worker functions)
   - Uses: Claude AI for analysis
   - Storage: `deal_research` table

## Monitor Architecture Pattern

All monitors follow this pattern:

```python
class MonitorName:
    """Monitor for [data source]"""

    # Configuration
    POLL_INTERVAL = 60  # seconds
    SOURCE_URL = "https://..."

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.db_pool = None
        self.is_running = False
        self.session = None  # aiohttp session

    async def initialize(self):
        """Initialize database pool and resources"""
        if not self.db_pool:
            self.db_pool = await asyncpg.create_pool(self.db_url)
            logger.info("Monitor database pool initialized")

    async def start(self):
        """Start the monitoring service"""
        self.is_running = True
        logger.info("Starting monitor...")

        await self.initialize()

        # Create aiohttp session
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        )

        # Start monitoring loop
        try:
            while self.is_running:
                try:
                    # Fetch data from source
                    data = await self.fetch_data()

                    # Process new data
                    await self.process_data(data)

                except Exception as e:
                    logger.error(f"Monitor iteration error: {e}", exc_info=True)

                # Wait before next poll
                await asyncio.sleep(self.POLL_INTERVAL)

        finally:
            await self.cleanup()

    async def stop(self):
        """Stop the monitoring service"""
        self.is_running = False
        logger.info("Monitor stopping...")

    async def cleanup(self):
        """Clean up resources"""
        if self.session:
            await self.session.close()
        if self.db_pool:
            await self.db_pool.close()
        logger.info("Monitor cleaned up")

    async def fetch_data(self):
        """Fetch data from external source"""
        try:
            async with self.session.get(self.SOURCE_URL) as response:
                if response.status != 200:
                    logger.warning(f"Source returned status {response.status}")
                    return []

                # Parse response (JSON, HTML, etc.)
                data = await response.json()  # or .text()
                return data

        except Exception as e:
            logger.error(f"Failed to fetch data: {e}")
            return []

    async def process_data(self, data):
        """Process and store new data"""
        for item in data:
            # Check if already processed
            if await self.is_duplicate(item):
                continue

            # Store in database
            await self.store_item(item)

            # Trigger alerts if needed
            await self.check_alerts(item)

    async def is_duplicate(self, item) -> bool:
        """Check if item already exists"""
        async with self.db_pool.acquire() as conn:
            exists = await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM table WHERE id = $1)",
                item['id']
            )
            return exists

    async def store_item(self, item):
        """Store item in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO table (field1, field2, detected_at)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (unique_field) DO NOTHING""",
                item['field1'],
                item['field2']
            )

    async def check_alerts(self, item):
        """Check if alert should be triggered"""
        # Implement alert logic
        pass

    async def get_status(self) -> dict:
        """Get monitor status"""
        return {
            'is_running': self.is_running,
            'poll_interval': self.POLL_INTERVAL
        }

# Global instance
_monitor = None

def get_monitor() -> MonitorName:
    """Get or create monitor instance"""
    global _monitor
    if _monitor is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL not set")
        _monitor = MonitorName(db_url)
    return _monitor
```

## Adding a New Monitor

### 1. Create Monitor Class

**File:** `python-service/app/monitors/new_monitor.py`

Copy the pattern above and customize:
- Update class name
- Set POLL_INTERVAL and SOURCE_URL
- Implement fetch_data() for your source
- Implement process_data() for your logic
- Add database storage

### 2. Create Database Tables

**Create migration:** `migrations/01X_new_monitor.sql`

```sql
-- Monitor data table
CREATE TABLE IF NOT EXISTS monitor_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(255) NOT NULL UNIQUE,
    data_field1 VARCHAR(255),
    data_field2 JSONB,
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_data_detected
    ON monitor_data(detected_at DESC);
```

### 3. Create API Routes

**File:** `python-service/app/api/new_monitor_routes.py`

```python
from fastapi import APIRouter, HTTPException
from app.monitors.new_monitor import get_monitor
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/new-monitor", tags=["new-monitor"])

@router.get("/status")
async def get_monitor_status():
    """Get monitor status"""
    try:
        monitor = get_monitor()
        status = await monitor.get_status()
        return {"status": "ok", **status}
    except Exception as e:
        logger.error(f"Failed to get status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/recent")
async def get_recent_data(limit: int = 50):
    """Get recent monitor data"""
    try:
        monitor = get_monitor()
        data = await monitor.get_recent_data(limit)
        return {"data": data, "count": len(data)}
    except Exception as e:
        logger.error(f"Failed to get data: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

### 4. Register in main.py

**File:** `python-service/app/main.py`

```python
# Import routes
from .api.new_monitor_routes import router as new_monitor_router

# Include router
app.include_router(new_monitor_router)

# Add to startup
@app.on_event("startup")
async def startup_event():
    # ... existing monitors ...

    # Start new monitor
    try:
        from .monitors.new_monitor import get_monitor
        import asyncio

        logger.info("Starting New Monitor...")
        monitor = get_monitor()
        asyncio.create_task(monitor.start())
        logger.info("✓ New Monitor started")
    except Exception as e:
        logger.error(f"Failed to start New Monitor: {e}")

# Add to shutdown
@app.on_event("shutdown")
async def shutdown_event():
    # ... existing shutdowns ...

    # Stop new monitor
    try:
        from .monitors.new_monitor import get_monitor
        logger.info("Stopping New Monitor...")
        monitor = get_monitor()
        await monitor.stop()
        logger.info("✓ New Monitor stopped")
    except Exception as e:
        logger.error(f"Error stopping New Monitor: {e}")
```

### 5. Test the Monitor

```bash
# Restart service
cd python-service
pkill -f "start_server.py" && sleep 3 && python3 start_server.py &

# Check status
curl http://localhost:8000/new-monitor/status

# Check data
curl http://localhost:8000/new-monitor/recent | python3 -m json.tool
```

## Debugging Monitors

### Check if Monitor is Running

```bash
# Check status endpoint
curl http://localhost:8000/edgar/status
curl http://localhost:8000/halts/status
curl http://localhost:8000/new-monitor/status
```

### View Monitor Logs

```python
# Check Python service logs
# Look for:
# - "Starting [Monitor]..."
# - "✓ [Monitor] started"
# - Any error messages
```

### Test Monitor Manually

```python
# Test fetch logic
import asyncio
from app.monitors.your_monitor import get_monitor

async def test_monitor():
    monitor = get_monitor()
    await monitor.initialize()

    # Test fetch
    data = await monitor.fetch_data()
    print(f"Fetched {len(data)} items")

    # Test process
    await monitor.process_data(data)

    await monitor.cleanup()

asyncio.run(test_monitor())
```

### Check Database

```python
# Verify data is being stored
import asyncio
import asyncpg

async def check_db():
    conn = await asyncpg.connect(DATABASE_URL)

    # Check recent entries
    rows = await conn.fetch("""
        SELECT * FROM monitor_data
        ORDER BY detected_at DESC
        LIMIT 10
    """)

    for row in rows:
        print(dict(row))

    await conn.close()

asyncio.run(check_db())
```

## Common Monitor Issues

### Issue: Monitor Not Starting

**Symptoms:**
- No "Starting [Monitor]..." log message
- Status endpoint returns 500 error

**Checks:**
1. DATABASE_URL environment variable set?
2. Import error in main.py?
3. Exception in initialize()?

**Fix:**
```python
# Add detailed logging
logger.info("Attempting to import monitor...")
from .monitors.new_monitor import get_monitor
logger.info("Monitor imported successfully")
```

### Issue: Monitor Stops After First Iteration

**Symptoms:**
- Monitor starts but stops polling
- No ongoing activity in logs

**Checks:**
1. Uncaught exception in main loop?
2. Session timeout too aggressive?
3. External source unreachable?

**Fix:**
```python
# Improve error handling
try:
    data = await self.fetch_data()
    await self.process_data(data)
except Exception as e:
    logger.error(f"Iteration failed: {e}", exc_info=True)
    # Don't let exception kill the loop
```

### Issue: Duplicate Data

**Symptoms:**
- Same items stored multiple times
- Unique constraint violations

**Checks:**
1. is_duplicate() logic correct?
2. Unique identifier field chosen correctly?
3. Race condition?

**Fix:**
```python
# Use INSERT ... ON CONFLICT DO NOTHING
await conn.execute("""
    INSERT INTO monitor_data (unique_id, data)
    VALUES ($1, $2)
    ON CONFLICT (unique_id) DO NOTHING
""", unique_id, data)
```

### Issue: High Memory Usage

**Symptoms:**
- Python process memory grows over time
- Eventually crashes or slows down

**Checks:**
1. Session being properly closed?
2. Database connections being released?
3. Large data structures accumulating?

**Fix:**
```python
# Ensure cleanup in finally block
try:
    # ... monitoring logic ...
finally:
    if self.session:
        await self.session.close()
    if self.db_pool:
        await self.db_pool.close()
```

## Monitor Checklist

Before deploying new monitor:

- [ ] Monitor class created with proper pattern
- [ ] Database migration applied
- [ ] API routes created
- [ ] Registered in main.py startup/shutdown
- [ ] Error handling implemented
- [ ] Logging added for debugging
- [ ] Tested manually
- [ ] Status endpoint works
- [ ] Data endpoint works
- [ ] No memory leaks
- [ ] Proper cleanup on shutdown

## Best Practices

1. **Use async/await** - All I/O should be async
2. **Handle errors gracefully** - Don't let exceptions kill the loop
3. **Log important events** - Helps with debugging
4. **Respect rate limits** - Don't hammer external APIs
5. **Use database indexes** - For fast duplicate checks
6. **Clean up resources** - Prevent memory leaks
7. **Test thoroughly** - Monitors run 24/7, bugs are costly
8. **Monitor the monitor** - Use status endpoints to verify health
