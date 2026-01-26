# MA Options Scanner - Distributed Architecture Evolution

**Date:** December 26, 2025  
**Status:** 📋 Design Phase  
**Goal:** Decouple IB TWS from droplet while preserving proven pricing logic

---

## 🔍 Current Architecture Audit

### What Works (DO NOT CHANGE)

**IB TWS Integration** ✅ PROVEN
- `python-service/app/scanner.py` - `IBMergerArbScanner` class
  - Inherits from `EWrapper` and `EClient` (IB API)
  - Connects to TWS/Gateway on `127.0.0.1:7497`
  - Fetches underlying prices via `fetch_underlying_data(ticker)`
  - Fetches option chains via `fetch_option_chain(ticker, ...)`
  - Handles callbacks: `tickPrice()`, `tickSize()`, `contractDetails()`
  - **Status:** Working, battle-tested, DO NOT REWRITE

**IB Client Singleton** ✅ PROVEN
- `python-service/app/options/ib_client.py` - `IBClient` class
  - Singleton pattern for connection management
  - Handles connect/disconnect/reconnect logic
  - Stale connection detection (5-minute heartbeat timeout)
  - **Status:** Working, robust, PRESERVE

**API Routes** ✅ PROVEN
- `python-service/app/api/options_routes.py`
  - `POST /options/chain` - Fetch option chain
  - `POST /options/price-spreads` - Price multiple spreads
  - `POST /options/generate-strategies` - Generate trade ideas
  - **Status:** Working, well-defined contracts, KEEP

**Next.js Integration** ✅ PROVEN
- `app/api/ma-options/fetch-chain/route.ts` - Calls Python service
- `app/api/ma-options/update-spread-prices/route.ts` - Updates prices
- **Status:** Working, clean separation, PRESERVE

### Current Data Flow

```
User (Browser)
    ↓
Next.js API Route (Droplet)
    ↓ HTTP POST
Python Service (Droplet)
    ↓ IB API
IB TWS/Gateway (Droplet) ← ❌ PROBLEM: Must run on user machine
    ↓
Interactive Brokers Servers
```

### What Must Change

**Problem:** IB TWS runs on droplet with credentials
- ❌ Security risk: IB credentials on server
- ❌ Single point of failure
- ❌ Can't leverage multiple users' connections

**Solution:** Move IB TWS to user machines
- ✅ Credentials stay local
- ✅ Multiple agents can provide data
- ✅ Server only receives validated price updates

---

## 🎯 New Architecture Design

### Target Data Flow

```
User Machine A                    User Machine B
    ↓                                ↓
IB TWS (Local)                   IB TWS (Local)
    ↓                                ↓
Price Agent (Python)             Price Agent (Python)
    ↓ HTTPS POST                     ↓ HTTPS POST
    └────────────┬───────────────────┘
                 ↓
         Droplet (Server)
         - Ingestion API (auth required)
         - Price validation
         - Database persistence
                 ↓
         Next.js UI
                 ↓
         User (Browser)
```

### Component Roles

**Price Agent (User Machine)**
- Runs Python service locally
- Connects to local IB TWS (127.0.0.1:7497)
- Fetches prices on demand or schedule
- POSTs price updates to server
- **NO DATABASE ACCESS**
- **NO IB CREDENTIALS LEAVE MACHINE**

**Server (Droplet)**
- Receives price updates via authenticated API
- Validates payloads (schema, freshness, sanity checks)
- Persists to database
- Serves UI
- **NO IB TWS CONNECTION**
- **NO IB CREDENTIALS**

---

## 🔧 Implementation Strategy

### Phase 1: Extract Price Agent (Minimal Changes)

**Goal:** Run existing Python service locally, POST prices to server

**Changes to `scanner.py`:**
- **NONE** - Keep all IB logic exactly as-is
- Scanner still connects to `127.0.0.1:7497`
- Scanner still fetches prices the same way

