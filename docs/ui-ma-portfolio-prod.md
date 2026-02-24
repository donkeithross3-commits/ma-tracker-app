# M&A Portfolio Production Support -- UI Specification

**Last Updated:** 2026-02-24
**Status:** Draft
**Audience:** Developers implementing the M&A Portfolio section of the DR3 dashboard

---

## 1. Navigation

### Top-Level Placement

Add "M&A Portfolio" as a new top-level nav item in the sidebar/header navigation, positioned after the existing M&A-related entries (after `/ma-options`).

### Sub-Navigation

Tab-based sub-navigation within the M&A Portfolio section:

| Tab | Route | Purpose |
|-----|-------|---------|
| Portfolio | `/ma-portfolio` | Primary sheet-replica view (default) |
| Issues | `/ma-portfolio/issues` | Validation/issues queue |
| Enrichment | `/ma-portfolio/deal/[ticker]` | Per-deal deep dive (navigated via row click) |
| Monitor | `/ma-portfolio/monitor` | Intraday spread monitoring |
| Alerts | `/ma-portfolio/alerts` | Alert history and settings |

### Route Structure

```
/ma-portfolio                          -- Portfolio table (default tab: Dashboard)
/ma-portfolio?tab=EA                   -- Portfolio table, EA tab selected
/ma-portfolio/issues                   -- Validation issues queue
/ma-portfolio/deal/[ticker]            -- Deal detail page (tabbed: Overview, Enrichment, Suggestions, History, Options)
/ma-portfolio/monitor                  -- Intraday spread monitor
/ma-portfolio/alerts                   -- Alert history + settings (sub-tabs)
```

### File Structure (App Router)

```
app/ma-portfolio/
  page.tsx                             -- Portfolio table
  layout.tsx                           -- Shared layout with sub-nav tabs
  issues/page.tsx                      -- Issues queue
  deal/[ticker]/page.tsx               -- Deal detail
  monitor/page.tsx                     -- Intraday monitor
  alerts/page.tsx                      -- Alert history + settings
```

---

## 2. Portfolio Page (`/ma-portfolio`)

The primary view. Replicates the Google Sheet with computed columns, diff mode, and historical snapshots.

### Layout

```
+---------------------------------------------------------------+
| M&A Portfolio          Last ingest: 2m ago  [Refresh] [Snap v] |  <- header row
+-----------+----+------+------+------+------+-------------------+
| Dashboard | EA | COMM | TRUE | IROQ | PLYM |    [Diff] [Cols] |  <- tab bar + controls
+-----------+----+------+------+------+------+-------------------+
| Deal count: 42 | Avg spread: 3.2% | Issues: 7 | Suggestions: 3 | <- SummaryBar
+---------------------------------------------------------------+
| Target | Acquiror | Ann. | Close | End  | Count | Deal$ | ... |  <- sticky table header
|--------|----------|------|-------|------|-------|-------|-----|
| row... click to navigate to /ma-portfolio/deal/[ticker]       |
| row...                                                         |
+---------------------------------------------------------------+
```

### Header Row

- Page title: "M&A Portfolio" (`text-2xl font-semibold`)
- Last ingest timestamp: `TimestampBadge` showing relative time ("2m ago", "1h ago")
- Manual refresh button: Lucide `RefreshCw` icon button, triggers re-fetch of current snapshot
- `SnapshotSelector`: dropdown to pick a historical snapshot date (defaults to "Latest")

### Tab Bar

Matches the Google Sheet tabs exactly:

| Tab | Key | Description |
|-----|-----|-------------|
| Dashboard | `dashboard` | All active deals (default) |
| EA | `ea` | Equity arbitrage deals |
| COMM | `comm` | Committee/vote deals |
| TRUE | `true` | True mergers |
| IROQ | `iroq` | IROQ deals |
| PLYM | `plym` | PLYM deals |

Tab selection updates the `tab` query parameter. Use Radix `Tabs` component matching existing `py-1.5` tab trigger styling.

