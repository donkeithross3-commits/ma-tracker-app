"""Tests for MergerArbAnalyzer.find_best_opportunities() — contract coverage.

Critical "never miss liquidity" tests: given a known set of options, does
find_best_opportunities() see ALL eligible strikes and expirations?

NOTE: The scanner uses probability-weighted expected returns to filter
single-call opportunities. For positive expected_return, option cost must
be low relative to the deal payoff. This mirrors real merger arb setups
where options are cheap because the market underprices deal completion.
"""

import pytest
from datetime import datetime
from freezegun import freeze_time

from app.scanner import MergerArbAnalyzer, DealInput, OptionData
from tests.conftest import FROZEN_NOW, make_option


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cheap_call(strike: float, expiry: str = "20260714",
                bid: float = 0.20, ask: float = 0.40) -> OptionData:
    """Build a cheap call — mimics merger arb scenario where market
    underprices deal completion probability."""
    return make_option(strike=strike, expiry=expiry, right="C",
                       bid=bid, ask=ask)


def _build_chain(
    strikes: list[float],
    expiries: list[str],
    rights: list[str] | None = None,
    bid: float = 5.0,
    ask: float = 6.0,
) -> list[OptionData]:
    """Generate a grid of OptionData across strikes × expiries × rights."""
    if rights is None:
        rights = ["C", "P"]
    chain = []
    for strike in strikes:
        for expiry in expiries:
            for right in rights:
                chain.append(
                    make_option(
                        strike=strike,
                        expiry=expiry,
                        right=right,
                        bid=bid,
                        ask=ask,
                    )
                )
    return chain


# ===========================================================================
# Tests
# ===========================================================================

