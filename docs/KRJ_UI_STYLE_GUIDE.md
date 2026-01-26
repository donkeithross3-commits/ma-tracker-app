# KRJ UI Style Guide - Complete Reference

**Last Updated:** December 26, 2025  
**Audience:** Active traders scanning cross-sectional signals

---

## Design Principles

1. **High Information Density**: Maximize data visible on screen
2. **Trader-Focused**: Professional, no-nonsense interface
3. **Dark Theme**: High contrast for extended viewing
4. **Minimal Decoration**: Function over form
5. **Compact Layout**: Minimal whitespace between sections
6. **Easy Comparison**: Optimized for scanning down columns and across rows

---

## Typography

### Font Sizes (Current - Dec 26, 2025)

| Element | Size | Notes |
|---------|------|-------|
| Page Title | `text-3xl` (30px) | "KRJ Weekly Signals" |
| Date Subtitle | `text-xl` (21px) | Signal date next to title |
| Tab Labels | `text-lg` (18px) | Group names (Equities, ETFs/FX, etc.) |
| Table Body | `text-[16px]` | All data cells |
| Table Headers | `text-[14px]` | Column headers |
| Summary Box | `text-[18px]` | Long/Short/Neutral counts (fixed size) |
| M&A Button | `text-sm` | Navigation button (fixed size) |

### Number Formatting

- **Prices**: 2 decimals (e.g., `123.45`)
- **Percentages**: 1 decimal with % symbol (e.g., `3.2%`)
- **Millions**: 1 decimal + "M" (e.g., `12.3M`)
- **Billions**: 2 decimals + "B" (e.g., `0.45B`)
- **Trade Size**: No decimals (e.g., `1250`)

### Alignment

- **Numeric Columns**: Right-aligned for easy scanning
- **Text Columns**: Left-aligned (ticker, signal status)
- **Headers**: Match column alignment

---

## Layout & Spacing

### Page Structure (Current - Dec 26, 2025)

```
┌─────────────────────────────────────────────────────┐
│ [KRJ Weekly Signals Dec 19, 2025]  [M&A Button]    │ ← mb-2
├─────────────────────────────────────────────────────┤
│ [Equities] [ETFs/FX] [SP500] [SP100]    [Print]    │ ← mb-1
├─────────────────────────────────────────────────────┤
│ [Yellow Summary Box: L:12(+2) | N:5(-1) | S:8(-1)] │ ← mb-1
├─────────────────────────────────────────────────────┤
│ [Table with data...]                                │
└─────────────────────────────────────────────────────┘
```

### Spacing Values

- **Page Container**: `p-3` (padding around entire page)
- **Header to Tabs**: `mb-2` (8px)
- **Tabs to Summary**: `mb-1` (4px)
- **Summary to Table**: `mb-1` (4px)
- **No Vertical Spacing**: Between major sections (removed `space-y-4`)

### Key Layout Rules

1. **No Subtitle Text**: Removed "Latest snapshot..." for cleaner look
2. **Inline Print Button**: On same row as tabs (right-aligned)
3. **No Blank Space**: Eliminated spacer divs
4. **Sticky Headers**: Table headers remain visible when scrolling
5. **No Horizontal Scroll**: Headers wrap if needed
6. **Summary Above Table**: Not beside it

---

## Color Palette

### Base Colors

| Element | Class | Hex | Usage |
|---------|-------|-----|-------|
| Background | `bg-gray-950` | `#030712` | Page background |
| Text | `text-gray-100` | `#f3f4f6` | Primary text |
| Borders | `border-gray-600` | `#4b5563` | Table borders, dividers |
| Hover | `bg-gray-700` | `#374151` | Row hover state |

### Signal Colors

| Signal | Table | Summary Box | Usage |
|--------|-------|-------------|-------|
| **Long** | `text-blue-400` | `text-blue-700` | Bullish signals |
| **Short** | `text-red-400` | `text-red-700` | Bearish signals |
| **Neutral** | Default gray | `text-black` | No signal |

### Summary Box