Right side of tab bar:
- `DiffToggle`: switch to enable diff view (Lucide `GitCompare` icon + "Diff" label)
- `ColumnChooser`: per existing pattern (see Shared Components section)

### SummaryBar

Single row of key metrics below the tab bar. Compact inline layout (`flex items-center gap-6 py-1.5 px-3 text-sm text-gray-400`).

Metrics:
- Deal count (number of rows in current tab)
- Avg spread (mean of Gross Yield column)
- Issue count (open validation issues, linked to Issues page)
- Active suggestions count (pending enrichment suggestions)

### Main Table

#### Source Columns (from Google Sheet)

| Column Key | Header | Align | Format | Notes |
|------------|--------|-------|--------|-------|
| `target` | Target | left | text | Company name, locked in ColumnChooser |
| `acquiror` | Acquiror | left | text | |
| `announcedDate` | Announced | left | YYYY-MM-DD | |
| `closeDate` | Close Date | left | YYYY-MM-DD | |
| `endDate` | End Date | left | YYYY-MM-DD | |
| `countdown` | Countdown | right | integer + "d" | Days remaining |
| `dealPrice` | Deal$ | right | 2 decimals | |
| `currentPrice` | Current$ | right | 2 decimals | |
| `grossYield` | Gross Yld | right | 1 decimal + "%" | |
| `priceChange` | Chg | right | 1 decimal + "%" | Color: green positive, red negative |
| `currentYield` | Cur Yld | right | 1 decimal + "%" | |
| `category` | Cat | left | text badge | |
| `investable` | Inv | center | checkmark or dash | |
| `dealNotes` | Notes | left | truncated text | Tooltip for full text |
| `voteRisk` | Vote | center | risk badge | See Risk Badges below |
| `financeRisk` | Finance | center | risk badge | |
| `legalRisk` | Legal | center | risk badge | |
| `cvr` | CVR | right | 2 decimals or dash | |

#### Computed Columns (added by system)

| Column Key | Header | Align | Format | Calculation |
|------------|--------|-------|--------|-------------|
| `grossSpread` | Spread$ | right | 2 decimals | `dealPrice - currentPrice` |
| `annualizedYield` | Ann Yld | right | 1 decimal + "%" | `grossYield * (365 / daysToClose)` |
| `daysToClose` | Days | right | integer | `closeDate - today` (business days) |

#### Status Indicator Column

First column (before Target): a small colored dot indicating validation status for the row.

| Color | Meaning |
|-------|---------|
| No dot | Clean, no issues |
| `text-red-500` | Has error-level validation issues |
| `text-yellow-500` | Has warning-level issues |
| `text-blue-400` | Has info-level issues |

Clicking the dot navigates to the Issues page filtered by that target.

#### Sparklines (P2, optional)

Inline sparklines in a `Spark` column showing 30-day price history. Small SVG sparkline component, 60x20px, gray stroke. Deferred to P2 implementation.

#### Row Interaction

- Row click navigates to `/ma-portfolio/deal/[ticker]`
- Row hover: `hover:bg-gray-900` (consistent with existing tables)
- Sticky header row

#### Column Chooser

Follow the established `ColumnChooser` pattern. Table key: `maPortfolio`.

Locked columns: `target` (cannot be hidden).

Default visible: all source columns + `grossSpread`, `annualizedYield`, `daysToClose`.

Comfort mode: wrap table in `d-table-wrap` with `--visible-cols` CSS variable, apply `d-table` class.

### Diff Mode

When `DiffToggle` is active, the table fetches the diff endpoint and applies cell-level highlighting:

| Highlight | CSS Class | Meaning |
|-----------|-----------|---------|
| Green background | `bg-green-900/30` | Value improved (spread tightened, yield increased) |
| Red background | `bg-red-900/30` | Value worsened (spread widened, yield decreased) |
| Yellow background | `bg-yellow-900/30` | Value changed (non-directional fields like notes, dates) |

Each highlighted cell shows a small superscript with the previous value on hover (tooltip).

