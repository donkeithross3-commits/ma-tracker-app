"""Intelligence Orchestrator - Coordinates all source monitors"""
import asyncio
import logging
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.utils.timezone import convert_to_et, get_current_utc
import asyncpg

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.aggregator import IntelligenceAggregator, TierManager
from app.intelligence.ticker_watch_monitor import TickerWatchMonitor
from app.intelligence.monitors import (
    create_ftc_monitor,
    create_reuters_monitor,
    create_seeking_alpha_monitor,
    create_globenewswire_ma_monitor,
    create_globenewswire_corporate_actions_monitor,
    create_globenewswire_executive_changes_monitor,
)

logger = logging.getLogger(__name__)


class IntelligenceOrchestrator:
    """
    Orchestrates the multi-source M&A intelligence platform.

    Responsibilities:
    - Initialize and manage source monitors
    - Coordinate monitoring cycles
    - Feed mentions to aggregator
    - Trigger tier evaluations
    - Track monitoring status
    """

    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool
        self.aggregator = IntelligenceAggregator(db_pool)
        self.tier_manager = TierManager(db_pool)
        self.ticker_watch_monitor = TickerWatchMonitor(db_pool)

        # Initialize monitors
        self.monitors: List[BaseSourceMonitor] = []
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._ticker_watch_task: Optional[asyncio.Task] = None

    async def initialize_monitors(self) -> None:
        """Initialize all source monitors based on database configuration"""
        async with self.pool.acquire() as conn:
            # Get enabled monitors from source_monitors table
            monitor_configs = await conn.fetch(
                """SELECT source_name, source_type, config, poll_interval_seconds
                   FROM source_monitors
                   WHERE is_enabled = true"""
            )

            for config_row in monitor_configs:
                source_name = config_row["source_name"]
                config_str = config_row["config"]

                # Parse JSON config string to dictionary
                try:
                    config = json.loads(config_str) if isinstance(config_str, str) else config_str
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON config for {source_name}: {config_str}")
                    continue

                try:
                    # Create monitor based on source_name
                    monitor = None
                    if source_name == "ftc_early_termination":
                        monitor = create_ftc_monitor(config)
                    elif source_name == "reuters_ma":
                        monitor = create_reuters_monitor(config)
                    elif source_name == "seeking_alpha_ma":
                        monitor = create_seeking_alpha_monitor(config)
                    elif source_name == "globenewswire_ma":
                        monitor = create_globenewswire_ma_monitor(config)
                    elif source_name == "globenewswire_corporate_actions":
                        monitor = create_globenewswire_corporate_actions_monitor(config)
                    elif source_name == "globenewswire_executive_changes":
                        monitor = create_globenewswire_executive_changes_monitor(config)
                    # Add more monitors here as they're implemented
                    # elif source_name == "nasdaq_headlines":
                    #     monitor = create_nasdaq_monitor(config)
                    # elif source_name == "nyse_corporate_actions":
                    #     monitor = create_nyse_monitor(config)
                    # elif source_name == "twitter_open_outcrier":
                    #     monitor = create_twitter_monitor(config)

                    if monitor:
                        self.monitors.append(monitor)
                        logger.info(f"Initialized monitor: {source_name}")
                    else:
                        logger.warning(f"Monitor not implemented: {source_name}")

                except Exception as e:
                    logger.error(f"Failed to initialize monitor {source_name}: {e}", exc_info=True)

        logger.info(f"Initialized {len(self.monitors)} monitors")

    async def run_monitoring_cycle(self) -> Dict[str, Any]:
        """
        Run a single monitoring cycle across all sources.

        Returns:
            Dictionary with cycle statistics
        """
        cycle_start = get_current_utc()
        total_mentions = 0
        total_deals_created = 0
        total_deals_updated = 0
        errors = []

        logger.info("Starting intelligence monitoring cycle")

        for monitor in self.monitors:
            try:
                # Update last_poll timestamp
                await self._update_monitor_status(monitor.source_name, "polling")

                # Run monitor
                mentions = await monitor.monitor()

                # Process each mention
                deals_created = 0
                deals_updated = 0

                for mention in mentions:
                    try:
                        # Add mention to intelligence system
                        deal_id = await self.aggregator.process_mention(mention)

                        # Check if deal was filtered out (e.g., no ticker found for private company)
                        if deal_id is None:
                            continue

                        # Evaluate tier promotion
                        tier_changed = await self.tier_manager.evaluate_tier_promotion(deal_id)

                        if tier_changed:
                            deals_updated += 1
                        else:
                            deals_created += 1

                    except Exception as e:
                        logger.error(f"Error processing mention from {monitor.source_name}: {e}", exc_info=True)
                        errors.append({"source": monitor.source_name, "error": str(e)})

                total_mentions += len(mentions)
                total_deals_created += deals_created
                total_deals_updated += deals_updated

                # Update monitor success status
                await self._update_monitor_status(
                    monitor.source_name,
                    "success",
                    deals_found=len(mentions)
                )

                logger.info(
                    f"Monitor {monitor.source_name}: {len(mentions)} mentions, "
                    f"{deals_created} new deals, {deals_updated} updated"
                )

            except Exception as e:
                logger.error(f"Error in monitor {monitor.source_name}: {e}", exc_info=True)
                errors.append({"source": monitor.source_name, "error": str(e)})

                # Update monitor error status
                await self._update_monitor_status(monitor.source_name, "error", error=str(e))

        cycle_duration = (get_current_utc() - cycle_start).total_seconds()

        stats = {
            "cycle_start": cycle_start,
            "duration_seconds": cycle_duration,
            "total_mentions": total_mentions,
            "deals_created": total_deals_created,
            "deals_updated": total_deals_updated,
            "errors": errors,
            "monitors_run": len(self.monitors),
        }

        logger.info(
            f"Monitoring cycle complete: {total_mentions} mentions, "
            f"{total_deals_created} new deals, {total_deals_updated} updated in {cycle_duration:.1f}s"
        )

        return stats

    async def _update_monitor_status(
        self,
        source_name: str,
        status: str,
        deals_found: int = 0,
        error: Optional[str] = None
    ) -> None:
        """Update monitor status in database"""
        async with self.pool.acquire() as conn:
            if status == "polling":
                await conn.execute(
                    """UPDATE source_monitors
                       SET last_poll_at = $1,
                           total_polls = total_polls + 1
                       WHERE source_name = $2""",
                    get_current_utc(),
                    source_name,
                )
            elif status == "success":
                await conn.execute(
                    """UPDATE source_monitors
                       SET last_success_at = $1,
                           total_deals_found = total_deals_found + $2,
                           error_count = 0,
                           last_error = NULL
                       WHERE source_name = $3""",
                    get_current_utc(),
                    deals_found,
                    source_name,
                )
            elif status == "error":
                await conn.execute(
                    """UPDATE source_monitors
                       SET last_error_at = $1,
                           error_count = error_count + 1,
                           last_error = $2
                       WHERE source_name = $3""",
                    get_current_utc(),
                    error[:500],  # Truncate error message
                    source_name,
                )

    async def start_continuous_monitoring(self, interval_seconds: int = 300) -> None:
        """
        Start continuous monitoring in the background.

        Args:
            interval_seconds: Time between monitoring cycles (default 5 minutes)
        """
        if self._running:
            logger.warning("Monitoring already running")
            return

        self._running = True

        # Initialize monitors if not already done
        if not self.monitors:
            await self.initialize_monitors()

        logger.info(f"Starting continuous monitoring (interval: {interval_seconds}s)")

        # Start ticker watch monitor in parallel
        # Check for new EDGAR filings every 5 minutes for rumored deal tickers
        self._ticker_watch_task = asyncio.create_task(
            self.ticker_watch_monitor.run(interval_seconds=300)
        )
        logger.info("Started ticker watch monitor for rumored deals")

        while self._running:
            try:
                await self.run_monitoring_cycle()
            except Exception as e:
                logger.error(f"Error in monitoring cycle: {e}", exc_info=True)

            # Wait for next cycle
            await asyncio.sleep(interval_seconds)

    async def stop_monitoring(self) -> None:
        """Stop continuous monitoring"""
        self._running = False

        # Stop ticker watch monitor
        if self._ticker_watch_task:
            self._ticker_watch_task.cancel()
            try:
                await self._ticker_watch_task
            except asyncio.CancelledError:
                pass
            logger.info("Ticker watch monitor stopped")

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Monitoring stopped")

    def is_running(self) -> bool:
        """Check if continuous monitoring is running"""
        return self._running


