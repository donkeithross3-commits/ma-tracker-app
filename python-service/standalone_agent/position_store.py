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
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class PositionStore:
    """Thread-safe JSON position store with atomic writes."""

    def __init__(self, path: Optional[str] = None):
        if path is None:
            # Default: position_store.json next to this file
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "position_store.json")
        self._path = path
        self._bak_path = path + ".bak"
        self._lock = threading.Lock()
        self._positions: Dict[str, dict] = {}  # id -> position record
        self._dirty_ids: set = set()  # position IDs needing sync to server
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
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: add_fill for unknown position %s", position_id)
                return
            pos["fill_log"].append(fill_dict)
            self._dirty_ids.add(position_id)
            self._save()

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
            for fill in reversed(pos.get("fill_log", [])):
                if fill.get("order_id") == order_id and not fill.get("exec_id"):
                    fill["exec_id"] = exec_id
                    self._dirty_ids.add(position_id)
                    self._save()
                    return True
            return False

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

    def update_fill_post_trade(
        self, position_id: str, order_id: int, delay_seconds: int, post_fill_data: dict,
    ) -> None:
        """Update a fill's execution_analytics with post-fill quote data.

        Phase 0 instrumentation: adds mid/bid/ask at +Ns after fill for
        adverse selection measurement.
        """
        with self._lock:
            pos = self._positions.get(position_id)
            if not pos:
                return
            for fill in pos.get("fill_log", []):
                if fill.get("order_id") == order_id:
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
                    self._dirty_ids.add(position_id)
                    break
            self._save()

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

    def mark_all_dirty(self) -> None:
        """Mark every position as dirty (used on startup for full sync)."""
        with self._lock:
            self._dirty_ids = set(self._positions.keys())
            logger.info("PositionStore: marked all %d positions dirty for sync", len(self._dirty_ids))

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
