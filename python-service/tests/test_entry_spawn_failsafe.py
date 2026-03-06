"""Tests for RM spawn failure fail-safe and lineage hygiene."""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from big_move_convexity import BigMoveConvexityStrategy


def _make_bmc_config():
    """Minimal BMC config for testing on_fill."""
    return {
        "instrument": {"symbol": "SPY", "secType": "OPT"},
        "ticker": "SPY",
        "risk_preset": "intraday_convexity",
    }


class TestPendingLineageClear:
    """Test that _pending_lineage is consumed and cleared after on_fill."""

    def test_pending_lineage_cleared_after_consumption(self):
        """_pending_lineage should be None after on_fill consumes it."""
        bmc = BigMoveConvexityStrategy()
        bmc._ticker = "SPY"
        bmc._pending_lineage = {
            "signal_id": "test-signal-1",
            "model_version": "v1",
        }
        bmc._last_signal = {
            "option_contract": {
                "symbol": "SPY",
                "strike": 500,
                "expiry": "20260306",
                "right": "P",
            }
        }
        bmc._risk_config = {
            "preset": "intraday_convexity",
            "stop_loss_enabled": True,
            "stop_loss_type": "simple",
            "stop_loss_trigger_pct": -60.0,
            "trailing_enabled": True,
            "trailing_activation_pct": 40,
            "trailing_trail_pct": 25,
            "profit_targets_enabled": True,
            "profit_targets": [],
        }

        # Track what spawn was called with
        spawn_calls = []

        def mock_spawn(risk_config):
            spawn_calls.append(risk_config)
            return True

        bmc._spawn_risk_manager = mock_spawn

        fill_data = {
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 3,
            "permId": 12345,
        }
        bmc.on_fill(order_id=100, fill_data=fill_data, config=_make_bmc_config())

        # Lineage should be consumed
        assert bmc._pending_lineage is None
        # And it should have been passed to spawn
        assert len(spawn_calls) == 1
        assert "lineage" in spawn_calls[0]
        assert spawn_calls[0]["lineage"]["signal_id"] == "test-signal-1"

    def test_no_lineage_when_none_set(self):
        """When _pending_lineage is None, spawn should not include lineage key."""
        bmc = BigMoveConvexityStrategy()
        bmc._ticker = "SPY"
        bmc._pending_lineage = None
        bmc._last_signal = {
            "option_contract": {
                "symbol": "SPY",
                "strike": 500,
                "expiry": "20260306",
                "right": "P",
            }
        }
        bmc._risk_config = {
            "preset": "intraday_convexity",
            "stop_loss_enabled": True,
            "stop_loss_type": "simple",
            "stop_loss_trigger_pct": -60.0,
            "trailing_enabled": True,
            "trailing_activation_pct": 40,
            "trailing_trail_pct": 25,
            "profit_targets_enabled": True,
            "profit_targets": [],
        }

        spawn_calls = []

        def mock_spawn(risk_config):
            spawn_calls.append(risk_config)
            return True

        bmc._spawn_risk_manager = mock_spawn

        fill_data = {
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 3,
            "permId": 12345,
        }
        bmc.on_fill(order_id=100, fill_data=fill_data, config=_make_bmc_config())

        assert len(spawn_calls) == 1
        assert "lineage" not in spawn_calls[0]


class TestSpawnFailSafe:
    """Test that spawn failure is detected and logged appropriately."""

    def test_spawn_failure_logged_as_critical(self, caplog):
        """When spawn returns False, CRITICAL error is logged."""
        import logging

        bmc = BigMoveConvexityStrategy()
        bmc._ticker = "SPY"
        bmc._pending_lineage = None
        bmc._last_signal = {
            "option_contract": {
                "symbol": "SPY",
                "strike": 500,
                "expiry": "20260306",
                "right": "P",
            }
        }
        bmc._risk_config = {
            "preset": "intraday_convexity",
            "stop_loss_enabled": True,
            "stop_loss_type": "simple",
            "stop_loss_trigger_pct": -60.0,
            "trailing_enabled": True,
            "trailing_activation_pct": 40,
            "trailing_trail_pct": 25,
            "profit_targets_enabled": True,
            "profit_targets": [],
        }

        def failing_spawn(risk_config):
            return False

        bmc._spawn_risk_manager = failing_spawn

        fill_data = {
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 3,
            "permId": 12345,
        }

        with caplog.at_level(logging.ERROR):
            bmc.on_fill(order_id=100, fill_data=fill_data, config=_make_bmc_config())

        # Check that CRITICAL/ERROR log was emitted
        critical_msgs = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert len(critical_msgs) > 0
        assert any("UNMANAGED" in r.message for r in critical_msgs)

    def test_spawn_exception_logged_as_critical(self, caplog):
        """When spawn raises an exception, CRITICAL error is logged."""
        import logging

        bmc = BigMoveConvexityStrategy()
        bmc._ticker = "SPY"
        bmc._pending_lineage = None
        bmc._last_signal = {
            "option_contract": {
                "symbol": "SPY",
                "strike": 500,
                "expiry": "20260306",
                "right": "P",
            }
        }
        bmc._risk_config = {
            "preset": "intraday_convexity",
            "stop_loss_enabled": True,
            "stop_loss_type": "simple",
            "stop_loss_trigger_pct": -60.0,
            "trailing_enabled": True,
            "trailing_activation_pct": 40,
            "trailing_trail_pct": 25,
            "profit_targets_enabled": True,
            "profit_targets": [],
        }

        def exploding_spawn(risk_config):
            raise RuntimeError("Engine crashed!")

        bmc._spawn_risk_manager = exploding_spawn

        fill_data = {
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 3,
            "permId": 12345,
        }

        with caplog.at_level(logging.ERROR):
            bmc.on_fill(order_id=100, fill_data=fill_data, config=_make_bmc_config())

        critical_msgs = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert len(critical_msgs) > 0
        assert any("UNMANAGED" in r.message or "Engine crashed" in r.message for r in critical_msgs)

    def test_spawn_success_no_critical_log(self, caplog):
        """When spawn succeeds, no CRITICAL log should appear."""
        import logging

        bmc = BigMoveConvexityStrategy()
        bmc._ticker = "SPY"
        bmc._pending_lineage = None
        bmc._last_signal = {
            "option_contract": {
                "symbol": "SPY",
                "strike": 500,
                "expiry": "20260306",
                "right": "P",
            }
        }
        bmc._risk_config = {
            "preset": "intraday_convexity",
            "stop_loss_enabled": True,
            "stop_loss_type": "simple",
            "stop_loss_trigger_pct": -60.0,
            "trailing_enabled": True,
            "trailing_activation_pct": 40,
            "trailing_trail_pct": 25,
            "profit_targets_enabled": True,
            "profit_targets": [],
        }

        def ok_spawn(risk_config):
            return True

        bmc._spawn_risk_manager = ok_spawn

        fill_data = {
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 3,
            "permId": 12345,
        }

        with caplog.at_level(logging.ERROR):
            bmc.on_fill(order_id=100, fill_data=fill_data, config=_make_bmc_config())

        critical_msgs = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert len(critical_msgs) == 0
