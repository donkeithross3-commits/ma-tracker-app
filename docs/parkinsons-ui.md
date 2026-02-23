# Parkinson's-Friendly UI Design Guide — DR3 Trading Dashboard

> **Purpose:** Evidence-based design rules for making the DR3 trading dashboard safe and usable for users with Parkinson's disease (PD), with emphasis on tremor, bradykinesia, rigidity, and ON/OFF motor fluctuations.

---

## 1. Research Findings Summary

### Motor Symptoms Affecting UI Interaction

- **Tremor (resting & action):** Causes accidental taps/clicks, imprecise pointer targeting, and unintended double-clicks. Worsens with stress (e.g., live trading).
- **Bradykinesia:** Slowed movement initiation and execution. Users take 2–4× longer to reach targets; time-limited UI elements are inaccessible during OFF periods.
- **Rigidity:** Reduced fine motor control, especially in distal extremities. Multi-finger gestures and pinch/drag are unreliable.
- **Motor fluctuations (ON/OFF):** Abilities can change dramatically within minutes. UI must be usable at the user's worst, not average.
- **Dyskinesia (medication side-effect):** Involuntary movements that cause overshooting and accidental activation of adjacent controls.

### Key Research Findings

| Finding | Source | Implication |
|---------|--------|-------------|
| PD users are 2–4× slower in pointing tasks; error rates increase with smaller targets | Wacharamanotham et al. (2025) [1] | Minimum 44px targets; 48px+ preferred |
| PD users trade speed for accuracy — they slow down to hit targets correctly | Zhang et al. (2024) [2] | Never impose time limits; allow deliberate interaction |
| Drag gestures require ~4s even for short distances; error-prone | Nunes et al. (2015) [3] | Avoid drag-to-confirm, slide-to-unlock, drag-and-drop |
| Tap is most reliable gesture for PD users; swipe acceptable; multi-tap degrades after 10th tap | Nunes et al. (2015) [3] | Use single-tap/click for all primary actions |
| WCAG 2.5.8 requires 24×24px minimum (AA); 44×44px for AAA | W3C WAI [4] | Comfort mode targets ≥ 44px; normal mode ≥ 24px |
| Debounce inputs at 300–500ms to prevent tremor-induced double-activations | Motor impairment best practices [5] | Debounce all order-entry buttons |
| Confirmation before irreversible actions is essential for motor impairment | WCAG 3.3.4 Error Prevention [6] | Review modal with one confirm action for all trades |
| Focus visibility must be clearly distinguishable (3:1 contrast, 2px+ outline) | WCAG 2.4.13 Focus Appearance [7] | High-contrast focus rings in both modes |
| `prefers-reduced-motion` prevents vestibular/motor confusion | WCAG 2.3.3 Animation from Interactions [8] | Respect OS motion preference; reduce/remove animations |

---

## 2. Concrete UI Rules

### 2.1 Target Sizes

| Context | Minimum Size | Comfort Mode Size | Rationale |
|---------|-------------|-------------------|-----------|
| Primary action buttons (Trade, Confirm, Cancel) | 44 × 44 px | 52 × 52 px | WCAG AAA; PD literature recommends ≥44px |
| Secondary buttons (Scan, Risk Mgr) | 36 × 36 px | 44 × 44 px | Adequate spacing compensates at 36px |
| Table action buttons (per-row) | 32 × 32 px | 44 × 44 px | Comfort mode brings rows to AAA |
| Checkboxes / Toggles | 24 × 24 px | 32 × 32 px | Toggles preferred over checkboxes for PD |
| Close / dismiss buttons | 32 × 32 px | 44 × 44 px | Must not be small "×" in corner |

### 2.2 Spacing

| Rule | Value | Comfort Mode Value |
|------|-------|--------------------|
| Minimum gap between interactive elements | 8px | 12px |
| Minimum gap between adjacent action buttons | 8px | 16px |
| Row height for data tables | 32px min-height | 44px min-height |
| Padding around buttons | 8px 12px | 12px 16px |

### 2.3 Typography

| Element | Normal | Comfort Mode |
|---------|--------|-------------|
| Body / table text | 14–16px (0.875–1rem) | 18px (1.125rem) |
| Button labels | 14px | 16–18px |
| Headers | 16–18px | 20–24px |
| Order confirmation details | 16px | 20px |
| Minimum contrast ratio | 4.5:1 (AA) | 7:1 (AAA) preferred |

### 2.4 Interaction Rules

