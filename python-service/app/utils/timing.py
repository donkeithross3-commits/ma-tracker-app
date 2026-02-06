"""
Lightweight request/span timing utility for latency instrumentation.

Usage:
    timer = RequestTimer("fetch_chain", correlation_id="abc123")
    timer.stage("resolve_contract")
    # ... do work ...
    timer.stage("fetch_underlying")
    # ... do work ...
    total = timer.finish()  # logs structured timing breakdown

All times use time.monotonic() for accuracy. No behaviour changes --
this is pure observability.
"""

import logging
import time
import uuid
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger(__name__)


class RequestTimer:
    """Records per-stage monotonic timestamps for a single logical request."""

    def __init__(self, operation: str, correlation_id: Optional[str] = None):
        self.operation = operation
        self.correlation_id = correlation_id or str(uuid.uuid4())[:8]
        self._stages: dict[str, float] = {}
        self._start = time.monotonic()
        self._last_stage = self._start

    def stage(self, name: str) -> float:
        """Mark a stage boundary. Returns elapsed seconds since previous stage."""
        now = time.monotonic()
        delta = now - self._last_stage
        self._stages[name] = round(delta, 4)
        self._last_stage = now
        return delta

    def finish(self, extra: Optional[dict] = None) -> float:
        """Log the timing breakdown and return total elapsed seconds."""
        total = round(time.monotonic() - self._start, 4)
        parts = " ".join(f"{k}={v:.4f}s" for k, v in self._stages.items())
        extra_str = ""
        if extra:
            extra_str = " " + " ".join(f"{k}={v}" for k, v in extra.items())
        logger.info(
            f"[perf][{self.correlation_id}] {self.operation} total={total:.4f}s {parts}{extra_str}"
        )
        return total

    @contextmanager
    def timed_stage(self, name: str):
        """Context manager that records a named stage around a block."""
        yield
        self.stage(name)
