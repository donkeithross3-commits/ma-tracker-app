"""Tests for PolygonOptionsClient — parsing, pagination, and availability checks.

Validates that _parse_option_snapshot() correctly extracts all contract fields,
get_option_chain() handles pagination without dropping contracts, and
check_options_available() gracefully handles empty/error states.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.options.polygon_options import PolygonOptionsClient, PolygonError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_snapshot(
    strike: float = 100.0,
    expiration_date: str = "2026-07-14",
    contract_type: str = "call",
    bid: float = 5.0,
    ask: float = 6.0,
    volume: int = 200,
    open_interest: int = 1000,
    implied_vol: float = 0.30,
    delta: float = 0.55,
    gamma: float = 0.02,
    theta: float = -0.04,
    vega: float = 0.12,
    bid_size: int = 10,
    ask_size: int = 15,
) -> dict:
    """Build a Polygon option snapshot dict with sensible defaults."""
    return {
        "details": {
            "strike_price": strike,
            "expiration_date": expiration_date,
            "contract_type": contract_type,
        },
        "greeks": {
            "implied_volatility": implied_vol,
            "delta": delta,
            "gamma": gamma,
            "theta": theta,
            "vega": vega,
        },
        "day": {
            "volume": volume,
        },
        "last_quote": {
            "bid": bid,
            "ask": ask,
            "bid_size": bid_size,
            "ask_size": ask_size,
        },
        "open_interest": open_interest,
    }


# ===========================================================================
# _parse_option_snapshot
# ===========================================================================

class TestParseOptionSnapshot:
    """Unit tests for PolygonOptionsClient._parse_option_snapshot()."""

    def test_correct_extraction(self):
        """Basic happy-path: all fields extracted correctly."""
        snap = _make_snapshot(
            strike=95.5,
            expiration_date="2026-08-21",
            contract_type="call",
            bid=3.20,
            ask=3.80,
            volume=450,
            open_interest=2200,
            implied_vol=0.28,
            delta=0.62,
        )
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")

        assert result["symbol"] == "ACME"
        assert result["strike"] == 95.5
        assert result["expiry"] == "20260821"  # YYYY-MM-DD → YYYYMMDD
        assert result["right"] == "C"
        assert result["bid"] == 3.20
        assert result["ask"] == 3.80
        assert result["mid"] == pytest.approx((3.20 + 3.80) / 2)
        assert result["volume"] == 450
        assert result["open_interest"] == 2200
        assert result["implied_vol"] == 0.28
        assert result["delta"] == 0.62

    def test_put_right(self):
        """contract_type='put' maps to right='P'."""
        snap = _make_snapshot(contract_type="put")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["right"] == "P"

    def test_expiry_format_conversion(self):
        """YYYY-MM-DD is converted to YYYYMMDD."""
        snap = _make_snapshot(expiration_date="2027-01-15")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "XYZ")
        assert result["expiry"] == "20270115"

    def test_missing_details(self):
        """Missing 'details' sub-object doesn't crash."""
        snap = {"greeks": {}, "day": {}, "last_quote": {}}
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["strike"] == 0
        assert result["expiry"] == ""
        assert result["right"] == "P"  # empty string isn't "call"

    def test_missing_greeks(self):
        """Missing 'greeks' sub-object doesn't crash."""
        snap = _make_snapshot()
        snap.pop("greeks")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["implied_vol"] is None
        assert result["delta"] is None
        assert result["gamma"] is None
        assert result["theta"] is None
        assert result["vega"] is None

    def test_missing_day(self):
        """Missing 'day' sub-object doesn't crash."""
        snap = _make_snapshot()
        snap.pop("day")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["volume"] == 0

    def test_missing_last_quote(self):
        """Missing 'last_quote' sub-object doesn't crash."""
        snap = _make_snapshot()
        snap.pop("last_quote")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["bid"] == 0
        assert result["ask"] == 0
        assert result["mid"] == 0

    def test_null_values_in_optional_fields(self):
        """Explicit None/null values in optional fields handled gracefully."""
        snap = {
            "details": {
                "strike_price": None,
                "expiration_date": None,
                "contract_type": None,
            },
            "greeks": {
                "implied_volatility": None,
                "delta": None,
                "gamma": None,
                "theta": None,
                "vega": None,
            },
            "day": {"volume": None},
            "last_quote": {
                "bid": None,
                "ask": None,
                "bid_size": None,
                "ask_size": None,
            },
            "open_interest": None,
        }
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["strike"] == 0
        assert result["expiry"] == ""
        assert result["bid"] == 0
        assert result["ask"] == 0
        assert result["mid"] == 0
        assert result["volume"] == 0
        assert result["open_interest"] == 0
        assert result["bid_size"] == 0
        assert result["ask_size"] == 0

    def test_zero_strike(self):
        """Zero strike parses without error."""
        snap = _make_snapshot(strike=0)
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["strike"] == 0

    def test_negative_strike(self):
        """Negative strike parses without error (shouldn't exist, but shouldn't crash)."""
        snap = _make_snapshot(strike=-5.0)
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["strike"] == -5.0

    def test_empty_string_expiration(self):
        """Empty string expiration date handled gracefully."""
        snap = _make_snapshot(expiration_date="")
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["expiry"] == ""

    def test_open_interest_from_snap_level(self):
        """open_interest can come from the snapshot root level."""
        snap = _make_snapshot(open_interest=5000)
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["open_interest"] == 5000

    def test_mid_price_calculation(self):
        """Mid is (bid + ask) / 2 when both are positive."""
        snap = _make_snapshot(bid=10.0, ask=12.0)
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["mid"] == pytest.approx(11.0)

    def test_mid_price_zero_when_no_quotes(self):
        """Mid is 0 when bid + ask == 0."""
        snap = _make_snapshot(bid=0, ask=0)
        result = PolygonOptionsClient._parse_option_snapshot(snap, "ACME")
        assert result["mid"] == 0


