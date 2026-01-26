# M&A Options Scanner - User Guide & Technical Documentation

## Overview

The M&A Options Scanner is a two-sided platform for merger arbitrage options trading:

- **Curator Side**: Select deals, verify options existence, generate candidate spreads, curate watchlist
- **User Side**: Monitor curated spreads with live pricing from IB TWS

## User Workflows

### Curator Workflow

#### 1. Select a Deal

- Navigate to `/ma-options` route
- Click "Curate" tab
- Browse active deals from the database
- Search/filter by ticker or target name
- Click "Select" on a deal row

#### 2. Load Option Chain

- Click "Load Option Chain" button
- System fetches option chain from IB TWS
- Displays spot price, expirations, and contract count
- Option chain viewer shows all contracts (collapsible)

#### 3. Review Candidate Strategies

- System auto-generates candidate strategies:
  - Call verticals
  - Put verticals
  - Single calls/puts
- For each candidate, displays:
  - Net premium (mid and far-touch)
  - Max profit / max loss
  - Return on risk
  - Annualized yield
  - Liquidity score
- Sort by any column

#### 4. Add to Watchlist

- Click "Watch" button on interesting spreads
- Spread is saved to database
- Appears in "Current Watchlist" section below candidates
- Can add notes or deactivate later

### Monitoring Workflow

#### 1. Navigate to Monitoring Tab

- Click "Monitor" tab
- See all active watched spreads across all deals

#### 2. View Live Prices

- Table displays:
  - Deal (ticker + target name)
  - Strategy details
  - Entry premium (when added)
  - **Current premium** (live from IB TWS)
  - P&L ($ and %)
  - Max profit, annualized return
  - Days to close
  - Liquidity metrics
  - Last updated timestamp
  - Status

#### 3. Filter and Sort

- Filter by specific deal using dropdown
- Sort by any column (click header)
- Identify best opportunities

#### 4. Auto-Refresh

- Prices auto-refresh every 30 seconds
- Manual refresh button available
- Visual indicators for P&L (green/red)

#### 5. Deactivate Spreads

- Click "Deactivate" button
- Spread moves to inactive status
- Remains in database for historical record

## Technical Architecture

### Database Schema

#### OptionChainSnapshot

Caches option chain data from IB TWS:

```prisma
model OptionChainSnapshot {
  id              String   @id @default(uuid())
  dealId          String
  ticker          String
  snapshotDate    DateTime @default(now())
  spotPrice       Decimal
  dealPrice       Decimal
  daysToClose     Int
  chainData       Json     // Array of OptionContract objects
  expirationCount Int
  strikeCount     Int
  createdAt       DateTime @default(now())
  deal            Deal     @relation(...)
}
```

#### WatchedSpread

Stores curated spreads for monitoring:

```prisma
model WatchedSpread {
  id              String   @id @default(uuid())
  dealId          String
  curatedBy       String?
  strategyType    String
  expiration      DateTime @db.Date
  legs            Json     // Array of {symbol, strike, right, quantity, side}
  entryPremium    Decimal
  entryDate       DateTime @default(now())
  maxProfit       Decimal
  maxLoss         Decimal
  returnOnRisk    Decimal
  annualizedYield Decimal
  currentPremium  Decimal?
  lastUpdated     DateTime?
  avgBidAskSpread Decimal?
  avgVolume       Int?
  avgOpenInterest Int?
  status          String   @default("active")
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deal            Deal     @relation(...)
  curator         User?    @relation(...)
}
```

### API Routes

#### Next.js API Routes

1. **`GET /api/ma-options/deals`**
   - Fetch active deals for curator selection
   - Returns: `{ deals: DealForScanner[] }`

2. **`GET /api/ma-options/check-availability?ticker=XYZ`**
   - Check if options exist for ticker
   - Returns: `{ available: boolean, expirationCount: number }`

3. **`POST /api/ma-options/fetch-chain`**
   - Fetch option chain and save snapshot
   - Input: `{ dealId, ticker, dealPrice, expectedCloseDate }`
   - Returns: `{ snapshotId, ticker, spotPrice, expirations, contracts }`

4. **`POST /api/ma-options/generate-candidates`**
   - Generate candidate strategies
   - Input: `{ snapshotId, dealId }`
   - Returns: `{ candidates: CandidateStrategy[] }`

5. **`POST /api/ma-options/watch-spread`**
   - Add spread to watchlist
   - Input: `{ dealId, strategy, notes? }`
   - Returns: `{ spreadId, success }`

6. **`GET /api/ma-options/watched-spreads?dealId=xxx`**
   - Fetch watched spreads (optionally filtered)
   - Returns: `{ spreads: WatchedSpreadDTO[] }`

7. **`PATCH /api/ma-options/watched-spreads/[id]`**
   - Update spread (status, notes)
   - Input: `{ status?, notes? }`
   - Returns: `{ success, spread }`

8. **`POST /api/ma-options/update-spread-prices`**
   - Refresh current prices for watched spreads
   - Input: `{ spreadIds: string[] }`
   - Returns: `{ updates: Array<{ spreadId, currentPremium, lastUpdated }> }`

#### Python Service Endpoints

1. **`GET /options/check-availability?ticker=XYZ`**
   - Quick check if options exist
   - Returns: `{ available, expirationCount, error? }`