**New File: `price_agent.py`**
```python
"""
Price Agent - Runs on user machine with IB TWS
Fetches prices and sends to server
"""

from app.options.ib_client import IBClient
from app.scanner import IBMergerArbScanner
import requests
import os
import time
import logging

class PriceAgent:
    def __init__(self, server_url: str, api_key: str):
        self.server_url = server_url
        self.api_key = api_key
        self.ib_client = IBClient()
        
    def connect_to_ib(self) -> bool:
        """Connect to local IB TWS - UNCHANGED LOGIC"""
        return self.ib_client.connect()
    
    def fetch_and_send_chain(self, ticker: str, deal_price: float, 
                             close_date: str, scan_params: dict):
        """Fetch chain and POST to server - NEW WRAPPER"""
        # 1. Fetch from IB (existing logic)
        scanner = self.ib_client.get_scanner()
        if not scanner:
            raise Exception("IB not connected")
        
        # Use EXISTING fetch_option_chain method
        options = scanner.fetch_option_chain(
            ticker=ticker,
            current_price=None,  # Will fetch
            deal_close_date=datetime.strptime(close_date, "%Y-%m-%d"),
            days_before_close=scan_params.get('daysBeforeClose', 0),
            deal_price=deal_price
        )
        
        # 2. POST to server (new)
        payload = {
            'ticker': ticker,
            'timestamp': datetime.utcnow().isoformat(),
            'contracts': [self._serialize_option(opt) for opt in options]
        }
        
        response = requests.post(
            f"{self.server_url}/api/price-agent/ingest-chain",
            json=payload,
            headers={'Authorization': f'Bearer {self.api_key}'},
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    
    def _serialize_option(self, opt):
        """Convert OptionData to JSON - PRESERVE STRUCTURE"""
        return {
            'symbol': opt.symbol,
            'strike': opt.strike,
            'expiry': opt.expiry,
            'right': opt.right,
            'bid': opt.bid,
            'ask': opt.ask,
            'mid': opt.mid_price,
            'last': opt.last,
            'volume': opt.volume,
            'open_interest': opt.open_interest,
            'implied_vol': opt.implied_vol,
            'delta': opt.delta,
            'bid_size': opt.bid_size,
            'ask_size': opt.ask_size
        }
```

**Key Principles:**
- ✅ Reuses `IBClient` and `IBMergerArbScanner` unchanged
- ✅ Wraps existing methods, doesn't replace them
- ✅ Adds HTTP POST layer on top
- ✅ Preserves all IB logic

### Phase 2: Server Ingestion API

**New File: `app/api/price-agent/ingest-chain/route.ts`**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const AGENT_API_KEY = process.env.PRICE_AGENT_API_KEY;

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization" },
        { status: 401 }
      );
    }
    
    const apiKey = authHeader.substring(7);
    if (apiKey !== AGENT_API_KEY) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 403 }
      );
    }
    
    // 2. Validate payload
    const body = await request.json();
    const { ticker, timestamp, contracts } = body;
    
    if (!ticker || !timestamp || !Array.isArray(contracts)) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }
    
    // 3. Freshness check (reject stale data)
    const dataAge = Date.now() - new Date(timestamp).getTime();
    if (dataAge > 5 * 60 * 1000) { // 5 minutes
      return NextResponse.json(
        { error: "Data too old" },
        { status: 400 }
      );
    }
    
    // 4. Find deal by ticker
    const deal = await prisma.deal.findFirst({
      where: { ticker: ticker.toUpperCase() },
    });
    
    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found" },
        { status: 404 }
      );
    }
    
    // 5. Calculate spot price from contracts (or require in payload)
    const spotPrice = body.spotPrice || 
      (contracts[0]?.strike || 0); // Fallback logic
    
    // 6. Calculate days to close
    const dealVersion = await prisma.dealVersion.findFirst({
      where: { dealId: deal.id, isCurrentVersion: true },
    });
    
    const daysToClose = dealVersion?.expectedCloseDate
      ? Math.ceil(
          (new Date(dealVersion.expectedCloseDate).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;
    
    // 7. Save snapshot (SAME LOGIC as before)
    await prisma.optionChainSnapshot.create({
      data: {
        dealId: deal.id,
        ticker: ticker.toUpperCase(),
        snapshotDate: new Date(timestamp),
        spotPrice,
        dealPrice: dealVersion?.cashPerShare || 0,
        daysToClose,
        chainData: contracts,
        expirationCount: [...new Set(contracts.map(c => c.expiry))].length,
        strikeCount: [...new Set(contracts.map(c => c.strike))].length,
      },
    });
    
    return NextResponse.json({
      success: true,
      dealId: deal.id,
      contractsReceived: contracts.length,
    });
  } catch (error) {
    console.error("Error ingesting chain:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
      );
  }
}
```

**Key Principles:**
- ✅ Authenticates with API key
- ✅ Validates payload structure
- ✅ Checks data freshness
- ✅ Reuses existing database logic
- ✅ Returns clear errors

### Phase 3: Update Existing Routes

**Modify: `app/api/ma-options/fetch-chain/route.ts`**

**Before:**
```typescript
// Call Python service to fetch option chain
const response = await fetch(`${PYTHON_SERVICE_URL}/options/chain`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticker, dealPrice, expectedCloseDate }),
});
```

**After:**
```typescript
// Check if we have recent data from price agents
const recentSnapshot = await prisma.optionChainSnapshot.findFirst({
  where: {
    ticker: ticker.toUpperCase(),
    snapshotDate: {
      gte: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes
    },
  },
  orderBy: { snapshotDate: "desc" },
});