# ===========================================================================
# get_option_chain — pagination
# ===========================================================================

class TestGetOptionChainPagination:
    """Mock httpx to test pagination logic in get_option_chain()."""

    @pytest.fixture
    def client(self):
        return PolygonOptionsClient(api_key="test-key")

    @pytest.mark.anyio
    async def test_single_page_no_next_url(self, client):
        """Single page response (no next_url) returns all contracts."""
        page_data = {
            "results": [
                _make_snapshot(strike=95),
                _make_snapshot(strike=100),
            ],
            # No "next_url" key
        }
        client._get = AsyncMock(return_value=page_data)

        chain = await client.get_option_chain("ACME")
        assert len(chain) == 2
        assert chain[0]["strike"] == 95
        assert chain[1]["strike"] == 100

    @pytest.mark.anyio
    async def test_multi_page_concatenation(self, client):
        """Three pages of results are concatenated in order."""
        pages = [
            {
                "results": [_make_snapshot(strike=90)],
                "next_url": "https://api.polygon.io/v3/snapshot/options/ACME?cursor=page2",
            },
            {
                "results": [_make_snapshot(strike=95)],
                "next_url": "https://api.polygon.io/v3/snapshot/options/ACME?cursor=page3",
            },
            {
                "results": [_make_snapshot(strike=100)],
                # No next_url — final page
            },
        ]
        client._get = AsyncMock(side_effect=pages)

        chain = await client.get_option_chain("ACME")
        assert len(chain) == 3
        assert [c["strike"] for c in chain] == [90, 95, 100]
        assert client._get.call_count == 3

    @pytest.mark.anyio
    async def test_empty_results(self, client):
        """Empty results returns []."""
        client._get = AsyncMock(return_value={"results": []})

        chain = await client.get_option_chain("ACME")
        assert chain == []

    @pytest.mark.anyio
    async def test_api_params_passed_correctly(self, client):
        """Verify strike/expiry/contract_type params are passed on the first request."""
        client._get = AsyncMock(return_value={"results": []})

        await client.get_option_chain(
            "ACME",
            strike_gte=75.0,
            strike_lte=110.0,
            expiration_date_gte="2026-01-15",
            expiration_date_lte="2026-08-13",
            contract_type="call",
        )

        args, kwargs = client._get.call_args
        # First arg is the URL, second is params (or None)
        url = args[0]
        params = args[1] if len(args) > 1 else kwargs.get("params")

        assert "/v3/snapshot/options/ACME" in url
        assert params["strike_price.gte"] == 75.0
        assert params["strike_price.lte"] == 110.0
        assert params["expiration_date.gte"] == "2026-01-15"
        assert params["expiration_date.lte"] == "2026-08-13"
        assert params["contract_type"] == "call"

    @pytest.mark.anyio
    async def test_subsequent_pages_pass_none_params(self, client):
        """Pages after the first pass None for params (URL already has them)."""
        pages = [
            {
                "results": [_make_snapshot(strike=90)],
                "next_url": "https://api.polygon.io/v3/snapshot/options/ACME?cursor=abc",
            },
            {
                "results": [_make_snapshot(strike=95)],
            },
        ]
        client._get = AsyncMock(side_effect=pages)

        await client.get_option_chain("ACME")

        # First call: URL + params dict
        first_call = client._get.call_args_list[0]
        assert first_call[0][1] is not None  # params dict on first call

        # Second call: next_url, None for params
        second_call = client._get.call_args_list[1]
        assert second_call[0][1] is None  # no params on subsequent pages


# ===========================================================================
# check_options_available
# ===========================================================================

class TestCheckOptionsAvailable:
    """Tests for check_options_available()."""

    @pytest.fixture
    def client(self):
        return PolygonOptionsClient(api_key="test-key")

    @pytest.mark.anyio
    async def test_available_with_contracts(self, client):
        """Returns available=True with correct expirationCount."""
        contracts = [
            {"expiry": "20260320", "strike": 100},
            {"expiry": "20260320", "strike": 105},
            {"expiry": "20260417", "strike": 100},
            {"expiry": "20260515", "strike": 100},
        ]
        client.get_option_chain = AsyncMock(return_value=contracts)

        result = await client.check_options_available("ACME")
        assert result["available"] is True
        assert result["expirationCount"] == 3  # 3 unique expirations

    @pytest.mark.anyio
    async def test_not_available_empty_chain(self, client):
        """Returns available=False on empty chain."""
        client.get_option_chain = AsyncMock(return_value=[])

        result = await client.check_options_available("ACME")
        assert result["available"] is False
        assert result["expirationCount"] == 0

    @pytest.mark.anyio
    async def test_not_available_on_polygon_error(self, client):
        """Returns available=False on PolygonError (doesn't raise)."""
        client.get_option_chain = AsyncMock(
            side_effect=PolygonError("API failed")
        )

        result = await client.check_options_available("ACME")
        assert result["available"] is False
        assert result["expirationCount"] == 0