Diff is computed against the previous day's snapshot by default. The `SnapshotSelector` can override the comparison date.

### Data Dependencies

```
GET /api/ma-portfolio/snapshot?tab={tab}&date={date|"latest"}
  Response: { timestamp, deals: Deal[], meta: { dealCount, avgSpread, issueCount, suggestionCount } }

GET /api/ma-portfolio/diff?tab={tab}&date={date}
  Response: { changes: { ticker: { field: { old, new, direction } }[] } }

GET /api/ma-portfolio/snapshot-dates
  Response: { dates: string[] }  -- for SnapshotSelector dropdown
```

---

## 3. Deal Detail Page (`/ma-portfolio/deal/[ticker]`)

Deep dive on a single deal. Accessed by clicking a row in the Portfolio table.

### Layout

```
+---------------------------------------------------------------+
| <- Back to Portfolio    AAPL - Apple Inc / Broadcom            |  <- breadcrumb + title
+---------------------------------------------------------------+
| [DealMetricsCard: price | spread | yield | countdown | risks] |  <- always visible
+----------+------------+-------------+---------+---------+------+
| Overview | Enrichment | Suggestions | History | Options |      |  <- tabs
+----------+------------+-------------+---------+---------+------+
| (tab content)                                                  |
+---------------------------------------------------------------+
```

### DealMetricsCard (always visible above tabs)

Horizontal card with key metrics. Dark card (`bg-gray-900 rounded-lg px-4 py-3`).

| Metric | Format | Notes |
|--------|--------|-------|
| Ticker | `text-lg font-mono font-bold text-blue-400` | |
| Target Name | `text-sm text-gray-400` | |
| Acquiror | `text-sm text-gray-400` | |
| Current Price | 2 decimals, large | `text-xl` |
| Deal Price | 2 decimals | |
| Gross Spread | 2 decimals + directional color | |
| Gross Yield | 1 decimal + "%" | |
| Annualized Yield | 1 decimal + "%" | |
| Days to Close | integer + "d" | Color: green >60d, yellow 30-60d, red <30d |
| RiskBadges | vote / finance / legal | See Shared Components |

### Overview Tab

- **Deal Terms Summary**: key-value list of deal parameters (announced date, close date, end date, category, investable, CVR, deal notes)
- **Risk Ratings**: expanded risk detail (vote/finance/legal) with any available context
- **Quick Links**: link to EDGAR filings page filtered by this ticker, link to options scanner for this ticker

### Enrichment Tab

- **EnrichmentTimeline**: chronological list of source documents (EDGAR filings, news articles, press releases)
  - Each entry: timestamp, source type icon (Lucide `FileText` for EDGAR, `Newspaper` for news), headline, summary excerpt
  - Click expands to show extracted facts table
  - `EvidenceLink` for each source URL
- **Extracted Facts Table**: field | extracted value | source | confidence | date
  - Shows what the enrichment pipeline has found for this deal

### Suggestions Tab

List of pending and resolved suggestions from the enrichment pipeline.

Each `SuggestionCard`:
```
+---------------------------------------------------------------+
| [field name]   Current: $45.00  ->  Suggested: $46.50         |
| Confidence: [====------] 72%                                  |
| Evidence: [EDGAR 8-K filing] [Reuters article]                |
| [Accept]  [Reject]  [Dismiss]              Status: Pending    |
+---------------------------------------------------------------+
```

- Pending suggestions at top, resolved below (collapsed by default)
- Accept button updates the field value in the production data
- Reject button marks suggestion as rejected with optional reason
- Dismiss button hides without recording a decision

### History Tab

- **FieldHistoryChart**: sparkline chart for selected fields over time (price, spread, yield)
  - Field selector dropdown to choose which metric to chart
  - 30/60/90 day range selector
- **Change Log Table**: chronological list of field-level changes
  - Columns: date | field | old value | new value | source (manual / enrichment / import)
  - Filterable by field name

### Options Tab

