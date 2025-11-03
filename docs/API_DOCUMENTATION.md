# M&A Tracker - API Documentation

## Base URLs

**Next.js API (Production):**
```
https://ma-tracker-app.vercel.app/api
```

**Next.js API (Development):**
```
http://localhost:3000/api
```

**Python Options Service:**
```
http://localhost:8000                    # Local development
https://[ngrok-url].ngrok-free.dev      # Production (Luis's PC)
```

---

## Next.js API Routes

### Options Scanner

#### POST /api/options/scan

Analyze options strategies for a merger arbitrage deal.

**Request Body:**
```typescript
{
  ticker: string;              // Stock ticker symbol
  deal_price: number;          // Deal price per share
  expected_close_date: string; // YYYY-MM-DD format
  dividend_before_close?: number; // Default: 0.0
  ctr_value?: number;          // CVR value, default: 0.0
  confidence?: number;         // 0.0-1.0, default: 0.75
}
```

**Response:**
```typescript
{
  success: boolean;
  ticker: string;
  current_price: number;
  deal_value: number;
  spread_pct: number;          // Current spread percentage
  days_to_close: number;
  opportunities: Array<{
    strategy: string;           // e.g., "Long Call ITM 260"
    entry_cost: number;
    max_profit: number;
    breakeven: number;
    expected_return: number;    // Expected return %
    annualized_return: number;  // Annualized return %
    probability_of_profit: number;
    edge_vs_market: number;     // Edge over market IV
    notes: string;
    contracts: Array<{
      symbol: string;
      strike: number;
      expiry: string;
      right: string;            // "C" or "P"
      bid: number;
      ask: number;
      last: number;
      volume: number;
      open_interest: number;
      implied_vol: number;
      delta: number;
      mid_price: number;
    }>;
  }>;
  error?: string;
}
```

**Example:**
```bash
curl -X POST https://ma-tracker-app.vercel.app/api/options/scan \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "deal_price": 280.50,
    "expected_close_date": "2025-06-30",
    "confidence": 0.80
  }'
```

**Error Responses:**
- `400` - Missing required fields
- `503` - Cannot connect to Python service or IB Gateway
- `500` - Internal server error

---

#### GET /api/options/scan

Health check for options scanner service.

**Response:**
```typescript
{
  status: "healthy" | "unhealthy";
  python_service: {
    status: string;
    ib_connected: boolean;
  };
  python_service_url?: string;
  error?: string;
}
```

---

### Research & SEC Filings

#### POST /api/research/fetch-filings

Fetch SEC filings for a deal and store them in the database.

**Request Body:**
```typescript
{
  dealId: string;  // UUID of the deal
  ticker: string;  // Stock ticker to fetch filings for
}
```

**Response:**
```typescript
{
  success: boolean;
  cik: string;                 // SEC Central Index Key
  companyName: string;
  filingsFound: number;        // Total filings found
  filingsStored: number;       // Filings stored (new + existing)
  filings: Array<{
    filing_id: string;
    deal_id: string;
    filing_type: string;       // DEFM14A, 8-K, etc
    filing_date: string;       // ISO date
    accession_number: string;
    edgar_url: string;
    document_url: string;
    fetch_status: string;      // pending, fetched, error
    created_at: string;
  }>;
  error?: string;
}
```

**Example:**
```bash
curl -X POST https://ma-tracker-app.vercel.app/api/research/fetch-filings \
  -H "Content-Type: application/json" \
  -d '{
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "ticker": "AAPL"
  }'
```

**Error Responses:**
- `400` - Missing dealId or ticker
- `404` - Deal not found
- `500` - Failed to fetch filings

---

#### GET /api/research/fetch-filings?dealId={uuid}

Retrieve stored SEC filings for a deal.

**Query Parameters:**
- `dealId` (required) - UUID of the deal

