"""Tests for canonical level key identity on PendingOrder (WS-A).

Verifies that the _parse_level_key -> PendingOrder -> level_key roundtrip
is correct for ALL level key formats, and that on_order_dead re-arms the
correct level after IB rejection.
"""
import sys
import os
import time
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from risk_manager import (
    LevelState, PendingOrder, RiskManagerStrategy, PRESETS,
)


# ── Helpers ──

class FakeQuote:
    """Minimal quote object for evaluate()."""
    def __init__(self, bid=1.0, ask=1.2, last=1.1, age=0.0):
        self.bid = bid
        self.ask = ask
        self.last = last
        self.age_seconds = age
        self.mid = (bid + ask) / 2 if bid > 0 and ask > 0 else last


def _make_config(preset="zero_dte_convexity", eod_exit_time=None):
    cfg = {
        "instrument": {
            "symbol": "SPY", "secType": "OPT", "strike": 500,
            "right": "P", "expiry": "20260307",
        },
        "position": {"side": "LONG", "quantity": 5, "entry_price": 1.50},
        "preset": preset,
    }
    if eod_exit_time:
        cfg["eod_exit_time"] = eod_exit_time
    return cfg


def _make_rm(config=None):
    rm = RiskManagerStrategy()
    config = config or _make_config()
    rm.get_subscriptions(config)
    rm.on_start(config)
    return rm, config


# ── PendingOrder level_key roundtrip ──

class TestPendingOrderLevelKey:
    """level_key on PendingOrder must match the key in _level_states."""

    @pytest.mark.parametrize("level_key", [
        "stop_simple",
        "stop_0",
        "stop_1",
        "profit_0",
        "profit_1",
        "trailing",
        "eod_closeout",
    ])
    def test_parse_level_key_roundtrip(self, level_key):
        """PendingOrder.level_key equals the original level_key for all formats."""
        rm = RiskManagerStrategy()
        lt, li = rm._parse_level_key(level_key)
        po = PendingOrder(
            order_id=1, level_key=level_key,
            level_type=lt, level_idx=li,
            expected_qty=5, placed_at=time.time(),
        )
        assert po.level_key == level_key


# ── stop_simple rejection re-arm ──

class TestStopSimpleRejection:
    """After IB rejects a stop_simple order, it must re-arm and re-fire."""

    def test_stop_simple_rejection_rearms_correctly(self):
        rm, config = _make_rm()
        assert rm._level_states.get("stop_simple") == LevelState.ARMED

        # Trigger the stop (price crashes)
        quote = FakeQuote(bid=0.10, ask=0.15, last=0.12)
        actions = rm.evaluate({"SPY:500:20260307:P": quote}, config)
        assert len(actions) == 1
        assert rm._level_states["stop_simple"] == LevelState.TRIGGERED

        # Simulate order placement
        rm.on_order_placed(order_id=100, result={"remaining": 5, "filled": 0}, config=config)
        assert 100 in rm._pending_orders
        po = rm._pending_orders[100]
        assert po.level_key == "stop_simple"

        # Simulate IB rejection
        rm.on_order_dead(order_id=100, reason="Error 201: MARGIN DEFICIT", config=config)
        # Key assertion: stop_simple must be re-armed (not stop_simple_0)
        assert rm._level_states["stop_simple"] == LevelState.ARMED

        # Must be able to re-fire on next tick
        actions2 = rm.evaluate({"SPY:500:20260307:P": quote}, config)
        assert len(actions2) == 1
        assert rm._level_states["stop_simple"] == LevelState.TRIGGERED


# ── eod_closeout rejection re-arm ──

class TestEodCloseoutRejection:
    """After IB rejects an EOD close-out order, it must re-arm and re-fire."""

    def test_eod_closeout_rejection_rearms_correctly(self):
        config = _make_config(preset="intraday_convexity", eod_exit_time="15:30")
        rm = RiskManagerStrategy()
        rm.on_start(config)
        assert rm._level_states.get("eod_closeout") == LevelState.ARMED

        # Force the EOD level to trigger (simulate via direct state manipulation)
        rm._level_states["eod_closeout"] = LevelState.TRIGGERED

        # Simulate order placement
        rm.on_order_placed(order_id=200, result={"remaining": 5, "filled": 0}, config=config)
        po = rm._pending_orders[200]
        assert po.level_key == "eod_closeout"

        # Simulate IB rejection
        rm.on_order_dead(order_id=200, reason="Error 201: MARGIN DEFICIT", config=config)
        # Key assertion: eod_closeout must be re-armed (not eod_closeout_0)
        assert rm._level_states["eod_closeout"] == LevelState.ARMED


# ── _collect_cancel_ids for all level types ──

class TestCollectCancelIds:
    """_collect_cancel_ids must find pending orders for ALL level types."""

    @pytest.mark.parametrize("level_key,level_type,level_idx", [
        ("stop_simple", "stop_simple", 0),
        ("stop_0", "stop", 0),
        ("profit_0", "profit", 0),
        ("trailing", "trailing", 0),
        ("eod_closeout", "eod_closeout", 0),
    ])
    def test_collect_cancel_ids_all_level_types(self, level_key, level_type, level_idx):
        rm = RiskManagerStrategy()
        rm._pending_orders[42] = PendingOrder(
            order_id=42, level_key=level_key,
            level_type=level_type, level_idx=level_idx,
            expected_qty=5, placed_at=time.time(),
        )
        cancel_list = []
        rm._collect_cancel_ids(level_key, cancel_list)
        assert 42 in cancel_list
        assert 42 not in rm._pending_orders


