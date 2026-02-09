#!/usr/bin/env python3
"""
Streaming Quote Cache
=====================
Low-latency in-memory cache for IB streaming market data subscriptions.

The cache sits between IB TWS callbacks (tickPrice/tickSize) and the
execution engine. Subscriptions are long-lived (opened when a strategy
starts, closed when it stops) and the cache always holds the latest
tick data for every subscribed instrument.

Design goals:
- Sub-microsecond reads on the hot path (the execution evaluation loop).
- Thread-safe writes from the IB message processing thread.
- Clean integration with ResourceManager for line accounting.
- No external dependencies beyond the standard library.

Usage:
    cache = StreamingQuoteCache(resource_manager)
    req_id = cache.subscribe(scanner, contract, "AAPL")
    ...
    quote = cache.get("AAPL")  # returns latest Quote or None
    ...
    cache.unsubscribe(scanner, "AAPL")
"""

import threading
import time
import logging
from dataclasses import dataclass, field
from typing import Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ib_scanner import IBMergerArbScanner
    from ibapi.contract import Contract
    from resource_manager import ResourceManager

logger = logging.getLogger(__name__)


@dataclass
class Quote:
    """Latest market data for a single instrument.
    
    Fields are updated individually by tickPrice/tickSize callbacks.
    The `timestamp` field records the wall-clock time of the most recent
    update to any field, allowing consumers to check freshness.
    """
    bid: float = 0.0
    ask: float = 0.0
    last: float = 0.0
    bid_size: int = 0
    ask_size: int = 0
    volume: int = 0
    open_interest: int = 0
    implied_vol: float = 0.0
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    timestamp: float = 0.0  # time.time() of last update

    @property
    def mid(self) -> float:
        """Mid price, or last if bid/ask unavailable."""
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2.0
        return self.last if self.last > 0 else 0.0

    @property
    def spread(self) -> float:
        """Bid-ask spread in absolute terms."""
        if self.bid > 0 and self.ask > 0:
            return self.ask - self.bid
        return 0.0

    @property
    def age_seconds(self) -> float:
        """Seconds since the last tick update."""
        if self.timestamp <= 0:
            return float("inf")
        return time.time() - self.timestamp

    def to_dict(self) -> dict:
        """Serialize for JSON telemetry."""
        return {
            "bid": self.bid,
            "ask": self.ask,
            "last": self.last,
            "mid": self.mid,
            "bid_size": self.bid_size,
            "ask_size": self.ask_size,
            "volume": self.volume,
            "open_interest": self.open_interest,
            "implied_vol": self.implied_vol,
            "delta": self.delta,
            "gamma": self.gamma,
            "theta": self.theta,
            "vega": self.vega,
            "timestamp": self.timestamp,
            "age_seconds": round(self.age_seconds, 2),
        }