- **Background**: `bg-yellow-300` (#fde047)
- **Text**: `text-black` with signal-specific colors
- **Delta (+/-)**: 
  - Positive: `text-green-600 opacity-70`
  - Negative: `text-red-600 opacity-70`

---

## Specific Components

### Header Section

**Structure:**
```tsx
<div className="flex justify-between items-center mb-2">
  <h1 className="text-3xl">
    KRJ Weekly Signals
    <span className="text-xl text-gray-400">{date}</span>
  </h1>
  <Link className="text-sm">M&A Options Scanner →</Link>
</div>
```

**Rules:**
- Title and date on left (inline)
- M&A button on right
- Centered vertical alignment
- No subtitle text below

### Tabs + Print Button

**Structure:**
```tsx
<div className="flex justify-between items-center mb-1">
  <TabsList>...</TabsList>
  <Button>Print</Button>
</div>
```

**Rules:**
- Tabs on left, Print on right (same row)
- No spacer divs
- Tight spacing to content below

### Summary Box

**Structure:**
```tsx
<div className="mb-1">
  <div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
    L:12(+2) | N:5(-1) | S:8(-1) | Tot:25
  </div>
</div>
```

**Rules:**
- Fixed size: `text-[18px]` (do not change)
- Color-coded: Long=blue, Short=red, Neutral=black
- Muted delta colors (opacity-70)
- Positioned above table

### Table

**Structure:**
```tsx
<table className="min-w-full text-[16px]">
  <thead className="bg-gray-800 sticky top-0">
    <th className="text-[14px]">...</th>
  </thead>
  <tbody>
    <tr className="bg-gray-900 hover:bg-gray-700">
      <td className="text-right">...</td>
    </tr>
  </tbody>
</table>
```

**Rules:**
- Body: `text-[16px]`
- Headers: `text-[14px]`
- Sticky headers
- Alternating row colors
- Right-align numeric columns
- Color-code signal columns

---

## Change History

### December 26, 2025 - Font Size & Spacing Update

**Changes:**
1. Increased all font sizes by 50% (except summary box and M&A button)
   - Title: 20px → 30px
   - Date: 14px → 21px
   - Tabs: 12px → 18px
   - Table body: 11px → 16px
   - Table headers: 9px → 14px

2. Removed subtitle text under page title

3. Tightened spacing throughout:
   - Changed `space-y-4` to no spacing
   - Reduced all `mb-3` to `mb-1`
   - Changed header `mb-1` to `mb-2`

4. Eliminated blank space:
   - Removed spacer div before Print button
   - Moved Print button inline with tabs

**Result:** Larger, more readable text with compact, efficient layout

### Previous Updates

- **Color Coding**: Added blue/red for Long/Short signals
- **Summary Box Size**: Doubled from original size
- **Signal Column Shading**: Added subtle color to Current/Last Week Signal columns

---

## Guidelines for Future Changes

### What NOT to Change

1. **Summary Box Font Size**: Keep at `text-[18px]`
2. **M&A Button Font Size**: Keep at `text-sm`
3. **Dark Theme**: Maintain gray-950 background
4. **Signal Colors**: Blue=Long, Red=Short, White=Neutral
5. **Right-Aligned Numbers**: Critical for scanning

### When Adding New Features

1. **Maintain Density**: No excessive padding or margins
2. **No Decorative Elements**: Function over form
3. **Use Existing Colors**: Don't introduce new colors without reason
4. **Test Readability**: Ensure text is legible at current sizes
5. **Preserve Spacing**: Keep tight spacing between sections

### Testing Checklist

- [ ] Text is readable at all sizes
- [ ] No horizontal scroll on standard screens
- [ ] Numbers align properly in columns
- [ ] Signal colors are distinct
- [ ] Summary box is visible and clear
- [ ] Tabs and buttons are clickable
- [ ] Print functionality works
- [ ] Hard refresh shows changes in production

---

## Quick Reference

### Common Tailwind Classes Used

```
Spacing:     p-3, mb-1, mb-2
Text Sizes:  text-3xl, text-xl, text-lg, text-[16px], text-[14px]
Colors:      bg-gray-950, text-gray-100, border-gray-600
             text-blue-400, text-red-400, bg-yellow-300
Layout:      flex, justify-between, items-center
Table:       sticky top-0, text-right, whitespace-nowrap
```

### File Locations

- **Page Component**: `app/krj/page.tsx`
- **Client Component**: `components/KrjTabsClient.tsx`
- **Style Guide**: `docs/KRJ_UI_STYLE_GUIDE.md`
- **Original Guidelines**: `docs/krj_ui_style.md`

---

**For questions or clarifications, refer to this guide or the original `krj_ui_style.md`**

