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
    │       │                   ▼              │
    │  ┌────┴─────┐    ┌──────────────────┐    │
    │  │ QuoteCache│   │ IBMergerArbScanner│   │
    │  │ (reads)  │    │ (placeOrder)     │    │
    │  └──────────┘    └──────────────────┘    │
    └──────────────────────────────────────────┘

Usage:
    engine = ExecutionEngine(scanner, quote_cache, resource_manager)
    engine.load_strategy(config)
    engine.start()
    ...
    engine.stop()
"""

import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, TYPE_CHECKING

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


@dataclass
class OrderAction:
    """An order instruction produced by a strategy's evaluate() method."""
    strategy_id: str
    side: OrderSide
    order_type: OrderType
    quantity: int
    contract_dict: dict  # IB contract fields (symbol, secType, strike, etc.)
    limit_price: Optional[float] = None  # required if order_type is LIMIT
    reason: str = ""  # human-readable explanation for logging/audit


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
    errors: List[str] = field(default_factory=list)


# ── Strategy interface ──

class ExecutionStrategy(ABC):
    """Abstract base class for execution strategies.
    
    Concrete implementations define:
    - What instruments to subscribe to (get_subscriptions)
    - When to place/cancel orders (evaluate)
    - What to do on fills (on_fill)
    
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
        """Called when an order placed by this strategy is filled.
        
        Use this to update internal state, adjust positions, etc.
        """
        ...

    def on_start(self, config: dict):
        """Called when the strategy is loaded and about to start. Override for setup."""
        pass

    def on_stop(self, config: dict):
        """Called when the strategy is being unloaded. Override for cleanup."""
        pass


# ── Execution Engine ──

class ExecutionEngine:
    """Runs strategy evaluation loops and manages order lifecycle.
    
    Thread model:
    - The evaluation loop runs in its own daemon thread.
    - Quote reads are from the streaming cache (lock-free).
    - Order placement calls scanner.place_order_sync() which blocks
      until IB acknowledges (runs in the same eval thread -- acceptable
      because merger arb strategies rarely fire more than 1 order per eval).
    """

    DEFAULT_EVAL_INTERVAL = 0.1  # 100ms between evaluation ticks

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

    # ── Lifecycle ──

    def start(self):
        """Start the evaluation loop thread."""
        if self._running:
            logger.warning("ExecutionEngine already running")
            return
        if not self._strategies:
            logger.warning("ExecutionEngine has no strategies loaded -- starting anyway")
        self._running = True
        self._thread = threading.Thread(target=self._evaluation_loop, daemon=True, name="exec-engine")
        self._thread.start()
        logger.info("ExecutionEngine started (eval_interval=%.3fs, strategies=%d)",
                     self._eval_interval, len(self._strategies))

    def stop(self):
        """Stop the evaluation loop and unsubscribe all streaming quotes."""
        if not self._running:
            return
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

        # Notify all strategies of shutdown
        for state in self._strategies.values():
            try:
                state.strategy.on_stop(state.config)
            except Exception as e:
                logger.error("Error in strategy %s on_stop: %s", state.strategy_id, e)

        # Unsubscribe all streaming quotes
        self._cache.unsubscribe_all(self._scanner)
        self._strategies.clear()
        self._order_strategy_map.clear()
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

        # Clean order map
        self._order_strategy_map = {
            oid: sid for oid, sid in self._order_strategy_map.items() if sid != strategy_id
        }

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
        """Main loop: evaluate all strategies, place orders, repeat."""
        logger.info("Evaluation loop started")
        while self._running:
            loop_start = time.monotonic()
            try:
                self._evaluate_all()
            except Exception as e:
                logger.error("Evaluation loop error: %s", e, exc_info=True)

            # Sleep for the remainder of the interval
            elapsed = time.monotonic() - loop_start
            sleep_time = max(0, self._eval_interval - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info("Evaluation loop stopped")

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
                    quote = self._cache.get(cache_key)
                    if quote is not None:
                        quotes[cache_key] = quote

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
        """Execute an OrderAction by placing an order through the scanner."""
        logger.info(
            "Strategy %s order: %s %d x %s @ %s (%s)",
            action.strategy_id, action.side.value, action.quantity,
            action.contract_dict.get("symbol", "?"),
            action.limit_price or "MKT", action.reason,
        )

        order_dict = {
            "action": action.side.value,
            "totalQuantity": action.quantity,
            "orderType": action.order_type.value,
            "tif": "DAY",
        }
        if action.limit_price is not None and action.order_type == OrderType.LIMIT:
            order_dict["lmtPrice"] = action.limit_price

        try:
            result = self._scanner.place_order_sync(action.contract_dict, order_dict)
            state.orders_placed += 1

            if result.get("error"):
                logger.error("Order failed for strategy %s: %s", state.strategy_id, result["error"])
                state.errors.append(f"Order error: {result['error']}")
            else:
                order_id = result.get("orderId")
                if order_id:
                    self._order_strategy_map[order_id] = state.strategy_id
                logger.info(
                    "Order placed for strategy %s: orderId=%s status=%s",
                    state.strategy_id, order_id, result.get("status"),
                )
        except Exception as e:
            logger.error("Exception placing order for strategy %s: %s", state.strategy_id, e)
            state.errors.append(f"Order exception: {e}")

    # ── Status / telemetry ──

    def get_status(self) -> dict:
        """Return current engine status for telemetry/dashboard."""
        strategies = []
        for state in self._strategies.values():
            strategies.append({
                "strategy_id": state.strategy_id,
                "is_active": state.is_active,
                "subscriptions": state.subscriptions,
                "eval_count": state.eval_count,
                "orders_placed": state.orders_placed,
                "last_eval_time": state.last_eval_time,
                "recent_errors": state.errors[-5:] if state.errors else [],
                "config": state.config,
            })

        return {
            "running": self._running,
            "eval_interval": self._eval_interval,
            "strategy_count": len(self._strategies),
            "strategies": strategies,
            "lines_held": self._resource_manager.execution_lines_held,
            "available_scan_lines": self._resource_manager.available_for_scan,
            "quote_snapshot": self._cache.get_all_serialized(),
            "pending_orders": list(self._order_strategy_map.keys()),
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
                    "orders_placed": s.orders_placed,
                }
                for s in self._strategies.values()
            ],
            "lines_held": self._resource_manager.execution_lines_held,
            "quote_snapshot": self._cache.get_all_serialized(),
        }