@freeze_time(FROZEN_NOW)
class TestAllExpirationsRepresented:
    """Feed options across 4 expirations, verify opportunities from each."""

    def test_all_four_expirations_appear(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        expiries = ["20260320", "20260417", "20260515", "20260714"]
        chain = []
        for exp in expiries:
            # Covered call at deal price (always produces results)
            chain.append(make_option(strike=100, expiry=exp, right="C",
                                     bid=2.0, ask=3.0, open_interest=500))
            # Cheap calls below deal price for single-call analysis
            chain.append(_cheap_call(strike=95, expiry=exp))
            # Put spread candidates
            chain.append(make_option(strike=90, expiry=exp, right="P",
                                     bid=1.0, ask=2.0))
            chain.append(make_option(strike=100, expiry=exp, right="P",
                                     bid=7.0, ask=8.0))

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        assert len(opps) > 0

        expiries_in_results = set()
        for opp in opps:
            for c in opp.contracts:
                expiries_in_results.add(c.expiry)

        for exp in expiries:
            assert exp in expiries_in_results, (
                f"Expiration {exp} missing from opportunities"
            )


@freeze_time(FROZEN_NOW)
class TestStrikeRangeCoverage:
    """Verify deep ITM calls aren't dropped from the eligible set."""

    def test_deep_itm_calls_included(self):
        """Calls from 75% to 100% of deal appear when priced cheaply.

        The scanner's eligible_calls filter is: strike < deal_price.
        The long-call-for-spreads bound goes down to deal * 0.75.
        With cheap pricing, even deep ITM calls pass expected_return > 0.
        """
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        # Cheap calls across the full strike range
        chain = [
            _cheap_call(75.0),    # deep ITM (deal * 0.75)
            _cheap_call(80.0),    # ITM
            _cheap_call(90.0),    # slightly ITM
            _cheap_call(95.0),    # near ATM
            _cheap_call(99.0),    # near deal
        ]

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        assert len(opps) > 0

        strikes_in_results = {c.strike for opp in opps for c in opp.contracts}
        # Deep ITM at 75 should appear (passes strike < deal_price filter)
        assert 75.0 in strikes_in_results, (
            f"Deep ITM call at 75 was dropped. Got strikes: {strikes_in_results}"
        )


@freeze_time(FROZEN_NOW)
class TestBothCallsAndPuts:
    """Feed a mixed chain, verify both call-based and put-based strategies appear."""

    def test_both_strategies_present(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        chain = [
            # Cheap single calls
            _cheap_call(90.0),
            _cheap_call(95.0),
            # Covered call at deal price
            make_option(strike=100, expiry="20260714", right="C",
                        bid=2.0, ask=3.0, open_interest=500),
            # Put spread candidates: long put below deal, short put near deal
            make_option(strike=90, expiry="20260714", right="P",
                        bid=1.0, ask=2.0),
            make_option(strike=95, expiry="20260714", right="P",
                        bid=3.0, ask=4.0),
            make_option(strike=100, expiry="20260714", right="P",
                        bid=7.0, ask=8.0),
        ]

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        strategies = {o.strategy for o in opps}

        # Single calls from cheap ITM options
        assert "call" in strategies, (
            f"No single calls found. Strategies: {strategies}"
        )
        # Put spreads (long 90P, short 100P)
        assert "put_spread" in strategies or "spread" in strategies, (
            f"No spreads found. Strategies: {strategies}"
        )


@freeze_time(FROZEN_NOW)
class TestCoveredCallStrikeFilter:
    """Covered calls only at deal price ±2%."""

    def test_covered_calls_within_bounds(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        # strike 80 is way below deal, 100 and 101 are within ±2%
        chain = [
            make_option(strike=80, expiry="20260320", right="C",
                        bid=12.0, ask=13.0, open_interest=500),
            make_option(strike=100, expiry="20260320", right="C",
                        bid=2.0, ask=3.0, open_interest=500),
            make_option(strike=101, expiry="20260320", right="C",
                        bid=1.50, ask=2.50, open_interest=500),
        ]

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        cc_opps = [o for o in opps if o.strategy == "covered_call"]

        for opp in cc_opps:
            strike = opp.contracts[0].strike
            assert 98.0 <= strike <= 102.0, (
                f"Covered call at strike {strike} outside ±2% of deal"
            )


@freeze_time(FROZEN_NOW)
class TestTopNPerExpiry:
    """Verify that each expiration gets its own top-N, not all from one expiry."""

    def test_multiple_expiries_get_representation(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        expiries = ["20260320", "20260417", "20260714"]
        # Cheap calls across multiple expiries
        chain = []
        for exp in expiries:
            for strike in [85.0, 88.0, 90.0, 92.0, 95.0, 97.0]:
                chain.append(_cheap_call(strike, expiry=exp))

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        call_opps = [o for o in opps if o.strategy == "call"]

        # Count per expiry
        opps_per_expiry = {}
        for opp in call_opps:
            exp = opp.contracts[0].expiry
            opps_per_expiry[exp] = opps_per_expiry.get(exp, 0) + 1

        # Each expiry should have ≤3 calls (top-3 per expiry)
        for exp, count in opps_per_expiry.items():
            assert count <= 3, f"Expiry {exp} has {count} calls, expected ≤3"

        # At least 2 expiries should be represented
        assert len(opps_per_expiry) >= 2, (
            f"Only {len(opps_per_expiry)} expiries represented, expected ≥2"
        )


@freeze_time(FROZEN_NOW)
class TestSingleContract:
    """Feed exactly 1 option — no spread possible, should return single calls only."""

    def test_single_call_no_crash(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        chain = [_cheap_call(90.0)]
        opps = analyzer.find_best_opportunities(chain, current_price=95.0)

        # Should not crash; may return 0 or 1 opportunities
        for opp in opps:
            assert opp.strategy == "call", "Spread from single contract is impossible"

    def test_single_put_no_crash(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        chain = [make_option(strike=100, expiry="20260714", right="P",
                             bid=8.0, ask=10.0)]
        opps = analyzer.find_best_opportunities(chain, current_price=95.0)

        # Should not crash; no put spread from a single put
        for opp in opps:
            assert opp.strategy != "put_spread"


@freeze_time(FROZEN_NOW)
class TestZeroPricedContracts:
    """All zero-priced contracts → should return empty, not crash."""

    def test_all_zero_bid_ask(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        strikes = [90.0, 95.0, 100.0, 105.0]
        chain = _build_chain(strikes, ["20260714"], bid=0.0, ask=0.0)

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        # Zero-priced options have mid_price=0, should be filtered out
        assert len(opps) == 0


@freeze_time(FROZEN_NOW)
class TestWideChain:
    """Feed a realistic-sized chain (50+ contracts) and verify no errors."""

    def test_fifty_plus_contracts(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        # 10 strikes × 3 expiries × 2 rights = 60 contracts
        strikes = [float(s) for s in range(80, 110, 3)]
        expiries = ["20260320", "20260515", "20260714"]
        chain = _build_chain(strikes, expiries)

        assert len(chain) >= 50
        opps = analyzer.find_best_opportunities(chain, current_price=95.0)

        # Should complete without error and produce some opportunities
        assert isinstance(opps, list)
        assert len(opps) > 0


@freeze_time(FROZEN_NOW)
class TestSpreadExpiryConsistency:
    """Spreads must use same-expiration legs."""

    def test_spread_legs_same_expiry(self):
        deal = DealInput("ACME", 100.0, datetime(2026, 7, 14, 12, 0), confidence=0.75)
        analyzer = MergerArbAnalyzer(deal)

        strikes = [80.0, 85.0, 90.0, 95.0, 100.0, 105.0]
        expiries = ["20260320", "20260714"]
        chain = _build_chain(strikes, expiries)

        opps = analyzer.find_best_opportunities(chain, current_price=95.0)
        spread_opps = [o for o in opps if len(o.contracts) == 2]

        for opp in spread_opps:
            assert opp.contracts[0].expiry == opp.contracts[1].expiry, (
                f"Spread has mismatched expiries: "
                f"{opp.contracts[0].expiry} vs {opp.contracts[1].expiry}"
            )
