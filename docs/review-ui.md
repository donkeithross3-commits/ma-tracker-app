# UI Review: Sheet Portfolio Page

**Reviewer**: ui-reviewer
**Date**: 2026-02-24
**Files reviewed**:
- `app/sheet-portfolio/page.tsx`
- `app/api/sheet-portfolio/deals/route.ts`
- `app/api/sheet-portfolio/health/route.ts`
- `app/api/sheet-portfolio/ingest/route.ts`
- `app/page.tsx`
- `python-service/app/api/portfolio_routes.py`

---

## 1. Bugs

### BUG-1: Deal Price columns display raw strings instead of formatted numbers (sort broken)

**File**: `app/sheet-portfolio/page.tsx:328-329`

The Deal Px and Curr Px cells render `deal.deal_price_raw || "-"` and `deal.current_price_raw || "-"`. However, sorting uses `deal.deal_price` (the numeric field). This creates a mismatch: the user clicks to sort by "Deal Px" and the sort logic operates on the numeric `deal_price`, which is correct -- but if `deal_price` is `null` and `deal_price_raw` is some non-numeric string (e.g., `"CVR"` or `"Special"`), the cell shows content while sorting treats it as null. This is a minor inconsistency. Consider rendering from the parsed number with `$` prefix for consistency, falling back to `deal_price_raw` only for non-numeric values.

### BUG-2: Average IRR calculation can produce NaN

**File**: `app/sheet-portfolio/page.tsx:161-165`

```typescript
const avgYield =
  investableDeals.length > 0
    ? investableDeals.reduce((s, d) => s + (d.current_yield || 0), 0) /
      investableDeals.filter((d) => d.current_yield !== null).length
    : 0;
```

If all investable deals have `current_yield === null`, the denominator is 0, producing `NaN`. The numerator would be 0 (all nulls coerced to 0), so `0 / 0 = NaN`. Then `NaN !== 0` is `true`, so the summary bar would try to render `NaN%`.

**Fix**: Guard with `const denominator = investableDeals.filter(d => d.current_yield !== null).length; const avgYield = denominator > 0 ? sum / denominator : 0;`

### BUG-3: Null handling in sort pushes nulls to bottom regardless of direction

**File**: `app/sheet-portfolio/page.tsx:144-146`

```typescript
if (av === null) return 1;
if (bv === null) return -1;
```

Null values always sort to the bottom (`return 1` / `return -1`). This is technically a design choice, not a bug -- but it means toggling asc/desc doesn't move nulls from bottom to top. This may be intentional (nulls always at bottom is standard for trading dashboards) but worth noting.

### BUG-4: `key={deal.ticker}` assumes unique tickers

**File**: `app/sheet-portfolio/page.tsx:314`

```typescript
{sortedDeals.map((deal) => (
  <tr key={deal.ticker}>
```

If the API ever returns duplicate tickers (e.g., from data errors), React will warn about duplicate keys and may render incorrectly. Consider using a combination key like `${deal.ticker}-${index}` or adding `row_index` to the Deal interface.

---

## 2. Missing Columns (Data Available in DB but Not Shown)

The `/portfolio/deals` endpoint returns a limited set of fields, but the full `sheet_rows` table (accessible via `/portfolio/snapshot`) has many more fields that would be useful for a trader dashboard:

| Field | Source | Why useful |
|-------|--------|------------|
| `announced_date` | `sheet_rows.announced_date` | Know how long a deal has been pending |
| `close_date` | `sheet_rows.close_date` | Critical for IRR calculation context |
| `countdown_days` | `sheet_rows.countdown_days` | Days to expected close -- key for position sizing |
| `go_shop_raw` | `sheet_rows.go_shop_raw` | Go-shop period info -- affects deal break risk |
| `price_change` / `price_change_raw` | `sheet_rows.price_change` | Daily/recent price change -- important for monitoring |
| `cvr_flag` | `sheet_rows.cvr_flag` | CVR presence affects total deal value |
| `end_date` | `sheet_rows.end_date` | Outside/termination date |

**Recommendation**: Expand the `/portfolio/deals` SQL query to include at minimum: `announced_date`, `close_date`, `countdown_days`, `go_shop_raw`, `price_change_raw`, `price_change`, and `cvr_flag`. Then add these as optional columns on the frontend (ideally with a ColumnChooser per CLAUDE.md principles).

---

## 3. Missing Features

### FEAT-1: No link to deal detail view

Each deal has a `deal_tab_gid` in the database and a `/portfolio/deal/{ticker}` API endpoint, but the page has no way to click into a deal's detail. The ticker in the first column should be a clickable link (e.g., to `/sheet-portfolio/{ticker}` or opening a slide-over panel).

### FEAT-2: No ColumnChooser

Per CLAUDE.md "UI Configurability Architecture", every data table should have user-controlled column visibility via the `ColumnChooser` component. This table does not use it. See the step-by-step guide in CLAUDE.md for implementation.

### FEAT-3: No comfort mode / d-table integration

The table does not use the `d-table-wrap` / `d-table` CSS classes, so it is invisible to the comfort mode density system. It should be wrapped per the pattern in CLAUDE.md:
```tsx
<div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": N }}>
  <table className="w-full text-sm d-table">
```

### FEAT-4: No auto-refresh / polling

Trading dashboards benefit from periodic data refresh. Consider adding a 60-second polling interval (with `document.hidden` check per CLAUDE.md latency rules) to keep prices current.

