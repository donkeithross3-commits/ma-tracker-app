# IB TWS Reconnection Robustness Plan

## Current Situation Analysis

### What's Happening
After running overnight with IB TWS closed and reopened, the system has trouble reconnecting. The connection appears established (`isConnected()` returns true), but stale connections may exist.

### Current Connection Status (Verified)
```bash
# IB TWS Port 7497
Python  70199 → localhost:7497 (ESTABLISHED)
IB TWS  93575 ← localhost:7497 (ESTABLISHED)

# Connection status
curl localhost:8000/options/ib-status
{"connected":true,"message":"IB TWS connected"}
```

---

## Root Cause Analysis

### 1. **No Automatic Disconnection Detection**
**Location:** `python-service/app/scanner.py` (IBMergerArbScanner class)

**Problem:**
- The system doesn't detect when IB TWS disconnects or restarts
- `isConnected()` may return stale state
- No callback handling for `connectionClosed()`

**Current Code:**
```python
def nextValidId(self, orderId: int):
    """Callback when connected"""
    # Only called on initial connection
```

**Missing:**
```python
def connectionClosed(self):
    """Callback when connection lost"""
    # NOT IMPLEMENTED - This is a critical gap
```

### 2. **Singleton State Can Become Stale**
**Location:** `python-service/app/options/ib_client.py`

**Problem:**
```python
def is_connected(self) -> bool:
    return self._scanner is not None and self._scanner.isConnected()
```

- `isConnected()` checks socket state, not API health
- If IB restarts, old socket may still appear "connected"
- Scanner instance never cleared automatically

### 3. **No Periodic Health Checks**
**Problem:**
- System only checks connection when user initiates action
- No background monitoring of connection health
- No automatic reconnection attempts

### 4. **No Connection Error Recovery in API Endpoints**
**Location:** `python-service/app/api/options_routes.py`

**Current Pattern:**
```python
if not ib_client.is_connected():
    connected = ib_client.connect()
    if not connected:
        raise HTTPException(...)
```

**Problem:**
- Assumes `is_connected()` is accurate
- Doesn't handle cases where connection appears established but is actually stale
- No retry logic for transient failures

### 5. **Thread Safety Issues**
**Problem:**
- IB API uses threading for message processing
- Daemon threads may not cleanup properly on disconnect
- No explicit thread cleanup on reconnection

---

## Proposed Solution: Multi-Layer Robustness

### Phase 1: Connection State Management (High Priority)

#### 1.1 Implement Connection Loss Detection
**File:** `python-service/app/scanner.py`

```python
class IBMergerArbScanner(EWrapper, EClient):
    def __init__(self):
        # ... existing code ...
        self.connection_lost = False
        self.last_heartbeat = time.time()
    
    def connectionClosed(self):
        """Callback when connection is closed by IB or network"""
        logger.warning("IB TWS connection closed!")
        self.connection_lost = True
        print("⚠️  Connection to IB TWS lost!")
    
    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        """Enhanced error handling"""
        # Existing error handling...
        
        # Detect fatal connection errors
        if errorCode in [1100, 1101, 1102, 2110]:
            # 1100: Connection lost
            # 1101: Connection restored (data lost)
            # 1102: Connection restored (data maintained)
            # 2110: Connectivity issues
            logger.warning(f"Connection event {errorCode}: {errorString}")
            if errorCode == 1100:
                self.connection_lost = True
    
    def nextValidId(self, orderId: int):
        """Callback when connected - acts as heartbeat"""
        super().nextValidId(orderId)
        self.next_req_id = orderId
        self.connection_lost = False
        self.last_heartbeat = time.time()
        print(f"✅ Connection healthy - order ID: {orderId}")
```

#### 1.2 Enhanced is_connected() Check
**File:** `python-service/app/options/ib_client.py`

```python
def is_connected(self) -> bool:
    """Enhanced connection check"""
    if self._scanner is None:
        return False
    
    # Check basic socket connection
    if not self._scanner.isConnected():
        return False
    
    # Check for connection loss flag
    if hasattr(self._scanner, 'connection_lost') and self._scanner.connection_lost:
        logger.warning("Connection marked as lost, triggering cleanup")
        self.disconnect()
        return False
    
    # Check heartbeat age (if implemented)
    if hasattr(self._scanner, 'last_heartbeat'):
        age = time.time() - self._scanner.last_heartbeat
        if age > 300:  # 5 minutes without heartbeat
            logger.warning(f"No heartbeat for {age:.0f}s, connection may be stale")
            self.disconnect()
            return False
    
    return True
```

