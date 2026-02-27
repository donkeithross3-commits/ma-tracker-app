"""Position tracker — fetch IB M&A positions, snapshot to DB, surface held tickers.

Used by the morning pipeline to:
1. Gate outcome detection (don't suggest closed if still held)
2. Add "Owned" flag to the morning report
3. Provide position context for AI risk assessments
"""

import logging
from datetime import date

import httpx

logger = logging.getLogger(__name__)

# Main service relay endpoint (portfolio service → main service on port 8000)
MA_POSITIONS_URL = "http://localhost:8000/options/relay/ma-positions"


async def fetch_ma_positions(timeout: float = 20.0) -> list[dict]:
    """Fetch M&A account positions via the relay endpoint.

    Graceful timeout — the IB agent may not be connected at 5 AM.
    Returns empty list on any failure.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(MA_POSITIONS_URL)
            resp.raise_for_status()
            data = resp.json()
            positions = data.get("positions", [])
            logger.info(
                "Fetched %d MA positions (account=%s)",
                len(positions), data.get("account", "?"),
            )
            return positions
    except httpx.TimeoutException:
        logger.warning("MA positions fetch timed out (agent may not be connected)")
        return []
    except httpx.HTTPStatusError as e:
        logger.warning("MA positions fetch HTTP error: %s", e.response.status_code)
        return []
    except Exception as e:
        logger.warning("MA positions fetch failed: %s", e)
        return []


async def snapshot_positions(pool, positions: list[dict], snapshot_date: date | None = None) -> dict:
    """Upsert STK positions into deal_position_snapshots for today's date.

    Returns {"stored": N, "tickers": [...]}.
    """
    if snapshot_date is None:
        snapshot_date = date.today()

    # IB positions nest symbol/secType inside a "contract" dict
    stored = 0
    tickers = []

    async with pool.acquire() as conn:
        for pos in positions:
            contract = pos.get("contract", {})
            sec_type = contract.get("secType") or pos.get("secType", "STK")
            if sec_type != "STK":
                continue
            ticker = contract.get("symbol") or pos.get("symbol") or pos.get("ticker")
            if not ticker:
                continue
            qty = pos.get("position", pos.get("pos", 0))
            avg_cost = pos.get("avgCost", pos.get("avg_cost"))
            account = pos.get("account", "U22596909")

            await conn.execute(
                """INSERT INTO deal_position_snapshots
                       (snapshot_date, ticker, account, position_qty, avg_cost, sec_type)
                   VALUES ($1, $2, $3, $4, $5, 'STK')
                   ON CONFLICT (snapshot_date, ticker, account, sec_type) DO UPDATE SET
                       position_qty = EXCLUDED.position_qty,
                       avg_cost = EXCLUDED.avg_cost""",
                snapshot_date, ticker, account, qty, avg_cost,
            )
            stored += 1
            tickers.append(ticker)

    logger.info("Snapshot stored: %d STK positions for %s", stored, snapshot_date)
    return {"stored": stored, "tickers": tickers}


async def get_held_tickers(pool) -> set[str]:
    """Return tickers with positive STK positions from the latest snapshot date.

    Returns empty set if no snapshots exist.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT DISTINCT ticker FROM deal_position_snapshots
               WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM deal_position_snapshots)
                 AND position_qty > 0
                 AND sec_type = 'STK'"""
        )
    held = {r["ticker"] for r in rows}
    if held:
        logger.info("Held tickers (%d): %s", len(held), ", ".join(sorted(held)))
    return held
