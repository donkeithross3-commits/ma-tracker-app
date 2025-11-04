"""
ES Futures Data Module
=======================
Fetches E-mini S&P 500 futures data for overnight testing when options markets are closed.

This module provides a simple way to:
1. Test IB Gateway connectivity
2. Verify market data flow
3. Monitor futures prices overnight when stock/options markets are closed
"""

from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.common import TickerId, TickAttrib
from threading import Thread, Event
from typing import Optional, Dict
import time
import logging

logger = logging.getLogger(__name__)


class ESFuturesScanner(EWrapper, EClient):
    """
    Simple scanner for ES futures market data
    """

    def __init__(self):
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)

        # Data storage
        self.futures_price = None
        self.futures_bid = None
        self.futures_ask = None
        self.data_received = Event()

    def connect_to_ib(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = 2):
        """Connect to IB Gateway or TWS"""
        logger.info(f"Connecting to IB at {host}:{port} (client ID: {client_id})...")
        self.connect(host, port, client_id)

        # Start message processing thread
        api_thread = Thread(target=self.run, daemon=True)
        api_thread.start()

        # Wait for connection with timeout
        for i in range(10):
            time.sleep(1)
            if self.isConnected():
                logger.info("Connected to Interactive Brokers successfully")
                return True

        logger.error("Failed to connect to IB. Please ensure TWS/Gateway is running.")
        return False

    def nextValidId(self, orderId: int):
        """Callback when connected"""
        super().nextValidId(orderId)
        logger.info(f"Connection established - next order ID: {orderId}")

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        """Handle error messages"""
        # Code 2104 is just a status message (market data farm connection)
        if errorCode == 2104 or errorCode == 2106 or errorCode == 2158:
            logger.info(f"IB Status {errorCode}: {errorString}")
        else:
            logger.warning(f"IB Error {errorCode}: {errorString}")

    def fetch_es_futures(self, contract_month: str = "202512") -> Dict:
        """
        Fetch current ES futures data

        Args:
            contract_month: Contract month in YYYYMM format (default: 202512 = Dec 2025)

        Returns:
            Dict with price data or None on error
        """
        logger.info(f"Fetching ES futures data for {contract_month}...")

        # Reset data
        self.futures_price = None
        self.futures_bid = None
        self.futures_ask = None
        self.data_received.clear()

        # Create ES futures contract
        contract = Contract()
        contract.symbol = "ES"
        contract.secType = "FUT"
        contract.exchange = "CME"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = contract_month

        # Request market data
        req_id = 9001  # Use high req ID to avoid conflicts
        self.reqMktData(req_id, contract, "", False, False, [])

        # Wait for data with timeout
        data_received = self.data_received.wait(timeout=5)

        # Cancel market data subscription
        self.cancelMktData(req_id)

        if not data_received or self.futures_price is None:
            logger.error("Failed to receive ES futures data within timeout")
            return {
                'success': False,
                'error': 'No data received within 5 seconds'
            }

        logger.info(f"ES futures data received - Price: ${self.futures_price:.2f}")

        return {
            'success': True,
            'contract': f"ESZ5 (Dec 2025)",
            'last_price': self.futures_price,
            'bid': self.futures_bid,
            'ask': self.futures_ask,
            'mid': (self.futures_bid + self.futures_ask) / 2 if (self.futures_bid and self.futures_ask) else None
        }

    def tickPrice(self, reqId: TickerId, tickType: int, price: float, attrib: TickAttrib):
        """Handle price updates"""
        if tickType == 4:  # Last price
            self.futures_price = price
            self.data_received.set()
        elif tickType == 1:  # Bid
            self.futures_bid = price
        elif tickType == 2:  # Ask
            self.futures_ask = price


# Global futures scanner instance (reused for performance)
_futures_scanner: Optional[ESFuturesScanner] = None


def get_futures_scanner() -> ESFuturesScanner:
    """Get or create futures scanner instance"""
    global _futures_scanner

    if _futures_scanner is None:
        _futures_scanner = ESFuturesScanner()
        # Connect with different client ID (2) to avoid conflict with main scanner (1)
        connected = _futures_scanner.connect_to_ib(client_id=2)
        if not connected:
            logger.warning("Futures scanner not connected to IB")

    return _futures_scanner