---

### Phase 2: Automatic Reconnection (High Priority)

#### 2.1 Background Health Monitor
**File:** `python-service/app/options/ib_client.py`

```python
from threading import Thread, Event
import time

class IBClient:
    def __init__(self):
        # ... existing code ...
        self._monitor_thread = None
        self._monitor_stop = Event()
    
    def start_monitor(self):
        """Start background health monitoring"""
        if self._monitor_thread is None or not self._monitor_thread.is_alive():
            self._monitor_stop.clear()
            self._monitor_thread = Thread(target=self._monitor_connection, daemon=True)
            self._monitor_thread.start()
            logger.info("Started IB connection monitor")
    
    def _monitor_connection(self):
        """Monitor and auto-reconnect if needed"""
        while not self._monitor_stop.is_set():
            time.sleep(30)  # Check every 30 seconds
            
            if not self.is_connected():
                logger.warning("Connection lost, attempting automatic reconnection...")
                try:
                    self.disconnect()  # Clean up stale state
                    time.sleep(2)  # Brief pause
                    
                    if self.connect():
                        logger.info("✅ Automatic reconnection successful")
                    else:
                        logger.error("❌ Automatic reconnection failed, will retry")
                except Exception as e:
                    logger.error(f"Error during reconnection: {e}")
```

#### 2.2 Graceful Disconnect and Cleanup
**File:** `python-service/app/options/ib_client.py`

```python
def disconnect(self):
    """Enhanced disconnect with proper cleanup"""
    if self._scanner:
        try:
            if self._scanner.isConnected():
                logger.info("Disconnecting from IB TWS...")
                self._scanner.disconnect()
                time.sleep(1)  # Allow disconnect to complete
        except Exception as e:
            logger.error(f"Error during disconnect: {e}")
        finally:
            self._scanner = None
            logger.info("Scanner instance cleared")
```

---

### Phase 3: Resilient API Endpoints (Medium Priority)

#### 3.1 Retry Logic with Exponential Backoff
**File:** `python-service/app/api/options_routes.py`

```python
from functools import wraps
import time

def with_ib_retry(max_retries=2, initial_delay=1):
    """Decorator to retry IB operations on connection failures"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            ib_client = IBClient()
            
            for attempt in range(max_retries + 1):
                try:
                    # Ensure connection before attempt
                    if not ib_client.is_connected():
                        logger.info(f"Reconnecting to IB (attempt {attempt + 1}/{max_retries + 1})...")
                        connected = ib_client.connect()
                        if not connected:
                            if attempt < max_retries:
                                delay = initial_delay * (2 ** attempt)
                                logger.info(f"Waiting {delay}s before retry...")
                                time.sleep(delay)
                                continue
                            raise HTTPException(
                                status_code=503,
                                detail="Failed to connect to IB TWS after multiple attempts"
                            )
                    
                    # Execute the actual function
                    return await func(*args, **kwargs)
                    
                except Exception as e:
                    if attempt < max_retries:
                        logger.warning(f"Operation failed (attempt {attempt + 1}), retrying: {e}")
                        ib_client.disconnect()  # Force cleanup
                        delay = initial_delay * (2 ** attempt)
                        time.sleep(delay)
                    else:
                        raise
            
        return wrapper
    return decorator

# Apply to endpoints
@router.post("/chain")
@with_ib_retry(max_retries=2)
async def fetch_chain(request: FetchChainRequest) -> FetchChainResponse:
    # ... existing code ...
```

---

### Phase 4: Monitoring and Alerting (Low Priority)

#### 4.1 Connection Metrics
**File:** `python-service/app/options/ib_client.py`

```python
class ConnectionMetrics:
    def __init__(self):
        self.total_connections = 0
        self.total_disconnections = 0
        self.failed_connections = 0
        self.last_successful_connect = None
        self.last_disconnect = None
        self.uptime_start = None

class IBClient:
    def __init__(self):
        # ... existing code ...
        self.metrics = ConnectionMetrics()
```

#### 4.2 Health Endpoint Enhancement
**File:** `python-service/app/main.py`

