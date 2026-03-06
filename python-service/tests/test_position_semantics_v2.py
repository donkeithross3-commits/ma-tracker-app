"""Tests for Position Semantics V2 — cost basis and add_lot fix (WS-B).

Verifies that add_lot() averages against remaining_qty (open inventory)
instead of initial_qty (lifetime total), and that new fields are properly
serialized/deserialized.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from risk_manager import RiskManagerStrategy, LevelState


def _make_config(qty=10, entry_price=1.0):
    return {
        "instrument": {
            "symbol": "SPY", "secType": "OPT", "strike": 500,
            "right": "P", "expiry": "20260307",
        },
        "position": {"side": "LONG", "quantity": qty, "entry_price": entry_price},
        "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -80.0},
        "profit_taking": {
            "enabled": True, "targets": [],
            "trailing_stop": {"enabled": True, "activation_pct": 50, "trail_pct": 30},
        },
    }


def _make_rm(qty=10, entry_price=1.0):
    rm = RiskManagerStrategy()
    config = _make_config(qty, entry_price)
    rm.get_subscriptions(config)
    rm.on_start(config)
    return rm, config


class TestAddLotAfterPartialExit:
    """Core scenario: open 10@1.0, exit 5, add 5@2.0."""

    def test_cost_basis_averaged_against_remaining(self):
        """After partial exit, add_lot averages against remaining_qty."""
        rm, config = _make_rm(qty=10, entry_price=1.0)
        assert rm.remaining_qty == 10
        assert rm.entry_price == 1.0

        # Simulate exiting 5 contracts
        rm.remaining_qty = 5

        # Add 5 more at $2.00
        rm.add_lot(entry_price=2.0, quantity=5)

        # Cost basis: (1.0 * 5 + 2.0 * 5) / 10 = 1.50
        assert rm.remaining_qty == 10
        assert rm.entry_price == pytest.approx(1.5)

    def test_old_behavior_would_give_wrong_answer(self):
        """Verify the fix: old code would average against initial_qty=10."""
        rm, config = _make_rm(qty=10, entry_price=1.0)
        rm.remaining_qty = 5  # exit 5

        # Old code: (1.0 * 10 + 2.0 * 5) / 15 = 1.333...
        # New code: (1.0 * 5 + 2.0 * 5) / 10 = 1.5
        rm.add_lot(entry_price=2.0, quantity=5)
        assert rm.entry_price != pytest.approx(1.333, abs=0.01)  # NOT old behavior
        assert rm.entry_price == pytest.approx(1.5)              # IS new behavior


class TestAddLotNoPriorExit:
    """When no exits have happened, behavior is unchanged."""

    def test_add_lot_no_prior_exit(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        rm.add_lot(entry_price=2.0, quantity=5)

        # (1.0 * 5 + 2.0 * 5) / 10 = 1.5
        assert rm.remaining_qty == 10
        assert rm.entry_price == pytest.approx(1.5)


class TestPercentExitsUseRemainingQty:
    """Exit calculations must use remaining_qty, not initial_qty."""

    def test_percent_exit_uses_remaining(self):
        rm, config = _make_rm(qty=10, entry_price=1.0)
        rm.remaining_qty = 6

        # 50% of remaining (6) = 3
        qty = rm._compute_exit_qty(50)
        assert qty == 3

    def test_percent_exit_after_add_lot(self):
        rm, config = _make_rm(qty=10, entry_price=1.0)
        rm.remaining_qty = 5  # exit 5
        rm.add_lot(entry_price=2.0, quantity=5)
        assert rm.remaining_qty == 10

        # 50% of remaining (10) = 5
        qty = rm._compute_exit_qty(50)
        assert qty == 5


class TestLifetimeOpenedQty:
    """lifetime_opened_qty must be monotonic and track total contracts ever added."""

    def test_lifetime_monotonic(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        assert rm.lifetime_opened_qty == 5

        rm.add_lot(entry_price=2.0, quantity=3)
        assert rm.lifetime_opened_qty == 8

        rm.add_lot(entry_price=1.5, quantity=2)
        assert rm.lifetime_opened_qty == 10

    def test_lifetime_unaffected_by_exits(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        rm.remaining_qty = 2  # simulate exits
        assert rm.lifetime_opened_qty == 5  # unchanged

        rm.add_lot(entry_price=2.0, quantity=3)
        assert rm.lifetime_opened_qty == 8


class TestInitialQtyPeakRemaining:
    """initial_qty should track peak remaining for backward compat."""

    def test_initial_qty_is_peak_remaining(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        assert rm.initial_qty == 5

        rm.remaining_qty = 3  # exit some
        rm.add_lot(entry_price=2.0, quantity=4)
        # remaining = 7, which exceeds peak of 5
        assert rm.initial_qty == 7
        assert rm.remaining_qty == 7

    def test_initial_qty_does_not_decrease(self):
        rm, config = _make_rm(qty=10, entry_price=1.0)
        rm.remaining_qty = 3  # exit 7
        rm.add_lot(entry_price=2.0, quantity=2)
        # remaining = 5, but peak was 10
        assert rm.initial_qty == 10


class TestSnapshotRestoreV2:
    """New fields survive snapshot/restore cycle."""

    def test_snapshot_contains_lifetime_opened_qty(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        rm.add_lot(entry_price=2.0, quantity=3)

        snapshot = rm.get_runtime_snapshot()
        assert snapshot["lifetime_opened_qty"] == 8
        assert snapshot["remaining_qty"] == 8
        assert snapshot["initial_qty"] == 8

    def test_restore_preserves_new_fields(self):
        rm, config = _make_rm(qty=5, entry_price=1.0)
        rm.add_lot(entry_price=2.0, quantity=3)
        snapshot = rm.get_runtime_snapshot()

        # Restore into a new RM
        rm2 = RiskManagerStrategy()
        rm2.get_subscriptions(config)
        rm2.on_start(config)
        rm2.restore_runtime_state(snapshot)

        assert rm2.remaining_qty == 8
        assert rm2.initial_qty == 8
        assert rm2.lifetime_opened_qty == 8
        assert rm2.entry_price == pytest.approx(snapshot["entry_price"])

    def test_backward_compat_no_lifetime_field(self):
        """Pre-V2 snapshots without lifetime_opened_qty default to initial_qty."""
        rm, config = _make_rm(qty=5, entry_price=1.0)

        old_snapshot = {
            "remaining_qty": 3,
            "initial_qty": 5,
            "entry_price": 1.0,
            "high_water_mark": 1.5,
            "trailing_active": False,
            "trailing_stop_price": 0.0,
            "completed": False,
            "level_states": {"stop_simple": "ARMED", "trailing": "ARMED"},
            "trailing_tranche_idx": 0,
            "trailing_tranche_pending": False,
            "entry_timestamp": 1709700000.0,
        }
        rm.restore_runtime_state(old_snapshot)

        # lifetime_opened_qty defaults to initial_qty (5) for backward compat
        assert rm.lifetime_opened_qty == 5
        assert rm.remaining_qty == 3
