#!/usr/bin/env python3
"""
Execution Engine
================
Autonomous execution loop that reads from the streaming quote cache
and places/manages orders through the local IB TWS connection.

The engine runs entirely on the local machine -- no network round-trips
in the critical path. The server only sends configuration and receives
telemetry.

Architecture:
    ┌──────────────────────────────────────────┐
    │  ExecutionEngine                         │
    │                                          │
    │  ┌──────────┐    ┌──────────────────┐    │
    │  │ Strategy │──> │ OrderAction      │    │
    │  │ .evaluate│    │ (buy/sell/cancel) │    │
    │  └──────────┘    └────────┬─────────┘    │
    │       ▲                   │              │
    │       │     ┌─────────────┤              │
    │       │     │ Order Budget│              │
    │       │     │ Flip-flop   │              │
    │       │     │ Inflight cap│              │
    │       │     └─────────────┤              │
    │       │                   ▼              │
    │  ┌────┴─────┐    ┌──────────────────┐    │
    │  │ QuoteCache│   │ IBMergerArbScanner│   │
    │  │ (reads)  │    │ (placeOrder)     │    │
    │  └──────────┘    └──────────────────┘    │
    └──────────────────────────────────────────┘

Order lifecycle: The scanner fires order_status_listeners on every
orderStatus/execDetails callback.  The engine enqueues these on a
thread-safe queue and drains them at the top of each eval tick,
routing fill events to strategies via on_fill().

Usage:
    engine = ExecutionEngine(scanner, quote_cache, resource_manager)
    engine.load_strategy(config)
    engine.start()
    ...
    engine.stop()
"""

import logging
import queue
import threading
import time
import uuid
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, Future
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from ib_scanner import IBMergerArbScanner
    from ibapi.contract import Contract
    from quote_cache import StreamingQuoteCache, Quote
    from resource_manager import ResourceManager

logger = logging.getLogger(__name__)


# ── Order action types ──

class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(Enum):
    MARKET = "MKT"
    LIMIT = "LMT"
    STOP = "STP"
    STOP_LIMIT = "STP LMT"
    TRAIL = "TRAIL"


class TickerMode(Enum):
    """Per-ticker trade mode controlling what orders are allowed."""
    NORMAL = "NORMAL"        # All orders allowed (default)
    EXIT_ONLY = "EXIT_ONLY"  # Block new entries, risk exits continue
    NO_ORDERS = "NO_ORDERS"  # Block all automated orders, quotes stay live


@dataclass
class OrderAction:
    """An order instruction produced by a strategy's evaluate() method."""
    strategy_id: str
    side: OrderSide
    order_type: OrderType
    quantity: int
    contract_dict: dict  # IB contract fields (symbol, secType, strike, etc.)
    limit_price: Optional[float] = None  # required if order_type is LIMIT
    aux_price: Optional[float] = None    # stop price for STP/STP LMT/TRAIL
    tif: str = "DAY"  # DAY, GTC, IOC, etc.
    outside_rth: bool = False  # fill outside regular trading hours (pre/post market)
    reason: str = ""  # human-readable explanation for logging/audit
    is_exit: bool = False  # True for risk manager exits — bypasses entry budget
    estimated_notional: Optional[float] = None  # pre-computed $ cost for MKT orders (qty × price × multiplier)
    pre_trade_snapshot: Optional[dict] = None  # market state at order creation (Phase 0 instrumentation)
    routing_exchange: str = "SMART"  # strategy hint; telemetry records the submitted contract exchange


@dataclass
class ActiveOrder:
    """Tracks an order after placement for lifecycle monitoring."""
    order_id: int
    strategy_id: str
    status: str = ""
    filled: float = 0.0
    remaining: float = 0.0
    avg_fill_price: float = 0.0
    perm_id: int = 0
    placed_at: float = 0.0  # time.time() when submitted
    last_update: float = 0.0  # time.time() of last status update
    error: str = ""
    warning_text: str = ""
    why_held: str = ""
    error_code: Optional[int] = None
    error_string: str = ""
    advanced_order_reject_json: str = ""
    is_entry: bool = True  # budget refund on IB-side rejection (Inactive status)
    pre_trade_snapshot: Optional[dict] = None  # Phase 0: market state at order creation
    contract_dict: Optional[dict] = None  # Phase 0: for post-fill quote lookups
    routing_exchange: str = "SMART"  # submitted contract exchange recorded for venue telemetry


@dataclass
class DeadOrderRecord:
    """Recent terminal order outcome retained for UI visibility/debugging."""
    order_id: int
    strategy_id: str
    ticker: str
    status: str
    reason: str
    error_code: Optional[int] = None
    error_string: str = ""
    warning_text: str = ""
    why_held: str = ""
    advanced_order_reject_json: str = ""
    perm_id: int = 0
    filled: float = 0.0
    remaining: float = 0.0
    is_entry: bool = True
    placed_at: float = 0.0
    dead_at: float = 0.0


@dataclass
class ExitReservation:
    """Contract-level reservation for a working exit order."""
    token: int
    reservation_id: str
    strategy_id: str
    contract_key: tuple
    reserved_qty: int
    order_id: Optional[int] = None
    perm_id: int = 0
    source: str = ""
    status: str = "pending_submit"
    release_reason: str = ""
    created_at: float = 0.0
    updated_at: float = 0.0


@dataclass
class StrategyState:
    """Runtime state for a loaded strategy."""
    strategy_id: str
    strategy: "ExecutionStrategy"
    config: dict
    subscriptions: List[str] = field(default_factory=list)  # cache keys for streaming quotes
    is_active: bool = True
    last_eval_time: float = 0.0
    eval_count: int = 0
    orders_placed: int = 0
    orders_submitted: int = 0  # total submitted (including in-flight)
    inflight_orders: int = 0   # currently awaiting TWS acknowledgment
    errors: List[str] = field(default_factory=list)
    flipflop_resume_at: float = 0.0  # timestamp when flip-flop cooldown expires
    # Per-ticker budget fields
    ticker: str = ""                    # ticker this strategy trades (empty for risk managers)
    ticker_entry_budget: int = -1       # -1=unlimited, 0=halted, N=exactly N more entries
    ticker_entries_placed: int = 0      # lifetime counter for this ticker


# ── Strategy interface ──

class ExecutionStrategy(ABC):
    """Abstract base class for execution strategies.

    Concrete implementations define:
    - What instruments to subscribe to (get_subscriptions)
    - When to place/cancel orders (evaluate)
    - What to do on fills (on_fill)
    - What to do on order death (on_order_dead)

    Strategies are stateless between evaluate() calls -- all state is in the
    quote cache and the strategy's own instance variables.
    """

    @abstractmethod
    def get_subscriptions(self, config: dict) -> List[dict]:
        """Return a list of subscription specs for the quote cache.

        Each spec is a dict with:
            - cache_key: str (e.g. "AAPL" or "AAPL:150.0:20260320:C")
            - contract: dict with IB contract fields (symbol, secType, exchange, etc.)
            - generic_ticks: str (optional, defaults to "100,101,104,106")
        """
        ...

    @abstractmethod
    def evaluate(self, quotes: Dict[str, "Quote"], config: dict) -> List[OrderAction]:
        """Evaluate current market state and return zero or more order actions.

        Called at the engine's eval_interval (default 100ms). Must be fast --
        avoid I/O, network calls, or heavy computation.

        Args:
            quotes: Dict of cache_key -> Quote for all subscribed instruments.
            config: The strategy config dict (may have been updated via execution_config).

        Returns:
            List of OrderAction objects. Empty list means "do nothing this tick."
        """
        ...

    @abstractmethod
    def on_fill(self, order_id: int, fill_data: dict, config: dict):
        """Called when an order placed by this strategy receives a fill (full or partial).

        fill_data contains:
            - status: str (e.g. "Filled", "Submitted")
            - filled: float (cumulative filled quantity)
            - remaining: float (quantity still open)
            - avgFillPrice: float
            - permId: int
            - lastFillPrice: float

        Use this to update internal state, adjust positions, etc.
        """
        ...

    def on_order_dead(self, order_id: int, reason: str, config: dict):
        """Called when an order is cancelled, rejected, or goes Inactive.

        Override to re-arm levels or take corrective action.
        Default: no-op.
        """
        pass

    def on_order_placed(self, order_id: int, result: dict, config: dict):
        """Called after the engine successfully places an order for this strategy.

        Override to record the order_id for level tracking.
        Default: no-op.
        """
        pass

    def on_start(self, config: dict):
        """Called when the strategy is loaded and about to start. Override for setup."""
        pass

    def on_stop(self, config: dict):
        """Called when the strategy is being unloaded. Override for cleanup."""
        pass

    def get_strategy_state(self) -> dict:
        """Return strategy-specific state for telemetry. Override to expose custom state."""
        return {}


# ── Constants ──

IB_IGNORE_TICKERS = frozenset({"VGZ", "UNCO", "HOLO"})

NUMERIC_CONFIG_KEYS = {
    "signal_threshold", "min_signal_strength", "cooldown_minutes",
    "decision_interval_seconds", "contract_budget_usd", "max_contracts",
    "otm_target_pct", "premium_min", "premium_max", "max_spread",
    "trailing_activation_pct", "trailing_trail_pct",
}
BOOL_CONFIG_KEYS = {
    "auto_entry", "use_delayed_data", "options_gate_enabled",
    "trailing_enabled", "stop_loss_enabled",
}


# ── Execution Engine ──

