import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))

from position_store import PositionStore


def _make_store(tmp_path):
    return PositionStore(str(tmp_path / "position_store.json"))


def _instrument():
    return {
        "symbol": "SPY",
        "secType": "OPT",
        "strike": 647.0,
        "expiry": "20260326",
        "right": "P",
        "multiplier": 100,
    }


def _batch_execution(exec_id: str, *, order_id: int = 901):
    return [{
        "contract": {
            "symbol": "SPY",
            "secType": "OPT",
            "strike": 647.0,
            "lastTradeDateOrContractMonth": "20260326",
            "right": "P",
        },
        "execution": {
            "execId": exec_id,
            "orderId": order_id,
            "account": "U152133",
            "time": "20260326  09:45:01",
            "side": "SLD",
            "shares": 1,
            "price": 1.23,
            "exchange": "CBOE",
            "permId": 7001,
            "lastLiquidity": 2,
        },
        "commission": {
            "commission": 0.65,
            "realized_pnl": 12.5,
        },
    }]


def test_canonical_execution_finalizes_without_duplication(tmp_path):
    store = _make_store(tmp_path)
    store.add_position(
        position_id="bmc_risk_exec",
        entry={"order_id": 11, "price": 1.0, "quantity": 1, "fill_time": 1000.0, "perm_id": 111},
        instrument=_instrument(),
        risk_config={},
        parent_strategy="bmc_spy",
    )

    fill = {
        "time": 2000.0,
        "order_id": 55,
        "exec_id": "",
        "level": "entry",
        "qty_filled": 1,
        "avg_price": 1.05,
        "remaining_qty": 1,
        "pnl_pct": 0.0,
        "execution_analytics": {
            "routing_exchange": "SMART",
            "slippage": -0.01,
            "effective_spread": 0.02,
            "pre_trade_snapshot": {
                "option_bid": 1.0,
                "option_ask": 1.1,
                "option_mid": 1.05,
            },
        },
    }

    store.add_fill("bmc_risk_exec", fill)
    store.update_fill_execution_details(
        "bmc_risk_exec",
        55,
        exec_id="000123.abc.01",
        execution_analytics={"exchange": "CBOE", "last_liquidity": 2},
    )
    store.update_fill_execution_details(
        "bmc_risk_exec",
        55,
        exec_id="000123.abc.01",
        execution_analytics={"exchange": "CBOE", "last_liquidity": 2},
    )
    store.update_fill_commission(
        "bmc_risk_exec",
        "000123.abc.01",
        {"commission": 0.65, "realized_pnl": 1.25},
    )
    store.update_fill_post_trade(
        "bmc_risk_exec",
        55,
        60,
        {"mid_60s": 1.02, "bid_60s": 1.01, "ask_60s": 1.03},
    )

    executions = store.get_canonical_executions("bmc_risk_exec")
    assert len(executions) == 1
    assert executions[0]["exec_id"] == "000123.abc.01"
    assert executions[0]["commission"] == 0.65
    assert executions[0]["realized_pnl_ib"] == 1.25
    assert executions[0]["slippage"] == -0.01
    assert executions[0]["effective_spread"] == 0.02
    assert executions[0]["analytics_status"] == "finalized"
    assert executions[0]["degraded_reasons"] == []

    reloaded = PositionStore(str(tmp_path / "position_store.json"))
    reloaded_executions = reloaded.get_canonical_executions("bmc_risk_exec")
    assert len(reloaded_executions) == 1
    assert reloaded_executions[0]["analytics_status"] == "finalized"


def test_ib_batch_ingest_keeps_unmatched_manual_execution_as_unresolved(tmp_path):
    store = _make_store(tmp_path)

    result = store.ingest_ib_execution_batch(_batch_execution("000999.manual.01"))
    executions = store.get_canonical_executions()

    assert result["ingested"] == 1
    assert result["unresolved"] == 1
    assert len(executions) == 1
    assert executions[0]["exec_id"] == "000999.manual.01"
    assert executions[0]["unresolved_position"] is True
    assert executions[0]["source"] == "ib_reconciliation"
    assert executions[0]["analytics_status"] in {"broker_enriched", "degraded"}


