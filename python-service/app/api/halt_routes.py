"""API routes for trading halt monitoring"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
import logging

from app.monitors.halt_monitor import get_halt_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/halts", tags=["halts"])


@router.get("/status")
async def get_halt_monitor_status():
    """
    Get halt monitor service status

    Returns:
        - is_running: Whether halt monitor is actively polling
        - tracked_tickers_count: Number of M&A target tickers being monitored
        - seen_halts_count: Number of halts in cache
        - poll_interval_seconds: How often we poll exchanges
    """
    try:
        monitor = get_halt_monitor()
        status = await monitor.get_status()
        return {
            "status": "ok",
            **status
        }
    except Exception as e:
        logger.error(f"Failed to get halt monitor status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recent")
async def get_recent_halts(limit: int = 50):
    """
    Get recent trading halt events

    Args:
        limit: Maximum number of halts to return (default: 50, max: 500)

    Returns:
        List of halt events with:
        - ticker
        - halt_time
        - halt_code (T1, T2, LUDP, etc.)
        - resumption_time
        - exchange (NASDAQ/NYSE)
        - company_name
        - is_tracked_ticker (whether this is an M&A target)
    """
    try:
        if limit > 500:
            limit = 500

        monitor = get_halt_monitor()
        halts = await monitor.get_recent_halts(limit)

        return {
            "halts": halts,
            "count": len(halts)
        }
    except Exception as e:
        logger.error(f"Failed to get recent halts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tracked")
async def get_tracked_ticker_halts(limit: int = 50):
    """
    Get recent halts for M&A target tickers only

    Args:
        limit: Maximum number of halts to return (default: 50)

    Returns:
        List of halt events for tracked M&A targets
    """
    try:
        monitor = get_halt_monitor()

        # Get all halts and filter for tracked tickers
        all_halts = await monitor.get_recent_halts(500)
        tracked_halts = [h for h in all_halts if h.get('is_tracked_ticker')][:limit]

        return {
            "halts": tracked_halts,
            "count": len(tracked_halts)
        }
    except Exception as e:
        logger.error(f"Failed to get tracked ticker halts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-tickers")
async def refresh_tracked_tickers():
    """
    Manually trigger refresh of tracked M&A target tickers

    This is normally done automatically every 30 seconds,
    but can be manually triggered after adding new deals.
    """
    try:
        monitor = get_halt_monitor()
        await monitor.refresh_tracked_tickers()

        return {
            "status": "success",
            "message": "Tracked tickers refreshed",
            "tracked_count": len(monitor.tracked_tickers)
        }
    except Exception as e:
        logger.error(f"Failed to refresh tracked tickers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ticker/{ticker}")
async def get_ticker_halts(ticker: str, limit: int = 20):
    """
    Get halt history for a specific ticker

    Args:
        ticker: Stock ticker symbol
        limit: Maximum number of halts to return

    Returns:
        List of halt events for the specified ticker
    """
    try:
        monitor = get_halt_monitor()

        # Get recent halts and filter by ticker
        all_halts = await monitor.get_recent_halts(500)
        ticker_halts = [
            h for h in all_halts
            if h.get('ticker', '').upper() == ticker.upper()
        ][:limit]

        return {
            "ticker": ticker.upper(),
            "halts": ticker_halts,
            "count": len(ticker_halts)
        }
    except Exception as e:
        logger.error(f"Failed to get ticker halts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_halt_statistics():
    """
    Get trading halt monitoring statistics

    Returns aggregated stats from database:
    - Total halts detected
    - Halts for tracked M&A targets
    - Material news halts (T1/T2)
    - Unique tickers halted
    - Recent activity
    """
    try:
        monitor = get_halt_monitor()

        async with monitor.db_pool.acquire() as conn:
            stats = await conn.fetchrow("SELECT * FROM halt_monitor_stats")

            return {
                "total_halts": stats['total_halts'],
                "tracked_ticker_halts": stats['tracked_ticker_halts'],
                "material_news_halts": stats['material_news_halts'],
                "unique_tickers": stats['unique_tickers'],
                "unique_tracked_tickers": stats['unique_tracked_tickers'],
                "last_halt_detected": stats['last_halt_detected'].isoformat() if stats['last_halt_detected'] else None,
                "halts_last_hour": stats['halts_last_hour'],
                "halts_last_24h": stats['halts_last_24h']
            }
    except Exception as e:
        logger.error(f"Failed to get halt statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))
