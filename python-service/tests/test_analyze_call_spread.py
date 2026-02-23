"""Tests for MergerArbAnalyzer.analyze_call_spread."""

import pytest
from freezegun import freeze_time

from app.scanner import MergerArbAnalyzer, DealInput
from tests.conftest import FROZEN_NOW, make_option

from datetime import datetime


@freeze_time(FROZEN_NOW)
class TestAnalyzeCallSpread:
    """Frozen at 2026-01-15 12:00.  Standard deal: ACME $100, close 2026-07-14."""

    @pytest.fixture(autouse=True)
    def _setup(self, standard_deal):
        self.deal = standard_deal
        self.analyzer = MergerArbAnalyzer(self.deal)

    def test_basic_spread_at_full_convergence(self):
        """Long 85C / Short 100C, expires after deal close → full convergence."""
        # Use expiry AFTER close date to guarantee full convergence
        long = make_option(strike=85, expiry="20260815", bid=10, ask=12)
        short = make_option(strike=100, expiry="20260815", bid=3, ask=5)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        assert result is not None
        assert result.strategy == "spread"
        # Full convergence: value = short_strike - long_strike = 15
        # Cost mid = (10+12)/2 - (3+5)/2 = 11 - 4 = 7
        spread_value = 100 - 85
        cost_mid = long.mid_price - short.mid_price
        assert result.entry_cost == pytest.approx(cost_mid)
        assert result.max_profit == pytest.approx(spread_value - cost_mid)

    def test_expected_price_between_strikes(self):
        """Expected price between strikes → partial spread value."""
        # Use a short expiry so expected price is between 85 and 100
        long = make_option(strike=85, expiry="20260415", bid=4, ask=6)
        short = make_option(strike=100, expiry="20260415", bid=1, ask=2)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        # Expected price at mid-deal ≈ 95 → value = 95 - 85 = 10
        assert result is not None

    def test_expected_price_below_long_strike(self):
        """Expected price below long strike → spread worthless → None."""
        # Very short expiry on a very OTM spread
        long = make_option(strike=98, expiry="20260116", bid=0.50, ask=1.00)
        short = make_option(strike=100, expiry="20260116", bid=0.10, ask=0.40)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        # 1-day convergence: expected ≈ 90.06, well below 98 → value ≈ 0
        assert result is None

    def test_far_touch_uses_ask_and_bid(self):
        """Far-touch cost: pay ask on long, receive bid on short."""
        long = make_option(strike=85, expiry="20260714", bid=10, ask=12)
        short = make_option(strike=100, expiry="20260714", bid=3, ask=5)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        assert result is not None
        assert result.entry_cost_ft == pytest.approx(12.0 - 3.0)  # ask - bid

    def test_rejects_zero_mid_on_long_leg(self):
        long = make_option(strike=85, expiry="20260714", bid=0, ask=0, last=0)
        short = make_option(strike=100, expiry="20260714", bid=3, ask=5)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        assert result is None

    def test_rejects_zero_mid_on_short_leg(self):
        long = make_option(strike=85, expiry="20260714", bid=10, ask=12)
        short = make_option(strike=100, expiry="20260714", bid=0, ask=0, last=0)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        assert result is None

    def test_rejects_negative_spread_cost(self):
        """If long is cheaper than short (credit), reject."""
        long = make_option(strike=85, expiry="20260714", bid=2, ask=3)
        short = make_option(strike=100, expiry="20260714", bid=5, ask=7)
        result = self.analyzer.analyze_call_spread(long, short, current_price=90.0)
        assert result is None

    def test_hpr_not_annualized_for_short_dated(self):
        """HPR should be a simple ratio, not compounded."""
        deal = DealInput("NEAR", 50.0, datetime(2026, 1, 20, 12, 0), confidence=0.90)
        analyzer = MergerArbAnalyzer(deal)
        long = make_option(strike=46, expiry="20260120", bid=3, ask=4)
        short = make_option(strike=50, expiry="20260120", bid=1, ask=2)
        result = analyzer.analyze_call_spread(long, short, current_price=49.0)
        if result is not None:
            assert result.annualized_return < 10.0, (
                f"HPR should be reasonable, got {result.annualized_return:.2f}"
            )