# ── EOD waits for pending orders ──

class TestEodPendingGuard:
    """EOD close-out must not fire while other exit orders are pending."""

    def test_eod_waits_for_pending_orders(self):
        config = _make_config(preset="intraday_convexity", eod_exit_time="15:30")
        rm = RiskManagerStrategy()
        rm.on_start(config)
        # Simulate a pending trailing order
        rm._pending_orders[300] = PendingOrder(
            order_id=300, level_key="trailing",
            level_type="trailing", level_idx=0,
            expected_qty=2, placed_at=time.time(),
        )
        rm._level_states["trailing"] = LevelState.TRIGGERED
        # Set entry timestamp to today
        rm._entry_timestamp = time.time()

        quote = FakeQuote(bid=1.0, ask=1.2)
        # _check_eod_closeout should return None because of pending orders
        result = rm._check_eod_closeout(config, pnl_pct=5.0, current_price=1.1, quote=quote)
        assert result is None


# ── EOD level created in on_start ──

class TestEodLevelLifecycle:
    """eod_closeout level must be created in on_start when eod_exit_time is set."""

    def test_eod_level_created_in_on_start(self):
        config = _make_config(preset="intraday_convexity", eod_exit_time="15:30")
        rm = RiskManagerStrategy()
        rm.on_start(config)
        assert "eod_closeout" in rm._level_states
        assert rm._level_states["eod_closeout"] == LevelState.ARMED

    def test_eod_level_not_created_without_eod_time(self):
        config = _make_config(preset="zero_dte_convexity")
        rm = RiskManagerStrategy()
        rm.on_start(config)
        assert "eod_closeout" not in rm._level_states

    def test_eod_level_persisted_across_restart(self):
        """eod_closeout survives snapshot/restore cycle."""
        config = _make_config(preset="intraday_convexity", eod_exit_time="15:30")
        rm = RiskManagerStrategy()
        rm.on_start(config)
        rm._level_states["eod_closeout"] = LevelState.FILLED  # simulate filled

        snapshot = rm.get_runtime_snapshot()
        assert "eod_closeout" in snapshot["level_states"]

        # Restore into a new RM
        rm2 = RiskManagerStrategy()
        rm2.on_start(config)
        rm2.restore_runtime_state(snapshot)
        assert rm2._level_states["eod_closeout"] == LevelState.FILLED


# ── on_fill uses correct level_key ──

class TestOnFillLevelKey:
    """on_fill must update the correct key in _level_states."""

    def test_on_fill_stop_simple_updates_correct_key(self):
        rm, config = _make_rm()
        rm._level_states["stop_simple"] = LevelState.TRIGGERED
        rm.on_order_placed(order_id=400, result={"remaining": 5, "filled": 0}, config=config)

        fill_data = {"filled": 5.0, "remaining": 0, "status": "Filled", "avgFillPrice": 0.20}
        rm.on_fill(order_id=400, fill_data=fill_data, config=config)

        # Must update stop_simple (not stop_simple_0)
        assert rm._level_states.get("stop_simple") == LevelState.FILLED
        assert "stop_simple_0" not in rm._level_states

    def test_on_fill_trailing_updates_correct_key(self):
        rm, config = _make_rm()
        rm._level_states["trailing"] = LevelState.TRIGGERED
        rm._trailing_tranche_pending = True
        rm.on_order_placed(order_id=500, result={"remaining": 5, "filled": 0}, config=config)

        fill_data = {"filled": 5.0, "remaining": 0, "status": "Filled", "avgFillPrice": 3.00}
        rm.on_fill(order_id=500, fill_data=fill_data, config=config)

        # Should be FILLED (not trailing_0)
        assert rm._level_states.get("trailing") == LevelState.FILLED
        assert "trailing_0" not in rm._level_states


# ── Float-to-int fix ──

class TestFloatToIntFix:
    """remaining_qty decrement must use round() to handle float imprecision."""

    def test_float_fill_rounded_correctly(self):
        rm, config = _make_rm()
        rm.remaining_qty = 5
        rm._level_states["stop_simple"] = LevelState.TRIGGERED
        rm.on_order_placed(order_id=600, result={"remaining": 5, "filled": 0}, config=config)

        # Simulate a float that's slightly off from integer
        fill_data = {"filled": 2.9999999, "remaining": 0, "status": "Filled", "avgFillPrice": 0.50}
        rm.on_fill(order_id=600, fill_data=fill_data, config=config)

        # Should decrement by 3 (rounded), not 2 (truncated)
        assert rm.remaining_qty == 2
        # Fill log must agree with runtime decrement (RH-LOG-01)
        assert rm._fill_log[-1]["qty_filled"] == 3
        assert rm._fill_log[-1]["remaining_qty"] == 2
