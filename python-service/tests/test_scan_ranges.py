"""Tests for strike/expiry range calculations used by risk_routes.py scan endpoints.

Verifies the mathematical formulas that compute strike bounds and expiration
windows before they're passed to Polygon. These are pure arithmetic tests —
no DB or Polygon needed.

Reference code:
  - scan_deal_options (risk_routes.py ~L826-829):
      strike_lower = deal_price * 0.75
      strike_upper = deal_price * 1.10
      min_exp = datetime.now().strftime("%Y-%m-%d")
      max_exp = (close_dt + timedelta(days=30)).strftime("%Y-%m-%d")

  - scan_covered_calls (risk_routes.py ~L585-588):
      strike_lower = deal_price * 0.95
      strike_upper = deal_price * 1.05
      contract_type = "call"
      min_exp / max_exp same formula
"""

import pytest
from datetime import datetime, timedelta
from freezegun import freeze_time

from tests.conftest import FROZEN_NOW


# ---------------------------------------------------------------------------
# Helpers — mirror the production range calculations
# ---------------------------------------------------------------------------

def scan_deal_strike_range(deal_price: float) -> tuple[float, float]:
    """Compute (strike_lower, strike_upper) for full option scan."""
    return (deal_price * 0.75, deal_price * 1.10)


def scan_covered_call_strike_range(deal_price: float) -> tuple[float, float]:
    """Compute (strike_lower, strike_upper) for covered-call scan."""
    return (deal_price * 0.95, deal_price * 1.05)


def scan_expiry_range(now: datetime, close_dt: datetime) -> tuple[str, str]:
    """Compute (min_exp, max_exp) date strings."""
    min_exp = now.strftime("%Y-%m-%d")
    max_exp = (close_dt + timedelta(days=30)).strftime("%Y-%m-%d")
    return (min_exp, max_exp)


# ===========================================================================
# scan_deal_options strike range
# ===========================================================================

class TestDealOptionStrikeRange:
    """Strike bounds for the full option scan: deal_price × 0.75 to × 1.10."""

    def test_standard_deal_100(self):
        lower, upper = scan_deal_strike_range(100.0)
        assert lower == pytest.approx(75.0)
        assert upper == pytest.approx(110.0)

    def test_fractional_deal_price(self):
        lower, upper = scan_deal_strike_range(47.50)
        assert lower == pytest.approx(47.50 * 0.75)
        assert upper == pytest.approx(47.50 * 1.10)

    def test_high_deal_price(self):
        lower, upper = scan_deal_strike_range(500.0)
        assert lower == pytest.approx(375.0)
        assert upper == pytest.approx(550.0)

    def test_zero_deal_price(self):
        """deal_price=0 produces 0..0 range (production returns early before here)."""
        lower, upper = scan_deal_strike_range(0.0)
        assert lower == 0.0
        assert upper == 0.0


# ===========================================================================
# scan_covered_calls strike range
# ===========================================================================

class TestCoveredCallStrikeRange:
    """Covered-call scan uses narrower bounds: deal_price × 0.95 to × 1.05."""

    def test_standard_deal_100(self):
        lower, upper = scan_covered_call_strike_range(100.0)
        assert lower == pytest.approx(95.0)
        assert upper == pytest.approx(105.0)

    def test_narrow_range_small_price(self):
        lower, upper = scan_covered_call_strike_range(20.0)
        assert lower == pytest.approx(19.0)
        assert upper == pytest.approx(21.0)

    def test_covered_range_narrower_than_full(self):
        """Covered-call range must always be a strict subset of the full range."""
        for price in [20.0, 50.0, 100.0, 200.0, 500.0]:
            full_lo, full_hi = scan_deal_strike_range(price)
            cc_lo, cc_hi = scan_covered_call_strike_range(price)
            assert cc_lo >= full_lo, f"CC lower {cc_lo} below full {full_lo}"
            assert cc_hi <= full_hi, f"CC upper {cc_hi} above full {full_hi}"


# ===========================================================================
# Expiry range
# ===========================================================================

@freeze_time(FROZEN_NOW)
class TestExpiryRange:
    """Expiration window: today → close_date + 30 days."""

    def test_standard_close_180_days(self):
        now = datetime.now()
        close_dt = datetime(2026, 7, 14, 12, 0)
        min_exp, max_exp = scan_expiry_range(now, close_dt)

        assert min_exp == "2026-01-15"
        assert max_exp == "2026-08-13"

    def test_close_tomorrow(self):
        """Deal closing tomorrow → still valid range (today to tomorrow + 30d)."""
        now = datetime.now()
        close_dt = datetime(2026, 1, 16, 12, 0)
        min_exp, max_exp = scan_expiry_range(now, close_dt)

        assert min_exp == "2026-01-15"
        assert max_exp == "2026-02-15"
        # min < max, so the range is valid
        assert min_exp < max_exp

    def test_close_in_one_year(self):
        """Deal closing in ~1 year → wide but bounded range."""
        now = datetime.now()
        close_dt = datetime(2027, 1, 15, 12, 0)
        min_exp, max_exp = scan_expiry_range(now, close_dt)

        assert min_exp == "2026-01-15"
        assert max_exp == "2027-02-14"

    def test_close_today(self):
        """Deal closing today → min_exp == today, max_exp = today + 30 days."""
        now = datetime.now()
        close_dt = datetime(2026, 1, 15, 12, 0)
        min_exp, max_exp = scan_expiry_range(now, close_dt)

        assert min_exp == "2026-01-15"
        assert max_exp == "2026-02-14"
        assert min_exp < max_exp

    def test_date_format_is_yyyy_mm_dd(self):
        """Both dates must be YYYY-MM-DD format for Polygon API."""
        now = datetime.now()
        close_dt = datetime(2026, 7, 14, 12, 0)
        min_exp, max_exp = scan_expiry_range(now, close_dt)

        # Verify format: YYYY-MM-DD (10 chars, dashes at positions 4 and 7)
        for d in [min_exp, max_exp]:
            assert len(d) == 10
            assert d[4] == "-"
            assert d[7] == "-"