### FEAT-5: No link to Google Sheet source

The `link_to_sheet` field exists in the data but is not exposed. A small external link icon next to each ticker could open the original Google Sheet tab for that deal.

### FEAT-6: No row count in empty state

When `sortedDeals.length === 0` but `deals.length > 0` (filter hides everything), it shows "No deals match your filter" but doesn't say how many total deals exist. Minor UX improvement: "No deals match your filter (82 total)".

---

## 4. CLAUDE.md Compliance Issues

### STYLE-1: Header uses `whitespace-nowrap` on th elements

CLAUDE.md says: "Allow header labels to wrap rather than adding horizontal scroll." The current code uses `whitespace-nowrap` on every `<th>`, which prevents wrapping and could force horizontal scroll on narrow screens. Remove `whitespace-nowrap` from the th class.

### STYLE-2: Summary bar placement is correct

CLAUDE.md says: "Place summary elements above/below tables, not at the side." The summary bar is above the table -- this is correct.

### STYLE-3: Spacing and density look correct

The page uses `px-3 py-2` for header padding, `mb-3` for summary bar spacing, `py-1.5 px-2` for cell padding. These align well with the "ruthlessly minimize vertical space" principles.

### STYLE-4: Right-aligned numeric columns -- correct

Deal Px, Curr Px, Gross Yld, and Curr Yld are all `text-right` with `font-mono`. This follows the "right-aligned numeric columns" principle.

---

## 5. API Proxy Routes Review

### PROXY-1: All three routes are clean and correct

The `deals`, `health`, and `ingest` proxy routes follow the same pattern:
- Correct error handling (text body forwarded, 502 for connection failures)
- `cache: "no-store"` prevents stale data
- TypeScript error typing is correct (`err: unknown` with `instanceof Error` check)

### PROXY-2: Ingest route properly forwards the `force` query param

The ingest route extracts `force` from the request URL and forwards it to the Python service. This is correct.

### PROXY-3: No auth protection on API routes

None of the three API routes check for authentication. If the `/sheet-portfolio` page is intended to be auth-protected (it's not listed in `auth.config.ts` public routes), the API routes should also be protected, or at minimum rely on the middleware.

---

## 6. Landing Page Review

### LANDING-1: Sheet Portfolio button looks correct

The landing page at `app/page.tsx:61-75` adds a "Sheet Portfolio" card with purple accent, "Beta Testing" badge, and correct description. The link goes to `/sheet-portfolio`. This is consistent with the other cards.

---

## 7. TypeScript Issues

### TS-1: Deal interface is missing fields that the backend could return

The `Deal` interface at line 6-22 only has 15 fields. If the API is expanded (per the missing columns recommendation), the interface needs to be updated too.

### TS-2: Sort column type is `string`, not constrained to Deal keys

```typescript
const [sortCol, setSortCol] = useState<string>("ticker");
```

This allows setting `sortCol` to any string, but it's cast to `keyof Deal` on line 142. Consider using `useState<keyof Deal>("ticker")` for type safety.

### TS-3: No error type for health fetch failure

If the health endpoint fails, `setHealth(null)` stays -- the UI gracefully handles this. But if the deals endpoint succeeds and health fails, there's no user-visible indication of the health failure. Minor issue.

---

## 8. Edge Cases

### EDGE-1: `#DIV/0!` and `#VALUE!` yields -- handled correctly

The `yieldCell` function at line 47-48 correctly checks for Google Sheets error strings and renders "N/A".

### EDGE-2: Very long acquiror names -- handled

The acquiror cell has `max-w-[200px] truncate`, which clips long names. Good.

### EDGE-3: Very long investable strings -- handled

The investable cell has `max-w-[180px] truncate`. Values like "No, too much stock" and "No, regulatory risk" are handled.

### EDGE-4: Risk badges truncate at 12 chars

`riskBadge` truncates at 12 characters with "...". Risk values like "High" (4 chars), "Medium" (6 chars), and "Low" (3 chars) are well under the limit. But some risk descriptions in the data are null -- the function correctly returns `null` for these, rendering nothing in the cell.

### EDGE-5: Null prices render as "-" via raw fallback

Deal Px and Curr Px use `deal.deal_price_raw || "-"`. If `deal_price_raw` is null, it shows "-". This is correct.

---

## 9. Summary of Recommended Changes (Priority Order)

| Priority | Issue | Type | Effort |
|----------|-------|------|--------|
| P0 | BUG-2: NaN in average IRR | Bug | 5 min |
| P1 | FEAT-1: Clickable ticker -> deal detail | Feature | 1-2 hr |
| P1 | Missing columns: countdown_days, close_date, announced_date, price_change | Feature | 30 min backend + 30 min frontend |
| P2 | FEAT-2: Add ColumnChooser | Feature | 30-45 min |
| P2 | FEAT-3: Add d-table / comfort mode classes | Feature | 15 min |
| P2 | TS-2: Type-safe sort column | Quality | 5 min |
| P3 | BUG-4: Unique row keys | Bug | 5 min |
| P3 | STYLE-1: Remove whitespace-nowrap from th | Style | 5 min |
| P3 | FEAT-4: Auto-refresh polling | Feature | 20 min |
| P3 | FEAT-5: Google Sheet link | Feature | 15 min |
| P3 | FEAT-6: Filter empty state count | UX | 5 min |
