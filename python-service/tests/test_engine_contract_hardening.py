"""Scenario tests for contract ownership, reservations, and recovery hardening."""
import os
import sys
import tempfile
from concurrent.futures import Future

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from execution_engine import ExecutionEngine, OrderAction, OrderSide, OrderType
from ib_data_agent import IBDataAgent
from position_store import PositionStore
from risk_manager import LevelState, RiskManagerStrategy


class ImmediateExecutor:
    """Runs executor tasks synchronously for deterministic tests."""

    def submit(self, fn, *args, **kwargs):
        future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except Exception as exc:  # pragma: no cover - parity with real executor
            future.set_exception(exc)
        return future

    def shutdown(self, wait=True):
        return None


class MockQuoteCache:
    def __init__(self):
        self._next_req_id = 1

    def subscribe(self, *args, **kwargs):
        req_id = self._next_req_id
        self._next_req_id += 1
        return req_id

    def unsubscribe(self, *args, **kwargs):
        return None

    def unsubscribe_all(self, *args, **kwargs):
        return None

    def get(self, key):
        return None

    def get_all_serialized(self):
        return {}


class MockScanner:
    connection_lost = False

    def __init__(self, order_results=None):
        self.order_results = list(order_results or [])
        self.order_requests = []
        self.cancelled_orders = []

    def place_order_sync(self, contract_dict, order_dict, timeout_sec=0.0, pre_submit_callback=None):
        result = dict(self.order_results.pop(0))
        self.order_requests.append({
            "contract": dict(contract_dict),
            "order": dict(order_dict),
        })
        order_id = result.get("orderId")
        if order_id and pre_submit_callback:
            pre_submit_callback(order_id)
        return result

    def cancelOrder(self, order_id):
        self.cancelled_orders.append(order_id)

    def add_order_status_listener(self, listener):
        return None

    def add_exec_details_listener(self, listener):
        return None

    def remove_order_status_listener(self, listener):
        return None

    def remove_exec_details_listener(self, listener):
        return None

    def get_commission_report(self, exec_id):
        return None


class MockResourceManager:
    execution_lines_held = 0
    available_for_scan = 50

    def allocate_execution_lines(self, n):
        return n

    def release_execution_lines(self, n):
        return None

    @property
    def scan_batch_size(self):
        return 50


class MutablePositionStore:
    def __init__(self, positions=None):
        self._positions = {p["id"]: p for p in (positions or [])}

    def get_all_positions(self):
        return list(self._positions.values())

    def get_active_positions(self):
        return [p for p in self._positions.values() if p.get("status") == "active"]

    def get_position(self, position_id):
        return self._positions.get(position_id)

    def update_runtime_state(self, position_id, state_dict):
        self._positions[position_id]["runtime_state"] = state_dict

    def update_entry(self, position_id, entry_updates):
        self._positions[position_id].setdefault("entry", {}).update(entry_updates)

    def update_risk_config(self, position_id, risk_updates):
        self._positions[position_id].setdefault("risk_config", {}).update(risk_updates)

    def mark_closed(self, position_id, exit_reason=""):
        self._positions[position_id]["status"] = "closed"
        self._positions[position_id]["exit_reason"] = exit_reason

    def add_fill(self, position_id, fill_dict):
        self._positions[position_id].setdefault("fill_log", []).append(fill_dict)

    def purge_phantom_entry_fills(self):
        return 0


class FakeQuote:
    def __init__(self, bid=1.0, ask=1.2, last=1.1):
        self.bid = bid
        self.ask = ask
        self.last = last
        self.mid = (bid + ask) / 2.0 if bid > 0 and ask > 0 else last


def make_instrument(symbol="SPY", strike=647, expiry="20260326", right="P"):
    return {
        "symbol": symbol,
        "secType": "OPT",
        "exchange": "SMART",
        "currency": "USD",
        "strike": float(strike),
        "expiry": expiry,
        "right": right,
    }


