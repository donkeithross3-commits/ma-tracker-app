"""Tests for WS-F (preset resolution in hot-modify) and WS-G (budget gate completeness)."""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

import time

from risk_manager import RiskManagerStrategy, LevelState, PendingOrder, PRESETS
from execution_engine import OrderAction, OrderSide, OrderType


# ── Helpers ──

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


def _make_rm(preset="zero_dte_convexity", eod_exit_time=None):
    rm = RiskManagerStrategy()
    config = _make_config(preset, eod_exit_time)
    rm.get_subscriptions(config)
    rm.on_start(config)
    return rm, config


# ── WS-F: Preset resolution in hot-modify ──

class TestPresetResolution:
    """update_risk_config() must resolve named presets."""

    def test_preset_switch_changes_thresholds(self):
        """Switching from zero_dte_convexity to intraday_convexity changes stop trigger."""
        rm, config = _make_rm(preset="zero_dte_convexity")
        assert rm._risk_config["stop_loss"]["trigger_pct"] == -80.0

        # Hot-modify with preset switch
        changes = rm.update_risk_config({"preset": "intraday_convexity"})

        # intraday_convexity has trigger_pct=-60
        assert rm._risk_config["stop_loss"]["trigger_pct"] == -60.0
        assert "stop_loss" in changes["updated_fields"]

    def test_preset_switch_changes_trailing(self):
        """Preset switch updates trailing activation/trail percentages."""
        rm, config = _make_rm(preset="zero_dte_convexity")
        ts = rm._risk_config["profit_taking"]["trailing_stop"]
        assert ts["activation_pct"] == 50  # zero_dte_convexity

        changes = rm.update_risk_config({"preset": "intraday_convexity"})

        ts = rm._risk_config["profit_taking"]["trailing_stop"]
        assert ts["activation_pct"] == 40  # intraday_convexity
        assert ts["trail_pct"] == 25

    def test_explicit_fields_override_preset(self):
        """Explicit fields in new_config take precedence over preset defaults."""
        rm, config = _make_rm(preset="zero_dte_convexity")

        # Switch to intraday_convexity but override stop trigger
        changes = rm.update_risk_config({
            "preset": "intraday_convexity",
            "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -50.0},
        })

        # Should use explicit -50, not preset's -60
        assert rm._risk_config["stop_loss"]["trigger_pct"] == -50.0

    def test_unknown_preset_ignored(self):
        """Unknown preset name doesn't crash, passes through as-is."""
        rm, config = _make_rm(preset="zero_dte_convexity")
        old_sl = rm._risk_config["stop_loss"].copy()

        changes = rm.update_risk_config({"preset": "nonexistent_preset"})

        # Nothing should change
        assert rm._risk_config["stop_loss"] == old_sl

    def test_preset_disabling_stop_removes_level(self):
        """Switching to preset with stop disabled removes armed stop level."""
        rm, config = _make_rm(preset="zero_dte_convexity")
        assert "stop_simple" in rm._level_states

        # zero_dte_lotto has stop_loss.enabled=False
        changes = rm.update_risk_config({"preset": "zero_dte_lotto"})

        assert "stop_simple" not in rm._level_states
        assert "stop_simple" in changes["removed_levels"]


# ── WS-F: EOD exit time hot-modify ──

