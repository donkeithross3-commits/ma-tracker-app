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

    # ------------------------------------------------------------------
    # Multi-level attribution (Phase 3 taxonomy)
    # ------------------------------------------------------------------

    def _extract_trades_with_lineage(self) -> List[dict]:
        """Extract all trades with enriched lineage for multi-level queries."""
        positions = self._store.get_all_positions()
        result = []
        for p in positions:
            lineage = p.get("lineage", {})
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

            # Slippage
            entry_fill = next((f for f in fills if f.get("level") == "entry"), None)
            slippage = entry_fill.get("execution_analytics", {}).get("slippage") if entry_fill else None

            result.append({
                "position_id": p["id"],
                "status": p.get("status"),
                "created_at": p.get("created_at"),
                "instrument": p.get("instrument", {}),
                "entry_price": entry_price,
                "gross_pnl": gross_pnl,
                "total_commission": total_commission,
                "net_pnl": net_pnl,
                "slippage": slippage,
                # Taxonomy fields from lineage
                "strategy": lineage.get("strategy", "bmc"),
                "family_id": lineage.get("family_id", ""),
                "recipe_id": lineage.get("recipe_id", ""),
                "recipe_label": lineage.get("recipe_label", ""),
                "model_version": lineage.get("model_version", "pre-lineage"),
                "execution_profile_id": lineage.get("execution_profile_id", ""),
                "execution_profile_label": lineage.get("execution_profile_label", ""),
                "session_id": lineage.get("session_id", ""),
                "signal_id": lineage.get("signal_id", ""),
                "signal_probability": lineage.get("signal", {}).get("probability"),
                "signal_direction": lineage.get("signal", {}).get("direction"),
            })
        return result

    def by_family(self, family_id: str) -> List[dict]:
        """All trades for an architecture generation."""
        trades = self._extract_trades_with_lineage()
        return [t for t in trades if t.get("family_id") == family_id]

    def by_recipe(self, recipe_id: str) -> List[dict]:
        """All trades for a training recipe."""
        trades = self._extract_trades_with_lineage()
        return [t for t in trades if t.get("recipe_id") == recipe_id]

    def by_checkpoint(self, version_id: str) -> List[dict]:
        """All trades for specific weights (alias for by_model_version)."""
        return self.by_model_version(version_id)

    def by_profile(self, profile_id: str) -> List[dict]:
        """All trades under an execution profile."""
        trades = self._extract_trades_with_lineage()
        return [t for t in trades if t.get("execution_profile_id") == profile_id]

    def by_session(self, session_id: str) -> List[dict]:
        """All trades in a session."""
        trades = self._extract_trades_with_lineage()
        return [t for t in trades if t.get("session_id") == session_id]

    def summary_by_level(self, level: str) -> List[dict]:
        """Aggregate P&L at any taxonomy level.

        Args:
            level: One of 'family', 'recipe', 'checkpoint', 'profile', 'session'

        Returns:
            List of dicts with: group_key, trades, wins, win_rate, gross_pnl, commission, net_pnl
        """
        level_key_map = {
            "family": "family_id",
            "recipe": "recipe_id",
            "checkpoint": "model_version",
            "profile": "execution_profile_id",
            "session": "session_id",
        }
        key_field = level_key_map.get(level)
        if not key_field:
            logger.warning("Unknown attribution level: %s", level)
            return []

        trades = self._extract_trades_with_lineage()
        groups: dict = {}
        for t in trades:
            group_key = t.get(key_field, "unknown")
            if not group_key:
                group_key = "unknown"
            if group_key not in groups:
                groups[group_key] = {
                    "group_key": group_key,
                    "level": level,
                    "trades": 0,
                    "wins": 0,
                    "gross_pnl": 0.0,
                    "commission": 0.0,
                    "net_pnl": 0.0,
                    "slippage_total": 0.0,
                }
            g = groups[group_key]
            g["trades"] += 1
            if t["net_pnl"] is not None:
                g["gross_pnl"] += t["gross_pnl"] or 0
                g["commission"] += t["total_commission"]
                g["net_pnl"] += t["net_pnl"]
                if (t["net_pnl"] or 0) > 0:
                    g["wins"] += 1
            if t["slippage"] is not None:
                g["slippage_total"] += t["slippage"]

        # Compute win rates
        for g in groups.values():
            closed = sum(
                1 for t in trades
                if t.get(key_field) == g["group_key"] and t.get("status") == "closed"
            )
            g["win_rate"] = g["wins"] / closed if closed else 0.0
            g["gross_pnl"] = round(g["gross_pnl"], 2)
            g["commission"] = round(g["commission"], 2)
            g["net_pnl"] = round(g["net_pnl"], 2)
            g["slippage_total"] = round(g["slippage_total"], 4)

        return list(groups.values())
