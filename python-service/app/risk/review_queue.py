"""Human review queue: prioritize and populate review items after assessments.

Surfaces the highest-information-value cases for human PM review:
- Three-way signal disagreements (AI vs sheet vs options)
- Significant AI probability/grade changes
- Poor prediction scores (Brier > 0.20)
- New milestone events

Feature-gated by RISK_REVIEW_QUEUE env var.
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


async def generate_review_items(pool, run_id: uuid.UUID, run_date: date) -> list[dict]:
    """Generate review queue items after a morning assessment run.

    Called at the end of run_morning_assessment(). Returns list of created items.
    """
    items = []

    async with pool.acquire() as conn:
        assessments = await conn.fetch(
            "SELECT * FROM deal_risk_assessments WHERE run_id = $1",
            run_id,
        )

        for assessment in assessments:
            a = dict(assessment)
            ticker = a["ticker"]
            assessment_id = a["id"]

            # Parse ai_response for change details
            ai_resp = a.get("ai_response")
            if isinstance(ai_resp, str):
                try:
                    ai_resp = json.loads(ai_resp)
                except (TypeError, ValueError):
                    ai_resp = {}
            if not isinstance(ai_resp, dict):
                ai_resp = {}

            # Case 1: Three-way disagreement
            priority = await _score_three_way_disagreement(conn, a)
            if priority > 0:
                ctx = _build_context_snapshot(a, ai_resp, "three_way_disagreement")
                item = await _upsert_review_item(
                    conn, ticker, run_date, "three_way_disagreement",
                    priority, ctx, assessment_id,
                )
                if item:
                    items.append(item)

            # Case 2: Significant AI change
            priority = _score_significant_change(ai_resp)
            if priority > 0:
                ctx = _build_context_snapshot(a, ai_resp, "significant_ai_change")
                item = await _upsert_review_item(
                    conn, ticker, run_date, "significant_ai_change",
                    priority, ctx, assessment_id,
                )
                if item:
                    items.append(item)

            # Case 3: Poor prediction score
            priority = await _score_poor_prediction(conn, ticker)
            if priority > 0:
                ctx = _build_context_snapshot(a, ai_resp, "poor_prediction_score")
                item = await _upsert_review_item(
                    conn, ticker, run_date, "poor_prediction_score",
                    priority, ctx, assessment_id,
                )
                if item:
                    items.append(item)

            # Case 4: New milestone event
            priority = await _score_new_milestone(conn, ticker)
            if priority > 0:
                ctx = _build_context_snapshot(a, ai_resp, "new_milestone")
                item = await _upsert_review_item(
                    conn, ticker, run_date, "new_milestone",
                    priority, ctx, assessment_id,
                )
                if item:
                    items.append(item)

    if items:
        logger.info("Generated %d review items for run %s", len(items), run_id)
    return items


async def _score_three_way_disagreement(conn, assessment: dict) -> float:
    """Score based on divergence between AI, sheet, and options-implied signals.

    Returns priority score (0 = no review needed, 100 = urgent).
    """
    score = 0.0
    ticker = assessment["ticker"]

    # Probability divergence: AI vs sheet
    ai_prob = assessment.get("our_prob_success")
    sheet_prob = assessment.get("sheet_prob_success")
    if ai_prob is not None and sheet_prob is not None:
        try:
            gap = abs(float(ai_prob) - float(sheet_prob))
            if gap > 0.10:
                score += 30 + (gap - 0.10) * 200
        except (ValueError, TypeError):
            pass

    # Options-implied divergence
    try:
        options_prob = await conn.fetchval("""
            SELECT options_implied_prob FROM deal_estimate_snapshots
            WHERE ticker = $1 AND snapshot_date = CURRENT_DATE
        """, ticker)
        if options_prob is not None and ai_prob is not None:
            options_gap = abs(float(options_prob) - float(ai_prob))
            if options_gap > 0.10:
                score += 20
    except Exception:
        pass  # Table may not exist yet

    return min(score, 100)


def _score_significant_change(ai_resp: dict) -> float:
    """Score based on magnitude of AI assessment change from yesterday."""
    changes = ai_resp.get("assessment_changes", [])
    if not changes:
        return 0.0

    score = 0.0
    for change in changes:
        if change.get("direction") == "worsened":
            score += 20
        else:
            score += 10
        if change.get("factor") in ("vote", "financing", "legal", "regulatory", "mac"):
            score += 15

    return min(score, 80)


async def _score_poor_prediction(conn, ticker: str) -> float:
    """Score based on recent prediction accuracy for this deal."""
    try:
        row = await conn.fetchrow("""
            SELECT brier_score FROM deal_predictions
            WHERE ticker = $1
              AND status IN ('resolved_correct', 'resolved_incorrect')
              AND brier_score IS NOT NULL
            ORDER BY resolved_at DESC LIMIT 1
        """, ticker)
    except Exception:
        return 0.0

    if not row or row["brier_score"] is None:
        return 0.0

    brier = float(row["brier_score"])
    if brier > 0.20:
        return min(40 + (brier - 0.20) * 200, 80)
    return 0.0


async def _score_new_milestone(conn, ticker: str) -> float:
    """Score based on recent milestone completions/failures."""
    try:
        milestones = await conn.fetch("""
            SELECT milestone_type, status, updated_at
            FROM canonical_deal_milestones
            WHERE ticker = $1
              AND updated_at > NOW() - INTERVAL '24 hours'
              AND status IN ('completed', 'failed')
        """, ticker)
    except Exception:
        return 0.0

    if not milestones:
        return 0.0

    high_impact = {
        "shareholder_vote", "hsr_clearance", "hsr_second_request",
        "eu_phase2", "cfius_clearance", "closing", "termination",
    }
    score = 0.0
    for m in milestones:
        if m["milestone_type"] in high_impact:
            score += 35
        else:
            score += 15

    return min(score, 70)


def _build_context_snapshot(assessment: dict, ai_resp: dict, case_type: str) -> dict:
    """Build a compact context snapshot for the review item."""
    ctx = {
        "ai_prob": float(assessment["our_prob_success"]) if assessment.get("our_prob_success") else None,
        "deal_summary": ai_resp.get("deal_summary"),
    }

    # Add grade info
    for factor in ("vote", "financing", "legal", "regulatory", "mac"):
        grade = assessment.get(f"{factor}_grade")
        if grade:
            ctx[f"ai_{factor}"] = grade

    if case_type == "significant_ai_change":
        ctx["changes"] = ai_resp.get("assessment_changes", [])

    return ctx


async def _upsert_review_item(
    conn, ticker: str, review_date: date, case_type: str,
    priority: float, context: dict, assessment_id: uuid.UUID,
) -> dict | None:
    """Insert or update a review item (upsert on unique constraint)."""
    try:
        await conn.execute("""
            INSERT INTO human_review_items
                (ticker, review_date, case_type, priority_score, context, assessment_id)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
            ON CONFLICT (ticker, review_date, case_type) DO UPDATE
            SET priority_score = GREATEST(human_review_items.priority_score, EXCLUDED.priority_score),
                context = EXCLUDED.context,
                assessment_id = EXCLUDED.assessment_id,
                updated_at = NOW()
        """, ticker, review_date, case_type, priority,
            json.dumps(context, default=_json_default), assessment_id,
        )
        return {
            "ticker": ticker,
            "case_type": case_type,
            "priority_score": priority,
        }
    except Exception as e:
        logger.warning("Failed to upsert review item for %s: %s", ticker, e)
        return None


def format_corrections_for_prompt(corrections: list[dict]) -> str | None:
    """Format recent human corrections as a prompt section.

    Returns None if no corrections available.
    """
    if not corrections:
        return None

    lines = ["## HUMAN CORRECTIONS (from portfolio manager review)"]
    for c in corrections[-3:]:  # Last 3 only
        date_str = c.get("annotation_date", "?")
        lines.append(f"- [{date_str}] Correct signal: {c.get('correct_signal', '?')}")

        corrected_grades = c.get("corrected_grades")
        if isinstance(corrected_grades, str):
            try:
                corrected_grades = json.loads(corrected_grades)
            except (TypeError, ValueError):
                corrected_grades = None
        if isinstance(corrected_grades, dict):
            for factor, data in corrected_grades.items():
                if isinstance(data, dict):
                    lines.append(
                        f"  {factor} corrected to {data.get('corrected_grade')}: "
                        f"{data.get('reasoning', '')}"
                    )

        if c.get("missed_reasoning"):
            lines.append(f"  Reasoning you missed: {c['missed_reasoning']}")
        if c.get("error_type"):
            lines.append(f"  Error pattern: {c['error_type']}")

    lines.append("")
    lines.append(
        "Incorporate these corrections. Avoid repeating the same error patterns."
    )
    lines.append("")
    return "\n".join(lines)