class ExecutionEngine:
    """Runs strategy evaluation loops and manages order lifecycle.

    Thread model (3 threads):
    - **exec-engine**: Evaluation loop -- reads quotes, calls strategy.evaluate(),
      submits order actions, drains order event queue.  Never blocks on IB.
    - **order-exec**: Dedicated single-worker thread for placing orders via
      scanner.place_order_sync().  Decoupled from eval loop so a slow TWS
      acknowledgment doesn't stall evaluations.
    - **IB EReader**: Delivers tick callbacks to the streaming cache and
      order status callbacks (not owned by the engine).

    Safety layers (checked in order for each OrderAction):
    1. Order Budget -- global algo order allowance (lifeguard on duty)
    2. Flip-flop guard -- per-strategy order rate limiter
    3. Inflight cap -- global cap on orders awaiting TWS ack
    4. Connection gate -- rejects orders when IB is disconnected
    """

    DEFAULT_EVAL_INTERVAL = 0.1  # 100ms between evaluation ticks
    MAX_INFLIGHT_ORDERS = 10     # global cap -- drop actions if this many are pending
    ORDER_TIMEOUT_SEC = 10.0     # per-order TWS acknowledgment timeout
    LIFECYCLE_SWEEP_TICKS = 20   # run lifecycle sweep every N ticks (2s at 100ms)
    STALE_ORDER_WARN_SEC = 60.0  # warn if order has no update for this long
    STALE_ORDER_CANCEL_SEC = 120.0  # auto-cancel after 2 minutes with no update
    STALE_ORDER_GC_SEC = 300.0     # force-remove after 5 min if cancel got no response
    RECENT_TERMINAL_ORDER_TTL_SEC = 900.0  # guard against late callbacks re-registering filled orders
    FLIPFLOP_MAX_ORDERS = 5      # max orders per strategy in the flip-flop window
    FLIPFLOP_WINDOW_SEC = 10.0   # flip-flop detection window
    FLIPFLOP_COOLDOWN_SEC = 60.0 # resume after cooldown instead of permanent pause

    def __init__(
        self,
        scanner: "IBMergerArbScanner",
        quote_cache: "StreamingQuoteCache",
        resource_manager: "ResourceManager",
        position_store=None,
    ):
        self._scanner = scanner
        self._cache = quote_cache
        self._resource_manager = resource_manager
        self._position_store = position_store
        self._strategies: Dict[str, StrategyState] = {}
        self._running = False
        self._eval_interval = self.DEFAULT_EVAL_INTERVAL
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Order tracking: order_id -> strategy_id (for routing fills)
        self._order_strategy_map: Dict[int, str] = {}
        # Active orders: full lifecycle tracking after placement
        self._active_orders: Dict[int, ActiveOrder] = {}
        self._active_orders_lock = threading.Lock()
        self._recent_dead_orders: List[DeadOrderRecord] = []
        self._recent_dead_orders_lock = threading.Lock()
        self._recent_terminal_orders: Dict[int, float] = {}
        self._recent_terminal_orders_lock = threading.Lock()
        self._broker_positions: Dict[tuple, dict] = {}
        self._broker_positions_lock = threading.Lock()
        self._broker_open_orders: Dict[tuple, dict] = {}
        self._broker_open_orders_lock = threading.Lock()
        self._managed_contract_issues: Dict[tuple, dict] = {}
        self._managed_contract_issues_lock = threading.Lock()
        self._exit_reservations: Dict[int, ExitReservation] = {}
        self._exit_reservations_lock = threading.Lock()
        self._next_exit_reservation_token = 1

        # Order event queue: filled by scanner callbacks, drained by eval loop
        self._order_event_queue: queue.Queue = queue.Queue()

        # exec_id routing for commission capture:
        #   order_id → exec_id (set from execDetails, used by _persist_fill)
        #   exec_id → strategy_id (for routing commission reports)
        self._order_exec_ids: Dict[int, str] = {}
        self._exec_id_to_position: Dict[str, str] = {}
        self._order_exec_details: Dict[int, dict] = {}
        self._order_position_ids: Dict[int, str] = {}

        # Phase 0 execution instrumentation: pre-trade snapshots keyed by order_id.
        # Set in pre_submit_callback (before IB can send fills) to survive the
        # race where fills arrive before _on_order_complete.
        self._order_pre_trade_snapshots: Dict[int, dict] = {}
        self._order_contract_dicts: Dict[int, dict] = {}
        self._order_routing_exchanges: Dict[int, str] = {}

        # Non-blocking order placement: single-worker executor + inflight counter
        self._order_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="order-exec",
        )
        self._inflight_order_count = 0
        self._inflight_lock = threading.Lock()

        # ── Entry Budget (three-tier: global cap + per-ticker budgets + risk budget) ──
        self._global_entry_cap: int = 0       # 0 = halted, -1 = unlimited, N = exactly N more
        self._entry_cap_lock = threading.Lock()
        self._total_entries_placed: int = 0   # lifetime counter (never resets)
        self._risk_budget_usd: float = 0.0    # 0 = disabled, >0 = max total dollar exposure

        # ── Reconnect hold: blocks eval loop until post-reconnect reconciliation ──
        # NOTE: Written by async agent thread (set_reconnect_hold), read by eval
        # thread (_evaluate_all, _process_order_action). Safe under CPython GIL +
        # x86 memory ordering. If migrating to no-GIL Python or ARM, replace with
        # threading.Event. See Finding L6 in risk-management-code-review-2026-03-05.
        self._reconnect_hold: bool = False

        # ── Auto-restart pause: entries blocked, risk managers active ──
        self._auto_restart_paused: bool = False

        # ── Per-ticker trade modes ──
        self._ticker_modes: Dict[str, TickerMode] = {}

        # ── Flip-flop detection ──
        # strategy_id -> list of submission timestamps
        self._order_timestamps: Dict[str, List[float]] = {}

        # ── Lifecycle sweep counter ──
        self._tick_count = 0

        self._restore_exit_reservations_from_store()

    @staticmethod
    def _contract_exchange(contract_dict: Optional[dict]) -> str:
        """Return the exchange actually present on the submitted contract payload."""
        return str((contract_dict or {}).get("exchange") or "").strip().upper()

    # ── Entry Budget (two-tier) ──

    @staticmethod
    def _detail_suffix(label: str, value: str) -> str:
        value = (value or "").strip()
        return f"{label}: {value}" if value else ""

    def _build_dead_order_reason(self, order_id: int, status: str, active: Optional[ActiveOrder]) -> str:
        if active is None:
            return f"Order {order_id} terminal: {status}"

        details = []
        if active.error_code is not None:
            details.append(f"IB {active.error_code}")
        if active.error_string:
            details.append(active.error_string.strip())
        if active.warning_text:
            details.append(self._detail_suffix("warning", active.warning_text))
        if active.why_held:
            details.append(self._detail_suffix("whyHeld", active.why_held))
        if active.advanced_order_reject_json:
            details.append(self._detail_suffix("advancedReject", active.advanced_order_reject_json))

        detail_text = " | ".join(part for part in details if part)
        if detail_text:
            return f"Order {order_id} terminal: {status} ({detail_text})"
        return f"Order {order_id} terminal: {status}"

    @staticmethod
    def _should_surface_dead_order(status: str, active: Optional[ActiveOrder]) -> bool:
        if status == "Inactive":
            return True
        if active is None:
            return False
        return any(
            value not in (None, "")
            for value in (
                active.error_code,
                active.error_string,
                active.warning_text,
                active.why_held,
                active.advanced_order_reject_json,
            )
        )

    @staticmethod
    def _normalize_contract_key(instr: dict) -> tuple:
        symbol = str(instr.get("symbol") or "").upper()
        expiry = (
            instr.get("expiry")
            or instr.get("lastTradeDateOrContractMonth")
            or ""
        )
        right = str(instr.get("right") or "").upper()
        try:
            strike = round(float(instr.get("strike") or 0.0), 6)
        except (TypeError, ValueError):
            strike = 0.0
        return (symbol, strike, str(expiry), right)

    @staticmethod
    def _format_contract_key(contract_key: tuple) -> str:
        symbol, strike, expiry, right = contract_key
        if strike or expiry or right:
            return f"{symbol}:{strike}:{expiry}:{right}"
        return symbol or "UNKNOWN"

    def _active_store_positions_by_contract(self) -> Dict[tuple, list]:
        positions: Dict[tuple, list] = {}
        if not self._position_store:
            return positions
        for pos in self._position_store.get_all_positions():
            if pos.get("status") != "active":
                continue
            key = self._normalize_contract_key(pos.get("instrument", {}))
            positions.setdefault(key, []).append(pos)
        return positions

    def _managed_qty_by_contract(self) -> Dict[tuple, int]:
        positions = self._active_store_positions_by_contract()
        managed_qty: Dict[tuple, int] = {}
        for key, contract_positions in positions.items():
            total = 0
            for pos in contract_positions:
                runtime_state = pos.get("runtime_state", {}) or {}
                entry = pos.get("entry", {}) or {}
                total += int(
                    round(
                        float(
                            runtime_state.get(
                                "remaining_qty",
                                entry.get("quantity", 0),
                            ) or 0
                        )
                    )
                )
            managed_qty[key] = total
        return managed_qty

    def _update_broker_position_book(self, ib_positions: list) -> None:
        now = time.time()
        snapshot: Dict[tuple, dict] = {}
        for ib_pos in ib_positions or []:
            contract = ib_pos.get("contract", {}) or {}
            symbol = contract.get("symbol")
            if symbol in IB_IGNORE_TICKERS:
                continue
            qty = int(round(float(ib_pos.get("position", 0) or 0)))
            key = self._normalize_contract_key(contract)
            entry = snapshot.setdefault(key, {
                "contract_key": key,
                "accounts": set(),
                "qty": 0,
                "avg_cost": 0.0,
                "updated_at": now,
            })
            entry["qty"] += qty
            if ib_pos.get("account"):
                entry["accounts"].add(ib_pos["account"])
            if ib_pos.get("avgCost") is not None:
                entry["avg_cost"] = float(ib_pos.get("avgCost") or 0.0)
        for entry in snapshot.values():
            entry["accounts"] = sorted(entry["accounts"])
        with self._broker_positions_lock:
            self._broker_positions = snapshot

    def _update_broker_open_orders_book(self, ib_open_orders: list) -> None:
        now = time.time()
        snapshot: Dict[tuple, dict] = {}
        for order in ib_open_orders or []:
            contract = order.get("contract", {}) or {}
            symbol = contract.get("symbol")
            if symbol in IB_IGNORE_TICKERS:
                continue
            key = self._normalize_contract_key(contract)
            last_status = order.get("_lastStatus", {}) or {}
            order_payload = order.get("order", {}) or {}
            remaining = last_status.get("remaining")
            if remaining is None:
                remaining = order_payload.get("totalQuantity")
            remaining_qty = int(round(float(remaining or 0)))
            entry = snapshot.setdefault(key, {
                "contract_key": key,
                "working_open_order_qty": 0,
                "order_ids": [],
                "perm_ids": [],
                "updated_at": now,
            })
            entry["working_open_order_qty"] += max(0, remaining_qty)
            if order.get("orderId"):
                entry["order_ids"].append(int(order["orderId"]))
            if order.get("permId"):
                entry["perm_ids"].append(int(order["permId"]))
        with self._broker_open_orders_lock:
            self._broker_open_orders = snapshot

    def _get_broker_open_orders(self, contract_key: tuple) -> Optional[dict]:
        with self._broker_open_orders_lock:
            broker = self._broker_open_orders.get(contract_key)
            return dict(broker) if broker else None

    def _get_broker_position(self, contract_key: tuple) -> Optional[dict]:
        with self._broker_positions_lock:
            broker = self._broker_positions.get(contract_key)
            return dict(broker) if broker else None

    def _set_managed_contract_issues(self, report: dict) -> None:
        issues = {}
        for duplicate in report.get("duplicate_agent", []):
            key = tuple(duplicate.get("instrument", ()))
            if not key:
                continue
            issues[key] = {
                "contract_key": key,
                "status": "duplicate_active_positions",
                "message": (
                    "Multiple active managed positions own the same contract. "
                    "Automated exits are blocked fail-closed until resolved."
                ),
                "position_ids": duplicate.get("position_ids", []),
                "ib_qty": duplicate.get("ib_qty"),
                "updated_at": time.time(),
            }
        with self._managed_contract_issues_lock:
            self._managed_contract_issues = issues

    def _get_managed_contract_issue(self, contract_key: tuple) -> Optional[dict]:
        with self._managed_contract_issues_lock:
            issue = self._managed_contract_issues.get(contract_key)
            return dict(issue) if issue else None

    def _reserved_exit_qty(self, contract_key: tuple) -> int:
        with self._exit_reservations_lock:
            return sum(
                max(0, reservation.reserved_qty)
                for reservation in self._exit_reservations.values()
                if reservation.contract_key == contract_key and reservation.reserved_qty > 0
            )

    def _reservation_issue_state(self, contract_key: tuple) -> Optional[str]:
        with self._exit_reservations_lock:
            active = [
                reservation
                for reservation in self._exit_reservations.values()
                if reservation.contract_key == contract_key and reservation.reserved_qty > 0
            ]
        if not active:
            return None
        if any(reservation.status == "ambiguous" for reservation in active):
            return "reservation_ambiguous"
        if any(reservation.status == "recovery_pending" for reservation in active):
            return "recovery_pending"
        return "working"

    def _restore_exit_reservations_from_store(self) -> None:
        if not self._position_store or not hasattr(self._position_store, "get_active_exit_reservations"):
            return
        restored = 0
        with self._exit_reservations_lock:
            self._exit_reservations.clear()
            self._next_exit_reservation_token = 1
            for record in self._position_store.get_active_exit_reservations():
                contract_key = tuple(str(record.get("contract_key", "")).split(":"))
                if len(contract_key) == 4:
                    symbol, strike, expiry, right = contract_key
                    try:
                        contract_key = (
                            symbol,
                            round(float(strike or 0.0), 6),
                            expiry,
                            right,
                        )
                    except (TypeError, ValueError):
                        contract_key = self._normalize_contract_key({})
                token = self._next_exit_reservation_token
                self._next_exit_reservation_token += 1
                self._exit_reservations[token] = ExitReservation(
                    token=token,
                    reservation_id=record.get("reservation_id") or uuid.uuid4().hex,
                    strategy_id=record.get("strategy_id", ""),
                    contract_key=contract_key,
                    reserved_qty=max(0, int(record.get("reserved_qty", 0) or 0)),
                    order_id=int(record.get("order_id", 0) or 0) or None,
                    perm_id=int(record.get("perm_id", 0) or 0),
                    source=record.get("source", ""),
                    status=record.get("status", "recovery_pending"),
                    release_reason=record.get("release_reason", ""),
                    created_at=float(record.get("created_at") or time.time()),
                    updated_at=float(record.get("updated_at") or time.time()),
                )
                restored += 1
        if restored:
            logger.info("ExecutionEngine: restored %d persisted exit reservations", restored)

    def _create_exit_reservation(
        self,
        strategy_id: str,
        contract_key: tuple,
        reserved_qty: int,
        source: str,
    ) -> int:
        with self._exit_reservations_lock:
            token = self._next_exit_reservation_token
            self._next_exit_reservation_token += 1
            now = time.time()
            reservation = ExitReservation(
                token=token,
                reservation_id=uuid.uuid4().hex,
                strategy_id=strategy_id,
                contract_key=contract_key,
                reserved_qty=max(0, int(reserved_qty)),
                source=source,
                status="pending_submit",
                created_at=now,
                updated_at=now,
            )
            self._exit_reservations[token] = reservation
        if self._position_store and hasattr(self._position_store, "create_exit_reservation"):
            self._position_store.create_exit_reservation(
                reservation_id=reservation.reservation_id,
                strategy_id=strategy_id,
                contract_key=contract_key,
                reserved_qty=reservation.reserved_qty,
                source=source,
                status=reservation.status,
            )
        return token

    def _bind_exit_reservation(self, token: Optional[int], order_id: int, perm_id: int = 0) -> None:
        if not token:
            return
        reservation_id = ""
        with self._exit_reservations_lock:
            reservation = self._exit_reservations.get(token)
            if reservation:
                reservation.order_id = order_id
                if perm_id:
                    reservation.perm_id = int(perm_id)
                reservation.status = "working"
                reservation.updated_at = time.time()
                reservation_id = reservation.reservation_id
        if reservation_id and self._position_store and hasattr(self._position_store, "bind_exit_reservation"):
            self._position_store.bind_exit_reservation(
                reservation_id,
                order_id=order_id,
                perm_id=perm_id,
            )

    def _release_exit_reservation(
        self,
        *,
        token: Optional[int] = None,
        order_id: Optional[int] = None,
        strategy_id: Optional[str] = None,
        release_reason: str = "released",
    ) -> None:
        doomed: List[ExitReservation] = []
        with self._exit_reservations_lock:
            for reservation_token, reservation in self._exit_reservations.items():
                if token is not None and reservation_token == token:
                    doomed.append(reservation)
                elif order_id is not None and reservation.order_id == order_id:
                    doomed.append(reservation)
                elif strategy_id and reservation.strategy_id == strategy_id:
                    doomed.append(reservation)
            for reservation in doomed:
                self._exit_reservations.pop(reservation.token, None)
        if self._position_store and hasattr(self._position_store, "release_exit_reservation"):
            for reservation in doomed:
                self._position_store.release_exit_reservation(
                    reservation_id=reservation.reservation_id,
                    release_reason=release_reason,
                )

    def _sync_exit_reservation(
        self,
        order_id: int,
        *,
        remaining: Optional[float],
        status: str,
        perm_id: int = 0,
    ) -> None:
        release_reason = status.lower() if status else "released"
        with self._exit_reservations_lock:
            for reservation in self._exit_reservations.values():
                if reservation.order_id != order_id:
                    continue
                if perm_id:
                    reservation.perm_id = int(perm_id)
                if status in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
                    reservation.reserved_qty = 0
                    reservation.status = status or "released"
                    reservation.release_reason = release_reason
                elif remaining is not None:
                    reservation.reserved_qty = max(0, int(round(float(remaining) or 0.0)))
                    reservation.status = "working"
                reservation.updated_at = time.time()
                break
        if self._position_store and hasattr(self._position_store, "sync_exit_reservation"):
            self._position_store.sync_exit_reservation(
                order_id=order_id,
                remaining=remaining,
                status=status,
                perm_id=perm_id,
            )
        if status in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
            self._release_exit_reservation(order_id=order_id, release_reason=release_reason)

    def reconcile_exit_reservations(self, ib_open_orders: list) -> dict:
        """Reconcile persisted exit reservations against broker open orders."""
        report = {
            "matched": [],
            "released": [],
            "ambiguous": [],
            "shrunk": [],
        }
        self._update_broker_open_orders_book(ib_open_orders or [])
        open_by_order_id = {}
        open_by_perm_id = {}
        for order in ib_open_orders or []:
            if order.get("orderId"):
                open_by_order_id[int(order["orderId"])] = order
            if order.get("permId"):
                open_by_perm_id[int(order["permId"])] = order

        with self._exit_reservations_lock:
            reservations = list(self._exit_reservations.values())

        for reservation in reservations:
            broker_order = None
            if reservation.order_id and reservation.order_id in open_by_order_id:
                broker_order = open_by_order_id[reservation.order_id]
            elif reservation.perm_id and reservation.perm_id in open_by_perm_id:
                broker_order = open_by_perm_id[reservation.perm_id]
            if broker_order:
                status = (
                    (broker_order.get("_lastStatus", {}) or {}).get("status")
                    or (broker_order.get("orderState", {}) or {}).get("status")
                    or "Submitted"
                )
                remaining = (broker_order.get("_lastStatus", {}) or {}).get("remaining")
                if remaining is None:
                    remaining = (broker_order.get("order", {}) or {}).get("totalQuantity")
                old_qty = reservation.reserved_qty
                self._sync_exit_reservation(
                    reservation.order_id or int(broker_order.get("orderId") or 0),
                    remaining=remaining,
                    status=status,
                    perm_id=int(broker_order.get("permId") or reservation.perm_id or 0),
                )
                report["matched"].append(reservation.reservation_id)
                if remaining is not None and int(round(float(remaining or 0))) != old_qty:
                    report["shrunk"].append(reservation.reservation_id)
            else:
                contract_open_orders = self._get_broker_open_orders(reservation.contract_key)
                working_qty = int(round(float((contract_open_orders or {}).get("working_open_order_qty") or 0)))
                if working_qty <= 0:
                    self._release_exit_reservation(
                        token=reservation.token,
                        release_reason="broker_open_order_missing",
                    )
                    report["released"].append(reservation.reservation_id)
                else:
                    with self._exit_reservations_lock:
                        current = self._exit_reservations.get(reservation.token)
                        if current:
                            current.status = "ambiguous"
                            current.updated_at = time.time()
                    if self._position_store and hasattr(self._position_store, "create_exit_reservation"):
                        # Upsert the ambiguous state for operator visibility.
                        self._position_store.create_exit_reservation(
                            reservation_id=reservation.reservation_id,
                            strategy_id=reservation.strategy_id,
                            contract_key=reservation.contract_key,
                            reserved_qty=reservation.reserved_qty,
                            source=reservation.source,
                            order_id=reservation.order_id or 0,
                            perm_id=reservation.perm_id,
                            status="ambiguous",
                        )
                    report["ambiguous"].append(reservation.reservation_id)
        return report

    def _managed_contracts_status(self) -> list:
        active_positions = self._active_store_positions_by_contract()
        managed_qty = self._managed_qty_by_contract()
        with self._broker_positions_lock:
            broker_positions = {
                key: dict(value) for key, value in self._broker_positions.items()
            }
        with self._broker_open_orders_lock:
            broker_open_orders = {
                key: dict(value) for key, value in self._broker_open_orders.items()
            }
        with self._managed_contract_issues_lock:
            issues = {
                key: dict(value) for key, value in self._managed_contract_issues.items()
            }
        keys = set(active_positions) | set(broker_positions) | set(issues) | set(broker_open_orders)
        results = []
        now = time.time()
        for key in sorted(keys, key=self._format_contract_key):
            broker = broker_positions.get(key)
            issue = issues.get(key)
            open_orders = broker_open_orders.get(key)
            reservation_state = self._reservation_issue_state(key)
            issue_state = issue.get("status") if issue else None
            if issue_state is None and reservation_state in {"ambiguous", "recovery_pending", "reservation_ambiguous"}:
                issue_state = "reservation_ambiguous"
            results.append({
                "contract_key": self._format_contract_key(key),
                "instrument": {
                    "symbol": key[0],
                    "strike": key[1],
                    "expiry": key[2],
                    "right": key[3],
                },
                "active_position_ids": [pos["id"] for pos in active_positions.get(key, [])],
                "active_position_count": len(active_positions.get(key, [])),
                "managed_qty": int(managed_qty.get(key, 0)),
                "broker_qty": int(broker.get("qty", 0)) if broker else None,
                "broker_accounts": broker.get("accounts", []) if broker else [],
                "broker_snapshot_age_ms": (
                    int((now - broker.get("updated_at", now)) * 1000)
                    if broker else None
                ),
                "reserved_exit_qty": self._reserved_exit_qty(key),
                "working_open_order_qty": int(open_orders.get("working_open_order_qty", 0)) if open_orders else 0,
                "reservation_state": reservation_state or "none",
                "issue_state": issue_state or "ok",
                "fail_closed": bool(issue_state in {"duplicate_active_positions", "reservation_ambiguous"}),
                "status": issue_state or "ok",
                "message": issue.get("message", "") if issue else "",
                "position_ids": issue.get("position_ids", []) if issue else [],
            })
        return results

    def _prepare_exit_action(
        self,
        state: StrategyState,
        action: OrderAction,
    ) -> Optional[int]:
        contract_key = self._normalize_contract_key(action.contract_dict)
        contract_label = self._format_contract_key(contract_key)
        issue = self._get_managed_contract_issue(contract_key)
        if issue:
            reason = issue.get("message") or (
                f"Exit blocked for {contract_label}: duplicate active managed positions"
            )
            state.errors.append(reason)
            try:
                state.strategy.on_order_dead(None, reason, state.config)
            except Exception as exc:
                logger.error("Strategy %s on_order_dead error: %s", state.strategy_id, exc)
            logger.error(
                "Fail-closed exit block for %s (%s): %s",
                state.strategy_id, contract_label, reason,
            )
            return None

        reservation_state = self._reservation_issue_state(contract_key)
        if reservation_state == "reservation_ambiguous":
            reason = (
                f"Exit blocked for {contract_label}: reservation state is ambiguous "
                "after restart/reconciliation"
            )
            state.errors.append(reason)
            logger.error(reason)
            return None

        broker_position = self._get_broker_position(contract_key)
        broker_qty = None
        source = "broker_snapshot"
        if broker_position is not None:
            broker_qty = int(round(float(broker_position.get("qty", 0) or 0)))
        else:
            source = "strategy_runtime"
            broker_qty = int(getattr(state.strategy, "remaining_qty", 0) or 0)

        reserved_qty = self._reserved_exit_qty(contract_key)
        available_qty = max(0, broker_qty - reserved_qty)
        if available_qty <= 0:
            reason = (
                f"Exit blocked for {contract_label}: broker_qty={broker_qty}, "
                f"reserved={reserved_qty}, requested={action.quantity}"
            )
            state.errors.append(reason)
            try:
                state.strategy.on_order_dead(None, reason, state.config)
            except Exception as exc:
                logger.error("Strategy %s on_order_dead error: %s", state.strategy_id, exc)
            logger.warning(reason)
            return None

        requested_qty = max(0, int(action.quantity))
        approved_qty = min(requested_qty, available_qty)
        if approved_qty <= 0:
            return None
        if approved_qty < requested_qty:
            logger.warning(
                "Clamped exit for %s on %s: requested=%d approved=%d "
                "(broker_qty=%d reserved=%d source=%s)",
                state.strategy_id,
                contract_label,
                requested_qty,
                approved_qty,
                broker_qty,
                reserved_qty,
                source,
            )
        action.quantity = approved_qty
        return self._create_exit_reservation(
            state.strategy_id,
            contract_key,
            approved_qty,
            source,
        )

    def _record_dead_order(
        self,
        order_id: int,
        strategy_id: str,
        state: Optional[StrategyState],
        status: str,
        reason: str,
        active: Optional[ActiveOrder],
    ) -> None:
        ticker = ""
        if state and state.ticker:
            ticker = state.ticker
        elif active and active.contract_dict:
            ticker = str(active.contract_dict.get("symbol") or "").upper()
        elif state and isinstance(state.config, dict):
            inst = state.config.get("instrument") or {}
            ticker = str(inst.get("symbol") or "").upper()

        record = DeadOrderRecord(
            order_id=order_id,
            strategy_id=strategy_id,
            ticker=ticker,
            status=status,
            reason=reason,
            error_code=active.error_code if active else None,
            error_string=active.error_string if active else "",
            warning_text=active.warning_text if active else "",
            why_held=active.why_held if active else "",
            advanced_order_reject_json=active.advanced_order_reject_json if active else "",
            perm_id=active.perm_id if active else 0,
            filled=active.filled if active else 0.0,
            remaining=active.remaining if active else 0.0,
            is_entry=active.is_entry if active is not None else True,
            placed_at=active.placed_at if active else 0.0,
            dead_at=time.time(),
        )
        with self._recent_dead_orders_lock:
            self._recent_dead_orders.append(record)
            if len(self._recent_dead_orders) > 25:
                self._recent_dead_orders = self._recent_dead_orders[-25:]

    def _mark_order_terminal(self, order_id: int) -> None:
        now = time.time()
        cutoff = now - self.RECENT_TERMINAL_ORDER_TTL_SEC
        with self._recent_terminal_orders_lock:
            self._recent_terminal_orders[order_id] = now
            stale = [
                oid for oid, ts in self._recent_terminal_orders.items()
                if ts < cutoff
            ]
            for oid in stale:
                self._recent_terminal_orders.pop(oid, None)

    def _was_order_recently_terminal(self, order_id: int) -> bool:
        now = time.time()
        cutoff = now - self.RECENT_TERMINAL_ORDER_TTL_SEC
        with self._recent_terminal_orders_lock:
            stale = [
                oid for oid, ts in self._recent_terminal_orders.items()
                if ts < cutoff
            ]
            for oid in stale:
                self._recent_terminal_orders.pop(oid, None)
            return order_id in self._recent_terminal_orders

    def set_global_entry_cap(self, cap: int) -> dict:
        """Set the global entry cap. Called by operator via UI/API.

        Args:
            cap: -1 for unlimited, 0 to halt, N>0 for exactly N entries.
        Returns:
            Status dict with new cap value.
        """
        with self._entry_cap_lock:
            self._global_entry_cap = cap
        logger.info("Global entry cap set to %s (total entries lifetime: %d)",
                     "UNLIMITED" if cap == -1 else cap,
                     self._total_entries_placed)
        return {
            "global_entry_cap": cap,
            "total_entries_placed": self._total_entries_placed,
            # Backward-compatible aliases
            "order_budget": cap,
            "total_algo_orders": self._total_entries_placed,
        }

    def set_order_budget(self, budget: int) -> dict:
        """Backward-compatible alias for set_global_entry_cap."""
        return self.set_global_entry_cap(budget)

    def get_order_budget(self) -> int:
        """Return current global entry cap (backward-compatible name)."""
        with self._entry_cap_lock:
            return self._global_entry_cap

    def set_ticker_budget(self, strategy_id: str, budget: int) -> dict:
        """Set the per-ticker entry budget for a strategy.

        Args:
            strategy_id: The strategy to configure.
            budget: -1 for unlimited, 0 to halt, N>0 for exactly N entries.
        """
        state = self._strategies.get(strategy_id)
        if not state:
            return {"error": f"Strategy {strategy_id} not found"}
        with self._lock:
            state.ticker_entry_budget = budget
        return {
            "strategy_id": strategy_id,
            "ticker": state.ticker,
            "ticker_entry_budget": budget,
            "ticker_entries_placed": state.ticker_entries_placed,
        }

    def get_budget_status(self) -> dict:
        """Return full budget state for dashboard display."""
        current_exposure = self._compute_current_exposure()
        result = {
            "global_entry_cap": self._global_entry_cap,
            "total_entries_placed": self._total_entries_placed,
            "inflight_orders": self._inflight_order_count,
            "risk_budget_usd": self._risk_budget_usd,
            "current_exposure_usd": round(current_exposure, 2),
            "risk_headroom_usd": (
                round(max(0, self._risk_budget_usd - current_exposure), 2)
                if self._risk_budget_usd > 0 else -1
            ),
            "tickers": {},
        }
        for sid, state in self._strategies.items():
            if state.ticker:  # skip risk managers (no ticker)
                result["tickers"][sid] = {
                    "strategy_id": sid,
                    "ticker": state.ticker,
                    "ticker_entry_budget": state.ticker_entry_budget,
                    "ticker_entries_placed": state.ticker_entries_placed,
                    "is_active": state.is_active,
                }
        result["ticker_modes"] = self.get_all_ticker_modes()
        return result

    # ── Per-Ticker Trade Modes ──

    def set_ticker_mode(self, ticker: str, mode: TickerMode) -> dict:
        """Set the trade mode for a ticker. Returns status dict.

        On transition to NO_ORDERS, all working algo orders for that ticker
        are cancelled immediately.
        """
        old_mode = self._ticker_modes.get(ticker, TickerMode.NORMAL)
        self._ticker_modes[ticker] = mode
        logger.info("Ticker mode %s: %s -> %s", ticker, old_mode.value, mode.value)
        result = {"ticker": ticker, "mode": mode.value, "old_mode": old_mode.value}

        # On transition to NO_ORDERS, cancel all working algo orders for this ticker
        if mode == TickerMode.NO_ORDERS and old_mode != TickerMode.NO_ORDERS:
            cancelled = self._cancel_ticker_algo_orders(ticker)
            result["orders_cancelled"] = cancelled

        return result

    def get_ticker_mode(self, ticker: str) -> TickerMode:
        """Return the current trade mode for a ticker (default: NORMAL)."""
        return self._ticker_modes.get(ticker, TickerMode.NORMAL)

    def get_all_ticker_modes(self) -> dict:
        """Return all non-default ticker modes as {ticker: mode_name}."""
        return {t: m.value for t, m in self._ticker_modes.items()}

    def _cancel_ticker_algo_orders(self, ticker: str) -> int:
        """Cancel all active algo working orders for a ticker. Returns count cancelled.

        Matches both direct strategies (state.ticker == ticker) and risk managers
        whose parent strategy trades this ticker.
        """
        cancelled = 0
        with self._active_orders_lock:
            for oid, ao in list(self._active_orders.items()):
                if ao.status in ("Submitted", "PreSubmitted"):
                    state = self._strategies.get(ao.strategy_id)
                    if not state:
                        continue
                    # Direct ticker match (works for both entry strategies and
                    # risk managers that have state.ticker set)
                    order_ticker = state.ticker or ""
                    # Fallback for risk managers without state.ticker set:
                    # resolve from parent strategy, then from contract instrument
                    if not order_ticker and state.strategy_id.startswith("bmc_risk_"):
                        parent_id = (
                            getattr(state.strategy, '_parent_strategy_id', None)
                            or state.config.get('_parent_strategy_id', '')
                        )
                        if parent_id:
                            parent_state = self._strategies.get(parent_id)
                            if parent_state:
                                order_ticker = parent_state.ticker or ""
                        if not order_ticker:
                            order_ticker = (
                                state.config.get("instrument", {}).get("symbol", "").upper()
                            )
                    if order_ticker == ticker:
                        try:
                            self._scanner.cancelOrder(oid)
                            cancelled += 1
                            logger.info("Cancelled order %d for ticker %s (mode=NO_ORDERS)", oid, ticker)
                        except Exception as e:
                            logger.error("Failed to cancel order %d: %s", oid, e)
        return cancelled

    def restore_ticker_modes(self, modes: dict) -> None:
        """Restore ticker modes from persisted config (auto-restart)."""
        for ticker, mode_str in modes.items():
            try:
                self._ticker_modes[ticker] = TickerMode(mode_str)
            except ValueError:
                logger.warning("Unknown ticker mode '%s' for %s, defaulting to NORMAL", mode_str, ticker)
        if self._ticker_modes:
            logger.info("Restored ticker modes: %s", self.get_all_ticker_modes())

    def get_risk_managers_for_parent(self, parent_strategy_id: str) -> list:
        """Return all active risk manager strategies whose parent matches.

        Returns list of (strategy_id, StrategyState) tuples.
        """
        result = []
        for sid, state in self._strategies.items():
            if not sid.startswith("bmc_risk_"):
                continue
            rm = state.strategy
            parent = getattr(rm, '_parent_strategy_id', None) or state.config.get('_parent_strategy_id', '')
            if parent == parent_strategy_id:
                result.append((sid, state))
        return result

    def _consume_entry_cap(self) -> bool:
        """Try to consume one unit of global entry cap. Returns True if allowed."""
        with self._entry_cap_lock:
            if self._global_entry_cap == -1:
                self._total_entries_placed += 1
                return True  # unlimited
            if self._global_entry_cap <= 0:
                return False  # exhausted
            self._global_entry_cap -= 1
            self._total_entries_placed += 1
            remaining = self._global_entry_cap
        logger.info("Global entry cap consumed: %d remaining", remaining)
        return True

    def _refund_entry_cap(self):
        """Refund one unit of global entry cap (used when Gates 2-4 reject an entry)."""
        with self._entry_cap_lock:
            if self._global_entry_cap >= 0:  # don't refund unlimited
                self._global_entry_cap += 1
            self._total_entries_placed = max(0, self._total_entries_placed - 1)

    def _refund_ticker_budget(self, state: "StrategyState"):
        """Refund one unit of per-ticker budget (used when later gates reject)."""
        if state.ticker_entry_budget >= 0:
            state.ticker_entry_budget += 1
        state.ticker_entries_placed = max(0, state.ticker_entries_placed - 1)

    # ── Risk Budget (total dollar exposure cap) ──

    def set_risk_budget(self, budget_usd: float) -> dict:
        """Set the total dollar exposure cap. 0 = disabled (no limit).

        When enabled, new entries are rejected if total active position
        exposure (entry_price × remaining_qty × multiplier) plus the
        new entry cost would exceed the budget.

        Args:
            budget_usd: Maximum total dollar exposure allowed. 0 to disable.
        Returns:
            Status dict with exposure snapshot.
        """
        self._risk_budget_usd = max(0.0, float(budget_usd))
        current = self._compute_current_exposure()
        logger.info(
            "Risk budget set to $%.0f (current exposure: $%.0f, headroom: $%.0f)",
            self._risk_budget_usd,
            current,
            max(0, self._risk_budget_usd - current) if self._risk_budget_usd > 0 else float("inf"),
        )
        return {
            "risk_budget_usd": self._risk_budget_usd,
            "current_exposure_usd": round(current, 2),
            "headroom_usd": round(max(0, self._risk_budget_usd - current), 2) if self._risk_budget_usd > 0 else -1,
        }

    def _compute_current_exposure(self) -> float:
        """Sum notional exposure of all active risk manager positions.

        exposure = entry_price × remaining_qty × multiplier
        for every non-completed bmc_risk_* strategy.
        """
        total = 0.0
        for sid, state in self._strategies.items():
            if not sid.startswith("bmc_risk_"):
                continue
            rm = state.strategy
            if getattr(rm, "_completed", True) or getattr(rm, "remaining_qty", 0) <= 0:
                continue
            entry_price = getattr(rm, "entry_price", 0)
            remaining = getattr(rm, "remaining_qty", 0)
            multiplier = float(state.config.get("instrument", {}).get("multiplier", 100))
            total += entry_price * remaining * multiplier
        return total

    # ── Reconnect hold ──

    def set_reconnect_hold(self, hold: bool):
        """Set or clear the reconnect hold flag.

        When True, the eval loop skips all strategy evaluation and Gate 4
        rejects all orders.  The agent sets this BEFORE calling connect_to_ib()
        and clears it AFTER post-reconnect reconciliation finishes, ensuring
        no orders are placed with a stale position view.
        """
        self._reconnect_hold = hold
        if hold:
            logger.info("Reconnect hold ENGAGED — eval loop paused until reconciliation")
        else:
            logger.info("Reconnect hold RELEASED — eval loop resuming")

    # ── Flip-flop detection ──

    def _check_flipflop(self, strategy_id: str) -> bool:
        """Returns True if the strategy is flip-flopping (too many orders in window).
        Does NOT block the eval thread -- just a timestamp list check."""
        now = time.time()
        cutoff = now - self.FLIPFLOP_WINDOW_SEC
        timestamps = self._order_timestamps.get(strategy_id, [])
        # Prune old entries
        timestamps = [t for t in timestamps if t > cutoff]
        self._order_timestamps[strategy_id] = timestamps
        if len(timestamps) >= self.FLIPFLOP_MAX_ORDERS:
            return True  # flip-flopping
        return False

    def _record_order_submission(self, strategy_id: str):
        """Record an order submission timestamp for flip-flop detection."""
        now = time.time()
        if strategy_id not in self._order_timestamps:
            self._order_timestamps[strategy_id] = []
        self._order_timestamps[strategy_id].append(now)

    # ── Order status listener (called from IB message thread) ──

    def on_scanner_order_status(self, order_id: int, status_data: dict):
        """Listener registered on the scanner. Fires on IB message thread.

        Does minimal work: checks if this is our order, enqueues for
        processing on the eval thread. This keeps the IB message thread
        unblocked.
        """
        if order_id in self._order_strategy_map:
            self._order_event_queue.put(("status", order_id, status_data))

    def on_scanner_exec_details(self, order_id: int, exec_data: dict):
        """Listener for execDetails and commissionReport callbacks.

        Commission reports arrive with order_id=0 (IB only provides exec_id).
        We allow them through unconditionally so the engine can route them
        via the _exec_id_to_position map.
        """
        if exec_data.get("_commission_report"):
            # Commission report: always enqueue (order_id=0)
            self._order_event_queue.put(("commission", order_id, exec_data))
        elif order_id in self._order_strategy_map:
            self._order_event_queue.put(("exec", order_id, exec_data))

    # ── Lifecycle ──

    def start(self):
        """Start the evaluation loop thread."""
        if self._running:
            logger.warning("ExecutionEngine already running")
            return
        if not self._strategies:
            logger.warning("ExecutionEngine has no strategies loaded -- starting anyway")

        # Register order status listener on scanner
        self._scanner.add_order_status_listener(self.on_scanner_order_status)
        self._scanner.add_exec_details_listener(self.on_scanner_exec_details)
        self._restore_exit_reservations_from_store()

        self._running = True
        self._tick_count = 0
        self._thread = threading.Thread(target=self._evaluation_loop, daemon=True, name="exec-engine")
        self._thread.start()
        logger.info("ExecutionEngine started (eval_interval=%.3fs, strategies=%d, global_entry_cap=%s)",
                     self._eval_interval, len(self._strategies),
                     "UNLIMITED" if self._global_entry_cap == -1 else self._global_entry_cap)

    def stop(self):
        """Stop the evaluation loop, cancel working orders, drain in-flight, clean up.

        Shutdown sequence:
        1. Signal eval loop to stop (self._running = False)
        2. Cancel all working IB orders
        3. Drain the order executor -- let in-flight orders complete
        4. Notify strategies of shutdown
        5. Unsubscribe streaming quotes and clear state
        6. Drain event queue
        7. Remove scanner listeners
        """
        if not self._running:
            return
        self._running = False

        # 1. Wait for eval loop to finish its current iteration
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

        # 2. Cancel all working orders in IB before draining executor
        with self._active_orders_lock:
            working = [(oid, ao) for oid, ao in self._active_orders.items()
                       if ao.status in ("Submitted", "PreSubmitted")]
        for order_id, ao in working:
            logger.info("Cancelling working order %d for %s before shutdown", order_id, ao.strategy_id)
            try:
                self._scanner.cancelOrder(order_id)
            except Exception as e:
                logger.error("Failed to cancel order %d on shutdown: %s", order_id, e)

        # 3. Drain order executor -- wait for in-flight orders to complete.
        #    New submissions won't happen because the eval loop has stopped.
        inflight = self._inflight_order_count
        if inflight > 0:
            logger.info("Waiting for %d in-flight orders to complete...", inflight)
        self._order_executor.shutdown(wait=True)
        # Re-create the executor so the engine can be started again
        self._order_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="order-exec",
        )
        self._inflight_order_count = 0

        # 4. Notify all strategies of shutdown
        for state in self._strategies.values():
            try:
                state.strategy.on_stop(state.config)
            except Exception as e:
                logger.error("Error in strategy %s on_stop: %s", state.strategy_id, e)

        # 5. Unsubscribe all streaming quotes and clear state
        self._cache.unsubscribe_all(self._scanner)
        self._strategies.clear()
        self._order_strategy_map.clear()
        with self._active_orders_lock:
            self._active_orders.clear()
        self._order_timestamps.clear()
        self._order_exec_ids.clear()
        self._exec_id_to_position.clear()
        self._order_exec_details.clear()
        self._order_position_ids.clear()
        with self._recent_terminal_orders_lock:
            self._recent_terminal_orders.clear()
        with self._broker_positions_lock:
            self._broker_positions.clear()
        with self._broker_open_orders_lock:
            self._broker_open_orders.clear()
        with self._managed_contract_issues_lock:
            self._managed_contract_issues.clear()
        with self._exit_reservations_lock:
            self._exit_reservations.clear()
            self._next_exit_reservation_token = 1
        # Phase 0 instrumentation maps
        self._order_pre_trade_snapshots.clear()
        self._order_contract_dicts.clear()
        self._order_routing_exchanges.clear()

        # 6. Drain event queue
        while not self._order_event_queue.empty():
            try:
                self._order_event_queue.get_nowait()
            except queue.Empty:
                break

        # 7. Remove scanner listeners
        self._scanner.remove_order_status_listener(self.on_scanner_order_status)
        self._scanner.remove_exec_details_listener(self.on_scanner_exec_details)

        logger.info("ExecutionEngine stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    # ── Strategy management ──

    def load_strategy(self, strategy_id: str, strategy: ExecutionStrategy, config: dict) -> dict:
        """Load and start a strategy.

        Returns a status dict with subscription info or error.
        """
        if strategy_id in self._strategies:
            return {"error": f"Strategy {strategy_id} is already loaded"}

        # Get subscriptions from the strategy
        try:
            sub_specs = strategy.get_subscriptions(config)
        except Exception as e:
            logger.error("Strategy %s get_subscriptions failed: %s", strategy_id, e)
            return {"error": f"get_subscriptions failed: {e}"}

        # Open streaming subscriptions
        from ibapi.contract import Contract as IBContract
        cache_keys = []
        for spec in sub_specs:
            cache_key = spec["cache_key"]
            contract_fields = spec["contract"]
            generic_ticks = spec.get("generic_ticks", "100,101,104,106")

            contract = IBContract()
            contract.symbol = contract_fields.get("symbol", "")
            contract.secType = contract_fields.get("secType", "STK")
            contract.exchange = contract_fields.get("exchange", "SMART")
            contract.currency = contract_fields.get("currency", "USD")
            if contract_fields.get("lastTradeDateOrContractMonth"):
                contract.lastTradeDateOrContractMonth = contract_fields["lastTradeDateOrContractMonth"]
            if contract_fields.get("strike"):
                contract.strike = float(contract_fields["strike"])
            if contract_fields.get("right"):
                contract.right = contract_fields["right"]
            if contract_fields.get("multiplier"):
                contract.multiplier = contract_fields["multiplier"]
            if contract_fields.get("conId"):
                contract.conId = int(contract_fields["conId"])

            req_id = self._cache.subscribe(self._scanner, contract, cache_key, generic_ticks)
            if req_id is None:
                # Failed to subscribe -- roll back previous subs
                for prev_key in cache_keys:
                    self._cache.unsubscribe(self._scanner, prev_key)
                return {"error": f"Insufficient market data lines for {cache_key}"}
            cache_keys.append(cache_key)

        # Register strategy state
        state = StrategyState(
            strategy_id=strategy_id,
            strategy=strategy,
            config=config,
            subscriptions=cache_keys,
        )
        self._strategies[strategy_id] = state

        # Notify strategy
        try:
            strategy.on_start(config)
        except Exception as e:
            logger.error("Strategy %s on_start failed: %s", strategy_id, e)

        logger.info("Loaded strategy %s with %d subscriptions: %s",
                     strategy_id, len(cache_keys), cache_keys)
        return {
            "strategy_id": strategy_id,
            "subscriptions": cache_keys,
            "lines_held": self._resource_manager.execution_lines_held,
        }

    def unload_strategy(self, strategy_id: str) -> dict:
        """Stop and remove a strategy, freeing its streaming subscriptions."""
        state = self._strategies.pop(strategy_id, None)
        if state is None:
            return {"error": f"Strategy {strategy_id} not found"}

        try:
            state.strategy.on_stop(state.config)
        except Exception as e:
            logger.error("Error in strategy %s on_stop: %s", strategy_id, e)

        for cache_key in state.subscriptions:
            self._cache.unsubscribe(self._scanner, cache_key)

        # Clean order maps
        dead_oids = [oid for oid, sid in self._order_strategy_map.items() if sid == strategy_id]
        for oid in dead_oids:
            self._order_strategy_map.pop(oid, None)
            with self._active_orders_lock:
                self._active_orders.pop(oid, None)
            self._release_exit_reservation(order_id=oid, release_reason="strategy_unloaded")
        self._order_timestamps.pop(strategy_id, None)
        self._release_exit_reservation(strategy_id=strategy_id, release_reason="strategy_unloaded")

        logger.info("Unloaded strategy %s (freed %d subscriptions)", strategy_id, len(state.subscriptions))
        return {
            "strategy_id": strategy_id,
            "subscriptions_freed": len(state.subscriptions),
            "lines_held": self._resource_manager.execution_lines_held,
        }

    def update_strategy_config(self, strategy_id: str, new_config: dict) -> dict:
        """Update configuration for a running strategy (hot reload)."""
        state = self._strategies.get(strategy_id)
        if state is None:
            return {"error": f"Strategy {strategy_id} not found"}
        # Validate config types (WS6)
        errors = []
        for key, value in new_config.items():
            if key in NUMERIC_CONFIG_KEYS and not isinstance(value, (int, float)):
                errors.append(f"{key} must be numeric, got {type(value).__name__}")
            elif key in BOOL_CONFIG_KEYS and not isinstance(value, bool):
                errors.append(f"{key} must be boolean, got {type(value).__name__}")
        if errors:
            return {"error": "; ".join(errors)}
        state.config.update(new_config)
        logger.info("Updated config for strategy %s: %s", strategy_id, list(new_config.keys()))
        return {"strategy_id": strategy_id, "config": state.config}

    # ── Evaluation loop ──

    def _evaluation_loop(self):
        """Main loop: drain order events, evaluate all strategies, place orders, repeat."""
        logger.info("Evaluation loop started")
        while self._running:
            loop_start = time.monotonic()
            try:
                # 1. Drain order event queue (fills, status changes from IB)
                self._drain_order_events()

                # 2. Lifecycle sweep (every N ticks)
                self._tick_count += 1
                if self._tick_count % self.LIFECYCLE_SWEEP_TICKS == 0:
                    self._lifecycle_sweep()

                # 3. Evaluate all strategies
                self._evaluate_all()

            except Exception as e:
                logger.error("Evaluation loop error: %s", e, exc_info=True)

            # Sleep for the remainder of the interval
            elapsed = time.monotonic() - loop_start
            sleep_time = max(0, self._eval_interval - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info("Evaluation loop stopped")

    def _drain_order_events(self):
        """Process all pending order status events from the scanner.

        Runs on the exec-engine thread. Events were enqueued by the IB
        message thread via on_scanner_order_status / on_scanner_exec_details.
        """
        events_processed = 0
        while True:
            try:
                event = self._order_event_queue.get_nowait()
            except queue.Empty:
                break

            event_type, order_id, data = event
            events_processed += 1

            # Commission events arrive with order_id=0 — route via exec_id map
            if event_type == "commission":
                cr = data.get("_commission_report", {})
                cr_exec_id = data.get("execId", "")
                position_id = self._exec_id_to_position.get(cr_exec_id)
                if position_id and cr_exec_id and self._position_store:
                    self._position_store.update_fill_commission(
                        position_id, cr_exec_id, cr
                    )
                    comm = cr.get("commission")
                    rpnl = cr.get("realized_pnl")
                    logger.info("Commission captured (event-driven) for exec %s → %s: $%s rpnl=$%s",
                                cr_exec_id, position_id,
                                f"{comm:.4f}" if comm is not None else "n/a",
                                f"{rpnl:.2f}" if rpnl is not None else "n/a")
                elif cr_exec_id:
                    logger.debug("Commission for unmapped exec %s — deferred polling will pick it up",
                                 cr_exec_id)
                continue

            strategy_id = self._order_strategy_map.get(order_id)
            if not strategy_id:
                continue
            state = self._strategies.get(strategy_id)
            if not state:
                continue

            # Update active order tracking
            with self._active_orders_lock:
                active = self._active_orders.get(order_id)

            if event_type == "status":
                status = data.get("status", "")
                filled = data.get("filled", 0.0)
                remaining = data.get("remaining", 0.0)

                # Update active order
                if active:
                    same_lifecycle = (active.filled == filled and active.status == status)
                    metadata_changed = any(
                        data.get(key) not in (None, "", getattr(active, attr))
                        for key, attr in (
                            ("warningText", "warning_text"),
                            ("whyHeld", "why_held"),
                            ("errorCode", "error_code"),
                            ("errorString", "error_string"),
                            ("advancedOrderRejectJson", "advanced_order_reject_json"),
                        )
                    )
                    # Dedup only if neither lifecycle state nor reject metadata changed
                    if same_lifecycle and not metadata_changed:
                        continue
                    active.status = status
                    active.remaining = remaining
                    active.avg_fill_price = data.get("avgFillPrice", active.avg_fill_price)
                    active.perm_id = data.get("permId", active.perm_id)
                    active.warning_text = data.get("warningText", active.warning_text)
                    active.why_held = data.get("whyHeld", active.why_held)
                    active.error_code = data.get("errorCode", active.error_code)
                    active.error_string = data.get("errorString", active.error_string)
                    active.advanced_order_reject_json = data.get(
                        "advancedOrderRejectJson", active.advanced_order_reject_json
                    )
                    active.last_update = time.time()
                    if not active.is_entry:
                        self._sync_exit_reservation(
                            order_id,
                            remaining=remaining,
                            status=status,
                            perm_id=data.get("permId", active.perm_id),
                        )

                    # Detect new fills (filled increased)
                    if filled > active.filled:
                        active.filled = filled
                        try:
                            state.strategy.on_fill(order_id, data, state.config)
                        except Exception as e:
                            logger.error("Strategy %s on_fill error: %s", strategy_id, e)
                            state.errors.append(f"on_fill error: {e}")
                        self._persist_fill(strategy_id, state, data)

                    # Detect terminal states
                    if status in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
                        if status == "Filled":
                            # Ensure we fire on_fill even if filled count matched
                            # (can happen with immediate MKT fills)
                            if active.filled == 0 and filled == 0:
                                # Edge case: IB sometimes sends Filled with filled=0
                                # for very small orders -- treat as filled
                                try:
                                    state.strategy.on_fill(order_id, data, state.config)
                                except Exception as e:
                                    logger.error("Strategy %s on_fill error: %s", strategy_id, e)
                        else:
                            # Order is dead (cancelled/inactive/rejected)
                            reason = self._build_dead_order_reason(order_id, status, active)
                            if self._should_surface_dead_order(status, active):
                                state.errors.append(reason)
                            try:
                                state.strategy.on_order_dead(order_id, reason, state.config)
                            except Exception as e:
                                logger.error("Strategy %s on_order_dead error: %s", strategy_id, e)
                            if self._should_surface_dead_order(status, active):
                                self._record_dead_order(order_id, strategy_id, state, status, reason, active)
                            # Refund entry budget for IB-side rejections (Inactive = IB
                            # rejected post-accept, e.g. margin deficit discovered async).
                            # Don't refund user-initiated cancels (Cancelled/ApiCancelled).
                            if status == "Inactive" and active.is_entry and state:
                                self._refund_entry_cap()
                                self._refund_ticker_budget(state)
                                logger.info(
                                    "Refunded entry budget for %s (IB Inactive: order %d)",
                                    strategy_id, order_id,
                                )

                        # Clean up
                        with self._active_orders_lock:
                            self._active_orders.pop(order_id, None)
                        self._order_strategy_map.pop(order_id, None)
                        self._mark_order_terminal(order_id)
                        if not active.is_entry:
                            self._release_exit_reservation(order_id=order_id, release_reason=status.lower())

                else:
                    # No active order entry yet -- create one (can happen if
                    # orderStatus fires before _on_order_complete runs)
                    is_entry = True
                    with self._exit_reservations_lock:
                        for reservation in self._exit_reservations.values():
                            if reservation.order_id == order_id:
                                is_entry = False
                                break
                    with self._active_orders_lock:
                        self._active_orders[order_id] = ActiveOrder(
                            order_id=order_id,
                            strategy_id=strategy_id,
                            status=status,
                            filled=filled,
                            remaining=remaining,
                            avg_fill_price=data.get("avgFillPrice", 0.0),
                            perm_id=data.get("permId", 0),
                            warning_text=data.get("warningText", ""),
                            why_held=data.get("whyHeld", ""),
                            error_code=data.get("errorCode"),
                            error_string=data.get("errorString", ""),
                            advanced_order_reject_json=data.get("advancedOrderRejectJson", ""),
                            placed_at=time.time(),
                            last_update=time.time(),
                            is_entry=is_entry,
                        )
                    if not is_entry:
                        self._sync_exit_reservation(
                            order_id,
                            remaining=remaining,
                            status=status,
                            perm_id=data.get("permId", 0),
                        )
                    # Process fills/terminals even for early-arriving events.
                    # Without this, a Filled event that arrives before
                    # _on_order_complete creates the ActiveOrder would be
                    # recorded but never routed to the strategy.
                    if filled > 0:
                        try:
                            state.strategy.on_fill(order_id, data, state.config)
                        except Exception as e:
                            logger.error("Strategy %s on_fill error (early): %s", strategy_id, e)
                        self._persist_fill(strategy_id, state, data)
                    if status in ("Filled", "Cancelled", "ApiCancelled", "Inactive"):
                        if status != "Filled":
                            with self._active_orders_lock:
                                active = self._active_orders.get(order_id)
                            reason = self._build_dead_order_reason(order_id, status, active)
                            if self._should_surface_dead_order(status, active):
                                state.errors.append(reason)
                            try:
                                state.strategy.on_order_dead(order_id, reason, state.config)
                            except Exception as e:
                                logger.error("Strategy %s on_order_dead error (early): %s", strategy_id, e)
                            if self._should_surface_dead_order(status, active):
                                self._record_dead_order(order_id, strategy_id, state, status, reason, active)
                        with self._active_orders_lock:
                            self._active_orders.pop(order_id, None)
                        self._order_strategy_map.pop(order_id, None)
                        self._mark_order_terminal(order_id)
                        if not is_entry:
                            self._release_exit_reservation(order_id=order_id, release_reason=status.lower())

            elif event_type == "exec":
                # execDetails: capture exec_id for commission routing
                exec_id = data.get("execId", "")
                if order_id:
                    self._order_exec_details[order_id] = dict(data or {})
                if exec_id and strategy_id:
                    self._order_exec_ids[order_id] = exec_id
                    # For entry orders on parent strategies (bmc_spy_up), the
                    # position_store position_id is the RM (bmc_risk_*), not the
                    # parent.  Prefer the RM mapping if the agent already set it
                    # (via _spawn_risk_manager_for_bmc); otherwise use strategy_id.
                    position_id = (
                        self._exec_id_to_position.get(exec_id)
                        or self._order_position_ids.get(order_id)
                        or strategy_id
                    )
                    self._exec_id_to_position[exec_id] = position_id
                    # Update the fill in position_store with the real exec_id
                    # (the fill was likely already persisted with exec_id="" from orderStatus)
                    if self._position_store:
                        match_hint = self._build_execution_match_hint(exec_data=data)
                        execution_analytics = {
                            "fill_exchange": data.get("exchange", ""),
                            "exchange": data.get("exchange", ""),
                            "last_liquidity": data.get("lastLiquidity", 0),
                            "perm_id": data.get("permId", 0),
                            "side": data.get("side", ""),
                            "account": data.get("account", ""),
                        }
                        # Try RM position first, fall back to strategy_id
                        updated = self._position_store.update_fill_execution_details(
                            position_id,
                            order_id,
                            exec_id=exec_id,
                            execution_analytics=execution_analytics,
                            match_hint=match_hint,
                        )
                        if not updated and position_id != strategy_id:
                            updated = self._position_store.update_fill_execution_details(
                                strategy_id,
                                order_id,
                                exec_id=exec_id,
                                execution_analytics=execution_analytics,
                                match_hint=match_hint,
                            )
                        if updated:
                            logger.info("Backfilled exec_id=%s on fill for order %d (%s)",
                                        exec_id, order_id, position_id)
                            # Now try deferred commission pickup with the real exec_id
                            self._order_executor.submit(
                                self._deferred_commission_update, position_id, exec_id,
                            )
                logger.info("Strategy %s execDetails for order %d: execId=%s",
                            strategy_id, order_id, data.get("execId", ""))

        if events_processed > 0:
            logger.debug("Drained %d order events", events_processed)

    def _lifecycle_sweep(self):
        """Periodic check on active orders for stale/stuck orders.
        Runs every LIFECYCLE_SWEEP_TICKS ticks (~2s).
        Warns after STALE_ORDER_WARN_SEC, auto-cancels after STALE_ORDER_CANCEL_SEC."""
        now = time.time()
        to_cancel = []
        with self._active_orders_lock:
            for order_id, active in list(self._active_orders.items()):
                age = now - active.placed_at
                since_update = now - active.last_update if active.last_update > 0 else age

                if active.status not in ("Submitted", "PreSubmitted"):
                    continue

                # Warn about stale orders
                if since_update > self.STALE_ORDER_WARN_SEC:
                    logger.warning(
                        "Stale order %d for strategy %s: status=%s, no update for %.0fs",
                        order_id, active.strategy_id, active.status, since_update,
                    )

                # Auto-cancel stale orders
                if since_update > self.STALE_ORDER_CANCEL_SEC:
                    to_cancel.append(order_id)

        # Force-GC orders stuck longer than STALE_ORDER_GC_SEC
        # (cancel was sent but IB never acknowledged — e.g. dead socket)
        to_gc = []
        with self._active_orders_lock:
            for order_id, active in list(self._active_orders.items()):
                age = now - active.placed_at
                since_update = now - active.last_update if active.last_update > 0 else age
                if (since_update > self.STALE_ORDER_GC_SEC
                        and active.status in ("Submitted", "PreSubmitted", "PendingCancel")):
                    to_gc.append((order_id, active))

        for order_id, active in to_gc:
            logger.warning(
                "Force-GC stale order %d (strategy=%s, status=%s, age=%.0fs)",
                order_id, active.strategy_id, active.status,
                now - active.placed_at,
            )
            strategy_id = self._order_strategy_map.pop(order_id, None)
            with self._active_orders_lock:
                self._active_orders.pop(order_id, None)
            sid = strategy_id or active.strategy_id
            state = self._strategies.get(sid)
            if state and state.strategy:
                try:
                    state.strategy.on_order_dead(order_id, "stale_gc_timeout", state.config)
                except Exception as e:
                    logger.error("Strategy %s on_order_dead error (GC): %s", sid, e)

        for order_id in to_cancel:
            logger.warning("Auto-cancelling stale order %d", order_id)
            try:
                self._scanner.cancelOrder(order_id)
            except Exception as e:
                logger.error("Failed to cancel stale order %d: %s", order_id, e)
            # Strategy will be notified via orderStatus -> on_order_dead path

    def _evaluate_all(self):
        """Run evaluate() on each active strategy and process resulting order actions."""
        # Check IB connection health
        if self._scanner.connection_lost:
            return  # skip evaluation when IB is disconnected
        # Hold during reconnect until reconciliation completes
        if self._reconnect_hold:
            return

        for state in list(self._strategies.values()):
            if not state.is_active:
                # Check flip-flop cooldown recovery
                if state.flipflop_resume_at > 0 and time.time() > state.flipflop_resume_at:
                    state.is_active = True
                    state.flipflop_resume_at = 0.0
                    logger.info("Strategy %s resumed after flip-flop cooldown", state.strategy_id)
                else:
                    continue
            try:
                # Gather quotes for this strategy's subscriptions
                quotes = {}
                for cache_key in state.subscriptions:
                    q = self._cache.get(cache_key)
                    if q is not None:
                        quotes[cache_key] = q

                # Evaluate
                actions = state.strategy.evaluate(quotes, state.config)
                state.last_eval_time = time.time()
                state.eval_count += 1

                # Process order actions
                for action in (actions or []):
                    self._process_order_action(state, action)

            except Exception as e:
                err_msg = f"Strategy {state.strategy_id} evaluate error: {e}"
                logger.error(err_msg, exc_info=True)
                state.errors.append(err_msg)
                # Cap error list to prevent memory leak
                if len(state.errors) > 100:
                    state.errors = state.errors[-50:]

    def _process_order_action(self, state: StrategyState, action: OrderAction):
        """Submit an OrderAction through the safety gate pipeline (non-blocking).

        Safety gates (checked in order):
        1. Entry Budget (SKIPPED for exit orders):
           a. Per-ticker budget
           b. Global entry cap (order count)
           c. Risk budget (total dollar exposure cap)
        2. Flip-flop guard -- per-strategy order rate limiter (SKIPPED for exit orders)
        3. Inflight cap -- global cap on orders awaiting TWS ack (SKIPPED for exit orders)
        4. Connection gate -- IB connectivity check

        Exit orders (is_exit=True, e.g. risk manager trailing stops) bypass
        Gates 1-3 entirely — exits protect capital and must never be blocked by
        entry budget exhaustion, flip-flop detection, or inflight congestion.

        The eval thread returns immediately; the order is placed on the
        dedicated order-exec thread.
        """
        is_entry = not action.is_exit

        # ── Gate 0: Ticker Mode ──
        ticker = state.ticker or ""
        # Fallback for risk managers spawned before ticker was set on state:
        # resolve from parent strategy or from the order's contract symbol.
        if not ticker and state.strategy_id.startswith("bmc_risk_"):
            parent_id = (
                getattr(state.strategy, '_parent_strategy_id', None)
                or state.config.get('_parent_strategy_id', '')
            )
            if parent_id:
                parent_state = self._strategies.get(parent_id)
                if parent_state:
                    ticker = parent_state.ticker or ""
            if not ticker:
                ticker = action.contract_dict.get("symbol", "").upper()
        if ticker:
            mode = self._ticker_modes.get(ticker, TickerMode.NORMAL)
            if mode == TickerMode.NO_ORDERS:
                mode_msg = f"Order rejected: ticker {ticker} in NO_ORDERS mode"
                logger.warning("NO_ORDERS mode -- rejecting %s %d x %s for strategy %s",
                               action.side.value, action.quantity,
                               action.contract_dict.get("symbol", "?"), action.strategy_id)
                state.errors.append(mode_msg)
                return
            if mode == TickerMode.EXIT_ONLY and is_entry:
                mode_msg = f"Entry rejected: ticker {ticker} in EXIT_ONLY mode"
                logger.warning("EXIT_ONLY mode -- rejecting entry %s %d x %s for strategy %s",
                               action.side.value, action.quantity,
                               action.contract_dict.get("symbol", "?"), action.strategy_id)
                state.errors.append(mode_msg)
                return

        # ── Gate 1: Entry Budget (skip for exits) ──
        if is_entry:
            # Gate 1a: Per-ticker budget
            if state.ticker_entry_budget == 0:
                budget_msg = f"Order rejected: ticker budget halted for {state.ticker or state.strategy_id}"
                logger.warning("Ticker budget halted -- rejecting %s %d x %s for strategy %s",
                               action.side.value, action.quantity,
                               action.contract_dict.get("symbol", "?"), action.strategy_id)
                state.errors.append(budget_msg)
                return
            # Consume per-ticker budget (tentative — refunded if later gates reject)
            if state.ticker_entry_budget > 0:
                state.ticker_entry_budget -= 1
            state.ticker_entries_placed += 1

            # Gate 1b: Global entry cap
            if not self._consume_entry_cap():
                # Refund ticker budget
                self._refund_ticker_budget(state)
                budget_msg = "Order rejected: global entry cap exhausted (set budget via UI to allow entries)"
                logger.warning("Global entry cap exhausted -- rejecting %s %d x %s for strategy %s",
                               action.side.value, action.quantity,
                               action.contract_dict.get("symbol", "?"), action.strategy_id)
                state.errors.append(budget_msg)
                return

            # Gate 1c: Risk budget (total dollar exposure cap)
            if self._risk_budget_usd > 0:
                # Use estimated_notional if provided (covers MKT orders where
                # limit_price is None), otherwise fall back to limit_price calc.
                if action.estimated_notional is not None and action.estimated_notional > 0:
                    new_cost = action.estimated_notional
                else:
                    est_price = action.limit_price or 0
                    multiplier = float(action.contract_dict.get("multiplier", 100))
                    new_cost = est_price * action.quantity * multiplier
                current_exposure = self._compute_current_exposure()
                if (current_exposure + new_cost) > self._risk_budget_usd:
                    self._refund_entry_cap()
                    self._refund_ticker_budget(state)
                    budget_msg = (
                        f"Risk budget exceeded: ${current_exposure:.0f} + "
                        f"${new_cost:.0f} > ${self._risk_budget_usd:.0f} limit"
                    )
                    logger.warning(
                        "Risk budget exceeded -- rejecting %s %d x %s for strategy %s "
                        "(exposure=$%.0f, new=$%.0f, limit=$%.0f)",
                        action.side.value, action.quantity,
                        action.contract_dict.get("symbol", "?"), action.strategy_id,
                        current_exposure, new_cost, self._risk_budget_usd,
                    )
                    state.errors.append(budget_msg)
                    return

        # ── Gate 2: Flip-flop guard (skip for exits — rapid exits are legitimate) ──
        if is_entry and self._check_flipflop(state.strategy_id):
            # Refund budgets since we're rejecting
            self._refund_entry_cap()
            self._refund_ticker_budget(state)
            flipflop_msg = (
                f"Flip-flop detected: strategy {state.strategy_id} submitted "
                f">={self.FLIPFLOP_MAX_ORDERS} orders in {self.FLIPFLOP_WINDOW_SEC}s "
                f"-- paused for {self.FLIPFLOP_COOLDOWN_SEC}s"
            )
            logger.warning(flipflop_msg)
            state.errors.append(flipflop_msg)
            state.is_active = False
            state.flipflop_resume_at = time.time() + self.FLIPFLOP_COOLDOWN_SEC
            return

        # ── Gate 3: Inflight cap (skip for exits — never block capital-protecting orders) ──
        with self._inflight_lock:
            if is_entry and self._inflight_order_count >= self.MAX_INFLIGHT_ORDERS:
                # Refund entry budgets
                self._refund_entry_cap()
                self._refund_ticker_budget(state)
                logger.warning(
                    "Dropping ENTRY order for strategy %s: %d orders already in-flight",
                    state.strategy_id, self._inflight_order_count,
                )
                state.errors.append(
                    f"Entry dropped: {self._inflight_order_count} in-flight (cap={self.MAX_INFLIGHT_ORDERS})"
                )
                # Notify strategy so it can re-arm the TRIGGERED level
                try:
                    state.strategy.on_order_dead(None, "inflight cap exceeded", state.config)
                except Exception as e2:
                    logger.error("Strategy %s on_order_dead error: %s", state.strategy_id, e2)
                return
            # Always increment — exits bypass the cap check but still track inflight count
            self._inflight_order_count += 1
            state.inflight_orders += 1
            state.orders_submitted += 1

        # ── Gate 4: Connection check (also blocks during reconnect hold) ──
        if self._scanner.connection_lost or self._reconnect_hold:
            with self._inflight_lock:
                self._inflight_order_count = max(0, self._inflight_order_count - 1)
                state.inflight_orders = max(0, state.inflight_orders - 1)
            if is_entry:
                self._refund_entry_cap()
                self._refund_ticker_budget(state)
            reason = "IB reconnect hold (awaiting reconciliation)" if self._reconnect_hold else "IB connection lost"
            state.errors.append(f"Order rejected: {reason}")
            return

        exit_reservation_token = None
        if not is_entry:
            exit_reservation_token = self._prepare_exit_action(state, action)
            if exit_reservation_token is None:
                with self._inflight_lock:
                    self._inflight_order_count = max(0, self._inflight_order_count - 1)
                    state.inflight_orders = max(0, state.inflight_orders - 1)
                return

        # ── Record for flip-flop tracking (entries only — exits don't count) ──
        if is_entry:
            self._record_order_submission(state.strategy_id)

        logger.info(
            "Strategy %s queuing %s: %s %d x %s @ %s (%s) [inflight=%d, budget=%s]",
            action.strategy_id, "EXIT" if action.is_exit else "ENTRY",
            action.side.value, action.quantity,
            action.contract_dict.get("symbol", "?"),
            action.limit_price or "MKT", action.reason,
            self._inflight_order_count,
            "UNL" if self._global_entry_cap == -1 else self._global_entry_cap,
        )

        order_dict = {
            "action": action.side.value,
            "totalQuantity": action.quantity,
            "orderType": action.order_type.value,
            "tif": action.tif or "DAY",
            "outsideRth": action.outside_rth,
        }
        if action.limit_price is not None and action.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT):
            order_dict["lmtPrice"] = action.limit_price
        if action.aux_price is not None and action.order_type in (OrderType.STOP, OrderType.STOP_LIMIT, OrderType.TRAIL):
            order_dict["auxPrice"] = action.aux_price

        future = self._order_executor.submit(
            self._place_order_worker,
            state.strategy_id, action.contract_dict, order_dict,
            action.pre_trade_snapshot, action.routing_exchange,
            exit_reservation_token,
        )
        _is_entry = is_entry  # capture for closure
        _pre_trade_snapshot = action.pre_trade_snapshot  # Phase 0
        _contract_dict = action.contract_dict  # Phase 0: for post-fill quote lookups
        _routing_exchange = action.routing_exchange  # Phase 0
        _exit_reservation_token = exit_reservation_token
        future.add_done_callback(
            lambda f: self._on_order_complete(
                f, state.strategy_id, _is_entry,
                pre_trade_snapshot=_pre_trade_snapshot,
                contract_dict=_contract_dict,
                routing_exchange=_routing_exchange,
                exit_reservation_token=_exit_reservation_token,
            )
        )

    def _place_order_worker(
        self, strategy_id: str, contract_dict: dict, order_dict: dict,
        pre_trade_snapshot: Optional[dict] = None,
        routing_exchange: str = "SMART",
        exit_reservation_token: Optional[int] = None,
    ) -> dict:
        """Run on the order-exec thread.  Places order and blocks until TWS ack.

        Uses pre_submit_callback to register _order_strategy_map BEFORE IB can
        fire callbacks (closes the race where fills arrive before the future's
        done-callback registers the order for event routing).

        Phase 0: Also registers pre_trade_snapshot and contract_dict in the
        pre_submit_callback so they're available for early-arriving fills.
        """
        submitted_exchange = self._contract_exchange(contract_dict)
        intended_exchange = str(routing_exchange or "").strip().upper()
        if submitted_exchange and intended_exchange and submitted_exchange != intended_exchange:
            logger.warning(
                "Routing hint %s differs from submitted contract exchange %s for %s; "
                "venue telemetry will record the submitted exchange",
                intended_exchange,
                submitted_exchange,
                strategy_id,
            )

        def _pre_register(order_id):
            self._order_strategy_map[order_id] = strategy_id
            # Phase 0: register snapshot before IB can fire fill callbacks
            if pre_trade_snapshot:
                self._order_pre_trade_snapshots[order_id] = pre_trade_snapshot
            self._order_contract_dicts[order_id] = dict(contract_dict or {})
            self._order_routing_exchanges[order_id] = submitted_exchange
            self._bind_exit_reservation(exit_reservation_token, order_id)

        return self._scanner.place_order_sync(
            contract_dict, order_dict, timeout_sec=self.ORDER_TIMEOUT_SEC,
            pre_submit_callback=_pre_register,
        )

    def _on_order_complete(
        self, future: Future, strategy_id: str, is_entry: bool = False,
        pre_trade_snapshot: Optional[dict] = None,
        contract_dict: Optional[dict] = None,
        routing_exchange: str = "SMART",
        exit_reservation_token: Optional[int] = None,
    ):
        """Callback when order placement finishes (runs on order-exec thread).

        Decrements in-flight counters, registers in active orders, logs results,
        and routes immediate fills to strategies.

        If an entry order is rejected by IB (error in result) or throws an
        exception, the entry budget consumed at Gates 1a/1b is refunded so
        the user doesn't silently lose budget capacity.
        """
        # Decrement counters
        with self._inflight_lock:
            self._inflight_order_count = max(0, self._inflight_order_count - 1)
            state = self._strategies.get(strategy_id)
            if state:
                state.inflight_orders = max(0, state.inflight_orders - 1)

        # Handle result
        try:
            result = future.result()  # won't block -- future is already done
        except Exception as e:
            logger.error("Exception placing order for strategy %s: %s", strategy_id, e)
            if state:
                state.errors.append(f"Order exception: {e}")
            # Refund entry budget — order never reached IB
            if is_entry and state:
                self._refund_entry_cap()
                self._refund_ticker_budget(state)
                logger.info("Refunded entry budget for %s (order exception)", strategy_id)
            if not is_entry:
                self._release_exit_reservation(
                    token=exit_reservation_token,
                    release_reason="order_exception",
                )
            return

        if state:
            state.orders_placed += 1

        if result.get("error"):
            logger.error("Order failed for strategy %s: %s", strategy_id, result["error"])
            if state:
                state.errors.append(f"Order error: {result['error']}")
                # Notify strategy of dead order (rejection)
                order_id = result.get("orderId")
                if order_id:
                    try:
                        state.strategy.on_order_dead(
                            order_id, f"Order rejected: {result['error']}", state.config
                        )
                    except Exception as e2:
                        logger.error("Strategy %s on_order_dead error: %s", strategy_id, e2)
                # Refund entry budget — IB rejected the order post-submission
                if is_entry:
                    self._refund_entry_cap()
                    self._refund_ticker_budget(state)
                    logger.info("Refunded entry budget for %s (IB rejection: %s)",
                                strategy_id, result["error"][:80])
            if not is_entry:
                self._release_exit_reservation(
                    order_id=result.get("orderId"),
                    token=exit_reservation_token,
                    release_reason="order_error",
                )
        else:
            order_id = result.get("orderId")
            status = result.get("status", "")
            filled = result.get("filled", 0.0)

            if order_id:
                if self._was_order_recently_terminal(order_id):
                    if not is_entry:
                        self._release_exit_reservation(
                            order_id=order_id,
                            token=exit_reservation_token,
                            release_reason="late_terminal_ack",
                        )
                    logger.info(
                        "Order %d already reached a terminal state before "
                        "_on_order_complete; skipping late registration",
                        order_id,
                    )
                    logger.info(
                        "Order placed for strategy %s: orderId=%s status=%s filled=%s (late ack ignored)",
                        strategy_id, order_id, status, filled,
                    )
                    return

                self._order_strategy_map[order_id] = strategy_id
                if not is_entry:
                    self._bind_exit_reservation(
                        exit_reservation_token,
                        order_id,
                        perm_id=result.get("permId", 0),
                    )

                # Register in active orders for lifecycle tracking.
                # IMPORTANT: Don't overwrite if _drain_order_events already
                # processed a more advanced status (e.g. Filled arrived via
                # callback before this done-callback fired). If the order was
                # already cleaned up (terminal), the recent-terminal guard
                # above returns before we get here.
                with self._active_orders_lock:
                    existing = self._active_orders.get(order_id)
                    if existing is None:
                        self._active_orders[order_id] = ActiveOrder(
                            order_id=order_id,
                            strategy_id=strategy_id,
                            status=status,
                            filled=filled,
                            remaining=result.get("remaining", 0.0),
                            avg_fill_price=result.get("avgFillPrice", 0.0),
                            perm_id=result.get("permId", 0),
                            placed_at=time.time(),
                            last_update=time.time(),
                            is_entry=is_entry,
                            warning_text=result.get("warningText", ""),
                            why_held=result.get("whyHeld", ""),
                            error_code=result.get("errorCode"),
                            error_string=result.get("errorString", ""),
                            advanced_order_reject_json=result.get("advancedOrderRejectJson", ""),
                            pre_trade_snapshot=pre_trade_snapshot,
                            contract_dict=contract_dict,
                            routing_exchange=routing_exchange,
                        )
                    # else: existing entry is more up-to-date, don't overwrite

                # Notify strategy of order placement (so it can map order_id to level)
                if state:
                    try:
                        state.strategy.on_order_placed(order_id, result, state.config)
                    except Exception as e2:
                        logger.error("Strategy %s on_order_placed error: %s", strategy_id, e2)

                # If the order filled immediately (MKT orders), notify strategy now.
                # NOTE: Do NOT call _persist_fill here — _drain_order_events will
                # persist the fill with the real order data (order_id, exec_id).
                # Persisting from both paths caused double-counted fills/P&L.
                if status == "Filled" or (filled and filled > 0):
                    if state:
                        try:
                            state.strategy.on_fill(order_id, result, state.config)
                        except Exception as e2:
                            logger.error("Strategy %s on_fill error: %s", strategy_id, e2)
                    # If fully filled, clean up
                    if status == "Filled":
                        with self._active_orders_lock:
                            self._active_orders.pop(order_id, None)
                        self._order_strategy_map.pop(order_id, None)
                        self._mark_order_terminal(order_id)
                        if not is_entry:
                            self._release_exit_reservation(
                                order_id=order_id,
                                release_reason="filled",
                            )
                elif status in ("Cancelled", "ApiCancelled", "Inactive"):
                    with self._active_orders_lock:
                        active = self._active_orders.get(order_id)
                    reason = self._build_dead_order_reason(order_id, status, active)
                    if self._should_surface_dead_order(status, active):
                        state.errors.append(reason)
                    try:
                        state.strategy.on_order_dead(order_id, reason, state.config)
                    except Exception as e2:
                        logger.error("Strategy %s on_order_dead error: %s", strategy_id, e2)
                    if self._should_surface_dead_order(status, active):
                        self._record_dead_order(order_id, strategy_id, state, status, reason, active)
                    if status == "Inactive" and is_entry and state:
                        self._refund_entry_cap()
                        self._refund_ticker_budget(state)
                        logger.info(
                            "Refunded entry budget for %s (terminal ack in _on_order_complete: order %d)",
                            strategy_id, order_id,
                        )
                    with self._active_orders_lock:
                        self._active_orders.pop(order_id, None)
                    self._order_strategy_map.pop(order_id, None)
                    self._mark_order_terminal(order_id)
                    if not is_entry:
                        self._release_exit_reservation(
                            order_id=order_id,
                            release_reason=status.lower(),
                        )
            elif not is_entry:
                self._release_exit_reservation(
                    token=exit_reservation_token,
                    release_reason="missing_order_id",
                )

            logger.info(
                "Order placed for strategy %s: orderId=%s status=%s filled=%s",
                strategy_id, order_id, status, filled,
            )

    # ── Position store persistence ──

    def _persist_fill(self, strategy_id: str, state: StrategyState, fill_data: dict):
        """Persist fill + runtime state to position store for bmc_risk_* strategies."""
        if self._position_store is None or not strategy_id.startswith("bmc_risk_"):
            return
        try:
            order_id = fill_data.get("orderId", 0)
            # orderStatus doesn't carry execId — check our execDetails map
            exec_id = fill_data.get("execId", "") or self._order_exec_ids.get(order_id, "")

            # Phase 0: retrieve pre-trade snapshot for slippage computation
            pre_trade_snapshot = self._order_pre_trade_snapshots.get(order_id)
            routing_exchange = (
                self._order_routing_exchanges.get(order_id)
                or self._contract_exchange(self._order_contract_dicts.get(order_id))
            )
            fill_price = fill_data.get("avgFillPrice", 0)
            fill_time = time.time()

            # Compute slippage and effective spread from pre-trade snapshot
            slippage = None
            effective_spread = None
            if pre_trade_snapshot and fill_price > 0:
                opt_ask = pre_trade_snapshot.get("option_ask")
                opt_mid = pre_trade_snapshot.get("option_mid")
                if opt_ask and opt_ask > 0:
                    slippage = round(fill_price - opt_ask, 6)  # negative = better than ask
                if opt_mid and opt_mid > 0:
                    effective_spread = round(2 * abs(fill_price - opt_mid), 6)

            # Build fill dict for the ledger
            fill_dict = {
                "time": fill_time,
                "order_id": order_id,
                "exec_id": exec_id,
                "level": "exit",
                "qty_filled": int(fill_data.get("filled", 0)),
                "avg_price": fill_price,
                "remaining_qty": 0,
                "pnl_pct": 0.0,
                # Execution analytics (WS3 + Phase 0 instrumentation)
                "execution_analytics": {
                    "fill_exchange": fill_data.get("exchange", ""),
                    "exchange": fill_data.get("exchange", ""),
                    "last_liquidity": fill_data.get("lastLiquidity", 0),
                    "commission": None,      # filled async from commissionReport
                    "realized_pnl_ib": None, # IB's realized P&L calculation
                    "slippage": slippage,
                    "effective_spread": effective_spread,
                    "routing_exchange": routing_exchange,
                    "pre_trade_snapshot": pre_trade_snapshot,
                },
            }
            # Try to get richer data from the strategy's fill log
            if hasattr(state.strategy, "_fill_log") and state.strategy._fill_log:
                last_fill = state.strategy._fill_log[-1]
                fill_dict.update({
                    "level": last_fill.get("level", "exit"),
                    "qty_filled": last_fill.get("qty_filled", fill_dict["qty_filled"]),
                    "avg_price": last_fill.get("avg_price", fill_dict["avg_price"]),
                    "remaining_qty": last_fill.get("remaining_qty", 0),
                    "pnl_pct": last_fill.get("pnl_pct", 0.0),
                })
            self._position_store.add_fill(strategy_id, fill_dict)

            # Map exec_id for commission routing (if we got it from execDetails)
            if exec_id:
                self._exec_id_to_position[exec_id] = strategy_id

            # Deferred commission pickup (fallback): schedule async lookup
            # Primary path is event-driven via the "commission" handler in _drain_events
            if exec_id:
                self._order_executor.submit(
                    self._deferred_commission_update, strategy_id, exec_id,
                )

            # Update runtime state
            if hasattr(state.strategy, "get_runtime_snapshot"):
                snapshot = state.strategy.get_runtime_snapshot()
                self._position_store.update_runtime_state(strategy_id, snapshot)

            # Mark closed if position fully exited
            remaining = getattr(state.strategy, "remaining_qty", None)
            if remaining is not None and remaining <= 0:
                self._position_store.mark_closed(strategy_id, exit_reason="risk_exit")

            # Phase 0: schedule post-fill adverse selection capture
            contract_d = self._order_contract_dicts.get(order_id)
            if contract_d and pre_trade_snapshot:
                fill_match_hint = self._build_execution_match_hint(
                    exec_data=fill_data,
                    fill_dict=fill_dict,
                )
                self._schedule_post_fill_capture(
                    strategy_id, order_id, contract_d,
                    fill_price, fill_time, pre_trade_snapshot,
                    routing_exchange, fill_dict, fill_match_hint,
                )

        except Exception as e:
            logger.error("Error persisting fill for %s: %s", strategy_id, e)

    # ── Phase 0: Post-fill adverse selection measurement ──

    _POST_FILL_DELAYS = [5, 30, 60]  # seconds after fill

    @staticmethod
    def _build_execution_match_hint(exec_data: Optional[dict] = None, fill_dict: Optional[dict] = None) -> dict:
        exec_data = exec_data or {}
        fill_dict = fill_dict or {}
        analytics = dict(fill_dict.get("execution_analytics") or {})
        return {
            "exec_id": exec_data.get("execId") or fill_dict.get("exec_id") or "",
            "fill_time": exec_data.get("time") or fill_dict.get("time"),
            "qty_filled": (
                exec_data.get("shares")
                if exec_data.get("shares") is not None
                else fill_dict.get("qty_filled")
            ),
            "avg_price": (
                exec_data.get("price")
                if exec_data.get("price") is not None
                else fill_dict.get("avg_price")
            ),
            "perm_id": (
                exec_data.get("permId")
                or analytics.get("perm_id")
                or fill_dict.get("perm_id")
                or fill_dict.get("permId")
            ),
            "side": (
                exec_data.get("side")
                or analytics.get("side")
                or ("BOT" if fill_dict.get("level") == "entry" else "SLD")
            ),
            "account": exec_data.get("account") or analytics.get("account") or "",
        }

    def _schedule_post_fill_capture(
        self,
        strategy_id: str,
        order_id: int,
        contract_dict: dict,
        fill_price: float,
        fill_time: float,
        pre_trade_snapshot: dict,
        routing_exchange: str,
        fill_dict: dict,
        fill_match_hint: dict,
    ):
        """Schedule timer-based quote captures at +5s/+30s/+60s after fill.

        Each timer fires on its own thread (lightweight — just a cache read +
        dict update). The 60s timer also writes the complete experiment record.

        Runs on the order-exec thread at scheduling time. Timer callbacks are
        independent threads that don't block anything.
        """
        post_fill_data = {}  # shared mutable dict — timers write, logger reads
        for delay in self._POST_FILL_DELAYS:
            t = threading.Timer(
                delay,
                self._capture_post_fill_quote,
                args=[strategy_id, order_id, contract_dict, delay, post_fill_data, dict(fill_match_hint or {})],
            )
            t.daemon = True
            t.name = f"post-fill-{order_id}-{delay}s"
            t.start()

        # Schedule experiment logger after the last capture (60s + 1s buffer)
        max_delay = max(self._POST_FILL_DELAYS)
        t_log = threading.Timer(
            max_delay + 1,
            self._write_experiment_record,
            args=[
                strategy_id, order_id, fill_price, fill_time,
                pre_trade_snapshot, routing_exchange, fill_dict, post_fill_data,
            ],
        )
        t_log.daemon = True
        t_log.name = f"experiment-log-{order_id}"
        t_log.start()

    def _capture_post_fill_quote(
        self,
        strategy_id: str,
        order_id: int,
        contract_dict: dict,
        delay_seconds: int,
        post_fill_data: dict,
        match_hint: Optional[dict] = None,
    ):
        """Capture option midpoint at a fixed delay after fill.

        Reads from the streaming quote cache (zero latency, no IB request).
        Falls back gracefully if the option is no longer streaming.
        """
        try:
            # Build cache key for this option contract
            # The streaming cache keys options by conId or by
            # "OPT:{symbol}:{expiry}:{strike}:{right}"
            con_id = contract_dict.get("conId")
            cache_key = None
            if con_id:
                cache_key = f"OPT:{con_id}"
            if not cache_key:
                sym = contract_dict.get("symbol", "")
                exp = contract_dict.get("lastTradeDateOrContractMonth", "")
                strike = contract_dict.get("strike", "")
                right = contract_dict.get("right", "")
                cache_key = f"OPT:{sym}:{exp}:{strike}:{right}"

            quote = self._cache.get(cache_key) if self._cache else None

            if quote and quote.bid > 0 and quote.ask > 0:
                mid = round((quote.bid + quote.ask) / 2, 6)
                post_fill_data[f"mid_{delay_seconds}s"] = mid
                post_fill_data[f"bid_{delay_seconds}s"] = quote.bid
                post_fill_data[f"ask_{delay_seconds}s"] = quote.ask
                post_fill_data[f"spread_{delay_seconds}s"] = round(quote.ask - quote.bid, 6)
                logger.debug(
                    "Post-fill +%ds capture for order %d: mid=$%.4f (bid=$%.4f ask=$%.4f)",
                    delay_seconds, order_id, mid, quote.bid, quote.ask,
                )
            else:
                logger.debug(
                    "Post-fill +%ds capture for order %d: no valid quote (key=%s)",
                    delay_seconds, order_id, cache_key,
                )
                post_fill_data[f"mid_{delay_seconds}s"] = None

            # Update position store with post-fill data
            if self._position_store:
                self._position_store.update_fill_post_trade(
                    strategy_id, order_id, delay_seconds, post_fill_data,
                    match_hint=match_hint,
                )
        except Exception as e:
            logger.error(
                "Post-fill +%ds capture error for order %d: %s",
                delay_seconds, order_id, e,
            )

    def _write_experiment_record(
        self,
        strategy_id: str,
        order_id: int,
        fill_price: float,
        fill_time: float,
        pre_trade_snapshot: dict,
        routing_exchange: str,
        fill_dict: dict,
        post_fill_data: dict,
    ):
        """Write complete execution experiment record after all post-fill captures."""
        try:
            from execution_experiment_logger import write_experiment_record
            write_experiment_record(
                strategy_id=strategy_id,
                order_id=order_id,
                fill_price=fill_price,
                fill_time=fill_time,
                pre_trade_snapshot=pre_trade_snapshot,
                routing_exchange=routing_exchange,
                fill_dict=fill_dict,
                post_fill_data=post_fill_data,
            )
        except Exception as e:
            logger.error("Experiment logger error for order %d: %s", order_id, e)

        # Cleanup Phase 0 maps for this order (prevent memory leak)
        self._order_pre_trade_snapshots.pop(order_id, None)
        self._order_contract_dicts.pop(order_id, None)
        self._order_routing_exchanges.pop(order_id, None)

    def _deferred_commission_update(self, position_id: str, exec_id: str, timeout: float = 5.0):
        """Wait briefly for IB commissionReport, then update fill record.

        This is a fallback path — the primary mechanism is event-driven via
        the "commission" handler in _drain_order_events.  This polling catches
        any commission reports that arrive before the exec_id → position mapping
        is established (race condition), or when the event-driven path misses.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            report = self._scanner.get_commission_report(exec_id)
            if report:
                self._position_store.update_fill_commission(position_id, exec_id, report)
                comm = report.get("commission")
                rpnl = report.get("realized_pnl")
                logger.info("Commission captured (deferred poll) for exec %s → %s: $%s rpnl=$%s",
                            exec_id, position_id,
                            f"{comm:.4f}" if comm is not None else "n/a",
                            f"{rpnl:.2f}" if rpnl is not None else "n/a")
                return
            time.sleep(0.1)
        logger.warning("No commission report for exec %s within %.1fs (position %s)",
                       exec_id, timeout, position_id)

    # ── IB Reconciliation (WS4) ──

    def reconcile_with_ib(self, ib_positions: list, ib_open_orders: list = None) -> dict:
        """Compare agent state against IB source of truth.

        Returns a report with matched, orphaned (in IB but not agent),
        stale (in agent but not IB), and adjusted (quantity mismatch) positions.
        """
        report = {
            "matched": [],
            "orphaned_ib": [],
            "stale_agent": [],
            "adjusted": [],
            "duplicate_agent": [],
            "manual_external": [],
            "reservation_reconciliation": {
                "matched": [],
                "released": [],
                "ambiguous": [],
                "shrunk": [],
            },
        }
        if not self._position_store:
            return report

        # Filter out legacy tickers
        ib_filtered = [
            p for p in ib_positions
            if p.get("contract", {}).get("symbol") not in IB_IGNORE_TICKERS
        ]

        self._update_broker_position_book(ib_filtered)
        if ib_open_orders is not None:
            report["reservation_reconciliation"] = self.reconcile_exit_reservations(ib_open_orders)
        else:
            self._update_broker_open_orders_book([])

        # Build agent position multimap and classify duplicates up front.
        store_positions = self._active_store_positions_by_contract()
        duplicate_report_by_key = {}
        for key, positions in store_positions.items():
            if len(positions) <= 1:
                continue
            duplicate_report = {
                "instrument": key,
                "contract_key": self._format_contract_key(key),
                "position_ids": [pos["id"] for pos in positions],
                "count": len(positions),
                "ib_qty": None,
            }
            duplicate_report_by_key[key] = duplicate_report
            report["duplicate_agent"].append(duplicate_report)

        # Check each IB position against agent store
        ib_keys = set()
        for ib_pos in ib_filtered:
            contract = ib_pos.get("contract", {})
            qty = ib_pos.get("position", 0)
            if qty == 0:
                continue
            key = self._normalize_contract_key(contract)
            ib_keys.add(key)
            matches = store_positions.get(key, [])
            if len(matches) > 1:
                duplicate_report = duplicate_report_by_key.get(key)
                if duplicate_report is not None:
                    duplicate_report["ib_qty"] = int(qty)
                    duplicate_report["accounts"] = sorted({
                        *duplicate_report.get("accounts", []),
                        *( [ib_pos["account"]] if ib_pos.get("account") else [] ),
                    })
                continue

            if not matches:
                report["orphaned_ib"].append({
                    "instrument": key,
                    "contract_key": self._format_contract_key(key),
                    "qty": qty,
                    "avg_cost": ib_pos.get("avgCost"),
                    "account": ib_pos.get("account", ""),
                })
                continue

            agent_pos = matches[0]
            entry = agent_pos.get("entry", {}) or {}
            runtime_state = agent_pos.get("runtime_state", {}) or {}
            lineage = agent_pos.get("lineage") or {}
            agent_qty = entry.get("quantity", 0)
            remaining = runtime_state.get("remaining_qty", agent_qty)
            agent_entry_price = float(
                runtime_state.get("entry_price")
                or entry.get("price")
                or 0.0
            )
            ib_avg_cost = float(ib_pos.get("avgCost") or 0.0)
            ib_entry_price = (ib_avg_cost / 100.0) if ib_avg_cost > 0 else 0.0
            entry_price_mismatch = (
                ib_entry_price > 0
                and abs(agent_entry_price - ib_entry_price) > 0.005
            )
            qty_mismatch = remaining != qty
            if qty_mismatch or entry_price_mismatch:
                adjustment = {
                    "position_id": agent_pos["id"],
                    "ib_qty": qty,
                    "agent_qty": remaining,
                    "agent_entry_price": agent_entry_price,
                    "ib_entry_price": ib_entry_price,
                    "orphaned_recovery": (
                        entry.get("order_id", 0) == 0
                        and not lineage
                    ),
                    "adjustment_kind": (
                        "manual_external_reduction"
                        if qty_mismatch and qty < remaining
                        else "broker_qty_increase"
                        if qty_mismatch and qty > remaining
                        else "entry_price_mismatch"
                    ),
                }
                report["adjusted"].append(adjustment)
                if qty_mismatch and qty < remaining:
                    report["manual_external"].append({
                        "position_id": agent_pos["id"],
                        "instrument": key,
                        "contract_key": self._format_contract_key(key),
                        "event": "partial_close",
                        "ib_qty": int(qty),
                        "agent_qty": int(remaining),
                    })
            report["matched"].append(key)

        # ── Auto-repair quantity mismatches (WS-E) ──
        # When IB shows a different qty than the agent, update the runtime RM
        # so subsequent exits size correctly. Toggle via RECON_AUTO_REPAIR.
        for adj in report["adjusted"]:
            position_id = adj["position_id"]
            ib_qty = adj["ib_qty"]
            agent_qty = adj["agent_qty"]
            ib_entry_price = float(adj.get("ib_entry_price") or 0.0)
            orphaned_recovery = bool(adj.get("orphaned_recovery"))
            # Find the matching risk manager strategy
            state = self._strategies.get(position_id)
            if not state or not state.strategy:
                continue
            rm = state.strategy
            if not hasattr(rm, "remaining_qty"):
                continue
            old_qty = rm.remaining_qty
            old_entry_price = float(getattr(rm, "entry_price", 0.0) or 0.0)
            rm.remaining_qty = ib_qty
            # Bump initial_qty if IB has more than we thought
            if hasattr(rm, "initial_qty") and ib_qty > rm.initial_qty:
                rm.initial_qty = ib_qty
            if ib_entry_price > 0 and hasattr(rm, "entry_price"):
                rm.entry_price = ib_entry_price
                old_hwm = float(getattr(rm, "high_water_mark", 0.0) or 0.0)
                if hasattr(rm, "high_water_mark"):
                    # Reconciliation-spawned orphan managers often start with a
                    # single synthetic lot whose entry price becomes the HWM.
                    # If IB later proves the true average entry was different,
                    # reset that synthetic HWM to the authoritative cost basis.
                    if old_hwm <= 0 or (
                        old_entry_price > 0
                        and abs(old_hwm - old_entry_price) < 1e-9
                    ):
                        rm.high_water_mark = ib_entry_price
                    else:
                        rm.high_water_mark = max(old_hwm, ib_entry_price)
            if orphaned_recovery:
                if hasattr(rm, "lifetime_opened_qty"):
                    rm.lifetime_opened_qty = max(int(getattr(rm, "lifetime_opened_qty", 0) or 0), int(ib_qty))
                lot_entries = getattr(rm, "_lot_entries", None)
                if isinstance(lot_entries, list) and len(lot_entries) == 1:
                    lot = lot_entries[0]
                    if lot.get("order_id", 0) == 0:
                        lot["quantity"] = int(ib_qty)
                        if ib_entry_price > 0:
                            lot["entry_price"] = ib_entry_price
            # Sync _completed flag with IB truth
            if hasattr(rm, "_completed"):
                if ib_qty <= 0:
                    rm._completed = True
                elif rm._completed:
                    # IB shows live position but agent thought it was done —
                    # clear _completed so evaluate() runs again
                    rm._completed = False
                    logger.warning(
                        "Reconciliation: cleared _completed flag for %s (IB shows qty=%d)",
                        position_id, ib_qty,
                    )
            adj["repaired"] = True
            adj["old_qty"] = old_qty
            adj["old_entry_price"] = old_entry_price
            logger.warning(
                "Reconciliation AUTO-REPAIR: %s qty %d -> %d, entry %.4f -> %.4f (IB authoritative)",
                position_id,
                old_qty,
                ib_qty,
                old_entry_price,
                ib_entry_price or old_entry_price,
            )
            # Persist repaired state immediately
            if self._position_store:
                entry_updates = {"quantity": int(getattr(rm, "initial_qty", ib_qty) or ib_qty)}
                if ib_entry_price > 0:
                    entry_updates["price"] = ib_entry_price
                self._position_store.update_entry(position_id, entry_updates)
                if getattr(state, "config", None) is not None:
                    state.config.setdefault("position", {})["quantity"] = entry_updates["quantity"]
                    if ib_entry_price > 0:
                        state.config["position"]["entry_price"] = ib_entry_price
                self._position_store.update_risk_config(position_id, {
                    "position": {
                        "quantity": entry_updates["quantity"],
                        "entry_price": ib_entry_price if ib_entry_price > 0 else old_entry_price,
                    }
                })
                if hasattr(rm, "get_runtime_snapshot"):
                    self._position_store.update_runtime_state(
                        position_id, rm.get_runtime_snapshot()
                    )

        # Check for agent positions not in IB
        for key, agent_positions in store_positions.items():
            if key not in ib_keys:
                for agent_pos in agent_positions:
                    report["stale_agent"].append({"position_id": agent_pos["id"], "instrument": key})
                    # Tag for annotation pipeline — position closed outside agent
                    agent_pos["annotation_hint"] = {
                        "manual_intervention": True,
                        "intervention_type": "manual_tws_exit",
                        "auto_note": "Position closed outside agent (IB reconciliation)",
                    }
                    report["manual_external"].append({
                        "position_id": agent_pos["id"],
                        "instrument": key,
                        "contract_key": self._format_contract_key(key),
                        "event": "full_close",
                        "ib_qty": 0,
                        "agent_qty": int(
                            (agent_pos.get("runtime_state", {}) or {}).get(
                                "remaining_qty",
                                (agent_pos.get("entry", {}) or {}).get("quantity", 0),
                            )
                        ),
                    })
                    self._position_store.mark_closed(agent_pos["id"], exit_reason="manual_tws_exit")
                    # Unload the risk manager strategy so it doesn't linger in the
                    # engine and appear as an orphan on the dashboard.
                    position_id = agent_pos["id"]
                    if position_id in self._strategies:
                        self.unload_strategy(position_id)
                        logger.info(
                            "Reconciliation: unloaded stale risk manager %s",
                            position_id,
                        )

        self._set_managed_contract_issues(report)
        return report

    # ── Status / telemetry ──

    def _get_position_ledger(self) -> list:
        """Active + today's positions from persistent store for dashboard blotter.

        Includes ALL active positions regardless of creation date (1DTE positions
        are created the day before they expire) plus any positions created or
        closed today for the trade log.
        """
        if not self._position_store:
            return []
        from datetime import datetime
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
        midnight = datetime.now(et).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        results = []
        for p in self._position_store.get_all_positions():
            status = p.get("status", "active")
            created_at = p.get("created_at", 0)
            closed_at = p.get("closed_at") or 0
            # Include if: (a) still active, OR (b) created today, OR (c) closed today
            if status != "active" and created_at < midnight and closed_at < midnight:
                continue
            entry = p.get("entry", {})
            lineage = p.get("lineage", {})
            # Orphan: reconciliation-spawned position (order_id 0, no model lineage)
            is_orphan = (entry.get("order_id", 0) == 0 and not lineage)
            execution_summary = {}
            if hasattr(self._position_store, "summarize_canonical_position"):
                multiplier = p.get("instrument", {}).get("multiplier", 100)
                try:
                    execution_summary = self._position_store.summarize_canonical_position(
                        p["id"],
                        multiplier=int(multiplier or 100),
                    )
                except Exception:
                    execution_summary = {}
            results.append({
                "id": p["id"],
                "status": p.get("status", "active"),
                "created_at": p.get("created_at", 0),
                "closed_at": p.get("closed_at"),
                "exit_reason": p.get("exit_reason", ""),
                "entry": entry,
                "instrument": p.get("instrument", {}),
                "risk_config": p.get("risk_config", {}),
                "runtime_state": p.get("runtime_state", {}),
                "fill_log": p.get("fill_log", []),
                "lineage": lineage,
                "parent_strategy": p.get("parent_strategy", ""),
                "is_orphan": is_orphan,
                "execution_summary": execution_summary,
            })
        return results

    def _get_exit_reservations_status(self) -> list:
        if not self._position_store or not hasattr(self._position_store, "get_active_exit_reservations"):
            return []
        try:
            return self._position_store.get_active_exit_reservations()
        except Exception:
            return []

    def _get_trade_attribution_summary(self) -> list:
        """Compute model-level P&L attribution from position store."""
        if not self._position_store:
            return []
        try:
            from trade_attribution import TradeAttribution
            ta = TradeAttribution(self._position_store)
            return ta.model_summary()
        except Exception:
            return []

    def _get_trade_attribution_session(self) -> list:
        """Compute model-level P&L attribution for today's session only."""
        if not self._position_store:
            return []
        try:
            from trade_attribution import TradeAttribution
            ta = TradeAttribution(self._position_store)
            return ta.session_summary()
        except Exception:
            return []

    def get_status(self) -> dict:
        """Return current engine status for telemetry/dashboard."""
        strategies = []
        for state in self._strategies.values():
            strat_info = {
                "strategy_id": state.strategy_id,
                "is_active": state.is_active,
                "subscriptions": state.subscriptions,
                "eval_count": state.eval_count,
                "orders_submitted": state.orders_submitted,
                "orders_placed": state.orders_placed,
                "inflight_orders": state.inflight_orders,
                "last_eval_time": state.last_eval_time,
                "recent_errors": state.errors[-5:] if state.errors else [],
                "config": state.config,
            }
            # Include strategy-specific state
            try:
                strat_info["strategy_state"] = state.strategy.get_strategy_state()
            except Exception:
                strat_info["strategy_state"] = {}
            strategies.append(strat_info)

        with self._active_orders_lock:
            active_orders_info = [
                {
                    "order_id": ao.order_id,
                    "strategy_id": ao.strategy_id,
                    "status": ao.status,
                    "filled": ao.filled,
                    "remaining": ao.remaining,
                    "avg_fill_price": ao.avg_fill_price,
                    "placed_at": ao.placed_at,
                    "last_update": ao.last_update,
                    "warning_text": ao.warning_text,
                    "why_held": ao.why_held,
                    "error_code": ao.error_code,
                    "error_string": ao.error_string,
                    "advanced_order_reject_json": ao.advanced_order_reject_json,
                }
                for ao in self._active_orders.values()
            ]
        with self._recent_dead_orders_lock:
            recent_dead_orders_info = [
                {
                    "order_id": rec.order_id,
                    "strategy_id": rec.strategy_id,
                    "ticker": rec.ticker,
                    "status": rec.status,
                    "reason": rec.reason,
                    "error_code": rec.error_code,
                    "error_string": rec.error_string,
                    "warning_text": rec.warning_text,
                    "why_held": rec.why_held,
                    "advanced_order_reject_json": rec.advanced_order_reject_json,
                    "perm_id": rec.perm_id,
                    "filled": rec.filled,
                    "remaining": rec.remaining,
                    "is_entry": rec.is_entry,
                    "placed_at": rec.placed_at,
                    "dead_at": rec.dead_at,
                }
                for rec in self._recent_dead_orders
            ]

        return {
            "running": self._running,
            "eval_interval": self._eval_interval,
            "strategy_count": len(self._strategies),
            "strategies": strategies,
            "inflight_orders_total": self._inflight_order_count,
            "max_inflight_orders": self.MAX_INFLIGHT_ORDERS,
            "lines_held": self._resource_manager.execution_lines_held,
            "available_scan_lines": self._resource_manager.available_for_scan,
            "quote_snapshot": self._cache.get_all_serialized(),
            "active_orders": active_orders_info,
            "recent_dead_orders": recent_dead_orders_info,
            # Backward-compatible aliases
            "order_budget": self._global_entry_cap,
            "total_algo_orders": self._total_entries_placed,
            # New budget structure
            "budget_status": self.get_budget_status(),
            "position_ledger": self._get_position_ledger(),
            "managed_contracts": self._managed_contracts_status(),
            "exit_reservations": self._get_exit_reservations_status(),
            "trade_attribution_summary": self._get_trade_attribution_summary(),
            "trade_attribution_session": self._get_trade_attribution_session(),
            # Connection health
            "reconnect_hold": self._reconnect_hold,
            # Engine mode: "paused" after auto-restart, "running" normally
            "engine_mode": "paused" if self._auto_restart_paused else "running",
        }

    def get_telemetry(self) -> dict:
        """Lightweight telemetry dict for periodic WebSocket reporting."""
        with self._active_orders_lock:
            active_orders_info = [
                {"order_id": ao.order_id, "strategy_id": ao.strategy_id,
                 "status": ao.status, "filled": ao.filled, "placed_at": ao.placed_at,
                 "warning_text": ao.warning_text, "why_held": ao.why_held,
                 "error_code": ao.error_code, "error_string": ao.error_string,
                 "advanced_order_reject_json": ao.advanced_order_reject_json}
                for ao in self._active_orders.values()
            ]
        with self._recent_dead_orders_lock:
            recent_dead_orders_info = [
                {
                    "order_id": rec.order_id,
                    "strategy_id": rec.strategy_id,
                    "ticker": rec.ticker,
                    "status": rec.status,
                    "reason": rec.reason,
                    "error_code": rec.error_code,
                    "error_string": rec.error_string,
                    "warning_text": rec.warning_text,
                    "why_held": rec.why_held,
                    "advanced_order_reject_json": rec.advanced_order_reject_json,
                    "perm_id": rec.perm_id,
                    "filled": rec.filled,
                    "remaining": rec.remaining,
                    "is_entry": rec.is_entry,
                    "placed_at": rec.placed_at,
                    "dead_at": rec.dead_at,
                }
                for rec in self._recent_dead_orders
            ]
        return {
            "running": self._running,
            "strategy_count": len(self._strategies),
            "strategies": [
                {
                    "strategy_id": s.strategy_id,
                    "is_active": s.is_active,
                    "eval_count": s.eval_count,
                    "orders_submitted": s.orders_submitted,
                    "orders_placed": s.orders_placed,
                    "inflight_orders": s.inflight_orders,
                    "recent_errors": s.errors[-5:] if s.errors else [],
                    "config": s.config,
                    "strategy_state": (
                        s.strategy.get_strategy_state()
                        if hasattr(s.strategy, "get_strategy_state") else {}
                    ),
                }
                for s in self._strategies.values()
            ],
            "active_orders": active_orders_info,
            "recent_dead_orders": recent_dead_orders_info,
            "inflight_orders_total": self._inflight_order_count,
            "lines_held": self._resource_manager.execution_lines_held,
            "quote_snapshot": self._cache.get_all_serialized(),
            # Backward-compatible aliases
            "order_budget": self._global_entry_cap,
            "total_algo_orders": self._total_entries_placed,
            # New budget structure
            "budget_status": self.get_budget_status(),
            "position_ledger": self._get_position_ledger(),
            "managed_contracts": self._managed_contracts_status(),
            "exit_reservations": self._get_exit_reservations_status(),
            # Trade attribution (realized P&L from closed positions)
            "trade_attribution_summary": self._get_trade_attribution_summary(),
            "trade_attribution_session": self._get_trade_attribution_session(),
            # Engine mode: "paused" after auto-restart, "running" normally
            "engine_mode": "paused" if self._auto_restart_paused else "running",
        }
