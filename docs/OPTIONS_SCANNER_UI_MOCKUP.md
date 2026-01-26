# M&A Options Scanner - UI Layout with Parameters

## Deal Info Component (Collapsed State)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AAPL                                                 [Hide Parameters]   │
│ Apple Inc.                                          [Load Option Chain]  │
│ ✓ Selected                                                               │
│                                                                           │
│ Deal Price: $150.00    Days to Close: 45    Acquiror: MSFT    Status: active │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deal Info Component (Expanded State)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AAPL                                                 [Hide Parameters]   │
│ Apple Inc.                                          [Load Option Chain]  │
│ ✓ Selected                                                               │
│                                                                           │
│ Deal Price: $150.00    Days to Close: 45    Acquiror: MSFT    Status: active │
│─────────────────────────────────────────────────────────────────────────│
│ Scan Parameters                                                          │
│                                                                           │
│ ┌─────────────────────────────────┬─────────────────────────────────┐  │
│ │ Days Before Close               │ Short Strike Lower              │  │
│ │ (0 = bracket close date)        │ (% of deal price)               │  │
│ │ [    0    ]                     │ [    95   ]                     │  │
│ │                                 │ $142.50                         │  │
│ │                                 │                                 │  │
│ │ Strike Lower Bound              │ Short Strike Upper              │  │
│ │ (% below deal price)            │ ($ above deal price)            │  │
│ │ [    20   ]                     │ [   0.50  ]                     │  │
│ │ $120.00                         │ $150.50                         │  │
│ │                                 │                                 │  │
│ │ Strike Upper Bound              │ Top Strategies Per Expiration   │  │
│ │ (% above deal/spot)             │ (call + put spreads)            │  │
│ │ [    10   ]                     │ [    5    ]                     │  │
│ │ $165.00                         │                                 │  │
│ │                                 │                                 │  │
│ │ Deal Confidence                 │ [Reset to Defaults]             │  │
│ │ (probability deal closes)       │                                 │  │
│ │ [   0.75  ]                     │                                 │  │
│ │ 75%                             │                                 │  │
│ └─────────────────────────────────┴─────────────────────────────────┘  │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Quick Guide:                                                        │ │
│ │ • Days Before Close = 0: Only 2 expirations (before & after close) │ │
│ │ • Strike Bounds: Range of strikes to fetch from IB                 │ │
│ │ • Short Strike Range: Where to sell the short leg (at-the-money)   │ │
│ │ • Top Strategies: Best N spreads per expiration by annualized return│ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Full Curator Tab Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          M&A Options Scanner                             │
│ Curate and monitor options strategies for merger arbitrage deals        │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ [Curate Deals] [Monitor Watchlist]                                  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ AAPL                                         [Show Parameters]       │ │
│ │ Apple Inc.                                  [Load Option Chain]      │ │
│ │ ✓ Selected                                                           │ │
│ │                                                                       │ │
│ │ Deal Price: $150.00  Days to Close: 45  Acquiror: MSFT  Status: active│ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Option Chain Summary                                                 │ │
│ │ Spot Price: $148.50  |  Expirations: 2  |  Contracts: 48            │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Candidate Strategies (12 strategies)                                 │ │
│ │                                                                       │ │
│ │ Type     Exp      Strikes    Premium  Max Profit  Return  Yield  Watch│ │
│ │ ────────────────────────────────────────────────────────────────────│ │
│ │ spread   Jan 19  145/150    $2.45     $2.55      104%    180%   [+]  │ │
│ │ spread   Jan 19  140/145    $1.80     $3.20      178%    307%   [+]  │ │
│ │ put_spr  Jan 19  145/150    $2.10     $2.90      138%    238%   [+]  │ │
│ │ ...                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Watchlist for AAPL (3 strategies)                                    │ │
│ │                                                                       │ │
│ │ Type     Exp      Strikes    Entry    Current   P&L     Status       │ │
│ │ ────────────────────────────────────────────────────────────────────│ │
│ │ spread   Jan 19  145/150    $2.45    $2.60     +$15    active        │ │
│ │ spread   Feb 16  140/145    $1.80    $1.95     +$15    active        │ │
│ │ put_spr  Jan 19  145/150    $2.10    $2.05     -$5     active        │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Select Deal                                                          │ │
│ │                                                                       │ │
│ │ [Filter by ticker or name...                                    ]    │ │
│ │                                                                       │ │
│ │ Ticker  Target        Acquiror  Deal Price  Days to Close  Action    │ │
│ │ ────────────────────────────────────────────────────────────────────│ │
│ │ AAPL    Apple Inc.    MSFT      $150.00     45            [Select]   │ │
│ │ GOOGL   Alphabet Inc. META      $120.00     30            [Select]   │ │
│ │ TSLA    Tesla Inc.    GM        $200.00     60            [Select]   │ │
│ │ ...                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Parameter Input Details

### Number Inputs
All parameter inputs use standard HTML number inputs with appropriate constraints:

```html
<input
  type="number"
  min="0"
  max="90"
  value={params.daysBeforeClose}
  className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm"
/>
```

### Calculated Values
Real-time calculated values appear below each input:

```
Strike Lower Bound
(% below deal price)
[    20   ]
$120.00  ← Calculated: $150.00 × (1 - 0.20) = $120.00
```

### Color Scheme
- Background: `bg-gray-900` (dark)
- Border: `border-gray-700` (medium gray)
- Text: `text-gray-100` (light)
- Labels: `text-gray-400` (medium)
- Hints: `text-gray-500` (darker)
- Inputs: `bg-gray-800` with `border-gray-600`
- Buttons: `bg-blue-600` (primary), `bg-gray-700` (secondary)

## Responsive Behavior

### Desktop (>1024px)
- Two-column grid layout for parameters
- Full-width deal selector table

### Tablet (768-1024px)
- Two-column grid maintained
- Scrollable deal selector table

### Mobile (<768px)
- Single-column layout for parameters
- Stacked inputs
- Scrollable deal selector table

## Interaction Flow

1. **User selects a deal** → Deal Info appears at top with blue border
2. **User clicks "Show Parameters"** → Parameter section expands
3. **User adjusts parameters** → Calculated values update in real-time
4. **User clicks "Load Option Chain"** → Loading state, parameters sent to backend
5. **Option chain loads** → Summary appears below Deal Info
6. **Strategies generate** → Candidate strategies table appears
7. **User clicks [+] to watch** → Strategy added to watchlist

## Keyboard Shortcuts (Future)

- `Ctrl+P`: Toggle parameters
- `Ctrl+L`: Load option chain
- `Ctrl+R`: Reset parameters
- `Esc`: Close parameters

## Accessibility

- All inputs have labels
- Calculated values use `aria-describedby`
- Buttons have clear text (no icon-only buttons)
- Color contrast meets WCAG AA standards
- Keyboard navigation supported

