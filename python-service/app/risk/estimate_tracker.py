"""Estimate Tracking — daily snapshot of sheet + AI estimates, outcome recording, accuracy scoring."""

import logging
import re
from datetime import date, datetime

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Map common grade strings to a normalized single-letter grade for comparison
_GRADE_MAP = {
    "low": "Low",
    "medium": "Medium",
    "med": "Medium",
    "high": "High",
    "very high": "Very High",
    "critical": "Critical",
    "none": "None",
    "n/a": "None",
    "minimal": "Low",
}


def _extract_grade(raw) -> str | None:
    """Normalize a grade string from either sheet or AI for comparison.

    Handles values like 'Medium', 'HIGH', 'Low Risk', 'med', etc.
    Returns a normalized string like 'Low', 'Medium', 'High', or None.
    """
    if raw is None:
        return None
    s = str(raw).strip().lower()
    # Strip trailing words like "risk"
    s = re.sub(r'\s*risk\s*$', '', s)
    s = s.strip()
    return _GRADE_MAP.get(s, s.title() if s else None)


def _safe_float(val) -> float | None:
    """Safely convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# capture_daily_estimates
# ---------------------------------------------------------------------------

async def capture_daily_estimates(pool, assessments: list[dict]):
    """Called after morning risk assessment. Snapshots all estimates.

    Args:
        pool: asyncpg connection pool
        assessments: list of AI assessment dicts, each containing at minimum:
            - ticker: str
            - probability_of_success: float (percentage, e.g. 85.0)
            - probability_of_higher_offer: float (optional)
            - break_price: float (optional)
            - implied_downside: float (optional)
            - grades: dict with factor keys -> {grade: str}
            - investable_assessment: str (optional)
    """
    today = date.today()
    captured = 0

    for assessment in assessments:
        ticker = assessment.get("ticker")
        if not ticker:
            continue

        try:
            async with pool.acquire() as conn:
                # Pull sheet estimates from deal_details
                sheet = await conn.fetchrow("""
                    SELECT probability_of_success, probability_of_higher_offer,
                           offer_bump_premium, break_price, implied_downside,
                           return_risk_ratio, shareholder_risk, financing_risk,
                           legal_risk, investable_deal
                    FROM sheet_deal_details
                    WHERE ticker = $1
                    ORDER BY fetched_at DESC LIMIT 1
                """, ticker)

                # Pull market data from sheet_rows
                row = await conn.fetchrow("""
                    SELECT deal_price, current_price, gross_yield, current_yield,
                           vote_risk, finance_risk, legal_risk, investable, countdown_days
                    FROM sheet_rows
                    WHERE ticker = $1 AND snapshot_id = (
                        SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1
                    )
                """, ticker)

            # Sheet probability values
            sheet_prob = _safe_float(sheet["probability_of_success"]) if sheet else None
            sheet_prob_higher = _safe_float(sheet["probability_of_higher_offer"]) if sheet else None
            sheet_offer_bump = _safe_float(sheet["offer_bump_premium"]) if sheet else None
            sheet_break = _safe_float(sheet["break_price"]) if sheet else None
            sheet_downside = _safe_float(sheet["implied_downside"]) if sheet else None
            sheet_rrr = _safe_float(sheet["return_risk_ratio"]) if sheet else None

            # AI probability values — convert from percentage (85.0) to decimal (0.85)
            ai_prob_raw = _safe_float(assessment.get("probability_of_success"))
            ai_prob = ai_prob_raw / 100 if ai_prob_raw is not None else None
            ai_prob_higher_raw = _safe_float(assessment.get("probability_of_higher_offer"))
            ai_prob_higher = ai_prob_higher_raw / 100 if ai_prob_higher_raw is not None else None
            ai_break = _safe_float(assessment.get("break_price"))
            ai_downside = _safe_float(assessment.get("implied_downside"))

            # Compute probability divergence (ai - sheet)
            divergence = None
            if ai_prob is not None and sheet_prob is not None:
                divergence = ai_prob - sheet_prob

            # Grade comparisons
            grades = assessment.get("grades", {})
            grade_mismatches = 0

            # Sheet grades from sheet_rows (vote_risk, finance_risk, legal_risk columns)
            sheet_vote = _extract_grade(row["vote_risk"] if row else None)
            sheet_finance = _extract_grade(row["finance_risk"] if row else None)
            sheet_legal = _extract_grade(row["legal_risk"] if row else None)

            ai_vote = _extract_grade(grades.get("vote", {}).get("grade") if isinstance(grades.get("vote"), dict) else grades.get("vote"))
            ai_finance = _extract_grade(grades.get("financing", {}).get("grade") if isinstance(grades.get("financing"), dict) else grades.get("financing"))
            ai_legal = _extract_grade(grades.get("legal", {}).get("grade") if isinstance(grades.get("legal"), dict) else grades.get("legal"))
            ai_regulatory = _extract_grade(grades.get("regulatory", {}).get("grade") if isinstance(grades.get("regulatory"), dict) else grades.get("regulatory"))
            ai_mac = _extract_grade(grades.get("mac", {}).get("grade") if isinstance(grades.get("mac"), dict) else grades.get("mac"))

            for s_grade, a_grade in [(sheet_vote, ai_vote), (sheet_finance, ai_finance), (sheet_legal, ai_legal)]:
                if s_grade and a_grade and s_grade != a_grade:
                    grade_mismatches += 1

            # Investable mismatch
            sheet_investable = str(sheet["investable_deal"]).strip().lower() if (sheet and sheet["investable_deal"]) else None
            row_investable = str(row["investable"]).strip().lower() if (row and row.get("investable")) else None
            ai_investable = assessment.get("investable_assessment")
            ai_investable_str = str(ai_investable).strip().lower() if ai_investable else None

            has_investable_mismatch = False
            ref_investable = sheet_investable or row_investable
            if ref_investable and ai_investable_str:
                # Simple check: "yes" vs "no", or more nuanced comparison
                if ref_investable != ai_investable_str:
                    has_investable_mismatch = True

            # Market data
            deal_price = _safe_float(row["deal_price"]) if row else None
            current_price = _safe_float(row["current_price"]) if row else None
            gross_spread = _safe_float(row["gross_yield"]) if row else None
            annualized_yield = _safe_float(row["current_yield"]) if row else None
            days_to_close = row["countdown_days"] if row else None

            # Raw sheet grade strings for storage
            sheet_vote_raw = str(row["vote_risk"]) if (row and row["vote_risk"]) else None
            sheet_finance_raw = str(row["finance_risk"]) if (row and row["finance_risk"]) else None
            sheet_legal_raw = str(row["legal_risk"]) if (row and row["legal_risk"]) else None
            sheet_investable_raw = str(row["investable"]) if (row and row.get("investable")) else (
                str(sheet["investable_deal"]) if (sheet and sheet["investable_deal"]) else None
            )

            async with pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO deal_estimate_snapshots
                    (snapshot_date, ticker,
                     sheet_prob_success, sheet_prob_higher_offer, sheet_break_price, sheet_implied_downside,
                     sheet_return_risk_ratio, sheet_offer_bump_premium,
                     ai_prob_success, ai_prob_higher_offer, ai_break_price, ai_implied_downside,
                     sheet_vote_risk, sheet_finance_risk, sheet_legal_risk, sheet_investable,
                     ai_vote_grade, ai_finance_grade, ai_legal_grade, ai_regulatory_grade, ai_mac_grade,
                     ai_investable_assessment,
                     deal_price, current_price, gross_spread_pct, annualized_yield_pct, days_to_close,
                     prob_success_divergence, grade_mismatches, has_investable_mismatch)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
                            $23, $24, $25, $26, $27, $28, $29, $30)
                    ON CONFLICT (snapshot_date, ticker) DO UPDATE SET
                        ai_prob_success = EXCLUDED.ai_prob_success,
                        ai_prob_higher_offer = EXCLUDED.ai_prob_higher_offer,
                        ai_break_price = EXCLUDED.ai_break_price,
                        ai_implied_downside = EXCLUDED.ai_implied_downside,
                        ai_vote_grade = EXCLUDED.ai_vote_grade,
                        ai_finance_grade = EXCLUDED.ai_finance_grade,
                        ai_legal_grade = EXCLUDED.ai_legal_grade,
                        ai_regulatory_grade = EXCLUDED.ai_regulatory_grade,
                        ai_mac_grade = EXCLUDED.ai_mac_grade,
                        ai_investable_assessment = EXCLUDED.ai_investable_assessment,
                        prob_success_divergence = EXCLUDED.prob_success_divergence,
                        grade_mismatches = EXCLUDED.grade_mismatches,
                        has_investable_mismatch = EXCLUDED.has_investable_mismatch
                """,
                    today, ticker,
                    sheet_prob, sheet_prob_higher, sheet_break, sheet_downside,
                    sheet_rrr, sheet_offer_bump,
                    ai_prob, ai_prob_higher, ai_break, ai_downside,
                    sheet_vote_raw, sheet_finance_raw, sheet_legal_raw, sheet_investable_raw,
                    ai_vote or None, ai_finance or None, ai_legal or None, ai_regulatory or None, ai_mac or None,
                    str(ai_investable) if ai_investable else None,
                    deal_price, current_price, gross_spread, annualized_yield, days_to_close,
                    divergence, grade_mismatches, has_investable_mismatch,
                )

            captured += 1

        except Exception as e:
            logger.error("Failed to capture estimates for %s: %s", ticker, e, exc_info=True)

    logger.info("Captured daily estimates for %d/%d deals", captured, len(assessments))
    return {"captured": captured, "total": len(assessments)}