**Response:**
```typescript
{
  success: boolean;
  filings: Array<{
    filing_id: string;
    deal_id: string;
    filing_type: string;
    filing_date: string;
    accession_number: string;
    edgar_url: string;
    html_text: string | null;
    text_extracted: string | null;
    fetched_at: string | null;
    fetch_status: string;
  }>;
}
```

**Example:**
```bash
curl https://ma-tracker-app.vercel.app/api/research/fetch-filings?dealId=550e8400-e29b-41d4-a716-446655440000
```

---

## Python FastAPI Service

### Base Information

**Port:** 8000
**Documentation:** http://localhost:8000/docs (auto-generated OpenAPI docs)

---

#### GET /

Service information endpoint.

**Response:**
```typescript
{
  service: "M&A Options Scanner API";
  version: "1.0.0";
  status: "running";
}
```

---

#### GET /health

Health check endpoint.

**Response:**
```typescript
{
  status: "healthy";
  ib_connected: boolean;
}
```

**Example:**
```bash
curl http://localhost:8000/health
```

---

#### POST /scan

Analyze options for a merger arbitrage deal.

**Request Body:**
```typescript
{
  ticker: string;
  deal_price: number;
  expected_close_date: string; // YYYY-MM-DD
  dividend_before_close?: number; // Default: 0.0
  ctr_value?: number;            // Default: 0.0
  confidence?: number;           // Default: 0.75
}
```

**Response:** (Same as Next.js /api/options/scan response)

**Example:**
```bash
curl -X POST http://localhost:8000/scan \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "deal_price": 280.50,
    "expected_close_date": "2025-06-30"
  }'
```

---

#### GET /test-scan/{ticker}

Quick test endpoint with default parameters.

**Path Parameters:**
- `ticker` - Stock ticker symbol

**Behavior:**
- Fetches current price from IB
- Sets deal price to current price + 5% (realistic merger premium)
- Sets close date to 90 days from now
- Uses default confidence (0.75)

**Response:** (Same as /scan)

**Example:**
```bash
curl http://localhost:8000/test-scan/AAPL
```

---

## SEC EDGAR Public API

The application uses the official SEC data.sec.gov API.

**Base URL:** `https://data.sec.gov`

**Rate Limit:** 10 requests per second

**Required Header:** `User-Agent` with contact information

### Endpoints Used

#### Get Company Tickers

```bash
GET https://data.sec.gov/files/company_tickers.json
```

Returns mapping of tickers to CIK numbers.

---

#### Get Company Submissions

```bash
GET https://data.sec.gov/submissions/CIK{cik}.json
```

Returns company information and filing history.

**Example:**
```bash
curl -H "User-Agent: M&A Tracker contact@example.com" \
  https://data.sec.gov/submissions/CIK0000320193.json
```

---

## Authentication

### Current Setup

**None** - Single-user system currently.

### Future Implementation

When multi-user support is added:

**Authentication Flow:**
1. User logs in → Receives JWT token
2. Include token in Authorization header: `Bearer {token}`
3. Server validates token on each request
4. Token expires after 24 hours

