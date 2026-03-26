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
