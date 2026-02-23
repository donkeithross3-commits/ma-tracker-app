"""Tests for expiration window filtering — Bug #5 regression.

Bug #5: Polygon fetch used `today` as lower bound, ignoring `daysBeforeClose`.
Options expiring long before the deal close were included, wasting Polygon
quota and cluttering results.  The fix computes:
    exp_gte = max(today, close_date - days_before_close)
    exp_lte = close_date + 45 days
"""

from datetime import datetime, timedelta

import pytest
from freezegun import freeze_time

from tests.conftest import FROZEN_NOW


def _compute_exp_range(
    expected_close_date: str | None,
    days_before_close: int = 0,
    now: datetime | None = None,
) -> tuple[str, str | None]:
    """Replicate the date math from _polygon_fetch_chain (options_routes.py:837-853).

    Returns (exp_gte, exp_lte) strings.
    """
    if now is None:
        now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    exp_gte = today
    exp_lte = None

    if expected_close_date:
        try:
            close_dt = datetime.strptime(expected_close_date, "%Y-%m-%d")
            exp_lte = (close_dt + timedelta(days=45)).strftime("%Y-%m-%d")
            if days_before_close > 0:
                earliest = (close_dt - timedelta(days=days_before_close)).strftime("%Y-%m-%d")
                exp_gte = max(today, earliest)
        except ValueError:
            pass

    return exp_gte, exp_lte


@freeze_time(FROZEN_NOW)
class TestExpirationFiltering:
    """Frozen at 2026-01-15 12:00."""

    def test_days_before_close_zero(self):
        """daysBeforeClose=0 → exp_gte = today."""
        gte, lte = _compute_exp_range("2026-07-15", days_before_close=0)
        assert gte == "2026-01-15"
        assert lte == "2026-08-29"

    def test_days_before_close_60(self):
        """Bug #5 regression: daysBeforeClose=60 → exp_gte = close - 60 = May 16."""
        gte, lte = _compute_exp_range("2026-07-15", days_before_close=60)
        assert gte == "2026-05-16"
        assert lte == "2026-08-29"

    def test_days_before_close_365_clamps_to_today(self):
        """daysBeforeClose=365 → close - 365 is in the past → clamp to today."""
        gte, lte = _compute_exp_range("2026-07-15", days_before_close=365)
        # 2026-07-15 - 365 = 2025-07-16 < today (2026-01-15) → clamp
        assert gte == "2026-01-15"

    def test_close_very_soon(self):
        """Close in 5 days, daysBeforeClose=60 → close-60 is in past → today."""
        gte, lte = _compute_exp_range("2026-01-20", days_before_close=60)
        # 2026-01-20 - 60 = 2025-11-21 < today → clamp
        assert gte == "2026-01-15"
        assert lte == "2026-03-06"

    def test_no_close_date(self):
        """No close date → exp_gte = today, exp_lte = None."""
        gte, lte = _compute_exp_range(None, days_before_close=60)
        assert gte == "2026-01-15"
        assert lte is None
