#!/usr/bin/env python3
"""
Trade Attribution
=================
Lightweight query module that reads position_store and computes
model-level P&L attribution. No new dependencies, no external DB.

Usage:
    ta = TradeAttribution(position_store)
    trades = ta.by_model_version("v_20260226")
    summary = ta.model_summary()
"""

import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class TradeAttribution:
    """Query model-level P&L attribution from position store."""

    def __init__(self, position_store):
        self._store = position_store

    def by_model_version(self, version_id: Optional[str] = None) -> List[dict]:
        """Trades attributed to a model version, with full P&L breakdown."""
        positions = self._store.get_all_positions()
        result = []
        for p in positions:
            lineage = p.get("lineage", {})
            if version_id and lineage.get("model_version") != version_id:
                continue
            entry = p.get("entry", {})
            fills = p.get("fill_log", [])

            # Compute realized P&L from fills
            entry_price = entry.get("price", 0)
            entry_qty = entry.get("quantity", 0)
            entry_cost = entry_price * entry_qty * 100
            exit_revenue = sum(
                f.get("avg_price", 0) * f.get("qty_filled", 0) * 100
                for f in fills if f.get("level") not in ("entry",)
            )
            gross_pnl = (exit_revenue - entry_cost) if p.get("status") == "closed" else None

            # Sum commissions
            total_commission = sum(
                (f.get("execution_analytics", {}).get("commission") or 0)
                for f in fills
            )
            net_pnl = (gross_pnl - total_commission) if gross_pnl is not None else None

            # Slippage analysis
            entry_fill = next((f for f in fills if f.get("level") == "entry"), None)
            slippage = entry_fill.get("execution_analytics", {}).get("slippage") if entry_fill else None

            result.append({
                "position_id": p["id"],
                "status": p.get("status"),
                "model_version": lineage.get("model_version", "pre-lineage"),
                "signal_probability": lineage.get("signal", {}).get("probability"),
                "signal_direction": lineage.get("signal", {}).get("direction"),
                "instrument": p.get("instrument", {}),
                "entry_price": entry_price,
                "gross_pnl": gross_pnl,
                "total_commission": total_commission,
                "net_pnl": net_pnl,
                "slippage": slippage,
                "created_at": p.get("created_at"),
            })
        return result

    def model_summary(self) -> List[dict]:
        """Aggregate P&L by model version."""
        trades = self.by_model_version()
        by_model: dict = {}
        for t in trades:
            mv = t["model_version"]
            if mv not in by_model:
                by_model[mv] = {
                    "version": mv, "trades": 0, "wins": 0,
                    "gross_pnl": 0, "commission": 0, "net_pnl": 0,
                }
            by_model[mv]["trades"] += 1
            if t["net_pnl"] is not None:
                by_model[mv]["gross_pnl"] += t["gross_pnl"] or 0
                by_model[mv]["commission"] += t["total_commission"]
                by_model[mv]["net_pnl"] += t["net_pnl"]
                if (t["net_pnl"] or 0) > 0:
                    by_model[mv]["wins"] += 1
        for m in by_model.values():
            closed = sum(
                1 for t in trades
                if t["model_version"] == m["version"] and t["status"] == "closed"
            )
            m["win_rate"] = m["wins"] / closed if closed else 0
        return list(by_model.values())
