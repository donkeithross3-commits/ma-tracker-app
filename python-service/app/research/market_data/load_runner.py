"""
Market Data Load Runner — Stock + Options from Polygon

Runs on the droplet to load historical market data for research deals.
Processes deals in batches, loading stock data first (fast), then options
(slower, requires chain reconstruction + IV computation).

Usage:
    python -m app.research.market_data.load_runner --mode stock --limit 200
    python -m app.research.market_data.load_runner --mode options --limit 50
    python -m app.research.market_data.load_runner --mode both --limit 100
"""

import asyncio
import logging
import os
from datetime import date
from pathlib import Path
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)


async def load_stock_data(limit: int = 200) -> dict:
    """Load daily stock OHLCV for deals with tickers."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    from .stock_loader import StockDataLoader

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    loader = StockDataLoader()

    try:
        result = await loader.load_all_deals(conn, limit=limit)
        logger.info(f"Stock data loading complete: {result}")
        return result
    finally:
        await loader.close()
        await conn.close()


async def load_options_data(limit: int = 50, min_year: int = 2019) -> dict:
    """Load historical options chain data for deals (2019+ only)."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    from .options_loader import OptionsDataLoader

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    loader = OptionsDataLoader()

    try:
        result = await loader.load_all_deals(conn, limit=limit, min_year=min_year)
        logger.info(f"Options data loading complete: {result}")
        return result
    finally:
        await loader.close()
        await conn.close()


async def run(mode: str = "stock", limit: int = 200, min_year: int = 2019) -> dict:
    """Run market data loading."""
    results = {}

    if mode in ("stock", "both"):
        logger.info(f"Loading stock data for up to {limit} deals...")
        results["stock"] = await load_stock_data(limit=limit)

    if mode in ("options", "both"):
        logger.info(f"Loading options data for up to {limit} deals (>= {min_year})...")
        results["options"] = await load_options_data(limit=limit, min_year=min_year)

    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Load market data for research deals")
    parser.add_argument("--mode", choices=["stock", "options", "both"], default="stock")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--min-year", type=int, default=2019, help="Min year for options data")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run(mode=args.mode, limit=args.limit, min_year=args.min_year))
    print(f"Done: {result}")