# ---------------------------------------------------------------------------
# record_outcome
# ---------------------------------------------------------------------------

async def record_outcome(pool, ticker: str, outcome: str, outcome_date: date,
                         outcome_price: float, **kwargs):
    """Record actual deal outcome and trigger accuracy scoring.

    Args:
        pool: asyncpg connection pool
        ticker: deal ticker
        outcome: one of closed_at_deal, closed_higher, broke, withdrawn, extended, renegotiated
        outcome_date: when the outcome occurred
        outcome_price: final price
        **kwargs: optional fields — original_deal_price, announced_date, original_acquiror,
                  had_competing_bid, final_acquiror, final_price, bump_over_original_pct,
                  days_to_outcome, was_extended, extension_count, primary_risk_factor,
                  outcome_notes
    """
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO deal_outcomes
            (ticker, outcome, outcome_date, outcome_price,
             original_deal_price, announced_date, original_acquiror,
             had_competing_bid, final_acquiror, final_price, bump_over_original_pct,
             days_to_outcome, was_extended, extension_count,
             primary_risk_factor, outcome_notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (ticker) DO UPDATE SET
                outcome = EXCLUDED.outcome,
                outcome_date = EXCLUDED.outcome_date,
                outcome_price = EXCLUDED.outcome_price,
                original_deal_price = COALESCE(EXCLUDED.original_deal_price, deal_outcomes.original_deal_price),
                announced_date = COALESCE(EXCLUDED.announced_date, deal_outcomes.announced_date),
                original_acquiror = COALESCE(EXCLUDED.original_acquiror, deal_outcomes.original_acquiror),
                had_competing_bid = EXCLUDED.had_competing_bid,
                final_acquiror = COALESCE(EXCLUDED.final_acquiror, deal_outcomes.final_acquiror),
                final_price = COALESCE(EXCLUDED.final_price, deal_outcomes.final_price),
                bump_over_original_pct = COALESCE(EXCLUDED.bump_over_original_pct, deal_outcomes.bump_over_original_pct),
                days_to_outcome = COALESCE(EXCLUDED.days_to_outcome, deal_outcomes.days_to_outcome),
                was_extended = EXCLUDED.was_extended,
                extension_count = COALESCE(EXCLUDED.extension_count, deal_outcomes.extension_count),
                primary_risk_factor = COALESCE(EXCLUDED.primary_risk_factor, deal_outcomes.primary_risk_factor),
                outcome_notes = COALESCE(EXCLUDED.outcome_notes, deal_outcomes.outcome_notes),
                updated_at = NOW()
        """,
            ticker, outcome, outcome_date, outcome_price,
            kwargs.get("original_deal_price"),
            kwargs.get("announced_date"),
            kwargs.get("original_acquiror"),
            kwargs.get("had_competing_bid", False),
            kwargs.get("final_acquiror"),
            _safe_float(kwargs.get("final_price")),
            _safe_float(kwargs.get("bump_over_original_pct")),
            kwargs.get("days_to_outcome"),
            kwargs.get("was_extended", False),
            kwargs.get("extension_count", 0),
            kwargs.get("primary_risk_factor"),
            kwargs.get("outcome_notes"),
        )

    # Score accuracy
    await score_deal_accuracy(pool, ticker)

    logger.info("Recorded outcome for %s: %s at $%.2f on %s", ticker, outcome, outcome_price, outcome_date)


# ---------------------------------------------------------------------------
# score_deal_accuracy
# ---------------------------------------------------------------------------

async def score_deal_accuracy(pool, ticker: str):
    """Score sheet vs AI accuracy for a completed deal.

    Computes Brier scores for probability estimates and stores results
    in estimate_accuracy_scores.
    """
    async with pool.acquire() as conn:
        outcome = await conn.fetchrow(
            "SELECT * FROM deal_outcomes WHERE ticker = $1", ticker
        )
        if not outcome:
            logger.warning("No outcome found for %s — cannot score", ticker)
            return

        snapshots = await conn.fetch("""
            SELECT * FROM deal_estimate_snapshots
            WHERE ticker = $1 ORDER BY snapshot_date
        """, ticker)
        if not snapshots:
            logger.warning("No estimate snapshots found for %s — cannot score", ticker)
            return

    deal_closed = outcome["outcome"] in ("closed_at_deal", "closed_higher")
    actual_success = 1.0 if deal_closed else 0.0
    had_higher = 1.0 if outcome["outcome"] == "closed_higher" else 0.0

    # Brier scores for probability_of_success
    sheet_briers = []
    ai_briers = []
    sheet_higher_briers = []
    ai_higher_briers = []

    for snap in snapshots:
        if snap["sheet_prob_success"] is not None:
            sheet_briers.append((float(snap["sheet_prob_success"]) - actual_success) ** 2)
        if snap["ai_prob_success"] is not None:
            ai_briers.append((float(snap["ai_prob_success"]) - actual_success) ** 2)
        if snap["sheet_prob_higher_offer"] is not None:
            sheet_higher_briers.append((float(snap["sheet_prob_higher_offer"]) - had_higher) ** 2)
        if snap["ai_prob_higher_offer"] is not None:
            ai_higher_briers.append((float(snap["ai_prob_higher_offer"]) - had_higher) ** 2)

    sheet_brier = sum(sheet_briers) / len(sheet_briers) if sheet_briers else None
    ai_brier = sum(ai_briers) / len(ai_briers) if ai_briers else None
    sheet_higher_brier = sum(sheet_higher_briers) / len(sheet_higher_briers) if sheet_higher_briers else None
    ai_higher_brier = sum(ai_higher_briers) / len(ai_higher_briers) if ai_higher_briers else None

    # Determine winner for prob_success
    prob_winner = "tie"
    if sheet_brier is not None and ai_brier is not None:
        if ai_brier < sheet_brier - 0.001:
            prob_winner = "ai"
        elif sheet_brier < ai_brier - 0.001:
            prob_winner = "sheet"

    # Break price accuracy (only meaningful for broke deals)
    sheet_break_error = None
    ai_break_error = None
    if outcome["outcome"] in ("broke", "withdrawn") and outcome["outcome_price"]:
        actual_break = float(outcome["outcome_price"])
        if actual_break > 0:
            # Use the last snapshot's break price estimate
            last_snap = snapshots[-1]
            if last_snap["sheet_break_price"] is not None:
                predicted = float(last_snap["sheet_break_price"])
                sheet_break_error = (predicted - actual_break) / actual_break * 100
            if last_snap["ai_break_price"] is not None:
                predicted = float(last_snap["ai_break_price"])
                ai_break_error = (predicted - actual_break) / actual_break * 100

    # Grade accuracy: did the estimator identify the risk factor that materialized?
    primary_factor = outcome["primary_risk_factor"]
    sheet_identified = None
    ai_identified = None
    if primary_factor and snapshots:
        last_snap = snapshots[-1]
        factor_map = {
            "vote": ("sheet_vote_risk", "ai_vote_grade"),
            "financing": ("sheet_finance_risk", "ai_finance_grade"),
            "legal": ("sheet_legal_risk", "ai_legal_grade"),
            "regulatory": (None, "ai_regulatory_grade"),
            "mac": (None, "ai_mac_grade"),
        }
        mapping = factor_map.get(primary_factor)
        if mapping:
            sheet_col, ai_col = mapping
            if sheet_col and last_snap.get(sheet_col):
                grade = _extract_grade(last_snap[sheet_col])
                sheet_identified = grade in ("High", "Very High", "Critical", "Medium")
            if last_snap.get(ai_col):
                grade = _extract_grade(last_snap[ai_col])
                ai_identified = grade in ("High", "Very High", "Critical", "Medium")

    # Composite score (0-100): weighted combination
    # 60% Brier score (inverted: lower brier = higher score), 20% break price, 20% risk ID
    def _composite(brier, break_err, identified):
        components = []
        if brier is not None:
            # Convert Brier (0-1, lower=better) to 0-100 score
            components.append((1 - brier) * 100 * 0.6)
        if break_err is not None:
            # Convert absolute % error to score (0% error = 100, 50% error = 0)
            components.append(max(0, 100 - abs(break_err) * 2) * 0.2)
        if identified is not None:
            components.append((100 if identified else 0) * 0.2)
        return sum(components) / (sum(0.6 if brier is not None else 0,
                                       0.2 if break_err is not None else 0,
                                       0.2 if identified is not None else 0) or 1) * (
            sum(0.6 if brier is not None else 0,
                0.2 if break_err is not None else 0,
                0.2 if identified is not None else 0)
        ) if components else None

    # Simpler composite: just use what we have
    sheet_score = None
    ai_score = None

    if sheet_brier is not None:
        sheet_score = round((1 - sheet_brier) * 100, 2)
    if ai_brier is not None:
        ai_score = round((1 - ai_brier) * 100, 2)

    overall_winner = "tie"
    if sheet_score is not None and ai_score is not None:
        if ai_score > sheet_score + 0.1:
            overall_winner = "ai"
        elif sheet_score > ai_score + 0.1:
            overall_winner = "sheet"

    # Tracking period
    first_date = snapshots[0]["snapshot_date"]
    last_date = snapshots[-1]["snapshot_date"]
    days_tracked = len(snapshots)

    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO estimate_accuracy_scores
            (ticker, days_tracked, first_estimate_date, last_estimate_date, outcome,
             sheet_prob_success_brier, ai_prob_success_brier, prob_success_winner,
             sheet_prob_higher_brier, ai_prob_higher_brier,
             sheet_break_price_error_pct, ai_break_price_error_pct,
             sheet_identified_risk, ai_identified_risk,
             sheet_score, ai_score, overall_winner)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        """,
            ticker, days_tracked, first_date, last_date, outcome["outcome"],
            sheet_brier, ai_brier, prob_winner,
            sheet_higher_brier, ai_higher_brier,
            sheet_break_error, ai_break_error,
            sheet_identified, ai_identified,
            sheet_score, ai_score, overall_winner,
        )

    logger.info(
        "Scored accuracy for %s: sheet=%.2f ai=%.2f winner=%s",
        ticker,
        sheet_score or 0,
        ai_score or 0,
        overall_winner,
    )