2. **`POST /options/chain`**
   - Fetch full option chain from IB TWS
   - Input: `{ ticker, dealPrice, expectedCloseDate }`
   - Returns: `{ ticker, spotPrice, expirations, contracts }`

3. **`POST /options/generate-strategies`**
   - Generate candidate strategies from chain data
   - Input: `{ ticker, dealPrice, expectedCloseDate, chainData }`
   - Returns: `{ candidates: CandidateStrategy[] }`

4. **`POST /options/price-spreads`**
   - Get current pricing for multiple spreads
   - Input: `{ spreads: Array<{ spreadId, legs }> }`
   - Returns: `{ prices: Array<{ spreadId, premium, timestamp, legs? }> }`

### Strategy Generation Logic

#### Expiration Filtering

- Select expirations around expected close date ± 30 days
- Provides reasonable buffer for deal timing uncertainty

#### Strike Filtering

- Select strikes around deal price ± 10% and current spot ± 10%
- Captures likely range without too many OTM strikes

#### Strategy Types

1. **Call Vertical (Bull Spread)**
   - Buy lower strike call, sell higher strike call
   - Use case: Bullish on deal closing, cap upside

2. **Put Vertical (Bear Spread)**
   - Buy higher strike put, sell lower strike put
   - Use case: Bearish on deal breaking, cap downside

3. **Long Call**
   - Buy call at-the-money or slightly OTM
   - Use case: Bullish, want unlimited upside

4. **Long Put**
   - Buy put at-the-money or slightly OTM
   - Use case: Bearish, want downside protection

#### Metrics Computation

For each candidate:

1. **Net Premium**: Midpoint and far-touch (worst-case execution)
2. **Max Profit / Max Loss**: Based on strategy type
3. **Return on Risk**: `max_profit / max_loss`
4. **Annualized Yield**: `(max_profit / net_premium) * (365 / days_to_close)`
5. **Liquidity Score (0-100)**:
   - Factors: bid-ask spread, volume, open interest
   - Formula: `(spread_score * 0.5 + volume_score * 0.25 + oi_score * 0.25) * 100`

### UI Components

#### Server Components

- `/ma-options/page.tsx` - Initial data loading

#### Client Components

- `OptionsScannerTabs.tsx` - Radix Tabs for Curate vs Monitoring
- `CuratorTab.tsx` - Container for curator workflow
- `DealSelector.tsx` - Searchable deal dropdown/table
- `DealInfo.tsx` - Display selected deal details
- `OptionChainViewer.tsx` - Collapsible raw option chain table
- `CandidateStrategiesTable.tsx` - Sortable table of candidate strategies
- `WatchlistManager.tsx` - Manage watched spreads for selected deal
- `MonitoringTab.tsx` - Container for monitoring workflow
- `WatchedSpreadsTable.tsx` - Sortable table of all watched spreads with live prices
- `DealFilter.tsx` - Dropdown to filter by deal

### Styling

**Theme**: Dark, dense, trader-friendly (like KRJ UI)

**Table Styling**:
- Dark background (`bg-gray-950`)
- Light text (`text-gray-100`)
- Sticky headers
- Zebra striping
- Hover highlight
- Right-aligned numeric columns
- Compact spacing (`text-xs`, `px-1`, `py-0.5`)

## Setup Instructions

### Prerequisites

1. PostgreSQL database running
2. IB TWS or Gateway running on localhost:7497
3. Python service running on localhost:8000
4. Next.js dev server running on localhost:3000

### Database Migration

```bash
cd /Users/donaldross/dev/ma-tracker-app
npx prisma migrate dev --name add_options_scanner
npx prisma generate
```

### Python Service

The Python service should already be running. The new endpoints are automatically included via `app/api/options_routes.py`.

### Environment Variables

Ensure `.env.local` has:

```
DATABASE_URL="postgresql://..."
PYTHON_SERVICE_URL="http://localhost:8000"
```

### Access the UI

Navigate to: `http://localhost:3000/ma-options`

## Success Criteria

### Curator Workflow

- ✅ Can select a deal from list
- ✅ Can load option chain in < 5 seconds
- ✅ Can generate 20+ candidate strategies
- ✅ Can add spread to watchlist with one click
- ✅ Can see all watched spreads for a deal

### Monitoring Workflow

- ✅ Can view all watched spreads across deals
- ✅ Can filter by specific deal
- ✅ Can see live prices updated every 30 seconds
- ✅ Can calculate P&L automatically
- ✅ Can sort by any metric
- ✅ Can deactivate a spread

### Technical

- ✅ IB TWS connection stable
- ✅ API response times < 2 seconds (except initial chain fetch)
- ✅ No data loss (all watched spreads persisted)
- ✅ Accurate metric calculations
- ✅ Responsive UI (no lag during updates)

## Troubleshooting

### IB TWS Not Connected

- Ensure TWS or Gateway is running
- Check port 7497 is accessible
- Restart Python service

### No Option Data

- Verify ticker has listed options
- Check IB TWS permissions
- Try a different ticker

### Slow Performance

- Reduce number of strikes/expirations
- Check IB TWS rate limits
- Optimize database queries

### Database Errors

- Run migrations: `npx prisma migrate dev`
- Check DATABASE_URL in .env.local
- Verify PostgreSQL is running

## Future Enhancements

- WebSocket for real-time price updates
- Advanced filtering (by liquidity, return, etc.)
- Portfolio view (aggregate P&L)
- Alerts/notifications
- Export to CSV
- Historical performance tracking

