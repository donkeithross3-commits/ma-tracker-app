# EDGAR/Intelligence Grid Performance Optimization Plan

## Current Performance Bottlenecks (Analyzed 2025-11-17)

### 1. **Sequential Tab Loading**
**Location**: `app/staging/page.tsx` lines 166-183
**Problem**: Data is only fetched AFTER user clicks a tab, causing 1-3 second delays
**Impact**: User sees loading spinner on every tab switch

### 2. **No Data Caching**
**Problem**: Every tab switch re-fetches the same data from backend
**Impact**: Unnecessary API calls, database queries, network latency

### 3. **No Background Preloading**
**Problem**: Only active tab's data is in memory
**Impact**: Switching between "EDGAR → Intelligence → Halts" requires 3 sequential waits

### 4. **Aggressive Status Polling**
**Location**: line 222 - `setInterval(fetchMonitoringStatus, 10000)`
**Problem**: Fetches monitoring status every 10 seconds even when unchanged
**Impact**: 360 API calls per hour per user

### 5. **Filter Changes Trigger Full Refetches**
**Location**: lines 185-191
**Problem**: Every filter tweak (status, days, minKeywords) causes complete reload
**Impact**: User waits 500ms-2s for simple filter changes

---

## Optimization Strategy

### Phase 1: Parallel Data Loading (HIGHEST IMPACT)

**Goal**: Load ALL tab data in parallel on page mount - NEVER wait for tab clicks

**Implementation**:
```typescript
useEffect(() => {
  const fetchAllDataInParallel = async () => {
    console.log("[PERF] Starting parallel data fetch");
    const startTime = performance.now();

    // Fire ALL requests simultaneously
    await Promise.allSettled([
      // EDGAR data
      fetchDeals("pending"),
      fetchDeals("approved"),
      fetchDeals("rejected"),
      fetchFilings(filingsFilters),

      // Intelligence data
      fetchIntelligenceDeals("pending"),
      fetchIntelligenceDeals("watchlist"),
      fetchIntelligenceDeals("rejected"),
      fetchIntelligenceSources(),
      fetchWatchList(),

      // Halts data
      fetchHalts(),

      // Status
      fetchMonitoringStatus()
    ]);

    console.log(`[PERF] Parallel fetch completed in ${performance.now() - startTime}ms`);
  };

  fetchAllDataInParallel();
}, []);
```

**Expected Improvement**:
- Before: 3 sequential fetches × 1-2s each = 3-6 seconds total
- After: 1 parallel fetch = 1-2 seconds total (2-3x faster)

---

### Phase 2: Client-Side Caching with SWR

**Goal**: Cache all fetched data with 30-second TTL, serve from cache instantly

**Implementation**: Use SWR library or custom cache
```typescript
interface DataCache<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30000; // 30 seconds

const fetchDeals = async (status: string) => {
  const cacheKey = `deals_${status}`;
  const cached = cache[cacheKey];

  // Return cached data if fresh
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return cached.data;
  }

  // Fetch fresh data
  const data = await fetch(...).then(r => r.json());
  cache[cacheKey] = { data, timestamp: Date.now() };
  return data;
};
```

**Expected Improvement**:
- Before: Every tab switch = 500ms-2s wait
- After: Cached tab switch = 0ms (instant!)

---

### Phase 3: Optimistic UI & Skeleton Loaders

**Goal**: Show skeleton UI immediately while data loads

**Implementation**:
```typescript
{loading ? (
  <div className="space-y-2">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="animate-pulse flex space-x-4 bg-gray-100 p-4 rounded">
        <div className="h-4 bg-gray-300 rounded w-3/4"></div>
        <div className="h-4 bg-gray-300 rounded w-1/4"></div>
      </div>
    ))}
  </div>
) : (
  // Actual data grid
)}
```

**Expected Improvement**:
- Before: Blank screen + spinner = feels slow
- After: Skeleton UI = feels instant (perceived performance)

---

### Phase 4: Database Query Optimization

**Goal**: Add indexes on frequently queried columns

**Queries to optimize**:
1. `GET /api/edgar/staged-deals?status=pending`
   - Add index on `status` column in `staged_deals` table
   - Add compound index on `(status, detected_at DESC)` for sorted results

2. `GET /api/edgar/filings?status=all&days=7`
   - Add index on `(filing_date DESC, is_ma_relevant)` in `edgar_filings` table

3. `GET /api/intelligence/rumored-deals?exclude_watch_list=true`
   - Add index on `(deal_tier, first_detected_at DESC)` in `deal_intelligence` table

