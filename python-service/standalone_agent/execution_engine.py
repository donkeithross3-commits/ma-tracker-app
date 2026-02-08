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
    reason: str = ""  # human-readable explanation for logging/audit


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
    FLIPFLOP_MAX_ORDERS = 5      # max orders per strategy in the flip-flop window
    FLIPFLOP_WINDOW_SEC = 10.0   # flip-flop detection window

    def __init__(
        self,
        scanner: "IBMergerArbScanner",
        quote_cache: "StreamingQuoteCache",
        resource_manager: "ResourceManager",
    ):
        self._scanner = scanner
        self._cache = quote_cache
        self._resource_manager = resource_manager
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

        # Order event queue: filled by scanner callbacks, drained by eval loop
        self._order_event_queue: queue.Queue = queue.Queue()

        # Non-blocking order placement: single-worker executor + inflight counter
        self._order_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="order-exec",
        )
        self._inflight_order_count = 0
        self._inflight_lock = threading.Lock()

        # ── Order Budget (lifeguard on duty) ──
        self._order_budget: int = 0       # 0 = halted, -1 = unlimited, N = exactly N more
        self._order_budget_lock = threading.Lock()
        self._total_algo_orders: int = 0  # lifetime counter (never resets)

        # ── Flip-flop detection ──
        # strategy_id -> list of submission timestamps
        self._order_timestamps: Dict[str, List[float]] = {}

        # ── Lifecycle sweep counter ──
        self._tick_count = 0

    # ── Order Budget ──

    def set_order_budget(self, budget: int) -> dict:
        """Set the order budget. Called by operator via UI/API.

        Args:
            budget: -1 for unlimited, 0 to halt, N>0 for exactly N orders.
        Returns:
            Status dict with new budget value.
        """
        with self._order_budget_lock:
            self._order_budget = budget
        logger.info("Order budget set to %s (total algo orders lifetime: %d)",
                     "UNLIMITED" if budget == -1 else budget,
                     self._total_algo_orders)
        return {
            "order_budget": budget,
            "total_algo_orders": self._total_algo_orders,
        }

    def get_order_budget(self) -> int:
        """Return current order budget."""
        with self._order_budget_lock:
            return self._order_budget

    def _consume_order_budget(self) -> bool:
        """Try to consume one unit of order budget. Returns True if allowed."""
        with self._order_budget_lock:
            if self._order_budget == -1:
                self._total_algo_orders += 1
                return True  # unlimited
            if self._order_budget <= 0:
                return False  # exhausted
            self._order_budget -= 1
            self._total_algo_orders += 1
            remaining = self._order_budget
        logger.info("Order budget consumed: %d remaining", remaining)
        return True

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
        """Listener for execDetails. Same pattern as on_scanner_order_status."""
        if order_id in self._order_strategy_map:
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

        self._running = True
        self._tick_count = 0
        self._thread = threading.Thread(target=self._evaluation_loop, daemon=True, name="exec-engine")
        self._thread.start()
        logger.info("ExecutionEngine started (eval_interval=%.3fs, strategies=%d, order_budget=%s)",
                     self._eval_interval, len(self._strategies),
                     "UNLIMITED" if self._order_budget == -1 else self._order_budget)

    def stop(self):
        """Stop the evaluation loop, drain in-flight orders, then clean up.

        Shutdown sequence:
        1. Signal eval loop to stop (self._running = False)
        2. Wait for eval thread to exit
        3. Drain the order executor -- let in-flight orders complete
        4. Notify strategies of shutdown
        5. Unsubscribe streaming quotes and clear state
        6. Remove scanner listeners
        """
        if not self._running:
            return
        self._running = False

        # 1. Wait for eval loop to finish its current iteration
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

        # 2. Drain order executor -- wait for in-flight orders to complete.
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

        # 3. Notify all strategies of shutdown
        for state in self._strategies.values():
            try:
                state.strategy.on_stop(state.config)
            except Exception as e:
                logger.error("Error in strategy %s on_stop: %s", state.strategy_id, e)

        # 4. Unsubscribe all streaming quotes and clear state
        self._cache.unsubscribe_all(self._scanner)
        self._strategies.clear()
        self._order_strategy_map.clear()
        with self._active_orders_lock:
            self._active_orders.clear()
        self._order_timestamps.clear()

        # 5. Drain event queue
        while not self._order_event_queue.empty():
            try:
                self._order_event_queue.get_nowait()
            except queue.Empty:
                break

        # 6. Remove scanner listeners
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
        self._order_timestamps.pop(strategy_id, None)

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
                    # Dedup: skip if filled hasn't changed and status is the same
                    if active.filled == filled and active.status == status:
                        continue
                    active.status = status
                    active.remaining = remaining
                    active.avg_fill_price = data.get("avgFillPrice", active.avg_fill_price)
                    active.perm_id = data.get("permId", active.perm_id)
                    active.last_update = time.time()

                    # Detect new fills (filled increased)
                    if filled > active.filled:
                        active.filled = filled
                        try:
                            state.strategy.on_fill(order_id, data, state.config)
                        except Exception as e:
                            logger.error("Strategy %s on_fill error: %s", strategy_id, e)
                            state.errors.append(f"on_fill error: {e}")

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
                            reason = f"Order {order_id} terminal: {status}"
                            try:
                                state.strategy.on_order_dead(order_id, reason, state.config)
                            except Exception as e:
                                logger.error("Strategy %s on_order_dead error: %s", strategy_id, e)

                        # Clean up
                        with self._active_orders_lock:
                            self._active_orders.pop(order_id, None)
                        self._order_strategy_map.pop(order_id, None)

                else:
                    # No active order entry yet -- create one (can happen if
                    # orderStatus fires before _on_order_complete runs)
                    with self._active_orders_lock:
                        self._active_orders[order_id] = ActiveOrder(
                            order_id=order_id,
                            strategy_id=strategy_id,
                            status=status,
                            filled=filled,
                            remaining=remaining,
                            avg_fill_price=data.get("avgFillPrice", 0.0),
                            perm_id=data.get("permId", 0),
                            placed_at=time.time(),
                            last_update=time.time(),
                        )

            elif event_type == "exec":
                # execDetails provides per-fill data (enrichment, not primary trigger)
                # We log it for audit but don't drive state off it
                logger.info("Strategy %s execDetails for order %d: %s",
                            strategy_id, order_id, data)

        if events_processed > 0:
            logger.debug("Drained %d order events", events_processed)

    def _lifecycle_sweep(self):
        """Periodic check on active orders for stale/stuck orders.
        Runs every LIFECYCLE_SWEEP_TICKS ticks (~2s)."""
        now = time.time()
        with self._active_orders_lock:
            for order_id, active in list(self._active_orders.items()):
                age = now - active.placed_at
                since_update = now - active.last_update if active.last_update > 0 else age

                # Warn about stale orders
                if since_update > self.STALE_ORDER_WARN_SEC and active.status in ("Submitted", "PreSubmitted"):
                    logger.warning(
                        "Stale order %d for strategy %s: status=%s, no update for %.0fs",
                        order_id, active.strategy_id, active.status, since_update,
                    )

    def _evaluate_all(self):
        """Run evaluate() on each active strategy and process resulting order actions."""
        # Check IB connection health
        if self._scanner.connection_lost:
            return  # skip evaluation when IB is disconnected

        for state in list(self._strategies.values()):
            if not state.is_active:
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
        1. Order Budget -- global algo order allowance
        2. Flip-flop guard -- per-strategy order rate limiter
        3. Inflight cap -- global cap on orders awaiting TWS ack
        4. Connection gate -- IB connectivity check

        The eval thread returns immediately; the order is placed on the
        dedicated order-exec thread.
        """
        # ── Gate 1: Order Budget ──
        if not self._consume_order_budget():
            budget_msg = "Order rejected: order budget exhausted (set budget via UI to allow algo orders)"
            logger.warning("Budget exhausted -- rejecting %s %d x %s for strategy %s",
                           action.side.value, action.quantity,
                           action.contract_dict.get("symbol", "?"), action.strategy_id)
            state.errors.append(budget_msg)
            return

        # ── Gate 2: Flip-flop guard ──
        if self._check_flipflop(state.strategy_id):
            # Refund the budget since we're rejecting
            with self._order_budget_lock:
                if self._order_budget >= 0:  # don't refund unlimited
                    self._order_budget += 1
                self._total_algo_orders = max(0, self._total_algo_orders - 1)
            flipflop_msg = (
                f"Flip-flop detected: strategy {state.strategy_id} submitted "
                f">={self.FLIPFLOP_MAX_ORDERS} orders in {self.FLIPFLOP_WINDOW_SEC}s -- order rejected"
            )
            logger.warning(flipflop_msg)
            state.errors.append(flipflop_msg)
            state.is_active = False  # pause the strategy
            return

        # ── Gate 3: Inflight cap ──
        with self._inflight_lock:
            if self._inflight_order_count >= self.MAX_INFLIGHT_ORDERS:
                # Refund budget
                with self._order_budget_lock:
                    if self._order_budget >= 0:
                        self._order_budget += 1
                    self._total_algo_orders = max(0, self._total_algo_orders - 1)
                logger.warning(
                    "Dropping order action for strategy %s: %d orders already in-flight",
                    state.strategy_id, self._inflight_order_count,
                )
                state.errors.append(
                    f"Order dropped: {self._inflight_order_count} in-flight (cap={self.MAX_INFLIGHT_ORDERS})"
                )
                return
            self._inflight_order_count += 1
            state.inflight_orders += 1
            state.orders_submitted += 1

        # ── Gate 4: Connection check ──
        if self._scanner.connection_lost:
            with self._inflight_lock:
                self._inflight_order_count = max(0, self._inflight_order_count - 1)
                state.inflight_orders = max(0, state.inflight_orders - 1)
            with self._order_budget_lock:
                if self._order_budget >= 0:
                    self._order_budget += 1
                self._total_algo_orders = max(0, self._total_algo_orders - 1)
            state.errors.append("Order rejected: IB connection lost")
            return

        # ── Record for flip-flop tracking ──
        self._record_order_submission(state.strategy_id)

        logger.info(
            "Strategy %s queuing order: %s %d x %s @ %s (%s) [inflight=%d, budget=%s]",
            action.strategy_id, action.side.value, action.quantity,
            action.contract_dict.get("symbol", "?"),
            action.limit_price or "MKT", action.reason,
            self._inflight_order_count,
            "UNL" if self._order_budget == -1 else self._order_budget,
        )

        order_dict = {
            "action": action.side.value,
            "totalQuantity": action.quantity,
            "orderType": action.order_type.value,
            "tif": action.tif or "DAY",
        }
        if action.limit_price is not None and action.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT):
            order_dict["lmtPrice"] = action.limit_price
        if action.aux_price is not None and action.order_type in (OrderType.STOP, OrderType.STOP_LIMIT, OrderType.TRAIL):
            order_dict["auxPrice"] = action.aux_price

        future = self._order_executor.submit(
            self._place_order_worker,
            state.strategy_id, action.contract_dict, order_dict,
        )
        future.add_done_callback(
            lambda f: self._on_order_complete(f, state.strategy_id)
        )

    def _place_order_worker(
        self, strategy_id: str, contract_dict: dict, order_dict: dict,
    ) -> dict:
        """Run on the order-exec thread.  Places order and blocks until TWS ack."""
        return self._scanner.place_order_sync(
            contract_dict, order_dict, timeout_sec=self.ORDER_TIMEOUT_SEC,
        )

    def _on_order_complete(self, future: Future, strategy_id: str):
        """Callback when order placement finishes (runs on order-exec thread).

        Decrements in-flight counters, registers in active orders, logs results,
        and routes immediate fills to strategies.
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
        else:
            order_id = result.get("orderId")
            status = result.get("status", "")
            filled = result.get("filled", 0.0)

            if order_id:
                self._order_strategy_map[order_id] = strategy_id

                # Register in active orders for lifecycle tracking
                with self._active_orders_lock:
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
                    )

                # Notify strategy of order placement (so it can map order_id to level)
                if state:
                    try:
                        state.strategy.on_order_placed(order_id, result, state.config)
                    except Exception as e2:
                        logger.error("Strategy %s on_order_placed error: %s", strategy_id, e2)

                # If the order filled immediately (MKT orders), notify strategy now
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

            logger.info(
                "Order placed for strategy %s: orderId=%s status=%s filled=%s",
                strategy_id, order_id, status, filled,
            )

    # ── Status / telemetry ──

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
                }
                for ao in self._active_orders.values()
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
            "order_budget": self._order_budget,
            "total_algo_orders": self._total_algo_orders,
        }

    def get_telemetry(self) -> dict:
        """Lightweight telemetry dict for periodic WebSocket reporting."""
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
                    "strategy_state": (
                        s.strategy.get_strategy_state()
                        if hasattr(s.strategy, "get_strategy_state") else {}
                    ),
                }
                for s in self._strategies.values()
            ],
            "inflight_orders_total": self._inflight_order_count,
            "lines_held": self._resource_manager.execution_lines_held,
            "quote_snapshot": self._cache.get_all_serialized(),
            "order_budget": self._order_budget,
            "total_algo_orders": self._total_algo_orders,
        }