def make_contract_dict(instrument):
    return {
        "symbol": instrument["symbol"],
        "secType": instrument.get("secType", "OPT"),
        "exchange": instrument.get("exchange", "SMART"),
        "currency": instrument.get("currency", "USD"),
        "strike": instrument["strike"],
        "lastTradeDateOrContractMonth": instrument["expiry"],
        "right": instrument["right"],
        "multiplier": "100",
    }


def make_ib_position(instrument, qty, avg_cost=150.0):
    return {
        "account": "DU123456",
        "contract": make_contract_dict(instrument),
        "position": qty,
        "avgCost": avg_cost,
    }


def make_rm_config(
    *,
    instrument,
    qty,
    entry_price=1.5,
    trailing_mode="uniform",
    targets=None,
    exit_tranches=None,
):
    trailing_stop = {
        "enabled": True,
        "activation_pct": 0,
        "trail_pct": 10,
        "mode": trailing_mode,
    }
    if exit_tranches is not None:
        trailing_stop["exit_tranches"] = exit_tranches
    return {
        "instrument": instrument,
        "position": {
            "side": "LONG",
            "quantity": qty,
            "entry_price": entry_price,
        },
        "stop_loss": {"enabled": False, "type": "simple", "trigger_pct": -80.0},
        "profit_taking": {
            "enabled": True,
            "targets": list(targets or []),
            "trailing_stop": trailing_stop,
        },
    }


def make_store_position(position_id, *, instrument, qty, entry_price=1.5, risk_config=None, runtime_state=None, parent_strategy="bmc_spy"):
    return {
        "id": position_id,
        "status": "active",
        "instrument": dict(instrument),
        "entry": {
            "order_id": 1000,
            "price": entry_price,
            "quantity": qty,
            "fill_time": 1_700_000_000.0,
            "perm_id": 1000,
        },
        "runtime_state": runtime_state or {"remaining_qty": qty, "initial_qty": qty},
        "risk_config": risk_config or make_rm_config(instrument=instrument, qty=qty, entry_price=entry_price),
        "fill_log": [],
        "parent_strategy": parent_strategy,
    }


def make_engine(position_store, *, order_results=None):
    scanner = MockScanner(order_results=order_results)
    engine = ExecutionEngine(
        scanner=scanner,
        quote_cache=MockQuoteCache(),
        resource_manager=MockResourceManager(),
        position_store=position_store,
    )
    engine._order_executor = ImmediateExecutor()
    return engine, scanner


def load_risk_manager(engine, *, position_id, instrument, qty, entry_price=1.5, trailing_mode="uniform", targets=None, exit_tranches=None):
    config = make_rm_config(
        instrument=instrument,
        qty=qty,
        entry_price=entry_price,
        trailing_mode=trailing_mode,
        targets=targets,
        exit_tranches=exit_tranches,
    )
    rm = RiskManagerStrategy()
    result = engine.load_strategy(position_id, rm, config)
    assert "error" not in result
    state = engine._strategies[position_id]
    state.ticker = instrument["symbol"]
    return rm, state, config


def make_exit_action(strategy_id, instrument, qty):
    return OrderAction(
        strategy_id=strategy_id,
        side=OrderSide.SELL,
        order_type=OrderType.MARKET,
        quantity=qty,
        contract_dict=make_contract_dict(instrument),
        reason="test-exit",
        is_exit=True,
    )


def test_duplicate_active_contracts_fail_closed():
    instrument = make_instrument()
    store = MutablePositionStore([
        make_store_position("bmc_risk_dup_a", instrument=instrument, qty=1),
        make_store_position("bmc_risk_dup_b", instrument=instrument, qty=1),
    ])
    engine, scanner = make_engine(
        store,
        order_results=[{"orderId": 501, "status": "Submitted", "remaining": 1, "filled": 0.0}],
    )
    _, state, _ = load_risk_manager(
        engine,
        position_id="bmc_risk_dup_a",
        instrument=instrument,
        qty=1,
    )

    report = engine.reconcile_with_ib([make_ib_position(instrument, qty=1)])

    assert len(report["duplicate_agent"]) == 1
    assert set(report["duplicate_agent"][0]["position_ids"]) == {
        "bmc_risk_dup_a",
        "bmc_risk_dup_b",
    }

    engine._process_order_action(state, make_exit_action(state.strategy_id, instrument, 1))

    assert scanner.order_requests == []
    assert any("Automated exits are blocked fail-closed" in msg for msg in state.errors)