Reuse the existing `OptionChainViewer` component from `/ma-options`. Pass the deal ticker and let users view the current option chain and relevant strategies.

Data: reuse the existing option chain fetch endpoint.

### Data Dependencies

```
GET /api/ma-portfolio/deal/[ticker]
  Response: { deal: Deal, terms: DealTerms, risks: RiskDetail }

GET /api/ma-portfolio/deal/[ticker]/enrichment
  Response: { items: EnrichmentItem[] }

GET /api/ma-portfolio/deal/[ticker]/suggestions
  Response: { pending: Suggestion[], resolved: Suggestion[] }

GET /api/ma-portfolio/deal/[ticker]/history
  Response: { changes: FieldChange[], snapshots: { date, fields }[] }

GET /api/ma-portfolio/deal/[ticker]/options
  (Reuse existing chain fetch via IB relay)
```

---

## 4. Validation/Issues Queue (`/ma-portfolio/issues`)

Inbox-style view for validation problems detected by the pipeline.

### Layout

```
+---------------------------------------------------------------+
| Issues                                          [Bulk Actions] |
+---------------------------------------------------------------+
| Severity: [All|Error|Warning|Info]  Status: [Open|Ack|Resolved]|
| Target: [________]  Rule: [________]                           |  <- filter bar
+---------------------------------------------------------------+
| [x] | ! | AAPL  | dealPrice | Stale > 5 days | price_stale | Open   | [Ack] |
| [x] | ! | MSFT  | closeDate | Past close date | date_past   | Open   | [Ack] |
| [ ] | i | GOOG  | grossYld  | Yield < 0      | neg_yield   | Ack'd  | [Res] |
+---------------------------------------------------------------+
```

### Filter Bar

Compact inline filter row (`py-1.5 px-3`, matching existing filter patterns).

| Filter | Type | Options |
|--------|------|---------|
| Severity | button group | All, Error, Warning, Info |
| Status | button group | Open, Acknowledged, Resolved, False Positive |
| Target | text input | Autocomplete with SEC EDGAR lookup |
| Rule | dropdown | List of validation rule names |

### Issues Table

| Column | Align | Content |
|--------|-------|---------|
| Checkbox | center | For bulk selection |
| Severity | center | `IssueSeverityBadge` (colored circle) |
| Target | left | Ticker + company name |
| Field | left | Which field has the issue |
| Message | left | Human-readable description |
| Rule | left | Validation rule identifier |
| Status | left | `IssueStatusDropdown` |
| Actions | right | Acknowledge / Resolve buttons |

### Row Expansion

Clicking a row (not the checkbox) expands it inline to show context:
- Current sheet values for the affected field and related fields
- Expected values (if the rule has an expectation)
- Related enrichment data that might explain the discrepancy
- Link to deal detail page

### Bulk Actions

`BulkActionBar` appears when one or more rows are selected:
- "Acknowledge Selected" -- marks all selected issues as acknowledged
- "Resolve Selected" -- marks all selected as resolved
- "Mark False Positive" -- marks all selected as false positive

### Data Dependencies

```
GET /api/ma-portfolio/issues?status={status}&severity={severity}&target={ticker}&rule={rule}
  Response: { issues: Issue[], total: number }

PUT /api/ma-portfolio/issues/[id]
  Body: { status: "acknowledged" | "resolved" | "false_positive" }

PUT /api/ma-portfolio/issues/bulk
  Body: { ids: string[], status: string }
```

---

## 5. Intraday Monitor (`/ma-portfolio/monitor`)

Live spread monitoring during market hours.

### Layout

```
+---------------------------------------------------------------+
| Monitor                              [Market: Open] [Auto: On] |
+---------------------------------------------------------------+
| [Deals: 42] [Widening: 3] [Alerts Today: 7] [Avg Spread: 3.2%]| <- MonitorSummaryCards
+---------------------------------------------------------------+
| Ticker | Target$ | Deal$ | Spread | Spread Chg | Ann Yld | Days | Status |
|--------|---------|-------|--------|------------|---------|------|--------|
| AAPL   | 174.50  |178.00 |  3.50  | -0.12 (T)  | 8.2%   |  45  |  ->    |
| MSFT   | 312.00  |315.00 |  3.00  | +0.45 (W)  | 6.1%   |  72  |  <-    |
+---------------------------------------------------------------+
| [Intraday Spread Chart for selected deal]                      |  <- appears on row click
+---------------------------------------------------------------+
```

