# Comprehensive Price Agent Testing & Quality Assurance Plan

**Created**: January 7, 2025  
**Status**: Markets Open - Ready for Testing  
**Scope**: Connection logic, error handling, automated testing, regression prevention

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 1: Immediate Manual Testing](#phase-1-immediate-manual-testing-today)
3. [Phase 2: Error Handling & Edge Cases](#phase-2-error-handling--edge-cases)
4. [Phase 3: Automated Testing Suite](#phase-3-automated-testing-suite)
5. [Phase 4: Integration & Regression Tests](#phase-4-integration--regression-tests)
6. [Phase 5: Monitoring & Observability](#phase-5-monitoring--observability)
7. [Phase 6: Documentation & Runbooks](#phase-6-documentation--runbooks)
8. [Success Metrics](#success-metrics)
9. [Risk Mitigation](#risk-mitigation)

---

## Executive Summary

### Current State
- ✅ Client ID conflict fix implemented (random IDs: 300-399)
- ✅ On-demand agent spawning functional
- ✅ Status check using separate ID range (200-299)
- ⏳ Markets open, IB TWS connected
- ⏳ Manual testing pending
- ❌ No automated tests for agent logic
- ❌ Limited error handling observability

### Goals
1. **Immediate**: Validate connection logic works end-to-end
2. **Short-term**: Robust error handling for production use
3. **Long-term**: Automated testing to prevent regressions

### Approach
**Senior Dev Principles**:
- **Test in Production-like Conditions**: Use real IB TWS, real market data
- **Fail Fast, Fail Visible**: Clear error messages, detailed logging
- **Automate What Matters**: Focus on critical paths, not edge cases
- **Document for Future You**: Runbooks for 3am debugging
- **Build Confidence, Not Perfection**: 80% coverage of 100% of critical flows

---

## Phase 1: Immediate Manual Testing (Today)

### Objective
Verify the client ID fix works and identify any immediate issues before markets close.

### Test Suite

#### Test 1.1: Basic Connection Status ⏱️ 2 minutes

**Setup**:
```bash
# Ensure services running
# - IB TWS logged in
# - npm run dev (Next.js)
# - Postgres.app running
```

**Steps**:
1. Navigate to `http://localhost:3000/ma-options`
2. Observe status indicator (top-right)
3. Wait 30 seconds, verify it stays green

**Expected**:
- ✅ Green "IB TWS: Connected" indicator
- ✅ No errors in browser console
- ✅ Server logs show `GET /api/ib-connection/status 200`

**Red Flags**:
- ❌ Red dot or "Disconnected" message
- ❌ `500` error on status endpoint
- ❌ Console errors about fetch failures

**Log Validation**:
```bash
# Check server logs for client ID usage
grep "Using.*client ID" ~/.cursor/projects/*/terminals/*.txt
# Should see: "Using agent client ID: 2XX" (200-299 range)
```

---

#### Test 1.2: Single Ticker Option Chain Load ⏱️ 30 seconds

**Setup**:
- Use a liquid ticker with known options: **EA** (Electronic Arts)
- Verify deal exists in database: 
  ```sql
  SELECT ticker, deal_id FROM deals WHERE ticker = 'EA' LIMIT 1;
  ```

**Steps**:
1. Click on EA deal in the list
2. Click **"Load Option Chain"** button
3. Observe loading state
4. Wait up to 30 seconds

**Expected**:
- ✅ Loading spinner appears immediately
- ✅ Server logs show:
  ```
  No recent data for EA, spawning price agent...
  Spawning price agent for EA...
  [AGENT-OUT] Using agent client ID: 3XX (300-399)
  [AGENT-OUT] Connected to IB TWS
  [AGENT-OUT] Fetching option chain for EA
  POST /api/ma-options/fetch-chain 200 in 10-20s
  ```
- ✅ Option chain appears with:
  - Spot price (reasonable value)
  - Multiple expirations (at least 2-3)
  - Multiple strikes (at least 10+)
  - Source: "agent"
  - Age: "< 1 minute"

**Red Flags**:
- ❌ "client id already in use" error
- ❌ Timeout > 30 seconds
- ❌ "Could not fetch price" error
- ❌ Empty option chain with no error
- ❌ Source shows "python-service" (legacy fallback)

**Log Analysis**:
```bash
# Check for client ID conflicts
grep -i "client id.*already in use" ~/.cursor/projects/*/terminals/*.txt

# Check agent completion
grep "RESULT_SUCCESS" ~/.cursor/projects/*/terminals/*.txt
```

---

#### Test 1.3: Cached Data Retrieval ⏱️ 10 seconds

**Setup**:
- Immediately after Test 1.2 (EA chain just loaded)

**Steps**:
1. Click away from EA deal
2. Click back on EA deal
3. Click **"Load Option Chain"** again

**Expected**:
- ✅ Data loads immediately (< 2 seconds)
- ✅ Server logs show: "Using agent data for EA (2-second window)"
- ✅ No agent spawn
- ✅ Age shows "< 1 minute" still

**Purpose**:
- Validates 2-second debounce works
- Prevents unnecessary agent spawns
- Confirms database caching is functional

---

#### Test 1.4: Multiple Sequential Tickers ⏱️ 2 minutes

**Setup**:
- Use 3 different tickers: **EA, AL, CSGS**

**Steps**:
1. Load EA chain (wait for completion)
2. Load AL chain (wait for completion)
3. Load CSGS chain (wait for completion)

**Expected**:
- ✅ Each ticker spawns its own agent
- ✅ Each agent uses different client ID (300-399)
- ✅ No conflicts
- ✅ All three chains load successfully

**Red Flags**:
- ❌ Client ID conflicts
- ❌ One ticker blocks others
- ❌ Stale data from previous ticker

**Log Validation**:
```bash
# Should see 3 different client IDs
grep "Using agent client ID" ~/.cursor/projects/*/terminals/*.txt | tail -3
```

---

#### Test 1.5: Concurrent Clicks (Stress Test) ⏱️ 1 minute

**Setup**:
- Open two browser tabs to `/ma-options`

**Steps**:
1. Tab 1: Click "Load Option Chain" for EA
2. Tab 2: Immediately click "Load Option Chain" for AL (don't wait)
3. Observe both

**Expected**:
- ✅ Both agents spawn with different client IDs
- ✅ Both eventually complete (may take longer)
- ✅ No crashes or hung processes

**Acceptable Outcome**:
- ⚠️ One agent may fail due to IB rate limits (acceptable)
- ⚠️ Slower response times (IB is sequential)

**Red Flags**:
- ❌ Server crash
- ❌ Both agents hang indefinitely
- ❌ Database deadlock errors

**Cleanup Check**:
```bash
# After both complete, check for zombie processes
ps aux | grep price_agent | grep -v grep
# Should be empty
```

---

### Phase 1 Checklist

- [ ] Test 1.1: Status shows green
- [ ] Test 1.2: EA option chain loads successfully
- [ ] Test 1.3: Cached data returns immediately
- [ ] Test 1.4: Multiple tickers load sequentially
- [ ] Test 1.5: Concurrent clicks handled gracefully
- [ ] No zombie processes remaining
- [ ] Server logs show only 300-399 client IDs for agents

**If all pass**: Proceed to Phase 2  
**If any fail**: Stop, debug, document failure, fix before continuing

---

## Phase 2: Error Handling & Edge Cases

### Objective
Test failure modes and ensure graceful degradation.

### Test Suite

#### Test 2.1: IB TWS Disconnected During Fetch

**Setup**:
1. Start loading option chain for EA
2. Immediately close IB TWS application

**Expected**:
- ✅ Agent fails gracefully
- ✅ Error message shown in UI
- ✅ Server logs show:
  ```
  [AGENT-ERR] Failed to connect to IB TWS
  [AGENT-ERR] Ensure TWS/Gateway is running
  ```
- ✅ UI shows: "Failed to fetch option chain" with actionable error
- ✅ No hung processes

**Implementation Gap** (if test fails):
- Need better error propagation from agent to UI
- Need agent timeout (currently missing)

---

#### Test 2.2: Invalid Ticker (No Options Available)

**Setup**:
- Pick a ticker with no options (illiquid or delisted)
- Example: Use a very small cap stock

**Expected**:
- ✅ Agent completes successfully
- ✅ Returns empty option chain
- ✅ UI shows: "No options available for this ticker"
- ✅ Deal marked `noOptionsAvailable = true`

**Red Flags**:
- ❌ Agent hangs indefinitely
- ❌ "No security definition" errors cause crash

---

#### Test 2.3: Market Closed (After Hours)

**Setup**:
- Test after 4:00 PM ET or before 9:30 AM ET

**Expected**:
- ✅ Agent may take longer to respond
- ✅ Returns data (delayed/stale from IB)
- ✅ UI shows age metadata correctly
- ⚠️ Spread quotes may be wide or zero

**Purpose**:
- Validates system works outside market hours
- Identifies potential timeout issues

---

#### Test 2.4: Agent Process Killed Mid-Fetch

**Setup**:
1. Start loading option chain
2. Manually kill agent process:
   ```bash
   ps aux | grep price_agent
   kill -9 <PID>
   ```

**Expected**:
- ✅ API detects agent failure (exit code 1)
- ✅ Falls back to cached data or returns error
- ✅ No hung API requests
- ✅ UI shows error message

**Implementation Gap** (if test fails):
- Need timeout on `spawn()` promise
- Need explicit error handling for agent crashes

---

#### Test 2.5: Database Unavailable

**Setup**:
1. Stop Postgres.app
2. Try to load option chain

**Expected**:
- ✅ Agent still fetches data from IB
- ❌ Cannot save snapshot to database
- ✅ Returns data to UI (even if not persisted)
- ✅ Clear error message about database

**Implementation Gap** (if test fails):
- Agent should not crash if database write fails
- Need graceful degradation

---

#### Test 2.6: Client ID Collision (Unlikely but Possible)

**Setup**:
- Artificially reduce ID range in code:
  ```python
  # Temporarily in price_agent.py
  agent_client_id = random.randint(300, 301)  # Only 2 IDs
  ```
- Spawn 5 agents rapidly

**Expected**:
- ✅ Some agents fail with "client id already in use"
- ✅ Failed agents retry or return error
- ✅ System doesn't crash
- ✅ At least some agents succeed

**Purpose**:
- Validates error handling for rare collision case
- Identifies need for retry logic (currently missing)

---

### Phase 2 Checklist

- [ ] Test 2.1: IB disconnect handled gracefully
- [ ] Test 2.2: No options available handled
- [ ] Test 2.3: After-hours operation works
- [ ] Test 2.4: Killed agent doesn't hang API
- [ ] Test 2.5: Database failure doesn't crash agent
- [ ] Test 2.6: Client ID collision handled

**Document all failures** in `docs/AGENT_ERROR_HANDLING_GAPS.md`

---

## Phase 3: Automated Testing Suite

### Objective
Build automated tests to prevent regressions and enable confident refactoring.

### Architecture

```
__tests__/
├── unit/
│   ├── agent_config.test.py          # Python unit tests
│   ├── price_agent_connection.test.py
│   └── client_id_allocation.test.py
├── integration/
│   ├── fetch-chain.test.ts           # API route tests
│   ├── ingest-chain.test.ts
│   └── ib-connection-status.test.ts
└── e2e/
    ├── agent_spawn_lifecycle.test.ts # Full flow tests
    └── concurrent_agents.test.ts
```

---

### 3.1: Python Unit Tests (pytest)

**File**: `python-service/tests/test_price_agent.py`

```python
import pytest
from unittest.mock import Mock, patch
from price_agent import PriceAgent
from agent_config import AgentConfig

class TestPriceAgent:
    """Unit tests for Price Agent connection logic"""
    
    def test_client_id_allocation_range(self):
        """Test that client IDs are always in 300-399 range"""
        config = AgentConfig.from_env()
        agent = PriceAgent(config)
        
        # Test 100 iterations to verify randomness
        client_ids = []
        for _ in range(100):
            with patch.object(agent.ib_client, 'connect') as mock_connect:
                mock_connect.return_value = True
                agent.connect_to_ib()
                
                # Extract client_id from mock call
                call_args = mock_connect.call_args
                client_id = call_args.kwargs['client_id']
                client_ids.append(client_id)
                
                assert 300 <= client_id <= 399, f"Client ID {client_id} out of range"
        
        # Verify we're getting variety (not always same ID)
        assert len(set(client_ids)) > 10, "Client IDs not sufficiently random"
    
    def test_connection_failure_handling(self):
        """Test that connection failures are handled gracefully"""
        config = AgentConfig.from_env()
        agent = PriceAgent(config)
        
        with patch.object(agent.ib_client, 'connect') as mock_connect:
            mock_connect.return_value = False
            
            result = agent.connect_to_ib()
            
            assert result is False
            assert mock_connect.called
    
    def test_connection_exception_handling(self):
        """Test that connection exceptions don't crash the agent"""
        config = AgentConfig.from_env()
        agent = PriceAgent(config)
        
        with patch.object(agent.ib_client, 'connect') as mock_connect:
            mock_connect.side_effect = Exception("TWS not running")
            
            result = agent.connect_to_ib()
            
            assert result is False
    
    def test_client_id_no_overlap_with_status_check(self):
        """Test that agent IDs never overlap with status check range"""
        config = AgentConfig.from_env()
        agent = PriceAgent(config)
        
        for _ in range(1000):
            with patch.object(agent.ib_client, 'connect') as mock_connect:
                mock_connect.return_value = True
                agent.connect_to_ib()
                
                client_id = mock_connect.call_args.kwargs['client_id']
                assert client_id not in range(200, 300), \
                    f"Agent used status check ID: {client_id}"
```

**Setup**:
```bash
cd python-service
pip install pytest pytest-mock
pytest tests/test_price_agent.py -v
```

---

### 3.2: TypeScript Integration Tests (Jest)

**File**: `app/api/ma-options/fetch-chain/route.test.ts`

```typescript
import { NextRequest } from 'next/server';
import { POST } from './route';
import { prisma } from '@/lib/db';

// Mock dependencies
jest.mock('@/lib/db');
jest.mock('child_process');

describe('/api/ma-options/fetch-chain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Agent Spawning Logic', () => {
    it('should spawn agent when no recent data exists', async () => {
      // Mock: No recent snapshot in database
      (prisma.optionChainSnapshot.findFirst as jest.Mock).mockResolvedValueOnce(null);
      
      // Mock: Agent spawn succeeds
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(0); // Success
        }),
      });
      
      // Mock: Fresh snapshot after agent run
      (prisma.optionChainSnapshot.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'snapshot-123',
        ticker: 'EA',
        spotPrice: 150.25,
        chainData: [{ strike: 150, bid: 2.5, ask: 2.7 }],
        snapshotDate: new Date(),
        agentId: 'test-agent',
      });
      
      const request = new NextRequest('http://localhost:3000/api/ma-options/fetch-chain', {
        method: 'POST',
        body: JSON.stringify({
          dealId: 'deal-123',
          ticker: 'EA',
          dealPrice: 150,
          expectedCloseDate: '2025-09-17',
        }),
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.source).toBe('agent');
      expect(data.ticker).toBe('EA');
      expect(mockSpawn).toHaveBeenCalledWith(
        'python3',
        expect.arrayContaining(['./python-service/price_agent.py']),
        expect.any(Object)
      );
    });
    
    it('should use cached data within 2-second window', async () => {
      const recentSnapshot = {
        id: 'cached-123',
        ticker: 'EA',
        spotPrice: 150.25,
        chainData: [{ strike: 150, bid: 2.5, ask: 2.7 }],
        snapshotDate: new Date(Date.now() - 1000), // 1 second ago
        agentId: 'previous-agent',
      };
      
      (prisma.optionChainSnapshot.findFirst as jest.Mock).mockResolvedValue(recentSnapshot);
      
      const request = new NextRequest('http://localhost:3000/api/ma-options/fetch-chain', {
        method: 'POST',
        body: JSON.stringify({
          dealId: 'deal-123',
          ticker: 'EA',
          dealPrice: 150,
          expectedCloseDate: '2025-09-17',
        }),
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.snapshotId).toBe('cached-123');
      expect(data.ageMinutes).toBe(0);
      
      // Agent should NOT have been spawned
      const mockSpawn = require('child_process').spawn;
      expect(mockSpawn).not.toHaveBeenCalled();
    });
    
    it('should handle agent spawn failure gracefully', async () => {
      (prisma.optionChainSnapshot.findFirst as jest.Mock).mockResolvedValueOnce(null);
      
      // Mock: Agent spawn fails
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn((event, callback) => {
          if (event === 'data') callback('client id already in use');
        }) },
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(1); // Failure
        }),
      });
      
      const request = new NextRequest('http://localhost:3000/api/ma-options/fetch-chain', {
        method: 'POST',
        body: JSON.stringify({
          dealId: 'deal-123',
          ticker: 'EA',
          dealPrice: 150,
          expectedCloseDate: '2025-09-17',
        }),
      });
      
      const response = await POST(request);
      
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toContain('No fresh data available');
    });
  });
});
```

**Run Tests**:
```bash
npm test -- app/api/ma-options/fetch-chain/route.test.ts
```

---

### 3.3: End-to-End Test (Playwright)

**File**: `e2e/agent_lifecycle.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Price Agent E2E Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/ma-options');
  });
  
  test('should show connected status', async ({ page }) => {
    // Wait for status check to complete
    await page.waitForTimeout(3000);
    
    const status = page.locator('[data-testid="ib-connection-status"]');
    await expect(status).toContainText('Connected');
    await expect(status).toHaveClass(/text-green/);
  });
  
  test('should load option chain for EA', async ({ page }) => {
    // Click on EA deal
    await page.click('text=EA');
    
    // Click Load Option Chain button
    await page.click('button:has-text("Load Option Chain")');
    
    // Wait for loading state
    await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
    
    // Wait for data to load (max 30s)
    await page.waitForSelector('[data-testid="option-chain-table"]', { timeout: 30000 });
    
    // Verify option chain displayed
    const chainTable = page.locator('[data-testid="option-chain-table"]');
    await expect(chainTable).toBeVisible();
    
    // Verify metadata
    const source = page.locator('[data-testid="chain-source"]');
    await expect(source).toContainText('agent');
    
    const age = page.locator('[data-testid="chain-age"]');
    await expect(age).toContainText('minute');
  });
  
  test('should handle concurrent requests', async ({ page, context }) => {
    // Open second tab
    const page2 = await context.newPage();
    await page2.goto('http://localhost:3000/ma-options');
    
    // Click EA in tab 1
    await page.click('text=EA');
    await page.click('button:has-text("Load Option Chain")');
    
    // Immediately click AL in tab 2
    await page2.click('text=AL');
    await page2.click('button:has-text("Load Option Chain")');
    
    // Both should eventually load (one may take longer)
    await Promise.all([
      page.waitForSelector('[data-testid="option-chain-table"]', { timeout: 45000 }),
      page2.waitForSelector('[data-testid="option-chain-table"]', { timeout: 45000 }),
    ]);
    
    // Both should show success
    await expect(page.locator('[data-testid="option-chain-table"]')).toBeVisible();
    await expect(page2.locator('[data-testid="option-chain-table"]')).toBeVisible();
  });
});
```

**Setup**:
```bash
npm install -D @playwright/test
npx playwright install
npx playwright test e2e/agent_lifecycle.spec.ts
```

---

### Phase 3 Checklist

- [ ] Python unit tests created and passing
- [ ] TypeScript integration tests created and passing
- [ ] E2E tests cover happy path
- [ ] Tests run in CI/CD pipeline (GitHub Actions)
- [ ] Coverage reports generated

**Target**: 80% coverage of critical paths

---

## Phase 4: Integration & Regression Tests

### Objective
Catch breaking changes before they reach production.

### 4.1: Regression Test Suite

**File**: `tests/regression/client_id_conflict.test.ts`

**Purpose**: Ensure client ID conflict bug never returns

```typescript
describe('Regression: Client ID Conflict Bug', () => {
  it('should never use client ID 100 in production agent spawns', async () => {
    // This test documents the original bug and ensures it doesn't return
    
    const mockSpawn = jest.spyOn(require('child_process'), 'spawn');
    
    // Trigger agent spawn
    // ... (call fetch-chain API)
    
    // Verify spawn was called with python script
    expect(mockSpawn).toHaveBeenCalled();
    
    // Parse the output logs to check client ID
    // (This is brittle, but documents the critical requirement)
    const spawnCall = mockSpawn.mock.calls[0];
    const script = spawnCall[1].join(' ');
    expect(script).toContain('price_agent.py');
    
    // In actual test, we'd capture stdout/stderr and verify:
    // "Using agent client ID: XXX" where XXX is in 300-399
  });
  
  it('should never conflict with status check IDs', async () => {
    // Status check uses 200-299
    // Agent uses 300-399
    // These should never overlap
    
    // This is more of a documentation test than functional test
    // Real validation happens in unit tests
  });
});
```

---

### 4.2: Integration Test: Database → Agent → UI

**File**: `tests/integration/full_flow.test.ts`

```typescript
describe('Integration: Full Option Chain Flow', () => {
  it('should fetch, persist, and display option chain', async () => {
    // 1. Verify database is clean
    await prisma.optionChainSnapshot.deleteMany({ where: { ticker: 'TEST' } });
    
    // 2. Trigger agent fetch
    const fetchResponse = await fetch('http://localhost:3000/api/ma-options/fetch-chain', {
      method: 'POST',
      body: JSON.stringify({
        dealId: 'test-deal-id',
        ticker: 'TEST',
        dealPrice: 100,
        expectedCloseDate: '2025-12-31',
      }),
    });
    
    expect(fetchResponse.status).toBe(200);
    const fetchData = await fetchResponse.json();
    expect(fetchData.source).toBe('agent');
    
    // 3. Verify snapshot was persisted
    const snapshot = await prisma.optionChainSnapshot.findFirst({
      where: { ticker: 'TEST' },
      orderBy: { snapshotDate: 'desc' },
    });
    
    expect(snapshot).toBeDefined();
    expect(snapshot!.agentId).toBeTruthy();
    expect(snapshot!.chainData).toBeInstanceOf(Array);
    
    // 4. Verify cached retrieval works
    const cachedResponse = await fetch('http://localhost:3000/api/ma-options/fetch-chain', {
      method: 'POST',
      body: JSON.stringify({
        dealId: 'test-deal-id',
        ticker: 'TEST',
        dealPrice: 100,
        expectedCloseDate: '2025-12-31',
      }),
    });
    
    const cachedData = await cachedResponse.json();
    expect(cachedData.snapshotId).toBe(fetchData.snapshotId);
    expect(cachedData.ageMinutes).toBeLessThan(1);
  });
});
```

---

### 4.3: Continuous Integration Setup

**File**: `.github/workflows/test-agent.yml`

```yaml
name: Price Agent Tests

on:
  pull_request:
    paths:
      - 'python-service/price_agent.py'
      - 'app/api/ma-options/**'
      - 'app/api/price-agent/**'
  push:
    branches: [main]

jobs:
  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: |
          cd python-service
          pip install -r requirements.txt pytest pytest-mock
          pytest tests/test_price_agent.py -v
  
  typescript-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test -- app/api/ma-options/fetch-chain/route.test.ts
  
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run dev &
      - run: npx playwright test e2e/agent_lifecycle.spec.ts
```

---

### Phase 4 Checklist

- [ ] Regression tests document original bug
- [ ] Integration tests cover full flow
- [ ] CI/CD pipeline configured
- [ ] Tests run automatically on PR
- [ ] Failing tests block merge

---

## Phase 5: Monitoring & Observability

### Objective
Understand agent behavior in production and debug issues quickly.

### 5.1: Structured Logging

**Enhancement**: `python-service/price_agent.py`

```python
import logging
import json
from datetime import datetime

# Structured logging for easier parsing
class StructuredLogger:
    def __init__(self, logger):
        self.logger = logger
    
    def log_connection(self, client_id, success, duration_ms=None):
        self.logger.info(json.dumps({
            'event': 'ib_connection',
            'client_id': client_id,
            'success': success,
            'duration_ms': duration_ms,
            'timestamp': datetime.utcnow().isoformat(),
        }))
    
    def log_fetch_start(self, ticker, deal_price):
        self.logger.info(json.dumps({
            'event': 'fetch_start',
            'ticker': ticker,
            'deal_price': deal_price,
            'timestamp': datetime.utcnow().isoformat(),
        }))
    
    def log_fetch_complete(self, ticker, contract_count, duration_ms):
        self.logger.info(json.dumps({
            'event': 'fetch_complete',
            'ticker': ticker,
            'contract_count': contract_count,
            'duration_ms': duration_ms,
            'timestamp': datetime.utcnow().isoformat(),
        }))
    
    def log_error(self, event, error, context=None):
        self.logger.error(json.dumps({
            'event': event,
            'error': str(error),
            'context': context or {},
            'timestamp': datetime.utcnow().isoformat(),
        }))

# Usage
structured_log = StructuredLogger(logger)
```

---

### 5.2: Metrics Collection

**New File**: `lib/metrics/agent_metrics.ts`

```typescript
import { prisma } from '@/lib/db';

export class AgentMetrics {
  /**
   * Track agent spawn event
   */
  static async recordSpawn(ticker: string, agentId: string, success: boolean) {
    // Could write to a metrics table or external service
    console.log(JSON.stringify({
      event: 'agent_spawn',
      ticker,
      agentId,
      success,
      timestamp: new Date().toISOString(),
    }));
  }
  
  /**
   * Get agent performance stats
   */
  static async getPerformanceStats(hours: number = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const snapshots = await prisma.optionChainSnapshot.findMany({
      where: { createdAt: { gte: since } },
      select: {
        ticker: true,
        agentId: true,
        createdAt: true,
        snapshotDate: true,
        expirationCount: true,
        strikeCount: true,
      },
    });
    
    return {
      totalFetches: snapshots.length,
      uniqueTickers: new Set(snapshots.map(s => s.ticker)).size,
      uniqueAgents: new Set(snapshots.map(s => s.agentId)).size,
      avgContractsPerFetch: snapshots.reduce((sum, s) => 
        sum + (s.expirationCount * s.strikeCount), 0) / snapshots.length,
    };
  }
  
  /**
   * Get error rate
   */
  static async getErrorRate(hours: number = 24) {
    // In production, read from error logs or metrics table
    // For now, estimate from missing snapshots
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    // Query application logs for agent errors
    // This is a placeholder - actual implementation depends on log storage
    return {
      totalAttempts: 0,  // Would come from logs
      failures: 0,       // Would come from logs
      errorRate: 0.0,
    };
  }
}
```

**Usage in API**:
```typescript
// In fetch-chain/route.ts
import { AgentMetrics } from '@/lib/metrics/agent_metrics';

// After agent spawn
await AgentMetrics.recordSpawn(ticker, 'auto-spawned', agentSuccess);
```

---

### 5.3: Monitoring Dashboard (Future Enhancement)

**New Route**: `app/admin/agent-metrics/page.tsx`

```typescript
export default async function AgentMetricsPage() {
  const stats = await AgentMetrics.getPerformanceStats(24);
  
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Price Agent Metrics</h1>
      
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Fetches (24h)" value={stats.totalFetches} />
        <MetricCard title="Unique Tickers" value={stats.uniqueTickers} />
        <MetricCard title="Active Agents" value={stats.uniqueAgents} />
        <MetricCard title="Avg Contracts/Fetch" value={Math.round(stats.avgContractsPerFetch)} />
      </div>
      
      {/* Add charts, error logs, etc. */}
    </div>
  );
}
```

---

### Phase 5 Checklist

- [ ] Structured logging implemented
- [ ] Metrics collection in place
- [ ] Performance stats queryable
- [ ] Error tracking functional
- [ ] Monitoring dashboard (optional, future)

---

## Phase 6: Documentation & Runbooks

### Objective
Enable efficient debugging and maintenance.

### 6.1: Debugging Runbook

**File**: `docs/AGENT_DEBUGGING_RUNBOOK.md`

**Contents**:
1. **Common Errors and Solutions**
   - Client ID conflicts
   - IB connection failures
   - Agent hangs/timeouts
   - Database issues

2. **Diagnostic Commands**
   ```bash
   # Check agent processes
   ps aux | grep price_agent
   
   # Check recent snapshots
   psql -U donaldross -d ma_tracker -c \
     "SELECT ticker, agent_id, snapshot_date FROM option_chain_snapshots ORDER BY snapshot_date DESC LIMIT 10;"
   
   # Check server logs for agent spawns
   grep "Spawning price agent" ~/.cursor/projects/*/terminals/*.txt | tail -20
   
   # Check for client ID conflicts
   grep -i "client id.*already in use" ~/.cursor/projects/*/terminals/*.txt
   ```

3. **Recovery Procedures**
   - Restart IB TWS
   - Kill zombie agents
   - Clear stale database entries
   - Restart Next.js server

---

### 6.2: Operational Playbook

**File**: `docs/AGENT_OPERATIONS_PLAYBOOK.md`

**Contents**:
1. **Daily Operations**
   - Morning check (verify status green)
   - Monitor error rate
   - Check for zombie processes

2. **Weekly Maintenance**
   - Review performance metrics
   - Clean old snapshots (> 30 days)
   - Update documentation with new issues

3. **Incident Response**
   - High error rate (> 10%)
   - Complete outage
   - Performance degradation

---

### 6.3: Code Comments & Inline Documentation

**Enhancement**: Add critical comments to `price_agent.py`

```python
def connect_to_ib(self) -> bool:
    """
    Connect to local IB TWS
    
    CRITICAL: Uses random client ID to avoid conflicts.
    ID Range: 300-399 (reserved for price agents)
    
    Why random vs. sequential?
    - No state management needed
    - Works with concurrent spawns
    - Low collision probability (100 IDs, ~5 concurrent agents max)
    
    Known Issues:
    - If collision occurs, agent fails and user must retry
    - TODO: Add retry logic with different client ID
    
    Returns:
        bool: True if connected successfully
    """
```

---

### Phase 6 Checklist

- [ ] Debugging runbook created
- [ ] Operations playbook created
- [ ] Critical code sections documented
- [ ] Error messages are actionable
- [ ] Links to docs added to error responses

---

## Success Metrics

### Immediate (End of Today)
- ✅ All Phase 1 manual tests pass
- ✅ No zombie processes after testing
- ✅ No client ID conflicts observed
- ✅ Option chains load reliably for 3+ tickers

### Short-term (This Week)
- ✅ All Phase 2 edge case tests documented
- ✅ Error handling gaps identified and prioritized
- ✅ Python unit tests written and passing
- ✅ TypeScript integration tests written and passing

### Long-term (This Month)
- ✅ 80% test coverage of critical paths
- ✅ CI/CD pipeline enforces tests on PR
- ✅ Monitoring dashboard showing agent metrics
- ✅ Debugging runbook used successfully in real incident

---

## Risk Mitigation

### High-Priority Risks

1. **Agent Hangs Indefinitely**
   - **Mitigation**: Add 60-second timeout on agent spawn
   - **Fallback**: Return cached data if available
   - **Monitoring**: Track spawn duration metrics

2. **Client ID Collision**
   - **Mitigation**: Use large ID range (100 IDs)
   - **Fallback**: Retry with new random ID
   - **Monitoring**: Log all collision events

3. **IB TWS Disconnect Mid-Fetch**
   - **Mitigation**: Agent detects disconnect and exits gracefully
   - **Fallback**: UI shows clear error, user can retry
   - **Monitoring**: Track connection failure rate

4. **Database Write Failure**
   - **Mitigation**: Agent still returns data to UI even if save fails
   - **Fallback**: Warn user data not cached
   - **Monitoring**: Track database error rate

### Medium-Priority Risks

5. **Zombie Processes**
   - **Mitigation**: Agent disconnects cleanly, exit on error
   - **Monitoring**: Periodic check for running agents

6. **Stale Cached Data**
   - **Mitigation**: UI shows age metadata prominently
   - **Fallback**: User can manually refresh
   - **Monitoring**: Track average data age

---

## Implementation Priorities

### P0 (Must Have - Today)
- ✅ Phase 1 manual tests (validate connection logic)
- ✅ Phase 2 basic error handling (TWS disconnect, invalid ticker)

### P1 (Should Have - This Week)
- Python unit tests (client ID allocation)
- TypeScript integration tests (fetch-chain route)
- Agent timeout implementation
- Structured logging

### P2 (Nice to Have - This Month)
- E2E tests (Playwright)
- Regression test suite
- CI/CD pipeline
- Monitoring dashboard
- Operations playbook

### P3 (Future)
- Advanced metrics
- Retry logic for client ID collisions
- Connection pooling
- Multi-agent load balancing

---

## Next Steps

### Immediate Actions (Today)
1. Run Phase 1 manual tests (30 minutes)
2. Document any failures in `AGENT_ERROR_HANDLING_GAPS.md`
3. If all pass, proceed to Phase 2 edge cases

### This Week
1. Implement Python unit tests
2. Implement TypeScript integration tests
3. Add agent timeout to `fetch-chain/route.ts`
4. Add structured logging to `price_agent.py`

### This Month
1. Set up CI/CD pipeline
2. Create monitoring dashboard
3. Write debugging runbook based on real incidents
4. Refine error handling based on test results

---

## Appendix

### A. Test Data Setup

```sql
-- Ensure test deals exist
INSERT INTO deals (deal_id, ticker, target_name, acquiror_name, cash_per_share, expected_close_date)
VALUES 
  ('test-ea', 'EA', 'Electronic Arts', 'Test Acquirer', 210.57, '2025-09-17'),
  ('test-al', 'AL', 'Air Lease', 'Test Acquirer', 57.00, '2025-12-31'),
  ('test-csgs', 'CSGS', 'CSG Systems', 'Test Acquirer', 34.75, '2025-06-30')
ON CONFLICT (deal_id) DO NOTHING;
```

### B. Quick Command Reference

```bash
# Start services
npm run dev                   # Next.js
# IB TWS (manual)
# Postgres.app (manual)

# Run tests
npm test                      # All tests
npm test -- --watch           # Watch mode
npm test -- --coverage        # With coverage

cd python-service
pytest tests/ -v              # Python tests

# Check agent status
ps aux | grep price_agent

# Check database
psql -U donaldross -d ma_tracker -c \
  "SELECT ticker, agent_id, snapshot_date FROM option_chain_snapshots ORDER BY snapshot_date DESC LIMIT 10;"

# Check logs
tail -f ~/.cursor/projects/*/terminals/5.txt  # Next.js logs
```

### C. Related Documentation

- [`AGENT_READY_FOR_TESTING.md`](AGENT_READY_FOR_TESTING.md) - Quick start guide
- [`AGENT_TESTING_CHECKLIST.md`](AGENT_TESTING_CHECKLIST.md) - Manual test procedures
- [`IB_CLIENT_ID_GUIDE.md`](IB_CLIENT_ID_GUIDE.md) - Client ID troubleshooting
- [`CLIENT_ID_FIX_SUMMARY.md`](CLIENT_ID_FIX_SUMMARY.md) - Implementation details

---

**Plan Ready for Execution** ✅

Start with Phase 1 manual tests, then build out automated testing incrementally based on what you learn from real usage.

