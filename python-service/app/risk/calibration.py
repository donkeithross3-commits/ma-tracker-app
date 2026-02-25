"""Calibration computation and feedback generation.

Computes how well-calibrated the AI's probability estimates are by comparing
predicted probabilities against actual outcomes. Feeds this back into the
prompt so the AI can self-correct.

Requires resolved predictions from the deal_predictions table (Phase 2).
"""

import logging

logger = logging.getLogger(__name__)

# Risk-factor keywords for claim-text classification
_FACTOR_KEYWORDS = {
    "regulatory": ("regulatory", "hsr", "antitrust", "ftc", "doj", "cfius", "ec approval"),
    "vote": ("vote", "shareholder", "proxy", "meeting"),
    "financing": ("financing", "debt", "credit", "funding", "loan"),
    "legal": ("legal", "lawsuit", "litigation", "injunction", "court"),
}


async def compute_calibration_summary(pool) -> dict:
    """Compute calibration statistics from resolved predictions.

    Queries deal_predictions for resolved predictions, groups by calibration
    bucket, and computes per-factor bias via keyword matching on claim text.

    Returns a dict with calibration data or {"available": False} if insufficient data.
    """
    async with pool.acquire() as conn:
        # Overall calibration by probability bucket
        buckets = await conn.fetch("""
            SELECT calibration_bucket,
                   COUNT(*) as n,
                   AVG(probability) as avg_predicted,
                   AVG(CASE WHEN actual_outcome THEN 1.0 ELSE 0.0 END) as avg_actual,
                   AVG(brier_score) as avg_brier
            FROM deal_predictions
            WHERE status IN ('resolved_correct', 'resolved_incorrect')
              AND brier_score IS NOT NULL
            GROUP BY calibration_bucket
            HAVING COUNT(*) >= 3
            ORDER BY calibration_bucket DESC
        """)

        # Per risk-factor calibration via keyword matching on claim text
        by_factor = await conn.fetch("""
            SELECT
                CASE
                    WHEN LOWER(claim) LIKE '%regulatory%' OR LOWER(claim) LIKE '%hsr%'
                         OR LOWER(claim) LIKE '%antitrust%' OR LOWER(claim) LIKE '%ftc%'
                         OR LOWER(claim) LIKE '%doj%' OR LOWER(claim) LIKE '%cfius%'
                         THEN 'regulatory'
                    WHEN LOWER(claim) LIKE '%vote%' OR LOWER(claim) LIKE '%shareholder%'
                         OR LOWER(claim) LIKE '%proxy%' THEN 'vote'
                    WHEN LOWER(claim) LIKE '%financing%' OR LOWER(claim) LIKE '%debt%'
                         OR LOWER(claim) LIKE '%credit%' THEN 'financing'
                    WHEN LOWER(claim) LIKE '%legal%' OR LOWER(claim) LIKE '%lawsuit%'
                         OR LOWER(claim) LIKE '%litigation%' THEN 'legal'
                    ELSE 'general'
                END as factor,
                COUNT(*) as n,
                AVG(probability) as avg_predicted,
                AVG(CASE WHEN actual_outcome THEN 1.0 ELSE 0.0 END) as avg_actual,
                AVG(brier_score) as avg_brier
            FROM deal_predictions
            WHERE status IN ('resolved_correct', 'resolved_incorrect')
              AND brier_score IS NOT NULL
              AND prediction_type IN ('deal_closes', 'milestone_completion')
            GROUP BY factor
            HAVING COUNT(*) >= 3
        """)

    total_resolved = sum(b["n"] for b in buckets)
    if total_resolved < 5:
        return {"available": False, "total_resolved": total_resolved}

    return {
        "available": True,
        "total_resolved": total_resolved,
        "by_bucket": [dict(b) for b in buckets],
        "by_factor": [dict(f) for f in by_factor],
    }


def format_calibration_for_prompt(cal: dict) -> str | None:
    """Format calibration data as a concise prompt section.

    Returns None if calibration data is not yet available or insufficient.
    """
    if not cal.get("available"):
        n = cal.get("total_resolved", 0)
        if n == 0:
            return None
        # Early data — still show a disclaimer
        return (
            "## YOUR CALIBRATION HISTORY (early data)\n"
            f"Based on {n} resolved predictions. Treat as directional only.\n"
        )

    lines = ["## YOUR CALIBRATION HISTORY"]
    lines.append(f"Based on {cal['total_resolved']} resolved predictions:")

    for bucket in cal.get("by_bucket", []):
        predicted = float(bucket["avg_predicted"]) * 100
        actual = float(bucket["avg_actual"]) * 100
        n = bucket["n"]
        diff = actual - predicted

        if abs(diff) < 3:
            assessment = "well calibrated"
        elif diff > 0:
            assessment = f"underconfident by ~{abs(diff):.0f}pp"
        else:
            assessment = f"overconfident by ~{abs(diff):.0f}pp"

        lines.append(
            f"  When you said {bucket['calibration_bucket']}%: "
            f"actual {actual:.0f}% ({assessment}, n={n})"
        )

    # Per-factor bias insights (only show meaningful deviations)
    factor_insights = []
    for f in cal.get("by_factor", []):
        predicted = float(f["avg_predicted"]) * 100
        actual = float(f["avg_actual"]) * 100
        brier = float(f["avg_brier"])
        diff = abs(actual - predicted)
        if diff >= 5:
            direction = "overconfident" if predicted > actual else "underconfident"
            factor_insights.append(
                f"  {f['factor'].title()}: {direction} by ~{diff:.0f}pp "
                f"(Brier {brier:.3f}, n={f['n']})"
            )
        elif f["n"] >= 5:
            factor_insights.append(
                f"  {f['factor'].title()}: well calibrated "
                f"(Brier {brier:.3f}, n={f['n']})"
            )

    if factor_insights:
        lines.append("Per-factor accuracy:")
        lines.extend(factor_insights)

    lines.append("")
    lines.append(
        "Adjust your confidence levels based on this history. "
        "If overconfident in a range, consider lower probabilities."
    )
    lines.append("")

    return "\n".join(lines)