### Header Row

- Page title: "Monitor"
- `MarketStatusBadge`: shows current market state
  - Pre-market (4:00-9:30 ET): yellow badge "Pre-Market"
  - Open (9:30-16:00 ET): green badge "Market Open"
  - After-hours (16:00-20:00 ET): orange badge "After Hours"
  - Closed: gray badge "Market Closed"
- Auto-refresh indicator: shows countdown to next poll, click to pause/resume

### MonitorSummaryCards

Four compact metric cards in a horizontal row (`grid grid-cols-4 gap-3`):

| Card | Value | Style |
|------|-------|-------|
| Active Deals | integer count | neutral |
| Widening Spreads | count of deals where spread change > 0 | red if > 0 |
| Alerts Today | count of alerts triggered today | yellow if > 0 |
| Avg Spread | mean gross spread across all active deals | neutral |

### Monitor Table

| Column Key | Header | Align | Format |
|------------|--------|-------|--------|
| `ticker` | Ticker | left | mono, bold |
| `targetPrice` | Target$ | right | 2 decimals |
| `dealPrice` | Deal$ | right | 2 decimals |
| `grossSpread` | Spread | right | 2 decimals |
| `spreadChange` | Spread Chg | right | `SpreadChangeIndicator` |
| `annYield` | Ann Yld | right | 1 decimal + "%" |
| `daysToClose` | Days | right | integer |
| `status` | Status | center | spark indicator arrow |

#### SpreadChangeIndicator

- Tightening (spread decreasing): green text, down arrow, "(T)" suffix
- Widening (spread increasing): red text, up arrow, "(W)" suffix
- Unchanged: gray text, dash, "(U)" suffix
- Format: `+0.45 (W)` or `-0.12 (T)`

Default sort: `spreadChange` descending (biggest wideners at top).

#### Color Coding

- Row text color reflects intraday direction:
  - `text-green-400` for tightening
  - `text-red-400` for widening
  - `text-gray-400` for unchanged

### Intraday Spread Chart

Clicking a row in the monitor table reveals an `IntradaySpreadChart` below the table (or in a slide-out panel).

- 5-minute bar chart showing spread over the current trading day
- X-axis: time (9:30 - 16:00 ET)
- Y-axis: spread in dollars
- Reference line at prior close spread
- Use existing charting pattern from the codebase

### Auto-Refresh Behavior

- Poll `GET /api/ma-portfolio/monitor/spreads` every 60 seconds during market hours
- Pause polling when `document.hidden` is true (tab backgrounded) -- per CLAUDE.md convention
- Resume polling when tab becomes visible again
- No polling when market is closed (check market hours before scheduling)
- Manual refresh button always available

### Data Dependencies

```
GET /api/ma-portfolio/monitor/spreads
  Response: { timestamp, marketStatus, deals: MonitorDeal[], summary: MonitorSummary }

GET /api/ma-portfolio/monitor/spread-history/[ticker]?range=1d
  Response: { bars: { time, spread, price }[] }
```

---

## 6. Alert History + Settings (`/ma-portfolio/alerts`)

Two sub-tabs within the alerts page.

### Layout

```
+---------------------------------------------------------------+
| Alerts                                                         |
+----------+----------+-----------------------------------------+
| History  | Settings |                                         |  <- sub-tabs
+----------+----------+-----------------------------------------+
| (sub-tab content)                                              |
+---------------------------------------------------------------+
```

### History Sub-Tab

#### Filter Bar

