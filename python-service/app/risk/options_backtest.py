"""Options backtesting framework for covered call strategies.

Queries historical deal_options_snapshots and calculates PnL for
covered calls that would have been written at each snapshot.
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


async def backtest_covered_calls(pool, ticker: str, outcome: dict) -> dict:
    """Backtest covered calls on a ticker using historical snapshots.

    Args:
        pool: asyncpg connection pool.
        ticker: Underlying ticker symbol.
        outcome: Dict with deal outcome info:
            - deal_price: Final deal price per share.
            - close_date: Date the deal closed (or expected close).
            - status: 'completed', 'terminated', etc.

    Returns:
        Dict with ticker, trades (list), and total_pnl.
    """
    deal_price = outcome.get("deal_price", 0)
    close_date = outcome.get("close_date")
    status = outcome.get("status", "completed")

    rows = await pool.fetch(
        """
        SELECT snapshot_date, atm_iv, cc_best_strike, cc_best_expiry,
               cc_best_premium, cc_best_ann_yield, cc_best_cushion_pct
        FROM deal_options_snapshots
        WHERE ticker = $1
          AND cc_best_strike IS NOT NULL
          AND cc_best_premium IS NOT NULL
        ORDER BY snapshot_date ASC
        """,
        ticker.upper(),
    )

    if not rows:
        return {"ticker": ticker, "trades": [], "total_pnl": 0.0}

    trades = []
    total_pnl = 0.0

    for row in rows:
        strike = float(row["cc_best_strike"])
        premium = float(row["cc_best_premium"])
        expiry_str = row["cc_best_expiry"]
        snap_date = row["snapshot_date"]

        # Determine if the call expired worthless or was exercised
        if status == "completed" and deal_price > 0:
            # Deal closed — shares get taken at deal price
            if deal_price >= strike:
                # Called away at strike: lose upside above strike but keep premium
                pnl = premium  # premium collected, shares delivered at strike
            else:
                # Expired worthless (deal price below strike): keep premium + shares
                pnl = premium
        elif status == "terminated":
            # Deal broke — no forced assignment at deal price
            # Assume share price dropped; call expires worthless
            pnl = premium
        else:
            # Unknown outcome — assume premium kept
            pnl = premium

        trade = {
            "snapshot_date": str(snap_date),
            "strike": strike,
            "expiry": expiry_str,
            "premium": round(premium, 4),
            "ann_yield": float(row["cc_best_ann_yield"]) if row["cc_best_ann_yield"] else None,
            "cushion_pct": float(row["cc_best_cushion_pct"]) if row["cc_best_cushion_pct"] else None,
            "pnl": round(pnl, 4),
        }
        trades.append(trade)
        total_pnl += pnl

    return {
        "ticker": ticker,
        "trades": trades,
        "total_pnl": round(total_pnl, 4),
    }
