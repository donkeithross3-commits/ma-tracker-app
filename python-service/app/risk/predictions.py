"""Prediction registry: parse, store, resolve, and score deal predictions.

Stores explicit, falsifiable predictions from AI risk assessments.
Predictions are auto-resolved when deal outcomes or milestone statuses change.
Brier scores are computed for calibration tracking.
"""

import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal

logger = logging.getLogger(__name__)


def _json_default(o):
    """Handle Decimal/date/UUID from asyncpg in json.dumps."""
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, uuid.UUID):
        return str(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")

VALID_PREDICTION_TYPES = frozenset({
    "deal_closes", "milestone_completion",
    "spread_direction", "break_price", "next_event",
})

CALIBRATION_BUCKETS = [
    (0.9, 1.0, "90-100"),
    (0.8, 0.9, "80-90"),
    (0.7, 0.8, "70-80"),
    (0.6, 0.7, "60-70"),
    (0.5, 0.6, "50-60"),
    (0.0, 0.5, "0-50"),
]


def _get_calibration_bucket(prob: float) -> str:
    """Map a probability to its calibration bucket label."""
    for low, high, label in CALIBRATION_BUCKETS:
        if low <= prob < high:
            return label
    return "90-100" if prob >= 1.0 else "0-50"


def _parse_date(val) -> date | None:
    """Safely parse a YYYY-MM-DD string or date object."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    try:
        return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


async def store_predictions(
    pool,
    ticker: str,
    assessment_date: date,
    assessment_id: uuid.UUID,
    predictions: list[dict],
) -> int:
    """Parse and store predictions from an AI assessment response.

    Supersedes open predictions of the same type for the same ticker
    before inserting new ones. Returns the count of predictions stored.
    """
    if not predictions:
        return 0

    stored = 0
    async with pool.acquire() as conn:
        # Wrap all supersede+insert pairs in a transaction for atomicity
        async with conn.transaction():
            for pred in predictions:
                pred_type = pred.get("type")
                if pred_type not in VALID_PREDICTION_TYPES:
                    logger.warning("Unknown prediction type: %s", pred_type)
                    continue

                probability = pred.get("probability")
                if probability is None:
                    continue
                try:
                    probability = float(probability)
                except (ValueError, TypeError):
                    continue
                if not (0.0 <= probability <= 1.0):
                    logger.warning("Probability out of range: %s", probability)
                    continue

                confidence = None
                if pred.get("confidence") is not None:
                    try:
                        confidence = float(pred["confidence"])
                    except (ValueError, TypeError):
                        pass

                by_date = _parse_date(pred.get("by_date"))
                claim = pred.get("claim", "")
                evidence = pred.get("evidence", [])

                # Supersede previous open predictions of same type for this ticker
                await conn.execute(
                    """UPDATE deal_predictions
                       SET status = 'superseded'::prediction_status,
                           updated_at = NOW()
                       WHERE ticker = $1
                         AND prediction_type = $2::prediction_type
                         AND status = 'open'::prediction_status""",
                    ticker, pred_type,
                )

                bucket = _get_calibration_bucket(probability)

                await conn.execute(
                    """INSERT INTO deal_predictions
                       (ticker, assessment_date, assessment_id,
                        prediction_type, claim, by_date, probability,
                        confidence, evidence, calibration_bucket)
                       VALUES ($1, $2, $3,
                               $4::prediction_type, $5, $6, $7,
                               $8, $9::jsonb, $10)""",
                ticker, assessment_date, assessment_id,
                pred_type, claim, by_date, probability,
                confidence, json.dumps(evidence, default=_json_default), bucket,
            )
            stored += 1

    logger.info("Stored %d predictions for %s", stored, ticker)
    return stored


async def resolve_from_outcome(pool, ticker: str) -> int:
    """Auto-resolve deal_closes predictions when an outcome is recorded.

    Computes Brier score: (predicted_probability - actual)^2
    where actual = 1.0 if deal closed, 0.0 if it broke/withdrew.

    Returns count of predictions resolved.
    """
    resolved = 0
    async with pool.acquire() as conn:
        outcome = await conn.fetchrow(
            "SELECT * FROM deal_outcomes WHERE ticker = $1", ticker
        )
        if not outcome:
            return 0

        deal_closed = outcome["outcome"] in ("closed_at_deal", "closed_higher")

        # Resolve all open deal_closes predictions
        open_preds = await conn.fetch(
            """SELECT id, probability FROM deal_predictions
               WHERE ticker = $1
                 AND prediction_type = 'deal_closes'::prediction_type
                 AND status = 'open'::prediction_status""",
            ticker,
        )
        for pred in open_preds:
            actual = 1.0 if deal_closed else 0.0
            brier = (float(pred["probability"]) - actual) ** 2
            resolution_status = "resolved_correct" if (
                (deal_closed and float(pred["probability"]) >= 0.5) or
                (not deal_closed and float(pred["probability"]) < 0.5)
            ) else "resolved_incorrect"

            await conn.execute(
                """UPDATE deal_predictions
                   SET status = $2::prediction_status,
                       resolved_at = NOW(),
                       actual_outcome = $3,
                       brier_score = $4,
                       resolution_source = 'deal_outcome',
                       resolution_detail = $5,
                       updated_at = NOW()
                   WHERE id = $1""",
                pred["id"], resolution_status, deal_closed,
                brier, outcome["outcome"],
            )
            resolved += 1

        # Resolve break_price predictions if deal broke
        if not deal_closed and outcome.get("outcome_price"):
            break_preds = await conn.fetch(
                """SELECT id, probability FROM deal_predictions
                   WHERE ticker = $1
                     AND prediction_type = 'break_price'::prediction_type
                     AND status = 'open'::prediction_status""",
                ticker,
            )
            for pred in break_preds:
                await conn.execute(
                    """UPDATE deal_predictions
                       SET status = 'resolved_partial'::prediction_status,
                           resolved_at = NOW(),
                           actual_value = $2,
                           resolution_source = 'deal_outcome',
                           resolution_detail = $3,
                           updated_at = NOW()
                       WHERE id = $1""",
                    pred["id"], float(outcome["outcome_price"]),
                    outcome["outcome"],
                )
                resolved += 1

    if resolved:
        logger.info("Resolved %d predictions for %s from outcome", resolved, ticker)
    return resolved


async def resolve_from_milestones(pool, ticker: str) -> int:
    """Auto-resolve milestone_completion predictions from milestone status changes.

    Matches prediction claims against completed/failed milestones by looking
    for the milestone type name in the claim text (case-insensitive).

    Returns count of predictions resolved.
    """
    resolved = 0
    async with pool.acquire() as conn:
        # Get completed/failed milestones
        resolved_milestones = await conn.fetch(
            """SELECT milestone_type, status, milestone_date
               FROM canonical_deal_milestones
               WHERE ticker = $1 AND status IN ('completed', 'failed')""",
            ticker,
        )

        for ms in resolved_milestones:
            ms_type = ms["milestone_type"].replace("_", " ")
            completed = ms["status"] == "completed"

            # Find matching open milestone predictions
            matching = await conn.fetch(
                """SELECT id, probability, claim FROM deal_predictions
                   WHERE ticker = $1
                     AND prediction_type = 'milestone_completion'::prediction_type
                     AND status = 'open'::prediction_status
                     AND LOWER(claim) LIKE $2""",
                ticker, f"%{ms_type}%",
            )
            for pred in matching:
                actual = 1.0 if completed else 0.0
                brier = (float(pred["probability"]) - actual) ** 2
                resolution_status = "resolved_correct" if (
                    (completed and float(pred["probability"]) >= 0.5) or
                    (not completed and float(pred["probability"]) < 0.5)
                ) else "resolved_incorrect"

                await conn.execute(
                    """UPDATE deal_predictions
                       SET status = $2::prediction_status,
                           resolved_at = NOW(),
                           actual_outcome = $3,
                           brier_score = $4,
                           resolution_source = 'milestone_status',
                           resolution_detail = $5,
                           updated_at = NOW()
                       WHERE id = $1""",
                    pred["id"], resolution_status, completed,
                    brier, f"{ms['milestone_type']} {ms['status']}",
                )
                resolved += 1

    if resolved:
        logger.info("Resolved %d milestone predictions for %s", resolved, ticker)
    return resolved


async def expire_overdue_predictions(pool) -> int:
    """Mark predictions past their by_date as expired.

    Returns count of predictions expired.
    """
    async with pool.acquire() as conn:
        result = await conn.execute(
            """UPDATE deal_predictions
               SET status = 'expired'::prediction_status,
                   updated_at = NOW()
               WHERE status = 'open'::prediction_status
                 AND by_date < CURRENT_DATE"""
        )

    # result format: "UPDATE N"
    count = 0
    if result:
        try:
            count = int(result.split()[-1])
        except (ValueError, IndexError):
            pass

    if count:
        logger.info("Expired %d overdue predictions", count)
    return count