# Global orchestrator instance
_orchestrator: Optional[IntelligenceOrchestrator] = None


async def start_intelligence_monitoring(db_pool: asyncpg.Pool) -> None:
    """Start the intelligence monitoring system"""
    global _orchestrator

    if _orchestrator and _orchestrator.is_running():
        logger.warning("Intelligence monitoring already running")
        return

    _orchestrator = IntelligenceOrchestrator(db_pool)
    await _orchestrator.initialize_monitors()

    # Run in background
    asyncio.create_task(_orchestrator.start_continuous_monitoring())

    logger.info("Intelligence monitoring started")


async def stop_intelligence_monitoring() -> None:
    """Stop the intelligence monitoring system"""
    global _orchestrator

    if _orchestrator:
        await _orchestrator.stop_monitoring()
        _orchestrator = None

    logger.info("Intelligence monitoring stopped")


def is_intelligence_monitoring_running() -> bool:
    """Check if intelligence monitoring is running"""
    global _orchestrator
    return _orchestrator is not None and _orchestrator.is_running()


async def get_monitoring_stats() -> Dict[str, Any]:
    """Get current monitoring statistics"""
    global _orchestrator

    if not _orchestrator:
        return {"status": "not_running"}

    # Get monitor status from database
    async with _orchestrator.pool.acquire() as conn:
        monitors = await conn.fetch(
            """SELECT source_name, last_poll_at, last_success_at, last_error_at,
                      total_polls, total_deals_found, error_count, last_error
               FROM source_monitors
               WHERE is_enabled = true
               ORDER BY source_name"""
        )

        # Get ticker watch stats
        ticker_watch_stats = {
            "monitored_tickers_count": len(_orchestrator.ticker_watch_monitor.monitored_tickers),
            "monitored_tickers": list(_orchestrator.ticker_watch_monitor.monitored_tickers),
        }

        return {
            "status": "running",
            "monitors_count": len(_orchestrator.monitors),
            "monitors": [dict(m) for m in monitors],
            "ticker_watch": ticker_watch_stats,
        }


async def get_recent_scanned_articles() -> Dict[str, Any]:
    """Get recent scanned articles from all monitors (for debugging filter performance)"""
    global _orchestrator

    if not _orchestrator:
        return {
            "status": "not_running",
            "monitors": []
        }

    # Collect scan results from all monitors
    monitor_scans = []
    for monitor in _orchestrator.monitors:
        monitor_scans.append({
            "source_name": monitor.source_name,
            "source_type": monitor.source_type.value if hasattr(monitor.source_type, 'value') else str(monitor.source_type),
            "last_scan_time": convert_to_et(monitor.last_scan_time) if monitor.last_scan_time else None,
            "articles": monitor.last_scan_articles,
            "total_scanned": len(monitor.last_scan_articles),
            "ma_relevant_count": sum(1 for article in monitor.last_scan_articles if article.get("is_ma_relevant", False)),
        })

    # Sort by last scan time (most recent first)
    monitor_scans.sort(key=lambda x: x["last_scan_time"] or "", reverse=True)

    return {
        "status": "running",
        "monitors": monitor_scans
    }