```python
@app.get("/health")
async def health_check():
    scanner = get_scanner()
    is_connected = scanner.isConnected() if scanner else False
    
    # Enhanced health info
    uptime = None
    if ib_client.metrics.uptime_start:
        uptime = int(time.time() - ib_client.metrics.uptime_start)
    
    return {
        "status": "healthy" if is_connected else "degraded",
        "ib_connected": is_connected,
        "connection_metrics": {
            "total_connections": ib_client.metrics.total_connections,
            "total_disconnections": ib_client.metrics.total_disconnections,
            "failed_connections": ib_client.metrics.failed_connections,
            "uptime_seconds": uptime,
        }
    }
```

---

## Implementation Plan

### Immediate Actions (Day 1)

1. **Add connectionClosed() callback** (30 min)
   - Implement in scanner.py
   - Set connection_lost flag
   - Add logging

2. **Enhanced is_connected() check** (30 min)
   - Check connection_lost flag
   - Force disconnect if stale

3. **Test reconnection after IB restart** (30 min)
   - Manual testing
   - Verify cleanup

### Short Term (Week 1)

4. **Background monitor thread** (2 hours)
   - Implement monitor
   - Add auto-reconnection
   - Test with simulated disconnects

5. **Enhanced disconnect/cleanup** (1 hour)
   - Proper cleanup sequence
   - Thread termination
   - State reset

6. **Deploy and monitor** (ongoing)
   - Watch logs overnight
   - Monitor reconnection success

### Medium Term (Week 2)

7. **Add retry logic to endpoints** (3 hours)
   - Implement decorator
   - Apply to critical endpoints
   - Test with simulated failures

8. **Connection metrics** (2 hours)
   - Track connection events
   - Enhanced health endpoint
   - Dashboard display

---

## Testing Strategy

### Manual Tests

1. **Normal Operation**
   - Start system, verify connection
   - Scan options, verify functionality

2. **IB Restart**
   - Stop IB TWS
   - Wait 1 minute
   - Start IB TWS
   - Verify auto-reconnect (or manual reconnect button)

3. **Network Interruption**
   - Block port 7497 temporarily
   - Verify error detection
   - Unblock and verify reconnection

4. **Overnight Test**
   - Leave system running overnight
   - IB TWS running
   - Verify connection in morning

### Automated Tests

```python
# test_ib_reconnection.py
def test_connectionClosed_callback():
    scanner = IBMergerArbScanner()
    assert scanner.connection_lost == False
    scanner.connectionClosed()
    assert scanner.connection_lost == True

def test_is_connected_with_lost_flag():
    ib_client = IBClient()
    ib_client.connect()
    ib_client._scanner.connection_lost = True
    assert ib_client.is_connected() == False
```

---

## Monitoring

### Log Patterns to Watch

```bash
# Successful connection
✅ Connected to IB successfully

# Connection loss detected
⚠️  Connection to IB TWS lost!

# Automatic reconnection
Connection lost, attempting automatic reconnection...
✅ Automatic reconnection successful

# Reconnection failure
❌ Automatic reconnection failed, will retry
```

### Metrics to Track

- Connection uptime (continuous connected time)
- Reconnection success rate
- Time to reconnect (after loss)
- Number of connection losses per day

---

## Rollback Plan

If issues arise after implementation:

1. **Immediate rollback:**
   ```bash
   git revert <commit>
   npm run dev-kill
   npm run dev-full
   ```

2. **Disable monitor:**
   - Comment out `start_monitor()` call
   - Keep callbacks for manual testing

3. **Manual reconnect:**
   - UI refresh button still works
   - `/options/ib-reconnect` endpoint available

---

## Success Criteria

✅ System detects IB disconnect within 30 seconds
✅ System automatically reconnects within 60 seconds
✅ No manual intervention required for IB restarts
✅ System survives overnight with IB running
✅ Clear error messages when reconnection fails
✅ Connection uptime > 99% over 24 hours (excluding IB downtime)

---

## Related Files

- `python-service/app/scanner.py` - Core scanner with IB API
- `python-service/app/options/ib_client.py` - Singleton connection manager
- `python-service/app/api/options_routes.py` - API endpoints
- `components/ma-options/IBConnectionContext.tsx` - Frontend connection status
- `components/ma-options/IBConnectionStatus.tsx` - UI status indicator

---

*Last Updated: December 2024*

