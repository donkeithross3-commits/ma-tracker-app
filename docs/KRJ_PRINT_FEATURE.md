# KRJ Print Feature Documentation

## Overview

The KRJ page now includes a comprehensive print feature that allows users to print one group, any subset of groups, or all 4 groups with a single click, optimized for landscape-oriented pages.

## Features

### Print Button
- Located in the top-right area of the KRJ page
- Printer icon with "Print" label
- Dark theme styling consistent with the KRJ UI

### Print Dialog
- Clean, modal dialog with group selection
- Checkboxes for each group:
  - Equities
  - ETFs / FX
  - SP500
  - SP100
- Quick action buttons:
  - **Current Tab**: Selects only the currently active tab
  - **All Groups**: Selects all 4 groups
- **Print** button: Triggers the print process
- **Cancel** button: Closes dialog without printing

### Print Layout
- Landscape-oriented pages
- White background with black text (print-optimized)
- Each group includes:
  - Group title
  - Summary card with signal counts and deltas
  - Full data table with all rows
- Page breaks between groups
- Table headers repeat on each page
- No horizontal scrolling (text wraps as needed)

## Usage

### Basic Print Flow

1. **Click the "Print" button** in the top-right corner
2. **Select groups** to print using checkboxes
3. **Click "Print"** in the dialog
4. **Browser print dialog** opens automatically
5. **Configure print settings** (printer, pages, etc.)
6. **Print or save as PDF**

### Quick Actions

**Print Current Tab:**
1. Click "Print" button
2. Click "Current Tab" quick action
3. Click "Print"

**Print All Groups:**
1. Click "Print" button
2. Click "All Groups" quick action
3. Click "Print"

**Print Specific Groups:**
1. Click "Print" button
2. Check/uncheck desired groups
3. Click "Print"

## Technical Implementation

### Files Created

1. **`components/KrjPrintLayout.tsx`**
   - Print-optimized layout component
   - Renders selected groups sequentially
   - Applies print-specific formatting
   - Handles page breaks

2. **`components/ui/dialog.tsx`**
   - Radix UI Dialog component
   - Modal overlay and content
   - Close button and keyboard shortcuts

3. **`components/ui/checkbox.tsx`**
   - Radix UI Checkbox component
   - Accessible checkbox with visual indicator

### Files Modified

1. **`components/KrjTabsClient.tsx`**
   - Added print state management
   - Added print dialog UI
   - Added print button
   - Added print trigger logic
   - Wrapped tabbed layout with screen-only class

2. **`app/globals.css`**
   - Added `@media print` styles
   - Landscape page setup
   - Print-specific table styling
   - Visibility rules for screen vs print

### Dependencies Added

- `@radix-ui/react-checkbox` - Checkbox component for group selection

## Print Styling

### Page Setup
- **Orientation:** Landscape
- **Margins:** 0.5in top/bottom, 0.25in left/right
- **Background:** White
- **Text Color:** Black

### Table Styling
- **Font Size:** 9px for data, 8px for headers
- **Border:** 1px solid #333
- **Padding:** 2px vertical, 4px horizontal
- **Text Wrapping:** Enabled to prevent horizontal scrolling
- **Header Repeat:** Table headers repeat on each page

### Summary Card
- **Background:** Light yellow (#ffffcc)
- **Border:** 1px solid #999
- **Font Size:** 10px
- **Inline display:** Compact layout

## Edge Cases Handled

### No Groups Selected
- **Behavior:** Auto-selects current tab
- **User Experience:** Seamless, no error messages

### Very Wide Tables
- **Solution:** 
  - Reduced font sizes (9px data, 8px headers)
  - Text wrapping enabled
  - Minimal padding
  - Abbreviated column headers in print view

### Large Datasets
- **Solution:**
  - Table headers repeat on each page
  - Page breaks avoid splitting rows
  - Large tables span multiple pages gracefully

### Print Dialog Cancellation
- **Behavior:** Dialog closes, no print occurs
- **State:** Selected groups persist for next time

## Browser Compatibility

Tested and working in:
- ✅ Chrome/Edge (primary)
- ✅ Firefox
- ✅ Safari

## Testing Checklist

- [x] Print button appears in KRJ page header
- [x] Clicking print button opens dialog
- [x] Checkboxes work (select/deselect groups)
- [x] "Current Tab" button selects only active tab
- [x] "All Groups" button selects all 4 groups
- [x] Clicking "Print" triggers browser print dialog
- [x] Print layout is landscape-oriented
- [x] Tables fit on page without horizontal scrolling
- [x] Text is readable (not too small)
- [x] Summary cards appear above each table
- [x] Page breaks between groups work correctly
- [x] After printing, normal view is restored
- [x] Canceling print dialog doesn't trigger print

## Future Enhancements (Out of Scope for v1)

- Column selection: Let users choose which columns to print
- Custom headers/footers: Add company logo, date, page numbers
- PDF export: Generate PDF client-side (e.g., using jsPDF)
- Print settings persistence: Remember user's last selected groups
- Print history: Track what was printed and when
- Email print: Send printed view as PDF via email

## Troubleshooting

### Print button not visible
- Check that you're on the `/krj` page
- Refresh the page

### Print dialog doesn't open
- Check browser console for errors
- Ensure JavaScript is enabled

### Tables too wide in print
- Use browser's print preview to check
- Adjust browser zoom if needed
- Tables are optimized for standard landscape paper

### Headers not repeating on pages
- This is a browser feature
- Works in Chrome, Firefox, and Safari
- May not work in older browsers

## Code Examples

### Printing Current Tab Programmatically

```typescript
// In KrjTabsClient component
const handleSelectCurrentTab = () => {
  setSelectedGroups([currentTab])
}
```

### Printing All Groups Programmatically

```typescript
// In KrjTabsClient component
const handleSelectAll = () => {
  setSelectedGroups(groups.map(g => g.key))
}
```

### Custom Print Trigger

```typescript
// Trigger print with specific groups
setSelectedGroups(['equities', 'sp500'])
setPrintMode(true)
// window.print() will be called automatically
```

## Accessibility

- Print button has clear label and icon
- Dialog is keyboard accessible (Tab, Enter, Escape)
- Checkboxes have associated labels
- Screen readers can navigate the print dialog
- Print layout uses semantic HTML (h2, table, thead, tbody)

## Performance

- Print layout renders only when needed
- No performance impact on normal browsing
- Print trigger uses 100ms delay for smooth rendering
- Cleanup handlers prevent memory leaks

---

**Implementation Date:** December 15, 2025  
**Version:** 1.0  
**Status:** ✅ Complete and Production-Ready

