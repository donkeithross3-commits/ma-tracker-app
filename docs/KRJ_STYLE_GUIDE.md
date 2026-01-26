# KRJ Dashboard Style Guide

**Version:** 1.0  
**Last Updated:** December 26, 2025  
**Status:** Active

---

## Purpose

This document defines the visual design standards for the KRJ (Key Reversal Jump) dashboard. These guidelines ensure consistency across the UI and should be followed when creating new pages or modifying existing ones.

---

## Color System

### Signal Type Colors (Primary)

Signal types use bold, saturated colors for immediate recognition:

| Signal Type | Summary Box | Table Columns | Hex Equivalent | Usage |
|-------------|-------------|---------------|----------------|-------|
| **Long** | `text-blue-700` | `text-blue-400` | #1d4ed8 / #60a5fa | Bullish signals |
| **Neutral** | `text-black` | `text-gray-100` | #000000 / #f3f4f6 | No position |
| **Short** | `text-red-700` | `text-red-400` | #b91c1c / #f87171 | Bearish signals |

**Rationale:**
- **Blue for Long:** Conveys positive, calm, bullish sentiment
- **Red for Short:** Conveys alert, bearish sentiment
- **Neutral:** Maintains default text color for easy scanning

### Change Indicators (Secondary)

Delta values (+/-) use muted colors with reduced opacity:

| Change Type | Color Class | Hex Equivalent | Usage |
|-------------|-------------|----------------|-------|
| **Positive (+)** | `text-green-600 opacity-70` | #16a34a @ 70% | Increases from previous week |
| **Negative (-)** | `text-red-600 opacity-70` | #dc2626 @ 70% | Decreases from previous week |
| **Zero (0)** | Default (black) | #000000 | No change |

**Rationale:**
- Muted colors reduce visual noise
- Lower opacity keeps focus on signal types
- Still provides at-a-glance change information

---

## Typography

### Summary Box

**Current Styling:**
- Font size: `text-[18px]` (18px)
- Font weight: `font-semibold` (600)
- Padding: `px-4 py-2` (16px horizontal, 8px vertical)
- Background: `bg-yellow-300` (yellow highlight)
- Text color: `text-black` (with signal-specific overrides)

**Example:**
```tsx
<div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
  <span className="text-blue-700">L:76</span>
  <span className="text-green-600 opacity-70">(+23)</span>
</div>
```

### Table Text

**Headers:**
- Font size: `text-[9px]` (9px)
- Font weight: `font-bold`
- Color: `text-gray-100`
- Line height: `leading-tight`

**Body:**
- Font size: `text-[11px]` (11px)
- Font weight: Normal
- Color: `text-gray-100` (with signal-specific overrides)

---

## Component-Specific Guidelines

### Summary Box (Yellow Box)

**Location:** Above each data table  
**File:** `components/KrjTabsClient.tsx`

**Structure:**
```
L:76 (+23) | N:348 (-32) | S:77 (+9) | Tot:501
 ↑          ↑               ↑
Blue      Black           Red
     ↑           ↑              ↑
  Muted green  Muted red    Muted green
```

**Implementation:**
```tsx
{group.summary.rowsSummary.map((r, idx) => {
  const labelColor = r.label === "Long" ? "text-blue-700" 
    : r.label === "Short" ? "text-red-700" 
    : "text-black";
  const deltaColor = r.delta > 0 ? "text-green-600 opacity-70" 
    : r.delta < 0 ? "text-red-600 opacity-70" 
    : "";
  
  return (
    <span key={r.label}>
      <span className={labelColor}>{r.label.charAt(0)}:{r.current}</span>
      <span className={deltaColor}>({r.delta > 0 ? "+" : ""}{r.delta})</span>
    </span>
  );
})}
```

### Data Table Signal Columns

**Columns Affected:**
- "Current Week Signal" (`signal`)
- "Last Week Signal" (`signal_status_prior_week`)

**Color Mapping:**
```tsx
let cellColorClass = "";
if (col.key === "signal" || col.key === "signal_status_prior_week") {
  if (value === "Long") {
    cellColorClass = "text-blue-400";
  } else if (value === "Short") {
    cellColorClass = "text-red-400";
  }
  // Neutral remains text-gray-100 (default)
}
```

