"""Tests for per-ticker trade modes (Gate 0) and persistence."""
import json
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from unittest.mock import MagicMock

from execution_engine import (
    ActiveOrder,
    ExecutionEngine,
    OrderAction,
    OrderSide,
    OrderType,
    StrategyState,
    TickerMode,
)


@pytest.fixture
def mock_engine():
    scanner = MagicMock()
    quote_cache = MagicMock()
    resource_manager = MagicMock()
    engine = ExecutionEngine(scanner, quote_cache, resource_manager)
    return engine


# ── Enum ──


class TestTickerModeEnum:
    def test_values(self):
        assert TickerMode.NORMAL.value == "NORMAL"
        assert TickerMode.EXIT_ONLY.value == "EXIT_ONLY"
        assert TickerMode.NO_ORDERS.value == "NO_ORDERS"

    def test_from_string(self):
        assert TickerMode("NORMAL") == TickerMode.NORMAL
        assert TickerMode("EXIT_ONLY") == TickerMode.EXIT_ONLY
        assert TickerMode("NO_ORDERS") == TickerMode.NO_ORDERS

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            TickerMode("INVALID")


# ── Registry ──


class TestTickerModeRegistry:
    def test_default_is_normal(self, mock_engine):
        assert mock_engine.get_ticker_mode("SPY") == TickerMode.NORMAL

    def test_set_and_get(self, mock_engine):
        mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        assert mock_engine.get_ticker_mode("SPY") == TickerMode.EXIT_ONLY

    def test_get_all_modes(self, mock_engine):
        mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        mock_engine.set_ticker_mode("QQQ", TickerMode.NO_ORDERS)
        modes = mock_engine.get_all_ticker_modes()
        assert modes == {"SPY": "EXIT_ONLY", "QQQ": "NO_ORDERS"}

    def test_set_returns_result(self, mock_engine):
        result = mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        assert result["ticker"] == "SPY"
        assert result["mode"] == "EXIT_ONLY"
        assert result["old_mode"] == "NORMAL"


# ── NO_ORDERS cancel behavior ──


class TestNoOrdersCancellation:
    def test_no_orders_cancels_working_orders(self, mock_engine):
        mock_engine._active_orders[100] = ActiveOrder(
            order_id=100, strategy_id="bmc_spy_up", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result.get("orders_cancelled", 0) == 1
        mock_engine._scanner.cancelOrder.assert_called_once_with(100)

    def test_exit_only_does_not_cancel(self, mock_engine):
        mock_engine._active_orders[100] = ActiveOrder(
            order_id=100, strategy_id="bmc_spy_up", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        assert "orders_cancelled" not in result
        mock_engine._scanner.cancelOrder.assert_not_called()

    def test_only_cancels_matching_ticker(self, mock_engine):
        mock_engine._active_orders[100] = ActiveOrder(
            order_id=100, strategy_id="bmc_spy_up", status="Submitted", placed_at=0,
        )
        mock_engine._active_orders[200] = ActiveOrder(
            order_id=200, strategy_id="bmc_qqq_up", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        mock_engine._strategies["bmc_qqq_up"] = StrategyState(
            strategy_id="bmc_qqq_up", strategy=MagicMock(), config={}, ticker="QQQ",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result["orders_cancelled"] == 1
        mock_engine._scanner.cancelOrder.assert_called_once_with(100)

    def test_skips_filled_orders(self, mock_engine):
        mock_engine._active_orders[100] = ActiveOrder(
            order_id=100, strategy_id="bmc_spy_up", status="Filled", placed_at=0,
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result.get("orders_cancelled", 0) == 0
        mock_engine._scanner.cancelOrder.assert_not_called()


# ── Restore ──


class TestTickerModeRestore:
    def test_restore_from_dict(self, mock_engine):
        mock_engine.restore_ticker_modes({"SPY": "EXIT_ONLY", "QQQ": "NO_ORDERS"})
        assert mock_engine.get_ticker_mode("SPY") == TickerMode.EXIT_ONLY
        assert mock_engine.get_ticker_mode("QQQ") == TickerMode.NO_ORDERS

    def test_restore_invalid_mode_defaults(self, mock_engine):
        mock_engine.restore_ticker_modes({"SPY": "INVALID_MODE"})
        assert mock_engine.get_ticker_mode("SPY") == TickerMode.NORMAL

    def test_restore_empty_dict(self, mock_engine):
        mock_engine.restore_ticker_modes({})
        assert mock_engine.get_all_ticker_modes() == {}


# ── Persistence ──


class TestTickerModePersistence:
    def test_save_includes_ticker_modes(self, tmp_path):
        from engine_config_store import EngineConfigStore

        store = EngineConfigStore(path=str(tmp_path / "config.json"))
        store.save(
            engine_state="running",
            strategies=[],
            global_entry_cap=10,
            risk_budget_usd=0,
            reason="test",
            ticker_modes={"SPY": "EXIT_ONLY"},
        )
        data = json.loads((tmp_path / "config.json").read_text())
        assert data["ticker_modes"] == {"SPY": "EXIT_ONLY"}

    def test_save_without_ticker_modes_omits_key(self, tmp_path):
        from engine_config_store import EngineConfigStore

        store = EngineConfigStore(path=str(tmp_path / "config.json"))
        store.save(
            engine_state="running",
            strategies=[],
            global_entry_cap=10,
            risk_budget_usd=0,
            reason="test",
        )
        data = json.loads((tmp_path / "config.json").read_text())
        assert "ticker_modes" not in data

    def test_load_round_trip(self, tmp_path):
        from engine_config_store import EngineConfigStore

        store = EngineConfigStore(path=str(tmp_path / "config.json"))
        store.save(
            engine_state="running",
            strategies=[{"strategy_id": "bmc_spy_up", "config": {}}],
            global_entry_cap=5,
            risk_budget_usd=1000,
            reason="round_trip",
            ticker_modes={"SPY": "NO_ORDERS", "QQQ": "EXIT_ONLY"},
        )
        loaded = store.load()
        assert loaded is not None
        assert loaded["ticker_modes"] == {"SPY": "NO_ORDERS", "QQQ": "EXIT_ONLY"}
        assert loaded["global_entry_cap"] == 5


# ── Budget status includes ticker_modes ──


class TestBudgetStatusIncludesModes:
    def test_budget_status_has_ticker_modes(self, mock_engine):
        mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        status = mock_engine.get_budget_status()
        assert "ticker_modes" in status
        assert status["ticker_modes"]["SPY"] == "EXIT_ONLY"
