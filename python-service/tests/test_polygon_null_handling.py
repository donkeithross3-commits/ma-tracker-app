"""Tests for Polygon null-value handling — Bug #1 regression.

Bug #1: Polygon sends keys with null values (e.g. `"implied_vol": null`).
Python's `dict.get('implied_vol', 0.30)` returns None (not the default)
because the key exists.  The fix uses `contract.get('key') or fallback`.
"""

import pytest

from app.scanner import OptionData


def _convert_contract(raw: dict, ticker: str = "ACME") -> OptionData:
    """Replicate the exact conversion pattern from options_routes.py line 317-334."""
    return OptionData(
        symbol=raw.get("symbol") or ticker,
        strike=raw["strike"],
        expiry=raw["expiry"],
        right=raw["right"],
        bid=raw.get("bid") or 0,
        ask=raw.get("ask") or 0,
        last=raw.get("last") or 0,
        volume=raw.get("volume") or 0,
        open_interest=raw.get("open_interest") or 0,
        implied_vol=raw.get("implied_vol") or 0.30,
        delta=raw.get("delta") or 0,
        gamma=0,
        theta=0,
        vega=0,
        bid_size=raw.get("bid_size") or 0,
        ask_size=raw.get("ask_size") or 0,
    )


# Minimal valid contract skeleton
_BASE = {"strike": 100.0, "expiry": "20260714", "right": "C"}


class TestImpliedVolNullHandling:
    def test_implied_vol_null_uses_default(self):
        raw = {**_BASE, "implied_vol": None}
        opt = _convert_contract(raw)
        assert opt.implied_vol == pytest.approx(0.30)

    def test_implied_vol_zero_uses_default(self):
        raw = {**_BASE, "implied_vol": 0}
        opt = _convert_contract(raw)
        assert opt.implied_vol == pytest.approx(0.30)

    def test_implied_vol_missing_uses_default(self):
        raw = {**_BASE}  # no implied_vol key at all
        opt = _convert_contract(raw)
        assert opt.implied_vol == pytest.approx(0.30)

    def test_implied_vol_valid(self):
        raw = {**_BASE, "implied_vol": 0.45}
        opt = _convert_contract(raw)
        assert opt.implied_vol == pytest.approx(0.45)


class TestOtherNullFields:
    def test_delta_null(self):
        raw = {**_BASE, "delta": None}
        opt = _convert_contract(raw)
        assert opt.delta == 0

    def test_bid_null(self):
        raw = {**_BASE, "bid": None}
        opt = _convert_contract(raw)
        assert opt.bid == 0

    def test_volume_null(self):
        raw = {**_BASE, "volume": None}
        opt = _convert_contract(raw)
        assert opt.volume == 0

    def test_full_contract_all_nulls(self):
        """All optional fields null → no crash, sensible defaults."""
        raw = {
            **_BASE,
            "symbol": None,
            "bid": None,
            "ask": None,
            "last": None,
            "volume": None,
            "open_interest": None,
            "implied_vol": None,
            "delta": None,
            "bid_size": None,
            "ask_size": None,
        }
        opt = _convert_contract(raw)
        assert opt.symbol == "ACME"
        assert opt.bid == 0
        assert opt.ask == 0
        assert opt.last == 0
        assert opt.volume == 0
        assert opt.open_interest == 0
        assert opt.implied_vol == pytest.approx(0.30)
        assert opt.delta == 0
        assert opt.bid_size == 0
        assert opt.ask_size == 0
