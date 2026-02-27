"""Backfill historical deal outcomes from sheet_diffs and sheet_rows data.

Queries ALL historical 'removed' entries from sheet_diffs (not limited to 7 days),
joins with the last sheet_rows snapshot before removal to infer outcome type based
on price convergence/divergence from deal price.
"""

import logging
from datetime import date

logger = logging.getLogger(__name__)


async def get_backfill_candidates(pool) -> list[dict]:
    """Find historical deals removed from the sheet that lack recorded outcomes.

    Returns candidates with inferred outcome type based on price at removal:
    - current_price within 1% of deal_price → likely closed_at_deal
    - current_price > deal_price → likely closed_higher
    - current_price < deal_price by >5% → likely broke or withdrawn
    - Otherwise → uncertain (needs manual review)
    """
    candidates = []

    async with pool.acquire() as conn:
        # Find all removed tickers that don't already have an outcome recorded
        removed = await conn.fetch("""
            SELECT DISTINCT ON (sd.ticker)
                sd.ticker,
                sd.detected_at::date AS removed_date,
                sd.snapshot_id
            FROM sheet_diffs sd
            LEFT JOIN deal_outcomes dout ON dout.ticker = sd.ticker
            WHERE sd.diff_type = 'removed'
              AND dout.ticker IS NULL
            ORDER BY sd.ticker, sd.detected_at DESC
        """)

        for r in removed:
            ticker = r["ticker"]
            removed_date = r["removed_date"]

            # Get the last sheet_rows snapshot BEFORE (or at) removal to capture
            # the deal_price and current_price at exit
            last_row = await conn.fetchrow("""
                SELECT sr.deal_price, sr.current_price
                FROM sheet_rows sr
                JOIN sheet_snapshots ss ON ss.id = sr.snapshot_id
                WHERE sr.ticker = $1
                  AND ss.snapshot_date <= $2
                ORDER BY ss.snapshot_date DESC, ss.ingested_at DESC
                LIMIT 1
            """, ticker, removed_date)

            deal_price = float(last_row["deal_price"]) if (last_row and last_row["deal_price"]) else None
            current_price = float(last_row["current_price"]) if (last_row and last_row["current_price"]) else None

            # Count tracking days (how many estimate snapshots we have)
            days_tracked = await conn.fetchval(
                "SELECT COUNT(*) FROM deal_estimate_snapshots WHERE ticker = $1",
                ticker,
            )

            # Infer outcome type based on price relationship
            inferred_outcome = "unknown"
            confidence = "low"

            if deal_price and current_price and deal_price > 0:
                pct_diff = (current_price - deal_price) / deal_price

                if abs(pct_diff) < 0.01:
                    # Within 1% of deal price — likely closed at deal
                    inferred_outcome = "closed_at_deal"
                    confidence = "high"
                elif pct_diff > 0:
                    # Above deal price — likely closed higher (competing bid?)
                    inferred_outcome = "closed_higher"
                    confidence = "medium"
                elif pct_diff < -0.05:
                    # >5% below deal price — likely broke or withdrawn
                    inferred_outcome = "broke"
                    confidence = "medium"
                else:
                    # 1-5% below — could be timing, minor slippage, or break
                    inferred_outcome = "closed_at_deal"
                    confidence = "low"

            candidates.append({
                "ticker": ticker,
                "removed_date": str(removed_date),
                "deal_price": deal_price,
                "last_price": current_price,
                "inferred_outcome": inferred_outcome,
                "confidence": confidence,
                "days_tracked": days_tracked or 0,
            })

    # Sort by confidence (high first), then by days_tracked descending
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    candidates.sort(key=lambda c: (confidence_order.get(c["confidence"], 3), -c["days_tracked"]))

    logger.info("Found %d backfill outcome candidates", len(candidates))
    return candidates


async def backfill_outcomes(pool, confirmed: list[dict]) -> dict:
    """Record confirmed outcomes from the backfill review.

    Each item in `confirmed` must have:
    - ticker: str
    - outcome: str (closed_at_deal, closed_higher, broke, withdrawn, etc.)
    - outcome_price: float
    - outcome_date: str (YYYY-MM-DD)

    Optional fields: original_deal_price, outcome_notes

    Returns summary of results.
    """
    from .estimate_tracker import record_outcome

    recorded = 0
    failed = []

    for item in confirmed:
        ticker = item.get("ticker")
        outcome = item.get("outcome")
        outcome_price = item.get("outcome_price")
        outcome_date_str = item.get("outcome_date")

        if not all([ticker, outcome, outcome_price is not None, outcome_date_str]):
            failed.append({"ticker": ticker or "?", "error": "missing required fields"})
            continue

        try:
            outcome_date = date.fromisoformat(outcome_date_str) if isinstance(outcome_date_str, str) else outcome_date_str
        except (ValueError, TypeError):
            failed.append({"ticker": ticker, "error": f"invalid date: {outcome_date_str}"})
            continue

        try:
            kwargs = {}
            if item.get("original_deal_price") is not None:
                kwargs["original_deal_price"] = float(item["original_deal_price"])
            if item.get("outcome_notes"):
                kwargs["outcome_notes"] = item["outcome_notes"]

            await record_outcome(
                pool, ticker, outcome, outcome_date, float(outcome_price),
                **kwargs,
            )
            recorded += 1
            logger.info("Backfilled outcome for %s: %s at $%.2f", ticker, outcome, outcome_price)
        except Exception as e:
            logger.error("Failed to backfill outcome for %s: %s", ticker, e, exc_info=True)
            failed.append({"ticker": ticker, "error": str(e)})

    result = {
        "recorded": recorded,
        "failed": len(failed),
        "total": len(confirmed),
        "failures": failed,
    }
    logger.info("Backfill complete: %d recorded, %d failed out of %d", recorded, len(failed), len(confirmed))
    return result