**Protected Endpoints:**
- All /api/deals/* routes
- All /api/portfolio/* routes
- All /api/research/* routes

**Public Endpoints:**
- Health checks
- Landing page

---

## Rate Limiting

### Current Limits

**Next.js API Routes:**
- No rate limiting (development)

**Python Service:**
- No rate limiting (single user)

**SEC EDGAR API:**
- 10 requests/second (enforced by SEC)
- Client-side rate limiting implemented

### Production Recommendations

**Per User:**
- 100 requests/minute for API routes
- 10 options scans/minute
- 5 filing fetches/minute

**Per IP:**
- 1000 requests/hour

**Implementation:**
- Use Vercel Edge Config or Redis
- Return 429 status code when exceeded

---

## Error Handling

### Standard Error Response Format

```typescript
{
  error: string;       // Human-readable error message
  details?: string;    // Additional context
  code?: string;       // Error code for client handling
  status: number;      // HTTP status code
}
```

### Common Error Codes

| Status | Meaning                  | Common Causes                        |
|--------|--------------------------|--------------------------------------|
| 400    | Bad Request              | Missing/invalid parameters           |
| 401    | Unauthorized             | Missing/invalid auth token (future)  |
| 403    | Forbidden                | Insufficient permissions (future)    |
| 404    | Not Found                | Deal/resource doesn't exist          |
| 429    | Too Many Requests        | Rate limit exceeded                  |
| 500    | Internal Server Error    | Unexpected server error              |
| 503    | Service Unavailable      | IB Gateway offline, service down     |

---

## Webhooks (Future)

### Deal Status Changes

```
POST {callback_url}
Content-Type: application/json

{
  event: "deal.status_changed";
  dealId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: string;
}
```

### Report Generated

```
POST {callback_url}
Content-Type: application/json

{
  event: "report.generated";
  dealId: string;
  reportId: string;
  timestamp: string;
}
```

---

## SDK / Client Libraries (Future)

### TypeScript/JavaScript

```typescript
import { MATrackerClient } from '@ma-tracker/sdk';

const client = new MATrackerClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://ma-tracker-app.vercel.app/api',
});

// Scan options
const result = await client.options.scan({
  ticker: 'AAPL',
  dealPrice: 280.50,
  expectedCloseDate: '2025-06-30',
});

// Fetch filings
const filings = await client.research.fetchFilings({
  dealId: 'uuid',
  ticker: 'AAPL',
});
```

### Python

```python
from ma_tracker import Client

client = Client(
    api_key='your-api-key',
    base_url='https://ma-tracker-app.vercel.app/api'
)

# Scan options
result = client.options.scan(
    ticker='AAPL',
    deal_price=280.50,
    expected_close_date='2025-06-30'
)

# Fetch filings
filings = client.research.fetch_filings(
    deal_id='uuid',
    ticker='AAPL'
)
```

---

## Testing

### Postman Collection

A Postman collection is available at `docs/postman/ma-tracker-api.json` (to be created).

### Example Test Scripts

**Test Options Scan:**
```bash
#!/bin/bash

# Test with AAPL
curl -X POST http://localhost:3000/api/options/scan \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "deal_price": 280.50,
    "expected_close_date": "2025-06-30",
    "confidence": 0.80
  }' | jq .
```

**Test SEC Filing Fetch:**
```bash
#!/bin/bash

DEAL_ID="your-deal-uuid"

curl -X POST http://localhost:3000/api/research/fetch-filings \
  -H "Content-Type: application/json" \
  -d "{
    \"dealId\": \"$DEAL_ID\",
    \"ticker\": \"AAPL\"
  }" | jq .
```

---

## Versioning

### API Versioning Strategy

**Current:** No versioning (v1 implicit)

**Future:**
- Version in URL: `/api/v2/options/scan`
- Version in header: `X-API-Version: 2`
- Maintain v1 for 6 months after v2 release

---

## Performance

### Response Times (Target)

| Endpoint                      | Target   | Typical  |
|-------------------------------|----------|----------|
| GET /health                   | < 50ms   | ~20ms    |
| POST /api/options/scan        | < 3s     | ~2s      |
| POST /api/research/fetch-filings | < 10s | ~5s      |
| GET /api/research/fetch-filings  | < 200ms | ~100ms |

### Caching

**Static Data:**
- Company tickers: 24 hours
- SEC filings: 7 days (immutable once fetched)

**Dynamic Data:**
- Current prices: 1 minute
- Options chains: 30 seconds

---

## Support

### API Status Page

Coming soon: https://status.ma-tracker.com

### Issue Reporting

GitHub Issues: https://github.com/donkeithross3-commits/ma-tracker-app/issues

### Contact

Email: contact@ma-tracker.com (placeholder)
