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
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import time
import logging
import calendar

# IB API imports (bundled in ibapi/)
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order
from ibapi.common import TickerId, TickAttrib, SetOfString, SetOfFloat
from threading import Thread, Event, Lock
import queue
from concurrent.futures import ThreadPoolExecutor

# #region agent log
DEBUG_LOG = "/Users/donross/dev/ma-tracker-app/.cursor/debug.log"
def _debug_log(location: str, message: str, data: dict, hypothesis_id: str = ""):
    try:
        import json
        with open(DEBUG_LOG, "a") as f:
            f.write(json.dumps({"timestamp": int(time.time() * 1000), "location": location, "message": message, "data": data, "hypothesisId": hypothesis_id, "sessionId": "debug-session"}) + "\n")
    except Exception:
        pass
# #endregion


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

        # Request tracking (data requests only; order ids are separate)
        self.req_id_map = {}
        self.next_req_id = 1000
        self.next_order_id = 1000  # Synced from nextValidId; used only for placeOrder
        self.data_ready = Event()
        # Wait for all option-parameter callbacks (IB sends multiple + End)
        self.sec_def_opt_params_done = Event()
        self._sec_def_wait_req_id = None
        # Wait for contract details end (so we have final conId)
        self.contract_details_done = Event()
        self._contract_details_wait_req_id = None
        self.data_queue = queue.Queue()
        self.executor = ThreadPoolExecutor(max_workers=10)
        
        # Connection state
        self.connection_lost = False
        self.last_heartbeat = time.time()
        self.connection_start_time = None
        # Last market data error (req_id, errorCode, errorString) for ES test_futures
        self.last_mkt_data_error = None
        # Error 200 on underlying request (no security definition) - trigger delayed retry
        self._underlying_200_req_id = None

        # Resource manager: optional, provides dynamic batch sizing when execution engine is active
        self.resource_manager = None  # set by IBDataAgent after construction

        # Streaming quote cache: optional, routes persistent subscription ticks to the cache
        self.streaming_cache = None  # set by IBDataAgent when execution engine initializes

        # Positions: for get_positions request (lock prevents concurrent snapshot corruption)
        self._positions_list: List[dict] = []
        self._positions_done = Event()
        self._managed_accounts: List[str] = []
        self._positions_lock = Lock()

        # Orders: for place_order / cancel_order (order_id -> Event, order_id -> result dict)
        self._order_events: Dict[int, Event] = {}
        self._order_results: Dict[int, dict] = {}

        # Open orders: for get_open_orders snapshot
        self._open_orders_list: List[dict] = []
        self._open_orders_done = Event()
        self._open_orders_lock = Lock()
        self._open_orders_active = False  # True when snapshot is in progress

        # ── Live Order Book ──────────────────────────────────────────────
        # Continuously updated by openOrder / orderStatus callbacks.
        # Keyed by orderId.  Entries are removed when status becomes terminal.
        # Thread-safe via _live_orders_lock.
        self._live_orders: Dict[int, dict] = {}
        self._live_orders_lock = Lock()
        # permId -> orderId mapping (unique across the account, survives rebinds)
        self._perm_id_to_order_id: Dict[int, int] = {}
        # Terminal statuses that mean the order is no longer active
        self._TERMINAL_STATUSES = frozenset({
            "Filled", "Cancelled", "ApiCancelled", "Inactive",
        })

    def managedAccounts(self, accountsList: str):
        """Store comma-separated account ids from TWS on connect."""
        self._managed_accounts = [a.strip() for a in (accountsList or "").split(",") if a.strip()]
        self.logger.info("Managed accounts: %s", self._managed_accounts)

    def position(self, account: str, contract: Contract, position: float, avgCost: float):
        """Called for each position in response to reqPositions()."""
        self._positions_list.append({
            "account": account,
            "contract": self._contract_to_dict(contract),
            "position": float(position) if position is not None else 0,
            "avgCost": float(avgCost) if avgCost is not None else 0,
        })

    def positionEnd(self):
        """Called once after initial position dump; signals snapshot complete."""
        self._positions_done.set()

    def _contract_to_dict(self, contract: Contract) -> dict:
        """Serialize Contract for JSON response."""
        return {
            "conId": getattr(contract, "conId", 0),
            "symbol": getattr(contract, "symbol", "") or "",
            "secType": getattr(contract, "secType", "") or "",
            "exchange": getattr(contract, "exchange", "") or "",
            "currency": getattr(contract, "currency", "") or "",
            "lastTradeDateOrContractMonth": getattr(contract, "lastTradeDateOrContractMonth", "") or "",
            "strike": float(getattr(contract, "strike", 0) or 0),
            "right": getattr(contract, "right", "") or "",
            "multiplier": getattr(contract, "multiplier", "") or "",
            "localSymbol": getattr(contract, "localSymbol", "") or "",
            "tradingClass": getattr(contract, "tradingClass", "") or "",
        }

    def get_positions_snapshot(self, timeout_sec: float = 15.0) -> List[dict]:
        """Request positions, wait for positionEnd(), return list and cancel subscription.
        Thread-safe: only one snapshot at a time (concurrent callers block)."""
        with self._positions_lock:
            self._positions_list = []
            self._positions_done.clear()
            self.reqPositions()
            if not self._positions_done.wait(timeout=timeout_sec):
                self.logger.warning("get_positions_snapshot: timeout waiting for positionEnd")
            self.cancelPositions()
            return list(self._positions_list)

    def get_open_orders_snapshot(self, timeout_sec: float = 10.0, force_refresh: bool = False) -> List[dict]:
        """Return all known live orders.

        By default, returns orders from the in-memory live order book (populated
        continuously by openOrder / orderStatus callbacks).  This is fast and
        doesn't require a round-trip to TWS.

        If *force_refresh* is True (or the live book is empty and we're connected),
        issues reqOpenOrders() to TWS and waits for the full response.  This also
        re-binds any manual TWS orders that weren't yet bound.

        Thread-safe: only one refresh at a time (concurrent callers block).
        """
        need_refresh = force_refresh
        with self._live_orders_lock:
            if not self._live_orders and self.isConnected():
                need_refresh = True
            if not need_refresh:
                return list(self._live_orders.values())

        # Full refresh from TWS
        with self._open_orders_lock:
            self._open_orders_list = []
            self._open_orders_done.clear()
            self._open_orders_active = True
            self.reqOpenOrders()
            if not self._open_orders_done.wait(timeout=timeout_sec):
                self.logger.warning("get_open_orders_snapshot: timeout waiting for openOrderEnd")
            self._open_orders_active = False
            # The openOrder callback already updated _live_orders for each order,
            # so return from the live book (it's the most authoritative view).
            with self._live_orders_lock:
                return list(self._live_orders.values())

    def get_live_orders(self) -> List[dict]:
        """Return current live order book without issuing any TWS request.
        Fast, lock-free read suitable for frequent polling."""
        with self._live_orders_lock:
            return list(self._live_orders.values())

    def get_live_order_count(self) -> int:
        """Number of orders currently tracked in the live book."""
        return len(self._live_orders)

    def get_order_by_perm_id(self, perm_id: int) -> dict | None:
        """Look up a live order by its permId (account-unique, survives rebinds).
        Returns the order entry or None."""
        with self._live_orders_lock:
            order_id = self._perm_id_to_order_id.get(perm_id)
            if order_id is not None:
                return self._live_orders.get(order_id)
        return None

    def _contract_from_dict(self, d: dict) -> Contract:
        """Build Contract from payload dict (symbol, secType, exchange, currency, etc.)."""
        c = Contract()
        if not d:
            return c
        c.conId = int(d.get("conId") or 0)
        c.symbol = (d.get("symbol") or "").strip()
        c.secType = (d.get("secType") or "STK").strip()
        c.exchange = (d.get("exchange") or "").strip()
        c.currency = (d.get("currency") or "USD").strip()
        c.lastTradeDateOrContractMonth = (d.get("lastTradeDateOrContractMonth") or "").strip()
        c.strike = float(d.get("strike") or 0)
        c.right = (d.get("right") or "").strip()
        c.multiplier = (d.get("multiplier") or "").strip()
        c.localSymbol = (d.get("localSymbol") or "").strip()
        c.tradingClass = (d.get("tradingClass") or "").strip()
        c.primaryExchange = (d.get("primaryExchange") or "").strip()
        return c

    def _order_from_dict(self, d: dict) -> Order:
        """Build Order from payload dict (action, totalQuantity, orderType, lmtPrice, etc.)."""
        o = Order()
        if not d:
            return o
        o.action = (d.get("action") or "BUY").strip().upper()
        o.totalQuantity = float(d.get("totalQuantity") or 0)
        o.orderType = (d.get("orderType") or "MKT").strip().upper()
        if d.get("lmtPrice") is not None:
            o.lmtPrice = float(d["lmtPrice"])
        if d.get("auxPrice") is not None:
            o.auxPrice = float(d["auxPrice"])
        o.tif = (d.get("tif") or "DAY").strip().upper()
        o.transmit = bool(d.get("transmit", True))
        o.whatIf = bool(d.get("whatIf", False))
        # Newer TWS versions reject these deprecated attributes (error 10268)
        o.eTradeOnly = False
        o.firmQuoteOnly = False
        if d.get("account"):
            o.account = str(d["account"]).strip()
        if d.get("openClose"):
            o.openClose = str(d["openClose"]).strip()
        return o

    @staticmethod
    def _order_error_message(code: int, text: str) -> str:
        """Human-readable message for known IB order error codes."""
        known = {
            103: "Duplicate order ID. Use a new order id or restart the agent.",
            201: "Order size too large (LGSZ). Submit a smaller size or use an algorithmic order.",
            202: "Limit price too far from market. Use a limit price closer to the current market price.",
            399: "Order rejected by exchange.",
            404: "Order not found (may already be filled or cancelled).",
            10167: "Order rejected: trading permission or market hours.",
        }
        if code in known:
            return f"{known[code]} (IB {code}: {text})"
        return f"IB error {code}: {text}"

    def place_order_sync(self, contract_d: dict, order_d: dict, timeout_sec: float = 30.0) -> dict:
        """Place order, wait for orderStatus/error, return result dict. Validates contract and order first."""
        ok, err = self.validate_contract_for_order(contract_d)
        if not ok:
            return {"error": err}
        ok, err = self.validate_order_params(order_d)
        if not ok:
            return {"error": err}
        order_id = self.get_next_order_id()
        self._order_events[order_id] = Event()
        self._order_results[order_id] = {}
        try:
            contract = self._contract_from_dict(contract_d)
            order = self._order_from_dict(order_d)
            order.orderId = order_id
            self.placeOrder(order_id, contract, order)
            if not self._order_events[order_id].wait(timeout=timeout_sec):
                return {"error": "Order response timeout. Check TWS and try again.", "orderId": order_id}
            res = self._order_results.get(order_id) or {}
            if res.get("errorCode") is not None:
                code = res.get("errorCode")
                text = res.get("errorString") or ""
                return {
                    "error": self._order_error_message(code, text),
                    "orderId": order_id,
                    "errorCode": code,
                    "errorString": text,
                }
            return {
                "orderId": order_id,
                "status": res.get("status"),
                "filled": res.get("filled"),
                "remaining": res.get("remaining"),
                "avgFillPrice": res.get("avgFillPrice"),
                "permId": res.get("permId"),
                "warningText": res.get("warningText"),
            }
        finally:
            self._order_events.pop(order_id, None)
            self._order_results.pop(order_id, None)

    def modify_order_sync(self, order_id: int, contract_d: dict, order_d: dict, timeout_sec: float = 30.0) -> dict:
        """Modify an existing order by re-sending placeOrder with the same orderId.
        IB treats placeOrder with an existing orderId as a modification.

        Accepts negative orderIds (IB assigns negative IDs to manually-placed
        TWS orders that were bound via reqAutoOpenOrders / reqOpenOrders when
        the TWS setting "Use negative numbers to bind automatic orders" is on).
        Only orderId == 0 is invalid (means the order was never bound).
        """
        if order_id == 0:
            return {"error": "Cannot modify order: orderId is 0 (unbound). "
                    "The order may have been placed manually and not yet bound. "
                    "Try fetching open orders first, then retry with the assigned orderId."}
        ok, err = self.validate_contract_for_order(contract_d)
        if not ok:
            return {"error": err}
        ok, err = self.validate_order_params(order_d)
        if not ok:
            return {"error": err}
        self._order_events[order_id] = Event()
        self._order_results[order_id] = {}
        try:
            contract = self._contract_from_dict(contract_d)
            order = self._order_from_dict(order_d)
            order.orderId = order_id
            self.placeOrder(order_id, contract, order)
            if not self._order_events[order_id].wait(timeout=timeout_sec):
                return {"error": "Modify order timeout. Check TWS.", "orderId": order_id}
            res = self._order_results.get(order_id) or {}
            if res.get("errorCode") is not None:
                code = res.get("errorCode")
                text = res.get("errorString") or ""
                return {
                    "error": self._order_error_message(code, text),
                    "orderId": order_id,
                    "errorCode": code,
                    "errorString": text,
                }
            return {
                "orderId": order_id,
                "status": res.get("status"),
                "filled": res.get("filled"),
                "remaining": res.get("remaining"),
                "avgFillPrice": res.get("avgFillPrice"),
            }
        finally:
            self._order_events.pop(order_id, None)
            self._order_results.pop(order_id, None)

    def cancel_order_sync(self, order_id: int) -> dict:
        """Cancel order by id."""
        try:
            self.cancelOrder(order_id)
            return {"ok": True, "orderId": order_id}
        except Exception as e:
            self.logger.error("cancel_order_sync: %s", e)
            return {"error": str(e), "orderId": order_id}

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
                # Bind orders from ALL clients (TWS, other API sessions) to this client
                # so we can cancel them. Without this, cancelOrder only works for orders
                # placed by this specific client_id.
                self.reqAutoOpenOrders(True)
                # Immediately request all open orders to populate the live order book.
                # This binds any manual TWS orders (assigning them API-usable orderIds)
                # and delivers orders from previous agent sessions.  The openOrder
                # callback will add each one to _live_orders automatically.
                self.reqOpenOrders()
                print(f"Connected to IB successfully (took {i+1}s)")
                return True
            if i < 4:
                print(f"  Waiting... ({i+1}/5)")

        print("ERROR: Failed to connect to IB after 5 seconds")
        return False

    def nextValidId(self, orderId: int):
        """Callback when connected; sync both data req id and order id from TWS."""
        super().nextValidId(orderId)
        self.next_req_id = orderId
        self.next_order_id = orderId  # Order ids must come from TWS sequence
        self.connection_lost = False
        self.last_heartbeat = time.time()
        if self.connection_start_time is None:
            self.connection_start_time = time.time()
        print(f"Connection healthy - ready with next order ID: {orderId}")

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
            # 354 = market data not subscribed; surface for test_futures
            if errorCode == 354 or "not subscribed" in (errorString or "").lower():
                self.last_mkt_data_error = (reqId, errorCode, errorString)
            # 200 = no security definition; for underlying requests we may retry with delayed
            if errorCode == 200 and reqId in self.req_id_map and "underlying" in self.req_id_map.get(reqId, ""):
                self._underlying_200_req_id = reqId
            # Order rejections (201 LGSZ, 202 price, etc.): signal pending place_order wait
            if reqId in self._order_events:
                self._order_results[reqId] = self._order_results.get(reqId) or {}
                self._order_results[reqId]["errorCode"] = errorCode
                self._order_results[reqId]["errorString"] = errorString or ""
                self._order_events[reqId].set()

    def orderStatus(self, orderId: int, status: str, filled: float, remaining: float,
                   avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float,
                   clientId: int, whyHeld: str, mktCapPrice: float):
        """Order status update.

        Always updates the live order book.  Also signals any pending
        place_order_sync / modify_order_sync wait.
        """
        self.logger.info(f"orderStatus orderId={orderId} status={status} filled={filled} remaining={remaining}")

        status_update = {
            "status": status,
            "filled": filled,
            "remaining": remaining,
            "avgFillPrice": avgFillPrice,
            "permId": permId,
            "parentId": parentId,
            "lastFillPrice": lastFillPrice,
            "clientId": clientId,
            "whyHeld": whyHeld or "",
            "mktCapPrice": mktCapPrice,
        }

        # ── Always update live order book ────────────────────────────────
        with self._live_orders_lock:
            if status in self._TERMINAL_STATUSES:
                self._live_orders.pop(orderId, None)
            elif orderId in self._live_orders:
                # Merge status into existing entry
                self._live_orders[orderId]["orderState"]["status"] = status
                self._live_orders[orderId]["_lastStatus"] = status_update
            else:
                # Status-only entry (we may not have seen the openOrder yet,
                # e.g. right after reconnect before reqOpenOrders completes)
                self._live_orders[orderId] = {
                    "orderId": orderId,
                    "permId": permId,
                    "clientId": clientId,
                    "contract": {},
                    "order": {},
                    "orderState": {"status": status},
                    "_lastStatus": status_update,
                    "_statusOnly": True,  # flag: contract/order details pending
                }
            if permId:
                self._perm_id_to_order_id[permId] = orderId

        # ── Place-order / modify-order wait ──────────────────────────────
        if orderId in self._order_events:
            self._order_results[orderId] = self._order_results.get(orderId) or {}
            self._order_results[orderId].update(status_update)
            self._order_events[orderId].set()

    def openOrder(self, orderId: int, contract: Contract, order: Order, orderState):
        """Open order / what-if; may include warningText (e.g. price capping).

        Always updates the live order book so that every active order is known
        to the agent — regardless of whether a snapshot is in progress, whether
        the order was placed by this session, or whether it was manually placed
        in TWS and subsequently bound via reqAutoOpenOrders.
        """
        perm_id = getattr(order, "permId", 0)
        status = getattr(orderState, "status", "") or ""
        order_entry = {
            "orderId": orderId,
            "permId": perm_id,
            "clientId": getattr(order, "clientId", -1),
            "contract": self._contract_to_dict(contract),
            "order": {
                "action": getattr(order, "action", ""),
                "totalQuantity": float(getattr(order, "totalQuantity", 0)),
                "orderType": getattr(order, "orderType", ""),
                "lmtPrice": float(getattr(order, "lmtPrice", 0)) if getattr(order, "lmtPrice", None) is not None else None,
                "auxPrice": float(getattr(order, "auxPrice", 0)) if getattr(order, "auxPrice", None) is not None else None,
                "tif": getattr(order, "tif", ""),
                "account": getattr(order, "account", ""),
                "parentId": getattr(order, "parentId", 0),
                "ocaGroup": getattr(order, "ocaGroup", ""),
            },
            "orderState": {
                "status": status,
                "warningText": getattr(orderState, "warningText", "") or "",
                "commission": float(getattr(orderState, "commission", 0)) if getattr(orderState, "commission", None) is not None else None,
            },
        }

        # ── Always update live order book ────────────────────────────────
        with self._live_orders_lock:
            if status in self._TERMINAL_STATUSES:
                self._live_orders.pop(orderId, None)
            else:
                self._live_orders[orderId] = order_entry
            # Track permId -> orderId (permId is account-unique and survives rebinds)
            if perm_id:
                self._perm_id_to_order_id[perm_id] = orderId

        # ── Snapshot collection (legacy path) ────────────────────────────
        if self._open_orders_active:
            self._open_orders_list.append(order_entry)

        # ── Place-order tracking (for place_order_sync / modify_order_sync waits) ──
        if orderId in self._order_events:
            self._order_results[orderId] = self._order_results.get(orderId) or {}
            if getattr(orderState, "warningText", None):
                self._order_results[orderId]["warningText"] = orderState.warningText
            # Don't set event here alone; orderStatus will set it. If whatIf, only openOrder may come.
            if order and getattr(order, "whatIf", False):
                self._order_events[orderId].set()

    def openOrderEnd(self):
        """End of open orders list."""
        if self._open_orders_active:
            self._open_orders_done.set()
        with self._live_orders_lock:
            count = len(self._live_orders)
        self.logger.info("openOrderEnd: live order book has %d active orders", count)

    def orderBound(self, orderId: int, apiClientId: int, apiOrderId: int):
        """Called when a manual TWS order is bound to an API client.
        Maps the permId (orderId param here is actually reqId/permId) to
        the assigned apiOrderId for the given apiClientId."""
        self.logger.info(
            "orderBound permId=%d apiClientId=%d apiOrderId=%d",
            orderId, apiClientId, apiOrderId,
        )
        with self._live_orders_lock:
            self._perm_id_to_order_id[orderId] = apiOrderId

    def execDetails(self, reqId: int, contract: Contract, execution):
        """Fill notification; optional for place_order (orderStatus is primary)."""
        self.logger.info("execDetails reqId=%s execId=%s", reqId, getattr(execution, "execId", ""))

    def execDetailsEnd(self, reqId: int):
        """End of executions for request."""
        pass

    def get_next_req_id(self) -> int:
        """For data requests only (market data, contract details, etc.). Do not use for placeOrder."""
        req_id = self.next_req_id
        self.next_req_id += 1
        return req_id

    def get_next_order_id(self) -> int:
        """For placeOrder only. Keeps order id sequence separate from request ids."""
        oid = self.next_order_id
        self.next_order_id += 1
        return oid

    @staticmethod
    def validate_contract_for_order(contract_d: dict) -> tuple:
        """Validate contract dict before order. Returns (ok: bool, error_message: str)."""
        if not contract_d or not isinstance(contract_d, dict):
            return False, "Contract is required and must be an object"
        symbol = (contract_d.get("symbol") or "").strip()
        if not symbol:
            return False, "Contract symbol is required"
        sec_type = (contract_d.get("secType") or "STK").strip().upper()
        if sec_type not in ("STK", "OPT", "FOP", "FUT", "CASH", "BOND", "WAR", "BAG"):
            return False, f"Unsupported secType: {sec_type}"
        if sec_type == "OPT":
            if not contract_d.get("lastTradeDateOrContractMonth") and not contract_d.get("localSymbol"):
                return False, "Option contract requires lastTradeDateOrContractMonth or localSymbol"
            if not contract_d.get("strike") and contract_d.get("strike") != 0:
                return False, "Option contract requires strike"
            if (contract_d.get("right") or "").strip().upper() not in ("C", "P"):
                return False, "Option contract requires right (C or P)"
        return True, ""

    @staticmethod
    def validate_order_params(order_d: dict) -> tuple:
        """Validate order dict before sending. Returns (ok: bool, error_message: str)."""
        if not order_d or not isinstance(order_d, dict):
            return False, "Order is required and must be an object"
        action = (order_d.get("action") or "BUY").strip().upper()
        if action not in ("BUY", "SELL", "SSHORT"):
            return False, f"Order action must be BUY, SELL, or SSHORT; got {action}"
        try:
            qty = float(order_d.get("totalQuantity") or 0)
        except (TypeError, ValueError):
            return False, "Order totalQuantity must be a number"
        if qty <= 0:
            return False, "Order totalQuantity must be positive"
        order_type = (order_d.get("orderType") or "MKT").strip().upper()
        if order_type not in ("MKT", "LMT", "STP", "STP LMT", "MOC", "LOC", "TRAIL", "TRAIL LIMIT", "MKT PRT", "LMT PRT"):
            return False, f"Unsupported orderType: {order_type}"
        if order_type == "LMT" or order_type == "STP LMT":
            try:
                lmt = order_d.get("lmtPrice")
                if lmt is None or (isinstance(lmt, (int, float)) and float(lmt) < 0):
                    return False, "Limit order requires non-negative lmtPrice"
            except (TypeError, ValueError):
                return False, "Order lmtPrice must be a number for limit orders"
        return True, ""

    def resolve_contract(self, ticker: str) -> Optional[int]:
        """Resolve stock contract to get contract ID. Waits for contractDetailsEnd."""
        print(f"[{ticker}] Step 1: Resolving contract...", flush=True)

        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

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
        if reqId in self.req_id_map and "contract_details" in self.req_id_map[reqId]:
            self.contract_details = contractDetails

    def contractDetailsEnd(self, reqId: int):
        if getattr(self, "_contract_details_wait_req_id", None) == reqId:
            self.contract_details_done.set()

    def fetch_underlying_data(self, ticker: str, resolved_contract: Optional[Contract] = None) -> Dict:
        """Fetch current underlying stock data. Use resolved_contract (conId/primaryExchange) when
        provided to avoid IB error 200 (no security definition) on some accounts."""
        print(f"[{ticker}] Step 2: Fetching underlying price...", flush=True)

        self.underlying_price = None
        self.underlying_bid = None
        self.underlying_ask = None
        self.historical_vol = None
        self._underlying_200_req_id = None

        contract = resolved_contract
        if contract is None:
            contract = Contract()
            contract.symbol = ticker
            contract.secType = "STK"
            contract.exchange = "SMART"
            contract.currency = "USD"
        else:
            # Ensure symbol set for req_id_map logging
            if not getattr(contract, "symbol", ""):
                contract.symbol = ticker

        req_id = self.get_next_req_id()
        self.req_id_map[req_id] = f"underlying_{ticker}"

        self.reqMktData(req_id, contract, "", False, False, [])
        time.sleep(3.0)  # 3s for slow symbols (e.g. EA)
        self.cancelMktData(req_id)

        # If IB returned 200 (no security definition) and we have no price, retry with delayed data
        if self.underlying_price is None and getattr(self, "_underlying_200_req_id", None) == req_id:
            self._underlying_200_req_id = None
            print(f"[{ticker}] Step 2: Retrying with delayed market data (account may not have real-time)...", flush=True)
            self.reqMarketDataType(3)  # DELAYED
            req_id2 = self.get_next_req_id()
            self.req_id_map[req_id2] = f"underlying_{ticker}"
            self.reqMktData(req_id2, contract, "", False, False, [])
            time.sleep(3.0)
            self.cancelMktData(req_id2)
            self.reqMarketDataType(1)  # restore REALTIME
            if self.underlying_price is not None:
                print(f"[{ticker}] Step 2: Got delayed price {self.underlying_price}", flush=True)

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
        """Handle price updates -- routes to streaming cache or scan data as appropriate."""
        # Fast path: if this reqId belongs to the streaming cache, update there and return
        if self.streaming_cache is not None and self.streaming_cache.is_streaming_req_id(reqId):
            self.streaming_cache.update_price(reqId, tickType, price)
            return
        # Existing scan path (unchanged)
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
        """Handle size updates -- routes to streaming cache or scan data as appropriate."""
        # Fast path: streaming cache
        if self.streaming_cache is not None and self.streaming_cache.is_streaming_req_id(reqId):
            self.streaming_cache.update_size(reqId, tickType, size)
            return
        # Existing scan path (unchanged)
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
        """Handle option Greeks -- routes to streaming cache or scan data as appropriate."""
        # Fast path: streaming cache
        if self.streaming_cache is not None and self.streaming_cache.is_streaming_req_id(reqId):
            self.streaming_cache.update_greeks(reqId, impliedVol, delta, gamma, vega, theta)
            return
        # Existing scan path (unchanged)
        if reqId in self.option_chain:
            if impliedVol and impliedVol > 0:
                self.option_chain[reqId]['implied_vol'] = impliedVol
            if delta is not None:
                self.option_chain[reqId]['delta'] = delta

    def get_available_expirations(self, ticker: str, contract_id: int = 0) -> List[str]:
        """Get available option expirations and strikes from IB. Waits for End callback (all exchanges).
        The scanner is used by one request at a time; available_expirations and available_strikes
        are valid only until the next call to this method."""
        print(f"[{ticker}] Step 3: Getting option expirations and strikes from IB...", flush=True)

        for attempt in range(2):  # initial try + one retry for flaky symbols (e.g. EA)
            if attempt > 0:
                print(f"[{ticker}] Step 3: Retry (attempt 2/2)...", flush=True)
                time.sleep(1)

            req_id = self.get_next_req_id()
            self.req_id_map[req_id] = f"expirations_{ticker}"
            self.available_expirations = []
            self.available_strikes = {}

            self._sec_def_wait_req_id = req_id
            self.sec_def_opt_params_done.clear()
            self.reqSecDefOptParams(req_id, ticker, "", "STK", contract_id)

            # Wait for securityDefinitionOptionParameterEnd (all callbacks complete).
            if not self.sec_def_opt_params_done.wait(timeout=15):
                print(f"[{ticker}] Step 3: Timeout (15s) waiting for option parameters", flush=True)
            self._sec_def_wait_req_id = None

            if self.available_expirations:
                print(f"[{ticker}] Step 3: Got {len(self.available_expirations)} expirations, {len(self.available_strikes)} strike lists", flush=True)
                break
            if attempt == 0:
                print(f"[{ticker}] Step 3: No option parameters on first try", flush=True)

        if not self.available_expirations:
            print(f"[{ticker}] Step 3: IB returned no expirations after 2 attempts", flush=True)
        return self.available_expirations

    def securityDefinitionOptionParameter(self, reqId: int, exchange: str,
                                          underlyingConId: int, tradingClass: str,
                                          multiplier: str, expirations: SetOfString,
                                          strikes: SetOfFloat):
        """Handle security definition response"""
        if reqId in self.req_id_map:
            exp_list = list(expirations) if isinstance(expirations, set) else expirations
            strike_list = sorted(list(strikes)) if isinstance(strikes, set) else strikes
            # #region agent log
            _debug_log("ib_scanner:securityDefinitionOptionParameter", "sec_def_callback", {"exchange": exchange, "n_expirations": len(exp_list), "n_strikes": len(strike_list), "reqId": reqId}, "H2")
            # #endregion
            self.available_expirations.extend(exp_list)
            for exp in exp_list:
                if exp not in self.available_strikes:
                    self.available_strikes[exp] = strike_list
                else:
                    # Merge strike lists so we get all available strikes from every exchange (fix EA intermittent missing strikes)
                    existing = self.available_strikes[exp]
                    merged = sorted(set(existing) | set(strike_list))
                    self.available_strikes[exp] = merged

    def securityDefinitionOptionParameterEnd(self, reqId: int):
        """Called when all securityDefinitionOptionParameter callbacks are complete."""
        if getattr(self, "_sec_def_wait_req_id", None) == reqId:
            self.sec_def_opt_params_done.set()

    def get_third_friday(self, year: int, month: int) -> datetime:
        """Calculate third Friday of the month"""
        c = calendar.monthcalendar(year, month)
        first_week = c[0]
        if first_week[4] != 0:
            third_friday = c[2][4]
        else:
            third_friday = c[3][4]
        return datetime(year, month, third_friday)

    def _strike_on_grid(self, strike: float, increment: float) -> bool:
        """True if strike lies on the standard option chain grid (avoids half-dollar strikes not listed on SMART)."""
        if increment <= 0:
            return True
        nearest = round(strike / increment) * increment
        return abs(nearest - strike) < 1e-6

    def get_strikes_near_price(self, price: float, min_strike: float,
                              max_strike: float, increment: float = 2.5) -> List[float]:
        """Return strike prices at increment between min and max (fallback when IB returns no strikes)."""
        strikes = []
        start = int(min_strike / increment) * increment
        end = int(max_strike / increment) * increment + increment
        current = start
        while current <= end:
            strikes.append(current)
            current += increment
        return strikes

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
        print(f"[{ticker}] Fetching option chain (price={current_price or self.underlying_price}, deal_close={deal_close_date})", flush=True)

        _chain_start = time.time()
        _step_times: dict = {}

        contract_id = self.resolve_contract(ticker)
        _step_times["resolve_contract"] = round(time.time() - _chain_start, 3)
        if not contract_id:
            contract_id = 0
            print(f"[{ticker}] Using contract_id=0 for option params request", flush=True)

        # Expirations/strikes are requested once in get_available_expirations().
        # Do not call reqSecDefOptParams here or the second request can clear the first response.

        options = []
        price_to_use = current_price or self.underlying_price
        total_planned = 0

        if price_to_use:
            # Get expirations
            _exp_start = time.time()
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
                # Always get fresh expirations/strikes from IB for this ticker (avoid stale data from a previous call).
                self.get_available_expirations(ticker, contract_id)
                selected_expiries = sorted(set(self.available_expirations))[:3]
            _step_times["get_expirations"] = round(time.time() - _exp_start, 3)

            print(f"[{ticker}] Step 4: Selected expirations: {selected_expiries}", flush=True)

            # Determine strike range
            deal_price_to_use = deal_price or price_to_use
            lower_bound = deal_price_to_use * 0.75
            upper_bound = deal_price_to_use * 1.10

            # Use only IB strikes when available, filtered to standard grid to avoid "No security definition" for half-dollar strikes.
            increment = 5.0 if deal_price_to_use > 50 else 2.5
            batch: List[Tuple[str, float, str]] = []
            for expiry in selected_expiries:
                if expiry in self.available_strikes and self.available_strikes[expiry]:
                    all_strikes = self.available_strikes[expiry]
                    strikes = [s for s in all_strikes
                               if lower_bound <= s <= upper_bound and self._strike_on_grid(s, increment)]
                    print(f"[{ticker}]   {expiry}: {len(strikes)} strikes (from IB, grid {increment})", flush=True)
                else:
                    # Only when IB returned no option params after wait+retry
                    strikes = self.get_strikes_near_price(
                        deal_price_to_use, lower_bound, upper_bound,
                        increment=5.0 if deal_price_to_use > 50 else 2.5
                    )
                    print(f"[{ticker}]   {expiry}: {len(strikes)} strikes (estimated - IB returned no strikes)", flush=True)
                total_planned += len(strikes) * 2
                for strike in strikes:
                    for right in ['C', 'P']:
                        batch.append((expiry, strike, right))
            _batch_start = time.time()
            results = self.get_option_data_batch(ticker, batch)
            _step_times["batch_option_data"] = round(time.time() - _batch_start, 3)
            options = [opt for opt in results if opt is not None]

        _total = round(time.time() - _chain_start, 2)
        # #region agent log
        _debug_log("ib_scanner:fetch_option_chain", "chain_done", {"ticker": ticker, "options_count": len(options), "total_planned": total_planned, "duration_sec": _total}, "H1")
        # #endregion
        print(
            f"[perf][{ticker}] fetch_option_chain total={_total}s "
            f"steps={_step_times} planned={total_planned} returned={len(options)}",
            flush=True,
        )
        print(f"[{ticker}] Step 5: Fetched {len(options)} options total", flush=True)
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
        time.sleep(1.0)
        self.cancelMktData(req_id)

        data = self.option_chain.get(req_id)
        if data:
            if data['bid'] > 0 or data['last'] > 0:
                return OptionData(**data)
            # Return option with zero quotes so we always include every available strike (goal: fetch available strikes every time)
            # #region agent log
            _debug_log("ib_scanner:get_option_data", "no_quote_returned_anyway", {"ticker": ticker, "expiry": expiry, "strike": strike, "right": right}, "H3")
            # #endregion
            return OptionData(**data)
        return None

    BATCH_CHUNK_SIZE = 50  # default; overridden by resource_manager.scan_batch_size when available
    BATCH_WAIT_SEC = 2.5

    @property
    def _effective_batch_size(self) -> int:
        """Dynamic batch size: uses resource_manager when available, else the class default."""
        if self.resource_manager is not None:
            return self.resource_manager.scan_batch_size
        return self.BATCH_CHUNK_SIZE

    def get_option_data_batch(
        self, ticker: str, contracts: List[Tuple[str, float, str]]
    ) -> List[Optional[OptionData]]:
        """Get data for many option contracts at once (batch reqMktData, single wait, then cancel).
        Processes in chunks sized by _effective_batch_size to stay under IB concurrent limits.
        Returns list in same order as contracts; missing/empty data is None."""
        if not contracts:
            return []
        chunk_size = self._effective_batch_size
        results: List[Optional[OptionData]] = []
        for start in range(0, len(contracts), chunk_size):
            chunk = contracts[start : start + chunk_size]
            req_ids: List[int] = []
            for expiry, strike, right in chunk:
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
                req_ids.append(req_id)
                self.req_id_map[req_id] = f"option_{ticker}_{expiry}_{strike}_{right}"
                self.option_chain[req_id] = {
                    "symbol": ticker,
                    "strike": strike,
                    "expiry": expiry,
                    "right": right,
                    "bid": 0,
                    "ask": 0,
                    "last": 0,
                    "volume": 0,
                    "open_interest": 0,
                    "implied_vol": 0,
                    "delta": 0,
                    "gamma": 0,
                    "theta": 0,
                    "vega": 0,
                    "bid_size": 0,
                    "ask_size": 0,
                }
                self.reqMktData(req_id, contract, "100,101,104,106", False, False, [])
            time.sleep(self.BATCH_WAIT_SEC)
            for req_id in req_ids:
                self.cancelMktData(req_id)
            for req_id, (expiry, strike, right) in zip(req_ids, chunk):
                data = self.option_chain.get(req_id)
                if data:
                    results.append(OptionData(**data))
                else:
                    results.append(None)
            # Clean up all req_ids so late-arriving ticks do not leave orphan entries.
            for req_id in req_ids:
                self.option_chain.pop(req_id, None)
                self.req_id_map.pop(req_id, None)
        return results
