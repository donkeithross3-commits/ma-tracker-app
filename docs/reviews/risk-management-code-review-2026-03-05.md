# Risk Management Code Review — Full Failure Mode Analysis

**Date:** 2026-03-05
**Reviewer:** trading-engine agent
**Scope:** All risk management code in `python-service/standalone_agent/`
**Files reviewed:**
- `strategies/risk_manager.py` (1262 lines) — position guardian strategy
- `execution_engine.py` (~1770 lines) — eval loop, order gates, order lifecycle
- `strategies/big_move_convexity.py` (~1300 lines) — signal strategy, RM spawn path
- `ib_data_agent.py` (~3150 lines) — orchestrator, reconciliation, hot-modify dispatch
- `quote_cache.py` (351 lines) — streaming market data cache
- `position_store.py` (~250 lines) — JSON persistence for positions
- `engine_config_store.py` — engine config persistence for auto-restart

**Agent version at time of review:** 1.28.4

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Finding H1: `_parse_level_key` Mismatch Breaks Fill Routing and Cancellation](#2-finding-h1)
3. [Finding H2: Risk Budget Gate Bypassed for Market Orders](#3-finding-h2)
4. [Finding H3: EOD Close-Out Level Not Integrated Into Lifecycle](#4-finding-h3)
5. [Finding M1: EOD Close-Out Can Conflict With In-Flight Trailing Orders](#5-finding-m1)
6. [Finding M2: Hot-Modify Preset Changes Have No Effect](#6-finding-m2)
7. [Finding M3: Reconciliation Detects Qty Mismatches But Doesn't Fix Them](#7-finding-m3)
8. [Finding M4: 1-Lot Positions Never Benefit From Multi-Tranche Scale-Out](#8-finding-m4)
9. [Finding M5: `_pending_lineage` Never Cleared After Consumption](#9-finding-m5)
10. [Finding L1: Dead Code — `_register_pending` Never Called](#10-finding-l1)
11. [Finding L2: `_active_orders` Can Leak in Long Sessions](#11-finding-l2)
12. [Finding L3: Position Store Writes on Every Mutation](#12-finding-l3)
13. [Finding L4: `eod_exit_time` Cannot Be Hot-Modified](#13-finding-l4)
14. [Finding L5: Float-to-Int Truncation in `on_fill`](#14-finding-l5)
15. [Finding L6: `_reconnect_hold` Has No Memory Barrier](#15-finding-l6)
16. [Positive Observations](#16-positive-observations)
17. [Recommended Fix Priority](#17-recommended-fix-priority)

---

## 1. Architecture Overview

The risk management system has three layers:

**Layer 1 — Entry Gating (execution_engine.py):**
Orders pass through a 5-gate pipeline before reaching IB:
- Gate 0: Per-ticker trade mode (NORMAL / EXIT_ONLY / NO_ORDERS)
- Gate 1a: Per-ticker entry budget
- Gate 1b: Global entry cap (order count)
- Gate 1c: Risk budget (total dollar exposure)
- Gate 2: Flip-flop guard (rate limiter)
- Gate 3: In-flight order cap
- Gate 4: IB connection check + reconnect hold

Exit orders (from risk managers) bypass Gates 1-3.

**Layer 2 — Position Guardian (risk_manager.py):**
Each filled entry spawns a `RiskManagerStrategy` that monitors the position via
streaming quotes and generates exit orders when thresholds are hit:
- Simple or laddered stop loss
- Profit taking targets (ladder)
- Trailing stop with multi-tranche scale-out
- EOD close-out (1DTE positions)

Each exit level follows a state machine: ARMED -> TRIGGERED -> FILLED (or FAILED).

**Layer 3 — Reconciliation (ib_data_agent.py + execution_engine.py):**
Every ~60s, the agent compares its in-memory position view against IB's source
of truth. Orphaned IB positions get auto-spawned risk managers. Stale agent
positions get marked closed.

**Thread model:**
- `exec-engine` thread: eval loop (100ms), calls `strategy.evaluate()`, queues orders
- `order-exec` thread: single-worker ThreadPoolExecutor, calls `place_order_sync()`
- IB EReader thread: delivers tick callbacks, order status callbacks
- Async event loop: agent heartbeat, WebSocket communication, reconciliation

---

## 2. Finding H1: `_parse_level_key` Mismatch Breaks Fill Routing and Cancellation

**Severity:** HIGH — confirmed bug, affects stop_simple, eod_closeout, and any
future non-numeric level keys
**Files:** `risk_manager.py` lines 647-655, 538, 682, 909-918

### The Mechanism

The risk manager tracks exit levels in `_level_states` using string keys:
- `"stop_simple"` for simple stop loss
- `"stop_0"`, `"stop_1"` for laddered stops
- `"profit_0"`, `"profit_1"` for profit targets
- `"trailing"` for trailing stop
- `"eod_closeout"` for end-of-day close-out

When a level triggers, the engine calls `on_order_placed(order_id, ...)`. This
method must map the `order_id` to the correct level so that `on_fill` and
`on_order_dead` can update the right level's state. It does this by:

1. Scanning `_level_states` for TRIGGERED levels without a pending order
2. Calling `_parse_level_key(level_key)` to extract `(level_type, level_idx)`
3. Creating a `PendingOrder(level_type=lt, level_idx=li)`

Later, `on_fill` and `on_order_dead` reconstruct the level key from the
PendingOrder:
```python
level_key = f"{pending.level_type}_{pending.level_idx}"
if pending.level_type == "trailing":
    level_key = "trailing"
```

### The Bug

`_parse_level_key("stop_simple")` returns `("stop_simple", 0)`:
```python
def _parse_level_key(key: str):
    if key == "trailing":
        return ("trailing", 0)
    parts = key.rsplit("_", 1)           # ["stop", "simple"]
    if len(parts) == 2 and parts[1].isdigit():  # "simple".isdigit() = False
        return (parts[0], int(parts[1]))
    return (key, 0)                      # ("stop_simple", 0)
```

The PendingOrder stores `level_type="stop_simple"`, `level_idx=0`.

When `on_fill` or `on_order_dead` reconstructs the key:
```python
level_key = f"{pending.level_type}_{pending.level_idx}"  # "stop_simple_0"
```

This is `"stop_simple_0"`, but the actual key in `_level_states` is `"stop_simple"`.

### Consequences

**1. `on_fill` sets the wrong key in `_level_states`:**
```python
self._level_states["stop_simple_0"] = LevelState.FILLED  # new spurious key
# "stop_simple" stays at TRIGGERED forever
```

For `stop_simple` this is mitigated because a simple stop exits 100% of the
position, so `remaining_qty` hits 0 and `_completed = True` (line 614), which
gates all future evaluation. The position is correctly closed.

**2. `on_order_dead` re-arms the wrong key:**
```python
self._level_states["stop_simple_0"] = LevelState.ARMED  # wrong key
# "stop_simple" stays at TRIGGERED
```

On the next eval tick, `_check_stop_loss` checks:
```python
if self._level_states.get("stop_simple") != LevelState.ARMED:
    return None  # "stop_simple" is TRIGGERED, not ARMED -> returns None
```

**The stop loss can never re-fire after an IB rejection.** If IB rejects the
stop order (e.g., margin deficit, Read-Only API), the stop is permanently dead.
The position is left unprotected.

**3. `_collect_cancel_ids` can't find the pending order:**
```python
po_key = f"{po.level_type}_{po.level_idx}"  # "stop_simple_0"
if po_key == level_key:  # "stop_simple_0" == "stop_simple" -> False
```

When the user hot-modifies to disable stop loss, the pending order for a
TRIGGERED simple stop is NOT cancelled. The order stays live in IB.

**4. Same bug affects `eod_closeout`:**

`_parse_level_key("eod_closeout")` -> `parts = ["eod", "closeout"]` ->
`"closeout".isdigit()` = False -> returns `("eod_closeout", 0)`.

The EOD close-out can never re-fire after rejection. At 15:30 ET, if the MKT
sell is rejected, the position is stuck.

**5. Levels that DO work correctly:**
- `"stop_0"` -> parse returns `("stop", 0)` -> reconstruct = `"stop_0"` (correct)
- `"profit_0"` -> parse returns `("profit", 0)` -> reconstruct = `"profit_0"` (correct)
- `"trailing"` -> special-cased in both parse and reconstruct (correct)

### Reproduction

This is deterministic: any simple stop or EOD close-out that gets rejected by
IB will never re-fire. To reproduce:
1. Start engine with `zero_dte_convexity` preset (has simple stop at -80%)
2. Enter a position
3. Wait for price to drop 80%+
4. Have IB reject the stop order (e.g., Read-Only API enabled, or Inactive)
5. Observe: stop is permanently dead, position unprotected

### Suggested Fix

Option A (minimal): Add special cases to the reconstruct logic:
```python
# In on_fill and on_order_dead:
if pending.level_type in ("stop_simple", "eod_closeout"):
    level_key = pending.level_type
else:
    level_key = f"{pending.level_type}_{pending.level_idx}"
    if pending.level_type == "trailing":
        level_key = "trailing"
```

Option B (robust): Store the raw `level_key` string directly on PendingOrder
instead of decomposing into `level_type` + `level_idx`. The parse/reconstruct
roundtrip is the root cause — eliminate it.

```python
class PendingOrder:
    __slots__ = ("order_id", "level_key", "level_type", "level_idx",
                 "expected_qty", "filled_so_far", "placed_at")
```

Then use `pending.level_key` everywhere instead of reconstructing.

Option C: Change the key from `"stop_simple"` to `"stop_-1"` (matching the
existing `_collect_cancel_ids` fallback at line 914 which checks
`po.level_idx == -1`). This is the most fragile option — don't recommend it.

---

## 3. Finding H2: Risk Budget Gate Bypassed for Market Orders

**Severity:** HIGH — the risk budget feature silently does nothing
**File:** `execution_engine.py` lines 1216-1219

### The Mechanism

Gate 1c checks whether a new entry would exceed the total dollar exposure cap:
```python
if self._risk_budget_usd > 0:
    est_price = action.limit_price or 0
    multiplier = float(action.contract_dict.get("multiplier", 100))
    new_cost = est_price * action.quantity * multiplier
    current_exposure = self._compute_current_exposure()
    if (current_exposure + new_cost) > self._risk_budget_usd:
        # reject
```

### The Bug

`action.limit_price` is `None` for market orders (which is what BMC exclusively
uses for entries). `None or 0` evaluates to `0`. So:
```
new_cost = 0 * quantity * 100 = 0
```

The risk budget check becomes `current_exposure + 0 > limit`, which only
triggers when existing exposure already exceeds the budget. **New market orders
are never blocked by the risk budget gate.**

### Impact

If a user sets a risk budget of $500 to cap total exposure, the engine will
continue placing unlimited MKT option orders. Each order adds real exposure
but the gate thinks each new order costs $0.

This has likely not been noticed because:
1. The risk budget feature may not be actively used (the global entry cap is the
   primary control)
2. The per-ticker budget (Gate 1a) and global cap (Gate 1b) catch most cases

### Suggested Fix

The `OrderAction` needs an `estimated_cost` field populated by the strategy.
BMC already knows the option premium when it fires the signal (it's in
`self._last_signal["option_contract"]`). Pass this through:

```python
@dataclass
class OrderAction:
    ...
    estimated_notional: float = 0.0  # premium * qty * multiplier

# In _process_order_action:
est_price = action.limit_price or (action.estimated_notional / max(1, action.quantity * multiplier))
```

Alternative: read the mid price from the quote cache in `_process_order_action`.
The cache key is available from the strategy's subscriptions, but the mapping
from contract_dict to cache_key isn't trivial. The `estimated_notional` field
is cleaner.

---

## 4. Finding H3: EOD Close-Out Level Not Integrated Into Lifecycle

**Severity:** HIGH — EOD close-out can never retry after rejection
**File:** `risk_manager.py` lines 1185-1240

### The Mechanism

The EOD close-out level (`"eod_closeout"`) is unique among exit levels:
- It is NOT created during `on_start()` like other levels
- It is dynamically added to `_level_states` on first check after the exit time
- It is NOT included in `get_runtime_snapshot()` or `restore_runtime_state()`

### Bug 1: Can Never Re-Fire (see Finding H1)

Due to the `_parse_level_key` mismatch (Finding H1), after the EOD order is
placed:
- If the order fills: `_level_states["eod_closeout_0"] = FILLED` (wrong key),
  but `_completed = True` saves us.
- If the order is rejected: `_level_states["eod_closeout_0"] = ARMED` (wrong key),
  and `_level_states["eod_closeout"]` stays TRIGGERED. The check at line 1208
  (`!= ARMED`) sees TRIGGERED and returns None. **The EOD close-out is permanently
  dead after a single rejection.**

This means: at 15:30 ET, if IB rejects the sell (margin, connection glitch, etc.),
the 1DTE position carries overnight. For a position that was supposed to be
force-closed same-day, this is a significant risk.

### Bug 2: Not Persisted Across Restarts

`get_runtime_snapshot()` does not serialize the `eod_closeout` level state.
If the agent restarts at 15:35 ET, the restored risk manager won't have the
EOD level in `_level_states`, so `_check_eod_closeout` will re-create it and
try again. This is actually the SAFE direction — restarts fix the bug.

### Bug 3: No Duplicate Order Protection vs Pending Orders

Unlike `_check_stop_loss` and `_check_trailing_stop` which check
`_level_states.get(key) != LevelState.ARMED` (only fires when ARMED),
`_check_eod_closeout` has a weaker check:
```python
if key in self._level_states and self._level_states[key] != LevelState.ARMED:
    return None
```

This is correct IF the level key transitions work properly. But combined with
Bug 1, the stale TRIGGERED state on `"eod_closeout"` does prevent re-fire.
The theoretical risk of duplicate orders doesn't materialize because of Bug 1.

### Suggested Fix

1. Create the `eod_closeout` level in `on_start()` (gated on `eod_exit_time`
   being set in config), so it follows the same lifecycle as other levels.
2. Include `"eod_closeout"` in `get_runtime_snapshot()` / `restore_runtime_state()`.
3. Fix the `_parse_level_key` issue (Finding H1) so it can re-fire after rejection.

---

## 5. Finding M1: EOD Close-Out Can Conflict With In-Flight Trailing Orders

**Severity:** MEDIUM — can cause over-sell in specific timing window
**File:** `risk_manager.py` lines 1185-1240

### The Scenario

1. At 15:29:59, trailing stop fires tranche 1 (sell 33% of position).
   `_trailing_tranche_pending = True`. Order is in-flight.
2. Clock ticks to 15:30:00. Next eval tick runs `_check_eod_closeout()`.
3. EOD check doesn't verify whether there are pending orders.
4. EOD fires MKT sell for 100% of `remaining_qty` (which hasn't been updated
   yet because the trailing fill hasn't arrived).
5. Both orders fill: tranche sells 33%, EOD sells 100%.
6. Total sold: 133% of position. IB will create a short position.

### Likelihood

The window is narrow (~100ms around the EOD boundary while a trailing order is
in flight). But it's not impossible — option positions can have very fast fills.

### Mitigation Already Present

The `evaluate()` method returns early on the first action (lines 500-501:
"Only one level per tick"). So within a single `evaluate()` call, only ONE
of trailing/EOD can fire. The race only occurs if the trailing fires on one
tick and the EOD fires on the NEXT tick (100ms later), before the trailing
fill callback updates `remaining_qty`.

### Suggested Fix

At the top of `_check_eod_closeout()`, add:
```python
if self._pending_orders:
    return None  # wait for in-flight exits to complete
```

This is safe because `_check_eod_closeout` will re-fire on the next tick (every
100ms) after the pending order completes or dies.

---

## 6. Finding M2: Hot-Modify Preset Changes Have No Effect

**Severity:** MEDIUM — user action silently ignored
**Files:** `risk_manager.py` lines 803-907, `ib_data_agent.py` lines 96-128

### The Mechanism

When the dashboard sends a risk config change:
1. `_handle_execution_config()` checks for `_BMC_RISK_FIELDS` in the config
2. `_translate_bmc_to_risk_config()` converts flat BMC fields to nested format
3. The translated config is passed to `rm.update_risk_config(new_config)`

If the user changes `risk_preset` from `"zero_dte_convexity"` to
`"intraday_convexity"`, the translator creates:
```python
{"preset": "intraday_convexity"}
```

But `update_risk_config()` only processes `stop_loss` and `profit_taking` keys.
It does not resolve preset names. The preset is only resolved during `on_start()`
(line 335):
```python
if preset_name and preset_name in PRESETS:
    config.update({k: v for k, v in PRESETS[preset_name].items() if k not in config})
```

So a hot-modify preset change is stored in `_risk_config["preset"]` but has zero
effect on the running RM's behavior. The stop thresholds, trailing parameters,
and profit targets remain unchanged.

### Suggested Fix

In `update_risk_config()`, if `new_config` contains `"preset"`, resolve it:
```python
from strategies.risk_manager import PRESETS
preset_name = new_config.get("preset")
if preset_name and preset_name in PRESETS:
    resolved = {k: v for k, v in PRESETS[preset_name].items()
                if k in ("stop_loss", "profit_taking")}
    new_config = {**resolved, **new_config}
```

Then continue with the existing field-by-field processing.

### Note on UX

The dashboard may or may not expose preset switching as a hot-modify action
(vs. only setting individual fields). If it does, this bug is user-facing.
If it only sends individual field changes, this is latent.

---

## 7. Finding M3: Reconciliation Detects Qty Mismatches But Doesn't Fix Them

**Severity:** MEDIUM — mismatch causes incorrect exit quantities
**File:** `execution_engine.py` lines 1596-1604

### The Mechanism

`reconcile_with_ib()` compares agent position quantities against IB:
```python
if remaining != qty:
    report["adjusted"].append({
        "position_id": agent_pos["id"],
        "ib_qty": qty,
        "agent_qty": remaining,
    })
```

The mismatch is logged but no corrective action is taken.

### Failure Scenarios

**Scenario A — Manual TWS exit of partial position:**
User manually sells 1 of 3 contracts in TWS. Agent still thinks it holds 3.
When trailing stop fires, it tries to sell 3 contracts. IB fills only 2 (the
actual holding). The RM sees `remaining_qty = 1` (3 - 2) but there's nothing
left in IB. The RM continues running, waiting for a fill that will never come.

**Scenario B — Duplicate fill processing:**
If a fill event is processed twice (possible during reconnect), the RM's
`remaining_qty` could be lower than IB's actual position. The RM might think
the position is closed when it's still open.

### Suggested Fix

For `adjusted` entries where `ib_qty != agent_qty`:
```python
for adj in report["adjusted"]:
    rm_state = self._strategies.get(adj["position_id"])
    if rm_state and hasattr(rm_state.strategy, "remaining_qty"):
        rm = rm_state.strategy
        old_qty = rm.remaining_qty
        rm.remaining_qty = adj["ib_qty"]
        rm.initial_qty = max(rm.initial_qty, adj["ib_qty"])
        logger.warning(
            "Reconciliation adjusted %s qty: %d -> %d",
            adj["position_id"], old_qty, adj["ib_qty"]
        )
```

Be careful with the `initial_qty` adjustment — it affects P&L% calculations
only if the entry price also needs re-weighting.

---

## 8. Finding M4: 1-Lot Positions Never Benefit From Multi-Tranche Scale-Out

**Severity:** MEDIUM — suboptimal risk behavior for common position size
**File:** `risk_manager.py` line 933-941

### The Mechanism

```python
def _compute_exit_qty(self, exit_pct: float, is_last_level: bool = False) -> int:
    if is_last_level or exit_pct >= 100:
        return self.remaining_qty
    qty = max(1, round(self.remaining_qty * exit_pct / 100.0))
    if qty >= self.remaining_qty:
        return self.remaining_qty
    return qty
```

For `remaining_qty = 1` and `exit_pct = 33`:
```
qty = max(1, round(1 * 0.33)) = max(1, 0) = 1
qty >= remaining_qty (1 >= 1) -> return remaining_qty = 1
```

The entire position exits on the first tranche trigger. The tighter trail
percentages of subsequent tranches (8%, 5% for `zero_dte_convexity`) never
activate.

### Impact

BMC typically trades 1-lot positions (options are bought 1 contract at a time,
though they may be aggregated). For a 1-lot position:
- Initial trail: 30% below HWM
- Tranche 1 trigger: exits 100% immediately at the 30% trail

The intended behavior was:
- Tranche 1: sell 33%, tighten to 8%
- Tranche 2: sell 50%, tighten to 5%
- Tranche 3: sell 100%

With a tighter trail (8% then 5%), more profit would be captured on a
continuation move. With 1 lot, the full 30% trail applies, which is wider.

### Discussion

This is arguably correct — you can't sell 0.33 contracts. The `max(1, ...)` is
necessary to avoid zero-quantity orders. But it means the multi-tranche system
is irrelevant for positions under ~3 contracts.

### Suggested Approach

For 1-lot positions, use the tightest available tranche trail_pct as the
initial trail from the start:
```python
# At trailing activation time:
if self.remaining_qty == 1 and tranches:
    # Use the smallest trail_pct from any tranche
    trail_pct = min(t.get("trail_pct", base_trail_pct) for t in tranches
                    if "trail_pct" in t)
```

This gives 1-lot positions the protection of the tightest trail without
needing the multi-step scale-out.

---

## 9. Finding M5: `_pending_lineage` Never Cleared After Consumption

**Severity:** MEDIUM — wrong lineage attached to position in edge case
**File:** `big_move_convexity.py` line 524

### The Mechanism

```python
# Signal fires -> sets _pending_lineage (around line 1282)
self._pending_lineage = {...}

# Fill arrives -> on_fill consumes it
if self._pending_lineage:
    risk_config["lineage"] = self._pending_lineage  # consumed but not cleared
```

If signal A fires, then signal B fires before signal A fills:
- `_pending_lineage` is overwritten with signal B's data (correct)
- Signal A fills -> attaches signal B's lineage (wrong)
- Signal B fills -> attaches signal B's lineage again (correct for B)

### Likelihood

Low — BMC has a per-ticker cooldown (activated in `on_fill`, line 450) and
a pending-order check that prevents firing a second signal while the first
is in-flight. But the cooldown activates on fill, not on signal fire. If
two signals fire in rapid succession (different tickers don't share cooldowns,
but same-ticker is gated), this could occur.

### Suggested Fix

Clear after consumption:
```python
if self._pending_lineage:
    risk_config["lineage"] = self._pending_lineage
    self._pending_lineage = None  # consumed
```

---

## 10. Finding L1: Dead Code — `_register_pending` Never Called

**Severity:** LOW — code quality / confusion risk
**File:** `risk_manager.py` lines 979-990

### The Observation

The method `_register_pending()` is defined but never called anywhere in the
codebase. All level state transitions are done inline in `_check_stop_loss`,
`_check_profit_targets`, `_check_trailing_stop`, and `_check_eod_closeout`.

The docstring says "We use a sentinel order_id of -1 until on_fill maps it",
suggesting this was an earlier design that was superseded by the
`on_order_placed()` pattern.

### Suggested Fix

Remove the dead method to avoid confusion.

---

## 11. Finding L2: `_active_orders` Can Leak in Long Sessions

**Severity:** LOW — theoretical memory leak
**File:** `execution_engine.py`

### The Mechanism

`_active_orders` entries are cleaned up in terminal states (Filled, Cancelled,
ApiCancelled, Inactive). But if an order enters a working state (Submitted,
PreSubmitted) and IB never sends another status update (e.g., network
partition, TWS restart without clean close), the entry persists.

The lifecycle sweep auto-cancels after 120s, but this requires IB to
acknowledge the cancel with an orderStatus callback. If the IB connection
is truly dead, no callback arrives.

### Mitigations Already Present

1. `STALE_ORDER_CANCEL_SEC = 120.0` triggers auto-cancel
2. Reconnect logic typically restarts the engine (clearing all state)
3. `engine.stop()` clears everything

### Impact

For a long-running session without restarts, `_active_orders` could accumulate
a few stale entries per day. Each entry is ~200 bytes. Not a practical concern
unless the agent runs for weeks without restart.

### Suggested Fix

In `_lifecycle_sweep`, if an order is stale AND the cancel attempt fails (e.g.,
IB not connected), remove it from `_active_orders` and call `on_order_dead`.

---

## 12. Finding L3: Position Store Writes on Every Mutation

**Severity:** LOW — performance concern on slow storage
**File:** `position_store.py`

### The Observation

`_save()` is called after every `add_fill`, `update_runtime_state`,
`mark_closed`, `update_entry`, `set_lineage`, `update_risk_config`, etc.
Each call serializes the entire position store to JSON and writes to disk
with an atomic rename + backup.

During active trading, `_persist_fill` is called from the eval loop for every
orderStatus update. A position with 10 status updates generates 10 full JSON
serializations + disk writes.

### Current Performance

On the droplet SSD, each write takes <1ms. With ~10 positions and ~50 fills
per day, this is negligible.

### Risk

If the position store grows large (hundreds of positions with fill logs), or
if the droplet is under disk I/O pressure, the writes could add latency to
the eval loop (since `_persist_fill` is called synchronously on the order-exec
thread, not the eval thread — this is actually safe).

### Suggested Fix (deferred)

Batch writes with a dirty flag and periodic flush (e.g., every 5s), rather than
write-on-every-mutation. Not urgent.

---

## 13. Finding L4: `eod_exit_time` Cannot Be Hot-Modified

**Severity:** LOW — feature gap
**File:** `risk_manager.py` line 1194

### The Observation

`eod_exit_time` is read from `config.get("eod_exit_time")` in the RM's
`evaluate()` method. It's set during `on_start()` via preset resolution
(the `intraday_convexity` preset includes `"eod_exit_time": "15:30"`).

However, `_risk_config` (the hot-modify snapshot) only captures `stop_loss`
and `profit_taking` (line 382-385). `eod_exit_time` is not in the snapshot,
so `update_risk_config()` can't modify it.

Additionally, `_translate_bmc_to_risk_config()` doesn't handle `eod_exit_time`
— there's no corresponding `_BMC_RISK_FIELDS` entry for it.

### Impact

Users cannot change the EOD close-out time on running positions. They must
stop/restart the engine with a new config. This is a minor inconvenience,
not a safety issue.

---

## 14. Finding L5: Float-to-Int Truncation in `on_fill`

**Severity:** LOW — theoretical precision issue
**File:** `risk_manager.py` line 536

### The Mechanism

```python
new_filled = fill_data.get("filled", 0.0) - pending.filled_so_far
...
self.remaining_qty = max(0, self.remaining_qty - int(new_filled))
```

IB reports `filled` as a float (e.g., `2.0`). For options, fills are always
integer contracts. But if floating-point arithmetic produces `0.9999999`
instead of `1.0`, `int(0.9999999) = 0`, and `remaining_qty` doesn't decrement.

### Likelihood

Very low — IB consistently sends exact integer values for option fills.
Python's float representation of small integers (1.0, 2.0, 3.0) is exact.

### Suggested Fix

Use `round()` before `int()`:
```python
self.remaining_qty = max(0, self.remaining_qty - int(round(new_filled)))
```

---

## 15. Finding L6: `_reconnect_hold` Has No Memory Barrier

**Severity:** LOW — theoretical data race, safe on x86
**File:** `execution_engine.py` line 590

### The Observation

`_reconnect_hold` is a plain `bool` attribute:
- Written by the async agent thread (via `set_reconnect_hold()`)
- Read by the eval thread (in `_evaluate_all()` at line 1099 and
  `_process_order_action()` at line 1279)

CPython's GIL makes individual attribute writes atomic. On x86 (the droplet's
architecture), strong memory ordering ensures the eval thread sees the update
promptly.

On ARM or with future Python implementations (no-GIL Python 3.13+), this
could be a data race.

### Suggested Fix (deferred)

Use `threading.Event` instead of a bare bool:
```python
self._reconnect_hold_event = threading.Event()
# set_reconnect_hold(True):  self._reconnect_hold_event.set()
# check:  if self._reconnect_hold_event.is_set(): ...
```

Not urgent given the current deployment target.

---

## 16. Positive Observations

The review also identified several well-designed aspects of the risk system:

**1. Exit orders bypass entry gates.** Gates 1-3 are correctly skipped for
`is_exit=True` orders. This ensures that risk manager exits (stops, trailing,
EOD) are never blocked by entry budget exhaustion, flip-flop detection, or
in-flight congestion. This is exactly right.

**2. Trailing stop is sticky.** Once `_trailing_active = True`, it never resets.
This prevents the "deactivation trap" where a trailing stop deactivates during
a pullback and the position loses protection.

**3. Budget refund on rejection.** The 3-layer refund (entry cap + ticker budget
+ `on_order_dead` re-arm) ensures that IB rejections don't silently drain budget.
This was a bug in v1.25.1 and is now well-handled.

**4. Pre-submit callback.** The `pre_submit_callback` pattern in
`_place_order_worker` registers `_order_strategy_map[order_id] = strategy_id`
BEFORE `placeOrder` sends to IB. This closes the race where IB fill callbacks
arrive before the future's done-callback.

**5. Reconnect hold.** The `_reconnect_hold` flag prevents the eval loop from
placing orders with a stale position view during reconnection. This is set
BEFORE `connect_to_ib()` and cleared AFTER reconciliation.

**6. Lot aggregation.** When BMC buys multiple contracts of the same option, they
are aggregated into a single risk manager via `add_lot()` rather than spawning
independent managers. This gives a single trailing stop for the aggregate
position.

**7. Level re-arm on rejection (for correctly-keyed levels).** For levels like
`stop_0`, `profit_0`, and `trailing`, the `on_order_dead` path correctly re-arms
the level up to `MAX_REJECTIONS_PER_LEVEL` (3). After 3 consecutive rejections,
the level is marked FAILED to prevent infinite retry loops.

**8. Thread safety model.** The eval thread reads quotes (no lock needed —
GIL-protected dict lookup). The order thread places orders (dedicated single-worker
executor). The IB thread writes quotes and enqueues events. The thread boundaries
are clean and well-documented.

---

## 17. Recommended Fix Priority

### Tier 1 — Fix Immediately (real money risk)

| ID | Description | Effort | Risk if Unfixed |
|----|-------------|--------|-----------------|
| H1 | `_parse_level_key` mismatch: stop_simple and eod_closeout can never re-fire after rejection | 1-2 hours | Stop loss and EOD exits permanently dead after a single IB rejection |
| H2 | Risk budget gate bypassed for MKT orders | 1 hour | Risk budget feature is non-functional |
| H3 | EOD close-out lifecycle (superset of H1 for eod) | 1 hour | 1DTE positions carry overnight after rejected EOD exit |

### Tier 2 — Fix Soon (suboptimal behavior)

| ID | Description | Effort | Risk if Unfixed |
|----|-------------|--------|-----------------|
| M1 | EOD vs trailing conflict: check for pending orders | 15 min | Over-sell in narrow timing window |
| M2 | Preset hot-modify doesn't resolve preset names | 30 min | User switches preset, nothing happens |
| M3 | Reconciliation qty mismatch not corrected | 1 hour | RM manages wrong qty, incorrect exit sizes |

### Tier 3 — Fix When Convenient

| ID | Description | Effort | Risk if Unfixed |
|----|-------------|--------|-----------------|
| M4 | 1-lot positions get wide initial trail | 30 min | Slightly less optimal exit on 1-lot |
| M5 | `_pending_lineage` not cleared | 5 min | Wrong lineage in rare rapid-fire scenario |
| L1 | Remove dead `_register_pending` method | 5 min | Code confusion |
| L2-L6 | Various minor defensive gaps | 1-2 hours total | Theoretical edge cases |

### Testing Strategy for Fixes

All fixes should include unit tests covering:
1. `_parse_level_key` roundtrip: `key -> parse -> reconstruct == key` for ALL level key formats
2. `on_order_dead` -> verify level is correctly re-armed in `_level_states`
3. `_collect_cancel_ids` -> verify pending order is found for all level types
4. EOD close-out: rejection -> re-fire on next tick
5. Risk budget gate: MKT order with estimated_notional > budget -> rejected
6. Hot-modify preset: verify RM config changes after preset switch

### Regression Risk

The H1 fix changes the PendingOrder storage format, which affects:
- `on_fill` (fill routing)
- `on_order_dead` (re-arm routing)
- `_collect_cancel_ids` (hot-modify cancellation)
- `get_strategy_state` (telemetry display)
- `_pending_orders` serialization (if any)

The PendingOrder is NOT serialized to the position store (`_pending_orders` is
cleared on restart), so there's no migration concern. But all code paths that
reconstruct the level key from PendingOrder fields must be updated together.