| Rule | Details |
|------|---------|
| **No time-limited UI** | No countdown timers, auto-dismissing toasts, or session timeouts on confirmation dialogs |
| **No drag/slide-to-confirm** | All confirmations via discrete tap/click |
| **No long-press** | All actions accessible via single click/tap |
| **No hover-only affordances** | All hover states must also appear on `:focus-visible` |
| **Debounce action buttons** | 500ms debounce on trade/order buttons to prevent tremor double-clicks |
| **Keyboard navigation** | Full Tab traversal; Enter/Space activation; Escape to cancel/close |
| **No multi-finger gestures** | Pinch, spread, rotate are unreliable for PD users |
| **Respect prefers-reduced-motion** | Remove transitions, reduce animations to opacity-only fades |

### 2.5 Error Prevention & Recovery

| Pattern | Implementation |
|---------|---------------|
| **Single-screen order confirmation** | One review modal with full order details and a single "Send order" button; no second confirmation step |
| **No accidental order placement** | Order button never auto-submits; always opens review modal first |
| **Clear cancel path** | Every modal/dialog has a visible, large Cancel button — never just "×" |
| **Destructive action confirmation** | Cancel-order and close-position require explicit "Yes, cancel" confirmation |
| **Default-safe states** | Order type defaults to Limit (not Market) |
| **Undo where safe** | Only if action can be safely reversed within system constraints (not for executed trades) |

---

## 3. Trading Safety Patterns

### 3.1 Order Confirmation Flow

```
┌──────────────────────────────────────────┐
│  Review order                            │
│                                          │
│  Action:    BUY                          │
│  Contract:  AAPL 250117C00200000         │
│  Quantity:  5                            │
│  Type:      LIMIT @ $3.50               │
│  Est. Cost: $1,750.00                    │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │    Cancel     │  │  Send order     │  │
│  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────┘

- Single screen: review details then one click to send
- NO countdown timer, NO auto-submit
- Buttons are 44px+ tall; Cancel always visible
```

### 3.2 Destructive Action Pattern

```
┌──────────────────────────────────────────┐
│  Cancel Order?                           │
│                                          │
│  Order #12345                            │
│  BUY 5 AAPL calls @ $3.50              │
│                                          │
│  ⚠ This cannot be undone if the order   │
│    has already filled.                   │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │     Back     │  │  Yes, Cancel It  │  │
│  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────┘
```

---

## 4. Developer Building Blocks

Use these when adding or refining UI so the dashboard stays PD-friendly without duplicating logic.

| Building block | Where | Use when |
|----------------|-------|----------|
| **`useDebouncedCriticalClick(callback, 500)`** | `lib/use-debounced-critical-click.ts` | Any critical action button (confirm order, cancel order, submit form) where a tremor double-tap must not fire twice. First click runs immediately; repeats within 500ms are ignored. |
| **Comfort mode** | `data-density="comfort"` on `<html>`, set by `UIPreferencesProvider` | All scaling (44px targets, larger font, touch-action, shorter transitions) is applied via `globals.css`. Use `useUIPreferences().isComfort` only when you need layout changes (e.g. TickerEditorModal arrow layout). |
| **Primary action buttons** | — | Use `min-h-[44px]` (compact) or `min-h-[52px]` for primary CTAs; trade ticket uses `min-h-[68px]`. Comfort mode globally enforces 44px on buttons. |
| **Modal confirm flow** | `OrderConfirmationModal` | Single review screen with full order details and one "Send order" button; no countdown; Cancel always visible; confirm uses debounced click. Reuse for other irreversible actions. |
| **Positions table (Account tab)** | `IBPositionsTab.tsx` | In Comfort mode, positions default to 4 columns (symbol, pos, pnl, trade); Trade column has fixed min-width so buttons never cut off; table scrolls horizontally (no ellipses). A hint under the column chooser explains the default. |
| **Escape hatches** | `.no-density`, `.inline-edit` | Add `.no-density` when global comfort rules break a component (e.g. stacked icon buttons); then use `isComfort` to apply correct sizing. Use `.inline-edit` on compact table inputs. |
| **Focus and touch** | `globals.css` | Comfort mode adds 3px focus ring and `touch-action: manipulation` on buttons/tabs to remove 300ms tap delay. No component changes needed. |

---

## 5. Finding → Dashboard Change Mapping