**SQL Commands**:
```sql
-- Create migration: python-service/migrations/022_performance_indexes.sql

-- Staged deals index
CREATE INDEX IF NOT EXISTS idx_staged_deals_status_date
ON staged_deals(status, detected_at DESC);

-- EDGAR filings index
CREATE INDEX IF NOT EXISTS idx_edgar_filings_date_relevant
ON edgar_filings(filing_date DESC, is_ma_relevant);

-- Intelligence deals index
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_tier_date
ON deal_intelligence(deal_tier, first_detected_at DESC);

-- Watch list index
CREATE INDEX IF NOT EXISTS idx_watch_list_ticker
ON rumor_watch_list(ticker);
```

**Expected Improvement**:
- Before: 500ms-1s query time on large tables
- After: 50-100ms query time (5-10x faster)

---

### Phase 5: Reduce Polling Frequency

**Goal**: Poll monitoring status less aggressively

**Changes**:
1. Change status polling from 10s → 30s
2. Use exponential backoff if status unchanged
3. Add manual "Refresh Status" button for immediate updates

**Implementation**:
```typescript
// Before
const statusInterval = setInterval(fetchMonitoringStatus, 10000); // 10s

// After
const statusInterval = setInterval(fetchMonitoringStatus, 30000); // 30s
```

**Expected Improvement**:
- Before: 360 API calls/hour per user
- After: 120 API calls/hour per user (3x reduction)

---

### Phase 6: React Performance Optimizations

**Goal**: Avoid unnecessary re-renders

**Techniques**:
1. **Memoize expensive computations**:
```typescript
const filteredDeals = useMemo(() => {
  return deals.filter(d => d.status === filter);
}, [deals, filter]);
```

2. **Memoize components**:
```typescript
const DealRow = React.memo(({ deal }: { deal: StagedDeal }) => {
  return <tr>...</tr>;
});
```

3. **Use useCallback for event handlers**:
```typescript
const handleReject = useCallback((dealId: string) => {
  // ...
}, []);
```

**Expected Improvement**:
- Before: Full component re-render on every state change
- After: Only changed rows re-render (smoother UI)

---

## Implementation Priority

### Immediate (Week 1):
1. ✅ **Parallel data loading** - Biggest impact, easiest to implement
2. ✅ **Client-side caching** - Instant tab switching
3. ✅ **Reduce polling frequency** - Less server load

### Short-term (Week 2):
4. **Database indexes** - Backend performance boost
5. **Skeleton loaders** - Better perceived performance

### Nice-to-have (Week 3):
6. **React memoization** - Smoother interactions
7. **Virtual scrolling** (if >100 rows) - Handle large datasets

---

## Performance Metrics

### Current Baseline:
- Initial page load: 2-3 seconds
- Tab switch: 1-2 seconds
- Filter change: 500ms-1s
- Monitoring polls: 360/hour per user

### Target After Optimization:
- Initial page load: 1-2 seconds (30% faster)
- Tab switch: 0-50ms (instant from cache)
- Filter change: 0-100ms (instant from cache)
- Monitoring polls: 120/hour per user (66% reduction)

---

## Code Changes Required

### 1. `app/staging/page.tsx`
- [ ] Add parallel data fetching in `useEffect` on mount
- [ ] Implement cache layer for all data fetches
- [ ] Reduce status polling interval to 30s
- [ ] Add `useMemo` for computed values
- [ ] Add `useCallback` for handlers

### 2. Backend API Endpoints (optional, for extra speed)
- [ ] Add `Cache-Control` headers to API responses
- [ ] Implement server-side caching (Redis/in-memory)

### 3. Database
- [ ] Create migration with performance indexes
- [ ] Apply migration to production database

---

## Testing Plan

### Before Optimization:
```bash
# Measure current performance
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/staging
```

### After Each Phase:
1. Measure page load time (Chrome DevTools → Performance)
2. Count API calls (Network tab)
3. Test with slow 3G throttling
4. Load test with 10+ concurrent users

### Success Criteria:
- ✅ Tab switching < 100ms
- ✅ Initial load < 2s
- ✅ API calls reduced by 50%
- ✅ No visual jank/flicker

---

## Rollout Strategy

1. **Feature flag**: Add `NEXT_PUBLIC_ENABLE_PERF_OPTIMIZATIONS=true`
2. **Test in development**: Verify all data loads correctly
3. **Deploy to staging**: Test with real data
4. **Monitor metrics**: Check for errors/regressions
5. **Roll out to 10% users**: Canary deployment
6. **Full rollout**: Enable for 100% users

---

## Notes

- All optimizations are **backward compatible** - no breaking changes
- Cache TTL can be tuned based on data freshness requirements
- Consider adding "Force Refresh" button to bypass cache
- Monitor server load after deployment
