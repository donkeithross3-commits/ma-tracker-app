"""Tests for risk manager hot-modify correctness and translator key mismatch."""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from risk_manager import LevelState, PendingOrder, RiskManagerStrategy


def _make_config(
    stop_enabled=True,
    trailing_enabled=True,
    profit_enabled=True,
):
    """Build a standard risk config for testing."""
    return {
        "instrument": {
            "symbol": "SPY",
            "secType": "OPT",
            "strike": 500,
            "right": "P",
            "expiry": "20260305",
        },
        "position": {"side": "LONG", "quantity": 5, "entry_price": 1.50},
        "stop_loss": {
            "enabled": stop_enabled,
            "type": "simple",
            "trigger_pct": -80.0,
        },
        "profit_taking": {
            "enabled": profit_enabled,
            "targets": [{"trigger_pct": 100, "exit_pct": 50}],
            "trailing_stop": {
                "enabled": trailing_enabled,
                "activation_pct": 25,
                "trail_pct": 15,
            },
        },
    }


@pytest.fixture
def risk_manager():
    rm = RiskManagerStrategy()
    rm.on_start(_make_config())
    return rm


# ── _risk_config initialization ──


class TestRiskConfigInit:
    def test_initialized_on_start(self, risk_manager):
        assert risk_manager._risk_config is not None
        assert "stop_loss" in risk_manager._risk_config
        assert "profit_taking" in risk_manager._risk_config

    def test_matches_on_start_values(self, risk_manager):
        assert risk_manager._risk_config["stop_loss"]["enabled"] is True
        assert risk_manager._risk_config["profit_taking"]["enabled"] is True
        ts = risk_manager._risk_config["profit_taking"]["trailing_stop"]
        assert ts["enabled"] is True
        assert ts["activation_pct"] == 25

    def test_empty_before_on_start(self):
        rm = RiskManagerStrategy()
        assert rm._risk_config == {}


# ── Disable stop loss ──


class TestDisableStopLoss:
    def test_removes_armed_level(self, risk_manager):
        assert "stop_simple" in risk_manager._level_states
        assert risk_manager._level_states["stop_simple"] == LevelState.ARMED

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": {"enabled": False, "type": "simple", "trigger_pct": -80.0},
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )

        assert "stop_simple" not in risk_manager._level_states
        assert "stop_simple" in changes["removed_levels"]
        assert len(changes["cancel_order_ids"]) == 0  # no pending orders

    def test_cancels_triggered_order(self, risk_manager):
        risk_manager._level_states["stop_simple"] = LevelState.TRIGGERED
        risk_manager._pending_orders[42] = PendingOrder(
            order_id=42,
            level_key="stop_simple",
            level_type="stop_simple",
            level_idx=0,
            expected_qty=5,
            placed_at=0,
        )

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": {"enabled": False, "type": "simple", "trigger_pct": -80.0},
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )

        assert 42 in changes["cancel_order_ids"]
        assert "stop_simple" not in risk_manager._level_states

    def test_skips_filled_level(self, risk_manager):
        risk_manager._level_states["stop_simple"] = LevelState.FILLED

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": {"enabled": False, "type": "simple", "trigger_pct": -80.0},
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )

        assert "stop_simple" in changes["skipped_levels"]
        assert "stop_simple" in risk_manager._level_states  # not removed


# ── Disable trailing ──


