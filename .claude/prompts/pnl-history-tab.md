# P&L History Tab — Dashboard UI Implementation

## Task

Add a **"P&L History"** tab to the MA Options page (`OptionsScannerTabs`). This tab shows historical algo trade performance from PostgreSQL — date-by-date, symbol-by-symbol, model-by-model — with drill-down to individual fills. The data layer is fully deployed and working (v1.16.0).

## Data API (all deployed & tested)

All endpoints require authentication via `getCurrentUser()`. The Next.js proxies handle `user_id` injection automatically.

### 1. Positions List
```
GET /api/ma-options/execution/pnl-history?endpoint=positions
    &status=closed|active    (optional)
    &symbol=SPY              (optional)
    &model_version=v_20260227_071717  (optional)
    &date_from=2026-02-01    (optional)
    &date_to=2026-02-28      (optional)
    &limit=100               (default 100, max 500)
    &offset=0

Response: {
  positions: [{
    position_id, user_id, status, strategy_type, parent_strategy,
    symbol, sec_type, strike, expiry, right_type,
    entry_price, entry_quantity, entry_time,    // entry_time is ISO string
    exit_reason, closed_at,                      // "risk_exit" | "expired_worthless" | "manual_close"
    total_gross_pnl, total_commission, total_net_pnl,  // in dollars
    multiplier,
    model_version,                               // top-level for filtering
    lineage: { model_version, model_type, signal: { probability, direction } },
    risk_config: { preset, ... },
    created_at, updated_at, agent_created_at
  }],
  total_count: number,
  limit: number,
  offset: number
}
```

### 2. Fill Detail (drill-down)
```
GET /api/ma-options/execution/pnl-history/{positionId}

Response: {
  position_id: string,
  fills: [{
    fill_index, fill_time,    // ISO string
    order_id, exec_id, level, // "entry" | "trailing" | "expired_worthless"
    qty_filled, avg_price, remaining_qty, pnl_pct,
    commission, realized_pnl_ib,
    fill_exchange, slippage, last_liquidity
  }]
}
```

### 3. Summary Aggregation
```
GET /api/ma-options/execution/pnl-history?endpoint=summary
    &group_by=date|symbol|model_version
    &date_from=2026-02-01    (optional)
    &date_to=2026-02-28      (optional)

Response: {
  summary: [{
    group_key: string,         // date "2026-02-27", symbol "SPY", or model version
    trades: number,
    wins: number,
    win_rate: number,          // 0-100
    total_gross_pnl: number,
    total_commission: number,
    total_net_pnl: number
  }],
  totals: { trades, wins, win_rate, total_gross_pnl, total_commission, total_net_pnl }
}
```

### 4. Backfill (one-time)
```
POST /api/ma-options/execution/pnl-history
Body: { positions: [...position_store.json contents...] }
Response: { success: true, positions_synced: number, positions_submitted: number }
```

---

## UI Design Requirements

### Layout: Two-panel view

**Top: Summary Cards + Group-By Selector**
- Totals bar: Total Trades | Win Rate | Gross P&L | Commission | Net P&L
- Toggle between group_by: `date` (default) | `symbol` | `model_version`
- Summary table shows grouped aggregates with green/red P&L coloring
- Date range filter: from/to date inputs (compact inline)
- Status filter: All | Active | Closed (default: Closed for historical review)

**Bottom: Position Detail Table**
- Clicking a summary row filters the positions table to that group
- Or: positions table always shows (with filters applied)
- Expandable rows: click to show fill detail inline (accordion pattern)

### Position Table Columns

| Column | Key | Notes |
|--------|-----|-------|
| Symbol | `symbol` | **Locked** — always visible |
| Strike | `strike` | With right_type indicator (C/P) |
| Expiry | `expiry` | Format YYYYMMDD → "Mar 01" |
| Entry | `entry_price` | Dollar format |
| Qty | `entry_quantity` | |
| Status | `status` | Badge: green "active" / gray "closed" |
| Exit | `exit_reason` | Colored: risk_exit (blue), expired (red), manual (gray) |
| Gross P&L | `total_gross_pnl` | Green/red, dollar format |
| Comm | `total_commission` | Gray, dollar format |
| Net P&L | `total_net_pnl` | **Bold**, green/red, dollar format |
| Model | `model_version` | Truncated, tooltip with full version |
| Signal | `lineage.signal.probability` | Probability % that triggered entry |
| Opened | `created_at` | Relative or short date |
| Duration | computed | closed_at - created_at → "2h 15m" or "expired" |

