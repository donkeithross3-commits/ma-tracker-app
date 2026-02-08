#!/usr/bin/env python3
"""
Resource Manager for IB Market Data Lines
==========================================
Thread-safe accounting for IB market data line usage.

A standard IB account has 100 simultaneous market data lines shared across
TWS and all API clients. This manager tracks how many lines are held by
the execution engine (persistent streaming subscriptions) versus available
for dashboard scan requests (short-lived request-cancel cycles).

Design:
- Execution lines are long-lived: acquired when a strategy subscribes to
  a symbol, released when the strategy unsubscribes or stops.
- Scan lines are transient: the scanner reads `scan_batch_size` to decide
  how many concurrent reqMktData calls to issue per chunk.
- The safety buffer prevents the agent from accidentally saturating all
  100 lines, which would block TWS watchlists and cause IB errors.
"""

import threading
import time
import logging
from typing import Dict

logger = logging.getLogger(__name__)


class ResourceManager:
    """Thread-safe manager for IB market data line allocation."""

    MAX_LINES = 100
    SAFETY_BUFFER = 10  # reserve for TWS watchlists / headroom

    def __init__(self, max_lines: int = MAX_LINES, safety_buffer: int = SAFETY_BUFFER):
        self._max_lines = max_lines
        self._safety_buffer = safety_buffer
        self._execution_lines: int = 0
        self._lock = threading.Lock()
        # Track what the execution engine has subscribed to (cache_key -> line count)
        self._execution_allocations: Dict[str, int] = {}

    # ── Properties (read without lock for hot-path; int reads are atomic in CPython) ──

    @property
    def max_lines(self) -> int:
        return self._max_lines

    @property
    def safety_buffer(self) -> int:
        return self._safety_buffer

    @property
    def execution_lines_held(self) -> int:
        """Number of market data lines currently held by execution streaming."""
        return self._execution_lines

    @property
    def execution_active(self) -> bool:
        """True if the execution engine holds any streaming subscriptions."""
        return self._execution_lines > 0

    @property
    def available_for_scan(self) -> int:
        """Lines available for dashboard scan batches."""
        return max(0, self._max_lines - self._execution_lines - self._safety_buffer)

    @property
    def scan_batch_size(self) -> int:
        """Recommended batch chunk size for the scanner.
        
        Returns at least 10 (so scans always make some progress) and at most 50
        (the original hardcoded value). When execution is inactive this returns 50.
        """
        return max(10, min(50, self.available_for_scan))

    @property
    def accept_external_scans(self) -> bool:
        """Whether the agent should accept scan requests from other users.
        
        Returns False only if execution is so resource-hungry that there aren't
        enough lines for even a minimal external scan batch.
        """
        return self.available_for_scan >= 10

    # ── Execution line management ──

    def acquire_execution_lines(self, count: int, allocation_key: str = "") -> bool:
        """Reserve `count` lines for execution streaming subscriptions.
        
        Args:
            count: Number of lines to acquire.
            allocation_key: Optional key for tracking (e.g. "AAPL" or "AAPL:150:20260320:C").
        
        Returns:
            True if the lines were acquired, False if insufficient capacity.
        """
        with self._lock:
            if self._execution_lines + count > self._max_lines - self._safety_buffer:
                logger.warning(
                    "Cannot acquire %d execution lines (held=%d, max=%d, buffer=%d)",
                    count, self._execution_lines, self._max_lines, self._safety_buffer,
                )
                return False
            self._execution_lines += count
            if allocation_key:
                self._execution_allocations[allocation_key] = (
                    self._execution_allocations.get(allocation_key, 0) + count
                )
            logger.info(
                "Acquired %d execution lines (key=%s, total_held=%d, available_scan=%d)",
                count, allocation_key or "-", self._execution_lines, self.available_for_scan,
            )
            return True

    def release_execution_lines(self, count: int, allocation_key: str = ""):
        """Release `count` lines previously held by execution streaming.
        
        Args:
            count: Number of lines to release.
            allocation_key: The key used when acquiring (for bookkeeping).
        """
        with self._lock:
            released = min(count, self._execution_lines)
            self._execution_lines -= released
            if allocation_key and allocation_key in self._execution_allocations:
                alloc = self._execution_allocations[allocation_key]
                alloc -= released
                if alloc <= 0:
                    del self._execution_allocations[allocation_key]
                else:
                    self._execution_allocations[allocation_key] = alloc
            if released != count:
                logger.warning(
                    "Released %d lines but only %d were held (key=%s)",
                    count, released, allocation_key or "-",
                )
            logger.info(
                "Released %d execution lines (key=%s, total_held=%d, available_scan=%d)",
                released, allocation_key or "-", self._execution_lines, self.available_for_scan,
            )

    def release_all_execution_lines(self):
        """Emergency release: free all execution lines (e.g. on disconnect or crash)."""
        with self._lock:
            prev = self._execution_lines
            self._execution_lines = 0
            self._execution_allocations.clear()
            if prev > 0:
                logger.warning("Emergency release: freed %d execution lines", prev)

    # ── State reporting ──

    def get_state_report(self) -> dict:
        """Return a dict suitable for sending to the relay as agent_state."""
        return {
            "execution_active": self.execution_active,
            "execution_lines_held": self.execution_lines_held,
            "available_scan_lines": self.available_for_scan,
            "accept_external_scans": self.accept_external_scans,
            "scan_batch_size": self.scan_batch_size,
            "max_lines": self._max_lines,
            "safety_buffer": self._safety_buffer,
        }
