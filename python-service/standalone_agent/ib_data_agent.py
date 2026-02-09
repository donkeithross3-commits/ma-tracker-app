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
    IB_PORT         - IB TWS port (default: 7497)
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment
IB_HOST = os.environ.get("IB_HOST", "127.0.0.1")
IB_PORT = int(os.environ.get("IB_PORT", "7497"))
RELAY_URL = os.environ.get("RELAY_URL", "wss://dr3-dashboard.com/ws/data-provider")
IB_PROVIDER_KEY = os.environ.get("IB_PROVIDER_KEY", "")
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
                logger.info(f"Cache HIT for {ticker} (age: {age:.1f}s)")
                return data
            else:
                logger.info(f"Cache EXPIRED for {ticker} (age: {age:.1f}s)")
                del self.cache[key]
        return None
    
    def set(self, ticker: str, deal_price: float, close_date: str, days_before_close: int, data: dict):
        key = self._make_key(ticker, deal_price, close_date, days_before_close)
        self.cache[key] = (data, time.time())
        logger.info(f"Cache SET for {ticker} ({len(data.get('contracts', []))} contracts)")
    
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
        
    def connect_to_ib(self) -> bool:
        """Connect to IB TWS"""
        logger.info(f"Connecting to IB TWS at {IB_HOST}:{IB_PORT}...")
        
        # Use clientId=0 (the "default client") so that:
        # 1) reqAutoOpenOrders(True) works (IB only allows this for clientId 0)
        # 2) reqOpenOrders() returns ALL orders (TWS + API) with valid orderIds
        # 3) Orders from previous sessions can be modified/cancelled
        client_id = 0
        
        self.scanner = IBMergerArbScanner()
        self.scanner.resource_manager = self.resource_manager
        connected = self.scanner.connect_to_ib(
            host=IB_HOST,
            port=IB_PORT,
            client_id=client_id
        )
        
        if connected:
            logger.info("Successfully connected to IB TWS")
            # Initialize execution infrastructure (quote cache + engine)
            self.quote_cache = StreamingQuoteCache(self.resource_manager)
            self.scanner.streaming_cache = self.quote_cache
            self.execution_engine = ExecutionEngine(
                self.scanner, self.quote_cache, self.resource_manager
            )
            logger.info("Execution infrastructure initialized (quote cache + engine ready)")
        else:
            logger.error("Failed to connect to IB TWS")
            
        return connected
    
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
        
        logger.info(f"Handling request: {request_type}")
        
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
        """Check IB connection status"""
        connected = self.scanner and self.scanner.isConnected()
        return {
            "connected": connected,
            "message": "IB TWS connected" if connected else "IB TWS not connected"
        }
    
    async def _handle_check_availability(self, payload: dict) -> dict:
        """Check if options are available for a ticker"""
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"available": False, "expirationCount": 0, "error": "IB not connected"}
        
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
            return {"error": "IB not connected"}
        
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
        """Fetch all positions from IB (reqPositions -> position/positionEnd)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}
        timeout = float(payload.get("timeout_sec", 15.0))
        try:
            positions = self.scanner.get_positions_snapshot(timeout_sec=timeout)
            accounts = getattr(self.scanner, "_managed_accounts", [])
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
            return {"error": "IB not connected"}
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
            return {"error": "IB not connected"}
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
            return {"error": "IB not connected"}
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
            return {"error": "IB not connected"}
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
            return {"error": "IB not connected"}

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
            return {"error": "IB not connected"}
        
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
            return {"error": "IB not connected"}
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
            return {"error": "IB not connected"}
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
        """Start execution engine with strategy configuration."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized (IB not connected?)"}
        if self.execution_engine.is_running:
            return {"error": "Execution engine is already running"}

        strategies_config = payload.get("strategies", [])
        if not strategies_config:
            return {"error": "No strategies specified in payload"}

        results = []
        for strat_cfg in strategies_config:
            strategy_id = strat_cfg.get("strategy_id", "")
            strategy_type = strat_cfg.get("strategy_type", "")
            config = strat_cfg.get("config", {})

            if not strategy_id:
                results.append({"error": "strategy_id is required"})
                continue

            # Create strategy instance based on type
            strategy = self._create_strategy(strategy_type)
            if strategy is None:
                results.append({"error": f"Unknown strategy_type: {strategy_type}"})
                continue

            result = self.execution_engine.load_strategy(strategy_id, strategy, config)
            results.append(result)

        # Start the evaluation loop
        self.execution_engine.start()

        return {
            "running": self.execution_engine.is_running,
            "strategies_loaded": results,
            "lines_held": self.resource_manager.execution_lines_held,
        }

    async def _handle_execution_stop(self, payload: dict) -> dict:
        """Stop execution engine and free all streaming subscriptions."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}

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
        """Set the order budget (lifeguard on duty)."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        budget = int(payload.get("budget", 0))
        return self.execution_engine.set_order_budget(budget)

    def _create_strategy(self, strategy_type: str) -> Optional[ExecutionStrategy]:
        """Factory for creating strategy instances by type name."""
        if strategy_type == "risk_manager":
            from strategies.risk_manager import RiskManagerStrategy
            return RiskManagerStrategy()
        logger.warning("No strategy implementation for type: %s", strategy_type)
        return None

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
    
    async def _process_request(self, request_id: str, data: dict):
        """Process a request and send response"""
        request_type = data.get("request_type", "unknown")
        t_start = time.monotonic()
        try:
            logger.info(f"Processing request {request_id} ({request_type})...")
            result = await self.handle_request(data)
            t_handler = time.monotonic() - t_start
            
            if "error" in result:
                logger.error(f"Request {request_id} failed: {result.get('error')}")
            else:
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
                logger.info(
                    f"[perf] {request_type} request_id={request_id} "
                    f"handler={t_handler:.3f}s serialize={t_serialize:.3f}s "
                    f"total={t_total:.3f}s response_bytes={len(resp_json)}"
                )
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
    
    async def run(self):
        """Main run loop"""
        self.running = True
        
        if not self.connect_to_ib():
            logger.error("Cannot start agent without IB connection")
            return
        
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
                
                logger.info("Agent running - ready to handle requests")
                logger.info("Press Ctrl+C to stop")
                
                done, pending = await asyncio.wait(
                    [heartbeat_task, handler_task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                for task in pending:
                    task.cancel()
                
                if self.running:
                    logger.warning(f"Connection lost, reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
            except Exception as e:
                logger.error(f"Agent error: {e}")
                if self.running:
                    await asyncio.sleep(RECONNECT_DELAY)
        
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
    print(f"IB TWS:     {IB_HOST}:{IB_PORT}")
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
