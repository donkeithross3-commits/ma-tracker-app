# Parkinson's UI Accessibility - Manual QA Checklist

Test across: Mac Chrome, Win Chrome, iMac Chrome (external monitor).
Test both Normal (compact) and Comfort modes.

## 1. No Horizontal Scroll

- [ ] **Ticker cards (Account tab)**: No horizontal scrollbar inside any ticker card
  - Narrow browser window (400px)
  - Medium browser window (768px)
  - Full width (1920px)
  - External monitor (2560px+)
- [ ] **Ticker cards in Comfort mode**: Same widths as above, no horizontal scroll
- [ ] **Positions table inside cards**: Content truncates, no overflow
- [ ] **Working orders section inside cards**: Wraps within card, no overflow
- [ ] **Ticker sidebar**: Stacks above cards on narrow (<1024px), side-by-side on wide
- [ ] **Button row**: Wraps to multiple lines cleanly, no overflow

## 2. Comfort Mode

- [ ] **Toggle**: User menu > Comfort Mode switch toggles on/off
- [ ] **Persistence**: Refresh page, comfort mode stays on/off as set
- [ ] **Button sizes**: All action buttons visually >= 44px height
- [ ] **Font sizes**: text-xs promoted to text-sm, text-sm promoted to 1rem
- [ ] **Tab triggers**: Visibly larger in comfort mode (44px+)
- [ ] **Checkboxes**: Visibly larger (24px) in comfort mode
- [ ] **Table fluid scaling**: Positions table font/padding scales with column count
- [ ] **No layout breakage**: No overlapping elements, no cut-off text

## 3. Reduced Motion

- [ ] **Spinner animations**: Loading spinners don't animate when prefers-reduced-motion is set
  - Mac: System Settings > Accessibility > Display > Reduce Motion
  - Chrome DevTools: Rendering > Emulate CSS media feature prefers-reduced-motion
- [ ] **Transitions**: Button hover/focus transitions are instant (no slide/fade)
- [ ] **Scroll behavior**: No smooth scrolling when reduced motion is on

## 4. Keyboard Navigation

- [ ] **Tab order**: Tab through Account tab — focus moves logically (ticker list > cards > buttons > table > trade buttons)
- [ ] **Focus rings**: Visible 2px blue ring on all focused buttons/inputs
- [ ] **Comfort focus rings**: 3px ring with 3px offset in comfort mode
- [ ] **No focus on click**: Mouse clicks do NOT show focus ring (only keyboard Tab does)
- [ ] **Enter/Space**: All buttons activate with Enter and Space
- [ ] **Escape**: Modals and overlays close with Escape key
- [ ] **Trade ticket**: Tab navigates through qty, price, action buttons

## 5. ARIA and Screen Reader

- [ ] **Comfort Mode toggle**: role="switch", announces "Comfort Mode" and checked state
- [ ] **Trade Lock toggle**: role="switch", announces armed/locked state
- [ ] **Icon-only buttons**: Gear (Risk Manager), Refresh, Close all announce their label
- [ ] **Step indicator**: "1. Preview → 2. Confirm" announced via aria-live
- [ ] **Dialogs**: role="dialog" with aria-modal="true"

## 6. Order Entry Flow (Safety)

- [ ] **Trade Lock default**: Trade lock starts in "locked" (off) state
- [ ] **Cannot accidentally order**: With trade lock off, submit button is disabled/blocked
- [ ] **Arm to trade**: Toggling trade lock to "armed" enables submit
- [ ] **Confirmation modal**: 2-step: Preview → Confirm, each has Back/Cancel
- [ ] **Cancel order**: Cancel requires confirmation modal
- [ ] **Clear labels**: Action (BUY/SELL), quantity, contract, price all readable at a glance
- [ ] **Large buttons**: Submit/confirm buttons are 52px+ with large text
- [ ] **Debounce**: Rapid double-click on Confirm/Send or "Yes, cancel order" only submits once (500ms cooldown)

## 7. Cross-Platform

- [ ] **Mac Chrome**: All above items pass
- [ ] **Win Chrome**: All above items pass (test with ClearType font rendering)
- [ ] **iMac external monitor**: Layout doesn't break on 2560x1440 or larger
- [ ] **iPad (optional)**: Touch targets are 44px+, no horizontal scroll
