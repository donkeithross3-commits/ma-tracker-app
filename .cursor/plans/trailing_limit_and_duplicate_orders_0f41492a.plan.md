---
name: Trailing limit and duplicate orders
overview: "Fix (1) duplicate working orders in UI when only one exists in TWS, (2) show actual trailing stop/limit prices for TRAIL LIMIT orders, (3) modify-order for TRAIL LIMIT must not send UNSET_DOUBLE (IB 321)."
todos:
  - id: dedup-return
    content: Add return-side dedup in scanner (permId + content key when permId=0)
  - id: frontend-format
    content: Normalize TRAIL LIMIT in formatOrderPrice; show Trail/LMT or placeholder
  - id: modify-trail-prices
    content: When building modify order for TRAIL LIMIT, pass existing trailStopPrice/auxPrice/lmtPrice (never UNSET_DOUBLE)
isProject: false
---

# Fix duplicate working orders and trailing limit prices

## Evidence from agent log (2026-02-09)

**Duplicate orders:** Log shows `orderStatus orderId=0` then `openOrder dedup: permId=982942036 rebound from orderId=0 to -16`. Later, a second bind: `orderStatus orderId=0` then `openOrder dedup: permId=982942364 rebound from orderId=0 to -17`. After that, `openOrderEnd: live order book has 2 active orders`. So we have two entries (-16 and -17) with **different permIds**. When only one order exists in TWS, the same order can be re-delivered after reconnect with a new permId/orderId; input-side dedup only removes the placeholder (orderId 0), so the old orderId (-16) stays and the new one (-17) is added. Return-side dedup by content fixes this.

**Modify TRAIL LIMIT:** Log shows `placeOrder` for orderId -16 with `1.7976931348623157e+308` (UNSET_DOUBLE) in the order, then `IB Error -16/321: Error validating request.-'bG' : cause - Please enter a stop price`. So when we modify a TRAIL LIMIT order, we must not send unset prices; we must pass the existing trailStopPrice/auxPrice/lmtPrice from the open order (or omit them so IB keeps current values).

---

## Bug 1: Two orders showing when only one exists in TWS

**Cause:** Live order book is keyed by orderId. Dedup only runs when the same permId appears with a new orderId (we remove the old orderId). When the same physical order is re-delivered after reconnect with a **new** permId and new orderId (-17), we keep both the previous entry (-16) and the new one (-17).

**Fix:** Deduplicate when **returning** the list.

- **File:** [python-service/standalone_agent/ib_scanner.py](python-service/standalone_agent/ib_scanner.py)
- Add a helper that builds a deduplicated list from `_live_orders.values()`:
  - **By permId:** For same non-zero permId, keep one (e.g. larger orderId).
  - **By content when permId is 0 or for identical-looking orders:** Use a stable key (contract identity + action, totalQuantity, orderType, lmtPrice, auxPrice). When two orders share this key, keep one.
- Use this helper in `get_open_orders_snapshot()` and `get_live_orders()`.

---

## Bug 2: Show actual limit and stop prices for TRAIL LIMIT orders

**Current behavior:** Price column shows "TRAIL LIMIT". Code already captures trailStopPrice/trailingPercent in the scanner; formatOrderPrice only shows custom text when (trailStopPrice != null || lmtPrice != null). If IB has not sent prices yet or order type string differs, we fall back to "TRAIL LIMIT".

**Fix (frontend only):**

- **File:** [components/ma-options/IBPositionsTab.tsx](components/ma-options/IBPositionsTab.tsx) — `formatOrderPrice`
- Normalize order type: e.g. `(orderType || "").trim().toUpperCase().replace(/\s+/g, " ")` then check for "TRAIL LIMIT".
- For TRAIL LIMIT, always show a dedicated line: if we have trailStopPrice/lmtPrice show "Trail X.XX LMT Y.YY"; otherwise show "Trail — LMT —".

---

## Bug 3: Modify TRAIL LIMIT sends UNSET_DOUBLE → IB 321

**Cause (from log):** When building the Order for modify_order, we use `_order_from_dict(order_d)`. For TRAIL LIMIT the frontend may not send trailStopPrice/auxPrice/lmtPrice, so the Order object keeps default UNSET_DOUBLE. The IB client then sends 1.797e+308 to TWS, which rejects with "Please enter a stop price".

**Fix:**

- **File:** [python-service/standalone_agent/ib_scanner.py](python-service/standalone_agent/ib_scanner.py)
- In `modify_order_sync`, when building the order from the payload, if orderType is TRAIL LIMIT (or "TRAIL LIMIT") and the payload is missing auxPrice/trailStopPrice/lmtPrice, **merge in the current values from the live order** for that orderId (from `_live_orders[order_id]`) so we never send UNSET_DOUBLE for those fields. Alternatively, in `_order_from_dict`, never set lmtPrice/auxPrice/trailStopPrice to UNSET_DOUBLE when the key is missing for TRAIL LIMIT — but we don't have the existing order there, so the merge in modify_order_sync (or a dedicated path that fetches current order from _live_orders and fills missing price fields) is the right place.
- Ensure the frontend, when submitting modify for TRAIL LIMIT, sends the current prices from the open order (trailStopPrice, lmtPrice, auxPrice) so the backend gets them; and the backend must use them (or fall back to _live_orders) so the Order never has UNSET_DOUBLE for these.

---

## Implementation order

1. **Scanner:** Return-side dedup in get_open_orders_snapshot and get_live_orders.
2. **Scanner:** Modify-order for TRAIL LIMIT: ensure we pass existing trailStopPrice/auxPrice/lmtPrice when payload omits them (look up _live_orders[order_id] and merge into order_d before _order_from_dict).
3. **Frontend:** formatOrderPrice — normalize order type, always show TRAIL LIMIT line with prices or placeholder.

Agent version bump (e.g. 1.3.10) after scanner changes; deploy per project rules.
