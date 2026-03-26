import json
from pathlib import Path

from standalone_agent.position_store import PositionStore


def _make_store(tmp_path: Path) -> PositionStore:
    return PositionStore(str(tmp_path / "position_store.json"))


def test_add_fill_suppresses_probable_duplicate_exit(tmp_path: Path):
    store = _make_store(tmp_path)
    store.add_position(
        position_id="bmc_risk_test",
        entry={"order_id": 1, "price": 0.59, "quantity": 4, "fill_time": 1000.0, "perm_id": 10},
        instrument={"symbol": "SPY", "secType": "OPT", "strike": 647.0, "expiry": "20260326", "right": "P"},
        risk_config={},
        parent_strategy="bmc_spy",
    )

    real_fill = {
        "time": 2000.0,
        "order_id": 55,
        "level": "profit_0",
        "qty_filled": 1,
        "avg_price": 0.79,
        "remaining_qty": 3,
        "pnl_pct": 31.87447886628011,
    }
    duplicate_fill = {
        "time": 2000.05,
        "order_id": 0,
        "level": "profit_0",
        "qty_filled": 1,
        "avg_price": 0.79,
        "remaining_qty": 3,
        "pnl_pct": 31.87447886628011,
        "execution_analytics": {
            "exchange": "",
            "last_liquidity": 0,
        },
    }

    store.add_fill("bmc_risk_test", real_fill)
    store.add_fill("bmc_risk_test", duplicate_fill)

    pos = store.get_position("bmc_risk_test")
    assert pos is not None
    assert len(pos["fill_log"]) == 1
    assert pos["fill_log"][0]["order_id"] == 55


def test_add_fill_keeps_distinct_partial_fills(tmp_path: Path):
    store = _make_store(tmp_path)
    store.add_position(
        position_id="bmc_risk_test",
        entry={"order_id": 1, "price": 0.59, "quantity": 4, "fill_time": 1000.0, "perm_id": 10},
        instrument={"symbol": "SPY", "secType": "OPT", "strike": 647.0, "expiry": "20260326", "right": "P"},
        risk_config={},
        parent_strategy="bmc_spy",
    )

    first_fill = {
        "time": 2000.0,
        "order_id": 55,
        "level": "profit_0",
        "qty_filled": 1,
        "avg_price": 0.79,
        "remaining_qty": 3,
        "pnl_pct": 31.87,
    }
    second_fill = {
        "time": 2001.0,
        "order_id": 55,
        "level": "profit_0",
        "qty_filled": 1,
        "avg_price": 0.80,
        "remaining_qty": 2,
        "pnl_pct": 33.0,
    }

    store.add_fill("bmc_risk_test", first_fill)
    store.add_fill("bmc_risk_test", second_fill)

    pos = store.get_position("bmc_risk_test")
    assert pos is not None
    assert len(pos["fill_log"]) == 2
    assert [fill["remaining_qty"] for fill in pos["fill_log"]] == [3, 2]
