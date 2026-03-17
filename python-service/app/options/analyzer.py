"""Pure-analysis classes for merger arbitrage option strategies.

Extracted from app/scanner.py so that the portfolio container can use
MergerArbAnalyzer without pulling in IB API dependencies.

These classes have ZERO IB dependencies — only stdlib, numpy, and scipy.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class DealInput:
    """User input for merger deal"""
    ticker: str
    deal_price: float
    expected_close_date: datetime
    dividend_before_close: float = 0.0  # Expected dividend
    ctr_value: float = 0.0  # Contingent Value Rights or other supplementary value
    confidence: float = 0.75  # Deal confidence (0-1)

    @property
    def total_deal_value(self) -> float:
        """Total value including dividends and CTR"""
        return self.deal_price + self.dividend_before_close + self.ctr_value

    @property
    def days_to_close(self) -> int:
        """Days until expected close (min 1 to avoid division-by-zero)."""
        return max((self.expected_close_date - datetime.now()).days, 1)


@dataclass
class OptionData:
    """Option contract data"""
    symbol: str
    strike: float
    expiry: str
    right: str  # 'C' or 'P'
    bid: float
    ask: float
    last: float
    volume: int
    open_interest: int
    implied_vol: float
    delta: float
    gamma: float
    theta: float
    vega: float
    bid_size: int = 0
    ask_size: int = 0

    @property
    def mid_price(self) -> float:
        """Midpoint price"""
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        return self.last if self.last > 0 else 0


@dataclass
class TradeOpportunity:
    """Identified trading opportunity"""
    strategy: str  # 'call' or 'spread'
    contracts: List[OptionData]
    entry_cost: float  # Midpoint cost (default)
    max_profit: float
    breakeven: float
    expected_return: float  # Midpoint expected return
    annualized_return: float  # Midpoint annualized return
    probability_of_profit: float
    edge_vs_market: float
    notes: str
    # Far-touch metrics (worst-case execution)
    entry_cost_ft: float = 0.0  # Far-touch cost (pay ask, sell bid)
    expected_return_ft: float = 0.0  # Far-touch expected return
    annualized_return_ft: float = 0.0  # Far-touch annualized return


class MergerArbAnalyzer:
    """
    Analyze option opportunities for merger arbitrage
    """

    def __init__(self, deal: DealInput):
        self.deal = deal
        self.risk_free_rate = 0.05  # 5% risk-free rate

    def _expected_price_at_expiry(self, current_price: float, option_expiry: str) -> float:
        """Estimate stock price at option expiry via linear interpolation.

        If the option expires after the deal close, assume full convergence
        to deal price.  Otherwise interpolate linearly between current price
        and deal price based on how far through the timeline we are.

        Returns deal price if the expiry string can't be parsed (safe fallback
        that still produces valid, conservative opportunity analysis).

        NOTE: Linear interpolation creates cliff effects at strike boundaries for
        short-dated options on long-dated deals. A 1-day change in expiry can flip
        a spread from partial to full value when expected_price crosses a strike.
        This is inherent to the model — a future improvement could use probabilistic
        weighting across a price distribution instead of point estimates.
        """
        try:
            expiry_date = datetime.strptime(option_expiry, "%Y%m%d")
        except (ValueError, TypeError):
            return self.deal.total_deal_value
        days_to_expiry = max((expiry_date - datetime.now()).days, 1)
        if days_to_expiry >= self.deal.days_to_close:
            return self.deal.total_deal_value
        convergence = days_to_expiry / max(self.deal.days_to_close, 1)
        return current_price + convergence * (self.deal.total_deal_value - current_price)

    def analyze_single_call(self, option: OptionData, current_price: float) -> Optional[TradeOpportunity]:
        """Analyze a single call option"""

        # Skip if no valid price (need both mid and ask for far-touch)
        if option.mid_price <= 0 or option.ask <= 0:
            return None

        # Expected stock price at option expiry (interpolated if before deal close)
        expected_price = self._expected_price_at_expiry(current_price, option.expiry)
        intrinsic_at_expiry = max(0, expected_price - option.strike)

        # MIDPOINT cost and profit
        cost_mid = option.mid_price
        max_profit_mid = intrinsic_at_expiry - cost_mid

        # FAR-TOUCH cost and profit (pay the ask)
        cost_ft = option.ask
        max_profit_ft = intrinsic_at_expiry - cost_ft

        # Skip if no profit potential at midpoint
        if max_profit_mid <= 0:
            return None

        # Calculate breakeven
        breakeven = option.strike + cost_mid

        # Estimate probability (simplified Black-Scholes approximation)
        prob_itm = self.calculate_probability_itm(
            current_price,
            self.deal.total_deal_value,
            option.implied_vol if option.implied_vol > 0 else 0.30,
            self.deal.days_to_close / 365
        )

        # Adjust for deal probability
        prob_success = prob_itm * self.deal.confidence

        # Calculate expected return (probability-weighted)
        expected_return_mid = (prob_success * max_profit_mid) - ((1 - prob_success) * cost_mid)
        expected_return_ft = (prob_success * max_profit_ft) - ((1 - prob_success) * cost_ft)

        # Use the earlier of deal close or option expiration for IRR calculation
        option_expiry_date = datetime.strptime(option.expiry, "%Y%m%d")
        days_to_exit = min(self.deal.days_to_close, (option_expiry_date - datetime.now()).days)
        years_to_expiry = max(days_to_exit, 1) / 365  # At least 1 day to avoid division issues

        # Holding period return (not annualized — merger arb is a one-shot binary outcome)
        annualized_return_mid = max_profit_mid / cost_mid if cost_mid > 0 else 0
        annualized_return_ft = max_profit_ft / cost_ft if cost_ft > 0 else 0

        # Market implied probability
        market_prob = self.get_market_implied_probability(
            current_price,
            self.deal.total_deal_value,
            cost_mid,
            option.strike
        )

        # Edge vs market
        edge = self.deal.confidence - market_prob

        return TradeOpportunity(
            strategy='call',
            contracts=[option],
            entry_cost=cost_mid,
            max_profit=max_profit_mid,
            breakeven=breakeven,
            expected_return=expected_return_mid,
            annualized_return=annualized_return_mid,
            probability_of_profit=prob_success,
            edge_vs_market=edge,
            notes=f"Buy {option.symbol} {option.strike} Call @ ${cost_mid:.2f} mid (${cost_ft:.2f} FT), "
                  f"Max profit: ${max_profit_mid:.2f} at deal close",
            entry_cost_ft=cost_ft,
            expected_return_ft=expected_return_ft,
            annualized_return_ft=annualized_return_ft
        )

    def analyze_covered_call(self, call_option: OptionData, current_price: float) -> Optional[TradeOpportunity]:
        """Analyze a covered call strategy (own 100 shares + sell 1 call).

        Strike selection: at or slightly above deal price (within ±2% buffer).
        Expiration: 14+ days out, not more than deal close date + 30 day buffer.
        Filters: bid > $0.01, open_interest >= 10.
        """
        # --- Filters ---
        if call_option.bid <= 0.01:
            return None
        if call_option.open_interest < 10:
            return None

        # Expiration filters
        expiry_date = datetime.strptime(call_option.expiry, "%Y%m%d")
        days_to_expiry = (expiry_date - datetime.now()).days
        if days_to_expiry < 14:
            return None
        # Don't go past deal close + 30 day buffer
        max_expiry_days = self.deal.days_to_close + 30
        if days_to_expiry > max_expiry_days:
            return None

        # Strike selection: at or slightly above deal price (±2% buffer)
        deal_price = self.deal.total_deal_value
        strike_lower = deal_price * 0.98
        strike_upper = deal_price * 1.02
        if call_option.strike < strike_lower or call_option.strike > strike_upper:
            return None

        # --- Calculations ---
        premium = call_option.bid  # Use bid (what we'd actually receive)

        # Net premium: the incremental gain vs just tendering at deal price.
        # When strike < deal_price, getting called away means forfeiting
        # (deal_price - strike) of deal proceeds, so subtract that from premium.
        deal_price_gap = max(0, deal_price - call_option.strike)
        net_premium = premium - deal_price_gap

        effective_basis = current_price - premium
        downside_cushion = (current_price - effective_basis) / current_price if current_price > 0 else 0

        # Static return: net premium / current_price
        # This is the incremental return from selling the call vs simply holding to tender
        static_return = net_premium / current_price if current_price > 0 else 0

        # If-called return: (strike - current_price + premium) / current_price
        # This is the total return if the stock is at or above the strike at expiry
        if_called_profit = (call_option.strike - current_price) + premium
        if_called_return = if_called_profit / current_price if current_price > 0 else 0

        # Annualized premium yield (incremental yield over deal IRR)
        years_to_expiry = max(days_to_expiry, 1) / 365
        annualized_yield = static_return / years_to_expiry if years_to_expiry > 0 else 0

        # Skip if negative if-called return (stock too far above strike already without enough premium)
        if if_called_return <= 0:
            return None

        # Breakeven = current_price - premium
        breakeven = effective_basis

        # Probability estimate: prob stock stays above breakeven
        vol = call_option.implied_vol if call_option.implied_vol and call_option.implied_vol > 0 else 0.30
        prob_profit = self.calculate_probability_above(
            current_price, breakeven, vol, years_to_expiry
        )
        prob_success = prob_profit * self.deal.confidence

        return TradeOpportunity(
            strategy='covered_call',
            contracts=[call_option],
            entry_cost=current_price,  # Cost = buying 100 shares
            max_profit=if_called_profit,
            breakeven=breakeven,
            expected_return=if_called_return,
            annualized_return=annualized_yield,
            probability_of_profit=prob_success,
            edge_vs_market=static_return,  # Use static return as edge metric
            notes=(
                f"Sell {call_option.symbol} {call_option.strike} Call @ ${premium:.2f} bid"
                f"{f' (net ${net_premium:.2f} after ${deal_price_gap:.2f} gap)' if deal_price_gap > 0 else ''}"
                f" | Static: {static_return:.2%}, If-called: {if_called_return:.2%}, "
                f"Ann: {annualized_yield:.2%} | "
                f"Basis: ${effective_basis:.2f}, Cushion: {downside_cushion:.2%}"
            ),
            entry_cost_ft=current_price,  # Same for covered call (shares at market)
            expected_return_ft=if_called_return,  # Same (bid is already conservative)
            annualized_return_ft=annualized_yield,
        )

    def analyze_call_spread(self, long_call: OptionData, short_call: OptionData,
                           current_price: float) -> Optional[TradeOpportunity]:
        """Analyze a call spread"""

        # Calculate spread cost
        if long_call.mid_price <= 0 or short_call.mid_price <= 0:
            return None
        if long_call.ask <= 0 or short_call.bid <= 0:
            return None

        # MIDPOINT spread cost (using mid prices)
        spread_cost_mid = long_call.mid_price - short_call.mid_price

        # FAR-TOUCH spread cost (pay ask for long, receive bid for short)
        spread_cost_ft = long_call.ask - short_call.bid

        if spread_cost_mid <= 0 or spread_cost_ft <= 0:
            return None

        # Expected stock price at option expiry (interpolated if before deal close)
        expected_price = self._expected_price_at_expiry(current_price, long_call.expiry)

        # Value at expiry based on expected price (not deal price)
        if expected_price >= short_call.strike:
            # Expected price at or above short strike - get full spread value
            value_at_deal_close = short_call.strike - long_call.strike
        elif expected_price > long_call.strike:
            # Expected price between strikes - get partial value
            value_at_deal_close = expected_price - long_call.strike
        else:
            # Expected price below long strike - spread expires worthless
            value_at_deal_close = 0

        # MIDPOINT calculations
        # For merger arb, expected return = spread value at close - cost
        # (not probability-weighted - the risk is in taking the trade or not)
        expected_return_mid = value_at_deal_close - spread_cost_mid
        if expected_return_mid <= 0:
            return None

        max_profit_mid = expected_return_mid  # Same as expected return for merger arb
        breakeven_mid = long_call.strike + spread_cost_mid

        # Use the earlier of deal close or option expiration for IRR calculation
        option_expiry_date = datetime.strptime(long_call.expiry, "%Y%m%d")
        days_to_exit = min(self.deal.days_to_close, (option_expiry_date - datetime.now()).days)
        years_to_expiry = max(days_to_exit, 1) / 365  # At least 1 day to avoid division issues
        # Holding period return (not annualized — merger arb is a one-shot binary outcome)
        annualized_return_mid = expected_return_mid / spread_cost_mid if spread_cost_mid > 0 else 0

        # FAR-TOUCH calculations
        expected_return_ft = value_at_deal_close - spread_cost_ft
        annualized_return_ft = expected_return_ft / spread_cost_ft if spread_cost_ft > 0 else 0

        # Probability (based on midpoint breakeven)
        prob_above_breakeven = self.calculate_probability_above(
            current_price,
            breakeven_mid,
            long_call.implied_vol if long_call.implied_vol > 0 else 0.30,
            self.deal.days_to_close / 365
        )
        prob_success = prob_above_breakeven * self.deal.confidence

        return TradeOpportunity(
            strategy='spread',
            contracts=[long_call, short_call],
            entry_cost=spread_cost_mid,
            max_profit=max_profit_mid,
            breakeven=breakeven_mid,
            expected_return=expected_return_mid,
            annualized_return=annualized_return_mid,
            probability_of_profit=prob_success,
            edge_vs_market=expected_return_mid / spread_cost_mid,
            notes=f"Buy {long_call.strike}/{short_call.strike} Call Spread @ ${spread_cost_mid:.2f} mid (${spread_cost_ft:.2f} FT)",
            entry_cost_ft=spread_cost_ft,
            expected_return_ft=expected_return_ft,
            annualized_return_ft=annualized_return_ft
        )

    def analyze_put_spread(self, long_put: OptionData, short_put: OptionData,
                          current_price: float) -> Optional[TradeOpportunity]:
        """
        Analyze a credit put spread for merger arbitrage.

        Strategy: Sell put at/near deal price, buy put below deal price
        - Collect net credit (max gain)
        - Max loss = spread width - credit
        - Assumes stock converges to deal price (puts expire worthless)
        """

        # Validate prices
        if long_put.mid_price <= 0 or short_put.mid_price <= 0:
            return None
        if long_put.ask <= 0 or short_put.bid <= 0:
            return None

        # Spread width
        spread_width = short_put.strike - long_put.strike
        if spread_width <= 0:
            return None

        # MIDPOINT credit (credit = sell short put at mid - buy long put at mid)
        credit_mid = short_put.mid_price - long_put.mid_price

        # FAR-TOUCH credit (sell short put at bid, buy long put at ask)
        credit_ft = short_put.bid - long_put.ask

        if credit_mid <= 0 or credit_ft <= 0:
            return None

        # Max gain = credit collected (if deal closes and stock at/above short strike)
        max_gain_mid = credit_mid
        max_gain_ft = credit_ft

        # Max loss = spread width - credit
        max_loss_mid = spread_width - credit_mid
        max_loss_ft = spread_width - credit_ft

        if max_loss_mid <= 0 or max_loss_ft <= 0:
            return None

        # Risk/reward ratio = max gain / max loss
        risk_reward_mid = max_gain_mid / max_loss_mid
        risk_reward_ft = max_gain_ft / max_loss_ft

        # Expected stock price at option expiry (interpolated if before deal close)
        expected_price = self._expected_price_at_expiry(current_price, long_put.expiry)

        # Expected P&L at expiry based on where the stock is likely to be
        if expected_price >= short_put.strike:
            # Stock above short strike → both puts expire worthless → keep full credit
            expected_return_mid = max_gain_mid
            expected_return_ft = max_gain_ft
        elif expected_price <= long_put.strike:
            # Stock below long strike → max loss
            expected_return_mid = -max_loss_mid
            expected_return_ft = -max_loss_ft
        else:
            # Stock between strikes → partial loss
            loss = short_put.strike - expected_price
            expected_return_mid = credit_mid - loss
            expected_return_ft = credit_ft - loss

        # Use the earlier of deal close or option expiration for IRR calculation
        option_expiry_date = datetime.strptime(long_put.expiry, "%Y%m%d")
        days_to_exit = min(self.deal.days_to_close, (option_expiry_date - datetime.now()).days)
        years_to_expiry = max(days_to_exit, 1) / 365  # At least 1 day to avoid division issues
        # Holding period return on capital at risk (not annualized — merger arb is one-shot).
        # Uses max_loss as denominator: this is the actual capital at risk for the trade.
        annualized_return_mid = expected_return_mid / max_loss_mid if max_loss_mid > 0 else 0
        annualized_return_ft = expected_return_ft / max_loss_ft if max_loss_ft > 0 else 0

        # Breakeven = short strike - credit
        breakeven_mid = short_put.strike - credit_mid

        # Probability (based on midpoint breakeven)
        prob_above_breakeven = self.calculate_probability_above(
            current_price,
            breakeven_mid,
            short_put.implied_vol if short_put.implied_vol and short_put.implied_vol > 0 else 0.30,
            years_to_expiry
        )
        prob_success = prob_above_breakeven * self.deal.confidence

        return TradeOpportunity(
            strategy='put_spread',
            contracts=[long_put, short_put],
            entry_cost=max_loss_mid,  # Capital at risk
            max_profit=max_gain_mid,
            breakeven=breakeven_mid,
            expected_return=expected_return_mid,
            annualized_return=annualized_return_mid,
            probability_of_profit=prob_success,
            edge_vs_market=risk_reward_mid,  # Use risk/reward as edge metric
            notes=f"Sell {short_put.strike}/Buy {long_put.strike} Put Spread - Credit: ${credit_mid:.2f} mid (${credit_ft:.2f} FT), R/R: {risk_reward_mid:.2f}x mid ({risk_reward_ft:.2f}x FT)",
            entry_cost_ft=max_loss_ft,
            expected_return_ft=expected_return_ft,
            annualized_return_ft=annualized_return_ft
        )

    def calculate_probability_itm(self, current: float, target: float,
                                  vol: float, time: float) -> float:
        """Calculate probability of being in the money using Black-Scholes d2."""
        from scipy import stats

        if vol <= 0 or time <= 0 or current <= 0 or target <= 0:
            return 0.5

        d2 = (np.log(current / target) + (self.risk_free_rate - 0.5 * vol**2) * time) / (vol * np.sqrt(time))
        return float(stats.norm.cdf(d2))

    def calculate_probability_above(self, current: float, target: float,
                                   vol: float, time: float) -> float:
        """Calculate probability of price being above target using Black-Scholes d2."""
        from scipy import stats

        if vol <= 0 or time <= 0 or current <= 0 or target <= 0:
            return 0.5

        d2 = (np.log(current / target) + (self.risk_free_rate - 0.5 * vol**2) * time) / (vol * np.sqrt(time))
        return float(stats.norm.cdf(d2))

    def get_market_implied_probability(self, current: float, deal_price: float,
                                      option_cost: float, strike: float) -> float:
        """Extract market-implied deal probability from option prices"""

        if deal_price <= strike:
            return 0

        max_value = deal_price - strike
        if max_value <= 0:
            return 0

        # Simplified: option_cost / max_value gives rough probability
        return min(1.0, option_cost / max_value)

    def find_best_opportunities(self, options: List[OptionData],
                               current_price: float,
                               top_n: int = 10,
                               # Call spread params
                               call_long_strike_lower_pct: float = 0.25,
                               call_long_strike_upper_pct: float = 0.0,   # hardcoded at deal
                               call_short_strike_lower_pct: float = 0.05,
                               call_short_strike_upper_pct: float = 0.10,
                               # Put spread params
                               put_long_strike_lower_pct: float = 0.25,
                               put_long_strike_upper_pct: float = 0.0,    # hardcoded at deal
                               put_short_strike_lower_pct: float = 0.05,
                               put_short_strike_upper_pct: float = 0.03) -> List[TradeOpportunity]:
        """
        Find the best opportunities from option chain

        Args:
            call_long_strike_lower_pct: % BELOW deal for long call (deepest ITM)
            call_long_strike_upper_pct: % BELOW deal for long call (shallowest, 0 = at deal)
            call_short_strike_lower_pct: % BELOW deal for short call
            call_short_strike_upper_pct: % ABOVE deal for short call (higher offer buffer)
            put_long_strike_lower_pct: % BELOW deal for long put (deepest OTM)
            put_long_strike_upper_pct: % BELOW deal for long put (shallowest, 0 = at deal)
            put_short_strike_lower_pct: % BELOW deal for short put
            put_short_strike_upper_pct: % ABOVE deal for short put
        """

        opportunities = []

        # CALL spread long leg bounds
        call_long_lower_bound = self.deal.total_deal_value * (1.0 - call_long_strike_lower_pct)
        call_long_upper_bound = self.deal.total_deal_value * (1.0 - call_long_strike_upper_pct)

        # PUT spread long leg bounds
        put_long_lower_bound = self.deal.total_deal_value * (1.0 - put_long_strike_lower_pct)
        put_long_upper_bound = self.deal.total_deal_value * (1.0 - put_long_strike_upper_pct)

        # Convert percentage below/above to actual multipliers for CALL short leg
        call_short_lower_mult = 1.0 - call_short_strike_lower_pct  # e.g., 0.05 -> 0.95
        call_short_upper_mult = 1.0 + call_short_strike_upper_pct  # e.g., 0.10 -> 1.10

        # Convert percentage below/above to actual multipliers for PUT short leg
        put_short_lower_mult = 1.0 - put_short_strike_lower_pct   # e.g., 0.05 -> 0.95
        put_short_upper_mult = 1.0 + put_short_strike_upper_pct   # e.g., 0.03 -> 1.03

        # Analyze single calls - group by expiration and select top 3 per expiration
        calls_only = [opt for opt in options if opt.right == 'C']
        eligible_calls = [opt for opt in calls_only if opt.strike < self.deal.total_deal_value]
        single_calls_by_expiry = defaultdict(list)

        for option in eligible_calls:
            try:
                opp = self.analyze_single_call(option, current_price)
                if opp and opp.expected_return > 0:
                    single_calls_by_expiry[option.expiry].append(opp)
            except Exception:
                continue  # Skip malformed contracts

        # Add top 3 single calls from each expiration (sorted by annualized return)
        for expiry, expiry_calls in single_calls_by_expiry.items():
            sorted_calls = sorted(expiry_calls, key=lambda x: x.annualized_return_ft, reverse=True)
            opportunities.extend([o for o in sorted_calls[:3] if o.annualized_return_ft > 0])

        # Analyze COVERED CALLS - sell calls at/near deal price against long stock
        covered_calls_by_expiry = defaultdict(list)
        for option in calls_only:
            try:
                opp = self.analyze_covered_call(option, current_price)
                if opp:
                    covered_calls_by_expiry[option.expiry].append(opp)
            except Exception:
                continue  # Skip malformed contracts

        # Add top 3 covered calls from each expiration (sorted by annualized return)
        for expiry, expiry_ccs in covered_calls_by_expiry.items():
            expiry_ccs.sort(key=lambda x: x.annualized_return_ft, reverse=True)
            opportunities.extend([o for o in expiry_ccs[:3] if o.annualized_return_ft > 0])

        # Group options by expiration - spreads MUST use same expiration
        options_by_expiry = defaultdict(list)
        for option in options:
            options_by_expiry[option.expiry].append(option)

        # Analyze CALL SPREADS - only within same expiration month
        # Collect spreads per expiration to ensure we show top 5 from each
        spreads_by_expiry = defaultdict(list)

        for expiry, expiry_options in options_by_expiry.items():
            # CRITICAL: Separate calls from puts - only use CALLS for call spreads
            calls = [opt for opt in expiry_options if opt.right == 'C']
            sorted_calls = sorted(calls, key=lambda x: x.strike)

            for i in range(len(sorted_calls) - 1):
                long_call = sorted_calls[i]

                # CALL long leg must be within the call-specific bounds
                if long_call.strike < call_long_lower_bound or long_call.strike > call_long_upper_bound:
                    continue

                for j in range(i + 1, min(i + 5, len(sorted_calls))):  # Look at next 4 strikes
                    short_call = sorted_calls[j]

                    # For merger arbitrage, only consider spreads where short strike is at or near deal price
                    # Use CALL-specific short strike bounds (with buffer for higher offers)
                    if (short_call.strike >= self.deal.total_deal_value * call_short_lower_mult and
                        short_call.strike <= self.deal.total_deal_value * call_short_upper_mult):
                        try:
                            opp = self.analyze_call_spread(long_call, short_call, current_price)
                            if opp:
                                spreads_by_expiry[expiry].append(opp)
                        except Exception:
                            continue  # Skip malformed contracts

        # Add top 5 call spreads from each expiration (sorted by annualized return)
        for expiry, expiry_spreads in spreads_by_expiry.items():
            expiry_spreads.sort(key=lambda x: x.annualized_return_ft, reverse=True)
            opportunities.extend([o for o in expiry_spreads[:5] if o.annualized_return_ft > 0])

        # Analyze PUT SPREADS - only within same expiration month
        # Collect put spreads per expiration to ensure we show top 5 from each
        put_spreads_by_expiry = defaultdict(list)

        for expiry, expiry_options in options_by_expiry.items():
            # Separate puts from calls
            puts = [opt for opt in expiry_options if opt.right == 'P']
            sorted_puts = sorted(puts, key=lambda x: x.strike)

            for i in range(len(sorted_puts) - 1):
                long_put = sorted_puts[i]  # Buy lower strike put

                # PUT long leg must be within the put-specific bounds
                if long_put.strike < put_long_lower_bound or long_put.strike > put_long_upper_bound:
                    continue

                for j in range(i + 1, min(i + 5, len(sorted_puts))):  # Look at next 4 strikes
                    short_put = sorted_puts[j]  # Sell higher strike put

                    # For merger arbitrage credit put spreads:
                    # Sell put at/near deal price, buy put below
                    # Use PUT-specific short strike bounds (tighter, at deal price)
                    if (short_put.strike >= self.deal.total_deal_value * put_short_lower_mult and
                        short_put.strike <= self.deal.total_deal_value * put_short_upper_mult):
                        try:
                            opp = self.analyze_put_spread(long_put, short_put, current_price)
                            if opp:
                                put_spreads_by_expiry[expiry].append(opp)
                        except Exception:
                            continue  # Skip malformed contracts

        # Add top 5 put spreads from each expiration (sorted by annualized return)
        for expiry, expiry_put_spreads in put_spreads_by_expiry.items():
            expiry_put_spreads.sort(key=lambda x: x.annualized_return_ft, reverse=True)
            opportunities.extend([o for o in expiry_put_spreads[:5] if o.annualized_return_ft > 0])

        logger.info(
            "Options scan for %s: %d opportunities (calls=%d, cc=%d, spreads=%d, put_spreads=%d)",
            self.deal.ticker,
            len(opportunities),
            sum(1 for o in opportunities if o.strategy == "call"),
            sum(1 for o in opportunities if o.strategy == "covered_call"),
            sum(1 for o in opportunities if o.strategy == "spread"),
            sum(1 for o in opportunities if o.strategy == "put_spread"),
        )

        return opportunities