# ---------------------------------------------------------------------------
# detect_potential_outcomes
# ---------------------------------------------------------------------------

async def detect_potential_outcomes(pool) -> list[dict]:
    """Check for deals that may have closed, broke, or changed status.

    Returns candidates for PM confirmation, not auto-recorded outcomes.
    """
    candidates = []

    async with pool.acquire() as conn:
        # 1. Deals removed from sheet (diff_type = 'removed') in last 7 days
        removed = await conn.fetch("""
            SELECT DISTINCT ticker FROM sheet_diffs
            WHERE diff_type = 'removed' AND diff_date >= CURRENT_DATE - 7
        """)
        for r in removed:
            # Skip if already has an outcome recorded
            existing = await conn.fetchval(
                "SELECT 1 FROM deal_outcomes WHERE ticker = $1", r["ticker"]
            )
            if not existing:
                candidates.append({"ticker": r["ticker"], "signal": "removed_from_sheet"})

        # 2. Price converged to deal price (within 0.1%)
        converged = await conn.fetch("""
            SELECT ticker, deal_price, current_price
            FROM sheet_rows
            WHERE snapshot_id = (SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1)
            AND deal_price IS NOT NULL AND current_price IS NOT NULL
            AND ABS(deal_price - current_price) / deal_price < 0.001
            AND ticker IS NOT NULL
        """)
        for c in converged:
            existing = await conn.fetchval(
                "SELECT 1 FROM deal_outcomes WHERE ticker = $1", c["ticker"]
            )
            if not existing:
                candidates.append({
                    "ticker": c["ticker"],
                    "signal": "price_converged",
                    "deal_price": float(c["deal_price"]),
                    "current_price": float(c["current_price"]),
                })

        # 3. Significant price drop below break price
        broken = await conn.fetch("""
            SELECT r.ticker, r.current_price, d.break_price
            FROM sheet_rows r
            JOIN sheet_deal_details d ON d.ticker = r.ticker
            WHERE r.snapshot_id = (SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1)
            AND d.break_price IS NOT NULL AND r.current_price IS NOT NULL
            AND r.current_price < d.break_price
        """)
        for b in broken:
            existing = await conn.fetchval(
                "SELECT 1 FROM deal_outcomes WHERE ticker = $1", b["ticker"]
            )
            if not existing:
                candidates.append({
                    "ticker": b["ticker"],
                    "signal": "below_break_price",
                    "current_price": float(b["current_price"]),
                    "break_price": float(b["break_price"]),
                })

    logger.info("Detected %d potential outcome candidates", len(candidates))
    return candidates
