"""
Real-time spread monitor for active M&A deals.

Runs during market hours (9:30 AM - 4:00 PM ET weekdays). Fetches live
prices from Polygon, computes spreads against deal prices from the
sheet_deal_details table, and sends alerts via MessagingService when
spreads move beyond a configurable threshold.
"""

import asyncio
import logging
import os
from datetime import datetime, time as dt_time
from typing import Any, Dict, Optional

from app.services.messaging import MessagingService

logger = logging.getLogger(__name__)

# Market hours (ET)
MARKET_OPEN = dt_time(9, 30)
MARKET_CLOSE = dt_time(16, 0)

# Default threshold: alert when spread changes by more than this (percentage points)
DEFAULT_THRESHOLD_PCT = 2.0


class SpreadMonitor:
    """Monitors M&A deal spreads and sends alerts on significant changes."""

    def __init__(
        self,
        pool,
        messaging: MessagingService,
        polygon_api_key: Optional[str] = None,
    ):
        self.pool = pool
        self.messaging = messaging
        self.polygon_api_key = polygon_api_key or os.getenv("POLYGON_API_KEY", "")
        self.threshold_pct = float(os.getenv("SPREAD_ALERT_THRESHOLD_PCT", str(DEFAULT_THRESHOLD_PCT)))

        self.is_running = False
        self._task: Optional[asyncio.Task] = None

        # Last known spreads keyed by ticker
        self.last_spreads: Dict[str, float] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        """Start the spread monitoring loop."""
        if self.is_running:
            logger.warning("[spread_monitor] Already running")
            return
        self.is_running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("[spread_monitor] Started (threshold=%.1f%%)", self.threshold_pct)

    async def stop(self):
        """Stop the spread monitoring loop."""
        self.is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("[spread_monitor] Stopped")

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self.is_running,
            "threshold_pct": self.threshold_pct,
            "tracked_tickers": len(self.last_spreads),
            "polygon_configured": bool(self.polygon_api_key),
        }

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _run_loop(self):
        """Core loop: fetch prices, compute spreads, alert if needed."""
        while self.is_running:
            try:
                now = datetime.now()
                if not self._is_market_hours(now):
                    await asyncio.sleep(60)
                    continue

                await self.run()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.error("[spread_monitor] Iteration error", exc_info=True)

            await asyncio.sleep(60)

    async def run(self) -> Optional[Dict[str, Any]]:
        """Single iteration: fetch prices, compute spreads, send alerts.

        Returns a summary dict suitable for job_runs result column.
        """
        deals = await self._get_active_deals()
        if not deals:
            logger.debug("[spread_monitor] No active deals to monitor")
            return {"checked": 0, "alerts": 0}

        tickers = [d["ticker"] for d in deals if d.get("ticker")]
        if not tickers:
            return {"checked": 0, "alerts": 0}

        # Fetch live prices from Polygon
        live_prices = await self._fetch_live_prices(tickers)
        if not live_prices:
            logger.warning("[spread_monitor] No live prices returned from Polygon")
            return {"checked": 0, "alerts": 0}

        # Load morning risk context for severity determination
        risk_context: Dict[str, Dict[str, Any]] = {}
        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT ticker, overall_risk_level, needs_attention, attention_reason,
                           discrepancies, discrepancy_count
                    FROM deal_risk_assessments
                    WHERE assessment_date = CURRENT_DATE
                """)
                risk_context = {r["ticker"]: dict(r) for r in rows}
        except Exception:
            pass  # Gracefully degrade if no assessment today

        alert_count = 0
        for deal in deals:
            ticker = deal.get("ticker")
            if not ticker or ticker not in live_prices:
                continue

            deal_price = deal.get("deal_price")
            break_price = deal.get("break_price")
            live_price = live_prices[ticker]

            if not deal_price or not live_price or deal_price == 0:
                continue

            # Compute spread: (deal_price - live_price) / live_price * 100
            spread = (deal_price - live_price) / live_price * 100.0

            old_spread = self.last_spreads.get(ticker)
            self.last_spreads[ticker] = spread

            # First observation — no delta to compare
            if old_spread is None:
                continue

            delta = abs(spread - old_spread)
            if delta >= self.threshold_pct:
                alert_type = "spread_widened" if spread > old_spread else "spread_tightened"
                pct_change = spread - old_spread

                # Determine severity from risk context
                risk = risk_context.get(ticker, {})
                severity = "info"
                channels = ["whatsapp"]

                if risk.get("needs_attention"):
                    severity = "critical"
                    channels = ["whatsapp", "email"]
                elif risk.get("overall_risk_level") in ("high", "critical"):
                    severity = "warning"
                elif delta >= self.threshold_pct * 2:
                    severity = "warning"

                # Break price proximity escalates to critical
                if break_price and live_price < break_price:
                    severity = "critical"
                    channels = ["whatsapp", "email"]

                logger.info(
                    "[spread_monitor] Alert: %s %s %.2f%% -> %.2f%% (delta %.2f%%, severity=%s)",
                    ticker, alert_type, old_spread, spread, pct_change, severity,
                )
                try:
                    await self.messaging.send_spread_alert(
                        ticker=ticker,
                        alert_type=alert_type,
                        details={
                            "old_spread": round(old_spread, 2),
                            "new_spread": round(spread, 2),
                            "pct_change": round(pct_change, 2),
                            "live_price": live_price,
                            "severity": severity,
                            "risk_level": risk.get("overall_risk_level", "unknown"),
                            "risk_context": risk.get("attention_reason", ""),
                        },
                        channels=channels,
                    )
                    alert_count += 1
                except Exception:
                    logger.error("[spread_monitor] Failed to send spread alert for %s", ticker, exc_info=True)

            # Break-price breach alert (standalone, fires even if delta < threshold)
            elif break_price and live_price < break_price:
                logger.info(
                    "[spread_monitor] CRITICAL: %s live price $%.2f < break price $%.2f",
                    ticker, live_price, break_price,
                )
                try:
                    await self.messaging.send_spread_alert(
                        ticker=ticker,
                        alert_type="break_price_breach",
                        details={
                            "old_spread": round(old_spread, 2),
                            "new_spread": round(spread, 2),
                            "pct_change": round(spread - old_spread, 2) if old_spread else 0,
                            "live_price": live_price,
                            "break_price": break_price,
                            "severity": "critical",
                            "risk_level": risk_context.get(ticker, {}).get("overall_risk_level", "unknown"),
                        },
                        channels=["whatsapp", "email"],
                    )
                    alert_count += 1
                except Exception:
                    logger.error("[spread_monitor] Failed to send break-price alert for %s", ticker, exc_info=True)

        return {"checked": len(deals), "alerts": alert_count}

    # ------------------------------------------------------------------
    # Data helpers
    # ------------------------------------------------------------------

    async def _get_active_deals(self) -> list:
        """Get active deals from sheet_rows + sheet_deal_details."""
        async with self.pool.acquire() as conn:
            # Latest successful snapshot
            snap = await conn.fetchrow(
                """
                SELECT id FROM sheet_snapshots
                WHERE status = 'success'
                ORDER BY ingested_at DESC LIMIT 1
                """
            )
            if not snap:
                return []

            rows = await conn.fetch(
                """
                SELECT r.ticker,
                       r.deal_price,
                       r.current_price,
                       d.break_price,
                       d.total_price_per_share
                FROM sheet_rows r
                LEFT JOIN sheet_deal_details d
                    ON d.snapshot_id = r.snapshot_id AND d.ticker = r.ticker
                WHERE r.snapshot_id = $1
                  AND r.ticker IS NOT NULL
                  AND (r.is_excluded IS NOT TRUE)
                """,
                snap["id"],
            )

            deals = []
            for r in rows:
                dp = r["deal_price"] or r["total_price_per_share"]
                deals.append({
                    "ticker": r["ticker"],
                    "deal_price": float(dp) if dp is not None else None,
                    "current_price": float(r["current_price"]) if r["current_price"] is not None else None,
                    "break_price": float(r["break_price"]) if r["break_price"] is not None else None,
                })
            return deals

    async def _fetch_live_prices(self, tickers: list) -> Dict[str, float]:
        """Fetch live prices via Polygon REST batch endpoint."""
        if not self.polygon_api_key:
            logger.warning("[spread_monitor] Polygon API key not configured")
            return {}

        import httpx

        joined = ",".join(t.upper() for t in tickers)
        url = "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers"
        params = {"tickers": joined, "apiKey": self.polygon_api_key}

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            logger.error("[spread_monitor] Polygon API request failed", exc_info=True)
            return {}

        prices: Dict[str, float] = {}
        for snap in data.get("tickers", []):
            t = snap.get("ticker", "")
            last_trade = snap.get("lastTrade", {})
            day = snap.get("day", {})
            price = last_trade.get("p", 0) or day.get("c", 0)
            if price:
                prices[t] = float(price)

        return prices

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _is_market_hours(now: datetime) -> bool:
        if now.weekday() >= 5:
            return False
        return MARKET_OPEN <= now.time() <= MARKET_CLOSE


# ------------------------------------------------------------------
# Singleton accessor (used by the scheduler job)
# ------------------------------------------------------------------

_spread_monitor: Optional[SpreadMonitor] = None


def get_spread_monitor() -> SpreadMonitor:
    """Get or create the singleton SpreadMonitor.

    The pool is pulled from the scheduler core module (set during startup).
    """
    global _spread_monitor
    if _spread_monitor is None:
        from app.scheduler import core as _core
        from app.services.messaging import get_messaging_service

        if _core.pool is None:
            raise RuntimeError("Database pool not initialised — cannot create SpreadMonitor")
        _spread_monitor = SpreadMonitor(pool=_core.pool, messaging=get_messaging_service())
    return _spread_monitor