| Filter | Type | Options |
|--------|------|---------|
| Date Range | date picker pair | Start / End date |
| Ticker | text input | SEC EDGAR autocomplete |
| Alert Type | dropdown | spread_widened, price_stale, new_filing, threshold_breach, etc. |
| Severity | button group | All, Critical, Warning, Info |

#### Alert History Table

| Column | Align | Content |
|--------|-------|---------|
| Timestamp | left | Relative time + absolute on hover |
| Ticker | left | mono |
| Alert Type | left | badge with type-specific color |
| Message | left | Human-readable alert text |
| Severity | center | colored dot (red/yellow/blue) |
| Status | left | new / acknowledged |
| Actions | right | Acknowledge button |

`AlertRow` component: color-coded left border by severity. Click expands to show full alert context (the values that triggered the alert, related deal data, links to deal detail page).

### Settings Sub-Tab

#### Default Thresholds Section

Global default thresholds that apply to all deals unless overridden.

| Setting | Control | Default |
|---------|---------|---------|
| Spread widening threshold | `ThresholdEditor` (% input) | 0.5% |
| Spread tightening threshold | `ThresholdEditor` (% input) | 1.0% |
| Price staleness threshold | `ThresholdEditor` (hours input) | 24h |
| Yield change threshold | `ThresholdEditor` (% input) | 0.25% |
| New filing alert | toggle | enabled |
| Close date approaching | `ThresholdEditor` (days input) | 14d |

#### Per-Deal Overrides Table

Table listing all active deals with per-deal override capability.

| Column | Content |
|--------|---------|
| Ticker | Deal identifier |
| Spread Threshold | Override input or "Default" |
| Alerts Enabled | Toggle per deal |
| Channels | `ChannelSelector` checkboxes |
| Cooldown | Minutes between repeat alerts |

#### Channel Configuration

`ChannelSelector`: checkbox group for notification channels.

| Channel | Description |
|---------|-------------|
| Dashboard | In-app alert (always available) |
| Email | Email notification (requires configured email) |

#### Cooldown Settings

Per alert type, configurable cooldown period (minutes) to prevent alert fatigue. Default: 60 minutes.

#### Test Alert Button

"Send Test Alert" button at the bottom of settings. Generates a test alert to verify channel configuration is working.

### Data Dependencies

```
GET /api/ma-portfolio/alerts?page={page}&limit={limit}&ticker={ticker}&type={type}&severity={severity}&startDate={date}&endDate={date}
  Response: { alerts: Alert[], total: number, page: number }

PUT /api/ma-portfolio/alerts/[id]/acknowledge
  Response: { alert: Alert }

GET /api/ma-portfolio/alerts/settings
  Response: { defaults: ThresholdSettings, overrides: { [ticker]: ThresholdSettings }, channels: ChannelConfig }

PUT /api/ma-portfolio/alerts/settings
  Body: { defaults?, overrides?, channels? }
```

---

## 7. Shared Components

### DealMiniCard

Compact deal summary for use in lists, tooltips, and cross-references.

```
+---------------------------+
| AAPL  Apple Inc           |
| Spread: $3.50 (2.1%)     |
+---------------------------+
```

Props: `ticker`, `targetName`, `spread`, `spreadPct`
Styling: `bg-gray-900 rounded px-3 py-2 text-sm`

### EvidenceLink

Clickable link to a source document with an icon indicating the source type.

| Source Type | Icon (Lucide) |
|-------------|---------------|
| EDGAR filing | `FileText` |
| News article | `Newspaper` |
| Press release | `Megaphone` |
| Regulatory | `Scale` |
| Other | `ExternalLink` |

Props: `url`, `label`, `sourceType`
Styling: `text-blue-400 hover:text-blue-300 text-sm inline-flex items-center gap-1`

### ConfidenceBar

Visual confidence indicator from 0-100%.

```
[========--------] 72%
```

Props: `value` (0-100), `size` ("sm" | "md")
Styling: horizontal bar, `bg-gray-700` track, fill color varies:
- 0-40%: `bg-red-500`
- 40-70%: `bg-yellow-500`
- 70-100%: `bg-green-500`