def test_out_of_order_partial_exec_details_attach_to_correct_fill(tmp_path):
    store = _make_store(tmp_path)
    store.add_position(
        position_id="bmc_risk_partial_exec",
        entry={"order_id": 11, "price": 1.0, "quantity": 2, "fill_time": 1000.0, "perm_id": 111},
        instrument=_instrument(),
        risk_config={},
        parent_strategy="bmc_spy",
    )

    store.add_fill("bmc_risk_partial_exec", {
        "time": 2000.0,
        "order_id": 77,
        "exec_id": "",
        "level": "exit",
        "qty_filled": 1,
        "avg_price": 1.11,
        "remaining_qty": 1,
        "pnl_pct": 0.0,
        "execution_analytics": {},
    })
    store.add_fill("bmc_risk_partial_exec", {
        "time": 2002.0,
        "order_id": 77,
        "exec_id": "",
        "level": "exit",
        "qty_filled": 1,
        "avg_price": 1.21,
        "remaining_qty": 0,
        "pnl_pct": 0.0,
        "execution_analytics": {},
    })

    store.update_fill_execution_details(
        "bmc_risk_partial_exec",
        77,
        exec_id="000123.partial.02",
        execution_analytics={"exchange": "CBOE", "last_liquidity": 2, "perm_id": 7002, "side": "SLD"},
        match_hint={"fill_time": 2002.0, "qty_filled": 1, "avg_price": 1.21, "perm_id": 7002, "side": "SLD"},
    )
    store.update_fill_execution_details(
        "bmc_risk_partial_exec",
        77,
        exec_id="000123.partial.01",
        execution_analytics={"exchange": "CBOE", "last_liquidity": 1, "perm_id": 7001, "side": "SLD"},
        match_hint={"fill_time": 2000.0, "qty_filled": 1, "avg_price": 1.11, "perm_id": 7001, "side": "SLD"},
    )
    store.update_fill_post_trade(
        "bmc_risk_partial_exec",
        77,
        60,
        {"mid_60s": 1.18, "bid_60s": 1.17, "ask_60s": 1.19},
        match_hint={"fill_time": 2002.0, "qty_filled": 1, "avg_price": 1.21, "perm_id": 7002},
    )

    fill_log = store.get_position("bmc_risk_partial_exec")["fill_log"]
    assert fill_log[0]["exec_id"] == "000123.partial.01"
    assert fill_log[1]["exec_id"] == "000123.partial.02"
    assert fill_log[0].get("execution_analytics", {}).get("post_fill") in ({}, None)
    assert fill_log[1]["execution_analytics"]["post_fill"]["mid_60s"] == 1.18

    execution_map = {
        row["exec_id"]: row
        for row in store.get_canonical_executions("bmc_risk_partial_exec")
    }
    assert set(execution_map) == {"000123.partial.01", "000123.partial.02"}
    assert execution_map["000123.partial.01"]["avg_price"] == 1.11
    assert execution_map["000123.partial.02"]["avg_price"] == 1.21
    assert execution_map["000123.partial.02"]["post_fill"]["mid_60s"] == 1.18
    assert execution_map["000123.partial.01"].get("post_fill", {}).get("mid_60s") is None


def test_rebuild_execution_ledger_merges_orderless_duplicate_analytics(tmp_path):
    store = _make_store(tmp_path)
    store.add_position(
        position_id="bmc_risk_backfill",
        entry={"order_id": 11, "price": 1.0, "quantity": 1, "fill_time": 1000.0, "perm_id": 111},
        instrument=_instrument(),
        risk_config={},
        parent_strategy="bmc_spy",
    )

    pos = store.get_position("bmc_risk_backfill")
    pos["fill_log"] = [
        {
            "time": 2000.0,
            "order_id": 55,
            "exec_id": "",
            "level": "exit",
            "qty_filled": 1,
            "avg_price": 1.23,
            "remaining_qty": 0,
            "pnl_pct": 0.0,
        },
        {
            "time": 2000.1,
            "order_id": 0,
            "exec_id": "",
            "level": "exit",
            "qty_filled": 1,
            "avg_price": 1.23,
            "remaining_qty": 0,
            "pnl_pct": 0.0,
            "execution_analytics": {
                "routing_exchange": "SMART",
                "exchange": "CBOE",
                "last_liquidity": 2,
                "slippage": -0.03,
                "effective_spread": 0.06,
                "pre_trade_snapshot": {
                    "option_bid": 1.20,
                    "option_ask": 1.26,
                    "option_mid": 1.23,
                },
            },
        },
        {
            "time": 2001.0,
            "order_id": 0,
            "exec_id": "",
            "level": "entry",
            "qty_filled": 1,
            "avg_price": 1.01,
            "remaining_qty": 1,
            "pnl_pct": 0.0,
        },
    ]

    report = store.rebuild_execution_ledger(since=1999.0)
    executions = store.get_canonical_executions("bmc_risk_backfill")

    assert report["fills_considered"] == 3
    assert report["replayed"] == 1
    assert report["skipped_missing_identity"] == 2
    assert report["merged_orderless_analytics"] == 1
    assert len(executions) == 1
    assert executions[0]["order_id"] == 55
    assert executions[0]["routing_exchange"] == "SMART"
    assert executions[0]["fill_exchange"] == "CBOE"
    assert executions[0]["last_liquidity"] == 2
    assert executions[0]["slippage"] == -0.03
    assert executions[0]["effective_spread"] == 0.06
