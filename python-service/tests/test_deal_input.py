"""Tests for DealInput properties."""

from datetime import datetime

import pytest
from freezegun import freeze_time

from app.scanner import DealInput
from tests.conftest import FROZEN_NOW


@freeze_time(FROZEN_NOW)
class TestTotalDealValue:
    def test_basic(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14))
        assert deal.total_deal_value == 100.0

    def test_with_dividend(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14), dividend_before_close=2.0)
        assert deal.total_deal_value == 102.0

    def test_with_ctr(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14), ctr_value=3.0)
        assert deal.total_deal_value == 103.0

    def test_all_components(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14),
                         dividend_before_close=2.0, ctr_value=3.0)
        assert deal.total_deal_value == 105.0

    def test_zero_price(self):
        deal = DealInput("ACME", 0.0, datetime(2026, 7, 14),
                         dividend_before_close=2.0, ctr_value=3.0)
        assert deal.total_deal_value == 5.0


@freeze_time(FROZEN_NOW)
class TestDaysToClose:
    """Frozen at 2026-01-15 12:00."""

    def test_future_close(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0))
        assert deal.days_to_close == 180

    def test_soon_close(self):
        deal = DealInput("NEAR", 50.0, datetime(2026, 1, 20, 12, 0))
        assert deal.days_to_close == 5

    def test_past_close(self):
        """Past close date floors to 1 to avoid division-by-zero."""
        deal = DealInput("OLD", 80.0, datetime(2026, 1, 10, 12, 0))
        assert deal.days_to_close == 1
