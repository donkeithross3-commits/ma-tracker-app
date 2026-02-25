"""Tests for MergerArbAnalyzer.analyze_covered_call."""

import pytest
from freezegun import freeze_time

from app.scanner import MergerArbAnalyzer, DealInput
from tests.conftest import FROZEN_NOW, make_option

from datetime import datetime


@freeze_time(FROZEN_NOW)
class TestAnalyzeCoveredCall:
    """Frozen at 2026-01-15 12:00.  Standard deal: ACME $100, close 2026-07-14."""

    @pytest.fixture(autouse=True)
    def _setup(self, standard_deal):
        self.deal = standard_deal
        self.analyzer = MergerArbAnalyzer(self.deal)

    def test_annualized_return_is_premium_only(self):
        """annualized_return must reflect premium yield only, not stock appreciation."""
        call = make_option(strike=100, expiry="20260714", bid=2.0, ask=3.0,
                           open_interest=50, symbol="ACME")
        current_price = 95.0
        result = self.analyzer.analyze_covered_call(call, current_price)
        assert result is not None

        # Match the code's exact days calculation: strptime gives midnight,
        # datetime.now() under freeze is 2026-01-15 12:00, so .days = 179
        expiry_date = datetime.strptime("20260714", "%Y%m%d")
        days = (expiry_date - datetime.now()).days  # frozen to 2026-01-15 12:00
        years = max(days, 1) / 365
        expected_ann = (call.bid / current_price) / years
        assert result.annualized_return == pytest.approx(expected_ann, rel=1e-6)

        # Must NOT include stock appreciation (strike - current) in the annualized figure
        wrong_ann = ((call.strike - current_price + call.bid) / current_price) / years
        assert result.annualized_return != pytest.approx(wrong_ann, rel=1e-2)

    def test_static_return_in_edge_vs_market(self):
        """edge_vs_market should equal premium / current_price (static return)."""
        call = make_option(strike=100, expiry="20260714", bid=1.50, ask=2.50,
                           open_interest=50, symbol="ACME")
        current_price = 98.0
        result = self.analyzer.analyze_covered_call(call, current_price)
        assert result is not None
        assert result.edge_vs_market == pytest.approx(call.bid / current_price, rel=1e-6)

    def test_if_called_in_expected_return(self):
        """expected_return should contain the full if-called return (stock appreciation + premium)."""
        call = make_option(strike=100, expiry="20260714", bid=2.0, ask=3.0,
                           open_interest=50, symbol="ACME")
        current_price = 95.0
        result = self.analyzer.analyze_covered_call(call, current_price)
        assert result is not None

        if_called = ((call.strike - current_price) + call.bid) / current_price
        assert result.expected_return == pytest.approx(if_called, rel=1e-6)

    def test_rejects_low_bid(self):
        """bid <= $0.01 should be rejected."""
        call = make_option(strike=100, expiry="20260714", bid=0.01, ask=0.05,
                           open_interest=50, symbol="ACME")
        result = self.analyzer.analyze_covered_call(call, current_price=98.0)
        assert result is None

    def test_rejects_low_open_interest(self):
        """open_interest < 10 should be rejected."""
        call = make_option(strike=100, expiry="20260714", bid=2.0, ask=3.0,
                           open_interest=5, symbol="ACME")
        result = self.analyzer.analyze_covered_call(call, current_price=98.0)
        assert result is None

    def test_rejects_strike_outside_band(self):
        """strike outside deal_price ± 2% should be rejected."""
        # Strike too high: 100 * 1.02 = 102, so 103 is outside
        call_high = make_option(strike=103, expiry="20260714", bid=0.50, ask=1.0,
                                open_interest=50, symbol="ACME")
        assert self.analyzer.analyze_covered_call(call_high, current_price=95.0) is None

        # Strike too low: 100 * 0.98 = 98, so 97 is outside
        call_low = make_option(strike=97, expiry="20260714", bid=3.0, ask=4.0,
                               open_interest=50, symbol="ACME")
        assert self.analyzer.analyze_covered_call(call_low, current_price=95.0) is None
