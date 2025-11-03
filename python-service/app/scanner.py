"""
Interactive Brokers Merger Arbitrage Option Scanner
====================================================
Scans for attractive call options and spreads based on merger deal parameters
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import time

# IB API imports
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order
from ibapi.common import TickerId, TickAttrib
from threading import Thread, Event
import queue


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
        """Days until expected close"""
        return (self.expected_close_date - datetime.now()).days


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
    entry_cost: float
    max_profit: float
    breakeven: float
    expected_return: float
    annualized_return: float
    probability_of_profit: float
    edge_vs_market: float
    notes: str


class IBMergerArbScanner(EWrapper, EClient):
    """
    IB API-based scanner for merger arbitrage options
    """

    def __init__(self):
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)

        # Data storage
        self.option_chain = {}
        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None

        # Request tracking
        self.req_id_map = {}
        self.next_req_id = 1000
        self.data_ready = Event()

        # Queue for handling callbacks
        self.data_queue = queue.Queue()

    def connect_to_ib(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = 1):
        """Connect to IB Gateway or TWS"""
        print(f"Connecting to IB at {host}:{port}...")
        self.connect(host, port, client_id)

        # Start message processing thread
        api_thread = Thread(target=self.run, daemon=True)
        api_thread.start()

        # Wait for connection with timeout
        for i in range(10):  # 10 second timeout
            time.sleep(1)
            if self.isConnected():
                print("Connected to Interactive Brokers successfully")
                return True

        print("ERROR: Failed to connect to IB. Please ensure TWS/Gateway is running.")
        return False

    def nextValidId(self, orderId: int):
        """Callback when connected"""
        super().nextValidId(orderId)
        self.next_req_id = orderId
        print(f"Ready with next order ID: {orderId}")

    def get_next_req_id(self) -> int:
        """Get next request ID"""
        req_id = self.next_req_id
        self.next_req_id += 1
        return req_id

    def fetch_underlying_data(self, ticker: str) -> Dict:
        """Fetch current underlying stock data"""
        print(f"Fetching underlying data for {ticker}...")

        # Create stock contract
        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

        # Request market data with RTH=False to get after-hours data
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"underlying_{ticker}"

        self.reqMktData(req_id, contract, "", False, False, [])

        # Wait for data
        time.sleep(2)

        # Cancel market data
        self.cancelMktData(req_id)

        return {
            'price': self.underlying_price,
            'bid': self.underlying_bid,
            'ask': self.underlying_ask,
            'volatility': self.historical_vol if self.historical_vol else 0.30
        }

    def tickPrice(self, reqId: TickerId, tickType: int, price: float, attrib: TickAttrib):
        """Handle price updates"""
        if reqId in self.req_id_map:
            if "underlying" in self.req_id_map[reqId]:
                if tickType == 4:  # Last price
                    self.underlying_price = price
                elif tickType == 1:  # Bid
                    self.underlying_bid = price
                elif tickType == 2:  # Ask
                    self.underlying_ask = price

    def fetch_option_chain(self, ticker: str, expiry_months: int = 6, current_price: float = None) -> List[OptionData]:
        """Fetch option chain from IB - LIMITED to avoid 100+ instrument limit"""
        print(f"Fetching option chain for {ticker} (LIMITED to avoid IB limits)...")

        # Create underlying contract for option chain request
        underlying = Contract()
        underlying.symbol = ticker
        underlying.secType = "STK"
        underlying.exchange = "SMART"
        underlying.currency = "USD"

        # Request security definition option parameters
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"option_chain_{ticker}"

        self.reqSecDefOptParams(req_id, ticker, "", "STK", 0)

        # Wait for response
        time.sleep(3)

        # Now request specific option contracts - LIMITED
        options = []

        # Use passed price or fallback to underlying_price
        price_to_use = current_price or self.underlying_price

        # LIMIT: Only get 2-3 expirations and 2-3 strikes each
        if price_to_use:
            # Get only 3 expirations
            expiries = self.get_expiries(ticker, datetime.now() + timedelta(days=expiry_months * 30))[:3]

            for expiry in expiries:
                # LIMIT: Only get strikes around current price and deal price
                strikes = [price_to_use * 0.95, price_to_use, price_to_use * 1.05]
                strikes = [round(s, 0) for s in strikes]  # Round to nearest dollar

                for strike in strikes:
                    # Request call option data
                    option = self.get_option_data(ticker, expiry, strike, "C")
                    if option:
                        options.append(option)

                    # Small delay to avoid overwhelming IB
                    time.sleep(0.5)

        print(f"Retrieved {len(options)} option contracts (limited to avoid IB limits)")
        return options

    def get_available_expirations(self, ticker: str) -> List[str]:
        """Get actual available option expirations from IB"""
        print(f"Getting available expirations for {ticker}...")

        # Request security definition option parameters
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"expirations_{ticker}"

        # Store expirations as they come in
        self.available_expirations = []

        self.reqSecDefOptParams(req_id, ticker, "", "STK", 0)

        # Wait for response
        time.sleep(5)

        return self.available_expirations

    def securityDefinitionOptionalParameter(self, reqId: int, exchange: str,
                                          underlyingConId: int, tradingClass: str,
                                          multiplier: str, expirations: List[str],
                                          strikes: List[float]):
        """Handle security definition response"""
        if reqId in self.req_id_map and "expirations" in self.req_id_map[reqId]:
            print(f"Available expirations for {exchange}: {expirations}")
            self.available_expirations.extend(expirations)

    def get_expiries(self, ticker: str, end_date: datetime) -> List[str]:
        """Get available expiries (simplified - in practice would get from IB)"""
        # This would normally come from reqSecDefOptParams
        # For now, return monthly expiries
        expiries = []
        current = datetime.now()

        while current <= end_date:
            # Third Friday of the month
            third_friday = self.get_third_friday(current.year, current.month)
            if third_friday > datetime.now():
                expiries.append(third_friday.strftime("%Y%m%d"))

            # Move to next month
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)

        return expiries

    def get_third_friday(self, year: int, month: int) -> datetime:
        """Calculate third Friday of the month"""
        import calendar
        c = calendar.monthcalendar(year, month)

        # Find first Friday
        first_week = c[0]
        second_week = c[1]
        third_week = c[2]

        # Friday is day 4 (0=Monday)
        if first_week[4] != 0:
            third_friday = third_week[4]
        else:
            fourth_week = c[3]
            third_friday = fourth_week[4]

        return datetime(year, month, third_friday)

    def get_strikes_near_price(self, price: float, min_strike: float,
                              max_strike: float, increment: float = 2.5) -> List[float]:
        """Get strike prices near current price"""
        strikes = []

        # Round to nearest increment
        start = int(min_strike / increment) * increment
        end = int(max_strike / increment) * increment + increment

        current = start
        while current <= end:
            strikes.append(current)
            current += increment

        return strikes

    def get_option_data(self, ticker: str, expiry: str, strike: float, right: str) -> Optional[OptionData]:
        """Get data for specific option contract"""

        # Create option contract
        contract = Contract()
        contract.symbol = ticker
        contract.secType = "OPT"
        contract.exchange = "SMART"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = expiry
        contract.strike = strike
        contract.right = right
        contract.multiplier = "100"

        # Request market data
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"option_{ticker}_{expiry}_{strike}_{right}"

        # Store contract data
        self.option_chain[req_id] = {
            'symbol': ticker,
            'strike': strike,
            'expiry': expiry,
            'right': right,
            'bid': 0,
            'ask': 0,
            'last': 0,
            'volume': 0,
            'open_interest': 0,
            'implied_vol': 0,
            'delta': 0,
            'gamma': 0,
            'theta': 0,
            'vega': 0
        }

        # Request market data and Greeks with RTH=False for after-hours data
        self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])

        # Wait for data
        time.sleep(1)

        # Cancel market data
        self.cancelMktData(req_id)

        # Return populated option data
        data = self.option_chain.get(req_id)
        if data and (data['bid'] > 0 or data['last'] > 0):
            return OptionData(**data)

        return None

    def tickOptionComputation(self, reqId: TickerId, tickType: int,
                             impliedVol: float, delta: float, optPrice: float,
                             pvDividend: float, gamma: float, vega: float,
                             theta: float, undPrice: float, tickAttrib: TickAttrib):
        """Handle Greeks updates"""
        if reqId in self.option_chain:
            if impliedVol != -1:  # -1 means no data
                self.option_chain[reqId]['implied_vol'] = impliedVol
                self.option_chain[reqId]['delta'] = delta
                self.option_chain[reqId]['gamma'] = gamma
                self.option_chain[reqId]['theta'] = theta
                self.option_chain[reqId]['vega'] = vega


class MergerArbAnalyzer:
    """
    Analyze option opportunities for merger arbitrage
    """

    def __init__(self, deal: DealInput):
        self.deal = deal
        self.risk_free_rate = 0.05  # 5% risk-free rate

    def analyze_single_call(self, option: OptionData, current_price: float) -> Optional[TradeOpportunity]:
        """Analyze a single call option"""

        # Skip if no valid price
        if option.mid_price <= 0:
            return None

        # Calculate potential profit
        intrinsic_at_deal = max(0, self.deal.total_deal_value - option.strike)
        cost = option.mid_price
        max_profit = intrinsic_at_deal - cost

        # Skip if no profit potential
        if max_profit <= 0:
            return None

        # Calculate breakeven
        breakeven = option.strike + cost

        # Estimate probability (simplified Black-Scholes approximation)
        prob_itm = self.calculate_probability_itm(
            current_price,
            self.deal.total_deal_value,
            option.implied_vol if option.implied_vol > 0 else 0.30,
            self.deal.days_to_close / 365
        )

        # Adjust for deal probability
        prob_success = prob_itm * self.deal.confidence

        # Calculate expected return
        expected_return = (prob_success * max_profit) - ((1 - prob_success) * cost)

        # Annualized return
        years_to_expiry = self.deal.days_to_close / 365
        annualized_return = (expected_return / cost) / years_to_expiry if years_to_expiry > 0 else 0

        # Market implied probability
        market_prob = self.get_market_implied_probability(
            current_price,
            self.deal.total_deal_value,
            cost,
            option.strike
        )

        # Edge vs market
        edge = self.deal.confidence - market_prob

        return TradeOpportunity(
            strategy='call',
            contracts=[option],
            entry_cost=cost,
            max_profit=max_profit,
            breakeven=breakeven,
            expected_return=expected_return,
            annualized_return=annualized_return,
            probability_of_profit=prob_success,
            edge_vs_market=edge,
            notes=f"Buy {option.symbol} {option.strike} Call @ ${cost:.2f}, "
                  f"Max profit: ${max_profit:.2f} at deal close"
        )

    def analyze_call_spread(self, long_call: OptionData, short_call: OptionData,
                           current_price: float) -> Optional[TradeOpportunity]:
        """Analyze a call spread"""

        # Calculate spread cost
        if long_call.mid_price <= 0 or short_call.mid_price <= 0:
            return None

        spread_cost = long_call.mid_price - short_call.mid_price

        if spread_cost <= 0:
            return None

        # Max profit is difference in strikes minus cost
        max_profit = (short_call.strike - long_call.strike) - spread_cost

        if max_profit <= 0:
            return None

        # Breakeven
        breakeven = long_call.strike + spread_cost

        # Probability of profit (simplified)
        prob_above_breakeven = self.calculate_probability_above(
            current_price,
            breakeven,
            long_call.implied_vol if long_call.implied_vol > 0 else 0.30,
            self.deal.days_to_close / 365
        )

        prob_success = prob_above_breakeven * self.deal.confidence

        # Expected return
        if self.deal.total_deal_value >= short_call.strike:
            # Deal price above short strike - get max profit
            expected_profit = max_profit * self.deal.confidence
        elif self.deal.total_deal_value > long_call.strike:
            # Deal price between strikes
            partial_profit = (self.deal.total_deal_value - long_call.strike) - spread_cost
            expected_profit = partial_profit * self.deal.confidence
        else:
            # Deal price below long strike
            expected_profit = -spread_cost * (1 - self.deal.confidence)

        expected_return = expected_profit - ((1 - self.deal.confidence) * spread_cost)

        # Annualized return
        years_to_expiry = self.deal.days_to_close / 365
        annualized_return = (expected_return / spread_cost) / years_to_expiry if years_to_expiry > 0 else 0

        return TradeOpportunity(
            strategy='spread',
            contracts=[long_call, short_call],
            entry_cost=spread_cost,
            max_profit=max_profit,
            breakeven=breakeven,
            expected_return=expected_return,
            annualized_return=annualized_return,
            probability_of_profit=prob_success,
            edge_vs_market=expected_return / spread_cost,
            notes=f"Buy {long_call.strike}/{short_call.strike} Call Spread @ ${spread_cost:.2f}, "
                  f"Max profit: ${max_profit:.2f}"
        )

    def calculate_probability_itm(self, current: float, target: float,
                                  vol: float, time: float) -> float:
        """Calculate probability of being in the money"""
        from scipy import stats

        if vol <= 0 or time <= 0:
            return 0.5

        d2 = (np.log(current / target) + (self.risk_free_rate - 0.5 * vol**2) * time) / (vol * np.sqrt(time))
        return stats.norm.cdf(d2)

    def calculate_probability_above(self, current: float, target: float,
                                   vol: float, time: float) -> float:
        """Calculate probability of price being above target"""
        from scipy import stats

        if vol <= 0 or time <= 0:
            return 0.5

        d2 = (np.log(current / target) + (self.risk_free_rate - 0.5 * vol**2) * time) / (vol * np.sqrt(time))
        return stats.norm.cdf(d2)

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
                               top_n: int = 10) -> List[TradeOpportunity]:
        """Find the best opportunities from option chain"""

        opportunities = []

        # Analyze single calls
        for option in options:
            if option.strike < self.deal.total_deal_value:  # Only calls below deal price
                opp = self.analyze_single_call(option, current_price)
                if opp and opp.expected_return > 0:
                    opportunities.append(opp)

        # Analyze spreads
        sorted_options = sorted(options, key=lambda x: x.strike)

        for i in range(len(sorted_options) - 1):
            long_call = sorted_options[i]

            # Only consider long strikes below deal price
            if long_call.strike >= self.deal.total_deal_value:
                continue

            for j in range(i + 1, min(i + 5, len(sorted_options))):  # Look at next 4 strikes
                short_call = sorted_options[j]

                # Short strike should be near or above deal price
                if short_call.strike >= self.deal.total_deal_value * 0.95:
                    opp = self.analyze_call_spread(long_call, short_call, current_price)
                    if opp and opp.expected_return > 0:
                        opportunities.append(opp)

        # Sort by annualized return
        opportunities.sort(key=lambda x: x.annualized_return, reverse=True)

        return opportunities[:top_n]
