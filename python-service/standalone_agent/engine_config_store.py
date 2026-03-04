#!/usr/bin/env python3
"""
Engine Config Store
===================
JSON-based persistence for execution engine configuration.  Survives agent
restarts so the engine can auto-restart in PAUSED mode with the same
strategies, budgets, and model pins.

Same atomic-write pattern as position_store.py: .tmp -> .bak -> os.replace.
Thread-safe via threading.Lock.

File: standalone_agent/engine_config_store.json
"""

import json
import logging
import os
import shutil
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1


class EngineConfigStore:
    """Thread-safe JSON config store with atomic writes."""

    def __init__(self, path: Optional[str] = None):
        if path is None:
            path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "engine_config_store.json",
            )
        self._path = path
        self._bak_path = path + ".bak"
        self._lock = threading.Lock()

    # ── Public API ──

    def save(
        self,
        engine_state: str,
        strategies: list,
        global_entry_cap: int,
        risk_budget_usd: float,
        reason: str = "",
        ticker_modes: Optional[dict] = None,
    ) -> None:
        """Persist current engine configuration to disk."""
        data = {
            "schema_version": SCHEMA_VERSION,
            "engine_state": engine_state,
            "saved_at": time.time(),
            "saved_reason": reason,
            "global_entry_cap": global_entry_cap,
            "risk_budget_usd": risk_budget_usd,
            "strategies": strategies,
        }
        if ticker_modes is not None:
            data["ticker_modes"] = ticker_modes
        with self._lock:
            self._write(data)
        logger.info(
            "EngineConfigStore: saved (%s) — %d strategies, cap=%d, risk=$%.0f",
            reason, len(strategies), global_entry_cap, risk_budget_usd,
        )

    def load(self) -> Optional[dict]:
        """Load saved config from disk.  Returns None if no file or corrupt."""
        with self._lock:
            return self._read()

    def clear(self) -> None:
        """Delete the config file.  Clean stop = no auto-restart on next boot."""
        with self._lock:
            for p in (self._path, self._bak_path, self._path + ".tmp"):
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except OSError as e:
                    logger.warning("EngineConfigStore: failed to remove %s: %s", p, e)
        logger.info("EngineConfigStore: cleared (clean stop)")

    # ── Internal ──

    def _write(self, data: dict) -> None:
        """Atomic write: .tmp -> backup existing -> rename."""
        tmp_path = self._path + ".tmp"
        try:
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)
            if os.path.exists(self._path):
                shutil.copy2(self._path, self._bak_path)
            os.replace(tmp_path, self._path)
        except Exception as e:
            logger.error("EngineConfigStore: write failed: %s", e)
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass

    def _read(self) -> Optional[dict]:
        """Read config from disk, trying .bak on failure."""
        for p in (self._path, self._bak_path):
            if not os.path.exists(p):
                continue
            try:
                with open(p, "r") as f:
                    data = json.load(f)
                if not isinstance(data, dict):
                    continue
                if data.get("schema_version") != SCHEMA_VERSION:
                    logger.warning(
                        "EngineConfigStore: schema version mismatch in %s (got %s, want %d)",
                        p, data.get("schema_version"), SCHEMA_VERSION,
                    )
                    continue
                return data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("EngineConfigStore: failed to read %s: %s", p, e)
        return None
