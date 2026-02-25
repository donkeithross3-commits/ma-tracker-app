"""Signal weighting: learn which signal (options, sheet, AI) is most predictive.

Uses inverse Brier score weighting from historical accuracy data.
Feeds weights back into the prompt so the AI can appropriately weight
disagreements between signals.

Feature-gated by RISK_SIGNAL_WEIGHTS env var.
"""

import logging

logger = logging.getLogger(__name__)

# Minimum deals with outcomes required for meaningful weights
MIN_DEALS_FOR_WEIGHTS = 10


async def compute_signal_weights(pool) -> dict | None:
    """Compute optimal signal weights from historical accuracy.

    Uses deal_estimate_snapshots joined with deal_outcomes to compare
    each signal's historical Brier score. Returns inverse-Brier weights
    (better signal gets higher weight).

    Returns None if insufficient data.
    """
    async with pool.acquire() as conn:
        # Get resolved deals with estimate histories
        rows = await conn.fetch("""
            SELECT
                do.ticker,
                CASE WHEN do.outcome IN ('closed_at_deal', 'closed_higher')
                     THEN 1.0 ELSE 0.0 END AS actual,
                -- Last AI probability before outcome
                (SELECT des.ai_prob_success
                 FROM deal_estimate_snapshots des
                 WHERE des.ticker = do.ticker
                 ORDER BY des.snapshot_date DESC LIMIT 1) AS ai_prob,
                -- Last sheet probability before outcome
                (SELECT des.sheet_prob_success
                 FROM deal_estimate_snapshots des
                 WHERE des.ticker = do.ticker
                 ORDER BY des.snapshot_date DESC LIMIT 1) AS sheet_prob,
                -- Last options-implied probability before outcome
                (SELECT des.options_implied_prob
                 FROM deal_estimate_snapshots des
                 WHERE des.ticker = do.ticker
                 ORDER BY des.snapshot_date DESC LIMIT 1) AS options_prob
            FROM deal_outcomes do
            WHERE do.outcome IS NOT NULL
        """)

    # Filter to rows with at least AI and sheet data
    valid = [
        r for r in rows
        if r["ai_prob"] is not None and r["sheet_prob"] is not None
    ]

    if len(valid) < MIN_DEALS_FOR_WEIGHTS:
        return None

    # Compute Brier scores for each signal
    ai_briers = []
    sheet_briers = []
    options_briers = []

    for r in valid:
        actual = float(r["actual"])
        ai_prob = float(r["ai_prob"]) / 100.0  # Stored as 0-100
        sheet_prob = float(r["sheet_prob"]) / 100.0

        ai_briers.append((ai_prob - actual) ** 2)
        sheet_briers.append((sheet_prob - actual) ** 2)

        if r["options_prob"] is not None:
            opt_prob = float(r["options_prob"])
            options_briers.append((opt_prob - actual) ** 2)

    ai_brier = sum(ai_briers) / len(ai_briers)
    sheet_brier = sum(sheet_briers) / len(sheet_briers)

    # Options may have fewer data points
    if options_briers:
        options_brier = sum(options_briers) / len(options_briers)
    else:
        # Use average of other two as placeholder
        options_brier = (ai_brier + sheet_brier) / 2

    # Inverse Brier weights (lower Brier = higher weight)
    inv = [1 / max(b, 0.001) for b in [options_brier, sheet_brier, ai_brier]]
    total = sum(inv)
    weights = [w / total for w in inv]

    return {
        "options_weight": round(weights[0], 4),
        "sheet_weight": round(weights[1], 4),
        "ai_weight": round(weights[2], 4),
        "options_brier": round(options_brier, 6),
        "sheet_brier": round(sheet_brier, 6),
        "ai_brier": round(ai_brier, 6),
        "n_deals": len(valid),
        "n_with_options": len(options_briers),
    }


def format_signal_weights_for_prompt(weights: dict) -> str | None:
    """Format signal weights as a prompt section.

    Returns None if no weight data available.
    """
    if not weights:
        return None

    lines = ["## SIGNAL TRACK RECORD"]
    lines.append(f"Based on {weights['n_deals']} completed deals:")
    lines.append(
        f"  Options market: Brier {weights['options_brier']:.3f} "
        f"(weight: {weights['options_weight']:.0%})"
    )
    lines.append(
        f"  Sheet analyst:  Brier {weights['sheet_brier']:.3f} "
        f"(weight: {weights['sheet_weight']:.0%})"
    )
    lines.append(
        f"  Your AI:        Brier {weights['ai_brier']:.3f} "
        f"(weight: {weights['ai_weight']:.0%})"
    )
    lines.append("")
    lines.append(
        "Weight your confidence accordingly. A signal with better historical "
        "accuracy deserves more weight when signals disagree."
    )
    lines.append("")
    return "\n".join(lines)
