"""Tests for MergerArbAnalyzer.analyze_single_call — Bug #3 regression.

Bug #3: Annualized returns on short-dated options.  A 300% HPR was being
annualized to 9,954%.  The fix reports holding-period return (HPR) only —
merger arb is a one-shot binary outcome, not an annuity.
"""

import pytest
from freezegun import freeze_time

from app.scanner import MergerArbAnalyzer, DealInput
from tests.conftest import FROZEN_NOW, make_option

from datetime import datetime


@freeze_time(FROZEN_NOW)
class TestAnalyzeSingleCall:
    """Frozen at 2026-01-15 12:00.  Standard deal: ACME $100, close 2026-07-14."""

    @pytest.fixture(autouse=True)
    def _setup(self, standard_deal):
        self.deal = standard_deal
        self.analyzer = MergerArbAnalyzer(self.deal)

    def test_basic_profitable_call(self):
        """Deep ITM call with clear profit potential returns a TradeOpportunity."""
        opt = make_option(strike=85, expiry="20260714", bid=10, ask=12, last=11,
                          implied_vol=0.25)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is not None
        assert result.strategy == "call"
        assert result.contracts == [opt]

    def test_cost_is_mid_price(self):
        opt = make_option(strike=85, expiry="20260714", bid=10, ask=12, last=11)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is not None
        assert result.entry_cost == pytest.approx(11.0)  # (10+12)/2

    def test_far_touch_cost_is_ask(self):
        opt = make_option(strike=85, expiry="20260714", bid=10, ask=12, last=11)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is not None
        assert result.entry_cost_ft == pytest.approx(12.0)

    def test_hpr_not_annualized(self):
        """Bug #3 regression: HPR should be a modest ratio, not 1000%+."""
        # Near-close deal, 5 days out
        deal = DealInput("NEAR", 50.0, datetime(2026, 1, 20, 12, 0), confidence=0.90)
        analyzer = MergerArbAnalyzer(deal)
        # 85-strike call on $90 stock, deal at $100 — but only 5 days to close
        opt = make_option(strike=48, expiry="20260120", bid=1.50, ask=2.00,
                          last=1.75, implied_vol=0.25)
        result = analyzer.analyze_single_call(opt, current_price=49.0)
        assert result is not None
        # HPR = max_profit / cost, should be a reasonable ratio (< 5x)
        assert result.annualized_return < 5.0, (
            f"HPR should be reasonable, got {result.annualized_return:.2f}"
        )

    def test_returns_none_when_no_profit(self):
        """Intrinsic at expiry < cost → None."""
        # Strike 99, deal 100, cost ≈ 5.50 → intrinsic ≈ 1 → no profit
        opt = make_option(strike=99, expiry="20260714", bid=5, ask=6, last=5.5,
                          implied_vol=0.25)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is None

    def test_returns_none_when_mid_zero(self):
        opt = make_option(strike=85, expiry="20260714", bid=0, ask=0, last=0)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is None

    def test_returns_none_when_ask_zero(self):
        opt = make_option(strike=85, expiry="20260714", bid=5, ask=0, last=3)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is None

    def test_breakeven_equals_strike_plus_mid(self):
        opt = make_option(strike=85, expiry="20260714", bid=10, ask=12, last=11)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        assert result is not None
        assert result.breakeven == pytest.approx(85 + 11.0)

    def test_implied_vol_zero_uses_fallback(self):
        """implied_vol=0 should fallback to 0.30 internally, not crash."""
        opt = make_option(strike=85, expiry="20260714", bid=10, ask=12, last=11,
                          implied_vol=0.0)
        result = self.analyzer.analyze_single_call(opt, current_price=90.0)
        # Should not crash and should return a valid result
        assert result is not None
