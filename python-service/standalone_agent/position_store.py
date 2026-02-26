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
            self._save()

    def mark_closed(self, position_id: str) -> None:
        """Mark a position as closed."""
        with self._lock:
            pos = self._positions.get(position_id)
            if pos is None:
                logger.warning("PositionStore: mark_closed for unknown position %s", position_id)
                return
            pos["status"] = "closed"
            pos["closed_at"] = time.time()
            self._save()
        logger.info("PositionStore: marked position %s as closed", position_id)

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
            logger.error("PositionStore: corrupt file %s (%s), starting empty. Check .bak for recovery.", self._path, e)
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