| # | Research Finding | Dashboard Change | Component(s) |
|---|-----------------|-----------------|--------------|
| 1 | PD users need ≥44px targets | Comfort mode sets `--d-btn-min-h: 2.75rem` (44px) | `globals.css` |
| 2 | Tremor causes accidental double-clicks | 500ms cooldown via `useDebouncedCriticalClick` on confirm buttons; `isSubmitting` guard | `lib/use-debounced-critical-click.ts`, `OrderConfirmationModal.tsx`, `IBPositionsTab.tsx` |
| 3 | Drag gestures unreliable for PD | No drag-to-confirm anywhere; ticker editor uses tap-based reorder buttons | `TickerEditorModal.tsx` |
| 4 | Time pressure worsens motor performance | No countdown timers on confirmation; single review screen | `OrderConfirmationModal.tsx` |
| 5 | Motor fluctuations mean abilities change | Single review screen with explicit Send; no time pressure | `OrderConfirmationModal.tsx`, `IBPositionsTab.tsx` |
| 6 | Small targets cause mis-clicks on adjacent controls | Increased spacing in comfort mode; button row wraps to 2 lines | `IBPositionsTab.tsx`, `globals.css` |
| 7 | Bradykinesia slows Tab navigation | Logical Tab order; visible focus rings (3px, high contrast) | `globals.css`, all interactive components |
| 8 | Cognitive impairment in PD | Progressive disclosure; clear labels; no jargon-only icons | `IBPositionsTab.tsx`, button labels |
| 9 | Motion sensitivity | `prefers-reduced-motion` reduces all animations; comfort mode shortens transitions on interactive elements when OS has not set reduce motion | `globals.css` |
| 10 | Horizontal scroll is unreachable for limited dexterity | Responsive column hiding; flex-wrap; no overflow-x | `IBPositionsTab.tsx`, `globals.css` |
| 10b | Touch delay on mobile/tablet | Comfort mode sets `touch-action: manipulation` on buttons/tabs to remove 300ms tap delay | `globals.css` |
| 11 | Hover-only states invisible to keyboard users | All `:hover` states duplicated to `:focus-visible` | `globals.css`, component styles |
| 12 | Confirmations prevent costly errors | Single review modal with full details and one Send order action | `OrderConfirmationModal.tsx` |

---

## 6. Annotated Bibliography

