#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minimal IB Scanner for Standalone Agent
========================================
Extracted from the main scanner.py - contains only the IB connection
and data fetching functionality needed by the local agent.
"""

import sys
import io

# Force UTF-8 encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
import time
import logging
import calendar

# IB API imports (bundled in ibapi/)
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.common import TickerId, TickAttrib, SetOfString, SetOfFloat
from threading import Thread, Event
import queue
from concurrent.futures import ThreadPoolExecutor


@dataclass
class DealInput:
    """User input for merger deal"""
    ticker: str
    deal_price: float
    expected_close_date: datetime
    dividend_before_close: float = 0.0
    ctr_value: float = 0.0
    confidence: float = 0.75

    @property
    def total_deal_value(self) -> float:
        return self.deal_price + self.dividend_before_close + self.ctr_value

    @property
    def days_to_close(self) -> int:
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
    gamma: float = 0
    theta: float = 0
    vega: float = 0
    bid_size: int = 0
    ask_size: int = 0

    @property
    def mid_price(self) -> float:
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        return self.last if self.last > 0 else 0


class IBMergerArbScanner(EWrapper, EClient):
    """
    IB API-based scanner for merger arbitrage options.
    Minimal version for standalone agent - only data fetching, no strategy generation.
    """

    def __init__(self):
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)
        self.logger = logging.getLogger(__name__)

        # Data storage
        self.option_chain = {}
        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None
        self.contract_details = None
        self.available_expirations = []
        self.available_strikes = {}

        # Request tracking
        self.req_id_map = {}
        self.next_req_id = 1000
        self.data_ready = Event()
        self.data_queue = queue.Queue()
        self.executor = ThreadPoolExecutor(max_workers=10)
        
        # Connection state
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

        # Wait for connection
        for i in range(5):
            time.sleep(1)
            if self.isConnected():
                print(f"✅ Connected to IB successfully (took {i+1}s)")
                return True
            if i < 4:
                print(f"  Waiting... ({i+1}/5)")

        print("❌ ERROR: Failed to connect to IB after 5 seconds")
        return False

    def nextValidId(self, orderId: int):
        """Callback when connected"""
        super().nextValidId(orderId)
        self.next_req_id = orderId
        self.connection_lost = False
        self.last_heartbeat = time.time()
        if self.connection_start_time is None:
            self.connection_start_time = time.time()
        print(f"✅ Connection healthy - ready with next order ID: {orderId}")

    def connectionClosed(self):
        """Callback when connection is closed"""
        self.logger.warning("IB TWS connection closed!")
        print("⚠️  CONNECTION TO IB TWS LOST!")
        self.connection_lost = True
        self.connection_start_time = None
    
    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        """Handle errors"""
        if errorCode in [1100, 1101, 1102, 2110]:
            if errorCode == 1100:
                self.logger.warning(f"Connection lost: {errorString}")
                self.connection_lost = True
            elif errorCode in [1101, 1102]:
                self.logger.info(f"Connection restored: {errorString}")
                self.connection_lost = False
                self.last_heartbeat = time.time()
        elif errorCode in [2104, 2106, 2158]:
            # Informational messages
            pass
        else:
            self.logger.error(f"IB Error {reqId}/{errorCode}: {errorString}")
    
    def get_next_req_id(self) -> int:
        req_id = self.next_req_id
        self.next_req_id += 1
        return req_id

    def resolve_contract(self, ticker: str) -> Optional[int]:
        """Resolve stock contract to get contract ID"""
        print(f"Resolving contract for {ticker}...")

        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"contract_details_{ticker}"
        self.contract_details = None

        self.reqContractDetails(req_id, contract)
        time.sleep(2.0)

        if self.contract_details:
            con_id = self.contract_details.contract.conId
            print(f"Resolved {ticker} to contract ID: {con_id}")
            return con_id
        else:
            print(f"Warning: Could not resolve contract ID for {ticker}")
            return None

    def contractDetails(self, reqId: int, contractDetails):
        if reqId in self.req_id_map and "contract_details" in self.req_id_map[reqId]:
            self.contract_details = contractDetails

    def contractDetailsEnd(self, reqId: int):
        pass

    def fetch_underlying_data(self, ticker: str) -> Dict:
        """Fetch current underlying stock data"""
        print(f"Fetching underlying data for {ticker}...")
        
        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None

        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"underlying_{ticker}"

        self.reqMktData(req_id, contract, "", False, False, [])
        time.sleep(2.0)
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
                if tickType == 4:  # Last
                    self.underlying_price = price
                elif tickType == 1:  # Bid
                    self.underlying_bid = price
                elif tickType == 2:  # Ask
                    self.underlying_ask = price
            elif reqId in self.option_chain:
                if tickType == 1:
                    self.option_chain[reqId]['bid'] = price
                elif tickType == 2:
                    self.option_chain[reqId]['ask'] = price
                elif tickType == 4:
                    self.option_chain[reqId]['last'] = price

    def tickSize(self, reqId: TickerId, tickType: int, size: int):
        """Handle size updates"""
        if reqId in self.option_chain:
            if tickType == 0:  # Bid size
                self.option_chain[reqId]['bid_size'] = size
            elif tickType == 3:  # Ask size
                self.option_chain[reqId]['ask_size'] = size
            elif tickType == 8:  # Volume
                self.option_chain[reqId]['volume'] = size
            elif tickType == 27:  # Open Interest
                self.option_chain[reqId]['open_interest'] = size

    def tickOptionComputation(self, reqId: TickerId, tickType: int, tickAttrib: int,
                              impliedVol: float, delta: float, optPrice: float,
                              pvDividend: float, gamma: float, vega: float,
                              theta: float, undPrice: float):
        """Handle option Greeks"""
        if reqId in self.option_chain:
            if impliedVol and impliedVol > 0:
                self.option_chain[reqId]['implied_vol'] = impliedVol
            if delta is not None:
                self.option_chain[reqId]['delta'] = delta

    def get_available_expirations(self, ticker: str, contract_id: int = 0) -> List[str]:
        """Get available option expirations from IB"""
        print(f"Getting available expirations for {ticker}...")

        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"expirations_{ticker}"
        self.available_expirations = []
        self.available_strikes = {}

        self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)
        time.sleep(3)

        if not self.available_expirations:
            print(f"Warning: IB expiration lookup failed for {ticker}")
        else:
            print(f"Got {len(self.available_expirations)} expirations from IB")

        return self.available_expirations

    def securityDefinitionOptionParameter(self, reqId: int, exchange: str,
                                          underlyingConId: int, tradingClass: str,
                                          multiplier: str, expirations: SetOfString,
                                          strikes: SetOfFloat):
        """Handle security definition response"""
        if reqId in self.req_id_map:
            exp_list = list(expirations) if isinstance(expirations, set) else expirations
            strike_list = sorted(list(strikes)) if isinstance(strikes, set) else strikes
            self.available_expirations.extend(exp_list)
            for exp in exp_list:
                if exp not in self.available_strikes:
                    self.available_strikes[exp] = strike_list

    def securityDefinitionOptionParameterEnd(self, reqId: int):
        pass

    def get_third_friday(self, year: int, month: int) -> datetime:
        """Calculate third Friday of the month"""
        c = calendar.monthcalendar(year, month)
        first_week = c[0]
        if first_week[4] != 0:
            third_friday = c[2][4]
        else:
            third_friday = c[3][4]
        return datetime(year, month, third_friday)

    def get_expiries(self, ticker: str, end_date: datetime) -> List[str]:
        """Get monthly expiries as fallback"""
        expiries = []
        current = datetime.now()
        while current <= end_date:
            third_friday = self.get_third_friday(current.year, current.month)
            if third_friday > datetime.now():
                expiries.append(third_friday.strftime("%Y%m%d"))
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)
        return expiries

    def fetch_option_chain(self, ticker: str, expiry_months: int = 6, current_price: float = None, 
                           deal_close_date: datetime = None, days_before_close: int = 0, 
                           deal_price: float = None) -> List[OptionData]:
        """Fetch option chain from IB"""
        print(f"Fetching option chain for {ticker}...")

        contract_id = self.resolve_contract(ticker)
        if not contract_id:
            contract_id = 0

        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"option_chain_{ticker}"
        self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)
        time.sleep(2)

        options = []
        price_to_use = current_price or self.underlying_price

        if price_to_use:
            # Get expirations
            if deal_close_date:
                all_expiries = self.get_available_expirations(ticker, contract_id)
                if not all_expiries:
                    all_expiries = self.get_expiries(ticker, deal_close_date + timedelta(days=90))

                sorted_expiries = sorted(set(all_expiries))
                close_date_only = deal_close_date.date()
                
                # Get expirations after deal close
                expiries_after = [exp for exp in sorted_expiries 
                                  if datetime.strptime(exp, '%Y%m%d').date() > close_date_only]
                selected_expiries = expiries_after[:3]
                
                # Also check for expiration on close date
                expiries_on_close = [exp for exp in sorted_expiries 
                                     if datetime.strptime(exp, '%Y%m%d').date() == close_date_only]
                if expiries_on_close:
                    selected_expiries = expiries_on_close[:1] + selected_expiries
            else:
                selected_expiries = self.available_expirations[:3]

            print(f"Selected expirations: {selected_expiries}")

            # Determine strike range
            deal_price_to_use = deal_price or price_to_use
            lower_bound = deal_price_to_use * 0.75
            upper_bound = deal_price_to_use * 1.10

            # Get strikes for each expiration
            for expiry in selected_expiries:
                if expiry in self.available_strikes:
                    all_strikes = self.available_strikes[expiry]
                    strikes = [s for s in all_strikes if lower_bound <= s <= upper_bound]
                    print(f"  {expiry}: {len(strikes)} strikes in range")
                    
                    for strike in strikes:
                        for right in ['C', 'P']:
                            opt = self.get_option_data(ticker, expiry, strike, right)
                            if opt:
                                options.append(opt)

        print(f"Fetched {len(options)} options total")
        return options

    def get_option_data(self, ticker: str, expiry: str, strike: float, right: str) -> Optional[OptionData]:
        """Get data for specific option contract"""
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

        self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])
        time.sleep(1.5)
        self.cancelMktData(req_id)

        data = self.option_chain.get(req_id)
        if data and (data['bid'] > 0 or data['last'] > 0):
            return OptionData(**data)
        return None
