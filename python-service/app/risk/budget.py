"""API Budget Tracker — self-tracked Anthropic API balance.

The Anthropic API has no programmatic balance endpoint, so we maintain a
ledger of known balance snapshots and credit additions.  Costs are pulled
from risk_assessment_runs.total_cost_usd (already tracked by the engine).

Balance = last balance_set
        + SUM(credit_added since that snapshot)
        - SUM(risk run costs since that snapshot)
"""

import logging
import os
from datetime import date, datetime, timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)

# Configurable thresholds (USD)
BUDGET_WARN_USD = float(os.environ.get("RISK_BUDGET_WARN_USD", "5.0"))
BUDGET_MIN_USD = float(os.environ.get("RISK_BUDGET_MIN_USD", "2.0"))

# Default estimated cost per deal (used for pre-run estimation)
DEFAULT_COST_PER_DEAL = float(os.environ.get("RISK_AVG_COST_PER_DEAL", "0.03"))


async def get_estimated_balance(pool) -> dict:
    """Compute the estimated API balance from the ledger and run costs.

    Returns dict with:
        estimated_balance: float
        last_snapshot_at: datetime or None
        costs_since_snapshot: float
        credits_since_snapshot: float
        costs_today: float
        costs_this_week: float
    """
    async with pool.acquire() as conn:
        # Find the most recent balance_set event (our anchor point)
        snapshot = await conn.fetchrow(
            """SELECT amount, created_at FROM api_budget_ledger
               WHERE event_type = 'balance_set'
               ORDER BY created_at DESC LIMIT 1"""
        )

        if not snapshot:
            return {
                "estimated_balance": 0.0,
                "last_snapshot_at": None,
                "costs_since_snapshot": 0.0,
                "credits_since_snapshot": 0.0,
                "costs_today": 0.0,
                "costs_this_week": 0.0,
            }

        snapshot_amount = float(snapshot["amount"])
        snapshot_at = snapshot["created_at"]

        # Sum credits added since the snapshot
        credits_row = await conn.fetchrow(
            """SELECT COALESCE(SUM(amount), 0) AS total
               FROM api_budget_ledger
               WHERE event_type = 'credit_added' AND created_at > $1""",
            snapshot_at,
        )
        credits_since = float(credits_row["total"])

        # Sum risk run costs since the snapshot
        costs_row = await conn.fetchrow(
            """SELECT COALESCE(SUM(total_cost_usd), 0) AS total
               FROM risk_assessment_runs
               WHERE started_at > $1 AND total_cost_usd IS NOT NULL""",
            snapshot_at,
        )
        costs_since = float(costs_row["total"])

        # Costs today
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_row = await conn.fetchrow(
            """SELECT COALESCE(SUM(total_cost_usd), 0) AS total
               FROM risk_assessment_runs
               WHERE started_at >= $1 AND total_cost_usd IS NOT NULL""",
            today_start,
        )
        costs_today = float(today_row["total"])

        # Costs this week (last 7 days)
        week_start = today_start - timedelta(days=7)
        week_row = await conn.fetchrow(
            """SELECT COALESCE(SUM(total_cost_usd), 0) AS total
               FROM risk_assessment_runs
               WHERE started_at >= $1 AND total_cost_usd IS NOT NULL""",
            week_start,
        )
        costs_this_week = float(week_row["total"])

        estimated_balance = snapshot_amount + credits_since - costs_since

        return {
            "estimated_balance": round(estimated_balance, 4),
            "last_snapshot_at": snapshot_at.isoformat() if snapshot_at else None,
            "costs_since_snapshot": round(costs_since, 4),
            "credits_since_snapshot": round(credits_since, 4),
            "costs_today": round(costs_today, 4),
            "costs_this_week": round(costs_this_week, 4),
        }


async def record_credit(pool, amount: float, notes: str = None) -> dict:
    """Record a credit addition to the budget ledger."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO api_budget_ledger (event_type, amount, notes)
               VALUES ('credit_added', $1, $2)
               RETURNING id, created_at""",
            amount, notes,
        )
    logger.info("Recorded credit of $%.2f: %s", amount, notes or "(no notes)")
    return {"id": row["id"], "created_at": row["created_at"].isoformat()}


async def set_balance(pool, balance: float, notes: str = None) -> dict:
    """Set a new balance snapshot (recalibration point)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO api_budget_ledger (event_type, amount, notes)
               VALUES ('balance_set', $1, $2)
               RETURNING id, created_at""",
            balance, notes,
        )
    logger.info("Set balance to $%.2f: %s", balance, notes or "(no notes)")
    return {"id": row["id"], "created_at": row["created_at"].isoformat()}


async def check_budget(pool, estimated_run_cost: float = 0.0) -> dict:
    """Check whether the budget allows a risk assessment run.

    Returns:
        ok: bool — True if balance is above minimum
        balance: float — current estimated balance
        warning: str or None — warning message if balance is low
    """
    info = await get_estimated_balance(pool)
    balance = info["estimated_balance"]
    projected = balance - estimated_run_cost

    if projected < BUDGET_MIN_USD:
        return {
            "ok": False,
            "balance": balance,
            "estimated_run_cost": round(estimated_run_cost, 4),
            "projected_after_run": round(projected, 4),
            "warning": (
                f"BUDGET BLOCK: Estimated balance ${balance:.2f} minus "
                f"run cost ${estimated_run_cost:.2f} = ${projected:.2f}, "
                f"below minimum ${BUDGET_MIN_USD:.2f}. "
                f"Add credits or recalibrate via POST /risk/budget/set."
            ),
        }

    warning = None
    if projected < BUDGET_WARN_USD:
        warning = (
            f"LOW BUDGET WARNING: Estimated balance ${balance:.2f} minus "
            f"run cost ${estimated_run_cost:.2f} = ${projected:.2f}, "
            f"approaching minimum ${BUDGET_MIN_USD:.2f}."
        )

    return {
        "ok": True,
        "balance": balance,
        "estimated_run_cost": round(estimated_run_cost, 4),
        "projected_after_run": round(projected, 4),
        "warning": warning,
    }
