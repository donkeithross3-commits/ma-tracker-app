"""
Stock Market Data Loader — Polygon Daily OHLCV for Deal Windows

For each deal, fetches daily stock data from 30 trading days before announcement
through close/termination + 5 days. Also fetches S&P 500 and VIX for context.

Uses the existing Polygon API key (POLYGON_API_KEY environment variable).
"""

import asyncio
import logging
import os
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import asyncpg
import httpx

logger = logging.getLogger(__name__)

POLYGON_BASE_URL = "https://api.polygon.io"
POLYGON_RATE_LIMIT = 0.1  # 10 req/sec on paid plan


class StockDataLoader:
    """
    Loads daily stock data from Polygon for research deals.

    Stores in research_market_daily with computed spread metrics.
    """

    def __init__(self):
        self.api_key = os.environ.get("POLYGON_API_KEY", "")
        self.client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def fetch_daily_bars(
        self,
        ticker: str,
        from_date: date,
        to_date: date,
    ) -> List[dict]:
        """
        Fetch daily OHLCV bars from Polygon.

        Endpoint: GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
        """
        client = await self._get_client()

        try:
            await asyncio.sleep(POLYGON_RATE_LIMIT)
            response = await client.get(
                f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/"
                f"{from_date.isoformat()}/{to_date.isoformat()}",
                params={
                    "adjusted": "true",
                    "sort": "asc",
                    "limit": 5000,
                },
            )
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])
            bars = []
            for r in results:
                # Polygon timestamp is in milliseconds
                ts = r.get("t", 0) / 1000
                from datetime import datetime
                bar_date = datetime.utcfromtimestamp(ts).date()

                bars.append({
                    "trade_date": bar_date,
                    "open": r.get("o"),
                    "high": r.get("h"),
                    "low": r.get("l"),
                    "close": r.get("c"),
                    "volume": r.get("v"),
                    "vwap": r.get("vw"),
                })

            return bars

        except Exception as e:
            logger.error(f"Error fetching bars for {ticker}: {e}")
            return []

    async def load_deal_market_data(
        self,
        conn: asyncpg.Connection,
        deal_id: UUID,
        ticker: str,
        announced_date: date,
        end_date: Optional[date] = None,
        deal_price: Optional[float] = None,
        expected_close_date: Optional[date] = None,
    ) -> int:
        """
        Load daily stock data for a single deal.

        Window: 30 trading days before announcement through end_date + 5 days.
        Returns number of rows inserted.
        """
        # Calculate date range
        from_date = announced_date - timedelta(days=45)  # ~30 trading days
        to_date = (end_date or date.today()) + timedelta(days=7)

        bars = await self.fetch_daily_bars(ticker, from_date, to_date)
        if not bars:
            return 0

        # Also fetch SPY (S&P 500 proxy) and VIX for context
        spy_bars = await self.fetch_daily_bars("SPY", from_date, to_date)
        vix_bars = await self.fetch_daily_bars("VIX", from_date, to_date)

        spy_by_date = {b["trade_date"]: b["close"] for b in spy_bars}
        vix_by_date = {b["trade_date"]: b["close"] for b in vix_bars}

        # Insert rows
        inserted = 0
        for bar in bars:
            trade_date = bar["trade_date"]

            # Compute spread metrics if deal price is known
            gross_spread = None
            gross_spread_pct = None
            annualized = None
            days_since = (trade_date - announced_date).days
            days_to_close = None

            if deal_price and bar["close"]:
                gross_spread = deal_price - bar["close"]
                gross_spread_pct = (gross_spread / bar["close"]) * 100
                if expected_close_date and trade_date < expected_close_date:
                    days_to_close = (expected_close_date - trade_date).days
                    if days_to_close > 0:
                        annualized = gross_spread_pct * (365 / days_to_close)

            try:
                await conn.execute(
                    """
                    INSERT INTO research_market_daily (
                        deal_id, ticker, trade_date,
                        open, high, low, close, volume, vwap,
                        deal_price_on_date, gross_spread, gross_spread_pct, annualized_spread,
                        days_since_announce, days_to_expected_close,
                        sp500_close, vix_close, source
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    ON CONFLICT (deal_id, ticker, trade_date) DO UPDATE SET
                        close = $7, volume = $8, deal_price_on_date = $10,
                        gross_spread = $11, gross_spread_pct = $12
                    """,
                    deal_id, ticker, trade_date,
                    bar["open"], bar["high"], bar["low"], bar["close"],
                    bar["volume"], bar["vwap"],
                    deal_price, gross_spread, gross_spread_pct, annualized,
                    days_since, days_to_close,
                    spy_by_date.get(trade_date), vix_by_date.get(trade_date),
                    "polygon",
                )
                inserted += 1
            except Exception as e:
                logger.warning(f"Error inserting market data for {ticker} {trade_date}: {e}")

        # Update deal market data status
        await conn.execute(
            "UPDATE research_deals SET market_data_status = 'complete' WHERE deal_id = $1",
            deal_id,
        )

        logger.info(f"Loaded {inserted} daily bars for {ticker} (deal {deal_id})")
        return inserted

    async def load_all_deals(
        self,
        conn: asyncpg.Connection,
        limit: Optional[int] = None,
    ) -> Dict[str, int]:
        """
        Load market data for all deals that need it.

        Returns summary of results.
        """
        query = """
            SELECT deal_id, target_ticker, announced_date, actual_close_date,
                   terminated_date, expected_close_date, initial_deal_value_mm
            FROM research_deals
            WHERE market_data_status = 'pending'
              AND target_ticker IS NOT NULL
              AND target_ticker != 'UNK'
            ORDER BY announced_date DESC
        """
        if limit:
            query += f" LIMIT {limit}"

        deals = await conn.fetch(query)
        logger.info(f"Loading market data for {len(deals)} deals")

        results = {"loaded": 0, "failed": 0, "total_bars": 0}

        for deal in deals:
            try:
                end_date = deal["actual_close_date"] or deal["terminated_date"]
                rows = await self.load_deal_market_data(
                    conn=conn,
                    deal_id=deal["deal_id"],
                    ticker=deal["target_ticker"],
                    announced_date=deal["announced_date"],
                    end_date=end_date,
                    expected_close_date=deal["expected_close_date"],
                )
                results["loaded"] += 1
                results["total_bars"] += rows
            except Exception as e:
                logger.error(f"Failed to load market data for {deal['target_ticker']}: {e}")
                results["failed"] += 1

        return results
