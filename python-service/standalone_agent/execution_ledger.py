#!/usr/bin/env python3
"""
Canonical execution and reservation ledger sidecar.

This file is the durable local archive for broker-facing execution records and
exit reservations. It intentionally lives beside the position store instead of
inside Postgres so restart/recovery logic can replay it before any network sync.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class ExecutionLedgerStore:
    """Thread-safe JSON sidecar for canonical executions and exit reservations."""

    COMMISSION_TIMEOUT_SEC = 5.0
    EXEC_ID_TIMEOUT_SEC = 5.0
    POST_FILL_TIMEOUT_SEC = 65.0

    def __init__(self, path: str):
        self._path = path
        self._bak_path = path + ".bak"
        self._lock = threading.Lock()
        self._executions: Dict[str, dict] = {}
        self._reservations: Dict[str, dict] = {}
        self._pending_commissions: Dict[str, dict] = {}
        self._dirty_execution_keys: set[str] = set()
        self._dirty_reservation_ids: set[str] = set()
        self._load()

    # ------------------------------------------------------------------
    # Contract / key helpers
    # ------------------------------------------------------------------

    @staticmethod
    def normalize_contract_key(instrument_or_contract: dict | None) -> tuple:
        data = instrument_or_contract or {}
        symbol = str(data.get("symbol") or "").upper()
        expiry = str(
            data.get("expiry")
            or data.get("lastTradeDateOrContractMonth")
            or ""
        )
        right = str(data.get("right") or "").upper()
        try:
            strike = round(float(data.get("strike") or 0.0), 6)
        except (TypeError, ValueError):
            strike = 0.0
        return (symbol, strike, expiry, right)

    @classmethod
    def format_contract_key(cls, contract_key_or_dict) -> str:
        if isinstance(contract_key_or_dict, tuple):
            key = contract_key_or_dict
        else:
            key = cls.normalize_contract_key(contract_key_or_dict)
        symbol, strike, expiry, right = key
        strike_text = f"{strike:.6f}".rstrip("0").rstrip(".")
        return f"{symbol}:{strike_text}:{expiry}:{right}"

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

    @staticmethod
    def _parse_fill_time(value) -> float:
        if value is None:
            return time.time()
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                pass
            for fmt in (
                "%Y-%m-%d %H:%M:%S",
                "%Y%m%d  %H:%M:%S",
                "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%dT%H:%M:%S.%f%z",
            ):
                try:
                    return datetime.strptime(value, fmt).timestamp()
                except ValueError:
                    continue
        return time.time()

    @classmethod
    def _build_execution_key(
        cls,
        *,
        account: str,
        exec_id: str,
        order_id: int,
        perm_id: int,
        contract_key: str,
        side: str,
        fill_time: float,
        qty_filled: int,
        avg_price: float,
    ) -> str:
        if exec_id:
            return f"exec:{account}:{exec_id}"
        fill_time_bucket = int(round(fill_time * 1000))
        return (
            f"provisional:{account}:{order_id}:{perm_id}:{contract_key}:"
            f"{side}:{fill_time_bucket}:{qty_filled}:{avg_price:.6f}"
        )

    @classmethod
    def new_reservation_id(cls) -> str:
        return uuid.uuid4().hex

    # ------------------------------------------------------------------
    # Execution lifecycle
    # ------------------------------------------------------------------

    def record_fill(
        self,
        *,
        position_id: str,
        strategy_id: str,
        instrument: dict,
        fill_dict: dict,
        account: str = "",
        source: str = "position_store_fill",
        unresolved_position: bool = False,
    ) -> Optional[str]:
        analytics = dict(fill_dict.get("execution_analytics") or {})
        if analytics.get("synthetic"):
            return None

        order_id = self._coerce_int(fill_dict.get("order_id"))
        exec_id = str(fill_dict.get("exec_id") or "")
        if order_id <= 0 and not exec_id:
            return None

        qty_filled = self._coerce_int(fill_dict.get("qty_filled"))
        avg_price = self._coerce_float(fill_dict.get("avg_price"))
        fill_time = self._parse_fill_time(fill_dict.get("time") or fill_dict.get("fill_time"))
        contract_key = self.format_contract_key(instrument)
        side = str(analytics.get("side") or ("BOT" if fill_dict.get("level") == "entry" else "SLD")).upper()
        perm_id = self._coerce_int(
            analytics.get("perm_id")
            or fill_dict.get("perm_id")
            or fill_dict.get("permId")
        )
        execution_key = self._build_execution_key(
            account=account,
            exec_id=exec_id,
            order_id=order_id,
            perm_id=perm_id,
            contract_key=contract_key,
            side=side,
            fill_time=fill_time,
            qty_filled=qty_filled,
            avg_price=avg_price,
        )

        with self._lock:
            record = dict(self._executions.get(execution_key) or {})
            now = time.time()
            record.update({
                "broker_execution_key": execution_key,
                "position_id": position_id or "",
                "strategy_id": strategy_id or position_id or "",
                "account": account or record.get("account", ""),
                "exec_id": exec_id or record.get("exec_id", ""),
                "order_id": order_id or record.get("order_id", 0),
                "perm_id": perm_id or record.get("perm_id", 0),
                "contract_key": contract_key,
                "instrument": dict(instrument or record.get("instrument") or {}),
                "side": side or record.get("side", ""),
                "level": fill_dict.get("level", record.get("level", "unknown")),
                "qty_filled": qty_filled or record.get("qty_filled", 0),
                "avg_price": avg_price or record.get("avg_price", 0.0),
                "fill_time": fill_time,
                "remaining_qty": self._coerce_int(
                    fill_dict.get("remaining_qty", record.get("remaining_qty", 0))
                ),
                "pnl_pct": self._coerce_float(
                    fill_dict.get("pnl_pct", record.get("pnl_pct", 0.0))
                ),
                "routing_exchange": analytics.get("routing_exchange", record.get("routing_exchange", "")),
                "fill_exchange": (
                    analytics.get("fill_exchange")
                    or analytics.get("exchange")
                    or record.get("fill_exchange", "")
                ),
                "last_liquidity": self._coerce_int(
                    analytics.get("last_liquidity", record.get("last_liquidity", 0))
                ),
                "slippage": (
                    round(self._coerce_float(analytics.get("slippage")), 6)
                    if analytics.get("slippage") is not None
                    else record.get("slippage")
                ),
                "effective_spread": (
                    round(self._coerce_float(analytics.get("effective_spread")), 6)
                    if analytics.get("effective_spread") is not None
                    else record.get("effective_spread")
                ),
                "pre_trade_snapshot": analytics.get(
                    "pre_trade_snapshot",
                    record.get("pre_trade_snapshot"),
                ),
                "post_fill": dict(record.get("post_fill") or analytics.get("post_fill") or {}),
                "commission": analytics.get("commission", record.get("commission")),
                "realized_pnl_ib": analytics.get(
                    "realized_pnl_ib",
                    record.get("realized_pnl_ib"),
                ),
                "source": source or record.get("source", "position_store_fill"),
                "unresolved_position": bool(unresolved_position and not position_id),
                "captured_at": record.get("captured_at", now),
                "updated_at": now,
            })
            self._apply_pending_commission(record)
            self._refresh_record_states(record, now=now)
            self._executions[execution_key] = record
            self._dirty_execution_keys.add(execution_key)
            self._save_locked()
            return execution_key

    def update_execution_details(
        self,
        *,
        position_id: str,
        order_id: int,
        exec_id: str,
        execution_analytics: Optional[dict] = None,
        account: str = "",
        match_hint: Optional[dict] = None,
    ) -> bool:
        if not exec_id:
            return False
        with self._lock:
            now = time.time()
            existing_key = self._find_execution_key_locked(
                exec_id=exec_id,
                order_id=order_id,
                position_id=position_id,
                match_hint=match_hint,
                prefer_unresolved_exec=True,
            )
            record = dict(self._executions.get(existing_key) or {})
            analytics = dict(execution_analytics or {})
            contract_key = record.get("contract_key", "")
            if not contract_key:
                contract_key = self.format_contract_key(record.get("instrument") or {})
            hint = match_hint or {}
            target_key = self._build_execution_key(
                account=account or record.get("account", ""),
                exec_id=exec_id,
                order_id=order_id or record.get("order_id", 0),
                perm_id=self._coerce_int(
                    analytics.get("perm_id")
                    or record.get("perm_id")
                ),
                contract_key=contract_key,
                side=str(record.get("side") or analytics.get("side") or hint.get("side") or "").upper(),
                fill_time=self._coerce_float(record.get("fill_time"), self._parse_fill_time(hint.get("fill_time")) or now),
                qty_filled=self._coerce_int(record.get("qty_filled"), self._coerce_int(hint.get("qty_filled"))),
                avg_price=self._coerce_float(record.get("avg_price"), self._coerce_float(hint.get("avg_price"))),
            )
            record.update({
                "broker_execution_key": target_key,
                "position_id": position_id or record.get("position_id", ""),
                "exec_id": exec_id,
                "order_id": order_id or record.get("order_id", 0),
                "account": account or record.get("account", ""),
                "perm_id": self._coerce_int(
                    analytics.get("perm_id") or record.get("perm_id", 0)
                ),
                "side": str(record.get("side") or analytics.get("side") or hint.get("side") or "").upper(),
                "routing_exchange": analytics.get(
                    "routing_exchange",
                    record.get("routing_exchange", ""),
                ),
                "fill_exchange": analytics.get(
                    "exchange",
                    record.get("fill_exchange", ""),
                ),
                "last_liquidity": self._coerce_int(
                    analytics.get("last_liquidity", record.get("last_liquidity", 0))
                ),
                "slippage": (
                    round(self._coerce_float(analytics.get("slippage")), 6)
                    if analytics.get("slippage") is not None
                    else record.get("slippage")
                ),
                "effective_spread": (
                    round(self._coerce_float(analytics.get("effective_spread")), 6)
                    if analytics.get("effective_spread") is not None
                    else record.get("effective_spread")
                ),
                "pre_trade_snapshot": analytics.get(
                    "pre_trade_snapshot",
                    record.get("pre_trade_snapshot"),
                ),
                "updated_at": now,
            })
            self._apply_pending_commission(record)
            self._refresh_record_states(record, now=now)
            if existing_key and existing_key != target_key:
                self._executions.pop(existing_key, None)
                self._dirty_execution_keys.add(existing_key)
            self._executions[target_key] = record
            self._dirty_execution_keys.add(target_key)
            self._save_locked()
            return True

    def update_commission(
        self,
        exec_id: str,
        commission_report: dict,
        *,
        account: str = "",
    ) -> bool:
        if not exec_id:
            return False
        with self._lock:
            key = self._find_execution_key_locked(exec_id=exec_id)
            if not key:
                self._pending_commissions[exec_id] = {
                    "account": account,
                    **dict(commission_report or {}),
                }
                self._save_locked()
                return False
            record = self._executions[key]
            record["account"] = account or record.get("account", "")
            record["commission"] = commission_report.get("commission")
            record["realized_pnl_ib"] = commission_report.get("realized_pnl")
            record["updated_at"] = time.time()
            self._refresh_record_states(record)
            self._dirty_execution_keys.add(key)
            self._save_locked()
            return True

    def update_post_fill(
        self,
        *,
        position_id: str,
        order_id: int,
        delay_seconds: int,
        post_fill_data: dict,
        match_hint: Optional[dict] = None,
    ) -> bool:
        with self._lock:
            key = self._find_execution_key_locked(
                order_id=order_id,
                position_id=position_id,
                match_hint=match_hint,
            )
            if not key:
                return False
            record = self._executions[key]
            record.setdefault("post_fill", {})
            record["post_fill"].update({
                k: v for k, v in (post_fill_data or {}).items()
                if k.endswith(f"_{delay_seconds}s")
            })
            record["updated_at"] = time.time()
            self._refresh_record_states(record)
            self._dirty_execution_keys.add(key)
            self._save_locked()
            return True

    def ingest_ib_execution_batch(
        self,
        executions: List[dict],
        *,
        resolve_position_id=None,
        source: str = "ib_reconciliation",
    ) -> dict:
        ingested = 0
        unresolved = 0
        for item in executions or []:
            contract = item.get("contract") or {}
            execution = item.get("execution") or {}
            commission = item.get("commission") or {}
            position_id = resolve_position_id(contract, execution) if resolve_position_id else None
            level = "entry" if str(execution.get("side") or "").upper() == "BOT" else "exit"
            fill_dict = {
                "time": execution.get("time"),
                "order_id": execution.get("orderId"),
                "exec_id": execution.get("execId"),
                "level": level,
                "qty_filled": self._coerce_int(execution.get("shares")),
                "avg_price": self._coerce_float(execution.get("price")),
                "remaining_qty": 0,
                "pnl_pct": 0.0,
                "execution_analytics": {
                    "exchange": execution.get("exchange", ""),
                    "last_liquidity": execution.get("lastLiquidity", 0),
                    "commission": commission.get("commission"),
                    "realized_pnl_ib": commission.get("realized_pnl"),
                    "side": execution.get("side", ""),
                    "perm_id": execution.get("permId", 0),
                },
            }
            record_key = self.record_fill(
                position_id=position_id or "",
                strategy_id=position_id or "",
                instrument=contract,
                fill_dict=fill_dict,
                account=str(execution.get("account") or ""),
                source=source,
                unresolved_position=not bool(position_id),
            )
            if record_key:
                ingested += 1
                if not position_id:
                    unresolved += 1
        return {
            "ingested": ingested,
            "unresolved": unresolved,
        }

    def get_all_executions(self) -> List[dict]:
        with self._lock:
            return sorted(
                (dict(rec) for rec in self._executions.values()),
                key=lambda rec: (self._coerce_float(rec.get("fill_time")), rec.get("broker_execution_key", "")),
            )

    def get_position_executions(self, position_id: str) -> List[dict]:
        with self._lock:
            results = [
                dict(rec)
                for rec in self._executions.values()
                if rec.get("position_id") == position_id
            ]
        return sorted(results, key=lambda rec: (self._coerce_float(rec.get("fill_time")), rec.get("broker_execution_key", "")))

    def summarize_position(self, position_id: str, *, multiplier: int = 100) -> dict:
        executions = self.get_position_executions(position_id)
        entries = [rec for rec in executions if rec.get("level") == "entry"]
        exits = [rec for rec in executions if rec.get("level") != "entry"]
        total_commission = sum(
            self._coerce_float(rec.get("commission"))
            for rec in executions
            if rec.get("commission") is not None
        )
        entry_cost = sum(
            self._coerce_float(rec.get("avg_price"))
            * self._coerce_int(rec.get("qty_filled"))
            * multiplier
            for rec in entries
        )
        exit_revenue = sum(
            self._coerce_float(rec.get("avg_price"))
            * self._coerce_int(rec.get("qty_filled"))
            * multiplier
            for rec in exits
        )
        gross_pnl = round(exit_revenue - entry_cost, 4) if exits else None
        net_pnl = round(gross_pnl - total_commission, 4) if gross_pnl is not None else None
        status_rank = {
            "finalized": 3,
            "broker_enriched": 2,
            "provisional": 1,
            "degraded": 0,
        }
        analytics_status = "provisional"
        if executions:
            analytics_status = min(
                executions,
                key=lambda rec: status_rank.get(rec.get("analytics_status", "provisional"), 1),
            ).get("analytics_status", "provisional")
            if all(rec.get("analytics_status") == "finalized" for rec in executions):
                analytics_status = "finalized"
            elif any(rec.get("analytics_status") == "degraded" for rec in executions):
                analytics_status = "degraded"
            elif any(
                rec.get("analytics_status") in {"broker_enriched", "finalized"}
                for rec in executions
            ):
                analytics_status = "broker_enriched"
        degraded_reasons = sorted({
            reason
            for rec in executions
            for reason in rec.get("degraded_reasons", [])
        })
        return {
            "execution_count": len(executions),
            "entry_execution_count": len(entries),
            "exit_execution_count": len(exits),
            "gross_pnl": gross_pnl,
            "total_commission": round(total_commission, 4),
            "net_pnl": net_pnl,
            "analytics_status": analytics_status,
            "degraded_reasons": degraded_reasons,
            "executions": executions,
        }

    def drain_dirty_executions(self) -> List[dict]:
        with self._lock:
            dirty = [
                dict(self._executions[key])
                for key in list(self._dirty_execution_keys)
                if key in self._executions
            ]
            self._dirty_execution_keys.clear()
            return dirty

    # ------------------------------------------------------------------
    # Reservation lifecycle
    # ------------------------------------------------------------------

    def upsert_reservation(self, reservation: dict) -> Optional[str]:
        reservation_id = str(reservation.get("reservation_id") or "")
        if not reservation_id:
            return None
        with self._lock:
            existing = dict(self._reservations.get(reservation_id) or {})
            existing.update({
                **reservation,
                "reservation_id": reservation_id,
                "active": bool(reservation.get("active", True)),
                "updated_at": self._coerce_float(
                    reservation.get("updated_at"),
                    time.time(),
                ),
            })
            existing.setdefault("created_at", existing.get("updated_at", time.time()))
            self._reservations[reservation_id] = existing
            self._dirty_reservation_ids.add(reservation_id)
            self._save_locked()
            return reservation_id

    def bind_reservation(self, reservation_id: str, *, order_id: int, perm_id: int = 0) -> bool:
        with self._lock:
            record = self._reservations.get(reservation_id)
            if not record:
                return False
            record["order_id"] = self._coerce_int(order_id)
            if perm_id:
                record["perm_id"] = self._coerce_int(perm_id)
            record["status"] = "working"
            record["updated_at"] = time.time()
            self._dirty_reservation_ids.add(reservation_id)
            self._save_locked()
            return True

    def sync_reservation(
        self,
        *,
        order_id: int,
        remaining: Optional[float],
        status: str,
        perm_id: int = 0,
    ) -> bool:
        with self._lock:
            record = self._find_reservation_locked(order_id=order_id, perm_id=perm_id)
            if not record:
                return False
            if status in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
                record["reserved_qty"] = 0
                record["active"] = False
                record["status"] = str(status or "released")
                record["release_reason"] = str(status or "terminal_status").lower()
                record["released_at"] = time.time()
            elif remaining is not None:
                record["reserved_qty"] = max(0, self._coerce_int(remaining))
                record["status"] = "working"
            if perm_id:
                record["perm_id"] = self._coerce_int(perm_id)
            record["updated_at"] = time.time()
            reservation_id = record.get("reservation_id")
            if reservation_id:
                self._dirty_reservation_ids.add(reservation_id)
            self._save_locked()
            return True

    def release_reservation(
        self,
        *,
        reservation_id: str = "",
        order_id: int = 0,
        strategy_id: str = "",
        release_reason: str = "released",
    ) -> int:
        released = 0
        with self._lock:
            for record in self._reservations.values():
                if reservation_id and record.get("reservation_id") != reservation_id:
                    continue
                if order_id and self._coerce_int(record.get("order_id")) != self._coerce_int(order_id):
                    continue
                if strategy_id and record.get("strategy_id") != strategy_id:
                    continue
                if not reservation_id and not order_id and not strategy_id:
                    continue
                if not record.get("active", True) and self._coerce_int(record.get("reserved_qty")) <= 0:
                    continue
                record["active"] = False
                record["reserved_qty"] = 0
                record["status"] = "released"
                record["release_reason"] = release_reason
                record["released_at"] = time.time()
                record["updated_at"] = time.time()
                if record.get("reservation_id"):
                    self._dirty_reservation_ids.add(record["reservation_id"])
                released += 1
            if released:
                self._save_locked()
        return released

    def get_active_reservations(self) -> List[dict]:
        with self._lock:
            results = [
                dict(record)
                for record in self._reservations.values()
                if record.get("active", True) and self._coerce_int(record.get("reserved_qty")) > 0
            ]
        return sorted(results, key=lambda rec: (self._coerce_float(rec.get("created_at")), rec.get("reservation_id", "")))

    def drain_dirty_reservations(self) -> List[dict]:
        with self._lock:
            dirty = [
                dict(self._reservations[rid])
                for rid in list(self._dirty_reservation_ids)
                if rid in self._reservations
            ]
            self._dirty_reservation_ids.clear()
            return dirty

    def mark_all_dirty(self) -> None:
        with self._lock:
            self._dirty_execution_keys = set(self._executions.keys())
            self._dirty_reservation_ids = set(self._reservations.keys())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_execution_key_locked(
        self,
        *,
        exec_id: str = "",
        order_id: int = 0,
        position_id: str = "",
        match_hint: Optional[dict] = None,
        prefer_unresolved_exec: bool = False,
    ) -> Optional[str]:
        hinted_exec_id = str((match_hint or {}).get("exec_id") or "")
        if hinted_exec_id and hinted_exec_id != exec_id:
            for key, record in self._executions.items():
                if record.get("exec_id") == hinted_exec_id:
                    return key
        if exec_id:
            for key, record in self._executions.items():
                if record.get("exec_id") == exec_id:
                    return key
        if order_id:
            candidates = []
            for key, record in self._executions.items():
                if self._coerce_int(record.get("order_id")) != self._coerce_int(order_id):
                    continue
                if position_id and record.get("position_id") != position_id:
                    continue
                score = self._execution_match_score(
                    record,
                    match_hint=match_hint,
                    prefer_unresolved_exec=prefer_unresolved_exec,
                )
                candidates.append((score, self._coerce_float(record.get("updated_at")), key))
            if candidates:
                candidates.sort()
                return candidates[-1][2]
        return None

    def _execution_match_score(
        self,
        record: dict,
        *,
        match_hint: Optional[dict],
        prefer_unresolved_exec: bool,
    ) -> tuple:
        score = 0
        hint = match_hint or {}
        hint_exec_id = str(hint.get("exec_id") or "")
        record_exec_id = str(record.get("exec_id") or "")
        if hint_exec_id:
            if record_exec_id == hint_exec_id:
                score += 10_000
            elif record_exec_id:
                score -= 10_000

        unresolved = not bool(record.get("exec_id"))
        if prefer_unresolved_exec and unresolved:
            score += 1000
        elif prefer_unresolved_exec and not unresolved:
            score -= 1000

        hint_perm_id = hint.get("perm_id")
        if hint_perm_id is not None:
            record_perm_id = self._coerce_int(record.get("perm_id"))
            if record_perm_id and record_perm_id == self._coerce_int(hint_perm_id):
                score += 500
            elif record_perm_id:
                score -= 100

        hint_side = str(hint.get("side") or "").upper()
        if hint_side:
            record_side = str(record.get("side") or "").upper()
            if record_side == hint_side:
                score += 50
            elif record_side:
                score -= 25

        hint_account = str(hint.get("account") or "")
        if hint_account:
            record_account = str(record.get("account") or "")
            if record_account == hint_account:
                score += 25
            elif record_account:
                score -= 10

        hint_qty = hint.get("qty_filled")
        if hint_qty is not None and self._coerce_int(record.get("qty_filled")) == self._coerce_int(hint_qty):
            score += 100

        hint_price = hint.get("avg_price")
        if hint_price is not None:
            price_delta = abs(
                self._coerce_float(record.get("avg_price"))
                - self._coerce_float(hint_price)
            )
            if price_delta < 1e-9:
                score += 25
            else:
                score -= min(int(price_delta * 1000), 25)

        hint_time = hint.get("fill_time")
        if hint_time is not None:
            delta_sec = abs(
                self._coerce_float(record.get("fill_time"))
                - self._parse_fill_time(hint_time)
            )
            score -= min(int(delta_sec * 10.0), 250)

        return (
            score,
            1 if unresolved else 0,
        )

    def _find_reservation_locked(self, *, order_id: int = 0, perm_id: int = 0) -> Optional[dict]:
        for record in self._reservations.values():
            if order_id and self._coerce_int(record.get("order_id")) == self._coerce_int(order_id):
                return record
            if perm_id and self._coerce_int(record.get("perm_id")) == self._coerce_int(perm_id):
                return record
        return None

    def _apply_pending_commission(self, record: dict) -> None:
        exec_id = str(record.get("exec_id") or "")
        if not exec_id:
            return
        pending = self._pending_commissions.pop(exec_id, None)
        if not pending:
            return
        record["commission"] = pending.get("commission")
        record["realized_pnl_ib"] = pending.get("realized_pnl")
        if pending.get("account") and not record.get("account"):
            record["account"] = pending.get("account")

    def _refresh_record_states(self, record: dict, *, now: Optional[float] = None) -> None:
        now = now or time.time()
        captured_at = self._coerce_float(record.get("captured_at"), now)
        age_sec = max(0.0, now - captured_at)
        exec_id = str(record.get("exec_id") or "")
        commission = record.get("commission")
        realized_pnl_ib = record.get("realized_pnl_ib")
        pre_trade_snapshot = record.get("pre_trade_snapshot")
        post_fill = dict(record.get("post_fill") or {})
        post_fill_complete = post_fill.get("mid_60s") is not None
        degraded_reasons: List[str] = []
        if not exec_id and age_sec >= self.EXEC_ID_TIMEOUT_SEC:
            degraded_reasons.append("unresolved_exec_id")
        if pre_trade_snapshot is None:
            degraded_reasons.append("missing_pre_trade_snapshot")
        if commission is None and age_sec >= self.COMMISSION_TIMEOUT_SEC:
            degraded_reasons.append("missing_commission")
        if realized_pnl_ib is None and age_sec >= self.COMMISSION_TIMEOUT_SEC:
            degraded_reasons.append("missing_realized_pnl_ib")
        if not post_fill_complete and age_sec >= self.POST_FILL_TIMEOUT_SEC:
            degraded_reasons.append("missing_post_fill_60s")

        commission_status = "commission_captured" if commission is not None else "commission_pending"
        rpnl_status = "ib_realized_pnl_captured" if realized_pnl_ib is not None else "ib_realized_pnl_pending"
        post_fill_status = "captured" if post_fill_complete else "pending"
        if degraded_reasons:
            analytics_status = "degraded"
        elif exec_id and commission is not None and pre_trade_snapshot is not None and post_fill_complete:
            analytics_status = "finalized"
        elif exec_id or commission is not None or realized_pnl_ib is not None:
            analytics_status = "broker_enriched"
        else:
            analytics_status = "provisional"

        record["finalization_state"] = {
            "captured": True,
            "exec_id_resolved": bool(exec_id),
            "commission_status": commission_status,
            "ib_realized_pnl_status": rpnl_status,
            "pre_trade_snapshot_present": pre_trade_snapshot is not None,
            "post_fill_snapshot_status": post_fill_status,
            "analytics_status": analytics_status,
            "degraded_reasons": degraded_reasons,
        }
        record["analytics_status"] = analytics_status
        record["degraded_reasons"] = degraded_reasons
        if analytics_status in {"broker_enriched", "finalized"} and not record.get("broker_enriched_at"):
            record["broker_enriched_at"] = now
        if analytics_status == "finalized":
            record["analytics_finalized_at"] = record.get("analytics_finalized_at") or now
        else:
            record["analytics_finalized_at"] = None

    def _load(self) -> None:
        if not os.path.exists(self._path):
            self._executions = {}
            self._reservations = {}
            self._pending_commissions = {}
            return
        try:
            with open(self._path, "r") as fh:
                data = json.load(fh)
            self._executions = dict(data.get("executions") or {})
            self._reservations = dict(data.get("reservations") or {})
            self._pending_commissions = dict(data.get("pending_commissions") or {})
        except Exception as exc:
            logger.error("ExecutionLedgerStore load failed (%s) — trying backup", exc)
            if os.path.exists(self._bak_path):
                try:
                    with open(self._bak_path, "r") as fh:
                        data = json.load(fh)
                    self._executions = dict(data.get("executions") or {})
                    self._reservations = dict(data.get("reservations") or {})
                    self._pending_commissions = dict(data.get("pending_commissions") or {})
                    self._save_locked()
                    return
                except Exception as bak_exc:
                    logger.error("ExecutionLedgerStore backup recovery failed: %s", bak_exc)
            self._executions = {}
            self._reservations = {}
            self._pending_commissions = {}

    def _save_locked(self) -> None:
        tmp_path = self._path + ".tmp"
        payload = {
            "schema_version": 1,
            "executions": self._executions,
            "reservations": self._reservations,
            "pending_commissions": self._pending_commissions,
        }
        try:
            with open(tmp_path, "w") as fh:
                json.dump(payload, fh, indent=2)
            if os.path.exists(self._path):
                shutil.copy2(self._path, self._bak_path)
            os.replace(tmp_path, self._path)
        except Exception as exc:
            logger.error("ExecutionLedgerStore save failed: %s", exc)
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