if (recentSnapshot) {
  // Use cached data from price agent
  return NextResponse.json({
    ticker: recentSnapshot.ticker,
    spotPrice: recentSnapshot.spotPrice,
    expirations: [...new Set(recentSnapshot.chainData.map(c => c.expiry))],
    contracts: recentSnapshot.chainData,
    source: "agent",
    timestamp: recentSnapshot.snapshotDate,
  });
}

// Fallback: Request from price agent (if configured)
// OR return error asking user to run price agent
return NextResponse.json(
  {
    error: "No recent price data available. Please run the Price Agent with IB TWS connected.",
    requiresAgent: true,
  },
  { status: 503 }
);
```

**Key Principles:**
- ✅ Prefers recent agent data
- ✅ Clear error when agent needed
- ✅ Graceful degradation

---

## 🔐 Security & Configuration

### Agent Configuration (User Machine)

**File: `.env.local` (on user machine)**
```bash
# Server connection
SERVER_URL=https://134.199.204.12:3000
PRICE_AGENT_API_KEY=your-secret-key-here

# IB TWS connection (local)
IB_HOST=127.0.0.1
IB_PORT=7497
IB_CLIENT_ID=100
```

### Server Configuration (Droplet)

**File: `.env.local` (on droplet)**
```bash
# Price agent authentication
PRICE_AGENT_API_KEY=your-secret-key-here

# Remove IB-related vars (no longer needed on server)
# IB_HOST=...  ← DELETE
# IB_PORT=...  ← DELETE
```

### API Key Generation

```bash
# Generate secure API key
openssl rand -hex 32
```

**Distribution:**
- Store in 1Password or similar
- Share with authorized users
- Rotate periodically

---

## 🔄 Multi-Agent Considerations

### Conflict Resolution Strategy

**Problem:** Multiple agents send overlapping data

**Solution: Last-Write-Wins with Timestamp**
```typescript
// In ingestion API
const existing = await prisma.optionChainSnapshot.findFirst({
  where: {
    ticker: ticker.toUpperCase(),
    snapshotDate: {
      gte: new Date(Date.now() - 60 * 1000), // 1 minute window
    },
  },
  orderBy: { snapshotDate: "desc" },
});

if (existing) {
  const existingAge = Date.now() - existing.snapshotDate.getTime();
  const newAge = Date.now() - new Date(timestamp).getTime();
  
  if (newAge > existingAge) {
    // New data is older, reject
    return NextResponse.json(
      { error: "Newer data already exists", skipped: true },
      { status: 409 }
    );
  }
}

// Proceed with save (newer data)
```

**Key Principles:**
- ✅ Timestamp-based ordering
- ✅ Reject stale updates
- ✅ No complex leader election
- ✅ Simple, deterministic

### Agent Health Monitoring

**Add to ingestion API:**
```typescript
// Track agent activity
await prisma.priceAgentActivity.create({
  data: {
    agentId: apiKey.substring(0, 8), // First 8 chars as ID
    ticker,
    timestamp: new Date(timestamp),
    contractCount: contracts.length,
  },
});
```

**Dashboard Query:**
```sql
SELECT 
  agent_id,
  COUNT(*) as updates_count,
  MAX(timestamp) as last_seen,
  AVG(contract_count) as avg_contracts
FROM price_agent_activity
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY agent_id;
```

---

## ✅ Validation Plan

### Step 1: Local Testing (No Server Changes)

```bash
# On user machine
cd python-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create price_agent.py (as designed above)
# Create .env.local with SERVER_URL and API_KEY

# Test IB connection
python3 -c "from app.options.ib_client import IBClient; c = IBClient(); print(c.connect())"

# Test price fetch
python3 price_agent.py --ticker CSGS --test
```

**Expected Output:**
```
✓ Connected to IB TWS
✓ Fetched 47 option contracts for CSGS
✓ Posted to server: 200 OK
✓ Server confirmed: dealId=abc123, contractsReceived=47
```

### Step 2: Server Integration

```bash
# On droplet
# Add ingestion API route (as designed above)
# Deploy and restart

