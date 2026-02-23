"""Tests for OptionData.mid_price property."""

import pytest

from tests.conftest import make_option


class TestMidPrice:
    def test_normal_bid_ask(self):
        opt = make_option(strike=90, bid=6.0, ask=7.0, last=6.5)
        assert opt.mid_price == pytest.approx(6.5)

    def test_wide_spread(self):
        opt = make_option(strike=90, bid=4.0, ask=8.0, last=5.0)
        assert opt.mid_price == pytest.approx(6.0)

    def test_zero_bid_falls_to_last(self):
        opt = make_option(strike=90, bid=0, ask=5.0, last=3.0)
        assert opt.mid_price == pytest.approx(3.0)

    def test_zero_ask_falls_to_last(self):
        opt = make_option(strike=90, bid=4.0, ask=0, last=3.0)
        assert opt.mid_price == pytest.approx(3.0)

    def test_both_zero_with_last(self):
        opt = make_option(strike=90, bid=0, ask=0, last=2.5)
        assert opt.mid_price == pytest.approx(2.5)

    def test_all_zero(self):
        opt = make_option(strike=90, bid=0, ask=0, last=0)
        assert opt.mid_price == pytest.approx(0.0)

    def test_penny_wide(self):
        opt = make_option(strike=90, bid=5.00, ask=5.01, last=5.0)
        assert opt.mid_price == pytest.approx(5.005)
