"""
QuotaGate — Lightweight adaptive rate limiter for automated AI workloads.

Usage:
    from app.utils.quota_gate import QuotaGate

    gate = QuotaGate()

    for batch in batches:
        gate.wait()          # Adaptive sleep: 1s when flush, 60s when critical
        if not gate.can_proceed(estimated_cost=5.0):
            logger.warning("Quota exhausted — stopping run")
            break
        process(batch)
        gate.report(actual_cost=4.50)  # Update local running total

The gate queries GET /ai-usage/quota-budget on the FastAPI backend. Responses
are cached for 30 seconds to avoid hammering the API. Falls back to permissive
defaults if the API is unreachable (never blocks work because telemetry is down).
"""

import logging
import threading
import time
from typing import Optional

try:
    import httpx

    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

logger = logging.getLogger(__name__)

# Permissive fallback when the quota API is unreachable
_FALLBACK_RESPONSE = {
    "can_proceed": True,
    "recommended_delay_sec": 2.0,
    "budget": {
        "weekly_limit_equiv": 5000,
        "weekly_used": 0,
        "weekly_remaining": 5000,
        "weekly_pct": 0,
    },
    "automated_budget": {
        "daily_cap_equiv": 200,
        "daily_used": 0,
        "daily_remaining": 200,
    },
}

_CACHE_TTL_SEC = 30.0


class QuotaGate:
    """Adaptive rate limiter that queries the quota-budget API.

    Thread-safe: uses a lock around cache access and network calls.

    Args:
        api_url: Full URL to the quota-budget endpoint.
                 Default: http://localhost:8000/ai-usage/quota-budget
                 (for workloads running on the droplet alongside FastAPI).
                 Remote workloads (Mac/garage-pc) should pass the public URL:
                 https://dr3-dashboard.com/api/ai-usage/quota-budget
    """

    def __init__(
        self,
        api_url: str = "http://localhost:8000/ai-usage/quota-budget",
    ):
        self.api_url = api_url
        self._lock = threading.Lock()
        self._cached_response: Optional[dict] = None
        self._cache_time: float = 0.0
        self._local_cost: float = 0.0  # running total this session

    def _fetch_budget(self) -> dict:
        """Fetch budget status from the API, with caching + fallback."""
        with self._lock:
            now = time.monotonic()
            if self._cached_response and (now - self._cache_time) < _CACHE_TTL_SEC:
                return self._cached_response

            try:
                if _HAS_HTTPX:
                    with httpx.Client(timeout=5.0) as client:
                        resp = client.get(self.api_url)
                        resp.raise_for_status()
                        data = resp.json()
                else:
                    # Fallback to urllib if httpx not available
                    import json
                    import urllib.request

                    req = urllib.request.Request(self.api_url)
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read())

                self._cached_response = data
                self._cache_time = now

                logger.info(
                    "[quota-gate] Budget check: weekly %.0f%% used, "
                    "daily auto $%.0f/$%.0f, delay=%.0fs, proceed=%s",
                    data.get("budget", {}).get("weekly_pct", 0),
                    data.get("automated_budget", {}).get("daily_used", 0),
                    data.get("automated_budget", {}).get("daily_cap_equiv", 200),
                    data.get("recommended_delay_sec", 2),
                    data.get("can_proceed", True),
                )

                return data

            except Exception as e:
                logger.warning(
                    "[quota-gate] Failed to fetch budget (using permissive fallback): %s",
                    e,
                )
                # Use fallback but don't cache it — retry next time
                return _FALLBACK_RESPONSE

    def wait(self) -> None:
        """Sleep for the server-recommended delay. Call before each batch."""
        budget = self._fetch_budget()
        delay = budget.get("recommended_delay_sec", 2.0)

        if not budget.get("can_proceed", True):
            logger.warning(
                "[quota-gate] Budget EXHAUSTED: weekly %.0f%% used — "
                "blocking automated work (sleeping 60s before re-check)",
                budget.get("budget", {}).get("weekly_pct", 0),
            )
            # Sleep longer and invalidate cache to force re-check
            time.sleep(60.0)
            with self._lock:
                self._cached_response = None
            return

        if delay > 0:
            time.sleep(delay)

    def can_proceed(self, estimated_cost: float = 0.0) -> bool:
        """Check if there's enough budget for the next operation.

        Args:
            estimated_cost: Rough estimated cost of the next operation in API-equiv $.
                           Used to check daily_remaining > estimated_cost AND
                           weekly_remaining > estimated_cost * 5 (buffer).

        Returns:
            True if the workload should continue, False if it should stop.
        """
        budget = self._fetch_budget()

        if not budget.get("can_proceed", True):
            logger.warning(
                "[quota-gate] Budget EXHAUSTED — automated work should stop"
            )
            return False

        if estimated_cost > 0:
            daily_remaining = budget.get("automated_budget", {}).get(
                "daily_remaining", 200
            )
            weekly_remaining = budget.get("budget", {}).get(
                "weekly_remaining", 5000
            )

            if daily_remaining < estimated_cost:
                logger.warning(
                    "[quota-gate] Daily auto budget exhausted: "
                    "$%.1f remaining < $%.1f estimated",
                    daily_remaining,
                    estimated_cost,
                )
                return False

            if weekly_remaining < estimated_cost * 5:
                logger.warning(
                    "[quota-gate] Weekly budget critically low: "
                    "$%.0f remaining < $%.0f (5x buffer)",
                    weekly_remaining,
                    estimated_cost * 5,
                )
                return False

        return True

    def report(self, actual_cost: float) -> None:
        """Record actual cost spent (local running total for logging).

        This doesn't affect the gate's decisions (the API tracks real usage),
        but provides a running total for the caller's log output.
        """
        with self._lock:
            self._local_cost += actual_cost
        logger.debug(
            "[quota-gate] Reported $%.2f cost (session total: $%.2f)",
            actual_cost,
            self._local_cost,
        )

    @property
    def session_cost(self) -> float:
        """Total cost reported in this QuotaGate session."""
        return self._local_cost