# Test from user machine
curl -X POST https://134.199.204.12:3000/api/price-agent/ingest-chain \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"CSGS","timestamp":"2025-12-26T20:00:00Z","contracts":[...]}'
```

**Expected Response:**
```json
{
  "success": true,
  "dealId": "fa4e7c34-4f2d-4ec9-b2c5-aab1090e19b5",
  "contractsReceived": 47
}
```

### Step 3: UI Verification

```bash
# Visit MA Options Scanner
open http://134.199.204.12:3000/ma-options

# Select CSGS
# Click "Fetch Option Chain"

# Expected:
# - Shows 47 contracts
# - Source: "agent"
# - Timestamp: recent
# - No "IB TWS not connected" error
```

---

## 📊 What Stayed the Same

### Unchanged Components ✅

1. **`scanner.py`** - All IB API logic
   - `IBMergerArbScanner` class
   - `fetch_underlying_data()`
   - `fetch_option_chain()`
   - All callbacks and data structures

2. **`ib_client.py`** - Connection management
   - Singleton pattern
   - Connect/disconnect logic
   - Stale connection detection

3. **Data Structures** - All preserved
   - `OptionData` dataclass
   - `DealInput` dataclass
   - `TradeOpportunity` dataclass

4. **Price Calculation** - Unchanged
   - Bid/ask/mid logic
   - Strike selection
   - Expiration filtering

### What Changed ✅

1. **Deployment Location**
   - Before: Python service on droplet
   - After: Price agent on user machine

2. **Data Transmission**
   - Before: Direct DB writes
   - After: HTTP POST to server API

3. **Authentication**
   - Before: None (local service)
   - After: API key required

4. **Configuration**
   - Before: Server env vars
   - After: User machine `.env.local`

### Why This Preserves Correctness ✅

1. **Same IB API calls** - No changes to proven logic
2. **Same data structures** - No serialization bugs
3. **Same calculations** - No rounding errors
4. **Additive changes** - Wrapping, not replacing
5. **Backward compatible** - Can run old way for testing

---

## 🚀 Deployment Strategy

### Phase 1: Parallel Operation (Safe)

1. Keep existing Python service on droplet (unchanged)
2. Deploy price agent to user machine
3. Deploy ingestion API to droplet
4. Test with single user
5. Verify data matches between old and new paths

### Phase 2: Gradual Migration

1. Update UI to prefer agent data
2. Add fallback to old service
3. Monitor for 1 week
4. Collect feedback

### Phase 3: Full Cutover

1. Remove Python service from droplet
2. Remove IB TWS from droplet
3. Update all users to run price agent
4. Remove fallback code

---

## 📚 Files to Create/Modify

### New Files

1. **`python-service/price_agent.py`** - Agent entry point
2. **`python-service/agent_config.py`** - Agent configuration
3. **`app/api/price-agent/ingest-chain/route.ts`** - Ingestion API
4. **`app/api/price-agent/ingest-spread-prices/route.ts`** - Spread pricing
5. **`prisma/migrations/XXX_price_agent_activity.sql`** - Activity tracking
6. **`docs/PRICE_AGENT_SETUP.md`** - User instructions

### Modified Files

1. **`app/api/ma-options/fetch-chain/route.ts`** - Prefer agent data
2. **`app/api/ma-options/update-spread-prices/route.ts`** - Prefer agent data
3. **`.env.example`** - Add PRICE_AGENT_API_KEY
4. **`docker-compose.yml`** - Remove Python service (later)

### Unchanged Files ✅

1. **`python-service/app/scanner.py`** - NO CHANGES
2. **`python-service/app/options/ib_client.py`** - NO CHANGES
3. **`python-service/app/options/models.py`** - NO CHANGES

---

## 🎯 Success Criteria

### Technical

- [ ] Price agent connects to local IB TWS
- [ ] Price agent POSTs data to server
- [ ] Server validates and persists data
- [ ] UI displays agent-sourced prices
- [ ] No IB credentials on server
- [ ] Multiple agents can coexist

### User Experience

- [ ] Setup takes < 10 minutes
- [ ] Clear error messages when agent offline
- [ ] No performance degradation
- [ ] Prices update within 5 seconds

### Security

- [ ] API key required for ingestion
- [ ] Stale data rejected
- [ ] Invalid payloads rejected
- [ ] IB credentials never transmitted

---

**Next Step:** Implement Phase 1 (Price Agent extraction)