### [1] Wacharamanotham, C. et al. (2025). "Modeling Mouse-based Pointing and Steering Tasks for People with Parkinson's Disease." *Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies.*
- **DOI:** [10.1145/3712267](https://dl.acm.org/doi/10.1145/3712267)
- **Key finding:** PD users show significantly increased movement time and trajectory variability. Standard Fitts' Law underestimates task difficulty for PD users. Steering tasks (following paths) are especially impaired.
- **Actionable:** Make clickable areas as large as possible; avoid requiring cursor to follow narrow paths; provide generous margins around interactive elements.

### [2] Zhang, X. et al. (2024). "Model Touch Pointing and Detect Parkinson's Disease via a Mobile Game." *Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies*, 8(2).
- **DOI:** [10.1145/3659627](https://dl.acm.org/doi/10.1145/3659627)
- **Key finding:** PD participants exhibited 2–4× slower pointing times and greater variance. They trade speed for accuracy (lower error rate but much slower). Finger-Fitts law provides better modeling than standard Fitts' law for PD.
- **Actionable:** Never impose time pressure. Larger targets reduce the speed/accuracy trade-off. Minimum 48px recommended for PD touch targets.

### [3] Nunes, F. et al. (2015). "User Interface Design Guidelines for Smartphone Applications for People with Parkinson's Disease." *Proceedings of the 7th International Conference on Software Development and Technologies for Enhancing Accessibility.*
- **URL:** [ResearchGate](https://www.researchgate.net/publication/284096283_User_interface_design_guidelines_for_smartphone_applications_for_people_with_Parkinson's_disease)
- **Key findings:** 12 design guidelines derived from empirical testing with PD users. Tap is most reliable gesture. Swipe is acceptable. Drag requires ~4 seconds. Multi-tap degrades after 10 taps. Physical limitations vary dramatically with medication cycles.
- **Guidelines extracted:**
  1. Prefer tap/click over other gestures
  2. Avoid multi-step gestures requiring sustained contact
  3. Provide visual feedback for all interactions
  4. Use large buttons (minimum 48dp / ~48px)
  5. Account for medication ON/OFF fluctuations in session design
  6. Avoid time-limited interactions
  7. Minimize required precision for target acquisition

### [4] W3C WAI. "Understanding Success Criterion 2.5.8: Target Size (Minimum)." *WCAG 2.2.*
- **URL:** [w3.org/WAI/WCAG22/Understanding/target-size-minimum.html](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **Key requirements:**
  - Level AA: 24 × 24 CSS pixels minimum target size
  - Level AAA (SC 2.5.5): 44 × 44 CSS pixels
  - Undersized targets must have 24px-diameter non-overlapping spacing circles
  - Exceptions for inline text, user-agent controls, essential presentations
- **Actionable:** Normal mode ≥ 24px; Comfort mode ≥ 44px for all interactive elements.

### [5] W3C WAI. "Understanding Success Criterion 2.5.5: Target Size (Enhanced)." *WCAG 2.2.*
- **URL:** [w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- **Key requirement:** 44 × 44 CSS pixels (Level AAA). Designed specifically for users with hand tremors, limited fine motor control, and those using specialized input devices.
- **Actionable:** All primary trading controls (Place Order, Confirm, Cancel) should meet this in both modes.

### [6] W3C WAI. "Understanding Success Criterion 3.3.4: Error Prevention (Legal, Financial, Data)." *WCAG 2.2.*
- **URL:** [w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)
- **Key requirement:** For financial transactions: submissions are reversible, checked for errors, or confirmed before finalizing.
- **Actionable:** Every trade order must be previewed and explicitly confirmed; cancellation of working orders requires confirmation.

### [7] W3C WAI. "Understanding Success Criterion 2.4.13: Focus Appearance." *WCAG 2.2.*
- **URL:** [w3.org/WAI/WCAG22/Understanding/focus-appearance.html](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- **Key requirement:** Focus indicator has 3:1 contrast ratio against unfocused state, with a minimum 2px outline or equivalent area.
- **Actionable:** Focus rings must be visible in dark theme; use 2px+ outline with contrasting color.

### [8] W3C WAI. "Understanding Success Criterion 2.3.3: Animation from Interactions." *WCAG 2.2.*
- **URL:** [w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- **Key requirement:** Motion animation triggered by interaction can be disabled, unless essential.
- **Actionable:** Respect `prefers-reduced-motion`; provide comfort mode toggle that also reduces motion.

### [9] Popescu, A. "Web Accessibility for Physical or Motor Impairments." *NYC Design (Medium).*
- **URL:** [medium.com/nyc-design/web-accessibility-for-physical-or-motor-impairments](https://medium.com/nyc-design/web-accessibility-for-physical-or-motor-impairments-4fe5e170e375)
- **Key recommendations:** All functions keyboard-accessible; minimum 44×44px targets; debounce inputs 300–500ms; avoid hover-only states; provide alternatives to complex gestures.

### [10] Harvard Digital Accessibility. "Motor Impairment."
- **URL:** [accessibility.huit.harvard.edu/disabilities/motor-impairment](https://accessibility.huit.harvard.edu/disabilities/motor-impairment)
- **Key guidance:** Keyboard-first design; avoid time-dependent responses; use large click targets; provide error tolerance in forms; avoid requiring sustained physical contact with input devices.

---

## 7. Manual QA Checklist

### Cross-Browser Verification

| Check | Mac Chrome | Win Chrome | iMac Chrome |
|-------|-----------|-----------|-------------|
| Ticker card: no horizontal scroll (normal mode) | ☐ | ☐ | ☐ |
| Ticker card: no horizontal scroll (comfort mode) | ☐ | ☐ | ☐ |
| Button row wraps cleanly at narrow widths | ☐ | ☐ | ☐ |
| Header row wraps cleanly at narrow widths | ☐ | ☐ | ☐ |
| Comfort mode toggle works and persists | ☐ | ☐ | ☐ |
| All buttons ≥ 44px in comfort mode | ☐ | ☐ | ☐ |
| Focus rings visible on all interactive elements | ☐ | ☐ | ☐ |
| Tab order logical through order entry flow | ☐ | ☐ | ☐ |

### Order Entry Flow

| Check | Pass? |
|-------|-------|
| Cannot accidentally place order (Trade Lock active by default) | ☐ |
| Trade Lock toggle is large and easy to activate | ☐ |
| Order preview shows all details before confirm | ☐ |
| Confirm button requires deliberate click (no auto-submit) | ☐ |
| Cancel/Back button always visible and equally sized | ☐ |
| No countdown timer on confirmation dialog | ☐ |
| No drag/slide-to-confirm pattern | ☐ |
| Cancel-order action requires explicit confirmation | ☐ |
| Order summary is readable in both modes | ☐ |
| Debounce prevents double-submission on tremor double-click | ☐ |

### Accessibility

| Check | Pass? |
|-------|-------|
| All icon-only buttons have aria-labels | ☐ |
| prefers-reduced-motion respected (animations reduced) | ☐ |
| Hover affordances also appear on focus | ☐ |
| No hover-only interactions (all discoverable without mouse) | ☐ |
| Color is not only indicator of state | ☐ |
| Text readable at 200% zoom without horizontal scroll | ☐ |

---

*Last updated: 2026-02-22*
*Applies to: DR3 Trading Dashboard (ma-tracker-app)*
