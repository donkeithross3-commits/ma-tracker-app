import os
import sys
import math
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.trade_history.database import TradeDatabase


class _FakeConn:
    def __init__(self):
        self.calls = []

    async def execute(self, query, *args):
        self.calls.append((query, args))


@pytest.mark.asyncio
async def test_upsert_one_fill_uses_time_when_fill_time_missing():
    db = TradeDatabase(database_url="postgresql://example")
    conn = _FakeConn()

    fill = {
        "time": 1774545124.5687294,
        "order_id": 55,
        "exec_id": "abc123",
        "level": "profit_0",
        "qty_filled": 1,
        "avg_price": 0.79,
        "remaining_qty": 0,
        "pnl_pct": 31.87,
        "execution_analytics": {
            "commission": 0.65,
            "realized_pnl_ib": 12.5,
            "fill_exchange": "CBOE",
            "slippage": -0.01,
            "last_liquidity": 2,
        },
    }

    await db._upsert_one_fill(conn, "user-1", "pos-1", 0, fill)

    assert len(conn.calls) == 1
    args = conn.calls[0][1]
    assert args[3] == datetime.fromtimestamp(fill["time"], tz=timezone.utc)
    assert args[4] == 55
    assert args[5] == "abc123"
    assert args[11] == 0.65
    assert args[13] == "CBOE"


def test_json_dumps_sanitizes_non_finite_numbers():
    payload = {
        "risk": math.nan,
        "nested": [1.0, math.inf, {"value": -math.inf}],
    }

    assert TradeDatabase._json_dumps(payload) == (
        '{"risk": null, "nested": [1.0, null, {"value": null}]}'
    )


@pytest.mark.asyncio
async def test_upsert_one_execution_persists_slippage_and_effective_spread():
    db = TradeDatabase(database_url="postgresql://example")
    conn = _FakeConn()

    execution = {
        "broker_execution_key": "exec:U152133:000123.abc.01",
        "position_id": "pos-1",
        "strategy_id": "bmc_spy",
        "account": "U152133",
        "exec_id": "000123.abc.01",
        "order_id": 55,
        "perm_id": 7001,
        "contract_key": "SPY:647:20260326:P",
        "instrument": {
            "symbol": "SPY",
            "secType": "OPT",
            "strike": 647.0,
            "expiry": "20260326",
            "right": "P",
        },
        "side": "SLD",
        "level": "exit",
        "qty_filled": 1,
        "avg_price": 0.79,
        "fill_time": 1774546049.69346,
        "remaining_qty": 0,
        "pnl_pct": 31.87,
        "routing_exchange": "SMART",
        "fill_exchange": "CBOE",
        "last_liquidity": 2,
        "slippage": -0.01,
        "effective_spread": 0.02,
        "pre_trade_snapshot": {"option_ask": 0.80, "option_mid": 0.78},
        "post_fill": {"mid_60s": 0.75},
        "commission": 0.65,
        "realized_pnl_ib": 12.5,
        "source": "position_store_fill",
        "unresolved_position": False,
        "analytics_status": "finalized",
        "degraded_reasons": [],
        "finalization_state": {"captured": True},
        "captured_at": 1774546049.69346,
        "broker_enriched_at": 1774546052.0,
        "analytics_finalized_at": 1774546110.0,
    }

    await db._upsert_one_execution(conn, "user-1", execution)

    assert len(conn.calls) == 1
    query, args = conn.calls[0]
    assert "slippage" in query
    assert "effective_spread" in query
    assert args[24] == -0.01
    assert args[25] == 0.02