### TimestampBadge

Relative time display with absolute time on hover.

Props: `timestamp` (ISO string)
Display: "2m ago", "1h ago", "yesterday", "3d ago"
Tooltip: full ISO timestamp
Styling: `text-xs text-gray-500`

### RiskBadges

Colored badges for vote/finance/legal risk ratings.

| Risk Level | Color | Badge Text |
|------------|-------|------------|
| Low | `bg-green-900 text-green-300` | "Low" |
| Medium | `bg-yellow-900 text-yellow-300` | "Med" |
| High | `bg-red-900 text-red-300` | "High" |
| Unknown | `bg-gray-800 text-gray-500` | "--" |

Props: `voteRisk`, `financeRisk`, `legalRisk`
Renders three inline badges.

### IssueSeverityBadge

Small colored circle indicating issue severity.

| Severity | Color |
|----------|-------|
| Error | `bg-red-500` |
| Warning | `bg-yellow-500` |
| Info | `bg-blue-400` |

Rendered as `w-2.5 h-2.5 rounded-full`.

### IssueStatusDropdown

Radix dropdown for changing issue status. States: `open` -> `acknowledged` -> `resolved` | `false_positive`.

### BulkActionBar

Appears when rows are selected in the Issues table. Sticky bar at bottom of table area.

```
+---------------------------------------------------------------+
| 3 selected    [Acknowledge]  [Resolve]  [False Positive]       |
+---------------------------------------------------------------+
```

Styling: `bg-gray-900 border-t border-gray-800 px-4 py-2 flex items-center gap-3`

### SpreadChangeIndicator

Arrow + percentage, color coded by direction.

Props: `change` (number), `direction` ("tightening" | "widening" | "unchanged")

### IntradaySpreadChart

Small chart component for intraday spread visualization. Uses existing charting patterns from the codebase. Renders 5-minute bars for the current trading day.

Props: `ticker`, `data` (bar array), `referenceSpread` (prior close)

### MarketStatusBadge

Shows current market state as a colored badge.

Props: `status` ("pre_market" | "open" | "after_hours" | "closed")

### MonitorSummaryCards

Grid of 3-4 summary metric cards.

Props: `dealCount`, `wideningCount`, `alertCount`, `avgSpread`
Layout: `grid grid-cols-4 gap-3`
Each card: `bg-gray-900 rounded-lg px-4 py-3`

### ThresholdEditor

Numeric input with operator dropdown for alert threshold configuration.

```
[ > ] [ 0.50 ] [ % ]
```

Props: `operator` (">", "<", "=", ">=", "<="), `value` (number), `unit` (string), `onChange`

### ChannelSelector

Checkbox group for notification channel selection.

Props: `channels` (available channels), `selected` (enabled channels), `onChange`

### TabLayout

Reusable tab container matching existing Radix tab patterns. Used for both page-level tabs and sub-tabs within pages.

Styling follows existing convention: `py-1.5` tab triggers, `mb-3` after tab list.

---

## 8. API Endpoints Summary

### Snapshot / Portfolio Data

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ma-portfolio/snapshot` | Fetch deal table for a tab and date |
| GET | `/api/ma-portfolio/diff` | Fetch cell-level changes vs previous snapshot |
| GET | `/api/ma-portfolio/snapshot-dates` | List available snapshot dates |

### Deal Detail

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ma-portfolio/deal/[ticker]` | Full deal detail with terms and risks |
| GET | `/api/ma-portfolio/deal/[ticker]/enrichment` | Enrichment timeline and extracted facts |
| GET | `/api/ma-portfolio/deal/[ticker]/suggestions` | Pending and resolved suggestions |
| GET | `/api/ma-portfolio/deal/[ticker]/history` | Field-level change history and snapshots |
| GET | `/api/ma-portfolio/deal/[ticker]/options` | Option chain (reuse existing IB relay) |
| PUT | `/api/ma-portfolio/deal/[ticker]/suggestions/[id]` | Accept/reject/dismiss a suggestion |

