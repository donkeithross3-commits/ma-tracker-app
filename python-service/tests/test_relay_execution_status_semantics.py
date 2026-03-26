import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import options_routes


class StubRegistry:
    def __init__(self, provider):
        self.provider = provider

    async def get_active_provider(self, user_id=None, allow_fallback_to_any=False):
        return self.provider


def make_provider(telemetry=None, *, boot_phase=None, live_quotes=None, live_quotes_at=0.0):
    return SimpleNamespace(
        execution_telemetry=telemetry,
        boot_phase=boot_phase,
        _live_quotes=live_quotes,
        _live_quotes_at=live_quotes_at,
    )


def make_contract(*, broker_qty=1, broker_snapshot_age_ms=500, status="ok"):
    return {
        "contract_key": "SPY:650:20260326:P",
        "instrument": {"symbol": "SPY", "strike": 650, "expiry": "20260326", "right": "P"},
        "active_position_ids": ["bmc_risk_spy"],
        "active_position_count": 1,
        "broker_qty": broker_qty,
        "broker_accounts": ["DU123456"],
        "broker_snapshot_age_ms": broker_snapshot_age_ms,
        "reserved_exit_qty": 0,
        "status": status,
        "message": "",
        "position_ids": [],
    }


def make_telemetry(*, running=True, received_at=None, contracts=None, stale=False):
    telemetry = {
        "running": running,
        "strategies": [],
        "quote_snapshot": {"SPY:650:20260326:P": {"mid": 1.2}},
        "managed_contracts": list(contracts or []),
        "position_ledger": [],
        "order_budget": 3,
        "total_algo_orders": 1,
        "received_at": received_at if received_at is not None else time.time(),
    }
    if stale:
        telemetry["stale"] = True
        telemetry["stale_since"] = time.time() - 5
    return telemetry


@pytest.mark.asyncio
async def test_relay_execution_status_uses_fresh_cached_telemetry(monkeypatch):
    provider = make_provider(
        make_telemetry(
            received_at=time.time() - 1,
            contracts=[make_contract(broker_snapshot_age_ms=750)],
        ),
        live_quotes={"SPY:650:20260326:P": {"mid": 1.25}},
        live_quotes_at=time.time(),
    )
    monkeypatch.setattr(options_routes, "get_registry", lambda: StubRegistry(provider))

    called = {"count": 0}

    async def fake_send_request_to_provider(*args, **kwargs):
        called["count"] += 1
        return {}

    monkeypatch.setattr(options_routes, "send_request_to_provider", fake_send_request_to_provider)

    result = await options_routes.relay_execution_status("user-1")

    assert result["source"] == "cached_telemetry"
    assert result["broker_truth_status"] == "broker_snapshot_fresh"
    assert result["telemetry_age_ms"] >= 0
    assert result["quote_snapshot"] == provider._live_quotes
    assert called["count"] == 0


@pytest.mark.asyncio
async def test_relay_execution_status_bypasses_cache_when_telemetry_is_too_old(monkeypatch):
    provider = make_provider(
        make_telemetry(
            received_at=time.time() - 20,
            contracts=[make_contract(broker_snapshot_age_ms=250)],
        )
    )
    monkeypatch.setattr(options_routes, "get_registry", lambda: StubRegistry(provider))

    async def fake_send_request_to_provider(*args, **kwargs):
        return make_telemetry(
            received_at=time.time(),
            contracts=[make_contract(broker_snapshot_age_ms=0)],
        )

    monkeypatch.setattr(options_routes, "send_request_to_provider", fake_send_request_to_provider)

    result = await options_routes.relay_execution_status("user-1")

    assert result["source"] == "direct_query"
    assert result["cache_bypass_reason"] == "telemetry_age_exceeded"
    assert result["broker_truth_status"] == "broker_snapshot_fresh"
    assert provider.execution_telemetry["received_at"] > time.time() - 2


@pytest.mark.asyncio
async def test_relay_execution_status_falls_back_to_cached_snapshot_when_live_refresh_fails(monkeypatch):
    provider = make_provider(
        make_telemetry(
            received_at=time.time() - 3,
            contracts=[make_contract(broker_snapshot_age_ms=200)],
            stale=True,
        )
    )
    monkeypatch.setattr(options_routes, "get_registry", lambda: StubRegistry(provider))

    async def fake_send_request_to_provider(*args, **kwargs):
        raise HTTPException(status_code=504, detail="Request timed out")

    monkeypatch.setattr(options_routes, "send_request_to_provider", fake_send_request_to_provider)

    result = await options_routes.relay_execution_status("user-1")

    assert result["source"] == "cached_telemetry_fallback"
    assert result["cache_bypass_reason"] == "relay_cache_stale"
    assert result["direct_query_failed"] is True
    assert result["direct_query_error"] == "Request timed out"
    assert result["broker_truth_status"] == "relay_cache_stale"


@pytest.mark.asyncio
async def test_relay_bmc_signal_bypasses_cache_when_broker_snapshot_is_missing(monkeypatch):
    provider = make_provider(
        make_telemetry(
            received_at=time.time() - 1,
            contracts=[make_contract(broker_qty=None, broker_snapshot_age_ms=None)],
        )
    )
    monkeypatch.setattr(options_routes, "get_registry", lambda: StubRegistry(provider))

    async def fake_send_request_to_provider(*args, **kwargs):
        return {
            "running": True,
            "strategies": [
                {
                    "strategy_id": "bmc_spy",
                    "strategy_state": {"ticker": "SPY", "started": True},
                    "config": {"ticker": "SPY", "direction_mode": "both"},
                }
            ],
            "budget_status": {},
            "managed_contracts": [make_contract(broker_snapshot_age_ms=0)],
        }

    monkeypatch.setattr(options_routes, "send_request_to_provider", fake_send_request_to_provider)

    result = await options_routes.relay_bmc_signal(user_id="user-1", fresh=0)

    assert result["source"] == "direct_query"
    assert result["cache_bypass_reason"] == "awaiting_broker_snapshot"
    assert result["broker_truth_status"] == "broker_snapshot_fresh"
    assert result["signal"]["ticker"] == "SPY"
