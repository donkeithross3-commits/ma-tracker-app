"""
APScheduler singleton for the portfolio service.

The scheduler runs in the same event loop as FastAPI. Job functions
access the database pool via the module-level `pool` variable, which
is set during startup by portfolio_main.py.
"""

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

# Module-level pool reference, set by portfolio_main.startup()
pool = None

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    """Return the singleton scheduler, creating it on first call."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="US/Eastern")
        logger.info("Created AsyncIOScheduler (timezone=US/Eastern)")
    return _scheduler
