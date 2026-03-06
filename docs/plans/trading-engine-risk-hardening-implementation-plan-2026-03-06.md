# Trading Engine Risk Hardening Implementation Plan

Date: March 6, 2026
Owner: Dev Agent Team Lead
Scope: `python-service/standalone_agent` execution + risk-manager path

## Goal

Close confirmed risk-control failures and establish a coherent, testable position model for aggregated lots and percent-based exits.

## Outcome Targets

1. No exit level can get stuck due to key-routing mismatch.
2. A newly filled position is never left unmanaged longer than one eval cycle due to RM spawn failure.
3. EOD close-out and trailing exits cannot issue overlapping sell intents on stale quantity.
4. Reconciliation can repair runtime quantity drift, not just report it.
5. Percent-based exits operate against a clearly defined quantity base.
6. The position cost basis remains mathematically correct when adding lots after partial exits.

## Canonical Position Semantics (Proposed Contract)

### 1) Unit of Management

A `ManagedPosition` is one risk manager per unique option contract key:
`symbol + strike + expiry + right`.

Aggregation rule: every new fill for the same contract key is merged into the same manager.

### 2) Quantity Fields

1. `remaining_qty` (authoritative): currently open contracts.
2. `entry_price`: weighted average cost basis of currently open contracts.
3. `lifetime_opened_qty`: monotonic total contracts ever added to this manager (telemetry/audit only).

### 3) Percent Exit Rule

All `exit_pct` settings apply to `remaining_qty` at trigger time.

Examples:
1. 10 open, `exit_pct=50` -> sell 5, remaining 5.
2. Remaining 5, next `exit_pct=50` -> sell 2 or 3 per rounding policy.

### 4) Add Lot After Partial Exit

When a new lot is added after exits, recompute `entry_price` from open inventory only:

`new_entry_price = ((old_entry_price * old_remaining_qty) + (new_lot_price * new_lot_qty)) / (old_remaining_qty + new_lot_qty)`

This replaces the current lifetime-based averaging behavior.

### 5) Level-State Policy on New Lot Additions

Policy for this hardening cut:
1. Keep stop protections continuous (never loosen active protection).
2. Do not silently reset consumed levels unless explicitly configured.
3. Add explicit metadata in telemetry for whether levels were inherited vs re-armed.

Follow-up decision (post-cut): optional `lot_addition_policy` mode for desk-level preference.

## Workstreams

## WS-A (P0): Canonical Exit Level Identity

Problem: level parse/reconstruct mismatch can strand stops/EOD and misroute fills.

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/risk_manager.py`

Implementation:
1. Add canonical `level_key` to `PendingOrder`.
2. Eliminate parse/reconstruct dependence in `on_fill`, `on_order_dead`, `_collect_cancel_ids`, telemetry.
3. Use one helper for key derivation to avoid duplicated format logic.
4. Remove dead `_register_pending` path.

Acceptance:
1. Rejected `stop_simple` re-arms and re-fires correctly.
2. Rejected `eod_closeout` re-arms and re-fires correctly.
3. Pending order cancellation matches all level types (`stop_simple`, `stop_n`, `profit_n`, `trailing`, `eod_closeout`).

## WS-B (P0): Position Semantics V2 (Aggregation + Cost Basis)

Problem: adding lots after partial exits can distort cost basis and make pnl-trigger math inconsistent.

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/risk_manager.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/ib_data_agent.py`
3. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/position_store.py`

Implementation:
1. Introduce `lifetime_opened_qty` (or equivalent) and stop using `initial_qty` for cost-basis math.
2. Update `add_lot()` to average against `remaining_qty`, not lifetime quantity.
3. Persist the new semantics in runtime snapshots and position store schema-compatible fields.
4. Keep backward-compatible read path for pre-change snapshots.

Acceptance:
1. Scenario: open 10 @ 1.0, exit 5, add 5 @ 2.0 -> `entry_price == 1.5`, `remaining_qty == 10`.
2. Percent exits continue to use current `remaining_qty`.
3. Restart/recovery preserves new cost basis and quantity invariants.

## WS-C (P0): RM Spawn Failure Fail-Safe

Problem: if RM spawn fails on entry fill, position can be unmanaged until reconciliation.

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/big_move_convexity.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/ib_data_agent.py`

Implementation:
1. Change spawn callback contract to return explicit success/failure payload.
2. On spawn failure:
   - emit high-severity event,
   - queue immediate targeted recovery attempt (same loop, not 60s later),
   - auto-halt new entries for that ticker until RM is confirmed active.
3. Add idempotent guard to prevent duplicate RMs during recovery retry.

