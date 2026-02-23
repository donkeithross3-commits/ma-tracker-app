"""Tests for MergerArbAnalyzer._expected_price_at_expiry — Bug #4 regression.

Bug #4: Pre-close options were assuming stock at deal price.  A March-expiry
option on a June-close deal assumed full convergence, wildly overstating
expected return.  The fix interpolates linearly between current price and
deal value based on how far through the deal timeline the option expires.
"""

import pytest
from freezegun import freeze_time

from app.scanner import DealInput, MergerArbAnalyzer
from tests.conftest import FROZEN_NOW


@freeze_time(FROZEN_NOW)
class TestExpectedPriceAtExpiry:
    """Frozen at 2026-01-15 12:00.  Deal close 2026-07-14 (180 days)."""

    def _make_analyzer(self, deal_price=100.0, close_date_str="2026-07-14",
                       div=0.0, ctr=0.0):
        from datetime import datetime
        close = datetime.strptime(close_date_str, "%Y-%m-%d")
        deal = DealInput("ACME", deal_price, close, dividend_before_close=div,
                         ctr_value=ctr, confidence=0.75)
        return MergerArbAnalyzer(deal)

    # --- After close: full convergence ---
    def test_expiry_after_close(self):
        analyzer = self._make_analyzer()
        price = analyzer._expected_price_at_expiry(90.0, "20260815")
        assert price == pytest.approx(100.0)

    def test_expiry_at_close(self):
        analyzer = self._make_analyzer()
        price = analyzer._expected_price_at_expiry(90.0, "20260714")
        assert price == pytest.approx(100.0)

    # --- Partial convergence (Bug #4 regression) ---
    def test_halfway_interpolation(self):
        """90 days into a 180-day deal → halfway → price = 90 + 0.5*(100-90) = 95."""
        analyzer = self._make_analyzer()
        # 90 days from 2026-01-15 = 2026-04-15
        price = analyzer._expected_price_at_expiry(90.0, "20260415")
        assert price == pytest.approx(95.0, abs=0.5)

    def test_1_day_option_on_180_day_deal(self):
        """Bug #4 core case: 1-day option should barely converge, NOT jump to deal price."""
        analyzer = self._make_analyzer()
        # Tomorrow: 2026-01-16 → 1 day / 180 days ≈ 0.0056 convergence
        price = analyzer._expected_price_at_expiry(90.0, "20260116")
        # Expected: 90 + (1/180) * 10 ≈ 90.056
        assert price == pytest.approx(90.056, abs=0.1)
        assert price < 91.0, "1-day option should NOT assume near-deal convergence"

    def test_quarter_way(self):
        """45 days into 180-day deal → 25% convergence."""
        analyzer = self._make_analyzer()
        # 45 days from 2026-01-15 = 2026-03-01
        price = analyzer._expected_price_at_expiry(90.0, "20260301")
        assert price == pytest.approx(92.5, abs=0.5)

    # --- Edge cases ---
    def test_current_equals_deal(self):
        """No gap to close → always returns deal price."""
        analyzer = self._make_analyzer()
        price = analyzer._expected_price_at_expiry(100.0, "20260415")
        assert price == pytest.approx(100.0)

    def test_current_above_deal_converges_down(self):
        """Stock above deal price → interpolation pulls price DOWN toward deal."""
        analyzer = self._make_analyzer()
        price = analyzer._expected_price_at_expiry(110.0, "20260415")
        # halfway: 110 + 0.5 * (100 - 110) = 105
        assert price == pytest.approx(105.0, abs=0.5)

    def test_deal_with_extras(self):
        """Total deal value includes div + CTR → converges to 105, not 100."""
        analyzer = self._make_analyzer(deal_price=100.0, div=2.0, ctr=3.0)
        price = analyzer._expected_price_at_expiry(90.0, "20260815")
        assert price == pytest.approx(105.0)