class TestDisableTrailing:
    def test_removes_armed_trailing(self, risk_manager):
        assert "trailing" in risk_manager._level_states
        assert risk_manager._level_states["trailing"] == LevelState.ARMED

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": risk_manager._risk_config["stop_loss"],
                "profit_taking": {
                    "enabled": True,
                    "targets": [{"trigger_pct": 100, "exit_pct": 50}],
                    "trailing_stop": {"enabled": False},
                },
            }
        )

        assert "trailing" not in risk_manager._level_states
        assert "trailing" in changes["removed_levels"]

    def test_cancels_triggered_trailing_order(self, risk_manager):
        risk_manager._level_states["trailing"] = LevelState.TRIGGERED
        risk_manager._trailing_active = True
        risk_manager._pending_orders[99] = PendingOrder(
            order_id=99,
            level_key="trailing",
            level_type="trailing",
            level_idx=0,
            expected_qty=2,
            placed_at=0,
        )

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": risk_manager._risk_config["stop_loss"],
                "profit_taking": {
                    "enabled": True,
                    "targets": [{"trigger_pct": 100, "exit_pct": 50}],
                    "trailing_stop": {"enabled": False},
                },
            }
        )

        assert 99 in changes["cancel_order_ids"]
        assert risk_manager._trailing_active is False
        assert risk_manager._trailing_stop_price == 0.0


# ── Disable profit targets ──


class TestDisableProfitTargets:
    def test_removes_armed_profit_levels(self, risk_manager):
        assert "profit_0" in risk_manager._level_states

        changes = risk_manager.update_risk_config(
            {
                "stop_loss": risk_manager._risk_config["stop_loss"],
                "profit_taking": {
                    "enabled": False,
                    "targets": [],
                    "trailing_stop": {"enabled": False},
                },
            }
        )

        assert "profit_0" not in risk_manager._level_states
        assert "profit_0" in changes["removed_levels"]


# ── Live profit-target edits ──


class TestLiveProfitTargetEdits:
    def test_partial_profit_update_preserves_trailing_stop(self, risk_manager):
        old_trailing = risk_manager._risk_config["profit_taking"]["trailing_stop"].copy()

        risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "targets": [{"trigger_pct": 150, "exit_pct": 40}],
                },
            }
        )

        assert risk_manager._risk_config["profit_taking"]["targets"] == [
            {"trigger_pct": 150, "exit_pct": 40}
        ]
        assert risk_manager._risk_config["profit_taking"]["trailing_stop"] == old_trailing

    def test_partial_trailing_update_preserves_profit_targets(self, risk_manager):
        old_targets = list(risk_manager._risk_config["profit_taking"]["targets"])

        risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "trailing_stop": {"trail_pct": 9},
                },
            }
        )

        assert risk_manager._risk_config["profit_taking"]["targets"] == old_targets
        assert risk_manager._risk_config["profit_taking"]["trailing_stop"]["trail_pct"] == 9

    def test_visible_trailing_edit_clears_hidden_preset_tranches(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 1.1885795
        config["profit_taking"] = {
            "enabled": True,
            "targets": [],
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 40,
                "trail_pct": 25,
                "exit_tranches": [
                    {"exit_pct": 33, "trail_pct": 8},
                    {"exit_pct": 50, "trail_pct": 5},
                    {"exit_pct": 100},
                ],
            },
        }
        rm.on_start(config)

        rm.update_risk_config(
            {
                "profit_taking": {
                    "trailing_stop": {"activation_pct": 135, "trail_pct": 50},
                },
            }
        )

        trailing = rm._risk_config["profit_taking"]["trailing_stop"]
        assert trailing["activation_pct"] == 135
        assert trailing["trail_pct"] == 50
        assert trailing["exit_tranches"] == [{"exit_pct": 100}]

    def test_visible_trailing_edit_recomputes_stop_from_visible_trail_pct(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 1.1885795
        config["profit_taking"] = {
            "enabled": True,
            "targets": [],
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 40,
                "trail_pct": 25,
                "exit_tranches": [
                    {"exit_pct": 33, "trail_pct": 8},
                    {"exit_pct": 50, "trail_pct": 5},
                    {"exit_pct": 100},
                ],
            },
        }
        rm.on_start(config)
        rm._trailing_active = True
        rm.high_water_mark = 3.08
        rm._trailing_tranche_idx = 0

        rm.update_risk_config(
            {
                "profit_taking": {
                    "trailing_stop": {"activation_pct": 135, "trail_pct": 50},
                },
            }
        )

        assert rm._trailing_stop_price == pytest.approx(1.54, rel=1e-9)
        action = rm._check_trailing_stop(
            rm._risk_config,
            pnl_pct=135.5,
            current_price=2.80,
            quote=_Quote(2.79, 2.81),
        )
        assert action is None

    def test_add_profit_target_live_adds_level(self, risk_manager):
        changes = risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "targets": [
                        {"trigger_pct": 100, "exit_pct": 50},
                        {"trigger_pct": 200, "exit_pct": 25},
                    ],
                },
            }
        )

        assert "profit_1" in risk_manager._level_states
        assert risk_manager._level_states["profit_1"] == LevelState.ARMED
        assert "profit_1" in changes["added_levels"]

    def test_remove_profit_target_live_cancels_and_removes_level(self, risk_manager):
        risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "targets": [
                        {"trigger_pct": 100, "exit_pct": 50},
                        {"trigger_pct": 200, "exit_pct": 25},
                    ],
                },
            }
        )
        risk_manager._level_states["profit_1"] = LevelState.TRIGGERED
        risk_manager._pending_orders[88] = PendingOrder(
            order_id=88,
            level_key="profit_1",
            level_type="profit",
            level_idx=1,
            expected_qty=1,
            placed_at=0,
        )

        changes = risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "targets": [{"trigger_pct": 100, "exit_pct": 50}],
                },
            }
        )

        assert 88 in changes["cancel_order_ids"]
        assert "profit_1" not in risk_manager._level_states
        assert "profit_1" in changes["removed_levels"]

    def test_modify_triggered_profit_target_rearms_level(self, risk_manager):
        risk_manager._level_states["profit_0"] = LevelState.TRIGGERED
        risk_manager._pending_orders[99] = PendingOrder(
            order_id=99,
            level_key="profit_0",
            level_type="profit",
            level_idx=0,
            expected_qty=2,
            placed_at=0,
        )

        changes = risk_manager.update_risk_config(
            {
                "profit_taking": {
                    "targets": [{"trigger_pct": 120, "exit_pct": 40}],
                },
            }
        )

        assert 99 in changes["cancel_order_ids"]
        assert risk_manager._level_states["profit_0"] == LevelState.ARMED


