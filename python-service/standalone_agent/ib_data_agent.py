#!/usr/bin/env python3
"""
IB Data Agent - Standalone version
===================================
Local agent that connects to IB TWS and relays market data to the cloud service.

This script runs on your local machine where TWS is running. It:
1. Connects to IB TWS locally
2. Establishes a WebSocket connection to the cloud server
3. Listens for data requests and fetches data from IB
4. Sends responses back through the WebSocket

Usage:
    python ib_data_agent.py

Environment variables:
    IB_HOST         - IB TWS host (default: 127.0.0.1)
    IB_PORT         - IB TWS port (optional; overrides IB_MODE)
    IB_MODE         - "paper" (7497) or "live" (7496) when IB_PORT not set; TWS default ports
    IB_CLIENT_ID    - IB API client ID (default: 0). Use a unique value per agent when
                      running multiple agents against the same TWS. Note: only client_id=0
                      receives TWS-owned orders via reqAutoOpenOrders(True).
    RELAY_URL       - WebSocket relay URL (default: wss://dr3-dashboard.com/ws/data-provider)
    IB_PROVIDER_KEY - API key for authentication (required)
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed

# Import from local modules (bundled in same directory)
from ib_scanner import IBMergerArbScanner, DealInput
from resource_manager import ResourceManager
from quote_cache import StreamingQuoteCache
from execution_engine import ExecutionEngine, ExecutionStrategy
from position_store import PositionStore

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Quiet down chatty loggers
logging.getLogger("ibapi.wrapper").setLevel(logging.WARNING)
logging.getLogger("ibapi.client").setLevel(logging.WARNING)

# Configuration from environment (trim whitespace; config.env may have spaces)
def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key) or default
    return v.strip() if isinstance(v, str) else str(v)

IB_HOST = _env("IB_HOST") or "127.0.0.1"
# Port: use IB_PORT if set; else IB_MODE. Official TWS: 7496=live, 7497=paper.
_raw_port = _env("IB_PORT")
if _raw_port and _raw_port.isdigit():
    IB_PORT = int(_raw_port)
else:
    _mode = (_env("IB_MODE") or "paper").lower()
    IB_PORT = 7497 if _mode == "paper" else 7496  # TWS default: paper=7497, live=7496
_raw_client_id = _env("IB_CLIENT_ID")
IB_CLIENT_ID = int(_raw_client_id) if _raw_client_id and _raw_client_id.isdigit() else 0
RELAY_URL = _env("RELAY_URL") or "wss://dr3-dashboard.com/ws/data-provider"
IB_PROVIDER_KEY = _env("IB_PROVIDER_KEY")
HEARTBEAT_INTERVAL = 10  # seconds
RECONNECT_DELAY = 5  # seconds
CACHE_TTL_SECONDS = 60  # How long to cache option chain data


class OptionChainCache:
    """In-memory cache for option chain data with TTL expiration"""
    
    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS):
        self.cache = {}
        self.ttl = ttl_seconds
    
    def _make_key(self, ticker: str, deal_price: float, close_date: str, days_before_close: int) -> str:
        return f"{ticker}_{deal_price}_{close_date}_{days_before_close}"
    
    def get(self, ticker: str, deal_price: float, close_date: str, days_before_close: int):
        key = self._make_key(ticker, deal_price, close_date, days_before_close)
        if key in self.cache:
            data, timestamp = self.cache[key]
            age = time.time() - timestamp
            if age < self.ttl:
                logger.debug(f"Cache HIT for {ticker} (age: {age:.1f}s)")
                return data
            else:
                logger.debug(f"Cache EXPIRED for {ticker} (age: {age:.1f}s)")
                del self.cache[key]
        return None
    
    def set(self, ticker: str, deal_price: float, close_date: str, days_before_close: int, data: dict):
        key = self._make_key(ticker, deal_price, close_date, days_before_close)
        self.cache[key] = (data, time.time())
        logger.debug(f"Cache SET for {ticker} ({len(data.get('contracts', []))} contracts)")
    
    def clear(self):
        self.cache.clear()
        logger.info("Cache cleared")


class IBDataAgent:
    """Local agent that bridges IB TWS to the remote WebSocket relay"""
    
    def __init__(self):
        self.scanner: IBMergerArbScanner = None
        self.websocket = None
        self.running = False
        self.provider_id = None
        self.option_chain_cache = OptionChainCache(ttl_seconds=CACHE_TTL_SECONDS)
        self.resource_manager = ResourceManager()
        self.quote_cache: Optional[StreamingQuoteCache] = None  # created after scanner is ready
        self.execution_engine: Optional[ExecutionEngine] = None  # created after scanner is ready
        self.position_store = PositionStore()  # persistent position ledger
        # TWS reconnection state
        self._tws_reconnecting = False
        self._tws_last_connected: Optional[float] = None
        
    def connect_to_ib(self) -> bool:
        """Connect to IB TWS. Tries configured port first; on failure tries the other (7496/7497)
        so the agent works with either paper or live TWS without config change."""
        # clientId=0 is the "default client" that gets TWS-owned orders via
        # reqAutoOpenOrders(True). Use IB_CLIENT_ID env var to override when
        # running multiple agents against the same TWS instance.
        client_id = IB_CLIENT_ID
        # Try configured port first; then the other TWS port (7496=live, 7497=paper)
        other_port = 7497 if IB_PORT == 7496 else 7496
        ports_to_try = [IB_PORT, other_port]

        for port in ports_to_try:
            logger.info(f"Connecting to IB TWS at {IB_HOST}:{port}...")
            self.scanner = IBMergerArbScanner()
            self.scanner.resource_manager = self.resource_manager
            connected = self.scanner.connect_to_ib(
                host=IB_HOST,
                port=port,
                client_id=client_id,
            )
            if connected:
                logger.info("Successfully connected to IB TWS")
                self._tws_last_connected = time.time()
                self._tws_reconnecting = False
                # Initialize execution infrastructure (quote cache + engine)
                if self.quote_cache is None:
                    self.quote_cache = StreamingQuoteCache(self.resource_manager)
                self.scanner.streaming_cache = self.quote_cache
                if self.execution_engine is None:
                    self.execution_engine = ExecutionEngine(
                        self.scanner, self.quote_cache, self.resource_manager,
                        self.position_store,
                    )
                else:
                    self.execution_engine._scanner = self.scanner
                logger.info("Execution infrastructure initialized (quote cache + engine ready)")
                return True
            if port == ports_to_try[0]:
                logger.warning(f"Connection to {IB_HOST}:{port} failed; trying {other_port}...")

        logger.error("Failed to connect to IB TWS on either port (7496 or 7497)")
        return False

    async def _connect_to_ib_with_retry(self, max_attempts: int = 0) -> bool:
        """Connect to IB TWS with exponential backoff.
        
        max_attempts=0 means retry forever (for startup when TWS may not be running yet).
        """
        attempt = 0
        delay = 2.0
        MAX_DELAY = 60.0
        while self.running:
            attempt += 1
            if self.connect_to_ib():
                return True
            if max_attempts > 0 and attempt >= max_attempts:
                return False
            logger.warning(
                "TWS not available (attempt %d). Retrying in %.0fs... "
                "(Start TWS/Gateway if not running)",
                attempt, delay,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_DELAY)
        return False

    async def _tws_health_loop(self):
        """Background task: detect TWS disconnection and auto-reconnect.

        Checks every 5s when connected. When disconnected, attempts reconnect
        with exponential backoff (5s → 60s). Quiet logging after first attempt
        to avoid spamming the console when TWS isn't running.
        """
        CHECK_INTERVAL = 5.0
        while self.running:
            await asyncio.sleep(CHECK_INTERVAL)
            if not self.scanner:
                continue
            # Check if TWS connection is healthy
            if self.scanner.isConnected() and not self.scanner.connection_lost:
                continue
            # --- TWS is down ---
            was_previously_connected = self._tws_last_connected is not None
            if not self._tws_reconnecting:
                if was_previously_connected:
                    logger.warning("TWS connection lost — starting auto-reconnect...")
                else:
                    logger.info("TWS not yet available — will retry in background (60s intervals)")
                self._tws_reconnecting = True
            # Clean up dead socket
            try:
                self.scanner.disconnect()
            except Exception:
                pass
            # Attempt reconnect with backoff
            # Start at 5s if TWS was previously connected (likely brief outage),
            # 60s if never connected (TWS not running on this machine)
            delay = 5.0 if was_previously_connected else 60.0
            MAX_DELAY = 60.0
            while self.running and self._tws_reconnecting:
                logger.debug("Attempting TWS reconnect (delay=%.0fs)...", delay)
                if self.connect_to_ib():
                    logger.info("TWS reconnected successfully!")
                    # Re-register account event callback
                    try:
                        loop = asyncio.get_running_loop()
                        self.scanner.set_account_event_callback(
                            self._make_account_event_callback(loop)
                        )
                    except Exception as e:
                        logger.error("Failed to re-register account event callback: %s", e)
                    # Re-establish streaming subscriptions (execution engine quotes)
                    try:
                        if self.quote_cache:
                            self.quote_cache.resubscribe_all(self.scanner)
                            logger.info("Re-established streaming quote subscriptions")
                    except Exception as e:
                        logger.error("Failed to re-establish streaming subscriptions: %s", e)
                    # IB Reconciliation on reconnect (WS4)
                    try:
                        if self.execution_engine and self.execution_engine.is_running:
                            ib_positions = [
                                p for p in self.scanner.get_positions_snapshot()
                                if p.get("account") == self.IB_ACCT_CODE
                            ]
                            recon = self.execution_engine.reconcile_with_ib(ib_positions)
                            if recon["stale_agent"] or recon["orphaned_ib"] or recon["adjusted"]:
                                logger.warning(
                                    "Post-reconnect reconciliation: matched=%d, orphaned=%d, stale=%d, adjusted=%d",
                                    len(recon["matched"]), len(recon["orphaned_ib"]),
                                    len(recon["stale_agent"]), len(recon["adjusted"]),
                                )
                    except Exception as e:
                        logger.error("Post-reconnect reconciliation failed: %s", e)
                    # Notify frontend to refetch positions and open orders (orders may have filled while disconnected)
                    try:
                        if self.websocket:
                            await self.websocket.send(json.dumps({
                                "type": "account_event",
                                "event": {"event": "tws_reconnected", "ts": time.time()},
                            }))
                            logger.info("Pushed tws_reconnected event for UI sync")
                    except Exception as e:
                        logger.error("Failed to push tws_reconnected: %s", e)
                    self._tws_reconnecting = False
                    break
                await asyncio.sleep(delay)
                delay = min(delay * 2, MAX_DELAY)
    
    def disconnect_from_ib(self):
        """Disconnect from IB TWS, stopping execution engine first."""
        if self.execution_engine and self.execution_engine.is_running:
            logger.info("Stopping execution engine before IB disconnect...")
            self.execution_engine.stop()
        if self.scanner and self.scanner.isConnected():
            logger.info("Disconnecting from IB TWS...")
            self.scanner.disconnect()
    
    async def handle_request(self, request: dict) -> dict:
        """Handle a data request from the relay"""
        request_type = request.get("request_type")
        payload = request.get("payload", {})
        
        logger.debug(f"Handling request: {request_type}")
        
        try:
            if request_type == "ib_status":
                return await self._handle_ib_status()
            elif request_type == "fetch_chain":
                return await self._run_in_thread(self._handle_fetch_chain_sync, payload)
            elif request_type == "check_availability":
                return await self._handle_check_availability(payload)
            elif request_type == "fetch_underlying":
                return await self._handle_fetch_underlying(payload)
            elif request_type == "test_futures":
                return await self._handle_test_futures(payload)
            elif request_type == "get_positions":
                return await self._run_in_thread(self._handle_get_positions_sync, payload)
            elif request_type == "get_open_orders":
                return await self._run_in_thread(self._handle_get_open_orders_sync, payload)
            elif request_type == "place_order":
                return await self._run_in_thread(self._handle_place_order_sync, payload)
            elif request_type == "modify_order":
                return await self._run_in_thread(self._handle_modify_order_sync, payload)
            elif request_type == "cancel_order":
                return await self._handle_cancel_order(payload)
            elif request_type == "fetch_prices":
                return await self._run_in_thread(self._handle_fetch_prices_sync, payload)
            elif request_type == "sell_scan":
                return await self._run_in_thread(self._handle_sell_scan_sync, payload)
            # Execution engine control
            elif request_type == "execution_start":
                return await self._handle_execution_start(payload)
            elif request_type == "execution_stop":
                return await self._handle_execution_stop(payload)
            elif request_type == "execution_status":
                return await self._handle_execution_status(payload)
            elif request_type == "execution_config":
                return await self._handle_execution_config(payload)
            elif request_type == "execution_budget":
                return await self._handle_execution_budget(payload)
            elif request_type == "execution_add_ticker":
                return await self._handle_execution_add_ticker(payload)
            elif request_type == "execution_remove_ticker":
                return await self._handle_execution_remove_ticker(payload)
            elif request_type == "execution_close_position":
                return await self._handle_close_position(payload)
            elif request_type == "get_ib_executions":
                return await self._run_in_thread(self._handle_get_ib_executions_sync, payload)
            else:
                return {"error": f"Unknown request type: {request_type}"}
        except Exception as e:
            logger.error(f"Error handling request {request_type}: {e}")
            return {"error": str(e)}
    
    async def _run_in_thread(self, func, *args):
        """Run a blocking function in a thread pool"""
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return await loop.run_in_executor(pool, func, *args)
    
    async def _handle_ib_status(self) -> dict:
        """Check IB connection status, including reconnection and farm health."""
        connected = self.scanner and self.scanner.isConnected()
        farm_status = {}
        data_available = True
        read_only = False
        if self.scanner:
            farm_status = self.scanner.get_farm_status()
            data_available = self.scanner.is_data_available()
            read_only = getattr(self.scanner, "read_only_session", False)
        if self._tws_reconnecting:
            message = "IB TWS reconnecting..."
        elif connected and not data_available:
            message = "IB TWS connected but data farms are down"
        elif connected and read_only:
            message = "IB TWS connected (Read-Only — quotes only, no positions/orders)"
        elif connected:
            message = "IB TWS connected"
        else:
            message = "IB TWS not connected"
        return {
            "connected": connected,
            "reconnecting": self._tws_reconnecting,
            "message": message,
            "farm_status": farm_status,
            "data_available": data_available,
            "read_only_session": read_only,
            "last_connected": self._tws_last_connected,
        }
    
    def _ib_not_connected_error(self) -> str:
        """Return appropriate error string based on connection state."""
        if self._tws_reconnecting:
            return "IB reconnecting -- please wait..."
        return "IB not connected"

    async def _handle_check_availability(self, payload: dict) -> dict:
        """Check if options are available for a ticker"""
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"available": False, "expirationCount": 0, "error": self._ib_not_connected_error()}
        
        contract_id = self.scanner.resolve_contract(ticker)
        if not contract_id:
            return {"available": False, "expirationCount": 0, "error": f"Could not resolve {ticker}"}
        
        expirations = self.scanner.get_available_expirations(ticker, contract_id)
        
        return {
            "available": len(expirations) > 0,
            "expirationCount": len(expirations)
        }
    
    async def _handle_fetch_underlying(self, payload: dict) -> dict:
        """Fetch underlying stock/futures data.
        
        For futures, pass secType="FUT" plus exchange, lastTradeDateOrContractMonth,
        and optionally multiplier in the payload.
        """
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        
        # Futures exchange lookup — IB requires exchange even with conId
        _FUTURES_EXCHANGE = {
            # Metals — COMEX (IB uses "COMEX" exchange, not "NYMEX")
            "SI": "COMEX", "GC": "COMEX", "HG": "COMEX",
            "SIL": "COMEX", "MGC": "COMEX",
            # Metals — NYMEX (platinum, palladium)
            "PL": "NYMEX", "PA": "NYMEX",
            # Energy
            "CL": "NYMEX", "NG": "NYMEX", "RB": "NYMEX", "HO": "NYMEX",
            "MCL": "NYMEX",
            # Equity indices
            "ES": "CME", "NQ": "CME", "RTY": "CME", "MES": "CME", "MNQ": "CME",
            "M2K": "CME", "EMD": "CME",
            "YM": "CBOT", "MYM": "CBOT",
            # Treasuries
            "ZB": "CBOT", "ZN": "CBOT", "ZF": "CBOT", "ZT": "CBOT",
            # FX
            "6E": "CME", "6J": "CME", "6A": "CME", "6B": "CME", "6C": "CME",
            # Grains
            "ZC": "CBOT", "ZS": "CBOT", "ZW": "CBOT", "ZM": "CBOT", "ZL": "CBOT",
        }

        # Build a resolved contract if the caller provided contract metadata
        resolved = None
        sec_type = payload.get("secType", "STK")
        con_id = int(payload.get("conId", 0) or 0)
        if con_id or (sec_type and sec_type != "STK"):
            from ibapi.contract import Contract
            resolved = Contract()
            # Determine exchange: use provided, then lookup table, then CME default
            exch = payload.get("exchange") or ""
            if not exch and sec_type == "FUT":
                exch = _FUTURES_EXCHANGE.get(ticker, "CME")

            if con_id:
                # When conId is available, use ONLY conId + exchange.
                # Setting other fields (symbol, secType, expiry, multiplier) alongside
                # conId causes IB to validate ALL of them — any mismatch → error 200.
                resolved.conId = con_id
                resolved.exchange = exch or "SMART"
                logger.info(f"fetch_underlying: using conId={con_id} exchange={resolved.exchange} "
                            f"for {ticker} ({sec_type})")
            else:
                # No conId — specify full contract details
                resolved.symbol = ticker
                resolved.secType = sec_type or "STK"
                resolved.currency = payload.get("currency", "USD")
                resolved.exchange = exch or "SMART"
                if payload.get("lastTradeDateOrContractMonth"):
                    resolved.lastTradeDateOrContractMonth = payload["lastTradeDateOrContractMonth"]
                if payload.get("multiplier"):
                    resolved.multiplier = payload["multiplier"]
                logger.info(f"fetch_underlying: using {sec_type} contract for {ticker} "
                            f"expiry={resolved.lastTradeDateOrContractMonth} "
                            f"exchange={resolved.exchange}")
        
        data = self.scanner.fetch_underlying_data(ticker, resolved_contract=resolved)
        return {
            "ticker": ticker,
            "price": data.get("price"),
            "bid": data.get("bid"),
            "ask": data.get("ask")
        }
    
    def _handle_get_positions_sync(self, payload: dict) -> dict:
        """Fetch all positions from IB (reqPositions -> position/positionEnd).
        Filters to IB_ACCT_CODE only (ignores managed accounts)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        timeout = float(payload.get("timeout_sec", 15.0))
        try:
            all_positions = self.scanner.get_positions_snapshot(timeout_sec=timeout)
            positions = [p for p in all_positions if p.get("account") == self.IB_ACCT_CODE]
            accounts = [self.IB_ACCT_CODE]
            return {"positions": positions, "accounts": accounts}
        except Exception as e:
            logger.error(f"Error fetching positions: {e}")
            return {"error": str(e)}

    def _handle_get_open_orders_sync(self, payload: dict) -> dict:
        """Fetch all open/working orders.

        By default returns from the in-memory live order book (no TWS round-trip).
        Pass force_refresh=true to re-query TWS and re-bind any manual orders.
        """
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        timeout = float(payload.get("timeout_sec", 10.0))
        force = bool(payload.get("force_refresh", False))
        try:
            # Detect whether the call will hit TWS (force, or first-sync fallback)
            synced = getattr(self.scanner, "_live_orders_synced", True)
            will_refresh = force or (not synced and self.scanner.isConnected())
            orders = self.scanner.get_open_orders_snapshot(
                timeout_sec=timeout, force_refresh=force,
            )
            return {
                "orders": orders,
                "live_order_count": self.scanner.get_live_order_count(),
                "source": "tws_refresh" if will_refresh else "live_book",
            }
        except Exception as e:
            logger.error(f"Error fetching open orders: {e}")
            return {"error": str(e)}

    def _handle_place_order_sync(self, payload: dict) -> dict:
        """Place order via IB (placeOrder -> orderStatus/error)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        contract_d = payload.get("contract") or {}
        order_d = payload.get("order") or {}
        timeout_sec = float(payload.get("timeout_sec", 30.0))
        try:
            return self.scanner.place_order_sync(contract_d, order_d, timeout_sec=timeout_sec)
        except Exception as e:
            logger.error(f"Error placing order: {e}")
            return {"error": str(e)}

    def _handle_modify_order_sync(self, payload: dict) -> dict:
        """Modify existing order via IB (placeOrder with same orderId)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        order_id = payload.get("orderId")
        if order_id is None:
            return {"error": "orderId required"}
        contract_d = payload.get("contract") or {}
        order_d = payload.get("order") or {}
        timeout_sec = float(payload.get("timeout_sec", 30.0))
        try:
            return self.scanner.modify_order_sync(int(order_id), contract_d, order_d, timeout_sec=timeout_sec)
        except Exception as e:
            logger.error(f"Error modifying order: {e}")
            return {"error": str(e)}

    async def _handle_cancel_order(self, payload: dict) -> dict:
        """Cancel order by orderId (sync in thread)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        order_id = payload.get("orderId")
        if order_id is None:
            return {"error": "orderId required"}
        try:
            return await self._run_in_thread(
                lambda: self.scanner.cancel_order_sync(int(order_id))
            )
        except Exception as e:
            logger.error(f"Error canceling order: {e}")
            return {"error": str(e)}

    async def _handle_test_futures(self, payload: dict) -> dict:
        """Fetch ES futures quote as a connectivity test.

        Two-step approach optimised for the IB Snapshot Bundle subscription:
        1. Snapshot (snapshot=True, REALTIME) -- fast, works during market
           hours, costs ~$0.01 per request.  Handles both real-time tick
           types (1/2/4) and delayed tick types (66/67/68) in case IB
           auto-downgrades.
        2. Historical fallback (reqHistoricalData) -- if snapshot returns
           nothing (market closed / weekend), get the most recent daily bar.
           Always works, ~0.3 s.
        """
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}

        contract_month = payload.get("contract_month", "")

        if not contract_month:
            now = datetime.now()
            if now.day > 15:
                month = now.month + 1
                year = now.year
                if month > 12:
                    month = 1
                    year += 1
            else:
                month = now.month
                year = now.year
            quarterly_months = [3, 6, 9, 12]
            for qm in quarterly_months:
                if qm >= month:
                    month = qm
                    break
            else:
                month = 3
                year += 1
            contract_month = f"{year}{month:02d}"

        logger.info(f"Fetching ES futures quote for {contract_month}")

        try:
            from ibapi.contract import Contract
            contract = Contract()
            contract.symbol = "ES"
            contract.secType = "FUT"
            contract.exchange = "CME"
            contract.currency = "USD"
            contract.lastTradeDateOrContractMonth = contract_month

            original_tickPrice = self.scanner.tickPrice

            # ── Step 1: Snapshot request (snapshot=True) ────────────────────
            rid = self.scanner.get_next_req_id()
            self.scanner.last_mkt_data_error = None
            futures_data = {"bid": None, "ask": None, "last": None}
            got_data = [False]
            ticks_seen = []

            def _handle_tick(reqId, tickType, price, attrib):
                if reqId != rid:
                    return
                ticks_seen.append(tickType)
                # Real-time tick types
                if tickType == 1:       # BID
                    futures_data["bid"] = price
                elif tickType == 2:     # ASK
                    futures_data["ask"] = price
                elif tickType == 4:     # LAST
                    futures_data["last"] = price
                    got_data[0] = True
                # Delayed tick types (IB may auto-downgrade)
                elif tickType == 66:    # DELAYED_BID
                    futures_data["bid"] = price
                elif tickType == 67:    # DELAYED_ASK
                    futures_data["ask"] = price
                elif tickType == 68:    # DELAYED_LAST
                    futures_data["last"] = price
                    got_data[0] = True

            self.scanner.tickPrice = _handle_tick
            self.scanner.reqMktData(rid, contract, "", True, False, [])  # snapshot=True

            # Wait up to 3 s for ticks
            for _ in range(30):
                time.sleep(0.1)
                if got_data[0] or futures_data["bid"] or futures_data["ask"] or futures_data["last"]:
                    time.sleep(0.2)  # brief pause to collect remaining ticks
                    break

            self.scanner.cancelMktData(rid)
            self.scanner.tickPrice = original_tickPrice

            has_any = (futures_data["bid"] is not None
                       or futures_data["ask"] is not None
                       or futures_data["last"] is not None)
            use_delayed = any(t >= 66 for t in ticks_seen)
            logger.info(f"test_futures SNAPSHOT: has_any={has_any}, ticks_seen={ticks_seen}, "
                        f"data={futures_data}, err={getattr(self.scanner, 'last_mkt_data_error', None)}")

            # ── Diagnostics: what did IB tell us about this request? ─────────
            mdt = self.scanner._last_market_data_type.get(rid)
            trp = self.scanner._last_tick_req_params.get(rid)
            snap_ended = rid in self.scanner._snapshot_end_events
            logger.info(f"test_futures DIAG: marketDataType={mdt}, tickReqParams={trp}, "
                        f"snapshotEnd={snap_ended}")

            # ── Step 2: Historical fallback (market closed / weekend) ───────
            from_historical = False
            if not has_any:
                logger.info("Snapshot returned no data, falling back to reqHistoricalData")
                hist_rid = self.scanner.get_next_req_id()
                bar_data = [None]
                hist_done = [False]

                orig_hd = getattr(self.scanner, 'historicalData', None)
                orig_hde = getattr(self.scanner, 'historicalDataEnd', None)

                def _on_bar(reqId, bar):
                    if reqId == hist_rid:
                        bar_data[0] = bar

                def _on_end(reqId, start, end):
                    if reqId == hist_rid:
                        hist_done[0] = True

                self.scanner.historicalData = _on_bar
                self.scanner.historicalDataEnd = _on_end

                self.scanner.reqHistoricalData(
                    hist_rid, contract,
                    "",         # endDateTime = now
                    "2 D",      # duration (covers weekend)
                    "1 day",    # bar size
                    "TRADES",   # whatToShow
                    0,          # useRTH = 0 (include extended hours)
                    1,          # formatDate
                    False,      # keepUpToDate
                    []          # chartOptions
                )

                for _ in range(50):  # 5 s timeout
                    time.sleep(0.1)
                    if hist_done[0]:
                        break

                if orig_hd is not None:
                    self.scanner.historicalData = orig_hd
                if orig_hde is not None:
                    self.scanner.historicalDataEnd = orig_hde

                if bar_data[0] is not None:
                    bar = bar_data[0]
                    close = getattr(bar, 'close', None)
                    logger.info(f"test_futures HISTORICAL: close={close}, "
                                f"high={getattr(bar, 'high', None)}, low={getattr(bar, 'low', None)}")
                    if close is not None:
                        futures_data = {"bid": None, "ask": None, "last": close}
                        has_any = True
                        use_delayed = True
                        from_historical = True
                else:
                    logger.info("test_futures HISTORICAL: no bar data received")

            # ── Build response ──────────────────────────────────────────────
            if not has_any:
                err = getattr(self.scanner, "last_mkt_data_error", None)
                if err and len(err) >= 3:
                    err_code = err[1]
                    if err_code in (354, 10090, 10167, 10168):
                        return {"error": f"ES futures market data not subscribed (IB error {err_code}). "
                                         f"In TWS: Account > Settings > Market Data Subscriptions; "
                                         f"add CME if needed."}
                return {"error": "No futures data received. Market may be closed "
                                 "(ES trades Sun 6 pm - Fri 5 pm ET) or check TWS "
                                 "market data permissions for CME futures."}

            month_codes = {3: 'H', 6: 'M', 9: 'U', 12: 'Z'}
            year_digit = contract_month[3]
            month_num = int(contract_month[4:6])
            month_code = month_codes.get(month_num, '?')
            contract_name = f"ES{month_code}{year_digit}"

            bid = futures_data["bid"]
            ask = futures_data["ask"]
            last = futures_data["last"]
            mid = (bid + ask) / 2 if bid is not None and ask is not None else (last if last is not None else None)
            return {
                "success": True,
                "contract": contract_name,
                "contract_month": contract_month,
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
                "delayed": use_delayed,
                "historical": from_historical,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error fetching futures: {e}")
            return {"error": str(e)}

    def _handle_fetch_chain_sync(self, payload: dict) -> dict:
        """Fetch option chain from IB (synchronous)"""
        ticker = payload.get("ticker", "").upper()
        deal_price = payload.get("dealPrice", 0)
        expected_close_date = payload.get("expectedCloseDate", "")
        scan_params = payload.get("scanParams", {})
        
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        
        days_before_close = scan_params.get("daysBeforeClose", 60)
        
        # Check cache
        cached_data = self.option_chain_cache.get(
            ticker, deal_price, expected_close_date, days_before_close
        )
        if cached_data:
            logger.info(f"Returning cached chain for {ticker}")
            return cached_data
        
        try:
            # Resolve stock contract first (conId + primaryExchange) to avoid IB error 200
            # on accounts where symbol+SMART is ambiguous or sec-def is slow.
            _ = self.scanner.resolve_contract(ticker)
            resolved = self.scanner.contract_details.contract if self.scanner.contract_details else None
            underlying_data = self.scanner.fetch_underlying_data(ticker, resolved_contract=resolved)
            if not underlying_data.get("price"):
                return {"error": f"Could not fetch price for {ticker}. Check agent console for [{ticker}] Step 2."}

            spot_price = underlying_data["price"]

            # Parse date
            try:
                close_date = datetime.strptime(expected_close_date, "%Y-%m-%d")
            except ValueError:
                return {"error": "Invalid date format. Use YYYY-MM-DD"}

            logger.info(f"Fetching chain for {ticker}, spot={spot_price}, deal={deal_price}")

            # Fetch options
            options = self.scanner.fetch_option_chain(
                ticker,
                expiry_months=6,
                current_price=spot_price,
                deal_close_date=close_date,
                days_before_close=days_before_close,
                deal_price=deal_price
            )

            # Convert to serializable format
            contracts = []
            expirations = set()

            for opt in options:
                expirations.add(opt.expiry)
                contracts.append({
                    "symbol": opt.symbol,
                    "strike": opt.strike,
                    "expiry": opt.expiry,
                    "right": opt.right,
                    "bid": opt.bid,
                    "ask": opt.ask,
                    "mid": opt.mid_price,
                    "last": opt.last,
                    "volume": opt.volume,
                    "open_interest": opt.open_interest,
                    "implied_vol": opt.implied_vol,
                    "delta": opt.delta,
                    "bid_size": opt.bid_size,
                    "ask_size": opt.ask_size
                })

            if not contracts:
                return {
                    "error": f"No options returned for {ticker}. Check agent console for [{ticker}] Step 1-5 to see where it failed (e.g. no expirations from IB, or no quotes)."
                }

            result = {
                "ticker": ticker,
                "spotPrice": spot_price,
                "expirations": sorted(list(expirations)),
                "contracts": contracts
            }

            # Cache result
            self.option_chain_cache.set(ticker, deal_price, expected_close_date, days_before_close, result)

            return result
        except Exception as e:
            logger.exception(f"Chain fetch failed for {ticker}")
            return {"error": f"Chain fetch failed for {ticker}: {e}. Check agent console for [{ticker}] step messages."}
    
    def _handle_fetch_prices_sync(self, payload: dict) -> dict:
        """Fetch prices for specific contracts using the same batch path as sell_scan and fetch_chain."""
        contracts = payload.get("contracts", [])
        if not contracts:
            return {"error": "No contracts specified"}
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        logger.info(f"Fetching prices for {len(contracts)} contracts (batch)")
        # Normalize and group by ticker to call get_option_data_batch once per ticker (preserves order).
        by_ticker = {}
        for i, c in enumerate(contracts):
            ticker = (c.get("ticker") or "").upper()
            strike = float(c.get("strike", 0))
            expiry = (c.get("expiry") or "").replace("-", "")
            right = (c.get("right") or "C").upper()
            if ticker not in by_ticker:
                by_ticker[ticker] = []
            by_ticker[ticker].append((i, expiry, strike, right))
        results = [None] * len(contracts)
        for ticker, items in by_ticker.items():
            batch = [(expiry, strike, right) for (_, expiry, strike, right) in items]
            batch_results = self.scanner.get_option_data_batch(ticker, batch)
            for (idx, expiry_norm, strike, right), opt in zip(items, batch_results):
                if opt and (opt.bid > 0 or opt.ask > 0):
                    results[idx] = {
                        "ticker": ticker,
                        "strike": strike,
                        "expiry": expiry_norm,
                        "right": right,
                        "bid": opt.bid,
                        "ask": opt.ask,
                        "mid": opt.mid_price,
                        "last": opt.last,
                    }
                else:
                    results[idx] = None
        return {"success": True, "contracts": results}

    def _handle_sell_scan_sync(self, payload: dict) -> dict:
        """Fetch near-the-money calls or puts for expirations in the next 0-15 business days (for selling)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        ticker = (payload.get("ticker") or "").upper()
        right = (payload.get("right") or "C").upper()
        if right not in ("C", "P"):
            return {"error": "right must be C or P"}
        ntm_pct = float(payload.get("ntm_pct", 0.05))
        business_days = int(payload.get("business_days", 15))
        try:
            underlying = self.scanner.fetch_underlying_data(ticker)
            spot = underlying.get("price")
            if not spot:
                return {"error": f"Could not fetch price for {ticker}"}
            contract_id = self.scanner.resolve_contract(ticker) or 0
            all_expirations = self.scanner.get_available_expirations(ticker, contract_id)
            if not all_expirations:
                return {"error": f"No option expirations for {ticker}"}

            def add_business_days(start_date, n):
                d = start_date
                count = 0
                while count < n:
                    d += timedelta(days=1)
                    if d.weekday() < 5:
                        count += 1
                return d

            today = datetime.now().date()
            end_date = add_business_days(today, business_days)
            sorted_expirations = sorted(set(all_expirations))
            in_range = []
            for exp in sorted_expirations:
                try:
                    exp_date = datetime.strptime(exp, "%Y%m%d").date()
                except ValueError:
                    continue
                if today <= exp_date <= end_date:
                    in_range.append(exp)
            if not in_range:
                return {"error": f"No expirations in the next {business_days} business days for {ticker}"}

            lower = spot * (1 - ntm_pct)
            upper = spot * (1 + ntm_pct)
            batch: list = []
            expirations_used = []
            increment = 5.0 if spot > 50 else 2.5
            for expiry in in_range:
                strikes = getattr(self.scanner, "available_strikes", {}).get(expiry, [])
                ntm_strikes = [s for s in strikes if lower <= s <= upper and self.scanner._strike_on_grid(s, increment)]
                if not ntm_strikes and strikes:
                    ntm_strikes = [s for s in strikes if lower <= s <= upper][:15]
                for strike in ntm_strikes:
                    batch.append((expiry, strike, right))
                if ntm_strikes:
                    expirations_used.append(expiry)
            results = self.scanner.get_option_data_batch(ticker, batch)
            contracts = []
            for opt in results:
                if opt:
                    contracts.append({
                        "symbol": opt.symbol,
                        "strike": opt.strike,
                        "expiry": opt.expiry,
                        "right": opt.right,
                        "bid": opt.bid,
                        "ask": opt.ask,
                        "mid": opt.mid_price,
                        "last": opt.last,
                        "volume": opt.volume,
                        "open_interest": opt.open_interest,
                        "implied_vol": opt.implied_vol,
                        "delta": opt.delta,
                    })
            return {
                "ticker": ticker,
                "spotPrice": spot,
                "right": right,
                "expirations": expirations_used,
                "contracts": contracts,
            }
        except Exception as e:
            logger.exception(f"sell_scan failed for {ticker} {right}")
            return {"error": str(e)}

    # ── Execution engine request handlers ──

    async def _handle_execution_start(self, payload: dict) -> dict:
        """Start execution engine with strategy configuration.

        If the engine is already running, just load any new strategies from
        the payload (backward-compatible additive behavior).
        """
        if not self.execution_engine:
            return {"error": f"Execution engine not initialized ({self._ib_not_connected_error()})"}

        already_running = self.execution_engine.is_running

        strategies_config = payload.get("strategies", [])
        if not strategies_config and not already_running:
            return {"error": "No strategies specified in payload"}

        results = []
        for strat_cfg in strategies_config:
            strategy_id = strat_cfg.get("strategy_id", "")
            strategy_type = strat_cfg.get("strategy_type", "")
            config = strat_cfg.get("config", {})
            ticker_budget = strat_cfg.get("ticker_budget", -1)

            if not strategy_id:
                results.append({"error": "strategy_id is required"})
                continue

            # Skip if strategy already loaded (idempotent on running engine)
            if strategy_id in self.execution_engine._strategies:
                results.append({"strategy_id": strategy_id, "status": "already_loaded"})
                continue

            # Create strategy instance based on type
            strategy = self._create_strategy(strategy_type)
            if strategy is None:
                results.append({"error": f"Unknown strategy_type: {strategy_type}"})
                continue

            # Run load_strategy in a thread pool so strategy.on_start()
            # (which performs blocking REST calls for bootstrap + backfill)
            # doesn't freeze the asyncio event loop and cause relay timeouts.
            result = await self._run_in_thread(
                self.execution_engine.load_strategy, strategy_id, strategy, config
            )
            results.append(result)

            # Set ticker + per-ticker budget on the StrategyState
            if "error" not in result:
                state = self.execution_engine._strategies.get(strategy_id)
                if state:
                    state.ticker = config.get("ticker", strategy_id.replace("bmc_", "").upper())
                    if ticker_budget != -1:
                        state.ticker_entry_budget = ticker_budget

        if not already_running:
            # ── Recover persisted risk manager positions ──
            recovered = 0
            active_positions = self.position_store.get_active_positions()
            if active_positions:
                from strategies.risk_manager import RiskManagerStrategy
                for pos in active_positions:
                    pos_id = pos.get("id", "")
                    if not pos_id or pos_id in self.execution_engine._strategies:
                        continue  # already loaded or invalid
                    stored_config = pos.get("risk_config", {})
                    if not stored_config:
                        logger.warning("Skipping recovery of %s: no risk_config in store", pos_id)
                        continue
                    try:
                        rm = RiskManagerStrategy()
                        load_result = self.execution_engine.load_strategy(pos_id, rm, stored_config)
                        if "error" in load_result:
                            logger.error("Recovery of %s failed: %s", pos_id, load_result["error"])
                            continue
                        # Restore runtime state over fresh on_start defaults
                        runtime = pos.get("runtime_state", {})
                        if runtime:
                            rm.restore_runtime_state(runtime)
                        # Restore fill log for telemetry display
                        fill_log = pos.get("fill_log", [])
                        if fill_log:
                            rm._fill_log = fill_log
                        recovered += 1
                        logger.info("Recovered risk manager %s (remaining=%d)", pos_id, rm.remaining_qty)

                        # Populate parent BMC strategy's _active_positions list + counter
                        parent = pos.get("parent_strategy", "")
                        parent_state = self.execution_engine._strategies.get(parent)
                        if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                            entry_info = pos.get("entry", {})
                            instrument = pos.get("instrument", {})
                            parent_state.strategy._active_positions.append({
                                "order_id": entry_info.get("order_id", 0),
                                "entry_price": entry_info.get("price", 0),
                                "quantity": entry_info.get("quantity", 0),
                                "fill_time": entry_info.get("fill_time", 0),
                                "perm_id": entry_info.get("perm_id", 0),
                                "signal": {
                                    "option_contract": {
                                        "symbol": instrument.get("symbol", ""),
                                        "strike": instrument.get("strike", 0),
                                        "expiry": instrument.get("expiry", ""),
                                        "right": instrument.get("right", ""),
                                    },
                                },
                            })
                            if hasattr(parent_state.strategy, "_positions_spawned"):
                                parent_state.strategy._positions_spawned += 1
                    except Exception as e:
                        logger.error("Error recovering position %s: %s", pos_id, e)
                if recovered > 0:
                    logger.info("Recovered %d risk manager position(s) from store", recovered)

            # ── IB Reconciliation on startup (WS4) ──
            try:
                ib_positions = [
                    p for p in self.scanner.get_positions_snapshot()
                    if p.get("account") == self.IB_ACCT_CODE
                ]
                recon = self.execution_engine.reconcile_with_ib(ib_positions)
                if recon["orphaned_ib"]:
                    logger.warning("IB reconciliation: %d orphaned positions in IB", len(recon["orphaned_ib"]))
                if recon["stale_agent"]:
                    logger.warning("IB reconciliation: %d stale positions closed", len(recon["stale_agent"]))
                if recon["adjusted"]:
                    logger.warning("IB reconciliation: %d positions with qty mismatch", len(recon["adjusted"]))
            except Exception as e:
                logger.error("IB reconciliation on startup failed: %s", e)

            # Start the evaluation loop
            self.execution_engine.start()
        else:
            recovered = 0
            logger.info("Execution engine already running — added %d new strategies", len(results))

        return {
            "running": self.execution_engine.is_running,
            "strategies_loaded": results,
            "recovered_positions": recovered,
            "lines_held": self.resource_manager.execution_lines_held,
            "budget_status": self.execution_engine.get_budget_status(),
        }

    async def _handle_execution_stop(self, payload: dict) -> dict:
        """Stop execution engine and free all streaming subscriptions."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}

        # Snapshot all risk manager runtime states before shutdown
        for sid, state in self.execution_engine._strategies.items():
            if sid.startswith("bmc_risk_") and hasattr(state.strategy, "get_runtime_snapshot"):
                try:
                    snapshot = state.strategy.get_runtime_snapshot()
                    self.position_store.update_runtime_state(sid, snapshot)
                except Exception as e:
                    logger.error("Error snapshotting %s on stop: %s", sid, e)

        self.execution_engine.stop()
        return {
            "running": False,
            "lines_held": self.resource_manager.execution_lines_held,
        }

    async def _handle_execution_status(self, payload: dict) -> dict:
        """Return current execution engine status."""
        if not self.execution_engine:
            return {"running": False, "error": "Execution engine not initialized"}
        return self.execution_engine.get_status()

    async def _handle_execution_config(self, payload: dict) -> dict:
        """Update strategy configuration without restart."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        strategy_id = payload.get("strategy_id", "")
        new_config = payload.get("config", {})
        if not strategy_id:
            return {"error": "strategy_id is required"}
        return self.execution_engine.update_strategy_config(strategy_id, new_config)

    async def _handle_execution_budget(self, payload: dict) -> dict:
        """Set entry budget — either global cap or per-ticker.

        Payload:
            scope: "global" (default) or "ticker"
            budget: -1=unlimited, 0=halt, N=exactly N entries
            strategy_id: required when scope="ticker"
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        scope = payload.get("scope", "global")
        budget = int(payload.get("budget", 0))

        if scope == "ticker":
            strategy_id = payload.get("strategy_id", "")
            if not strategy_id:
                return {"error": "strategy_id is required for scope=ticker"}
            return self.execution_engine.set_ticker_budget(strategy_id, budget)
        else:
            return self.execution_engine.set_global_entry_cap(budget)

    async def _handle_execution_add_ticker(self, payload: dict) -> dict:
        """Add a single ticker/strategy to the running execution engine.

        Payload:
            strategy_id: str (e.g. "bmc_spy")
            strategy_type: str (e.g. "big_move_convexity")
            config: dict (strategy config including "ticker")
            ticker_budget: int (optional, default -1=unlimited)
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running — call execution_start first"}

        strategy_id = payload.get("strategy_id", "")
        strategy_type = payload.get("strategy_type", "")
        config = payload.get("config", {})
        ticker_budget = int(payload.get("ticker_budget", -1))

        if not strategy_id:
            return {"error": "strategy_id is required"}

        if strategy_id in self.execution_engine._strategies:
            return {"error": f"Strategy {strategy_id} is already loaded"}

        strategy = self._create_strategy(strategy_type)
        if strategy is None:
            return {"error": f"Unknown strategy_type: {strategy_type}"}

        # Run load_strategy in thread pool (on_start may do blocking I/O)
        result = await self._run_in_thread(
            self.execution_engine.load_strategy, strategy_id, strategy, config
        )

        # Set ticker + per-ticker budget on the StrategyState
        if "error" not in result:
            state = self.execution_engine._strategies.get(strategy_id)
            if state:
                state.ticker = config.get("ticker", strategy_id.replace("bmc_", "").upper())
                if ticker_budget != -1:
                    state.ticker_entry_budget = ticker_budget

        result["budget_status"] = self.execution_engine.get_budget_status()
        return result

    async def _handle_execution_remove_ticker(self, payload: dict) -> dict:
        """Remove a single ticker/strategy from the running engine.

        Payload:
            strategy_id: str (e.g. "bmc_spy")

        Note: Risk managers for this ticker's positions keep running
        (they are separate strategy_ids like "bmc_risk_*").
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        strategy_id = payload.get("strategy_id", "")
        if not strategy_id:
            return {"error": "strategy_id is required"}

        if strategy_id not in self.execution_engine._strategies:
            return {"error": f"Strategy {strategy_id} not found"}

        result = self.execution_engine.unload_strategy(strategy_id)
        result["budget_status"] = self.execution_engine.get_budget_status()
        return result

    async def _handle_close_position(self, payload: dict) -> dict:
        """Manually close a position: unload risk manager, mark closed in store."""
        position_id = payload.get("position_id", "")
        if not position_id:
            return {"error": "position_id is required"}

        # Check the position exists in the store
        pos = self.position_store.get_position(position_id)
        if pos is None:
            return {"error": f"Position {position_id} not found in store"}
        if pos.get("status") == "closed":
            return {"error": f"Position {position_id} is already closed"}

        # Cancel any working IB orders and unload the risk manager strategy
        if self.execution_engine and position_id in self.execution_engine._strategies:
            rm_state = self.execution_engine._strategies[position_id]
            if hasattr(rm_state.strategy, "_pending_orders"):
                for oid in list(rm_state.strategy._pending_orders.keys()):
                    logger.info("Cancelling order %d for manual close of %s", oid, position_id)
                    try:
                        self.scanner.cancelOrder(oid, "")
                    except Exception as e:
                        logger.error("Failed to cancel order %d: %s", oid, e)
            self.execution_engine.unload_strategy(position_id)
            logger.info("Unloaded risk manager %s for manual close", position_id)

        # Remove from parent BMC strategy's _active_positions list
        parent = pos.get("parent_strategy", "")
        if parent and self.execution_engine:
            parent_state = self.execution_engine._strategies.get(parent)
            if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                entry_info = pos.get("entry", {})
                entry_price = entry_info.get("price", 0)
                parent_state.strategy._active_positions = [
                    p for p in parent_state.strategy._active_positions
                    if abs(p.get("entry_price", 0) - entry_price) > 0.005
                ]

        # Add a manual_close fill entry and mark closed
        self.position_store.add_fill(position_id, {
            "time": time.time(),
            "order_id": 0,
            "level": "manual_close",
            "qty_filled": 0,
            "avg_price": 0,
            "remaining_qty": 0,
            "pnl_pct": 0.0,
        })
        self.position_store.mark_closed(position_id)
        return {"success": True, "position_id": position_id, "status": "closed"}

    # IB account dedicated to automated BMC trading
    IB_ACCT_CODE = "U152133"

    def _handle_get_ib_executions_sync(self, payload: dict) -> dict:
        """Fetch all IB executions for current session, match into round-trip trades, compute P&L."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}

        IB_IGNORE = {"VGZ", "UNCO", "HOLO"}

        raw_execs = self.scanner.fetch_executions_sync(
            timeout_sec=10.0, acct_code=self.IB_ACCT_CODE,
        )
        if not raw_execs:
            return {"executions": [], "trades": [], "summary": {}}

        # Filter out ignored tickers and non-option trades
        execs = [
            e for e in raw_execs
            if e["contract"].get("symbol") not in IB_IGNORE
        ]

        # Group by contract key: (symbol, strike, expiry, right, secType)
        from collections import defaultdict
        groups = defaultdict(list)
        for e in execs:
            c = e["contract"]
            key = (
                c.get("symbol", ""),
                c.get("strike", 0),
                c.get("lastTradeDateOrContractMonth", ""),
                c.get("right", ""),
                c.get("secType", ""),
            )
            groups[key].append(e)

        # Build round-trip trades from matched buys/sells
        trades = []
        for key, fills in groups.items():
            symbol, strike, expiry, right, sec_type = key

            buys = []
            sells = []
            total_commission = 0.0
            for f in fills:
                ex = f["execution"]
                comm = f.get("commission")
                if comm and comm.get("commission"):
                    c_val = comm["commission"]
                    # IB returns 1e10 for "not yet available"
                    if c_val < 1e9:
                        total_commission += c_val

                entry = {
                    "time": ex.get("time", ""),
                    "price": ex.get("price", 0),
                    "shares": ex.get("shares", 0),
                    "exec_id": ex.get("execId", ""),
                    "exchange": ex.get("exchange", ""),
                    "order_id": ex.get("orderId", 0),
                }
                if ex.get("side") == "BOT":
                    buys.append(entry)
                elif ex.get("side") == "SLD":
                    sells.append(entry)

            # Compute aggregate entry/exit
            buy_qty = sum(b["shares"] for b in buys)
            sell_qty = sum(s["shares"] for s in sells)
            buy_cost = sum(b["price"] * b["shares"] for b in buys)
            sell_revenue = sum(s["price"] * s["shares"] for s in sells)
            avg_buy = buy_cost / buy_qty if buy_qty else 0
            avg_sell = sell_revenue / sell_qty if sell_qty else 0

            # For options, multiply by 100 for dollar P&L
            multiplier = 100 if sec_type == "OPT" else 1
            closed_qty = min(buy_qty, sell_qty)
            gross_pnl = (avg_sell - avg_buy) * closed_qty * multiplier if closed_qty else None
            net_pnl = (gross_pnl - total_commission) if gross_pnl is not None else None
            open_qty = buy_qty - sell_qty

            # Format contract label
            if sec_type == "OPT":
                contract_label = f"{symbol} {strike:.0f}{right[0] if right else '?'}"
                if expiry:
                    contract_label += f" {expiry}"
            else:
                contract_label = symbol

            trades.append({
                "contract_label": contract_label,
                "symbol": symbol,
                "sec_type": sec_type,
                "strike": strike,
                "expiry": expiry,
                "right": right,
                "buy_qty": int(buy_qty),
                "sell_qty": int(sell_qty),
                "open_qty": int(open_qty),
                "avg_buy": round(avg_buy, 4),
                "avg_sell": round(avg_sell, 4) if sell_qty else None,
                "gross_pnl": round(gross_pnl, 2) if gross_pnl is not None else None,
                "total_commission": round(total_commission, 4),
                "net_pnl": round(net_pnl, 2) if net_pnl is not None else None,
                "status": "closed" if open_qty == 0 and sell_qty > 0 else "open",
                "fills": [
                    {
                        "side": f["execution"]["side"],
                        "time": f["execution"]["time"],
                        "price": f["execution"]["price"],
                        "shares": f["execution"]["shares"],
                        "exchange": f["execution"]["exchange"],
                        "commission": f["commission"]["commission"] if f.get("commission") and f["commission"].get("commission", 0) < 1e9 else None,
                    }
                    for f in fills
                ],
            })

        # Summary across all option trades
        total_gross = sum(t["gross_pnl"] for t in trades if t["gross_pnl"] is not None)
        total_comm = sum(t["total_commission"] for t in trades)
        total_net = total_gross - total_comm
        closed_trades = [t for t in trades if t["status"] == "closed"]
        open_trades = [t for t in trades if t["status"] == "open"]
        wins = sum(1 for t in closed_trades if (t["net_pnl"] or 0) > 0)
        losses = sum(1 for t in closed_trades if (t["net_pnl"] or 0) <= 0)

        return {
            "executions_count": len(execs),
            "trades": trades,
            "summary": {
                "total_gross_pnl": round(total_gross, 2),
                "total_commission": round(total_comm, 4),
                "total_net_pnl": round(total_net, 2),
                "closed_count": len(closed_trades),
                "open_count": len(open_trades),
                "wins": wins,
                "losses": losses,
            },
        }

    def _create_strategy(self, strategy_type: str) -> Optional[ExecutionStrategy]:
        """Factory for creating strategy instances by type name."""
        if strategy_type == "risk_manager":
            from strategies.risk_manager import RiskManagerStrategy
            return RiskManagerStrategy()
        if strategy_type == "big_move_convexity":
            from strategies.big_move_convexity import BigMoveConvexityStrategy
            strategy = BigMoveConvexityStrategy()
            strategy._spawn_risk_manager = self._spawn_risk_manager_for_bmc
            strategy._fetch_option_quote = lambda cd: self.scanner.fetch_option_snapshot(cd)
            return strategy
        logger.warning("No strategy implementation for type: %s", strategy_type)
        return None

    def _spawn_risk_manager_for_bmc(self, risk_config: dict) -> None:
        """Spawn a RiskManagerStrategy instance for a BMC entry fill.

        Called by BigMoveConvexityStrategy.on_fill() to create a position
        guardian with the zero_dte_convexity preset.
        """
        if not self.execution_engine:
            logger.warning("Cannot spawn risk manager: execution engine not initialized")
            return

        # Extract lineage before passing to risk manager (WS2)
        lineage = risk_config.pop("lineage", None)

        from strategies.risk_manager import RiskManagerStrategy

        strategy = RiskManagerStrategy()
        strategy_id = f"bmc_risk_{int(time.time())}"

        result = self.execution_engine.load_strategy(strategy_id, strategy, risk_config)
        if "error" in result:
            logger.error("Failed to spawn risk manager for BMC: %s", result["error"])
        else:
            logger.info("Spawned RiskManagerStrategy %s for BMC position", strategy_id)
            # Persist the new position in the store
            pos_info = risk_config.get("position", {})
            instrument = risk_config.get("instrument", {})
            symbol = instrument.get("symbol", "").lower()
            self.position_store.add_position(
                position_id=strategy_id,
                entry={
                    "order_id": pos_info.get("order_id", 0),
                    "price": pos_info.get("entry_price", 0),
                    "quantity": pos_info.get("quantity", 0),
                    "fill_time": time.time(),
                    "perm_id": pos_info.get("perm_id", 0),
                },
                instrument=instrument,
                risk_config=risk_config,
                parent_strategy=f"bmc_{symbol}" if symbol else "bmc",
            )
            # Attach lineage to position record (WS2)
            if lineage:
                self.position_store.set_lineage(strategy_id, lineage)
            # Record the entry fill in the ledger
            self.position_store.add_fill(strategy_id, {
                "time": time.time(),
                "order_id": pos_info.get("order_id", 0),
                "level": "entry",
                "qty_filled": pos_info.get("quantity", 0),
                "avg_price": pos_info.get("entry_price", 0),
                "remaining_qty": pos_info.get("quantity", 0),
                "pnl_pct": 0.0,
            })

    async def send_heartbeat(self):
        """Send periodic heartbeats with agent state and execution telemetry."""
        telemetry_counter = 0  # send telemetry every 2nd heartbeat (~20s)
        while self.running and self.websocket:
            try:
                await self.websocket.send(json.dumps({"type": "heartbeat"}))
                # Piggyback agent resource state on every heartbeat cycle
                state = self.resource_manager.get_state_report()
                await self.websocket.send(json.dumps({
                    "type": "agent_state",
                    **state
                }))
                # Send execution telemetry when engine is running (every ~20s)
                telemetry_counter += 1
                if (
                    telemetry_counter % 2 == 0
                    and self.execution_engine is not None
                    and self.execution_engine.is_running
                ):
                    telemetry = self.execution_engine.get_telemetry()
                    await self.websocket.send(json.dumps({
                        "type": "execution_telemetry",
                        **telemetry
                    }))
                await asyncio.sleep(HEARTBEAT_INTERVAL)
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                break

    async def _account_event_push_loop(self):
        """Fallback: drain any events that the instant callback may have missed.

        The primary path is the instant callback registered via
        scanner.set_account_event_callback() — it pushes events within
        milliseconds.  This loop is a safety net running every 10 seconds.
        """
        while self.running and self.websocket:
            try:
                if self.scanner:
                    events = self.scanner.drain_account_events()
                    for event in events:
                        await self.websocket.send(json.dumps({
                            "type": "account_event",
                            "event": event,
                        }))
                        logger.info("Fallback push: %s (orderId=%s)",
                                    event.get("event"), event.get("orderId"))
                await asyncio.sleep(10.0)
            except Exception as e:
                logger.error(f"Account event push error: {e}")
                break
    
    # Routine polling requests — suppress per-request logging, emit periodic summary
    _QUIET_REQUEST_TYPES = frozenset({
        "execution_status", "ib_status", "check_availability",
        "get_positions", "get_open_orders",
    })
    _request_counts: dict = {}
    _last_request_summary: float = 0.0  # initialized to time.time() on first use
    _REQUEST_SUMMARY_INTERVAL = 60.0  # seconds

    async def _process_request(self, request_id: str, data: dict):
        """Process a request and send response"""
        request_type = data.get("request_type", "unknown")
        is_quiet = request_type in self._QUIET_REQUEST_TYPES
        t_start = time.monotonic()
        try:
            if not is_quiet:
                logger.info(f"Processing request {request_id} ({request_type})...")
            result = await self.handle_request(data)
            t_handler = time.monotonic() - t_start

            if "error" in result:
                logger.error(f"Request {request_id} failed: {result.get('error')}")
            elif not is_quiet:
                contracts_count = len(result.get("contracts", [])) if "contracts" in result else "N/A"
                logger.info(f"Request {request_id} completed. Contracts: {contracts_count}")

            response = {
                "type": "response",
                "request_id": request_id,
                "success": "error" not in result,
                "data": result if "error" not in result else None,
                "error": result.get("error")
            }

            if self.websocket:
                resp_json = json.dumps(response)
                t_serialize = time.monotonic() - t_start - t_handler
                await self.websocket.send(resp_json)
                t_total = time.monotonic() - t_start
                if not is_quiet:
                    logger.info(
                        f"[perf] {request_type} request_id={request_id} "
                        f"handler={t_handler:.3f}s serialize={t_serialize:.3f}s "
                        f"total={t_total:.3f}s response_bytes={len(resp_json)}"
                    )

            # Track quiet request counts for periodic summary
            if is_quiet:
                self._request_counts[request_type] = self._request_counts.get(request_type, 0) + 1
                now = time.time()
                if self._last_request_summary == 0.0:
                    self._last_request_summary = now  # initialize on first use
                if now - self._last_request_summary >= self._REQUEST_SUMMARY_INTERVAL:
                    counts_str = ", ".join(f"{k}={v}" for k, v in sorted(self._request_counts.items()))
                    logger.info(f"[heartbeat] requests in last {int(now - self._last_request_summary)}s: {counts_str}")
                    self._request_counts.clear()
                    self._last_request_summary = now
        except Exception as e:
            t_total = time.monotonic() - t_start
            logger.error(f"Error processing request {request_id} ({t_total:.3f}s): {e}")
            if self.websocket:
                await self.websocket.send(json.dumps({
                    "type": "response",
                    "request_id": request_id,
                    "success": False,
                    "error": str(e)
                }))

    async def message_handler(self):
        """Handle incoming messages"""
        pending_tasks = set()
        
        while self.running and self.websocket:
            try:
                message = await self.websocket.recv()
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "heartbeat_ack":
                    pass
                elif msg_type == "request":
                    request_id = data.get("request_id")
                    task = asyncio.create_task(self._process_request(request_id, data))
                    pending_tasks.add(task)
                    task.add_done_callback(pending_tasks.discard)
                else:
                    logger.warning(f"Unknown message type: {msg_type}")
            except ConnectionClosed:
                logger.warning("WebSocket connection closed")
                break
            except Exception as e:
                logger.error(f"Message handler error: {e}")
        
        for task in pending_tasks:
            task.cancel()
    
    async def connect_to_relay(self) -> bool:
        """Connect to the WebSocket relay"""
        if not IB_PROVIDER_KEY:
            logger.error("IB_PROVIDER_KEY environment variable not set!")
            return False
        
        logger.info(f"Connecting to relay at {RELAY_URL}...")
        
        try:
            self.websocket = await websockets.connect(
                RELAY_URL,
                ping_interval=30,
                ping_timeout=60
            )
            
            # Read version from version.txt next to this script
            _agent_version = "0.0.0"
            try:
                _vf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "version.txt")
                with open(_vf) as _f:
                    _agent_version = _f.read().strip()
            except Exception:
                pass

            await self.websocket.send(json.dumps({
                "type": "auth",
                "api_key": IB_PROVIDER_KEY,
                "version": _agent_version
            }))
            
            response = await asyncio.wait_for(
                self.websocket.recv(),
                timeout=10.0
            )
            
            auth_result = json.loads(response)
            
            if auth_result.get("success"):
                self.provider_id = auth_result.get("provider_id")
                logger.info(f"Authenticated with relay as provider {self.provider_id}")
                return True
            else:
                logger.error(f"Authentication failed: {auth_result.get('error')}")
                return False
        except Exception as e:
            logger.error(f"Failed to connect to relay: {e}")
            return False
    
    def _make_account_event_callback(self, loop):
        """Create a callback for the scanner that pushes account events
        to the WebSocket relay instantly via call_soon_threadsafe.
        This bridges the IB message thread → asyncio event loop."""
        def on_account_event(event: dict):
            ws = self.websocket
            if ws is None:
                return
            async def _push():
                try:
                    await ws.send(json.dumps({
                        "type": "account_event",
                        "event": event,
                    }))
                    logger.info("Instant push: %s (orderId=%s)",
                                event.get("event"), event.get("orderId"))
                except Exception:
                    pass  # connection may be closing
            try:
                loop.call_soon_threadsafe(asyncio.ensure_future, _push())
            except RuntimeError:
                pass  # loop is closed
        return on_account_event

    async def run(self):
        """Main run loop"""
        self.running = True

        # Try IB once at startup (non-blocking — agent works without IB via Polygon)
        logger.info("Attempting IB TWS connection...")
        ib_ok = await self._connect_to_ib_with_retry(max_attempts=2)
        if ib_ok:
            logger.info("IB TWS connected — full IB + Polygon data available")
            # Register instant account-event callback (bridges IB thread → asyncio → WS)
            loop = asyncio.get_running_loop()
            self.scanner.set_account_event_callback(self._make_account_event_callback(loop))
        else:
            logger.warning(
                "IB TWS not available — agent will connect to relay without IB. "
                "Polygon data is still available. IB will auto-reconnect when TWS starts."
            )

        # Launch background TWS health monitor (handles reconnection if IB was down or drops)
        tws_health_task = asyncio.create_task(self._tws_health_loop())
        logger.info("TWS health monitor started (auto-reconnect enabled)")

        while self.running:
            try:
                if not await self.connect_to_relay():
                    logger.warning(f"Relay connection failed, retrying in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
                    continue
                
                # Report IB managed accounts to relay for diagnostics / routing
                ib_accounts = getattr(self.scanner, "_managed_accounts", [])
                if ib_accounts and self.websocket:
                    await self.websocket.send(json.dumps({
                        "type": "ib_accounts",
                        "accounts": ib_accounts
                    }))
                    logger.info(f"Reported IB accounts to relay: {ib_accounts}")

                heartbeat_task = asyncio.create_task(self.send_heartbeat())
                handler_task = asyncio.create_task(self.message_handler())
                event_push_task = asyncio.create_task(self._account_event_push_loop())
                
                logger.info("Agent running - ready to handle requests")
                logger.info("Press Ctrl+C to stop")
                
                done, pending = await asyncio.wait(
                    [heartbeat_task, handler_task, event_push_task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                for task in pending:
                    task.cancel()
                
                if self.running:
                    logger.warning(f"Relay connection lost, reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
            except Exception as e:
                logger.error(f"Agent error: {e}")
                if self.running:
                    await asyncio.sleep(RECONNECT_DELAY)
        
        # Clean up health monitor
        tws_health_task.cancel()
        try:
            await tws_health_task
        except asyncio.CancelledError:
            pass
        
        self.disconnect_from_ib()
        if self.websocket:
            await self.websocket.close()
    
    def stop(self):
        """Stop the agent"""
        logger.info("Stopping agent...")
        self.running = False


def main():
    """Main entry point"""
    print("=" * 60)
    print("IB Data Agent (Standalone)")
    print("=" * 60)
    print(f"IB TWS:     {IB_HOST}:{IB_PORT} (client_id={IB_CLIENT_ID})")
    print(f"Relay URL:  {RELAY_URL}")
    print(f"API Key:    {'*' * 8 if IB_PROVIDER_KEY else 'NOT SET!'}")
    print("=" * 60)
    
    if not IB_PROVIDER_KEY:
        print("\nERROR: IB_PROVIDER_KEY environment variable is required!")
        print("Set it in config.env or with: export IB_PROVIDER_KEY='your-api-key'")
        sys.exit(1)
    
    agent = IBDataAgent()
    
    def signal_handler(sig, frame):
        print("\nShutting down...")
        agent.stop()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