def test_exit_reservation_blocks_second_competing_exit_after_first_submission():
    instrument = make_instrument()
    store = MutablePositionStore([
        make_store_position("bmc_risk_spy_647", instrument=instrument, qty=1),
    ])
    engine, scanner = make_engine(
        store,
        order_results=[{"orderId": 601, "status": "Submitted", "remaining": 1, "filled": 0.0}],
    )
    _, state, _ = load_risk_manager(
        engine,
        position_id="bmc_risk_spy_647",
        instrument=instrument,
        qty=1,
    )

    engine.reconcile_with_ib([make_ib_position(instrument, qty=1)])

    engine._process_order_action(state, make_exit_action(state.strategy_id, instrument, 1))
    engine._process_order_action(state, make_exit_action(state.strategy_id, instrument, 1))

    assert len(scanner.order_requests) == 1
    assert scanner.order_requests[0]["order"]["totalQuantity"] == 1
    assert engine.get_status()["managed_contracts"][0]["reserved_exit_qty"] == 1
    assert any("broker_qty=1, reserved=1" in msg for msg in state.errors)


def test_manual_partial_close_reconciliation_clamps_follow_on_exits():
    instrument = make_instrument(strike=648)
    store = MutablePositionStore([
        make_store_position("bmc_risk_spy_648", instrument=instrument, qty=3),
    ])
    engine, scanner = make_engine(
        store,
        order_results=[{"orderId": 701, "status": "Submitted", "remaining": 2, "filled": 0.0}],
    )
    rm, state, _ = load_risk_manager(
        engine,
        position_id="bmc_risk_spy_648",
        instrument=instrument,
        qty=3,
    )

    report = engine.reconcile_with_ib([make_ib_position(instrument, qty=2)])

    assert rm.remaining_qty == 2
    assert report["adjusted"][0]["adjustment_kind"] == "manual_external_reduction"
    assert report["manual_external"][0]["event"] == "partial_close"

    engine._process_order_action(state, make_exit_action(state.strategy_id, instrument, 2))
    engine._process_order_action(state, make_exit_action(state.strategy_id, instrument, 1))

    assert len(scanner.order_requests) == 1
    assert scanner.order_requests[0]["order"]["totalQuantity"] == 2
    assert any("broker_qty=2, reserved=2" in msg for msg in state.errors)


def test_grouped_exit_retirements_prevent_follow_on_per_lot_oversell():
    instrument = make_instrument(strike=649)
    config = make_rm_config(
        instrument=instrument,
        qty=1,
        entry_price=1.0,
        trailing_mode="per_lot",
        targets=[{"trigger_pct": 50, "exit_pct": 50}],
        exit_tranches=[{"exit_pct": 100}],
    )
    rm = RiskManagerStrategy()
    rm.on_start(config)
    rm.add_lot(entry_price=1.0, quantity=1, order_id=2, fill_time=2.0, perm_id=2)

    rm._level_states["profit_0"] = LevelState.TRIGGERED
    rm.on_order_placed(11, {"remaining": 1, "filled": 0.0}, config)
    rm.on_fill(11, {"filled": 1.0, "remaining": 0.0, "status": "Filled", "avgFillPrice": 1.6}, config)

    assert rm.remaining_qty == 1
    assert rm._per_lot_trailing[0].remaining_qty == 0
    assert rm._per_lot_trailing[1].remaining_qty == 1

    live_lot = rm._per_lot_trailing[1]
    live_lot.trailing_active = True
    live_lot.high_water_mark = 1.25
    live_lot.trailing_stop_price = 1.15

    action = rm._check_trailing_stop_per_lot(
        config,
        current_price=1.10,
        quote=FakeQuote(bid=1.08, ask=1.12, last=1.10),
    )

    assert action is not None
    assert action.quantity == 1