Use the **ColumnChooser** component with `pageKey: "pnlHistory"`. Lock `symbol`. Default visible: symbol, strike, expiry, entry, qty, status, net_pnl, model, opened.

### Fill Detail (expanded row)

When a position row is expanded, fetch `/api/ma-options/execution/pnl-history/{positionId}` and show:

| Time | Level | Qty | Price | P&L % | Commission | Exchange |
|------|-------|-----|-------|-------|------------|----------|

Color the level badges: entry (blue), trailing (green), expired_worthless (red).

### Summary Table Columns (group_by view)

| Column | Notes |
|--------|-------|
| Group | Date / Symbol / Model Version |
| Trades | Count |
| Wins | Count |
| Win Rate | Percentage, green if > 50% |
| Gross P&L | Dollar, green/red |
| Commission | Dollar, gray |
| Net P&L | Dollar, green/red, bold |

### Empty State

When no positions exist yet:
- Show a centered message: "No trade history yet. Positions will appear here once the algo engine completes trades."
- Optionally: a "Backfill" button for importing historical position_store.json (advanced users only — behind a disclosure).

---

## Technical Requirements

### File to create
`components/ma-options/PnlHistoryTab.tsx` — self-contained "use client" component

### File to modify
`components/ma-options/OptionsScannerTabs.tsx` — add the tab trigger + content

### Tab placement
Add after "Charts" tab:
```tsx
<Tabs.Trigger value="pnl-history" className="...same as others...">
  P&L History
</Tabs.Trigger>
```
```tsx
<Tabs.Content value="pnl-history">
  <PnlHistoryTab />
</Tabs.Content>
```

### Patterns to follow (READ THESE FILES)

1. **Tab structure**: `components/ma-options/OptionsScannerTabs.tsx` — how tabs are wired
2. **Column chooser**: `components/ma-options/IBPositionsTab.tsx` — search for `ColumnChooser`, `getVisibleColumns`, `setVisibleColumns`, `d-table-wrap`, `d-table`
3. **P&L display patterns**: `components/ma-options/SignalsTab.tsx` — search for `position_ledger`, `pnl_pct`, `commission`, `total_commission` for green/red coloring and dollar formatting
4. **Data fetching**: `components/ma-options/SignalsTab.tsx` — `useCallback` + `fetch` + `useEffect` polling pattern (but P&L History does NOT need polling — it's historical data, fetch once on mount + on filter change)
5. **Comfort mode**: Wrap the main table in `<div className="d-table-wrap">` with `style={{ "--visible-cols": visibleKeys.length }}` and add `className="d-table"` to `<table>`. See IBPositionsTab for reference.

### Styling rules (CRITICAL — read CLAUDE.md "UI Design Principles")

- **High density**: `px-3 py-2` page padding, `mb-1` to `mb-3` margins, `space-y-3`
- **Dark theme**: `bg-gray-950`, `text-gray-100`
- **Right-aligned numerics**: all dollar amounts and percentages right-aligned, monospace
- **Green/red P&L**: `text-green-400` for positive, `text-red-400` for negative
- **Font sizes**: `text-sm` for table body, `text-xs` for secondary info
- **No decorative fluff**: no large cards, shadows, or borders. Functional density.
- **Column headers can wrap**: prefer wrapping over horizontal scroll

### Dollar formatting helper
```tsx
function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}
```

### Date formatting
```tsx
// "Feb 27, 2:15 PM" for recent, "Feb 27" for dates
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Expiry: "20260301" → "Mar 01"
function fmtExpiry(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || "—";
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = yyyymmdd.slice(6, 8);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}
```

### Duration helper
```tsx
function fmtDuration(openIso: string, closeIso: string | null): string {
  if (!closeIso) return "active";
  const ms = new Date(closeIso).getTime() - new Date(openIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
```

---

## What NOT to do

- Do NOT add polling/auto-refresh. This is historical data — fetch on mount and on filter change only.
- Do NOT import `lightweight-charts` or add any chart visualization. Tables only for v1.
- Do NOT create a separate page route. This is a tab within the existing MA Options page.
- Do NOT add a sidebar, accordion nav, or any navigation chrome. It's a tab content panel.
- Do NOT fetch from the Python service directly. Always go through the Next.js proxy (`/api/ma-options/execution/pnl-history`).
- Do NOT skip the ColumnChooser. Every data table in this dashboard has one.
- Do NOT use large padding, cards with shadows, or any decorative elements. High density.