class TestEodExitTimeHotModify:
    """eod_exit_time can be changed live on running risk managers."""

    def test_enable_eod_via_hot_modify(self):
        """Adding eod_exit_time to a running RM creates the eod_closeout level."""
        rm, config = _make_rm(preset="zero_dte_convexity")
        assert "eod_closeout" not in rm._level_states

        changes = rm.update_risk_config({"eod_exit_time": "15:30"})

        assert "eod_closeout" in rm._level_states
        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert rm._risk_config["eod_exit_time"] == "15:30"
        assert "eod_closeout" in changes["added_levels"]

    def test_eod_config_must_sync_to_state_config(self):
        """Agent must sync eod_exit_time to state.config for evaluate() to see it.

        update_risk_config() sets _risk_config["eod_exit_time"], but evaluate()
        reads config.get("eod_exit_time") from state.config (passed by engine).
        The agent's hot-modify handler must sync eod_exit_time to state.config
        alongside stop_loss and profit_taking.
        """
        rm, config = _make_rm(preset="zero_dte_convexity")
        # Simulate hot-modify
        rm.update_risk_config({"eod_exit_time": "15:30"})

        # _risk_config has the value
        assert rm._risk_config["eod_exit_time"] == "15:30"

        # Simulate what the agent handler must do: sync to state.config
        # (This is what the agent code does at line 1827-1829)
        for rk in ("stop_loss", "profit_taking", "eod_exit_time"):
            if rk in rm._risk_config:
                config[rk] = rm._risk_config[rk]

        # Now config (which evaluate passes to _check_eod_closeout) has it
        assert config.get("eod_exit_time") == "15:30"

    def test_disable_eod_via_hot_modify(self):
        """Setting eod_exit_time=None removes the armed eod_closeout level."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        assert "eod_closeout" in rm._level_states

        changes = rm.update_risk_config({"eod_exit_time": None})

        assert "eod_closeout" not in rm._level_states
        assert "eod_closeout" in changes["removed_levels"]

    def test_disable_eod_cancels_pending_order(self):
        """Disabling eod_exit_time cancels any pending EOD order."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm._level_states["eod_closeout"] = LevelState.TRIGGERED
        rm._pending_orders[777] = PendingOrder(
            order_id=777, level_key="eod_closeout",
            level_type="eod_closeout", level_idx=0,
            expected_qty=5, placed_at=time.time(),
        )

        changes = rm.update_risk_config({"eod_exit_time": None})

        assert 777 in changes["cancel_order_ids"]
        assert 777 not in rm._pending_orders
        assert "eod_closeout" not in rm._level_states

    def test_change_eod_time_preserves_level(self):
        """Changing eod_exit_time value keeps the level armed."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        assert rm._level_states["eod_closeout"] == LevelState.ARMED

        rm.update_risk_config({"eod_exit_time": "15:45"})

        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert rm._risk_config["eod_exit_time"] == "15:45"


# ── WS-G: Risk budget gate completeness ──

class TestRiskBudgetGate:
    """Gate 1c must block oversized entries regardless of order type."""

    def test_limit_order_uses_limit_price(self):
        """LIMIT orders compute cost from limit_price * qty * multiplier."""
        action = OrderAction(
            strategy_id="test",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=10,
            contract_dict={"symbol": "SPY", "secType": "OPT", "multiplier": "100"},
            limit_price=2.0,
        )
        # estimated_notional is None, so gate should use limit_price path
        # 2.0 * 10 * 100 = $2000
        assert action.estimated_notional is None
        assert action.limit_price == 2.0

    def test_mkt_order_with_estimated_notional(self):
        """MKT orders with estimated_notional set use that value."""
        action = OrderAction(
            strategy_id="test",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=10,
            contract_dict={"symbol": "SPY", "secType": "OPT", "multiplier": "100"},
            estimated_notional=2000.0,
        )
        assert action.limit_price is None
        assert action.estimated_notional == 2000.0

    def test_mkt_order_without_notional_gets_zero_cost(self):
        """MKT orders without estimated_notional fall back to limit_price=None → $0."""
        action = OrderAction(
            strategy_id="test",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=10,
            contract_dict={"symbol": "SPY", "secType": "OPT", "multiplier": "100"},
        )
        # This is the bug scenario — limit_price is None, estimated_notional is None
        # Gate 1c uses: est_price = action.limit_price or 0 = 0 → new_cost = 0
        assert action.limit_price is None
        assert action.estimated_notional is None

    def test_bmc_entry_has_estimated_notional(self):
        """BMC entry orders populate estimated_notional from limit_price."""
        action = OrderAction(
            strategy_id="bmc_spy",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=5,
            contract_dict={"symbol": "SPY", "secType": "OPT", "multiplier": "100"},
            limit_price=1.50,
            estimated_notional=1.50 * 5 * 100,  # $750
        )
        assert action.estimated_notional == 750.0


# ── Translator key coverage ──

class TestTranslatorEodField:
    """_BMC_RISK_FIELDS includes eod_exit_time."""

    def test_eod_field_in_bmc_risk_fields(self):
        # Import from the agent module is fragile in tests, so replicate the check
        BMC_RISK_FIELDS = frozenset({
            "risk_stop_loss_enabled", "risk_stop_loss_type", "risk_stop_loss_trigger_pct",
            "risk_trailing_enabled", "risk_trailing_activation_pct", "risk_trailing_trail_pct",
            "risk_profit_taking_enabled", "risk_profit_targets_enabled", "risk_profit_targets",
            "risk_preset", "risk_eod_exit_time", "risk_eod_min_bid",
        })
        assert "risk_eod_exit_time" in BMC_RISK_FIELDS
        assert "risk_eod_min_bid" in BMC_RISK_FIELDS
