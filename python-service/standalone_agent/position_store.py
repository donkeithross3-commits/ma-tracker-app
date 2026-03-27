#!/usr/bin/env python3
"""
Position Store
==============
JSON-based persistence for risk manager positions. Survives engine restarts
so risk managers can be reconstructed with full state (HWM, trailing stops,
level states, fill logs).

Single flat JSON file — human-readable, write-on-mutate with atomic writes
and .bak backup. Thread-safe via threading.Lock.

File: standalone_agent/position_store.json (next to this module)
Backup: standalone_agent/position_store.json.bak
"""

import json
import logging
import os
import shutil
import threading
import time
import copy
from pathlib import Path
from typing import Dict, List, Optional

try:
    from .execution_ledger import ExecutionLedgerStore
except ImportError:  # pragma: no cover - supports direct script imports in tests
    from execution_ledger import ExecutionLedgerStore

logger = logging.getLogger(__name__)


class PositionStore:
    """Thread-safe JSON position store with atomic writes."""

    def __init__(self, path: Optional[str] = None):
        if path is None:
            # Default: position_store.json next to this file
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "position_store.json")
        self._path = path
        self._bak_path = path + ".bak"
        suffix = Path(path).suffix
        if suffix:
            ledger_path = str(Path(path).with_suffix(".ledger.json"))
        else:
            ledger_path = path + ".ledger.json"
        self._lock = threading.Lock()
        self._positions: Dict[str, dict] = {}  # id -> position record
        self._dirty_ids: set = set()  # position IDs needing sync to server
        self._execution_ledger = ExecutionLedgerStore(ledger_path)
        self._load()

    # ── Public API ──

    def add_position(
        self,
        position_id: str,
        entry: dict,
        instrument: dict,
        risk_config: dict,
        parent_strategy: str = "",
    ) -> None:
        """Add a new active position to the store."""
        with self._lock:
            if position_id in self._positions:
                logger.warning("Position %s already exists in store, skipping add", position_id)
                return
            now = time.time()
            record = {
                "id": position_id,
                "status": "active",
                "strategy_type": "risk_manager",
                "parent_strategy": parent_strategy,
                "created_at": now,
                "closed_at": None,
                "entry": entry,
                "instrument": instrument,
                "risk_config": risk_config,
                "runtime_state": {},
                "fill_log": [],
            }
            self._positions[position_id] = record
            self._dirty_ids.add(position_id)
            self._save()
        logger.info("PositionStore: added position %s (%s)", position_id, parent_strategy)

    def update_runtime_state(self, position_id: str, state_dict: dict) -> None:
        """Update the runtime_state for a position (HWM, trailing, level_states, etc.)."""
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: update_runtime_state for unknown position %s", position_id)
                return
            pos["runtime_state"] = state_dict
            self._save()

    def add_fill(self, position_id: str, fill_dict: dict) -> None:
        """Append a fill entry to the position's fill_log."""
        inserted = False
        instrument = {}
        parent_strategy = position_id
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: add_fill for unknown position %s", position_id)
                return
            instrument = dict(pos.get("instrument", {}) or {})
            parent_strategy = pos.get("parent_strategy") or position_id
            fill_log = pos.setdefault("fill_log", [])
            if fill_log and self._is_probable_duplicate_fill(fill_log[-1], fill_dict):
                logger.warning(
                    "PositionStore: suppressing probable duplicate fill on %s "
                    "(level=%s order_id=%s qty=%s price=%.4f)",
                    position_id,
                    fill_dict.get("level"),
                    fill_dict.get("order_id"),
                    fill_dict.get("qty_filled"),
                    float(fill_dict.get("avg_price", 0.0) or 0.0),
                )
                return
            fill_log.append(fill_dict)
            self._dirty_ids.add(position_id)
            self._save()
            inserted = True
        if inserted:
            self._execution_ledger.record_fill(
                position_id=position_id,
                strategy_id=parent_strategy,
                instrument=instrument,
                fill_dict=fill_dict,
            )

    def mark_closed(self, position_id: str, exit_reason: str = "") -> None:
        """Mark a position as closed with optional exit reason."""
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: mark_closed for unknown position %s", position_id)
                return
            pos["status"] = "closed"
            pos["closed_at"] = time.time()
            if exit_reason:
                pos["exit_reason"] = exit_reason
            self._dirty_ids.add(position_id)
            self._save()
        logger.info("PositionStore: marked position %s as closed (reason=%s)", position_id, exit_reason or "unspecified")

    def get_active_positions(self) -> List[dict]:
        """Return all positions with status == 'active'."""
        with self._lock:
            return [p for p in self._positions.values() if p.get("status") == "active"]

    def get_all_positions(self) -> List[dict]:
        """Return all positions (active + closed) for P&L reporting."""
        with self._lock:
            return list(self._positions.values())

    def get_position(self, position_id: str) -> Optional[dict]:
        """Return a single position by ID, or None."""
        with self._lock:
            return self._positions.get(position_id)

    def set_lineage(self, position_id: str, lineage: dict) -> None:
        """Attach model lineage (model version, signal, config snapshot) to a position."""
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: set_lineage for unknown position %s", position_id)
                return
            pos["lineage"] = lineage
            self._dirty_ids.add(position_id)
            self._save()

    def update_entry(self, position_id: str, entry_updates: dict) -> None:
        """Merge updates into a position's entry dict (e.g. aggregated qty/price).

        Used when adding lots to an aggregate risk manager — the entry
        reflects the current aggregate (total qty, weighted avg price).
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: update_entry for unknown position %s", position_id)
                return
            pos.setdefault("entry", {}).update(entry_updates)
            self._dirty_ids.add(position_id)
            self._save()

    @staticmethod
    def _deep_merge(base: dict, override: dict) -> dict:
        """Recursively merge *override* into *base*, preserving nested keys."""
        result = dict(base)
        for k, v in override.items():
            if isinstance(v, dict) and isinstance(result.get(k), dict):
                result[k] = PositionStore._deep_merge(result[k], v)
            else:
                result[k] = v
        return result

    @staticmethod
    def _coerce_int(value, default: int = 0) -> int:
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return int(default)

    @staticmethod
    def _coerce_float(value, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)

    @classmethod
    def _parse_fill_time(cls, value) -> float:
        return ExecutionLedgerStore._parse_fill_time(value)

    @staticmethod
    def _fills_share_logical_identity(first: dict, second: dict) -> bool:
        if not first or not second:
            return False
        if first.get("level") != second.get("level"):
            return False

        def _num(value, default=0.0) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return float(default)

        def _int(value, default=0) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return int(default)

        same_core = (
            _int(first.get("qty_filled")) == _int(second.get("qty_filled")) and
            abs(_num(first.get("avg_price")) - _num(second.get("avg_price"))) < 1e-9 and
            _int(first.get("remaining_qty")) == _int(second.get("remaining_qty")) and
            abs(_num(first.get("pnl_pct")) - _num(second.get("pnl_pct"))) < 1e-9
        )
        if not same_core:
            return False

        first_time = _num(first.get("time", first.get("fill_time")))
        second_time = _num(second.get("time", second.get("fill_time")))
        return abs(first_time - second_time) <= 2.0

    @staticmethod
    def _is_probable_duplicate_fill(existing: dict, candidate: dict) -> bool:
        """Heuristic dedupe for back-to-back identical logical fills.

        This catches cases where a recovered risk manager shares the same
        fill_log list object as the position store and a real fill is written
        once by the strategy and then persisted again from orderStatus.
        """
        if not existing or not candidate:
            return False

        if not PositionStore._fills_share_logical_identity(existing, candidate):
            return False

        existing_order = PositionStore._coerce_int(existing.get("order_id"))
        candidate_order = PositionStore._coerce_int(candidate.get("order_id"))
        order_equivalent = (
            existing_order == candidate_order or
            existing_order == 0 or
            candidate_order == 0
        )
        if not order_equivalent:
            return False

        return True

    @classmethod
    def _merge_fill_for_ledger(cls, fills: List[dict], fill: dict) -> tuple[dict, bool]:
        """Merge analytics from orderless duplicate companions into a backfill fill.

        Historical position stores can contain a real fill keyed by order_id and a
        near-identical order_id=0 companion carrying the only surviving analytics.
        Replaying the merge here preserves whatever venue metadata we have without
        inventing broker truth.
        """
        merged = copy.deepcopy(fill)
        merged_analytics = dict(merged.get("execution_analytics") or {})
        merged["execution_analytics"] = merged_analytics
        merged_from_companion = False

        for candidate in fills:
            if candidate is fill:
                continue
            if not cls._fills_share_logical_identity(fill, candidate):
                continue
            if cls._coerce_int(candidate.get("order_id")) > 0 or candidate.get("exec_id"):
                continue
            candidate_analytics = dict(candidate.get("execution_analytics") or {})
            if not candidate_analytics:
                continue
            for key, value in candidate_analytics.items():
                merged_analytics.setdefault(key, value)
            if candidate.get("exec_id") and not merged.get("exec_id"):
                merged["exec_id"] = candidate.get("exec_id")
            merged_from_companion = True

        if merged_analytics:
            merged["execution_analytics"] = merged_analytics
        elif "execution_analytics" in merged:
            merged.pop("execution_analytics", None)
        return merged, merged_from_companion

    @classmethod
    def _fill_match_score(
        cls,
        fill: dict,
        *,
        match_hint: Optional[dict],
        prefer_unresolved_exec: bool,
    ) -> tuple:
        score = 0
        hint = match_hint or {}
        hint_exec_id = str(hint.get("exec_id") or "")
        fill_exec_id = str(fill.get("exec_id") or "")
        if hint_exec_id:
            if fill_exec_id == hint_exec_id:
                score += 10_000
            elif fill_exec_id:
                score -= 10_000

        unresolved = not bool(fill_exec_id)
        if prefer_unresolved_exec and unresolved:
            score += 1000
        elif prefer_unresolved_exec and not unresolved:
            score -= 1000

        analytics = dict(fill.get("execution_analytics") or {})
        fill_perm_id = (
            fill.get("perm_id")
            or fill.get("permId")
            or analytics.get("perm_id")
        )
        hint_perm_id = hint.get("perm_id")
        if hint_perm_id is not None:
            if cls._coerce_int(fill_perm_id) and cls._coerce_int(fill_perm_id) == cls._coerce_int(hint_perm_id):
                score += 500
            elif cls._coerce_int(fill_perm_id):
                score -= 100

        hint_side = str(hint.get("side") or "").upper()
        if hint_side:
            fill_side = str(
                analytics.get("side")
                or ("BOT" if fill.get("level") == "entry" else "SLD")
            ).upper()
            if fill_side == hint_side:
                score += 50
            else:
                score -= 25

        hint_qty = hint.get("qty_filled")
        if hint_qty is not None and cls._coerce_int(fill.get("qty_filled")) == cls._coerce_int(hint_qty):
            score += 100

        hint_price = hint.get("avg_price")
        if hint_price is not None:
            price_delta = abs(
                cls._coerce_float(fill.get("avg_price"))
                - cls._coerce_float(hint_price)
            )
            if price_delta < 1e-9:
                score += 25
            else:
                score -= min(int(price_delta * 1000), 25)

        hint_time = hint.get("fill_time")
        if hint_time is not None:
            delta_sec = abs(
                cls._coerce_float(fill.get("time"))
                - cls._parse_fill_time(hint_time)
            )
            score -= min(int(delta_sec * 10.0), 250)

        return (
            score,
            1 if unresolved else 0,
        )

    @classmethod
    def _find_fill_index_locked(
        cls,
        fills: List[dict],
        *,
        order_id: int,
        exec_id: str = "",
        match_hint: Optional[dict] = None,
        prefer_unresolved_exec: bool = False,
    ) -> Optional[int]:
        hinted_exec_id = str((match_hint or {}).get("exec_id") or "")
        target_exec_id = exec_id or hinted_exec_id
        if target_exec_id:
            for idx, fill in enumerate(fills):
                if fill.get("exec_id") == target_exec_id:
                    return idx

        candidates = []
        for idx, fill in enumerate(fills):
            if cls._coerce_int(fill.get("order_id")) != cls._coerce_int(order_id):
                continue
            score = cls._fill_match_score(
                fill,
                match_hint=match_hint,
                prefer_unresolved_exec=prefer_unresolved_exec,
            )
            candidates.append((
                score,
                cls._coerce_float(fill.get("time")),
                idx,
            ))
        if not candidates:
            return None
        candidates.sort()
        return candidates[-1][2]

    def update_risk_config(self, position_id: str, risk_updates: dict) -> None:
        """Merge risk config updates into stored position.

        Used by hot-modify to persist config changes to running risk managers.
        Deep recursive merge preserves nested fields like exit_tranches
        that may not be present in the update dict.
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return
            rc = pos.get("risk_config", {})
            pos["risk_config"] = self._deep_merge(rc, risk_updates)
            self._dirty_ids.add(position_id)
            self._save()
        logger.info("PositionStore: updated risk_config for %s (keys=%s)", position_id, list(risk_updates.keys()))

    def update_fill_exec_id(self, position_id: str, order_id: int, exec_id: str) -> bool:
        """Retroactively set exec_id on a fill matched by order_id.

        Called when execDetails arrives (which has execId) after orderStatus
        already persisted the fill with exec_id="".  Returns True if a fill
        was updated.
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return False
            fill_log = pos.get("fill_log", [])
            fill_index = self._find_fill_index_locked(
                fill_log,
                order_id=order_id,
                exec_id=exec_id,
                prefer_unresolved_exec=True,
            )
            if fill_index is not None:
                fill = fill_log[fill_index]
                if not fill.get("exec_id"):
                    fill["exec_id"] = exec_id
                    self._dirty_ids.add(position_id)
                    self._save()
                    return True
            return False

    def update_fill_execution_details(
        self,
        position_id: str,
        order_id: int,
        *,
        exec_id: str = "",
        execution_analytics: Optional[dict] = None,
        match_hint: Optional[dict] = None,
    ) -> bool:
        """Merge execution metadata into a fill matched by order_id.

        Used when execDetails arrives after the initial fill record was created.
        Returns True if a fill was updated.
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return False
            instrument = dict(pos.get("instrument", {}) or {})
            fill_log = pos.get("fill_log", [])
            fill_index = self._find_fill_index_locked(
                fill_log,
                order_id=order_id,
                exec_id=exec_id,
                match_hint=match_hint,
                prefer_unresolved_exec=True,
            )
            if fill_index is None:
                return False
            fill = fill_log[fill_index]
            if exec_id and not fill.get("exec_id"):
                fill["exec_id"] = exec_id
            if execution_analytics:
                normalized_analytics = dict(execution_analytics)
                if normalized_analytics.get("exchange") and not normalized_analytics.get("fill_exchange"):
                    normalized_analytics["fill_exchange"] = normalized_analytics["exchange"]
                fill.setdefault("execution_analytics", {}).update(normalized_analytics)
            resolved_match_hint = {
                **(match_hint or {}),
                "exec_id": exec_id or fill.get("exec_id", ""),
                "fill_time": fill.get("time"),
                "qty_filled": fill.get("qty_filled"),
                "avg_price": fill.get("avg_price"),
                "perm_id": (
                    (execution_analytics or {}).get("perm_id")
                    or fill.get("perm_id")
                    or fill.get("permId")
                    or (fill.get("execution_analytics", {}) or {}).get("perm_id")
                ),
                "side": (
                    (execution_analytics or {}).get("side")
                    or ((fill.get("execution_analytics", {}) or {}).get("side"))
                    or ("BOT" if fill.get("level") == "entry" else "SLD")
                ),
            }
            self._dirty_ids.add(position_id)
            self._save()
            self._execution_ledger.update_execution_details(
                position_id=position_id,
                order_id=order_id,
                exec_id=exec_id,
                execution_analytics={
                    **(normalized_analytics if execution_analytics else {}),
                    "perm_id": resolved_match_hint["perm_id"],
                },
                match_hint=resolved_match_hint,
            )
            if exec_id:
                self._execution_ledger.record_fill(
                    position_id=position_id,
                    strategy_id=pos.get("parent_strategy") or position_id,
                    instrument=instrument,
                    fill_dict=fill,
                )
            return True

    def purge_phantom_entry_fills(self) -> int:
        """Remove fill_log entries that are reconciliation-spawn artifacts.

        Phantom entry fills are identified by ALL of:
          - level == "entry"
          - order_id == 0  (no real IB order was placed)
          - position has no lineage (reconciliation spawns lack model lineage)

        Real IB-filled entries always have a positive order_id assigned by TWS
        and a lineage dict set by BigMoveConvexityStrategy.on_fill(). Positions
        spawned by _spawn_missing_risk_managers have neither.

        Returns the count of positions where phantom fills were removed.
        Dirty-marks affected positions so the server receives the cleaned fill_log.
        """
        cleaned = 0
        with self._lock:
            for pos in self._positions.values():
                if pos.get("lineage"):
                    continue  # real position with model lineage — skip
                fill_log = pos.get("fill_log", [])
                before = len(fill_log)
                pos["fill_log"] = [
                    f for f in fill_log
                    if not (f.get("level") == "entry" and f.get("order_id", -1) == 0)
                ]
                if len(pos["fill_log"]) < before:
                    self._dirty_ids.add(pos["id"])
                    cleaned += 1
            if cleaned:
                self._save()
        if cleaned:
            logger.info(
                "PositionStore: purged phantom entry fills from %d position(s)", cleaned
            )
        return cleaned

    def update_fill_commission(self, position_id: str, exec_id: str, commission_report: dict) -> None:
        """Update a fill's execution_analytics with commission data from IB."""
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return
            for fill in pos.get("fill_log", []):
                if fill.get("exec_id") == exec_id:
                    if "execution_analytics" not in fill:
                        fill["execution_analytics"] = {}
                    fill["execution_analytics"]["commission"] = commission_report.get("commission")
                    fill["execution_analytics"]["realized_pnl_ib"] = commission_report.get("realized_pnl")
                    self._dirty_ids.add(position_id)
                    break
            self._save()
        self._execution_ledger.update_commission(exec_id, commission_report)

    def update_fill_post_trade(
        self,
        position_id: str,
        order_id: int,
        delay_seconds: int,
        post_fill_data: dict,
        match_hint: Optional[dict] = None,
    ) -> None:
        """Update a fill's execution_analytics with post-fill quote data.

        Phase 0 instrumentation: adds mid/bid/ask at +Ns after fill for
        adverse selection measurement.
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return
            fill_log = pos.get("fill_log", [])
            fill_index = self._find_fill_index_locked(
                fill_log,
                order_id=order_id,
                match_hint=match_hint,
            )
            if fill_index is not None:
                fill = fill_log[fill_index]
                if "execution_analytics" not in fill:
                    fill["execution_analytics"] = {}
                if "post_fill" not in fill["execution_analytics"]:
                    fill["execution_analytics"]["post_fill"] = {}
                # Merge in the latest capture
                fill["execution_analytics"]["post_fill"].update({
                    k: v for k, v in post_fill_data.items()
                    if k.endswith(f"_{delay_seconds}s")
                })
                # Compute adverse selection at 30s mark
                if delay_seconds == 30:
                    mid_30 = post_fill_data.get("mid_30s")
                    avg_price = fill.get("avg_price", 0)
                    if mid_30 is not None and avg_price > 0:
                        fill["execution_analytics"]["post_fill"]["adverse_selection_30s"] = (
                            round(mid_30 - avg_price, 6)
                        )
                match_hint = {
                    **(match_hint or {}),
                    "exec_id": fill.get("exec_id", ""),
                    "fill_time": fill.get("time"),
                    "qty_filled": fill.get("qty_filled"),
                    "avg_price": fill.get("avg_price"),
                    "perm_id": (
                        fill.get("perm_id")
                        or fill.get("permId")
                        or (fill.get("execution_analytics", {}) or {}).get("perm_id")
                    ),
                }
                self._dirty_ids.add(position_id)
            self._save()
        self._execution_ledger.update_post_fill(
            position_id=position_id,
            order_id=order_id,
            delay_seconds=delay_seconds,
            post_fill_data=post_fill_data,
            match_hint=match_hint,
        )

    # ── Sync / Dirty Tracking ──

    def drain_dirty(self) -> List[dict]:
        """Return position dicts for all dirty IDs and clear the dirty set.

        Thread-safe. Called by the agent heartbeat loop to push changes to the server.
        """
        with self._lock:
            if not self._dirty_ids:
                return []
            dirty = []
            for pid in self._dirty_ids:
                pos = self._positions.get(pid)
                if pos is not None:
                    dirty.append(pos.copy())
            self._dirty_ids.clear()
            return dirty

    def drain_dirty_executions(self) -> List[dict]:
        """Return dirty canonical execution records and clear their dirty set."""
        return self._execution_ledger.drain_dirty_executions()

    def drain_dirty_exit_reservations(self) -> List[dict]:
        """Return dirty exit reservations and clear their dirty set."""
        return self._execution_ledger.drain_dirty_reservations()

    def mark_all_dirty(self) -> None:
        """Mark every position as dirty (used on startup for full sync)."""
        with self._lock:
            self._dirty_ids = set(self._positions.keys())
            logger.info("PositionStore: marked all %d positions dirty for sync", len(self._dirty_ids))
        self._execution_ledger.mark_all_dirty()

    # ── Canonical execution ledger wrappers ──

    def get_canonical_executions(self, position_id: Optional[str] = None) -> List[dict]:
        if position_id:
            return self._execution_ledger.get_position_executions(position_id)
        return self._execution_ledger.get_all_executions()

    def summarize_canonical_position(self, position_id: str, *, multiplier: int = 100) -> dict:
        return self._execution_ledger.summarize_position(position_id, multiplier=multiplier)

    def ingest_ib_execution_batch(self, executions: List[dict]) -> dict:
        return self._execution_ledger.ingest_ib_execution_batch(
            executions,
            resolve_position_id=self._resolve_position_id_from_execution,
        )

    def rebuild_execution_ledger(
        self,
        *,
        position_ids: Optional[List[str]] = None,
        since: Optional[float] = None,
    ) -> dict:
        """Replay fill_log history into the canonical execution ledger.

        This is primarily for archive recovery on older position stores that
        predate the ledger sidecar. Only fills with a durable identity
        (`order_id > 0` or `exec_id`) are replayed into the canonical ledger.
        Orderless companions are merged in only to salvage surviving analytics.
        """
        position_filter = set(position_ids or [])
        since_ts = self._parse_fill_time(since) if since is not None else None

        with self._lock:
            snapshots = []
            for pos in self._positions.values():
                if position_filter and pos.get("id") not in position_filter:
                    continue
                snapshots.append({
                    "id": pos.get("id"),
                    "parent_strategy": pos.get("parent_strategy") or pos.get("id"),
                    "instrument": copy.deepcopy(pos.get("instrument", {}) or {}),
                    "fills": copy.deepcopy(pos.get("fill_log", []) or []),
                })

        positions_considered = len(snapshots)
        fills_considered = 0
        replayed = 0
        skipped_missing_identity = 0
        merged_orderless_analytics = 0

        for pos in snapshots:
            fills = pos["fills"]
            for fill in fills:
                fill_time = self._parse_fill_time(
                    fill.get("time", fill.get("fill_time"))
                )
                if since_ts is not None and fill_time < since_ts:
                    continue
                fills_considered += 1
                if self._coerce_int(fill.get("order_id")) <= 0 and not fill.get("exec_id"):
                    skipped_missing_identity += 1
                    continue
                merged_fill, merged = self._merge_fill_for_ledger(fills, fill)
                if merged:
                    merged_orderless_analytics += 1
                record_key = self._execution_ledger.record_fill(
                    position_id=pos["id"] or "",
                    strategy_id=pos["parent_strategy"] or pos["id"] or "",
                    instrument=pos["instrument"],
                    fill_dict=merged_fill,
                    source="position_store_backfill",
                )
                if record_key:
                    replayed += 1

        return {
            "positions_considered": positions_considered,
            "fills_considered": fills_considered,
            "replayed": replayed,
            "skipped_missing_identity": skipped_missing_identity,
            "merged_orderless_analytics": merged_orderless_analytics,
        }

    def create_exit_reservation(
        self,
        *,
        reservation_id: str,
        strategy_id: str,
        contract_key: tuple,
        reserved_qty: int,
        source: str,
        order_id: int = 0,
        perm_id: int = 0,
        status: str = "pending_submit",
        created_at: Optional[float] = None,
        updated_at: Optional[float] = None,
    ) -> Optional[str]:
        now = time.time()
        return self._execution_ledger.upsert_reservation({
            "reservation_id": reservation_id,
            "strategy_id": strategy_id,
            "contract_key": ExecutionLedgerStore.format_contract_key(contract_key),
            "reserved_qty": int(max(0, reserved_qty)),
            "order_id": int(order_id or 0),
            "perm_id": int(perm_id or 0),
            "source": source,
            "status": status,
            "active": int(max(0, reserved_qty)) > 0,
            "created_at": created_at if created_at is not None else now,
            "updated_at": updated_at if updated_at is not None else now,
        })

    def bind_exit_reservation(self, reservation_id: str, *, order_id: int, perm_id: int = 0) -> bool:
        return self._execution_ledger.bind_reservation(
            reservation_id,
            order_id=order_id,
            perm_id=perm_id,
        )

    def sync_exit_reservation(
        self,
        *,
        order_id: int,
        remaining: Optional[float],
        status: str,
        perm_id: int = 0,
    ) -> bool:
        return self._execution_ledger.sync_reservation(
            order_id=order_id,
            remaining=remaining,
            status=status,
            perm_id=perm_id,
        )

    def release_exit_reservation(
        self,
        *,
        reservation_id: str = "",
        order_id: int = 0,
        strategy_id: str = "",
        release_reason: str = "released",
    ) -> int:
        return self._execution_ledger.release_reservation(
            reservation_id=reservation_id,
            order_id=order_id,
            strategy_id=strategy_id,
            release_reason=release_reason,
        )

    def get_active_exit_reservations(self) -> List[dict]:
        return self._execution_ledger.get_active_reservations()

    # ── Internal ──

    def _load(self) -> None:
        """Read positions from disk. Corrupt/missing file → start empty."""
        if not os.path.exists(self._path):
            logger.info("PositionStore: no file at %s, starting empty", self._path)
            self._positions = {}
            return
        try:
            with open(self._path, "r") as f:
                data = json.load(f)
            if isinstance(data, list):
                self._positions = {p["id"]: p for p in data if "id" in p}
            elif isinstance(data, dict):
                # Support both list and dict formats
                self._positions = data
            else:
                logger.warning("PositionStore: unexpected data format, starting empty")
                self._positions = {}
            logger.info(
                "PositionStore: loaded %d positions (%d active) from %s",
                len(self._positions),
                sum(1 for p in self._positions.values() if p.get("status") == "active"),
                self._path,
            )
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.error("PositionStore: corrupt file %s (%s) — trying .bak", self._path, e)
            if os.path.exists(self._bak_path):
                try:
                    with open(self._bak_path, "r") as f:
                        data = json.load(f)
                    if isinstance(data, list):
                        self._positions = {p["id"]: p for p in data if "id" in p}
                    elif isinstance(data, dict):
                        self._positions = data
                    else:
                        self._positions = {}
                    logger.warning("PositionStore: recovered %d positions from .bak", len(self._positions))
                    self._save()  # overwrite corrupt primary with good backup
                    return
                except Exception as bak_err:
                    logger.error("PositionStore: .bak recovery also failed: %s", bak_err)
            self._positions = {}

    def _save(self) -> None:
        """Atomic write: write to .tmp, backup existing to .bak, rename .tmp → .json.

        Must be called while holding self._lock.
        """
        tmp_path = self._path + ".tmp"
        try:
            # Write to temp file
            data = list(self._positions.values())
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)

            # Backup existing file
            if os.path.exists(self._path):
                shutil.copy2(self._path, self._bak_path)

            # Atomic rename
            os.replace(tmp_path, self._path)
        except Exception as e:
            logger.error("PositionStore: save failed: %s", e)
            # Clean up temp file if it exists
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass

    # ── Canonical ledger resolution helpers ──

    def _resolve_position_id_from_execution(self, contract: dict, execution: dict) -> Optional[str]:
        exec_id = str(execution.get("execId") or "")
        order_id = int(execution.get("orderId") or 0)
        contract_key = ExecutionLedgerStore.normalize_contract_key(contract)

        with self._lock:
            matches: List[dict] = []
            for pos in self._positions.values():
                if ExecutionLedgerStore.normalize_contract_key(pos.get("instrument", {})) != contract_key:
                    continue
                entry = pos.get("entry", {}) or {}
                if exec_id and entry.get("exec_id") == exec_id:
                    return pos["id"]
                if order_id and int(entry.get("order_id") or 0) == order_id:
                    return pos["id"]
                for fill in pos.get("fill_log", []):
                    if exec_id and fill.get("exec_id") == exec_id:
                        return pos["id"]
                    if order_id and int(fill.get("order_id") or 0) == order_id:
                        return pos["id"]
                matches.append(pos)
            active_matches = [pos for pos in matches if pos.get("status") == "active"]
            if len(active_matches) == 1:
                return active_matches[0]["id"]
            if len(matches) == 1:
                return matches[0]["id"]
        return None