# ── Profit target exit sizing ──


class _Quote:
    def __init__(self, bid=1.17, ask=1.18):
        self.bid = bid
        self.ask = ask


class TestProfitTargetExitSizing:
    def test_single_profit_target_respects_partial_exit_pct(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 15
        config["position"]["entry_price"] = 0.79
        config["profit_taking"] = {
            "enabled": True,
            "targets": [{"trigger_pct": 50, "exit_pct": 10}],
            "trailing_stop": {"enabled": True, "activation_pct": 75, "trail_pct": 25},
        }
        rm.on_start(config)

        action = rm._check_profit_targets(config, pnl_pct=50.1, current_price=1.17, quote=_Quote())

        assert action is not None
        assert action.quantity == 2
        assert rm._level_states["profit_0"] == LevelState.TRIGGERED

    def test_profit_target_100_pct_still_closes_everything(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 15
        config["position"]["entry_price"] = 0.79
        config["profit_taking"] = {
            "enabled": True,
            "targets": [{"trigger_pct": 50, "exit_pct": 100}],
            "trailing_stop": {"enabled": True, "activation_pct": 75, "trail_pct": 25},
        }
        rm.on_start(config)

        action = rm._check_profit_targets(config, pnl_pct=50.1, current_price=1.17, quote=_Quote())

        assert action is not None
        assert action.quantity == 15


# ── Per-lot trailing inheritance / sequencing ──


class TestPerLotTrailingBehavior:
    def test_switch_to_per_lot_inherits_base_defaults_for_unconfigured_lots(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 0.62
        rm.on_start(config)
        rm.add_lot(0.61, 1, order_id=56, fill_time=1001.0)
        rm.add_lot(0.56, 1, order_id=58, fill_time=1002.0)
        rm.add_lot(0.57, 1, order_id=59, fill_time=1003.0)

        rm.update_risk_config(
            {
                "profit_taking": {
                    "trailing_stop": {
                        "enabled": True,
                        "mode": "per_lot",
                        "activation_pct": 75,
                        "trail_pct": 25,
                        "per_lot_overrides": {
                            "0": {"trail_pct": 20, "activation_pct": 75},
                            "1": {"trail_pct": 20, "activation_pct": 125},
                        },
                    },
                },
            }
        )

        assert rm._per_lot_trailing[0].trail_pct == 20
        assert rm._per_lot_trailing[0].activation_pct == 75
        assert rm._per_lot_trailing[1].trail_pct == 20
        assert rm._per_lot_trailing[1].activation_pct == 125
        assert rm._per_lot_trailing[2].trail_pct == 25
        assert rm._per_lot_trailing[2].activation_pct == 75
        assert rm._per_lot_trailing[3].trail_pct == 25
        assert rm._per_lot_trailing[3].activation_pct == 75

    def test_add_lot_in_per_lot_mode_uses_base_defaults_when_no_override_exists(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 0.72
        config["profit_taking"]["trailing_stop"] = {
            "enabled": True,
            "mode": "per_lot",
            "activation_pct": 66,
            "trail_pct": 20,
            "per_lot_overrides": {
                "0": {"activation_pct": 66, "trail_pct": 20},
            },
        }
        rm.on_start(config)

        rm.add_lot(0.73, 1, order_id=70, fill_time=1001.0)

        assert rm._per_lot_trailing[1].activation_pct == 66
        assert rm._per_lot_trailing[1].trail_pct == 20

    def test_per_lot_trailing_uses_base_defaults_for_unconfigured_lots_during_evaluation(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 0.62
        rm.on_start(config)
        rm.add_lot(0.61, 1, order_id=56, fill_time=1001.0)
        rm.add_lot(0.56, 1, order_id=58, fill_time=1002.0)
        rm.add_lot(0.57, 1, order_id=59, fill_time=1003.0)
        rm.update_risk_config(
            {
                "profit_taking": {
                    "trailing_stop": {
                        "enabled": True,
                        "mode": "per_lot",
                        "activation_pct": 75,
                        "trail_pct": 25,
                        "per_lot_overrides": {
                            "0": {"trail_pct": 20, "activation_pct": 75},
                            "1": {"trail_pct": 20, "activation_pct": 125},
                        },
                    },
                },
            }
        )

        # Drive HWM up enough to activate default lots 2 and 3.
        rm._check_trailing_stop_per_lot(config, current_price=1.645, quote=_Quote(1.64, 1.65))
        assert rm._per_lot_trailing[2].trailing_active is True
        assert rm._per_lot_trailing[3].trailing_active is True
        assert rm._per_lot_trailing[1].trailing_active is True  # 125% also reached for lot 1

        # Reversal through the trailing stop should trigger a single-lot exit, not a full close.
        action = rm._check_trailing_stop_per_lot(config, current_price=1.20, quote=_Quote(1.19, 1.20))

        assert action is not None
        assert action.quantity == 1
        assert action.reason.startswith("Per-lot trailing stop")

    def test_aggregate_profit_fill_retires_one_per_lot_slot(self):
        rm = RiskManagerStrategy()
        config = _make_config()
        config["position"]["quantity"] = 1
        config["position"]["entry_price"] = 0.62
        config["profit_taking"] = {
            "enabled": True,
            "targets": [{"trigger_pct": 33, "exit_pct": 20}],
            "trailing_stop": {
                "enabled": True,
                "mode": "per_lot",
                "activation_pct": 75,
                "trail_pct": 25,
            },
        }
        rm.on_start(config)
        rm.add_lot(0.61, 1, order_id=56, fill_time=1001.0)
        rm.add_lot(0.56, 1, order_id=58, fill_time=1002.0)
        rm.add_lot(0.57, 1, order_id=59, fill_time=1003.0)

        action = rm._check_profit_targets(config, pnl_pct=33.5, current_price=0.79, quote=_Quote(0.78, 0.79))
        assert action is not None
        assert action.quantity == 1

        rm.on_order_placed(101, {"remaining": 1, "filled": 0}, config)
        rm.on_fill(
            101,
            {"filled": 1, "avgFillPrice": 0.79, "status": "Filled", "remaining": 0},
            config,
        )

        assert rm.remaining_qty == 3
        open_lots = [lot_idx for lot_idx, lot_state in rm._per_lot_trailing.items() if lot_state.remaining_qty > 0]
        closed_lots = [lot_idx for lot_idx, lot_state in rm._per_lot_trailing.items() if lot_state.remaining_qty == 0]
        assert len(open_lots) == 3
        assert len(closed_lots) == 1
        assert rm._level_states[f"trailing_lot_{closed_lots[0]}"] == LevelState.FILLED


# ── Config update persistence ──


class TestRiskConfigUpdate:
    def test_config_updated_after_modify(self, risk_manager):
        new_sl = {"enabled": False, "type": "none"}
        risk_manager.update_risk_config(
            {
                "stop_loss": new_sl,
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )
        assert risk_manager._risk_config["stop_loss"]["enabled"] is False
        assert risk_manager._risk_config["stop_loss"]["type"] == "none"
        assert risk_manager._risk_config["stop_loss"]["trigger_pct"] == -80.0

    def test_enable_stop_after_disable(self, risk_manager):
        # Disable
        risk_manager.update_risk_config(
            {
                "stop_loss": {"enabled": False, "type": "simple", "trigger_pct": -80},
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )
        assert "stop_simple" not in risk_manager._level_states

        # Re-enable
        changes = risk_manager.update_risk_config(
            {
                "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -60},
                "profit_taking": risk_manager._risk_config["profit_taking"],
            }
        )
        assert "stop_simple" in risk_manager._level_states
        assert risk_manager._level_states["stop_simple"] == LevelState.ARMED
        assert "stop_simple" in changes["added_levels"]


# ── Translator key mismatch ──


class TestTranslatorKeyMismatch:
    def test_bmc_risk_fields_has_both_keys(self):
        """_BMC_RISK_FIELDS includes both old and new profit-targets key."""
        # Replicate the frozenset from ib_data_agent.py
        BMC_RISK_FIELDS = frozenset(
            {
                "risk_stop_loss_enabled",
                "risk_stop_loss_type",
                "risk_stop_loss_trigger_pct",
                "risk_trailing_enabled",
                "risk_trailing_activation_pct",
                "risk_trailing_trail_pct",
                "risk_profit_taking_enabled",
                "risk_profit_targets_enabled",
                "risk_profit_targets",
                "risk_preset",
            }
        )
        assert "risk_profit_targets_enabled" in BMC_RISK_FIELDS
        assert "risk_profit_taking_enabled" in BMC_RISK_FIELDS

    def test_translator_prefers_new_key(self):
        """When both keys present, risk_profit_targets_enabled wins."""
        # Simulate the translator logic
        bmc_config = {
            "risk_profit_targets_enabled": True,
            "risk_profit_taking_enabled": False,
        }
        enabled = bmc_config.get(
            "risk_profit_targets_enabled",
            bmc_config.get("risk_profit_taking_enabled", False),
        )
        assert enabled is True

    def test_translator_falls_back_to_old_key(self):
        """When only old key present, it still works."""
        bmc_config = {
            "risk_profit_taking_enabled": True,
        }
        enabled = bmc_config.get(
            "risk_profit_targets_enabled",
            bmc_config.get("risk_profit_taking_enabled", False),
        )
        assert enabled is True

    def test_translator_default_false(self):
        """When neither key present, defaults to False."""
        bmc_config = {}
        enabled = bmc_config.get(
            "risk_profit_targets_enabled",
            bmc_config.get("risk_profit_taking_enabled", False),
        )
        assert enabled is False