**Visual Effect:**
- Long signals: Stand out in blue
- Short signals: Stand out in red
- Neutral signals: Blend with other text (easy to scan past)

---

## Design Principles

### 1. Visual Hierarchy

**Primary → Secondary → Tertiary:**
1. **Signal type** (Long/Short) - Bold, saturated colors
2. **Change indicators** (+/-) - Muted colors, reduced opacity
3. **Neutral signals** - Default text color

### 2. Consistency

- Same color scheme across all UI elements
- Summary box and table use matching colors
- All tabs (Equities, ETFs/FX, SP500, SP100) styled identically

### 3. Accessibility

- **High contrast:** All colors tested on dark background (`bg-gray-950`)
- **Not color-dependent:** Text labels always present ("Long", "Short", "Neutral")
- **WCAG compliance:** Color combinations meet AA standards

### 4. Scannability

- Bold colors for actionable signals (Long/Short)
- Muted colors for contextual info (deltas)
- Neutral signals don't distract from Long/Short

### 5. Trader-Focused

- High information density
- Quick visual identification of signal types
- Minimal decorative elements
- Dark theme for reduced eye strain

---

## Color Palette Reference

### Tailwind Classes Used

**Blues (Long signals):**
- `text-blue-700` - #1d4ed8 (summary box)
- `text-blue-400` - #60a5fa (table)

**Reds (Short signals):**
- `text-red-700` - #b91c1c (summary box)
- `text-red-400` - #f87171 (table)

**Greens (Positive deltas):**
- `text-green-600` - #16a34a (with 70% opacity)

**Reds (Negative deltas):**
- `text-red-600` - #dc2626 (with 70% opacity)

**Neutrals:**
- `text-black` - #000000 (summary box)
- `text-gray-100` - #f3f4f6 (table)
- `bg-gray-950` - #030712 (page background)
- `bg-yellow-300` - #fde047 (summary box background)

---

## Implementation Checklist

When adding new KRJ features or pages:

- [ ] Use blue for Long signals (`text-blue-700` or `text-blue-400`)
- [ ] Use red for Short signals (`text-red-700` or `text-red-400`)
- [ ] Keep Neutral signals in default text color
- [ ] Use muted colors for deltas (`opacity-70`)
- [ ] Maintain high contrast on dark background
- [ ] Test across all tabs for consistency
- [ ] Ensure text labels accompany colors (accessibility)
- [ ] Follow existing font sizes and spacing

---

## Examples

### Good ✅

```tsx
// Clear signal type with muted delta
<span className="text-blue-700">L:76</span>
<span className="text-green-600 opacity-70">(+23)</span>

// Table cell with appropriate color
<td className="text-blue-400">Long</td>
```

### Bad ❌

```tsx
// Don't use bright colors for deltas
<span className="text-green-500">(+23)</span>

// Don't use inconsistent colors
<span className="text-purple-600">L:76</span>

// Don't omit signal type colors
<span className="text-black">Long</span> // Should be blue
```

---

## Future Considerations

### Potential Enhancements

1. **Hover states:** Add subtle highlighting on table row hover
2. **Signal strength:** Consider opacity variations for signal confidence
3. **Animation:** Subtle transitions when data updates
4. **Print styles:** Ensure colors translate well to grayscale

### Alternative Color Schemes (If Needed)

**Option A: Green for Long**
- Long: `text-green-600` / `text-green-400`
- Rationale: Traditional "green = buy" association

**Option B: Brighter Colors**
- Long: `text-blue-500`
- Short: `text-red-500`
- Rationale: More vibrant, higher contrast

**Option C: Monochrome**
- All signals: `text-gray-100`
- Use icons or bold text instead
- Rationale: Accessibility for color-blind users

---

## Version History

### v1.0 - December 26, 2025
- Initial style guide creation
- Established blue/red color scheme for Long/Short
- Defined muted delta colors
- Documented summary box and table styling

---

## References

- **Implementation:** `components/KrjTabsClient.tsx`
- **Deployment:** See `DEPLOYMENT_KRJ.md`
- **Architecture:** See `docs/KRJ_DEPLOYMENT_ARCHITECTURE.md`
- **Workflow:** See `docs/KRJ_DEV_WORKFLOW.md`

---

*For questions or proposed changes to these guidelines, document the rationale and update this guide accordingly.*

