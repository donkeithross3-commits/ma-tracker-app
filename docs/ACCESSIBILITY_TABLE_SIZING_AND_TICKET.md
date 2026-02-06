# Accessibility: Table Sizing Strategy & Ticket Quantity Controls

**Audience**: Experienced trader with Parkinson's — large hit targets, minimal
precision actions, zero fine-motor requirements.

---

## 1. Positions / P&L Table — Sizing Strategy

### Layout: `table-fixed` with generous column widths

**File**: `components/ma-options/IBPositionsTab.tsx` (lines ~1813–1910)

We use `<table className="w-full text-sm table-fixed" style={{ minWidth: 860 }}>` 
with a `<colgroup>` that sets explicit pixel widths. `table-fixed` means column
widths are determined by the `<col>` elements, *not* by content, giving a **stable,
jitter-free layout** even when values update in real-time.

#### Column width budget

| Column   | Width   | Handles up to              | Notes                         |
|----------|---------|----------------------------|-------------------------------|
| Account  | 90px    | 10-char IDs                | Truncate + tooltip if longer  |
| Symbol   | *flex*  | Remaining space            | Truncate + tooltip if needed  |
| Type     | 52px    | STK / OPT / FUT            | Never wraps                   |
| Pos      | 100px   | ±999,999 with commas       | `whitespace-nowrap`           |
| Avg cost | 110px   | $99,999.99                 | `whitespace-nowrap`           |
| Last     | 90px    | $99,999.99                 | `whitespace-nowrap`           |
| Mkt val  | 135px   | ±$9,999,999.99             | `whitespace-nowrap` + tooltip |
| P&L      | 145px   | ±$9,999,999.99             | `whitespace-nowrap` + tooltip |
| Trade    | 84px    | 44×44px min button target  | Never clipped                 |

**Total fixed**: ~806px → leaves 54px+ for Symbol on a 860px min-width table.

#### Key constraints

- **`minWidth: 860`** on `<table>` — prevents column compression below usable
  widths. The parent `overflow-x-auto` provides horizontal scroll if the
  viewport is narrower.
- **`whitespace-nowrap`** on ALL cells (header, body, footer) — numbers never
  wrap mid-digit.
- **`truncate`** (overflow-hidden + text-ellipsis) on text columns (Account,
  Symbol) — graceful overflow with native `title` tooltip showing full value.
- **`title` attribute** on numeric cells with large potential values (Mkt val,
  P&L) — hover shows full number even if visually compressed.
- **`tabular-nums`** on all numeric cells — monospaced digits for column
  alignment stability.

#### Trade button (action column)

- `min-h-[44px] min-w-[44px]` — meets WCAG 2.5.5 "Target Size" (minimum 44px).
- `rounded-lg` with `px-3 py-2 text-sm font-semibold` — larger hit target than
  the previous `text-xs py-1`.
- Column width 84px guarantees the button + padding are never clipped.

### What NOT to do

- Don't use `table-auto` — causes layout jitter when values update.
- Don't reduce column widths to "save space" — extreme values WILL break.
- Don't use `overflow-hidden` on numeric cells without a tooltip — silently
  losing digits is a trading hazard.

---

## 2. Order Ticket Quantity Controls

### File: `components/ma-options/IBPositionsTab.tsx` (lines ~2238–2300)

### Button hierarchy

```
┌─────────────────────────────────────────────┐
│  Quantity input (72px tall, 36px font)       │
├─────────────────────┬───────────────────────┤
│   Clear (0)         │   = Pos (N)           │  ← ABSOLUTE (mode-independent)
├─────────────────────┴───────────────────────┤
│   +/−N (pos)  [amber, full width]           │  ← DELTA (mode-dependent)
├─────────────────────┬───────────────────────┤
│   +/−1              │   +/−5                │
│   +/−10             │   +/−25               │  ← DELTA grid
│   +/−50             │   +/−100              │
│   +/−500            │   +/−1000             │
└─────────────────────┴───────────────────────┘
```

### Absolute buttons (always available, ignore delta mode)

| Button          | Action                              | When disabled          |
|-----------------|-------------------------------------|------------------------|
| **Clear (0)**   | `setStockOrderQty("0")`             | Never (always active)  |
| **= Pos (N)**   | `setStockOrderQty(String(posQty))`  | When `posQty <= 0`     |

- These buttons set the quantity to an **exact value**, not a delta.
- They completely **ignore** the +/− delta mode toggle.
- Styled distinctively: Clear is neutral gray, = Pos is cyan.
- Both have 68px min height for easy targeting.

### Delta buttons (mode-dependent)

- Sign controlled by the +/− toggle: `stockOrderDeltaSign` (1 or -1)
- Formula: `qty = max(0, current + delta × sign)`
- The amber "position" delta button adds/subtracts the full position size.

### Edge cases

| Scenario                      | Behavior                                     |
|-------------------------------|----------------------------------------------|
| No position (posQty = 0)      | "= Pos" is disabled (grayed, `cursor-not-allowed`). Amber delta hidden. |
| Short position (-500)         | `absPos` = 500 is used. "= Pos (500)" sets qty to 500. |
| Long position (300)           | "= Pos (300)" sets qty to 300. |
| Huge position (999,999)       | Displayed with commas: "= Pos (999,999)". |
| Non-step-aligned (137)        | Exact value used — no rounding. Shares are integers. |
| Options (contracts)           | Same behavior; delta grid is smaller (1,2,5,...100). |
| Symbol change                 | `openTradeTicket()` resets all state (qty, price, delta sign, position). |
| Quantity goes negative        | `Math.max(0, ...)` prevents it. |

### Accessibility constraints

- All buttons: `min-h-[68px]` — 68px tall (well above 44px WCAG minimum).
- Font: `text-2xl font-bold` / `font-extrabold` — 24px minimum.
- Input field: `min-h-[72px] text-4xl` — 36px font, 72px tall.
- Color coding: green (+), red (−), amber (position), cyan (= Pos).
- Large spacing: `gap-2` between grid items.

---

## 3. Dev Stress Test

**Toggle**: "Stress Test" button (dev environment only), next to "Refresh".

When enabled, renders a self-contained table below the positions with:

- **Extreme digit counts**: 999,999 positions, $1.2B P&L
- **Long symbols**: "LONGTICKERXYZ", "MEGA 2025-12-19 999 C"
- **Tiny values**: 1-share position at $0.01
- **Large avg costs**: BRK.A at $623,456.78
- **Mixed long/short**: positive and negative positions

Also shows a ticket stress scenario checklist:
- No position, small/huge/short positions, non-step-aligned values.

### How to test

1. Start dev server: `npm run dev`
2. Navigate to the positions tab
3. Click "Stress Test" button (yellow toggle, bottom of positions area)
4. Verify:
   - No numeric wrapping in any column
   - All numbers readable (hover for tooltip on truncated values)
   - Trade buttons fully visible and clickable
   - Footer totals display correctly
5. Open a trade ticket, verify:
   - "Clear (0)" always works
   - "= Pos (N)" shows correct position value
   - With no position: "= Pos" is grayed out
   - Delta buttons respect +/− mode
   - Absolute buttons ignore +/− mode