class StreamingQuoteCache:
    """Manages persistent IB streaming subscriptions and caches latest tick data.
    
    Thread safety:
    - `subscribe`/`unsubscribe` acquire the lock (infrequent, called when
      strategies start/stop).
    - `update_price`/`update_size`/`update_greeks` are called from the IB
      message thread on every tick. They use the lock for dict-key lookups
      only; the Quote attribute writes are atomic in CPython.
    - `get` is called from the execution evaluation loop at 10 Hz. It does
      a single dict lookup (GIL-protected); no lock needed for reads.
    """

    def __init__(self, resource_manager: "ResourceManager"):
        self._resource_manager = resource_manager
        # cache_key -> Quote
        self._quotes: Dict[str, Quote] = {}
        # IB reqId -> cache_key  (for routing tickPrice/tickSize callbacks)
        self._req_id_to_key: Dict[int, str] = {}
        # cache_key -> IB reqId  (for cancellation)
        self._key_to_req_id: Dict[str, int] = {}
        # cache_key -> (Contract, generic_ticks)  (for resubscription after reconnect)
        self._key_to_contract: Dict[str, tuple] = {}
        self._lock = threading.Lock()

    # ── Subscription management ──

    def subscribe(self, scanner: "IBMergerArbScanner", contract: "Contract",
                  cache_key: str, generic_ticks: str = "100,101,104,106") -> Optional[int]:
        """Open a streaming market data subscription for `contract`.
        
        Args:
            scanner: The IBMergerArbScanner instance (provides reqMktData / reqId allocation).
            contract: Fully specified IB Contract object.
            cache_key: Unique key for this subscription (e.g. "AAPL" or "AAPL:150.0:20260320:C").
            generic_ticks: Generic tick types to request (default includes OI, greeks).
        
        Returns:
            The IB reqId for this subscription, or None if the resource manager
            refused to allocate a line.
        """
        with self._lock:
            if cache_key in self._key_to_req_id:
                logger.warning("Already subscribed to %s (reqId=%d)", cache_key, self._key_to_req_id[cache_key])
                return self._key_to_req_id[cache_key]

            if not self._resource_manager.acquire_execution_lines(1, allocation_key=cache_key):
                logger.error("Cannot subscribe to %s: resource manager refused (insufficient lines)", cache_key)
                return None

            req_id = scanner.get_next_req_id()
            self._quotes[cache_key] = Quote()
            self._req_id_to_key[req_id] = cache_key
            self._key_to_req_id[cache_key] = req_id
            # Store contract for resubscription after reconnect
            self._key_to_contract[cache_key] = (contract, generic_ticks)

        # reqMktData outside the lock (it sends over the socket)
        # snapshot=False, regulatorySnapshot=False -> persistent streaming
        scanner.reqMktData(req_id, contract, generic_ticks, False, False, [])
        logger.info("Subscribed streaming: %s -> reqId=%d", cache_key, req_id)
        return req_id

    def unsubscribe(self, scanner: "IBMergerArbScanner", cache_key: str):
        """Cancel a streaming subscription and free the market data line."""
        with self._lock:
            req_id = self._key_to_req_id.pop(cache_key, None)
            if req_id is None:
                logger.warning("unsubscribe: %s not found in cache", cache_key)
                return
            self._req_id_to_key.pop(req_id, None)
            self._quotes.pop(cache_key, None)
            self._key_to_contract.pop(cache_key, None)

        scanner.cancelMktData(req_id)
        self._resource_manager.release_execution_lines(1, allocation_key=cache_key)
        logger.info("Unsubscribed streaming: %s (reqId=%d)", cache_key, req_id)

    def unsubscribe_all(self, scanner: "IBMergerArbScanner"):
        """Cancel all streaming subscriptions (e.g. on execution stop or disconnect)."""
        with self._lock:
            keys = list(self._key_to_req_id.keys())
        for key in keys:
            self.unsubscribe(scanner, key)
        logger.info("Unsubscribed all streaming quotes (%d keys)", len(keys))

    def resubscribe_all(self, scanner: "IBMergerArbScanner"):
        """Re-establish all streaming subscriptions with fresh IB reqIds.
        
        Called after a TWS reconnect (error 1101/1102 or full reconnect).
        The old reqIds are stale (IB does not resume streaming after reconnect),
        so we allocate new reqIds and re-issue reqMktData for each subscription.
        
        Quote data is preserved — the Quote objects are NOT cleared, so
        consumers see the last known tick values until fresh ticks arrive.
        """
        resub_list = []  # (cache_key, contract, generic_ticks, new_req_id)

        with self._lock:
            for cache_key, old_req_id in list(self._key_to_req_id.items()):
                # Try to cancel stale IB req (may silently fail after socket reset)
                try:
                    scanner.cancelMktData(old_req_id)
                except Exception:
                    pass
                self._req_id_to_key.pop(old_req_id, None)

                contract_info = self._key_to_contract.get(cache_key)
                if not contract_info:
                    logger.warning("Cannot resubscribe %s: no stored contract", cache_key)
                    continue
                contract, generic_ticks = contract_info

                new_req_id = scanner.get_next_req_id()
                self._req_id_to_key[new_req_id] = cache_key
                self._key_to_req_id[cache_key] = new_req_id
                resub_list.append((cache_key, contract, generic_ticks, new_req_id))

        # Issue reqMktData outside the lock (sends over socket)
        for cache_key, contract, generic_ticks, req_id in resub_list:
            scanner.reqMktData(req_id, contract, generic_ticks, False, False, [])
            logger.info("Resubscribed streaming: %s -> reqId=%d", cache_key, req_id)

        logger.info("Resubscribed %d streaming quotes after reconnect", len(resub_list))

    # ── Tick update methods (called from IB message thread) ──

    def is_streaming_req_id(self, req_id: int) -> bool:
        """Fast check whether a reqId belongs to the streaming cache.
        
        Called on every tickPrice/tickSize callback. Uses a dict `in` check
        which is O(1) and GIL-protected -- no lock needed.
        """
        return req_id in self._req_id_to_key

    def update_price(self, req_id: int, tick_type: int, price: float):
        """Update price fields from tickPrice callback.
        
        tick_type mapping (IB standard):
            1 = bid, 2 = ask, 4 = last, 6 = high, 7 = low, 9 = close
        """
        key = self._req_id_to_key.get(req_id)
        if key is None:
            return
        quote = self._quotes.get(key)
        if quote is None:
            return
        if tick_type == 1:
            quote.bid = price
        elif tick_type == 2:
            quote.ask = price
        elif tick_type == 4:
            quote.last = price
        quote.timestamp = time.time()

    def update_size(self, req_id: int, tick_type: int, size: int):
        """Update size fields from tickSize callback.
        
        tick_type mapping (IB standard):
            0 = bid_size, 3 = ask_size, 5 = last_size, 8 = volume, 27 = open_interest
        """
        key = self._req_id_to_key.get(req_id)
        if key is None:
            return
        quote = self._quotes.get(key)
        if quote is None:
            return
        if tick_type == 0:
            quote.bid_size = size
        elif tick_type == 3:
            quote.ask_size = size
        elif tick_type == 8:
            quote.volume = size
        elif tick_type == 27:
            quote.open_interest = size
        quote.timestamp = time.time()

    def update_greeks(self, req_id: int, implied_vol: float, delta: float,
                      gamma: float, vega: float, theta: float):
        """Update option greeks from tickOptionComputation callback."""
        key = self._req_id_to_key.get(req_id)
        if key is None:
            return
        quote = self._quotes.get(key)
        if quote is None:
            return
        if implied_vol is not None and implied_vol > 0:
            quote.implied_vol = implied_vol
        if delta is not None:
            quote.delta = delta
        if gamma is not None:
            quote.gamma = gamma
        if vega is not None:
            quote.vega = vega
        if theta is not None:
            quote.theta = theta
        quote.timestamp = time.time()

    # ── Read methods (called from execution engine) ──

    def get(self, cache_key: str) -> Optional[Quote]:
        """Get the latest quote for a cache key. Returns None if not subscribed."""
        return self._quotes.get(cache_key)

    def get_all(self) -> Dict[str, Quote]:
        """Return a snapshot dict of all cached quotes (for telemetry/dashboard)."""
        return dict(self._quotes)

    def get_all_serialized(self) -> Dict[str, dict]:
        """Return all quotes as serializable dicts."""
        return {key: quote.to_dict() for key, quote in self._quotes.items()}

    # ── Status ──

    @property
    def subscription_count(self) -> int:
        """Number of active streaming subscriptions."""
        return len(self._key_to_req_id)

    def get_subscribed_keys(self) -> list:
        """List of currently subscribed cache keys."""
        return list(self._key_to_req_id.keys())
