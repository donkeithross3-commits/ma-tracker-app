"""Execution Experiment Logger — Phase 0 Instrumentation.

Writes one JSON file per trade to data/execution_experiments/ with complete
pre-trade, order, fill, and post-fill data in a single record for offline
analysis of execution quality and routing experiments.

Records are append-only and immutable once written.  The logger runs on
timer threads (post-fill capture threads) — never on the eval loop.

Storage: standalone_agent/data/execution_experiments/
Naming: {timestamp}_{ticker}_{direction}_{order_id}.json
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Storage directory (relative to this file's location)
_DATA_DIR = Path(__file__).parent / "data" / "execution_experiments"


def write_experiment_record(
    *,
    strategy_id: str,
    order_id: int,
    fill_price: float,
    fill_time: float,
    pre_trade_snapshot: dict,
    routing_exchange: str,
    fill_dict: dict,
    post_fill_data: dict,
) -> Optional[str]:
    """Write a complete execution experiment record as a JSON file.

    Called ~61s after fill (after all post-fill captures complete).
    Returns the file path on success, None on failure.

    This function is called from a timer thread — it must not raise.
    """
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)

        # Extract fields from pre-trade snapshot
        ticker = pre_trade_snapshot.get("strike", "")
        # The ticker is embedded in the strategy_id (e.g. "bmc_risk_spy_...")
        # or from the snapshot
        ticker = _extract_ticker(strategy_id)
        direction = pre_trade_snapshot.get("signal_direction", "unknown")
        dt = datetime.fromtimestamp(fill_time, tz=timezone.utc)

        # Build option contract description
        strike = pre_trade_snapshot.get("strike", "")
        right = pre_trade_snapshot.get("right", "")
        expiry = pre_trade_snapshot.get("expiry", "")
        right_label = "C" if right == "C" else "P"
        option_desc = f"{ticker} {expiry}{right_label}{strike}" if strike else ""

        # Time of day in minutes since market open (9:30 ET)
        snapshot_time = pre_trade_snapshot.get("snapshot_time", fill_time)
        try:
            from zoneinfo import ZoneInfo
            dt_et = datetime.fromtimestamp(snapshot_time, tz=ZoneInfo("America/New_York"))
            time_of_day_minutes = (dt_et.hour * 60 + dt_et.minute) - (9 * 60 + 30)
        except Exception:
            time_of_day_minutes = None

        # Compute fill latency
        latency_ms = None
        if snapshot_time and fill_time:
            latency_ms = round((fill_time - snapshot_time) * 1000, 1)

        # Build the record
        analytics = fill_dict.get("execution_analytics", {})
        record = {
            "trade_id": str(uuid.uuid4()),
            "timestamp": dt.isoformat(),
            "ticker": ticker,
            "signal_direction": direction,
            "option_contract": option_desc,
            "strategy_id": strategy_id,
            "routing_strategy": routing_exchange,
            "pre_trade": {
                "signal_time": snapshot_time,
                "option_bid": pre_trade_snapshot.get("option_bid"),
                "option_ask": pre_trade_snapshot.get("option_ask"),
                "option_mid": pre_trade_snapshot.get("option_mid"),
                "option_spread": pre_trade_snapshot.get("option_spread"),
                "option_spread_pct": pre_trade_snapshot.get("option_spread_pct"),
                "underlying_price": pre_trade_snapshot.get("underlying_price"),
                "vix": pre_trade_snapshot.get("vix_level"),
                "signal_probability": pre_trade_snapshot.get("signal_probability"),
                "time_of_day_minutes": time_of_day_minutes,
            },
            "order": {
                "order_type": pre_trade_snapshot.get("order_type", "LMT"),
                "limit_price": pre_trade_snapshot.get("limit_price_used"),
                "quantity": fill_dict.get("qty_filled"),
                "routing_exchange": routing_exchange,
            },
            "fill": {
                "fill_time": fill_time,
                "fill_price": fill_price,
                "fill_exchange": analytics.get("exchange", ""),
                "last_liquidity": analytics.get("last_liquidity", 0),
                "commission": analytics.get("commission"),
                "latency_ms": latency_ms,
                "slippage_vs_ask": analytics.get("slippage"),
                "effective_spread": analytics.get("effective_spread"),
            },
            "post_fill": {
                "mid_5s": post_fill_data.get("mid_5s"),
                "mid_30s": post_fill_data.get("mid_30s"),
                "mid_60s": post_fill_data.get("mid_60s"),
                "bid_5s": post_fill_data.get("bid_5s"),
                "bid_30s": post_fill_data.get("bid_30s"),
                "bid_60s": post_fill_data.get("bid_60s"),
                "ask_5s": post_fill_data.get("ask_5s"),
                "ask_30s": post_fill_data.get("ask_30s"),
                "ask_60s": post_fill_data.get("ask_60s"),
                "adverse_selection_5s": _adverse_selection(post_fill_data, "mid_5s", fill_price),
                "adverse_selection_30s": _adverse_selection(post_fill_data, "mid_30s", fill_price),
                "adverse_selection_60s": _adverse_selection(post_fill_data, "mid_60s", fill_price),
            },
        }

        # Write to file
        ts_str = dt.strftime("%Y%m%d_%H%M%S")
        filename = f"{ts_str}_{ticker}_{direction}_{order_id}.json"
        filepath = _DATA_DIR / filename

        with open(filepath, "w") as f:
            json.dump(record, f, indent=2, default=str)

        logger.info(
            "Experiment record written: %s (slippage=%s, adverse_30s=%s)",
            filename,
            analytics.get("slippage"),
            record["post_fill"]["adverse_selection_30s"],
        )
        return str(filepath)

    except Exception as e:
        logger.error("Failed to write experiment record for order %d: %s", order_id, e)
        return None


def _extract_ticker(strategy_id: str) -> str:
    """Extract ticker from strategy_id like 'bmc_risk_spy_...' or 'bmc_spy_up'."""
    parts = strategy_id.lower().replace("bmc_risk_", "").replace("bmc_", "").split("_")
    if parts:
        # First part is the ticker; skip directional suffixes
        ticker = parts[0].upper()
        if ticker in ("UP", "DOWN"):
            return "UNKNOWN"
        return ticker
    return "UNKNOWN"


def _adverse_selection(post_fill_data: dict, key: str, fill_price: float) -> Optional[float]:
    """Compute adverse selection: positive = price moved in our favor."""
    mid = post_fill_data.get(key)
    if mid is not None and fill_price > 0:
        return round(mid - fill_price, 6)
    return None
