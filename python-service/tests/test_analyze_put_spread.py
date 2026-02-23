"""Tests for MergerArbAnalyzer.analyze_put_spread — Bug #2 regression.

Bug #2: Put spread IRR explosion.  The denominator was max_loss (tiny for
high-credit spreads) instead of spread_width (the actual collateral the
broker holds).  A spread with credit=8, width=10, max_loss=2 was returning
HPR = 8/2 = 400% instead of 8/10 = 80%.
"""

import pytest
from freezegun import freeze_time

from app.scanner import MergerArbAnalyzer, DealInput
from tests.conftest import FROZEN_NOW, make_option

from datetime import datetime


@freeze_time(FROZEN_NOW)
class TestAnalyzePutSpread:
    """Frozen at 2026-01-15 12:00.  Standard deal: ACME $100, close 2026-07-14."""

    @pytest.fixture(autouse=True)
    def _setup(self, standard_deal):
        self.deal = standard_deal
        self.analyzer = MergerArbAnalyzer(self.deal)

    def test_denominator_is_spread_width(self):
        """Bug #2 regression: HPR denominator MUST be spread_width, not max_loss.

        Setup: sell 100P at mid=9, buy 90P at mid=1 → credit=8, width=10, max_loss=2.
        Correct HPR on collateral = 8 / 10 = 0.80.
        Old (buggy) HPR = 8 / 2 = 4.0.
        """
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=0.50, ask=1.50, last=1.0)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=8.50, ask=9.50, last=9.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
        spread_width = 100 - 90  # = 10
        credit_mid = short_put.mid_price - long_put.mid_price  # 9.0 - 1.0 = 8.0
        # HPR on collateral = expected_return / spread_width
        assert result.annualized_return == pytest.approx(credit_mid / spread_width, abs=0.01)
        # Specifically: must NOT be credit / max_loss
        max_loss = spread_width - credit_mid  # 10 - 8 = 2
        buggy_hpr = credit_mid / max_loss  # 8/2 = 4.0
        assert result.annualized_return != pytest.approx(buggy_hpr, abs=0.5)

    def test_stock_above_both_strikes(self):
        """Stock above short strike → keep full credit."""
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=0.50, ask=1.50, last=1.0)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=8.50, ask=9.50, last=9.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
        credit_mid = short_put.mid_price - long_put.mid_price
        # Expected price at close ≈ deal price (100) ≥ short strike (100)
        assert result.expected_return == pytest.approx(credit_mid, abs=0.5)

    def test_stock_between_strikes(self):
        """Stock between strikes at expiry → partial loss."""
        # Use mid-expiry option so expected price is between 90 and 100
        long_put = make_option(strike=90, right="P", expiry="20260415",
                               bid=2.50, ask=3.50, last=3.0)
        short_put = make_option(strike=100, right="P", expiry="20260415",
                                bid=6.50, ask=7.50, last=7.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
        credit_mid = short_put.mid_price - long_put.mid_price  # 7.0 - 3.0 = 4.0
        # Expected price at halfway ≈ 95, between 90 and 100
        # Partial loss = short_strike - expected_price = 100 - 95 = 5
        # Expected return = credit - loss = 4.0 - 5.0 = -1.0
        assert result.expected_return < credit_mid

    def test_stock_below_both_strikes(self):
        """Stock below long strike → max loss."""
        # 1-day option, barely any convergence, stock way below both strikes
        long_put = make_option(strike=90, right="P", expiry="20260116",
                               bid=6.0, ask=8.0, last=7.0)
        short_put = make_option(strike=100, right="P", expiry="20260116",
                                bid=12.0, ask=14.0, last=13.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=80.0)
        assert result is not None
        spread_width = 100 - 90
        credit_mid = short_put.mid_price - long_put.mid_price  # 13 - 7 = 6
        max_loss = spread_width - credit_mid  # 10 - 6 = 4
        assert result.expected_return == pytest.approx(-max_loss, abs=0.1)

    def test_far_touch_uses_bid_ask_correctly(self):
        """Far-touch credit: sell at bid, buy at ask."""
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=0.50, ask=1.50, last=1.0)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=8.50, ask=9.50, last=9.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
        # Far-touch credit = short.bid - long.ask = 8.50 - 1.50 = 7.0
        # Far-touch max loss = spread_width - credit_ft = 10 - 7 = 3.0
        assert result.entry_cost_ft == pytest.approx(10.0 - 7.0)  # max_loss_ft

    def test_rejects_zero_credit(self):
        """Credit ≤ 0 → None."""
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=5.0, ask=6.0, last=5.5)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=3.0, ask=4.0, last=3.5)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is None  # short.mid < long.mid → negative credit

    def test_rejects_negative_spread_width(self):
        """Long strike > short strike → invalid spread → None."""
        long_put = make_option(strike=100, right="P", expiry="20260714",
                               bid=8.0, ask=10.0, last=9.0)
        short_put = make_option(strike=90, right="P", expiry="20260714",
                                bid=3.0, ask=5.0, last=4.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is None

    def test_breakeven_is_short_strike_minus_credit(self):
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=0.50, ask=1.50, last=1.0)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=8.50, ask=9.50, last=9.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
        credit_mid = short_put.mid_price - long_put.mid_price
        assert result.breakeven == pytest.approx(100.0 - credit_mid)

    def test_implied_vol_none_fallback(self):
        """implied_vol=0 should not crash (fallback to 0.30 in prob calc)."""
        long_put = make_option(strike=90, right="P", expiry="20260714",
                               bid=0.50, ask=1.50, implied_vol=0.0)
        short_put = make_option(strike=100, right="P", expiry="20260714",
                                bid=8.50, ask=9.50, implied_vol=0.0)
        result = self.analyzer.analyze_put_spread(long_put, short_put,
                                                  current_price=90.0)
        assert result is not None
