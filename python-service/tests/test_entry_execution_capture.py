import os
import queue
import sys
import threading
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from big_move_convexity import BigMoveConvexityStrategy
from execution_engine import ExecutionEngine
from ib_data_agent import IBDataAgent


def _make_bmc_config():
    return {
        "instrument": {"symbol": "SPY", "secType": "OPT"},
        "ticker": "SPY",
        "risk_preset": "intraday_convexity",
    }


def test_bmc_on_fill_passes_execution_identity_to_spawn():
    bmc = BigMoveConvexityStrategy()
    bmc._ticker = "SPY"
    bmc._pending_lineage = None
    bmc._last_signal = {
        "option_contract": {
            "symbol": "SPY",
            "strike": 627.0,
            "expiry": "20260330",
            "right": "P",
        }
    }
    bmc._risk_config = {
        "preset": "intraday_convexity",
        "stop_loss_enabled": False,
        "stop_loss_type": "none",
        "stop_loss_trigger_pct": -5.0,
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

    bmc.on_fill(
        order_id=123,
        fill_data={
            "status": "Filled",
            "avgFillPrice": 1.50,
            "filled": 1,
            "permId": 162103040,
        },
        config=_make_bmc_config(),
    )

    assert len(spawn_calls) == 1
    position = spawn_calls[0]["position"]
    assert position["order_id"] == 123
    assert position["perm_id"] == 162103040
    assert position["quantity"] == 1
    assert position["entry_price"] == 1.50
    assert position["fill_time"] > 0


def test_build_entry_fill_record_uses_cached_exec_details():
    agent = object.__new__(IBDataAgent)
    agent.execution_engine = SimpleNamespace(
        _order_exec_ids={123: "0000fb2c.69c6877d.01.01"},
        _order_exec_details={
            123: {
                "execId": "0000fb2c.69c6877d.01.01",
                "exchange": "cboe",
                "lastLiquidity": 2,
                "permId": 162103040,
                "side": "BOT",
                "account": "DU123456",
            }
        },
        _order_pre_trade_snapshots={
            123: {
                "option_ask": 1.51,
                "option_mid": 1.50,
            }
        },
        _order_routing_exchanges={123: "SMART"},
        _order_contract_dicts={123: {"exchange": "SMART"}},
        _contract_exchange=lambda contract: str((contract or {}).get("exchange") or "").upper(),
    )

    fill = IBDataAgent._build_entry_fill_record(
        agent,
        {
            "order_id": 123,
            "fill_time": 1774619845.3772416,
            "quantity": 1,
            "entry_price": 1.50,
            "perm_id": 162103040,
        },
    )

    analytics = fill["execution_analytics"]
    assert fill["order_id"] == 123
    assert fill["exec_id"] == "0000fb2c.69c6877d.01.01"
    assert analytics["routing_exchange"] == "SMART"
    assert analytics["fill_exchange"] == "CBOE"
    assert analytics["exchange"] == "CBOE"
    assert analytics["last_liquidity"] == 2
    assert analytics["perm_id"] == 162103040
    assert analytics["side"] == "BOT"
    assert analytics["account"] == "DU123456"
    assert analytics["slippage"] == -0.01
    assert analytics["effective_spread"] == 0.0


def test_attach_entry_execution_tracking_registers_order_position_mapping():
    deferred_calls = []

    agent = object.__new__(IBDataAgent)
    agent.execution_engine = SimpleNamespace(
        _order_position_ids={},
        _exec_id_to_position={},
        _order_executor=SimpleNamespace(
            submit=lambda fn, *args: deferred_calls.append((fn, args))
        ),
        _deferred_commission_update=object(),
        _order_routing_exchanges={123: "SMART"},
        _order_contract_dicts={},
        _order_pre_trade_snapshots={},
        _contract_exchange=lambda contract: str((contract or {}).get("exchange") or "").upper(),
    )

    IBDataAgent._attach_entry_execution_tracking(
        agent,
        "bmc_risk_123",
        {"order_id": 123, "exec_id": "0000fb2c.69c6877d.01.01", "avg_price": 1.50, "time": 1774619845.3772416},
    )

    assert agent.execution_engine._order_position_ids[123] == "bmc_risk_123"
    assert agent.execution_engine._exec_id_to_position["0000fb2c.69c6877d.01.01"] == "bmc_risk_123"
    assert deferred_calls == [
        (
            agent.execution_engine._deferred_commission_update,
            ("bmc_risk_123", "0000fb2c.69c6877d.01.01"),
        )
    ]


def test_exec_event_routes_to_risk_manager_when_order_mapping_exists():
    updates = []
    deferred = []

    engine = object.__new__(ExecutionEngine)
    engine._order_event_queue = queue.Queue()
    engine._order_event_queue.put(
        (
            "exec",
            123,
            {
                "execId": "0000fb2c.69c6877d.01.01",
                "exchange": "CBOE",
                "lastLiquidity": 2,
                "permId": 162103040,
                "side": "BOT",
                "account": "DU123456",
                "shares": 1,
                "price": 1.50,
            },
        )
    )
    engine._order_strategy_map = {123: "bmc_spy"}
    engine._active_orders_lock = threading.Lock()
    engine._active_orders = {}
    engine._order_exec_ids = {}
    engine._exec_id_to_position = {}
    engine._order_exec_details = {}
    engine._order_position_ids = {123: "bmc_risk_123"}
    engine._position_store = SimpleNamespace(
        update_fill_execution_details=lambda position_id, order_id, **kwargs: updates.append(
            (position_id, order_id, kwargs)
        ) or True
    )
    engine._strategies = {
        "bmc_spy": SimpleNamespace(strategy=SimpleNamespace(), errors=[], config={})
    }
    engine._order_executor = SimpleNamespace(
        submit=lambda fn, *args: deferred.append((fn, args))
    )
    engine._deferred_commission_update = object()

    ExecutionEngine._drain_order_events(engine)

    assert engine._order_exec_ids[123] == "0000fb2c.69c6877d.01.01"
    assert engine._order_exec_details[123]["exchange"] == "CBOE"
    assert engine._exec_id_to_position["0000fb2c.69c6877d.01.01"] == "bmc_risk_123"
    assert updates[0][0] == "bmc_risk_123"
    assert updates[0][1] == 123
    assert deferred == [
        (
            engine._deferred_commission_update,
            ("bmc_risk_123", "0000fb2c.69c6877d.01.01"),
        )
    ]
