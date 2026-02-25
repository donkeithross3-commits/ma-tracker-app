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

# IB API imports — optional, only needed by IBMergerArbScanner
try:
    from ibapi.client import EClient
    from ibapi.wrapper import EWrapper
    from ibapi.contract import Contract
    from ibapi.order import Order
    from ibapi.common import TickerId, TickAttrib, SetOfString, SetOfFloat
    _HAS_IBAPI = True
except ImportError:
    _HAS_IBAPI = False
    # Stubs so IBMergerArbScanner class definition parses without ibapi
    class EWrapper: pass   # type: ignore[no-redef]
    class EClient: pass    # type: ignore[no-redef]
    Contract = None        # type: ignore[assignment,misc]
    Order = None           # type: ignore[assignment,misc]
    TickerId = int         # type: ignore[misc]
    TickAttrib = object    # type: ignore[misc]
    SetOfString = set      # type: ignore[misc]
    SetOfFloat = set       # type: ignore[misc]
from threading import Thread, Event
import queue
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging

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


class IBMergerArbScanner(EWrapper, EClient):
    """
    IB API-based scanner for merger arbitrage options
    """

    def __init__(self):
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)

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
        # Wait for all option-parameter callbacks (IB sends multiple + End)
        self.sec_def_opt_params_done = Event()
        self._sec_def_wait_req_id = None
        # Wait for contract details end
        self.contract_details_done = Event()
        self._contract_details_wait_req_id = None

        # Queue for handling callbacks
        self.data_queue = queue.Queue()

        # Thread pool for parallel requests
        self.executor = ThreadPoolExecutor(max_workers=10)
        
        # Connection state tracking
        self.connection_lost = False
        self.last_heartbeat = time.time()
        self.connection_start_time = None

    def connect_to_ib(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = 1):
        """Connect to IB Gateway or TWS"""
        print(f"Connecting to IB at {host}:{port} with client_id={client_id}...")
        
        try:
            self.connect(host, port, client_id)
        except Exception as e:
            print(f"ERROR: Exception during connect: {e}")
            return False

        # Start message processing thread
        api_thread = Thread(target=self.run, daemon=True)
        api_thread.start()
        print("Message processing thread started, waiting for connection...")

        # Wait for connection with shorter timeout for faster feedback
        for i in range(5):  # 5 second timeout
            time.sleep(1)
            if self.isConnected():
                print(f"✅ Connected to IB successfully (took {i+1}s)")
                return True
            if i < 4:  # Don't print on last iteration
                print(f"  Waiting... ({i+1}/5)")

        print("❌ ERROR: Failed to connect to IB after 5 seconds")
        print("   Possible issues:")
        print("   1. TWS API not enabled (File → Global Configuration → API → Settings)")
        print("   2. Client ID conflict - TWS may have too many connections")
        print("   3. TWS needs to be restarted")
        return False

    def nextValidId(self, orderId: int):
        """Callback when connected - acts as heartbeat"""
        print("=" * 80)
        print(f"NEXT VALID ID CALLBACK FIRED! orderId={orderId}")
        print("=" * 80)
        super().nextValidId(orderId)
        self.next_req_id = orderId
        
        # Update connection state
        self.connection_lost = False
        self.last_heartbeat = time.time()
        if self.connection_start_time is None:
            self.connection_start_time = time.time()
        
        print(f"✅ Connection healthy - ready with next order ID: {orderId}")

    def connectionClosed(self):
        """Callback when connection is closed by IB or network"""
        import logging

        logger.warning("⚠️  IB TWS connection closed!")
        print("=" * 80)
        print("⚠️  CONNECTION TO IB TWS LOST!")
        print("=" * 80)
        self.connection_lost = True
        self.connection_start_time = None
    
    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        """Enhanced error handling with connection state tracking"""
        import logging

        
        # Critical connection errors
        if errorCode in [1100, 1101, 1102, 2110]:
            if errorCode == 1100:
                # Connection lost
                logger.warning(f"Connection lost (error {errorCode}): {errorString}")
                print(f"⚠️  Connection event {errorCode}: {errorString}")
                self.connection_lost = True
            elif errorCode == 1101:
                # Connection restored but data lost
                logger.warning(f"Connection restored - data lost (error {errorCode}): {errorString}")
                print(f"🔄 Connection event {errorCode}: {errorString}")
                self.connection_lost = False
                self.last_heartbeat = time.time()
            elif errorCode == 1102:
                # Connection restored with data maintained
                logger.info(f"Connection restored - data OK (error {errorCode}): {errorString}")
                print(f"✅ Connection event {errorCode}: {errorString}")
                self.connection_lost = False
                self.last_heartbeat = time.time()
            elif errorCode == 2110:
                # Connectivity issues
                logger.warning(f"Connectivity issue (error {errorCode}): {errorString}")
                print(f"⚠️  Connectivity event {errorCode}: {errorString}")
        
        # Informational messages (2104, 2106, 2158) - don't log as errors
        elif errorCode in [2104, 2106, 2158]:
            # These are actually "OK" messages from IB
            logger.info(f"IB Info {errorCode}: {errorString}")
        else:
            # Other errors
            logger.error(f"IB Error {reqId}/{errorCode}: {errorString}")
            print(f"ERROR {reqId}/{errorCode}: {errorString}")
    
    def get_next_req_id(self) -> int:
        """Get next request ID"""
        req_id = self.next_req_id
        self.next_req_id += 1
        return req_id

    def resolve_contract(self, ticker: str) -> Optional[int]:
        """Resolve stock contract to get contract ID. Waits for contractDetailsEnd."""
        print(f"[{ticker}] Step 1: Resolving contract...", flush=True)

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
        self._contract_details_wait_req_id = req_id
        self.contract_details_done.clear()

        self.reqContractDetails(req_id, contract)

        if not self.contract_details_done.wait(timeout=10):
            print(f"[{ticker}] Step 1: Timeout (10s) waiting for contract details", flush=True)
        self._contract_details_wait_req_id = None

        if self.contract_details:
            con_id = self.contract_details.contract.conId
            print(f"[{ticker}] Step 1: Resolved to contract ID {con_id}", flush=True)
            return con_id
        else:
            print(f"[{ticker}] Step 1: Could not resolve contract ID (no details from IB)", flush=True)
            return None

    def contractDetails(self, reqId: int, contractDetails):
        """Handle contract details response"""
        if reqId in self.req_id_map and "contract_details" in self.req_id_map[reqId]:
            self.contract_details = contractDetails
            print(f"Got contract details: {contractDetails.contract.symbol} (ID: {contractDetails.contract.conId})")

    def contractDetailsEnd(self, reqId: int):
        """Handle end of contract details"""
        if getattr(self, "_contract_details_wait_req_id", None) == reqId:
            self.contract_details_done.set()

    def fetch_underlying_data(self, ticker: str) -> Dict:
        """Fetch current underlying stock data"""
        print(f"[{ticker}] Step 2: Fetching underlying price...", flush=True)

        # Reset current data to avoid using stale values
        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None

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

        # Wait for data - 3s for slow symbols (e.g. EA)
        time.sleep(3.0)

        # Cancel market data
        self.cancelMktData(req_id)

        if self.underlying_price is not None:
            print(f"[{ticker}] Step 2: Got price {self.underlying_price}", flush=True)
        else:
            print(f"[{ticker}] Step 2: No price from IB (timeout or no data)", flush=True)

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
        """Handle size updates (volume, open interest, bid/ask sizes)"""

        if reqId in self.option_chain:
            if tickType == 0:  # Bid size
                logger.info(f"📊 Received BID SIZE: reqId={reqId}, size={size}")
                self.option_chain[reqId]['bid_size'] = size
            elif tickType == 3:  # Ask size
                logger.info(f"📊 Received ASK SIZE: reqId={reqId}, size={size}")
                self.option_chain[reqId]['ask_size'] = size
            elif tickType == 8:  # Volume
                self.option_chain[reqId]['volume'] = size
            elif tickType == 27:  # Open Interest
                self.option_chain[reqId]['open_interest'] = size
        else:
            # Log all tickSize calls for debugging
            if tickType in [0, 3]:
                logger.debug(f"tickSize for unknown reqId: {reqId}, tickType={tickType}, size={size}")

    def fetch_option_chain(self, ticker: str, expiry_months: int = 6, current_price: float = None, 
                           deal_close_date: datetime = None, days_before_close: int = 0, deal_price: float = None,
                           # 8 strike range params - fetch range derived from these
                           call_long_strike_lower_pct: float = 0.25,
                           call_long_strike_upper_pct: float = 0.0,  # hardcoded at deal
                           call_short_strike_lower_pct: float = 0.05,
                           call_short_strike_upper_pct: float = 0.10,
                           put_long_strike_lower_pct: float = 0.25,
                           put_long_strike_upper_pct: float = 0.0,   # hardcoded at deal
                           put_short_strike_lower_pct: float = 0.05,
                           put_short_strike_upper_pct: float = 0.03) -> List[OptionData]:
        """Fetch option chain from IB - LIMITED to avoid 100+ instrument limit

        If deal_close_date is provided, fetches expirations around that date.
        days_before_close: How many days before deal close to look for expirations
            - 0: Only expirations on or after deal_close_date
            - N > 0: Expirations from (deal_close_date - N days) onwards
        deal_price: Expected deal price for filtering relevant strikes
        
        Fetch range is derived from the 8 strategy params:
        - Lower: max(call_long_strike_lower_pct, put_long_strike_lower_pct) below deal
        - Upper: max(call_short_strike_upper_pct, put_short_strike_upper_pct) above deal
        """
        print(f"Fetching option chain for {ticker} (LIMITED to avoid IB limits)...")

        # First, resolve contract to get contract ID
        contract_id = self.resolve_contract(ticker)
        if not contract_id:
            print(f"Warning: Could not resolve contract ID for {ticker}, trying with ID=0")
            contract_id = 0

        # Expirations/strikes are requested once inside get_available_expirations() below.
        # Do NOT call reqSecDefOptParams here: a second request would clear the first
        # response and some symbols (e.g. EA) may only get one callback from IB.

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
                # Deduplicate and sort all expirations
                sorted_expiries = sorted(all_expiries)
                seen = set()
                unique_expiries = [x for x in sorted_expiries if not (x in seen or seen.add(x))]

                logger.debug(f": {len(unique_expiries)} unique expirations for {ticker}: {unique_expiries}")
                logger.debug(f": Deal close date: {deal_close_date.strftime('%Y-%m-%d')}")

                # Parse close date for comparison (date only, ignore time)
                close_date_only = deal_close_date.date()

                # Categorize expirations relative to close date
                expiries_on_close = [exp for exp in unique_expiries 
                                     if datetime.strptime(exp, '%Y%m%d').date() == close_date_only]
                expiries_after = [exp for exp in unique_expiries 
                                  if datetime.strptime(exp, '%Y%m%d').date() > close_date_only]

                logger.debug(f": {len(expiries_on_close)} expirations ON close: {expiries_on_close}")
                logger.debug(f": {len(expiries_after)} expirations AFTER close: {expiries_after}")

                # ALWAYS get exactly 2 expirations AFTER the close date
                selected_expiries = expiries_after[:2]
                print(f"Selected 2 expirations AFTER close: {selected_expiries}")

                # Add expiration exactly ON close date if it exists
                if expiries_on_close:
                    selected_expiries = expiries_on_close + selected_expiries
                    print(f"Added expiration ON close date: {expiries_on_close}")

                # If days_before_close > 0, include expirations in the window before close
                if days_before_close > 0:
                    earliest_date = (deal_close_date - timedelta(days=days_before_close)).date()
                    expiries_in_window = [exp for exp in unique_expiries 
                                          if earliest_date <= datetime.strptime(exp, '%Y%m%d').date() < close_date_only]
                    logger.debug(f": {len(expiries_in_window)} expirations in window ({earliest_date} to {close_date_only}): {expiries_in_window}")
                    
                    # Add any not already included (avoid duplicates)
                    for exp in expiries_in_window:
                        if exp not in selected_expiries:
                            selected_expiries.append(exp)
                    
                    # Sort final list
                    selected_expiries = sorted(selected_expiries)

                print(f"Selected expirations for deal close {deal_close_date.strftime('%Y-%m-%d')}: {selected_expiries}")

                expiries = selected_expiries
            else:
                # Fallback: Get only 3 expirations from now
                # Use IB API to get REAL expirations (including weeklies)
                all_expiries = self.get_available_expirations(ticker, contract_id)
                if not all_expiries:  # Fallback to stub if IB call fails
                    print(f"Warning: IB expiration lookup failed, falling back to monthly expirations only")
                    all_expiries = self.get_expiries(ticker, datetime.now() + timedelta(days=expiry_months * 30))
                expiries = all_expiries[:3]

            # OPTIMIZATION: Build ALL batch requests for ALL expirations first, then fetch together
            # This is much faster than processing each expiration sequentially
            all_batch_requests = []
            
            for expiry in expiries:
                # Try to get actual strikes from IB for this expiration
                if expiry in self.available_strikes and self.available_strikes[expiry]:
                    available_strikes = self.available_strikes[expiry]
                    print(f"Using {len(available_strikes)} strikes from IB for {expiry}")

                    # Compute SEPARATE fetch ranges for calls vs puts
                    # This avoids fetching puts at high strikes we'll never use (and vice versa)
                    if deal_price:
                        base_price = min(price_to_use, deal_price)
                        # CALL range: from deep ITM (long leg) to above deal (short leg for higher offers)
                        call_min_strike = base_price * (1 - call_long_strike_lower_pct)
                        call_max_strike = deal_price * (1 + call_short_strike_upper_pct)
                        # PUT range: from deep OTM (long leg) to at/near deal (short leg, tighter)
                        put_min_strike = base_price * (1 - put_long_strike_lower_pct)
                        put_max_strike = deal_price * (1 + put_short_strike_upper_pct)
                    else:
                        call_min_strike = price_to_use * (1 - call_long_strike_lower_pct)
                        call_max_strike = price_to_use * (1 + call_short_strike_upper_pct)
                        put_min_strike = price_to_use * (1 - put_long_strike_lower_pct)
                        put_max_strike = price_to_use * (1 + put_short_strike_upper_pct)

                    # Overall range for filtering available strikes (union of call and put ranges)
                    min_strike = min(call_min_strike, put_min_strike)
                    max_strike = max(call_max_strike, put_max_strike)
                    relevant_strikes = [s for s in available_strikes if min_strike <= s <= max_strike]
                    
                    # OPTIMIZATION: Detect actual strike interval from available strikes
                    # This ensures we don't skip $1 strikes when they exist (common for low-priced stocks)
                    if len(relevant_strikes) >= 2:
                        sorted_strikes = sorted(relevant_strikes)
                        # Calculate minimum difference between consecutive strikes
                        min_diff = min(sorted_strikes[i+1] - sorted_strikes[i] for i in range(len(sorted_strikes)-1))
                        # Use detected interval, but cap at $5 for high-priced stocks to avoid too many requests
                        if price_to_use > 100:
                            strike_interval = max(min_diff, 5.0)
                        elif price_to_use > 50:
                            strike_interval = max(min_diff, 2.5)
                        else:
                            # For low-priced stocks, use the actual minimum interval (could be $1 or $0.50)
                            strike_interval = min_diff
                    else:
                        strike_interval = 5.0 if price_to_use > 50 else 2.5
                    
                    # Filter strikes to the detected interval
                    # Use a tolerance for floating point comparison
                    def is_on_interval(strike, interval):
                        remainder = strike % interval
                        return remainder < 0.01 or (interval - remainder) < 0.01
                    
                    filtered_strikes = [s for s in relevant_strikes if is_on_interval(s, strike_interval)]
                    
                    # If filtering removed all strikes, keep the original set
                    if not filtered_strikes:
                        filtered_strikes = relevant_strikes
                    
                    print(f"Call strike range for {expiry}: ${call_min_strike:.2f} - ${call_max_strike:.2f}")
                    print(f"Put strike range for {expiry}: ${put_min_strike:.2f} - ${put_max_strike:.2f}")
                    print(f"Found {len(relevant_strikes)} relevant strikes, filtered to {len(filtered_strikes)} at ${strike_interval} intervals")

                    strikes = filtered_strikes

                    print(f"Selected {len(strikes)} strikes for {expiry}")
                else:
                    # Fallback: guess strikes around current price
                    print(f"No IB strikes available for {expiry}, using calculated strikes")
                    strikes = [price_to_use * 0.95, price_to_use, price_to_use * 1.05]
                    strikes = [round(s / 5) * 5 for s in strikes]
                    # Use same range for calls and puts in fallback
                    call_min_strike = put_min_strike = min(strikes)
                    call_max_strike = put_max_strike = max(strikes)

                # Build batch requests with SEPARATE ranges for calls vs puts
                # Only fetch calls/puts where they're actually needed
                for strike in strikes:
                    if call_min_strike <= strike <= call_max_strike:
                        all_batch_requests.append((expiry, strike, "C"))
                    if put_min_strike <= strike <= put_max_strike:
                        all_batch_requests.append((expiry, strike, "P"))

            print(f"Fetching {len(all_batch_requests)} option contracts across {len(expiries)} expirations...")

            # Fetch ALL contracts across all expirations in one batch operation
            batch_results = self.get_option_data_batch(ticker, all_batch_requests)

            # Process results and add to options list
            for i, option_data in enumerate(batch_results):
                if option_data:
                    options.append(option_data)
                    # Debug: Show specific options we're interested in
                    expiry_match = option_data.expiry == '20260618'
                    strike_match = option_data.strike in [200.0, 210.0]
                    if expiry_match and strike_match:
                        logger.debug(f": Found {option_data.expiry} {option_data.strike}{option_data.right} - "
                              f"bid: {option_data.bid}, ask: {option_data.ask}, mid: {option_data.mid_price}")
                else:
                    # Debug: Show why options are filtered out (only for key strikes)
                    req = all_batch_requests[i]
                    if req[0] == '20260618' and req[1] in [200.0, 210.0]:
                        logger.debug(f": Filtered out {req[0]} {req[1]}{req[2]} - no valid pricing data from IB")

        print(f"Retrieved {len(options)} option contracts (limited to avoid IB limits)")

        # Debug: Show what we got for June 2026 and September 2026
        june_options = [o for o in options if o.expiry == '20260618']
        if june_options:
            logger.debug(f": June 2026 options retrieved: {len(june_options)} contracts")
            for opt in june_options:
                print(f"  {opt.strike}C - bid: {opt.bid}, ask: {opt.ask}, mid: {opt.mid_price}")

        sept_options = [o for o in options if o.expiry == '20260918']
        if sept_options:
            logger.debug(f": September 2026 options retrieved: {len(sept_options)} contracts")
            for opt in sept_options:
                print(f"  {opt.strike}C - bid: {opt.bid}, ask: {opt.ask}, mid: {opt.mid_price}")
        else:
            logger.debug(f": No September 2026 options retrieved - likely filtered due to no pricing data")

        return options

    def get_available_expirations(self, ticker: str, contract_id: int = 0) -> List[str]:
        """Get actual available option expirations from IB"""
        import logging


        print(f"Getting available expirations for {ticker} (contract ID: {contract_id})...")

        for attempt in range(2):  # initial try + one retry for flaky symbols (e.g. EA)
            if attempt > 0:
                print(f"Retrying option parameters for {ticker} (attempt 2/2)...")
                time.sleep(1)

            # Request security definition option parameters
            req_id = self.get_next_req_id()
            self.req_id_map[req_id] = f"expirations_{ticker}"

            logger.info(f"REQUESTING expirations with reqId={req_id}, stored as '{self.req_id_map[req_id]}'")

            # Reset storage for new request
            self.available_expirations = []
            self.available_strikes = {}

            # Use proper IB API call - reqSecDefOptParams expects:
            # reqId, underlyingSymbol, futFopExchange, underlyingSecType, underlyingConId
            self._sec_def_wait_req_id = req_id
            self.sec_def_opt_params_done.clear()
            self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)

            # Wait for securityDefinitionOptionParameterEnd (all callbacks complete).
            # IB sends multiple securityDefinitionOptionParameter callbacks then End.
            if not self.sec_def_opt_params_done.wait(timeout=15):
                print(f"Warning: Timeout (15s) waiting for option parameters for {ticker}")
            self._sec_def_wait_req_id = None

            if self.available_expirations:
                print(f"Got {len(self.available_expirations)} expirations from IB")
                print(f"Got strikes for {len(self.available_strikes)} expirations from IB")
                break
            if attempt == 0:
                print(f"Warning: No option parameters for {ticker} on first try (contract ID: {contract_id})")

        if not self.available_expirations:
            print(f"Warning: IB expiration lookup failed for {ticker} (contract ID: {contract_id}) after 2 attempts")
        return self.available_expirations

    def securityDefinitionOptionParameter(self, reqId: int, exchange: str,
                                          underlyingConId: int, tradingClass: str,
                                          multiplier: str, expirations: SetOfString,
                                          strikes: SetOfFloat):
        """Handle security definition response"""
        import sys
        import logging


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

    def securityDefinitionOptionParameterEnd(self, reqId: int):
        """Called when all securityDefinitionOptionParameter callbacks are complete."""
        if getattr(self, "_sec_def_wait_req_id", None) == reqId:
            self.sec_def_opt_params_done.set()
    
            logger.info(f"secDefOptParams complete for reqId={reqId}")

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
            'vega': 0,
            'bid_size': 0,
            'ask_size': 0
        }

        # Request market data and Greeks with RTH=False for after-hours data
        self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])

        # Wait time increased to allow bid/ask size data to arrive
        time.sleep(1.5)

        # Cancel market data
        self.cancelMktData(req_id)

        # Return populated option data
        data = self.option_chain.get(req_id)
        if data and (data['bid'] > 0 or data['last'] > 0):
    
            logger.info(f"✅ Option data for {ticker} {expiry} {strike}{right}: bid_size={data.get('bid_size', 0)}, ask_size={data.get('ask_size', 0)}")
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

        batch_size = 25  # Increased from 10 for better performance (IB allows ~50 req/sec)
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
                    'vega': 0,
                    'bid_size': 0,
                    'ask_size': 0
                }

                # Use streaming mode (False) - snapshot mode requires specific subscriptions
                self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])
                batch_req_ids.append(req_id)

                # Small delay between submissions (IB allows ~50 req/sec)
                time.sleep(0.05)  # Reduced from 0.15s for faster scanning

            # Wait for streaming responses
            # Larger batches need more time, but cap at 4 seconds
            wait_time = min(4.0, 1.5 + len(batch) * 0.08)
            logger.info(f"Waiting {wait_time:.2f}s for batch responses...")
            time.sleep(wait_time)

            # Cancel all requests and collect results
            for idx, req_id in enumerate(batch_req_ids):
                self.cancelMktData(req_id)
                data = self.option_chain.get(req_id)
                if data and (data['bid'] > 0 or data['last'] > 0):
                    results.append(OptionData(**data))
                else:
                    # Log which contract failed
                    expiry, strike, right = batch[idx]
                    logger.debug(f"No valid data for {ticker} {expiry} {strike}{right}")
                    results.append(None)

            # Brief delay between batches
            if i + batch_size < len(requests):
                time.sleep(0.2)  # Reduced from 0.5s for faster scanning

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

    def _expected_price_at_expiry(self, current_price: float, option_expiry: str) -> float:
        """Estimate stock price at option expiry via linear interpolation.

        If the option expires after the deal close, assume full convergence
        to deal price.  Otherwise interpolate linearly between current price
        and deal price based on how far through the timeline we are.
        """
        expiry_date = datetime.strptime(option_expiry, "%Y%m%d")
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
        effective_basis = current_price - premium
        downside_cushion = (current_price - effective_basis) / current_price if current_price > 0 else 0

        # Static return: premium / current_price (return if stock stays flat, option expires OTM)
        static_return = premium / current_price if current_price > 0 else 0

        # If-called return: (strike - current_price + premium) / current_price
        # This is the return if the stock is at or above the strike at expiry
        if_called_profit = (call_option.strike - current_price) + premium
        if_called_return = if_called_profit / current_price if current_price > 0 else 0

        # Annualized yield (based on if-called scenario)
        years_to_expiry = max(days_to_expiry, 1) / 365
        annualized_yield = if_called_return / years_to_expiry if years_to_expiry > 0 else 0

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
                f"Sell {call_option.symbol} {call_option.strike} Call @ ${premium:.2f} bid | "
                f"Static: {static_return:.2%}, If-called: {if_called_return:.2%}, "
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
        from collections import defaultdict

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
            sorted_calls = sorted(expiry_calls, key=lambda x: x.annualized_return, reverse=True)
            opportunities.extend(sorted_calls[:3])

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
            expiry_ccs.sort(key=lambda x: x.annualized_return, reverse=True)
            opportunities.extend(expiry_ccs[:3])

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
            expiry_spreads.sort(key=lambda x: x.annualized_return, reverse=True)
            opportunities.extend(expiry_spreads[:5])

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
            expiry_put_spreads.sort(key=lambda x: x.annualized_return, reverse=True)
            opportunities.extend(expiry_put_spreads[:5])

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
