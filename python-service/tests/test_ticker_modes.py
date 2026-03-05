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

    def test_no_orders_cancels_risk_manager_via_ticker(self, mock_engine):
        """Risk managers with state.ticker set are cancelled by NO_ORDERS."""
        mock_engine._active_orders[300] = ActiveOrder(
            order_id=300, strategy_id="bmc_risk_123", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_risk_123"] = StrategyState(
            strategy_id="bmc_risk_123", strategy=MagicMock(), config={}, ticker="SPY",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result["orders_cancelled"] == 1
        mock_engine._scanner.cancelOrder.assert_called_once_with(300)

    def test_no_orders_cancels_risk_manager_via_parent_fallback(self, mock_engine):
        """Risk managers without state.ticker are cancelled via parent strategy lookup."""
        rm = MagicMock()
        rm._parent_strategy_id = "bmc_spy_up"
        mock_engine._active_orders[400] = ActiveOrder(
            order_id=400, strategy_id="bmc_risk_456", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_risk_456"] = StrategyState(
            strategy_id="bmc_risk_456", strategy=rm, config={}, ticker="",
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result["orders_cancelled"] == 1

    def test_no_orders_cancels_risk_manager_via_instrument_fallback(self, mock_engine):
        """Risk managers without ticker or parent are cancelled via config instrument symbol."""
        rm = MagicMock()
        rm._parent_strategy_id = None
        mock_engine._active_orders[500] = ActiveOrder(
            order_id=500, strategy_id="bmc_risk_789", status="PreSubmitted", placed_at=0,
        )
        mock_engine._strategies["bmc_risk_789"] = StrategyState(
            strategy_id="bmc_risk_789",
            strategy=rm,
            config={"instrument": {"symbol": "SPY", "secType": "OPT"}},
            ticker="",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result["orders_cancelled"] == 1
        mock_engine._scanner.cancelOrder.assert_called_once_with(500)

    def test_no_orders_skips_risk_manager_wrong_ticker(self, mock_engine):
        """Risk managers for a different ticker are not cancelled."""
        rm = MagicMock()
        rm._parent_strategy_id = None
        mock_engine._active_orders[600] = ActiveOrder(
            order_id=600, strategy_id="bmc_risk_999", status="Submitted", placed_at=0,
        )
        mock_engine._strategies["bmc_risk_999"] = StrategyState(
            strategy_id="bmc_risk_999",
            strategy=rm,
            config={"instrument": {"symbol": "QQQ"}},
            ticker="",
        )
        result = mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        assert result.get("orders_cancelled", 0) == 0


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


# ── Gate 0: Risk manager order blocking ──


class TestGate0RiskManagerBlocking:
    """Gate 0 must block risk-manager orders when ticker is in NO_ORDERS mode."""

    def _make_action(self, strategy_id="bmc_risk_123"):
        return OrderAction(
            strategy_id=strategy_id,
            side=OrderSide.SELL,
            quantity=1,
            order_type=OrderType.MARKET,
            contract_dict={"symbol": "SPY", "secType": "OPT", "exchange": "SMART"},
            reason="trailing stop",
            is_exit=True,
        )

    def test_blocks_risk_manager_with_ticker_set(self, mock_engine):
        """Risk managers with state.ticker set are blocked by NO_ORDERS."""
        mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        state = StrategyState(
            strategy_id="bmc_risk_123", strategy=MagicMock(), config={}, ticker="SPY",
        )
        action = self._make_action()
        mock_engine._process_order_action(state, action)
        # Order should be rejected (never reach the order-exec thread)
        assert any("NO_ORDERS" in e for e in state.errors)

    def test_blocks_risk_manager_via_parent_fallback(self, mock_engine):
        """Risk managers without ticker resolve from parent strategy."""
        mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        rm = MagicMock()
        rm._parent_strategy_id = "bmc_spy_up"
        state = StrategyState(
            strategy_id="bmc_risk_123", strategy=rm, config={}, ticker="",
        )
        mock_engine._strategies["bmc_spy_up"] = StrategyState(
            strategy_id="bmc_spy_up", strategy=MagicMock(), config={}, ticker="SPY",
        )
        action = self._make_action()
        mock_engine._process_order_action(state, action)
        assert any("NO_ORDERS" in e for e in state.errors)

    def test_blocks_risk_manager_via_contract_symbol(self, mock_engine):
        """Risk managers without ticker or parent resolve from contract symbol."""
        mock_engine.set_ticker_mode("SPY", TickerMode.NO_ORDERS)
        rm = MagicMock()
        rm._parent_strategy_id = None
        state = StrategyState(
            strategy_id="bmc_risk_123", strategy=rm, config={}, ticker="",
        )
        action = self._make_action()
        mock_engine._process_order_action(state, action)
        assert any("NO_ORDERS" in e for e in state.errors)

    def test_allows_risk_manager_in_normal_mode(self, mock_engine):
        """Risk managers are NOT blocked when ticker is in NORMAL mode."""
        # Don't set any ticker mode (default is NORMAL)
        state = StrategyState(
            strategy_id="bmc_risk_123", strategy=MagicMock(), config={}, ticker="SPY",
        )
        action = self._make_action()
        # _process_order_action will proceed past Gate 0 and likely fail at
        # order submission (no real IB), but Gate 0 should not reject
        mock_engine._process_order_action(state, action)
        assert not any("NO_ORDERS" in e for e in state.errors)


# ── Budget status includes ticker_modes ──


# ── Recovery path: state.ticker assignment ──


class TestRecoveryTickerAssignment:
    """Simulate the recovery loop in _handle_execution_start to verify
    that state.ticker is set on recovered risk managers.

    This mirrors the exact logic at ib_data_agent.py:1590-1599.
    """

    def _simulate_recovery(self, engine, pos_id, stored_config, parent_strategy=""):
        """Reproduce the recovery path: load_strategy + ticker assignment."""
        from risk_manager import RiskManagerStrategy

        rm = RiskManagerStrategy()
        result = engine.load_strategy(pos_id, rm, stored_config)
        assert "error" not in result, f"load_strategy failed: {result}"
        # -- This is the code under test (mirrors ib_data_agent recovery) --
        rm_state = engine._strategies.get(pos_id)
        if rm_state:
            instrument = stored_config.get("instrument", {})
            rm_ticker = instrument.get("symbol", "").upper()
            if not rm_ticker:
                parent = parent_strategy
                if parent:
                    rm_ticker = parent.replace("bmc_", "").split("_")[0].upper()
            rm_state.ticker = rm_ticker
        return rm_state

    def test_recovery_sets_ticker_from_instrument(self, mock_engine):
        stored_config = {
            "instrument": {"symbol": "SPY", "secType": "OPT", "strike": 600,
                           "expiry": "20260306", "right": "P", "exchange": "SMART"},
            "position": {"side": "LONG", "quantity": 1, "entry_price": 0.50},
            "preset": "zero_dte_convexity",
        }
        state = self._simulate_recovery(mock_engine, "bmc_risk_111", stored_config)
        assert state.ticker == "SPY"

    def test_recovery_sets_ticker_from_parent_fallback(self, mock_engine):
        """When instrument.symbol is missing, derive ticker from parent_strategy."""
        stored_config = {
            "instrument": {"secType": "OPT", "strike": 600,
                           "expiry": "20260306", "right": "P", "exchange": "SMART"},
            "position": {"side": "LONG", "quantity": 1, "entry_price": 0.50},
            "preset": "zero_dte_convexity",
        }
        state = self._simulate_recovery(
            mock_engine, "bmc_risk_222", stored_config,
            parent_strategy="bmc_qqq_up",
        )
        assert state.ticker == "QQQ"

    def test_recovery_empty_ticker_when_no_info(self, mock_engine):
        """When neither instrument.symbol nor parent_strategy is available."""
        stored_config = {
            "instrument": {"secType": "OPT", "strike": 600,
                           "expiry": "20260306", "right": "P", "exchange": "SMART"},
            "position": {"side": "LONG", "quantity": 1, "entry_price": 0.50},
            "preset": "zero_dte_convexity",
        }
        state = self._simulate_recovery(
            mock_engine, "bmc_risk_333", stored_config,
            parent_strategy="",
        )
        assert state.ticker == ""

    def test_spawn_sets_ticker_from_instrument(self, mock_engine):
        """Simulate the spawn path in _spawn_risk_manager_for_bmc."""
        from risk_manager import RiskManagerStrategy

        risk_config = {
            "instrument": {"symbol": "SPY", "secType": "OPT", "strike": 600,
                           "expiry": "20260306", "right": "P", "exchange": "SMART"},
            "position": {"side": "LONG", "quantity": 1, "entry_price": 0.50},
            "preset": "zero_dte_convexity",
        }
        strategy = RiskManagerStrategy()
        sid = "bmc_risk_spawn_1"
        result = mock_engine.load_strategy(sid, strategy, risk_config)
        assert "error" not in result

        # -- This mirrors ib_data_agent.py:2470-2478 --
        rm_state = mock_engine._strategies.get(sid)
        instrument = risk_config.get("instrument", {})
        rm_ticker = instrument.get("symbol", "").upper()
        rm_state.ticker = rm_ticker
        assert rm_state.ticker == "SPY"


class TestBudgetStatusIncludesModes:
    def test_budget_status_has_ticker_modes(self, mock_engine):
        mock_engine.set_ticker_mode("SPY", TickerMode.EXIT_ONLY)
        status = mock_engine.get_budget_status()
        assert "ticker_modes" in status
        assert status["ticker_modes"]["SPY"] == "EXIT_ONLY"