Acceptance:
1. Forced spawn failure results in immediate protective action and no additional entries.
2. Recovery path creates one RM and clears halt state.

## WS-D (P0): EOD vs In-Flight Exit Coordination

Problem: EOD close-out can fire while trailing exit is still pending.

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/risk_manager.py`

Implementation:
1. Add pending-order guard to `_check_eod_closeout()`.
2. Integrate `eod_closeout` in startup/runtime state consistently.
3. Preserve retry behavior on rejection.

Acceptance:
1. If trailing order is pending at EOD boundary, EOD waits.
2. After pending order resolves, EOD check re-evaluates using latest `remaining_qty`.

## WS-E (P0): Reconciliation Quantity Repair

Problem: reconciliation reports drift but does not fix runtime manager quantity.

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/execution_engine.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/ib_data_agent.py`

Implementation:
1. Add guarded auto-repair for `remaining_qty` mismatch.
2. Persist repaired runtime state immediately.
3. Emit reconciliation adjustment event with before/after qty.
4. Keep no-repair mode as fallback toggle for rollout safety.

Acceptance:
1. Manual partial close in TWS updates RM quantity on next reconciliation.
2. Subsequent exits size from repaired quantity.

## WS-F (P1): Hot-Modify Preset + EOD Time Fidelity

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/risk_manager.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/ib_data_agent.py`

Implementation:
1. Resolve `preset` during `update_risk_config()`.
2. Add `eod_exit_time` to translatable hot-modify fields and RM risk snapshot.
3. Persist hot-modify outcome to both config and runtime snapshots.

Acceptance:
1. Preset switch changes active thresholds/levels for running positions.
2. `eod_exit_time` can be changed live and takes effect without restart.

## WS-G (P1): Risk Budget Gate Completeness

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/execution_engine.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/big_move_convexity.py`

Implementation:
1. Add explicit estimated-notional field on `OrderAction` for entry orders.
2. Gate 1c uses explicit notional for market-like orders when `limit_price` unavailable.
3. Keep current limit-price path unchanged.

Acceptance:
1. Budget rejects oversized entries for both limit and market-style actions.

## WS-H (P2): Attribution and Lifecycle Hygiene

Files:
1. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/strategies/big_move_convexity.py`
2. `/Users/donross/dev/ma-tracker-app/python-service/standalone_agent/execution_engine.py`

Implementation:
1. Consume and clear `_pending_lineage` after fill attribution.
2. Add stale active-order garbage collection fallback when cancel cannot be delivered.

## Test Plan

Add/extend tests under `/Users/donross/dev/ma-tracker-app/python-service/tests`:

1. `test_risk_level_key_identity.py`
   - roundtrip and dead-order re-arm for all level types.
2. `test_position_semantics_v2.py`
   - add-lot-after-partial-exit cost basis and qty invariants.
3. `test_eod_trailing_coordination.py`
   - no overlapping EOD/trailing actions with pending orders.
4. `test_reconciliation_qty_repair.py`
   - mismatch detected and repaired path.
5. `test_risk_hot_modify_preset_eod.py`
   - live preset/eod updates on running managers.
6. `test_entry_spawn_failsafe.py`
   - RM spawn failure triggers halt + targeted recovery.

## Rollout Plan

### Phase 1 (P0 bundle)

1. WS-A, WS-B, WS-C, WS-D, WS-E.
2. Enable guarded reconciliation auto-repair in paper first.
3. Run focused live-paper burn-in for one full session.

### Phase 2 (P1 bundle)

1. WS-F, WS-G.
2. Validate with production-like config updates and budget scenarios.

### Phase 3 (P2 bundle)

1. WS-H cleanup.

## Operational Gates

Pre-merge gates:
1. New test files pass.
2. Existing risk hot-modify and ticker-mode tests remain green.
3. Manual scenario checks completed in paper account:
   - simple stop reject/retry,
   - EOD reject/retry,
   - partial manual exit + reconciliation repair,
   - add lot after partial exits.

Production gates:
1. No unmanaged fill alerts over 1 session.
2. No duplicated RM per contract key.
3. No negative `remaining_qty` events.

## Open Decisions for Team Lead Sign-Off

1. Should adding a lot after consumed profit levels re-arm those levels by default?
2. Should trailing tranche index reset when size increases, or remain sticky?
3. Should reconciliation auto-repair be always-on after soak, or operator-toggle only?

Recommended defaults for this cut:
1. Keep consumed levels sticky (no silent reset).
2. Keep trailing tranche sticky (no widening of protection).
3. Ship auto-repair behind a temporary toggle, then make default-on after burn-in.