### Validation Issues

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ma-portfolio/issues` | List issues with filters |
| PUT | `/api/ma-portfolio/issues/[id]` | Update single issue status |
| PUT | `/api/ma-portfolio/issues/bulk` | Bulk update issue statuses |

### Intraday Monitor

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ma-portfolio/monitor/spreads` | Live spread data for all active deals |
| GET | `/api/ma-portfolio/monitor/spread-history/[ticker]` | Intraday spread bars for a deal |

### Alerts

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ma-portfolio/alerts` | Paginated alert history with filters |
| PUT | `/api/ma-portfolio/alerts/[id]/acknowledge` | Acknowledge an alert |
| GET | `/api/ma-portfolio/alerts/settings` | Fetch alert configuration |
| PUT | `/api/ma-portfolio/alerts/settings` | Update alert configuration |
| POST | `/api/ma-portfolio/alerts/test` | Send a test alert |

---

## 9. Styling Reference

All pages follow the existing DR3 dashboard conventions:

| Property | Value | Notes |
|----------|-------|-------|
| Background | `bg-gray-950` | Page background |
| Text | `text-gray-100` | Primary text |
| Muted text | `text-gray-400` | Secondary / labels |
| Card background | `bg-gray-900` | Cards, expanded rows |
| Border | `border-gray-800` | Dividers, card borders |
| Page padding | `px-3 py-2` | High-density trader layout |
| Section spacing | `mb-1` to `mb-3` | Minimal vertical space |
| Tab triggers | `py-1.5` | Consistent with existing tabs |
| Table text | `text-[16px]` body, `text-[14px]` headers | Match KRJ style guide |
| Numeric alignment | right-aligned | All numeric columns |
| Hover rows | `hover:bg-gray-900` | Table row hover |
| Sticky headers | `sticky top-0 z-10 bg-gray-950` | Table headers stay visible |
| Icons | Lucide React | Consistent icon library |
| Components | Radix UI / shadcn/ui | Accessible primitives |

### Comfort Mode Support

All tables must:
1. Wrap in `<div className="d-table-wrap" style={{ "--visible-cols": N }}>`
2. Apply `className="d-table"` to the `<table>` element
3. Integrate with `ColumnChooser` for user-controlled column visibility

Interactive elements (buttons, inputs, dropdowns) inherit global comfort scaling from `globals.css` automatically via ARIA role selectors.

---

## 10. Component File Structure

```
components/ma-portfolio/
  PortfolioTable.tsx              -- Main table for /ma-portfolio
  DealMetricsCard.tsx             -- Key metrics card on deal detail
  DealMiniCard.tsx                -- Compact deal summary (reusable)
  SummaryBar.tsx                  -- Metric summary row
  SnapshotSelector.tsx            -- Historical date picker
  DiffToggle.tsx                  -- Diff mode switch
  EnrichmentTimeline.tsx          -- Chronological source documents
  SuggestionCard.tsx              -- Suggestion with accept/reject
  FieldHistoryChart.tsx           -- Sparkline for field over time
  RiskBadges.tsx                  -- Vote/finance/legal badges
  EvidenceLink.tsx                -- Source document link with icon
  ConfidenceBar.tsx               -- Visual confidence indicator
  TimestampBadge.tsx              -- Relative time display
  IssueSeverityBadge.tsx          -- Colored severity dot
  IssueStatusDropdown.tsx         -- Status transition dropdown
  BulkActionBar.tsx               -- Bulk actions for issues
  SpreadChangeIndicator.tsx       -- Directional spread change
  IntradaySpreadChart.tsx         -- Intraday spread visualization
  MarketStatusBadge.tsx           -- Market hours indicator
  MonitorSummaryCards.tsx         -- Summary metric cards
  ThresholdEditor.tsx             -- Alert threshold input
  ChannelSelector.tsx             -- Notification channel checkboxes
  AlertRow.tsx                    -- Single alert display
```
