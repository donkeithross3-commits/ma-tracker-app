"""Shared fixtures for M&A options scanner tests."""

import sys
from pathlib import Path
from datetime import datetime

import pytest
from freezegun import freeze_time

# Ensure the app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.scanner import DealInput, OptionData, MergerArbAnalyzer

# ---------------------------------------------------------------------------
# Frozen time — every date-dependent test uses this
# ---------------------------------------------------------------------------
FROZEN_NOW = "2026-01-15 12:00:00"


# ---------------------------------------------------------------------------
# make_option factory
# ---------------------------------------------------------------------------
def make_option(
    strike: float,
    expiry: str = "20260714",
    right: str = "C",
    bid: float = 5.0,
    ask: float = 6.0,
    last: float = 5.5,
    volume: int = 100,
    open_interest: int = 500,
    implied_vol: float = 0.25,
    delta: float = 0.50,
    gamma: float = 0.02,
    theta: float = -0.05,
    vega: float = 0.10,
    bid_size: int = 10,
    ask_size: int = 10,
    symbol: str = "ACME",
) -> OptionData:
    """Build an OptionData with sensible defaults — override only what you need."""
    return OptionData(
        symbol=symbol,
        strike=strike,
        expiry=expiry,
        right=right,
        bid=bid,
        ask=ask,
        last=last,
        volume=volume,
        open_interest=open_interest,
        implied_vol=implied_vol,
        delta=delta,
        gamma=gamma,
        theta=theta,
        vega=vega,
        bid_size=bid_size,
        ask_size=ask_size,
    )


# ---------------------------------------------------------------------------
# Deal fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
@freeze_time(FROZEN_NOW)
def standard_deal() -> DealInput:
    """ACME $100 deal, closing 2026-07-14 (180 days from frozen now)."""
    return DealInput(
        ticker="ACME",
        deal_price=100.0,
        expected_close_date=datetime(2026, 7, 14, 12, 0),
        confidence=0.75,
    )


@pytest.fixture
@freeze_time(FROZEN_NOW)
def deal_with_extras() -> DealInput:
    """$100 + $2 dividend + $3 CTR = $105 total deal value."""
    return DealInput(
        ticker="ACME",
        deal_price=100.0,
        expected_close_date=datetime(2026, 7, 14, 12, 0),
        dividend_before_close=2.0,
        ctr_value=3.0,
        confidence=0.75,
    )


@pytest.fixture
@freeze_time(FROZEN_NOW)
def near_close_deal() -> DealInput:
    """NEAR $50 deal closing in 5 days."""
    return DealInput(
        ticker="NEAR",
        deal_price=50.0,
        expected_close_date=datetime(2026, 1, 20, 12, 0),
        confidence=0.90,
    )


# ---------------------------------------------------------------------------
# Analyzer fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
@freeze_time(FROZEN_NOW)
def standard_analyzer(standard_deal) -> MergerArbAnalyzer:
    return MergerArbAnalyzer(standard_deal)


@pytest.fixture
@freeze_time(FROZEN_NOW)
def near_close_analyzer(near_close_deal) -> MergerArbAnalyzer:
    return MergerArbAnalyzer(near_close_deal)


@pytest.fixture
@freeze_time(FROZEN_NOW)
def extras_analyzer(deal_with_extras) -> MergerArbAnalyzer:
    return MergerArbAnalyzer(deal_with_extras)