def test_hot_switch_to_per_lot_rebuilds_remaining_inventory_from_fill_history():
    instrument = make_instrument(strike=650)
    config = make_rm_config(
        instrument=instrument,
        qty=1,
        entry_price=1.0,
        trailing_mode="uniform",
        targets=[{"trigger_pct": 50, "exit_pct": 50}],
        exit_tranches=[{"exit_pct": 100}],
    )
    rm = RiskManagerStrategy()
    rm.on_start(config)
    rm.add_lot(entry_price=1.0, quantity=1, order_id=3, fill_time=3.0, perm_id=3)

    rm._level_states["profit_0"] = LevelState.TRIGGERED
    rm.on_order_placed(21, {"remaining": 1, "filled": 0.0}, config)
    rm.on_fill(21, {"filled": 1.0, "remaining": 0.0, "status": "Filled", "avgFillPrice": 1.6}, config)

    rm.update_risk_config({
        "profit_taking": {
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 0,
                "trail_pct": 10,
                "mode": "per_lot",
                "exit_tranches": [{"exit_pct": 100}],
            }
        }
    })

    assert rm.remaining_qty == 1
    assert sum(lot.remaining_qty for lot in rm._per_lot_trailing.values()) == 1
    assert rm._level_states["trailing_lot_0"] == LevelState.FILLED
    assert rm._level_states["trailing_lot_1"] == LevelState.ARMED


def test_recover_persisted_orphan_rebuilds_per_lot_remaining_without_parent_model():
    instrument = make_instrument(strike=651, expiry="20260327")
    config = make_rm_config(
        instrument=instrument,
        qty=1,
        entry_price=1.0,
        trailing_mode="uniform",
        targets=[{"trigger_pct": 50, "exit_pct": 50}],
        exit_tranches=[{"exit_pct": 100}],
    )
    seed_rm = RiskManagerStrategy()
    seed_rm.on_start(config)
    seed_rm.add_lot(entry_price=1.2, quantity=1, order_id=4, fill_time=4.0, perm_id=4)
    seed_rm._level_states["profit_0"] = LevelState.TRIGGERED
    seed_rm.on_order_placed(31, {"remaining": 1, "filled": 0.0}, config)
    seed_rm.on_fill(31, {"filled": 1.0, "remaining": 0.0, "status": "Filled", "avgFillPrice": 1.8}, config)

    runtime_state = seed_rm.get_runtime_snapshot()
    runtime_state["trailing_mode"] = "per_lot"
    runtime_state.pop("per_lot_trailing", None)

    with tempfile.TemporaryDirectory() as tmpdir:
        store_path = os.path.join(tmpdir, "position_store.json")
        store = PositionStore(path=store_path)
        store.add_position(
            position_id="bmc_risk_orphan",
            entry={
                "order_id": 4,
                "price": seed_rm.entry_price,
                "quantity": seed_rm.initial_qty,
                "fill_time": 4.0,
                "perm_id": 4,
            },
            instrument=instrument,
            risk_config=config,
            parent_strategy="bmc_missing_parent",
        )
        store.update_runtime_state("bmc_risk_orphan", runtime_state)
        for fill in seed_rm._fill_log:
            store.add_fill("bmc_risk_orphan", dict(fill))

        agent = IBDataAgent()
        agent.position_store = store
        engine, _ = make_engine(store)
        agent.execution_engine = engine

        recovered = agent._recover_persisted_risk_managers()

        assert recovered == 1
        recovered_state = agent.execution_engine._strategies["bmc_risk_orphan"]
        recovered_rm = recovered_state.strategy
        assert recovered_state.ticker == "SPY"
        assert recovered_rm.remaining_qty == 1
        assert sum(lot.remaining_qty for lot in recovered_rm._per_lot_trailing.values()) == 1
