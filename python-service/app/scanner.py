#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Interactive Brokers Merger Arbitrage Option Scanner
====================================================
Scans for attractive call options and spreads based on merger deal parameters
"""

import sys
import io

# Force UTF-8 encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

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
from ibapi.common import TickerId, TickAttrib, SetOfString, SetOfFloat
from threading import Thread, Event
import queue
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging


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


class IBMergerArbScanner(EWrapper, EClient):
    """
    IB API-based scanner for merger arbitrage options
    """

    def __init__(self):
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)
        logger = logging.getLogger(__name__)
        logger.info("=" * 80)
        logger.info("SCANNER INIT: Code version with callback fix loaded!")
        logger.info("=" * 80)

        # Data storage
        self.option_chain = {}
        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None
        self.contract_details = None  # Store resolved contract details
        self.available_expirations = []  # Store available option expirations from IB
        self.available_strikes = {}  # Store available strikes by expiration

        # Request tracking
        self.req_id_map = {}
        self.next_req_id = 1000
        self.data_ready = Event()

        # Queue for handling callbacks
        self.data_queue = queue.Queue()

        # Thread pool for parallel requests
        self.executor = ThreadPoolExecutor(max_workers=10)

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
        print("=" * 80)
        print(f"NEXT VALID ID CALLBACK FIRED! orderId={orderId}")
        print("=" * 80)
        super().nextValidId(orderId)
        self.next_req_id = orderId
        print(f"Ready with next order ID: {orderId}")

    def get_next_req_id(self) -> int:
        """Get next request ID"""
        req_id = self.next_req_id
        self.next_req_id += 1
        return req_id

    def resolve_contract(self, ticker: str) -> Optional[int]:
        """Resolve stock contract to get contract ID"""
        print(f"Resolving contract for {ticker}...")

        # Create stock contract
        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

        # Request contract details
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"contract_details_{ticker}"
        self.contract_details = None

        self.reqContractDetails(req_id, contract)

        # Wait for response - reduced from 2s to 0.5s
        time.sleep(0.5)

        if self.contract_details:
            con_id = self.contract_details.contract.conId
            print(f"Resolved {ticker} to contract ID: {con_id}")
            return con_id
        else:
            print(f"Warning: Could not resolve contract ID for {ticker}")
            return None

    def contractDetails(self, reqId: int, contractDetails):
        """Handle contract details response"""
        if reqId in self.req_id_map and "contract_details" in self.req_id_map[reqId]:
            self.contract_details = contractDetails
            print(f"Got contract details: {contractDetails.contract.symbol} (ID: {contractDetails.contract.conId})")

    def contractDetailsEnd(self, reqId: int):
        """Handle end of contract details"""
        pass

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

        # Wait for data - reduced from 2s to 0.5s
        time.sleep(0.5)

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
            elif reqId in self.option_chain:
                # Handle option prices
                if tickType == 1:  # Bid
                    self.option_chain[reqId]['bid'] = price
                elif tickType == 2:  # Ask
                    self.option_chain[reqId]['ask'] = price
                elif tickType == 4:  # Last
                    self.option_chain[reqId]['last'] = price

    def tickSize(self, reqId: TickerId, tickType: int, size: int):
        """Handle size updates (volume, open interest)"""
        if reqId in self.option_chain:
            if tickType == 8:  # Volume
                self.option_chain[reqId]['volume'] = size
            elif tickType == 27:  # Open Interest
                self.option_chain[reqId]['open_interest'] = size

    def fetch_option_chain(self, ticker: str, expiry_months: int = 6, current_price: float = None, deal_close_date: datetime = None, days_before_close: int = 0, deal_price: float = None) -> List[OptionData]:
        """Fetch option chain from IB - LIMITED to avoid 100+ instrument limit

        If deal_close_date is provided, fetches expirations around that date.
        days_before_close: How many days before deal close to look for expirations
            - 0: Only expirations on or after deal_close_date
            - N > 0: Expirations from (deal_close_date - N days) onwards
        deal_price: Expected deal price for filtering relevant strikes
        Otherwise falls back to expiry_months from now.
        """
        print(f"Fetching option chain for {ticker} (LIMITED to avoid IB limits)...")

        # First, resolve contract to get contract ID
        contract_id = self.resolve_contract(ticker)
        if not contract_id:
            print(f"Warning: Could not resolve contract ID for {ticker}, trying with ID=0")
            contract_id = 0

        # Create underlying contract for option chain request
        underlying = Contract()
        underlying.symbol = ticker
        underlying.secType = "STK"
        underlying.exchange = "SMART"
        underlying.currency = "USD"

        # Request security definition option parameters
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"option_chain_{ticker}"

        self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)

        # Wait for response - reduced from 3s to 1s
        time.sleep(1)

        # Now request specific option contracts - LIMITED
        options = []

        # Use passed price or fallback to underlying_price
        price_to_use = current_price or self.underlying_price

        # LIMIT: Only get 2-3 expirations and 2-3 strikes each
        if price_to_use:
            # Determine which expirations to fetch
            if deal_close_date:
                # Smart selection: Get expiration before AND after deal close
                # Use IB API to get REAL expirations (including weeklies)
                all_expiries = self.get_available_expirations(ticker, contract_id)
                if not all_expiries:  # Fallback to stub if IB call fails
                    print(f"Warning: IB expiration lookup failed, falling back to monthly expirations only")
                    all_expiries = self.get_expiries(ticker, deal_close_date + timedelta(days=90))

                # Find expirations relative to deal close date and days_before_close parameter
                if days_before_close == 0:
                    # Select ONLY the latest expiration before/at close AND earliest after close
                    # This gives us exactly 2 expirations bracketing the deal close
                    sorted_expiries = sorted(all_expiries)

                    # Deduplicate while preserving order (remove exchange duplicates)
                    seen = set()
                    unique_expiries = [x for x in sorted_expiries if not (x in seen or seen.add(x))]

                    print(f"DEBUG: {len(unique_expiries)} unique expirations for {ticker}: {unique_expiries}")
                    print(f"DEBUG: Deal close date: {deal_close_date.strftime('%Y-%m-%d')}")

                    expiries_before = [exp for exp in unique_expiries if datetime.strptime(exp, '%Y%m%d') < deal_close_date]
                    expiries_at_or_after = [exp for exp in unique_expiries if datetime.strptime(exp, '%Y%m%d') >= deal_close_date]

                    print(f"DEBUG: {len(expiries_before)} expirations BEFORE close: {expiries_before}")
                    print(f"DEBUG: {len(expiries_at_or_after)} expirations AT/AFTER close: {expiries_at_or_after}")

                    selected_expiries = []
                    # Get ONLY the LATEST expiration before deal close (closest to deal date)
                    if expiries_before:
                        selected_expiries.append(expiries_before[-1])  # Last one (closest to close date)
                        print(f"Selected expiration BEFORE close: {expiries_before[-1]}")

                    # Get ONLY the EARLIEST expiration at or after deal close
                    if expiries_at_or_after:
                        selected_expiries.append(expiries_at_or_after[0])  # First one (closest after close date)
                        print(f"Selected expiration AT/AFTER close: {expiries_at_or_after[0]}")

                    print(f"Selected expirations around deal close date {deal_close_date.strftime('%Y-%m-%d')}: {selected_expiries}")
                else:
                    # Allow expirations N days before deal close
                    earliest_date = deal_close_date - timedelta(days=days_before_close)
                    expiries_valid = [exp for exp in all_expiries if datetime.strptime(exp, '%Y%m%d') >= earliest_date]
                    # Select 2-3 expirations in the valid range
                    selected_expiries = expiries_valid[:3] if expiries_valid else []
                    print(f"Selected expirations from {earliest_date.strftime('%Y-%m-%d')} to beyond deal close {deal_close_date.strftime('%Y-%m-%d')}: {selected_expiries}")

                expiries = selected_expiries
            else:
                # Fallback: Get only 3 expirations from now
                # Use IB API to get REAL expirations (including weeklies)
                all_expiries = self.get_available_expirations(ticker, contract_id)
                if not all_expiries:  # Fallback to stub if IB call fails
                    print(f"Warning: IB expiration lookup failed, falling back to monthly expirations only")
                    all_expiries = self.get_expiries(ticker, datetime.now() + timedelta(days=expiry_months * 30))
                expiries = all_expiries[:3]

            for expiry in expiries:
                # Try to get actual strikes from IB for this expiration
                if expiry in self.available_strikes and self.available_strikes[expiry]:
                    available_strikes = self.available_strikes[expiry]
                    print(f"Using {len(available_strikes)} strikes from IB for {expiry}")

                    # Filter strikes: 20% below deal price to 10% above
                    # This captures all potential call spreads for merger arb
                    if deal_price:
                        min_strike = deal_price * 0.80  # 20% below deal price
                        max_strike = max(price_to_use, deal_price) * 1.10  # 10% above current/deal
                    else:
                        min_strike = price_to_use * 0.80
                        max_strike = price_to_use * 1.10

                    relevant_strikes = [s for s in available_strikes if min_strike <= s <= max_strike]

                    print(f"Strike range for {expiry}: ${min_strike:.2f} - ${max_strike:.2f}")
                    print(f"Found {len(relevant_strikes)} relevant strikes: {relevant_strikes[:10]}...")  # Show first 10

                    # Use all relevant strikes (don't limit to just 5)
                    # The analyzer will evaluate all combinations and pick the best
                    strikes = relevant_strikes

                    print(f"Selected {len(strikes)} strikes for {expiry}")
                else:
                    # Fallback: guess strikes around current price
                    print(f"No IB strikes available for {expiry}, using calculated strikes")
                    strikes = [price_to_use * 0.95, price_to_use, price_to_use * 1.05]
                    strikes = [round(s / 5) * 5 for s in strikes]

                # Build batch requests for all strikes (calls and puts)
                batch_requests = []
                for strike in strikes:
                    batch_requests.append((expiry, strike, "C"))  # Call
                    batch_requests.append((expiry, strike, "P"))  # Put

                print(f"Fetching {len(batch_requests)} option contracts for {expiry} using batch processing...")

                # Fetch all contracts for this expiry in parallel batches
                batch_results = self.get_option_data_batch(ticker, batch_requests)

                # Process results and add to options list
                for i, option_data in enumerate(batch_results):
                    if option_data:
                        options.append(option_data)
                        # Debug: Show specific options we're interested in
                        expiry_match = option_data.expiry == '20260618'
                        strike_match = option_data.strike in [200.0, 210.0]
                        if expiry_match and strike_match:
                            print(f"DEBUG: Found {option_data.expiry} {option_data.strike}{option_data.right} - "
                                  f"bid: {option_data.bid}, ask: {option_data.ask}, mid: {option_data.mid_price}")
                    else:
                        # Debug: Show why options are filtered out (only for key strikes)
                        req = batch_requests[i]
                        if req[0] == '20260618' and req[1] in [200.0, 210.0]:
                            print(f"DEBUG: Filtered out {req[0]} {req[1]}{req[2]} - no valid pricing data from IB")

        print(f"Retrieved {len(options)} option contracts (limited to avoid IB limits)")

        # Debug: Show what we got for June 2026 and September 2026
        june_options = [o for o in options if o.expiry == '20260618']
        if june_options:
            print(f"DEBUG: June 2026 options retrieved: {len(june_options)} contracts")
            for opt in june_options:
                print(f"  {opt.strike}C - bid: {opt.bid}, ask: {opt.ask}, mid: {opt.mid_price}")

        sept_options = [o for o in options if o.expiry == '20260918']
        if sept_options:
            print(f"DEBUG: September 2026 options retrieved: {len(sept_options)} contracts")
            for opt in sept_options:
                print(f"  {opt.strike}C - bid: {opt.bid}, ask: {opt.ask}, mid: {opt.mid_price}")
        else:
            print(f"DEBUG: No September 2026 options retrieved - likely filtered due to no pricing data")

        return options

    def get_available_expirations(self, ticker: str, contract_id: int = 0) -> List[str]:
        """Get actual available option expirations from IB"""
        import logging
        logger = logging.getLogger(__name__)

        print(f"Getting available expirations for {ticker} (contract ID: {contract_id})...")

        # Request security definition option parameters
        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"expirations_{ticker}"

        logger.info(f"REQUESTING expirations with reqId={req_id}, stored as '{self.req_id_map[req_id]}'")

        # Reset storage for new request
        self.available_expirations = []
        self.available_strikes = {}

        # Use proper IB API call - reqSecDefOptParams expects:
        # reqId, underlyingSymbol, futFopExchange, underlyingSecType, underlyingConId
        self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)

        # Wait for response - reduced from 3s to 1s
        time.sleep(1)

        if not self.available_expirations:
            print(f"Warning: IB expiration lookup failed for {ticker} (contract ID: {contract_id})")
        else:
            print(f"Got {len(self.available_expirations)} expirations from IB")
            print(f"Got strikes for {len(self.available_strikes)} expirations from IB")

        return self.available_expirations

    def securityDefinitionOptionParameter(self, reqId: int, exchange: str,
                                          underlyingConId: int, tradingClass: str,
                                          multiplier: str, expirations: SetOfString,
                                          strikes: SetOfFloat):
        """Handle security definition response"""
        import sys
        import logging
        logger = logging.getLogger(__name__)

        logger.info(f"=== CALLBACK FIRED === reqId={reqId}, exchange={exchange}")
        print(f"=== CALLBACK FIRED === reqId={reqId}, exchange={exchange}", flush=True)
        sys.stdout.flush()

        print(f"reqId in map: {reqId in self.req_id_map}", flush=True)
        print(f"Mapped to: {self.req_id_map.get(reqId, 'NOT FOUND')}", flush=True)

        if reqId in self.req_id_map:
            # Convert sets to lists if needed
            exp_list = list(expirations) if isinstance(expirations, set) else expirations
            strike_list = sorted(list(strikes)) if isinstance(strikes, set) else strikes

            logger.info(f"IB {exchange}: {len(exp_list)} expirations, {len(strike_list)} strikes")
            print(f"IB {exchange}: {len(exp_list)} expirations, {len(strike_list)} strikes")
            print(f"Sample expirations: {sorted(exp_list)[:5]}")
            print(f"Sample strikes: {strike_list[:10]}")

            self.available_expirations.extend(exp_list)
            # Store strikes for each expiration
            for exp in exp_list:
                if exp not in self.available_strikes:
                    self.available_strikes[exp] = strike_list
        else:
            logger.warning(f"Skipping exchange {exchange} - reqId {reqId} not in map")
            print(f"Skipping exchange {exchange} - reqId not in map")

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

        # Reduced wait time - IB typically responds within 0.3-0.5s
        time.sleep(0.3)

        # Cancel market data
        self.cancelMktData(req_id)

        # Return populated option data
        data = self.option_chain.get(req_id)
        if data and (data['bid'] > 0 or data['last'] > 0):
            return OptionData(**data)

        return None

    def get_option_data_batch(self, ticker: str, requests: List[Tuple[str, float, str]]) -> List[Optional[OptionData]]:
        """
        Get data for multiple option contracts in parallel batches.

        Args:
            ticker: Stock symbol
            requests: List of (expiry, strike, right) tuples

        Returns:
            List of OptionData objects (None for failed requests)
        """
        logger = logging.getLogger(__name__)
        batch_size = 50  # IB limit to avoid overwhelming API
        results = []

        # Process in batches
        for i in range(0, len(requests), batch_size):
            batch = requests[i:i + batch_size]
            batch_req_ids = []

            logger.info(f"Processing batch {i//batch_size + 1}/{(len(requests) + batch_size - 1)//batch_size} ({len(batch)} contracts)")

            # Submit all requests in batch
            for expiry, strike, right in batch:
                contract = Contract()
                contract.symbol = ticker
                contract.secType = "OPT"
                contract.exchange = "SMART"
                contract.currency = "USD"
                contract.lastTradeDateOrContractMonth = expiry
                contract.strike = strike
                contract.right = right
                contract.multiplier = "100"

                req_id = self.get_next_req_id()
                self.req_id_map[req_id] = f"option_{ticker}_{expiry}_{strike}_{right}"

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

                self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])
                batch_req_ids.append(req_id)

                # Tiny delay between submissions to avoid rate limit
                time.sleep(0.05)

            # Wait for all batch responses (longer for larger batches)
            wait_time = min(2.0, 0.5 + len(batch) * 0.02)
            logger.info(f"Waiting {wait_time:.2f}s for batch responses...")
            time.sleep(wait_time)

            # Cancel all requests and collect results
            for req_id in batch_req_ids:
                self.cancelMktData(req_id)
                data = self.option_chain.get(req_id)
                if data and (data['bid'] > 0 or data['last'] > 0):
                    results.append(OptionData(**data))
                else:
                    results.append(None)

            # Small delay between batches
            if i + batch_size < len(requests):
                time.sleep(0.2)

        logger.info(f"Batch processing complete: {len([r for r in results if r])} / {len(requests)} successful")
        return results

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
        if long_call.ask <= 0 or short_call.bid <= 0:
            return None

        # MIDPOINT spread cost (using mid prices)
        spread_cost_mid = long_call.mid_price - short_call.mid_price

        # FAR-TOUCH spread cost (pay ask for long, receive bid for short)
        spread_cost_ft = long_call.ask - short_call.bid

        print(f"DEBUG FT: {long_call.strike}/{short_call.strike} - Long ask: {long_call.ask}, Short bid: {short_call.bid}, FT cost: {spread_cost_ft}")

        if spread_cost_mid <= 0 or spread_cost_ft <= 0:
            return None

        # Value at deal close (same for both calculations)
        if self.deal.total_deal_value >= short_call.strike:
            # Deal price at or above short strike - get full spread value
            value_at_deal_close = short_call.strike - long_call.strike
        elif self.deal.total_deal_value > long_call.strike:
            # Deal price between strikes - get partial value
            value_at_deal_close = self.deal.total_deal_value - long_call.strike
        else:
            # Deal price below long strike - spread expires worthless
            value_at_deal_close = 0

        # MIDPOINT calculations
        # For merger arb, expected return = spread value at close - cost
        # (not probability-weighted - the risk is in taking the trade or not)
        expected_return_mid = value_at_deal_close - spread_cost_mid
        if expected_return_mid <= 0:
            return None

        max_profit_mid = expected_return_mid  # Same as expected return for merger arb
        breakeven_mid = long_call.strike + spread_cost_mid

        years_to_expiry = self.deal.days_to_close / 365
        annualized_return_mid = (expected_return_mid / spread_cost_mid) / years_to_expiry if years_to_expiry > 0 and spread_cost_mid > 0 else 0

        # FAR-TOUCH calculations
        expected_return_ft = value_at_deal_close - spread_cost_ft
        annualized_return_ft = (expected_return_ft / spread_cost_ft) / years_to_expiry if years_to_expiry > 0 and spread_cost_ft > 0 else 0

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

        print(f"DEBUG PUT FT: {long_put.strike}/{short_put.strike} - Short bid: {short_put.bid}, Long ask: {long_put.ask}, FT credit: {credit_ft}")

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

        # Expected return: if deal closes at or above short strike, keep full credit
        # For merger arb, we expect this outcome with high probability
        expected_return_mid = max_gain_mid
        expected_return_ft = max_gain_ft

        # Annualized return (on max loss as capital at risk)
        years_to_expiry = self.deal.days_to_close / 365
        annualized_return_mid = (expected_return_mid / max_loss_mid) / years_to_expiry if years_to_expiry > 0 and max_loss_mid > 0 else 0
        annualized_return_ft = (expected_return_ft / max_loss_ft) / years_to_expiry if years_to_expiry > 0 and max_loss_ft > 0 else 0

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
        from collections import defaultdict

        opportunities = []

        # Analyze single calls
        for option in options:
            if option.strike < self.deal.total_deal_value:  # Only calls below deal price
                opp = self.analyze_single_call(option, current_price)
                if opp and opp.expected_return > 0:
                    opportunities.append(opp)

        # Group options by expiration - spreads MUST use same expiration
        options_by_expiry = defaultdict(list)
        for option in options:
            options_by_expiry[option.expiry].append(option)

        print(f"DEBUG: Analyzing spreads for {len(options_by_expiry)} expirations")
        print(f"DEBUG: Deal price: ${self.deal.total_deal_value:.2f}")
        print(f"DEBUG: Short strike range: ${self.deal.total_deal_value * 0.95:.2f} - ${self.deal.total_deal_value + 0.50:.2f}")

        # Analyze spreads - only within same expiration month
        # Collect spreads per expiration to ensure we show top 3 from each
        spreads_by_expiry = defaultdict(list)

        for expiry, expiry_options in options_by_expiry.items():
            sorted_options = sorted(expiry_options, key=lambda x: x.strike)
            print(f"DEBUG: Expiry {expiry}: {len(sorted_options)} options with strikes {[opt.strike for opt in sorted_options]}")

            for i in range(len(sorted_options) - 1):
                long_call = sorted_options[i]

                # Only consider long strikes below deal price
                if long_call.strike >= self.deal.total_deal_value:
                    continue

                for j in range(i + 1, min(i + 5, len(sorted_options))):  # Look at next 4 strikes
                    short_call = sorted_options[j]

                    # For merger arbitrage, only consider spreads where short strike is at or near deal price
                    # Stock will converge to deal price, not exceed it
                    # Allow short strike from 95% of deal price up to deal price + $0.50 buffer
                    # This captures at-the-money spreads without including far OTM short strikes
                    if (short_call.strike >= self.deal.total_deal_value * 0.95 and
                        short_call.strike <= self.deal.total_deal_value + 0.50):
                        print(f"DEBUG: Analyzing {expiry} {long_call.strike}/{short_call.strike} spread")
                        opp = self.analyze_call_spread(long_call, short_call, current_price)
                        if opp:  # Changed: accept any valid spread analysis (removed expected_return > 0 filter)
                            spreads_by_expiry[expiry].append(opp)
                            print(f"DEBUG: Added {expiry} {long_call.strike}/{short_call.strike} spread - expected return: ${opp.expected_return:.2f}, annualized: {opp.annualized_return:.2%}")
                        else:
                            print(f"DEBUG: X Rejected {expiry} {long_call.strike}/{short_call.strike} spread - failed spread analysis")

        # Add top 5 call spreads from each expiration (sorted by annualized return)
        for expiry, expiry_spreads in spreads_by_expiry.items():
            # Sort this expiration's spreads by annualized return
            expiry_spreads.sort(key=lambda x: x.annualized_return, reverse=True)
            top_5 = expiry_spreads[:5]
            print(f"DEBUG: Adding top {len(top_5)} call spreads from {expiry}")
            opportunities.extend(top_5)

        # Analyze PUT SPREADS - only within same expiration month
        # Collect put spreads per expiration to ensure we show top 5 from each
        put_spreads_by_expiry = defaultdict(list)

        print(f"DEBUG: Analyzing PUT spreads for {len(options_by_expiry)} expirations")

        for expiry, expiry_options in options_by_expiry.items():
            # Separate puts from calls
            puts = [opt for opt in expiry_options if opt.right == 'P']
            sorted_puts = sorted(puts, key=lambda x: x.strike)

            print(f"DEBUG PUT: Expiry {expiry}: {len(sorted_puts)} puts with strikes {[opt.strike for opt in sorted_puts]}")

            for i in range(len(sorted_puts) - 1):
                long_put = sorted_puts[i]  # Buy lower strike put

                # Only consider long strikes below deal price
                if long_put.strike >= self.deal.total_deal_value:
                    continue

                for j in range(i + 1, min(i + 5, len(sorted_puts))):  # Look at next 4 strikes
                    short_put = sorted_puts[j]  # Sell higher strike put

                    # For merger arbitrage credit put spreads:
                    # Sell put at/near deal price, buy put below
                    # Short strike should be at or near deal price (same range as call spreads)
                    if (short_put.strike >= self.deal.total_deal_value * 0.95 and
                        short_put.strike <= self.deal.total_deal_value + 0.50):
                        print(f"DEBUG PUT: Analyzing {expiry} {long_put.strike}/{short_put.strike} put spread")
                        opp = self.analyze_put_spread(long_put, short_put, current_price)
                        if opp:
                            put_spreads_by_expiry[expiry].append(opp)
                            print(f"DEBUG PUT: Added {expiry} {long_put.strike}/{short_put.strike} put spread - expected return: ${opp.expected_return:.2f}, annualized: {opp.annualized_return:.2%}, R/R: {opp.edge_vs_market:.2f}x")
                        else:
                            print(f"DEBUG PUT: X Rejected {expiry} {long_put.strike}/{short_put.strike} put spread - failed spread analysis")

        # Add top 5 put spreads from each expiration (sorted by annualized return)
        for expiry, expiry_put_spreads in put_spreads_by_expiry.items():
            # Sort this expiration's put spreads by annualized return
            expiry_put_spreads.sort(key=lambda x: x.annualized_return, reverse=True)
            top_5 = expiry_put_spreads[:5]
            print(f"DEBUG PUT: Adding top {len(top_5)} put spreads from {expiry}")
            opportunities.extend(top_5)

        # Don't limit or globally sort - return all call spreads and put spreads
        # Frontend will display them in separate sections
        print(f"DEBUG: Returning {len(opportunities)} total opportunities")
        print(f"DEBUG: Call spreads: {len([o for o in opportunities if o.strategy == 'spread'])}")
        print(f"DEBUG: Put spreads: {len([o for o in opportunities if o.strategy == 'put_spread'])}")

        return opportunities
