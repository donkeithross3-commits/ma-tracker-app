"""Risk Assessment Engine — runs morning risk analysis for all active deals.

Grade-based system: Low/Medium/High for 5 sheet-aligned factors,
0-10 supplemental scores for 3 factors the sheet does not assess.
"""

import json
import logging
import os
import re
import time
import uuid
from datetime import date, datetime

from anthropic import Anthropic

from .context_hash import ChangeSignificance, build_context_summary, classify_changes, compute_context_hash
from .model_config import compute_cost, get_model
from .prompts import (
    RISK_ASSESSMENT_SYSTEM_PROMPT,
    RISK_DELTA_SYSTEM_PROMPT,
    build_deal_assessment_prompt,
    build_delta_assessment_prompt,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pool injection (same pattern as portfolio_routes.py)
# ---------------------------------------------------------------------------
_pool = None


def set_pool(pool):
    global _pool
    _pool = pool


def _get_pool():
    if _pool is not None:
        return _pool
    raise RuntimeError("Risk engine pool not initialized")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GRADE_ORDER = {"Low": 1, "Medium": 2, "High": 3}

GRADED_FACTORS = ["vote", "financing", "legal", "regulatory", "mac"]

SUPPLEMENTAL_FACTORS = ["market", "timing", "competing_bid"]

ENABLE_ENRICHED_CONTEXT = os.environ.get("RISK_ENRICHED_CONTEXT", "true").lower() == "true"
ENABLE_PREDICTIONS = os.environ.get("RISK_PREDICTIONS", "false").lower() == "true"
ENABLE_CALIBRATION = os.environ.get("RISK_CALIBRATION", "false").lower() == "true"
ENABLE_REVIEW_QUEUE = os.environ.get("RISK_REVIEW_QUEUE", "false").lower() == "true"
ENABLE_SIGNAL_WEIGHTS = os.environ.get("RISK_SIGNAL_WEIGHTS", "false").lower() == "true"


def _extract_estimate_value(data: dict, key: str):
    """Handle both scalar (old) and structured (new) estimate formats.

    New format: {"value": 92.0, "confidence": 0.85, "factors": [...]}
    Old format: 92.0
    """
    raw = data.get(key)
    if isinstance(raw, dict):
        return raw.get("value")
    return raw


def _score_to_level(score: float | None) -> str:
    """Convert a numeric 0-10 score to a human-readable risk level."""
    if score is None:
        return "unknown"
    if score < 2:
        return "low"
    if score < 4:
        return "moderate"
    if score < 6:
        return "elevated"
    if score < 8:
        return "high"
    return "critical"


def extract_grade(text: str | None) -> str | None:
    """Extract Low/Medium/High from free-form sheet text.

    Examples:
        "Medium, significant regulatory approvals required" -> "Medium"
        "Low"                                               -> "Low"
        "HIGH - multiple lawsuits"                          -> "High"
        None or unrecognized                                -> None
    """
    if not text:
        return None
    text_lower = text.strip().lower()
    for grade in ("high", "medium", "low"):
        if text_lower.startswith(grade) or re.search(rf'\b{grade}\b', text_lower):
            return grade.capitalize()
    return None


def detect_discrepancies(ai_result: dict, sheet_data: dict) -> list[dict]:
    """Compare AI grades/estimates against Google Sheet values.

    Returns a list of discrepancy dicts, each with:
        factor, ai_value, sheet_value, discrepancy_type, detail
    """
    discrepancies = []

    grades = ai_result.get("grades", {})

    # Grade mismatches for vote / financing / legal
    grade_mapping = {
        "vote": "vote_risk",
        "financing": "finance_risk",
        "legal": "legal_risk",
    }
    for factor, sheet_key in grade_mapping.items():
        ai_grade = grades.get(factor, {}).get("grade")
        sheet_text = sheet_data.get(sheet_key)
        sheet_grade = extract_grade(sheet_text)

        if ai_grade and sheet_grade and ai_grade != sheet_grade:
            ai_order = GRADE_ORDER.get(ai_grade, 0)
            sheet_order = GRADE_ORDER.get(sheet_grade, 0)
            direction = "higher" if ai_order > sheet_order else "lower"
            discrepancies.append({
                "factor": factor,
                "ai_value": ai_grade,
                "sheet_value": sheet_grade,
                "discrepancy_type": "grade_mismatch",
                "detail": f"AI rates {factor} as {ai_grade} but sheet says {sheet_grade} (AI is {direction} risk)",
            })

    # Investability disagreement
    ai_investable = ai_result.get("investable_assessment", "").strip()
    sheet_investable = (sheet_data.get("investable") or "").strip().lower()
    if ai_investable and sheet_investable:
        # Sheet typically says "Yes", "No", or something descriptive
        sheet_says_yes = sheet_investable in ("yes", "y", "true", "investable")
        ai_says_yes = ai_investable == "Yes"
        if sheet_says_yes and not ai_says_yes:
            discrepancies.append({
                "factor": "investability",
                "ai_value": ai_investable,
                "sheet_value": sheet_data.get("investable"),
                "discrepancy_type": "investability_disagreement",
                "detail": f"Sheet says investable but AI says {ai_investable}",
            })

    # Probability divergence (>5% gap)
    ai_prob = ai_result.get("probability_of_success")
    sheet_prob = sheet_data.get("prob_success")
    if ai_prob is not None and sheet_prob is not None:
        try:
            ai_prob_f = float(ai_prob)
            sheet_prob_f = float(sheet_prob)
            gap = abs(ai_prob_f - sheet_prob_f)
            if gap > 5.0:
                discrepancies.append({
                    "factor": "probability",
                    "ai_value": ai_prob_f,
                    "sheet_value": sheet_prob_f,
                    "discrepancy_type": "probability_divergence",
                    "detail": f"AI estimates {ai_prob_f:.1f}% vs sheet {sheet_prob_f:.1f}% (gap: {gap:.1f}%)",
                })
        except (ValueError, TypeError):
            pass

    return discrepancies


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
class RiskAssessmentEngine:
    """Orchestrates morning risk assessments for all active deals."""

    def __init__(self, pool, anthropic_key: str):
        self.pool = pool
        self.anthropic = Anthropic(api_key=anthropic_key)
        self.model = get_model("full_assessment")
        self.delta_model = get_model("delta_assessment")
        self.summary_model = get_model("run_summary")

    # ------------------------------------------------------------------
    # Data collection
    # ------------------------------------------------------------------
    async def collect_deal_context(self, ticker: str) -> dict:
        """Gather all available data for a single deal from the database."""
        context = {"ticker": ticker}

        async with self.pool.acquire() as conn:
            # 1. Latest sheet row
            row = await conn.fetchrow(
                """SELECT * FROM sheet_rows
                   WHERE ticker = $1
                     AND snapshot_id = (
                         SELECT id FROM sheet_snapshots
                         ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1
                     )""",
                ticker,
            )
            if row:
                context["sheet_row"] = dict(row)

            # 2. Deal details
            details = await conn.fetchrow(
                "SELECT * FROM sheet_deal_details WHERE ticker = $1 ORDER BY fetched_at DESC LIMIT 1",
                ticker,
            )
            if details:
                context["deal_details"] = dict(details)

            # 3. Previous assessment
            prev = await conn.fetchrow(
                """SELECT * FROM deal_risk_assessments
                   WHERE ticker = $1 AND assessment_date < CURRENT_DATE
                   ORDER BY assessment_date DESC LIMIT 1""",
                ticker,
            )
            if prev:
                context["previous_assessment"] = dict(prev)

            # 4. Recent EDGAR filings (last 30 days)
            try:
                filings = await conn.fetch(
                    """SELECT * FROM portfolio_edgar_filings
                       WHERE ticker = $1 AND detected_at > NOW() - INTERVAL '30 days'
                       ORDER BY detected_at DESC""",
                    ticker,
                )
                context["recent_filings"] = [dict(f) for f in filings]
            except Exception:
                context["recent_filings"] = []

            # 5. Recent trading halts (last 7 days)
            try:
                halts = await conn.fetch(
                    """SELECT * FROM halt_events
                       WHERE ticker = $1 AND halted_at > NOW() - INTERVAL '7 days'
                       ORDER BY halted_at DESC""",
                    ticker,
                )
                context["recent_halts"] = [dict(h) for h in halts]
            except Exception:
                context["recent_halts"] = []

            # 6. Recent sheet diffs (last 7 days)
            diffs = await conn.fetch(
                """SELECT * FROM sheet_diffs
                   WHERE ticker = $1 AND created_at > CURRENT_DATE - INTERVAL '7 days'
                   ORDER BY created_at DESC""",
                ticker,
            )
            context["sheet_diffs"] = [dict(d) for d in diffs]

            # 7. Existing AI research
            try:
                research = await conn.fetchrow(
                    "SELECT * FROM deal_research WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
                    ticker,
                )
                if research:
                    context["existing_research"] = dict(research)
            except Exception:
                pass  # Table may not exist in portfolio DB

            # 8. Deal attributes
            try:
                attrs = await conn.fetchrow(
                    "SELECT * FROM deal_attributes WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
                    ticker,
                )
                if attrs:
                    context["deal_attributes"] = dict(attrs)
            except Exception:
                pass  # Table may not exist in portfolio DB

            # 9. Options snapshot (latest row)
            if ENABLE_ENRICHED_CONTEXT:
                try:
                    opt_snap = await conn.fetchrow(
                        """SELECT * FROM deal_options_snapshots
                           WHERE ticker = $1
                           ORDER BY snapshot_date DESC LIMIT 1""",
                        ticker,
                    )
                    if opt_snap:
                        context["options_snapshot"] = dict(opt_snap)
                except Exception:
                    pass  # Table may not exist yet

            # 10. Milestones
            if ENABLE_ENRICHED_CONTEXT:
                try:
                    milestones = await conn.fetch(
                        """SELECT * FROM canonical_deal_milestones
                           WHERE ticker = $1
                           ORDER BY COALESCE(expected_date, milestone_date) ASC NULLS LAST""",
                        ticker,
                    )
                    context["milestones"] = [dict(m) for m in milestones]
                except Exception:
                    pass  # Table may not exist yet

            # 11. Open predictions (for update/supersede)
            if ENABLE_PREDICTIONS:
                try:
                    open_preds = await conn.fetch(
                        """SELECT prediction_type, claim, by_date, probability,
                                  confidence, status, assessment_date
                           FROM deal_predictions
                           WHERE ticker = $1 AND status = 'open'
                           ORDER BY assessment_date DESC""",
                        ticker,
                    )
                    if open_preds:
                        context["open_predictions"] = [dict(p) for p in open_preds]
                except Exception:
                    pass  # Table may not exist yet

            # 12. Recent human corrections (for feedback into next assessment)
            if ENABLE_REVIEW_QUEUE:
                try:
                    corrections = await conn.fetch("""
                        SELECT ha.correct_signal, ha.corrected_grades,
                               ha.corrected_probability, ha.probability_reasoning,
                               ha.missed_reasoning, ha.error_type, ha.annotation_date
                        FROM human_annotations ha
                        JOIN human_review_items hri ON hri.id = ha.review_item_id
                        WHERE hri.ticker = $1
                          AND ha.annotation_date > CURRENT_DATE - INTERVAL '30 days'
                        ORDER BY ha.annotation_date DESC LIMIT 3
                    """, ticker)
                    if corrections:
                        context["human_corrections"] = [dict(c) for c in corrections]
                except Exception:
                    pass  # Table may not exist yet

        # Compute options-implied probability
        if ENABLE_ENRICHED_CONTEXT:
            from .signals import compute_options_implied_probability

            current_price = context.get("sheet_row", {}).get("current_price")
            deal_price = context.get("sheet_row", {}).get("deal_price")
            options_prob = compute_options_implied_probability(current_price, deal_price)
            if options_prob is not None:
                context["options_implied_probability"] = options_prob

        # Build three-signal comparison
        if ENABLE_ENRICHED_CONTEXT:
            from .signals import build_signal_comparison

            sheet_prob = None
            deal_details = context.get("deal_details")
            if deal_details and deal_details.get("probability_of_success") is not None:
                try:
                    sheet_prob = float(deal_details["probability_of_success"]) / 100.0
                except (ValueError, TypeError):
                    pass

            prev_ai_prob = None
            prev_assessment = context.get("previous_assessment")
            if prev_assessment and prev_assessment.get("our_prob_success") is not None:
                try:
                    prev_ai_prob = float(prev_assessment["our_prob_success"]) / 100.0
                except (ValueError, TypeError):
                    pass

            options_implied = context.get("options_implied_probability")
            signal_comp = build_signal_comparison(options_implied, sheet_prob, prev_ai_prob)
            if signal_comp is not None:
                context["signal_comparison"] = signal_comp

        # Live price: use sheet row's current_price for now
        if row and row.get("current_price") is not None:
            context["live_price"] = {
                "price": float(row["current_price"]),
                "change": float(row["price_change"]) if row.get("price_change") is not None else None,
            }

        # Build sheet comparison data for the prompt
        sheet_comparison = {}
        if row:
            sheet_comparison["vote_risk"] = row.get("vote_risk")
            sheet_comparison["finance_risk"] = row.get("finance_risk")
            sheet_comparison["legal_risk"] = row.get("legal_risk")
            sheet_comparison["investable"] = row.get("investable")
        if details:
            sheet_comparison["prob_success"] = details.get("probability_of_success")
        if sheet_comparison:
            context["sheet_comparison"] = sheet_comparison

        return context

    # ------------------------------------------------------------------
    # Single deal assessment
    # ------------------------------------------------------------------
    async def assess_single_deal(
        self,
        context: dict,
        system_prompt: str | None = None,
        user_prompt: str | None = None,
        model: str | None = None,
    ) -> dict:
        """Call Claude to assess risk for a single deal. Returns parsed JSON response.

        Args:
            context: Deal context dict.
            system_prompt: Override system prompt (used for delta assessments).
            user_prompt: Override user prompt (used for delta assessments).
            model: Override model (used for delta assessments).
        """
        ticker = context.get("ticker", "UNKNOWN")
        model = model or self.model
        sys_text = system_prompt or RISK_ASSESSMENT_SYSTEM_PROMPT
        prompt = user_prompt or build_deal_assessment_prompt(context)

        t0 = time.monotonic()
        try:
            response = self.anthropic.messages.create(
                model=model,
                temperature=0,
                max_tokens=2800,
                system=[{
                    "type": "text",
                    "text": sys_text,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            logger.error("Claude API error for %s: %s", ticker, e)
            raise

        elapsed_ms = int((time.monotonic() - t0) * 1000)

        # Extract cache token counts
        cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0

        tokens_used = response.usage.input_tokens + response.usage.output_tokens
        cost = compute_cost(
            model,
            response.usage.input_tokens,
            response.usage.output_tokens,
            cache_creation,
            cache_read,
        )

        raw_text = response.content[0].text
        # Strip markdown code fences if present (```json ... ```)
        stripped = raw_text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
            stripped = re.sub(r"\n?```\s*$", "", stripped)
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            logger.error("Malformed JSON from Claude for %s: %s", ticker, raw_text[:500])
            raise ValueError(f"Claude returned invalid JSON for {ticker}")

        # Enrich with metadata
        parsed["_meta"] = {
            "model": model,
            "tokens_used": tokens_used,
            "processing_time_ms": elapsed_ms,
            "cost_usd": cost,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_creation_tokens": cache_creation,
            "cache_read_tokens": cache_read,
        }

        return parsed

    # ------------------------------------------------------------------
    # Change detection (grade + score based)
    # ------------------------------------------------------------------
    async def detect_changes(self, ticker: str, today: dict, yesterday: dict | None) -> list[dict]:
        """Compare today's assessment to yesterday's and return significant changes.

        Checks both graded factors (grade level changes) and supplemental scores
        (magnitude >= 0.5).
        """
        if not yesterday:
            return []

        changes = []

        # Check graded factors for grade-level changes
        grades = today.get("grades", {})
        for factor in GRADED_FACTORS:
            new_grade = grades.get(factor, {}).get("grade")
            old_grade = yesterday.get(f"{factor}_grade")

            if not new_grade or not old_grade:
                continue

            new_order = GRADE_ORDER.get(new_grade, 0)
            old_order = GRADE_ORDER.get(old_grade, 0)

            if new_order != old_order:
                if new_order > old_order:
                    direction = "worsened"
                else:
                    direction = "improved"

                changes.append({
                    "factor": factor,
                    "old_score": old_order,
                    "new_score": new_order,
                    "old_level": old_grade,
                    "new_level": new_grade,
                    "direction": direction,
                    "magnitude": abs(new_order - old_order),
                    "explanation": grades.get(factor, {}).get("detail", ""),
                })

        # Check supplemental scores for numeric changes
        supplementals = today.get("supplemental_scores", {})
        for factor in SUPPLEMENTAL_FACTORS:
            factor_data = supplementals.get(factor, {})
            new_score = factor_data.get("score")
            old_score = yesterday.get(f"{factor}_score")

            if new_score is None or old_score is None:
                continue

            new_score = float(new_score)
            old_score = float(old_score)
            magnitude = abs(new_score - old_score)

            if magnitude >= 0.5:
                if new_score > old_score:
                    direction = "worsened"
                else:
                    direction = "improved"

                changes.append({
                    "factor": factor,
                    "old_score": old_score,
                    "new_score": new_score,
                    "old_level": _score_to_level(old_score),
                    "new_level": _score_to_level(new_score),
                    "direction": direction,
                    "magnitude": round(magnitude, 2),
                    "explanation": factor_data.get("detail", ""),
                })

        return changes

    # ------------------------------------------------------------------
    # Full morning run
    # ------------------------------------------------------------------
    async def run_morning_assessment(self, run_date=None, triggered_by="scheduler") -> dict:
        """Run the full morning risk assessment for all active deals."""
        if run_date is None:
            run_date = date.today()

        run_id = uuid.uuid4()
        logger.info("Starting risk assessment run %s for %s", run_id, run_date)

        # Create run record
        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO risk_assessment_runs (id, run_date, status, triggered_by)
                   VALUES ($1, $2, 'running', $3)""",
                run_id, run_date, triggered_by,
            )

        # Get active deals from latest snapshot
        async with self.pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                logger.warning("No snapshots found — nothing to assess")
                await self._finish_run(run_id, "completed", error="No snapshots found")
                return {"run_id": str(run_id), "status": "completed", "total_deals": 0}

            rows = await conn.fetch(
                """SELECT DISTINCT ticker FROM sheet_rows
                   WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)
                   ORDER BY ticker""",
                snapshot["id"],
            )

        tickers = [r["ticker"] for r in rows]
        total_deals = len(tickers)
        logger.info("Found %d active deals to assess", total_deals)

        results = []
        assessed = 0
        failed = 0
        flagged = 0
        changed = 0
        total_tokens = 0
        total_cost = 0.0
        total_discrepancies = 0
        reused_deals = 0
        delta_deals = 0
        full_deals = 0
        estimated_savings = 0.0

        # Estimated cost of a full assessment (for savings calculation)
        avg_full_cost = 0.02

        # Compute calibration feedback once for the entire run (same for all deals)
        calibration_text = None
        if ENABLE_CALIBRATION:
            try:
                from .calibration import compute_calibration_summary, format_calibration_for_prompt
                cal = await compute_calibration_summary(self.pool)
                calibration_text = format_calibration_for_prompt(cal)
                if calibration_text:
                    logger.info("Calibration feedback available (%d resolved predictions)", cal.get("total_resolved", 0))
            except Exception as e:
                logger.warning("Calibration computation failed: %s", e)

        # Compute signal weights once for the entire run (same for all deals)
        signal_weights_text = None
        if ENABLE_SIGNAL_WEIGHTS:
            try:
                from .signal_weights import compute_signal_weights, format_signal_weights_for_prompt
                weights = await compute_signal_weights(self.pool)
                signal_weights_text = format_signal_weights_for_prompt(weights)
                if signal_weights_text:
                    logger.info("Signal weights available (%d deals)", weights.get("n_deals", 0))
            except Exception as e:
                logger.warning("Signal weights computation failed: %s", e)

        for ticker in tickers:
            try:
                # Collect context
                context = await self.collect_deal_context(ticker)

                # Inject cached calibration feedback
                if calibration_text:
                    context["calibration_text"] = calibration_text

                # Inject cached signal weights
                if signal_weights_text:
                    context["signal_weights_text"] = signal_weights_text

                # Format human corrections for prompt
                if ENABLE_REVIEW_QUEUE and context.get("human_corrections"):
                    try:
                        from .review_queue import format_corrections_for_prompt
                        corrections_text = format_corrections_for_prompt(context["human_corrections"])
                        if corrections_text:
                            context["corrections_text"] = corrections_text
                    except Exception:
                        pass

                # --- Context hashing & change classification ---
                ctx_hash = compute_context_hash(context)
                prev = context.get("previous_assessment")

                # Load previous context summary from input_data JSONB
                prev_summary = None
                prev_hash = None
                if prev and prev.get("input_data"):
                    try:
                        prev_input = prev["input_data"]
                        if isinstance(prev_input, str):
                            prev_input = json.loads(prev_input)
                        prev_summary = prev_input.get("context_summary")
                        prev_hash = prev_input.get("context_hash")
                    except (TypeError, json.JSONDecodeError):
                        pass

                significance, change_list = classify_changes(context, prev_summary)

                # --- Route: reuse / delta / full ---
                strategy = "full"
                assessment = None

                if prev_hash and ctx_hash == prev_hash and significance == ChangeSignificance.NO_CHANGE:
                    # REUSE: Copy previous assessment, zero cost
                    strategy = "reuse"
                    reused_deals += 1

                    # Reconstruct assessment from previous DB record
                    assessment = self._reconstruct_assessment(prev)
                    assessment["_meta"] = {
                        "model": "reuse",
                        "tokens_used": 0,
                        "processing_time_ms": 0,
                        "cost_usd": 0.0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_creation_tokens": 0,
                        "cache_read_tokens": 0,
                        "reused_from": str(prev.get("assessment_date", "")),
                    }
                    estimated_savings += avg_full_cost
                    logger.info("Reusing previous assessment for %s (hash match)", ticker)

                elif significance in (ChangeSignificance.MINOR, ChangeSignificance.MODERATE) and prev:
                    # DELTA: Abbreviated prompt with yesterday's assessment + changes
                    strategy = "delta"
                    delta_deals += 1

                    delta_prompt = build_delta_assessment_prompt(
                        context, prev, change_list, significance.value,
                    )
                    assessment = await self.assess_single_deal(
                        context,
                        system_prompt=RISK_DELTA_SYSTEM_PROMPT,
                        user_prompt=delta_prompt,
                        model=self.delta_model,
                    )
                    # Estimate savings vs full prompt
                    meta = assessment.get("_meta", {})
                    estimated_savings += max(0, avg_full_cost - meta.get("cost_usd", 0))

                else:
                    # FULL: Standard full assessment
                    strategy = "full"
                    full_deals += 1
                    assessment = await self.assess_single_deal(context)

                # --- Store context hash + summary in input_data ---
                ctx_summary = build_context_summary(context)
                assessment["_context"] = {
                    "context_hash": ctx_hash,
                    "context_summary": ctx_summary,
                    "assessment_strategy": strategy,
                    "change_significance": significance.value,
                    "changes": change_list,
                }

                # Detect discrepancies against sheet
                sheet_data = context.get("sheet_comparison", {})
                discrepancies = detect_discrepancies(assessment, sheet_data)

                # Detect changes from previous assessment
                score_changes = await self.detect_changes(ticker, assessment, prev)

                # Store assessment
                assessment_id = await self._store_assessment(
                    run_id, run_date, ticker, assessment, context, discrepancies,
                )

                # Store changes
                for change in score_changes:
                    await self._store_change(assessment_id, run_date, ticker, change)

                # Store predictions from AI response
                if ENABLE_PREDICTIONS:
                    try:
                        from .predictions import store_predictions
                        raw_predictions = assessment.get("predictions", [])
                        if raw_predictions:
                            await store_predictions(
                                self.pool, ticker, run_date,
                                assessment_id, raw_predictions,
                            )
                    except Exception as e:
                        logger.warning("Failed to store predictions for %s: %s", ticker, e)

                meta = assessment.get("_meta", {})
                total_tokens += meta.get("tokens_used", 0)
                total_cost += meta.get("cost_usd", 0)
                total_discrepancies += len(discrepancies)

                if assessment.get("needs_attention"):
                    flagged += 1
                if score_changes:
                    changed += 1

                assessed += 1
                results.append({
                    "ticker": ticker,
                    "status": "success",
                    "strategy": strategy,
                    "significance": significance.value,
                    "needs_attention": assessment.get("needs_attention", False),
                    "discrepancies": len(discrepancies),
                    "changes": len(score_changes),
                    "grades": {
                        f: assessment.get("grades", {}).get(f, {}).get("grade")
                        for f in GRADED_FACTORS
                    },
                })
                logger.info(
                    "Assessed %s [%s/%s]: attention=%s, discrepancies=%d, changes=%d",
                    ticker, strategy, significance.value,
                    assessment.get("needs_attention", False),
                    len(discrepancies),
                    len(score_changes),
                )

            except Exception as e:
                failed += 1
                results.append({"ticker": ticker, "status": "failed", "error": str(e)})
                logger.error("Failed to assess %s: %s", ticker, e, exc_info=True)

        # Generate run summary
        summary = None
        if assessed > 0:
            try:
                summary = await self._generate_run_summary(run_id, run_date, results, total_discrepancies)
            except Exception as e:
                logger.error("Failed to generate run summary: %s", e)
                summary = (
                    f"Assessed {assessed}/{total_deals} deals. "
                    f"{flagged} flagged, {changed} changed, {total_discrepancies} discrepancies, {failed} failed."
                )

        # Update run record
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE risk_assessment_runs
                   SET status = 'completed',
                       finished_at = NOW(),
                       duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER * 1000,
                       total_deals = $2,
                       assessed_deals = $3,
                       failed_deals = $4,
                       flagged_deals = $5,
                       changed_deals = $6,
                       total_tokens = $7,
                       total_cost_usd = $8,
                       summary = $9,
                       reused_deals = $10,
                       delta_deals = $11,
                       full_deals = $12,
                       estimated_savings_usd = $13
                   WHERE id = $1""",
                run_id, total_deals, assessed, failed, flagged, changed,
                total_tokens, total_cost, summary,
                reused_deals, delta_deals, full_deals, round(estimated_savings, 4),
            )

        logger.info(
            "Risk run %s completed: %d/%d assessed (%d reused, %d delta, %d full), "
            "%d flagged, %d changed, %d discrepancies, %d failed, $%.4f cost, $%.4f saved",
            run_id, assessed, total_deals, reused_deals, delta_deals, full_deals,
            flagged, changed, total_discrepancies, failed, total_cost, estimated_savings,
        )

        # Capture daily estimate snapshots for prediction tracking
        try:
            from .estimate_tracker import capture_daily_estimates
            async with self.pool.acquire() as conn:
                stored = await conn.fetch(
                    "SELECT * FROM deal_risk_assessments WHERE run_id = $1", run_id
                )
            tracker_list = []
            for sa in stored:
                d = dict(sa)
                ai_resp = d.get("ai_response")
                if isinstance(ai_resp, str):
                    ai_resp = json.loads(ai_resp) if ai_resp else {}
                if isinstance(ai_resp, dict):
                    d.update(ai_resp)
                tracker_list.append(d)
            snapshot_result = await capture_daily_estimates(self.pool, tracker_list)
            logger.info("Estimate snapshots captured: %s", snapshot_result)
        except Exception as e:
            logger.error("Estimate snapshot capture failed: %s", e, exc_info=True)

        # Auto-resolve milestone predictions and expire overdue
        if ENABLE_PREDICTIONS:
            try:
                from .predictions import resolve_from_milestones, expire_overdue_predictions
                for ticker in tickers:
                    await resolve_from_milestones(self.pool, ticker)
                await expire_overdue_predictions(self.pool)
            except Exception as e:
                logger.warning("Prediction resolution failed: %s", e)

        # Populate human review queue
        if ENABLE_REVIEW_QUEUE:
            try:
                from .review_queue import generate_review_items
                review_items = await generate_review_items(self.pool, run_id, run_date)
                logger.info("Review queue: %d items generated", len(review_items))
            except Exception as e:
                logger.warning("Review queue population failed: %s", e)

        return {
            "run_id": str(run_id),
            "run_date": str(run_date),
            "status": "completed",
            "total_deals": total_deals,
            "assessed_deals": assessed,
            "failed_deals": failed,
            "flagged_deals": flagged,
            "changed_deals": changed,
            "total_discrepancies": total_discrepancies,
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 4),
            "reused_deals": reused_deals,
            "delta_deals": delta_deals,
            "full_deals": full_deals,
            "estimated_savings_usd": round(estimated_savings, 4),
            "summary": summary,
            "results": results,
        }

    # ------------------------------------------------------------------
    # Run summary generation
    # ------------------------------------------------------------------
    async def _generate_run_summary(self, run_id, run_date, results: list, total_discrepancies: int = 0) -> str:
        """Generate an executive summary of the run using Claude."""
        assessments = await self._fetch_run_assessments(run_id)
        changes = await self._fetch_run_changes(run_date)

        summary_prompt = f"""Summarize today's ({run_date}) morning risk assessment run for an M&A portfolio manager.

Results: {len(results)} deals assessed.
- Flagged for attention: {sum(1 for r in results if r.get('needs_attention'))}
- With grade/score changes: {sum(1 for r in results if r.get('changes', 0) > 0)}
- Total discrepancies vs sheet: {total_discrepancies}
- Failed: {sum(1 for r in results if r['status'] == 'failed')}

Assessments:
"""
        for a in assessments:
            grades_str = ""
            for f in GRADED_FACTORS:
                g = a.get(f"{f}_grade")
                if g:
                    grades_str += f" {f}={g}"
            summary_prompt += (
                f"- {a['ticker']}:{grades_str}, "
                f"investable={a.get('investable_assessment', 'N/A')}, "
                f"attention={a['needs_attention']}, "
                f"discrepancies={a.get('discrepancy_count', 0)}\n"
            )

        if changes:
            summary_prompt += "\nSignificant changes from yesterday:\n"
            for c in changes:
                summary_prompt += (
                    f"- {c['ticker']} {c['factor']}: {c['old_level']}->{c['new_level']} "
                    f"({c['direction']})\n"
                )

        summary_prompt += """
Write a concise 3-5 sentence executive summary. Focus on:
1. Overall portfolio risk posture
2. Deals needing attention and why
3. Notable discrepancies between our AI grades and the Google Sheet
4. Significant changes from yesterday
Keep it actionable and direct."""

        response = self.anthropic.messages.create(
            model=self.summary_model,
            temperature=0.3,
            max_tokens=1500,
            messages=[{"role": "user", "content": summary_prompt}],
        )

        return response.content[0].text

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------
    async def _store_assessment(
        self, run_id, run_date, ticker, assessment, context=None, discrepancies=None,
    ) -> uuid.UUID:
        """Insert a single deal assessment into the database. Returns the assessment ID."""
        assessment_id = uuid.uuid4()

        # Extract grades
        grades = assessment.get("grades", {})
        vote_g = grades.get("vote", {})
        fin_g = grades.get("financing", {})
        legal_g = grades.get("legal", {})
        reg_g = grades.get("regulatory", {})
        mac_g = grades.get("mac", {})

        # Extract supplemental scores
        supplementals = assessment.get("supplemental_scores", {})
        market_s = supplementals.get("market", {})
        timing_s = supplementals.get("timing", {})
        comp_s = supplementals.get("competing_bid", {})

        # Deal metrics from context
        row = (context or {}).get("sheet_row", {})
        deal_price = row.get("deal_price")
        current_price = row.get("current_price")
        gross_yield = row.get("gross_yield")
        current_yield = row.get("current_yield")
        countdown_days = row.get("countdown_days")

        # Sheet comparison values
        sheet_comp = (context or {}).get("sheet_comparison", {})
        details = (context or {}).get("deal_details", {})

        # Flags
        has_new_filing = len((context or {}).get("recent_filings", [])) > 0
        has_new_halt = len((context or {}).get("recent_halts", [])) > 0
        has_spread_change = any(
            any(k in ("current_price_raw", "gross_yield_raw", "current_yield_raw")
                for k in (d.get("changed_fields") or {}).keys())
            for d in (context or {}).get("sheet_diffs", [])
            if isinstance(d.get("changed_fields"), dict)
        )

        meta = assessment.get("_meta", {})
        ctx_info = assessment.get("_context", {})
        disc_list = discrepancies or []

        # Build input_data with context summary for tomorrow's comparison
        input_data = {
            "ticker": ticker,
            "context_keys": list((context or {}).keys()),
            "context_hash": ctx_info.get("context_hash"),
            "context_summary": ctx_info.get("context_summary"),
        }

        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO deal_risk_assessments (
                    id, assessment_date, ticker,
                    -- Grades
                    vote_grade, vote_detail, vote_confidence,
                    financing_grade, financing_detail, financing_confidence,
                    legal_grade, legal_detail, legal_confidence,
                    regulatory_grade, regulatory_detail, regulatory_confidence,
                    mac_grade, mac_detail, mac_confidence,
                    -- Supplemental scores
                    market_score, market_detail,
                    timing_score, timing_detail,
                    competing_bid_score, competing_bid_detail,
                    -- Investability
                    investable_assessment, investable_reasoning,
                    -- Our estimates
                    our_prob_success, our_prob_higher_offer,
                    our_break_price, our_implied_downside,
                    -- Sheet values at assessment time
                    sheet_vote_risk, sheet_finance_risk, sheet_legal_risk,
                    sheet_investable, sheet_prob_success,
                    -- Discrepancies and events
                    discrepancies, discrepancy_count,
                    -- Deal summary
                    deal_summary, key_risks, watchlist_items,
                    -- Deal metrics
                    deal_price, current_price,
                    gross_spread_pct, annualized_yield_pct,
                    days_to_close, probability_of_success,
                    -- Flags
                    has_new_filing, has_new_halt,
                    has_spread_change, has_risk_change,
                    needs_attention, attention_reason,
                    -- Raw data
                    input_data, ai_response,
                    model_used, tokens_used, processing_time_ms,
                    run_id,
                    -- Token efficiency columns
                    context_hash, assessment_strategy, change_significance,
                    input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, cost_usd
                ) VALUES (
                    $1, $2, $3,
                    $4, $5, $6,
                    $7, $8, $9,
                    $10, $11, $12,
                    $13, $14, $15,
                    $16, $17, $18,
                    $19, $20,
                    $21, $22,
                    $23, $24,
                    $25, $26,
                    $27, $28,
                    $29, $30,
                    $31, $32, $33,
                    $34, $35,
                    $36, $37,
                    $38, $39, $40,
                    $41, $42,
                    $43, $44,
                    $45, $46,
                    $47, $48,
                    $49, $50,
                    $51, $52,
                    $53, $54,
                    $55, $56, $57,
                    $58,
                    $59, $60, $61,
                    $62, $63,
                    $64, $65, $66
                )
                ON CONFLICT (assessment_date, ticker) DO UPDATE SET
                    id = EXCLUDED.id,
                    vote_grade = EXCLUDED.vote_grade, vote_detail = EXCLUDED.vote_detail, vote_confidence = EXCLUDED.vote_confidence,
                    financing_grade = EXCLUDED.financing_grade, financing_detail = EXCLUDED.financing_detail, financing_confidence = EXCLUDED.financing_confidence,
                    legal_grade = EXCLUDED.legal_grade, legal_detail = EXCLUDED.legal_detail, legal_confidence = EXCLUDED.legal_confidence,
                    regulatory_grade = EXCLUDED.regulatory_grade, regulatory_detail = EXCLUDED.regulatory_detail, regulatory_confidence = EXCLUDED.regulatory_confidence,
                    mac_grade = EXCLUDED.mac_grade, mac_detail = EXCLUDED.mac_detail, mac_confidence = EXCLUDED.mac_confidence,
                    market_score = EXCLUDED.market_score, market_detail = EXCLUDED.market_detail,
                    timing_score = EXCLUDED.timing_score, timing_detail = EXCLUDED.timing_detail,
                    competing_bid_score = EXCLUDED.competing_bid_score, competing_bid_detail = EXCLUDED.competing_bid_detail,
                    investable_assessment = EXCLUDED.investable_assessment, investable_reasoning = EXCLUDED.investable_reasoning,
                    our_prob_success = EXCLUDED.our_prob_success, our_prob_higher_offer = EXCLUDED.our_prob_higher_offer,
                    our_break_price = EXCLUDED.our_break_price, our_implied_downside = EXCLUDED.our_implied_downside,
                    sheet_vote_risk = EXCLUDED.sheet_vote_risk, sheet_finance_risk = EXCLUDED.sheet_finance_risk, sheet_legal_risk = EXCLUDED.sheet_legal_risk,
                    sheet_investable = EXCLUDED.sheet_investable, sheet_prob_success = EXCLUDED.sheet_prob_success,
                    discrepancies = EXCLUDED.discrepancies, discrepancy_count = EXCLUDED.discrepancy_count,
                    deal_summary = EXCLUDED.deal_summary, key_risks = EXCLUDED.key_risks, watchlist_items = EXCLUDED.watchlist_items,
                    deal_price = EXCLUDED.deal_price, current_price = EXCLUDED.current_price,
                    gross_spread_pct = EXCLUDED.gross_spread_pct, annualized_yield_pct = EXCLUDED.annualized_yield_pct,
                    days_to_close = EXCLUDED.days_to_close, probability_of_success = EXCLUDED.probability_of_success,
                    has_new_filing = EXCLUDED.has_new_filing, has_new_halt = EXCLUDED.has_new_halt,
                    has_spread_change = EXCLUDED.has_spread_change, has_risk_change = EXCLUDED.has_risk_change,
                    needs_attention = EXCLUDED.needs_attention, attention_reason = EXCLUDED.attention_reason,
                    input_data = EXCLUDED.input_data, ai_response = EXCLUDED.ai_response,
                    model_used = EXCLUDED.model_used, tokens_used = EXCLUDED.tokens_used, processing_time_ms = EXCLUDED.processing_time_ms,
                    run_id = EXCLUDED.run_id,
                    context_hash = EXCLUDED.context_hash, assessment_strategy = EXCLUDED.assessment_strategy, change_significance = EXCLUDED.change_significance,
                    input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
                    cache_read_tokens = EXCLUDED.cache_read_tokens, cache_creation_tokens = EXCLUDED.cache_creation_tokens, cost_usd = EXCLUDED.cost_usd
                """,
                assessment_id, run_date, ticker,
                # Grades
                vote_g.get("grade"), vote_g.get("detail"), vote_g.get("confidence"),
                fin_g.get("grade"), fin_g.get("detail"), fin_g.get("confidence"),
                legal_g.get("grade"), legal_g.get("detail"), legal_g.get("confidence"),
                reg_g.get("grade"), reg_g.get("detail"), reg_g.get("confidence"),
                mac_g.get("grade"), mac_g.get("detail"), mac_g.get("confidence"),
                # Supplemental scores
                market_s.get("score"), market_s.get("detail"),
                timing_s.get("score"), timing_s.get("detail"),
                comp_s.get("score"), comp_s.get("detail"),
                # Investability
                assessment.get("investable_assessment"),
                assessment.get("investable_reasoning"),
                # Our estimates (handle both structured and scalar formats)
                _extract_estimate_value(assessment, "probability_of_success"),
                _extract_estimate_value(assessment, "probability_of_higher_offer"),
                _extract_estimate_value(assessment, "break_price_estimate"),
                _extract_estimate_value(assessment, "implied_downside_estimate"),
                # Sheet values
                sheet_comp.get("vote_risk"),
                sheet_comp.get("finance_risk"),
                sheet_comp.get("legal_risk"),
                sheet_comp.get("investable"),
                float(sheet_comp["prob_success"]) if sheet_comp.get("prob_success") is not None else None,
                # Discrepancies
                json.dumps(disc_list) if disc_list else None,
                len(disc_list),
                # Deal summary
                assessment.get("deal_summary"),
                json.dumps(assessment.get("key_risks")) if assessment.get("key_risks") else None,
                json.dumps(assessment.get("watchlist_items")) if assessment.get("watchlist_items") else None,
                # Deal metrics
                float(deal_price) if deal_price is not None else None,
                float(current_price) if current_price is not None else None,
                float(gross_yield) if gross_yield is not None else None,
                float(current_yield) if current_yield is not None else None,
                countdown_days,
                _extract_estimate_value(assessment, "probability_of_success"),
                # Flags
                has_new_filing, has_new_halt,
                has_spread_change, False,  # has_risk_change set after change detection
                assessment.get("needs_attention", False),
                assessment.get("attention_reason"),
                # Raw data
                json.dumps(input_data),
                json.dumps(assessment),
                meta.get("model", self.model),
                meta.get("tokens_used", 0),
                meta.get("processing_time_ms", 0),
                run_id,
                # Token efficiency columns
                ctx_info.get("context_hash"),
                ctx_info.get("assessment_strategy", "full"),
                ctx_info.get("change_significance"),
                meta.get("input_tokens", 0),
                meta.get("output_tokens", 0),
                meta.get("cache_read_tokens", 0),
                meta.get("cache_creation_tokens", 0),
                meta.get("cost_usd", 0),
            )

        # Dual-write: sync to canonical_risk_grades
        try:
            await self._sync_risk_to_canonical(
                run_date, ticker, assessment, sheet_comp, details, assessment_id,
            )
        except Exception:
            logger.warning("Canonical risk sync failed for %s (non-critical)", ticker, exc_info=True)

        return assessment_id

    async def _sync_risk_to_canonical(
        self, assessed_date, ticker, assessment, sheet_comp, details, assessment_id,
    ) -> None:
        """Sync risk grades to canonical_risk_grades (dual-write)."""
        grades = assessment.get("grades", {})
        supplementals = assessment.get("supplemental_scores", {})

        # Extract production disagreements for counting
        prod_disagreements = assessment.get("production_disagreements", [])
        material_count = sum(
            1 for d in prod_disagreements
            if isinstance(d, dict) and d.get("severity") == "material"
        )

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO canonical_risk_grades (
                    ticker, assessed_date,
                    sheet_vote_grade, sheet_financing_grade, sheet_legal_grade,
                    ai_vote_grade, ai_vote_confidence, ai_vote_detail,
                    ai_financing_grade, ai_financing_confidence, ai_financing_detail,
                    ai_legal_grade, ai_legal_confidence, ai_legal_detail,
                    ai_regulatory_grade, ai_regulatory_confidence, ai_regulatory_detail,
                    ai_mac_grade, ai_mac_confidence, ai_mac_detail,
                    ai_market_score, ai_timing_score, ai_competing_bid_score,
                    sheet_prob_success, ai_prob_success, ai_prob_success_confidence,
                    sheet_break_price, ai_break_price,
                    disagreement_count, material_disagreement_count,
                    ai_response, risk_assessment_id
                ) VALUES (
                    $1, $2,
                    $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11,
                    $12, $13, $14,
                    $15, $16, $17,
                    $18, $19, $20,
                    $21, $22, $23,
                    $24, $25, $26,
                    $27, $28,
                    $29, $30,
                    $31::jsonb, $32
                )
                ON CONFLICT (ticker, assessed_date) DO UPDATE SET
                    sheet_vote_grade = EXCLUDED.sheet_vote_grade,
                    sheet_financing_grade = EXCLUDED.sheet_financing_grade,
                    sheet_legal_grade = EXCLUDED.sheet_legal_grade,
                    ai_vote_grade = EXCLUDED.ai_vote_grade,
                    ai_vote_confidence = EXCLUDED.ai_vote_confidence,
                    ai_vote_detail = EXCLUDED.ai_vote_detail,
                    ai_financing_grade = EXCLUDED.ai_financing_grade,
                    ai_financing_confidence = EXCLUDED.ai_financing_confidence,
                    ai_financing_detail = EXCLUDED.ai_financing_detail,
                    ai_legal_grade = EXCLUDED.ai_legal_grade,
                    ai_legal_confidence = EXCLUDED.ai_legal_confidence,
                    ai_legal_detail = EXCLUDED.ai_legal_detail,
                    ai_regulatory_grade = EXCLUDED.ai_regulatory_grade,
                    ai_regulatory_confidence = EXCLUDED.ai_regulatory_confidence,
                    ai_regulatory_detail = EXCLUDED.ai_regulatory_detail,
                    ai_mac_grade = EXCLUDED.ai_mac_grade,
                    ai_mac_confidence = EXCLUDED.ai_mac_confidence,
                    ai_mac_detail = EXCLUDED.ai_mac_detail,
                    ai_market_score = EXCLUDED.ai_market_score,
                    ai_timing_score = EXCLUDED.ai_timing_score,
                    ai_competing_bid_score = EXCLUDED.ai_competing_bid_score,
                    sheet_prob_success = EXCLUDED.sheet_prob_success,
                    ai_prob_success = EXCLUDED.ai_prob_success,
                    ai_prob_success_confidence = EXCLUDED.ai_prob_success_confidence,
                    sheet_break_price = EXCLUDED.sheet_break_price,
                    ai_break_price = EXCLUDED.ai_break_price,
                    disagreement_count = EXCLUDED.disagreement_count,
                    material_disagreement_count = EXCLUDED.material_disagreement_count,
                    ai_response = EXCLUDED.ai_response,
                    risk_assessment_id = EXCLUDED.risk_assessment_id
                """,
                ticker,
                assessed_date,
                # Sheet grades
                sheet_comp.get("vote_risk"),
                sheet_comp.get("finance_risk"),
                sheet_comp.get("legal_risk"),
                # AI grades
                grades.get("vote", {}).get("grade"),
                grades.get("vote", {}).get("confidence"),
                grades.get("vote", {}).get("detail"),
                grades.get("financing", {}).get("grade"),
                grades.get("financing", {}).get("confidence"),
                grades.get("financing", {}).get("detail"),
                grades.get("legal", {}).get("grade"),
                grades.get("legal", {}).get("confidence"),
                grades.get("legal", {}).get("detail"),
                grades.get("regulatory", {}).get("grade"),
                grades.get("regulatory", {}).get("confidence"),
                grades.get("regulatory", {}).get("detail"),
                grades.get("mac", {}).get("grade"),
                grades.get("mac", {}).get("confidence"),
                grades.get("mac", {}).get("detail"),
                # Supplemental scores
                supplementals.get("market", {}).get("score"),
                supplementals.get("timing", {}).get("score"),
                supplementals.get("competing_bid", {}).get("score"),
                # Probabilities
                float(details.get("probability_of_success")) if details.get("probability_of_success") is not None else None,
                _extract_estimate_value(assessment, "probability_of_success"),
                assessment.get("probability_of_success", {}).get("confidence") if isinstance(assessment.get("probability_of_success"), dict) else None,
                # Break price
                float(details.get("break_price")) if details.get("break_price") is not None else None,
                _extract_estimate_value(assessment, "break_price_estimate"),
                # Disagreements
                len(prod_disagreements),
                material_count,
                # Full AI response
                json.dumps(assessment),
                assessment_id,
            )

        # Update canonical_deals.ai_last_assessed
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE canonical_deals SET ai_last_assessed = NOW(), updated_at = NOW() WHERE ticker = $1",
                ticker,
            )

    def _reconstruct_assessment(self, prev: dict) -> dict:
        """Reconstruct a parsed AI assessment dict from a previous DB record.

        Used by the reuse strategy to copy yesterday's assessment without
        calling Claude again.
        """
        grades = {}
        for f in GRADED_FACTORS:
            grades[f] = {
                "grade": prev.get(f"{f}_grade"),
                "detail": prev.get(f"{f}_detail"),
                "confidence": float(prev[f"{f}_confidence"]) if prev.get(f"{f}_confidence") is not None else None,
            }

        supplementals = {}
        for f in SUPPLEMENTAL_FACTORS:
            supplementals[f] = {
                "score": float(prev[f"{f}_score"]) if prev.get(f"{f}_score") is not None else None,
                "detail": prev.get(f"{f}_detail"),
            }

        # Try to load watchlist/key_risks from ai_response if available
        ai_resp = prev.get("ai_response")
        if isinstance(ai_resp, str):
            try:
                ai_resp = json.loads(ai_resp)
            except (json.JSONDecodeError, TypeError):
                ai_resp = {}
        elif not isinstance(ai_resp, dict):
            ai_resp = {}

        return {
            "grades": grades,
            "supplemental_scores": supplementals,
            "investable_assessment": prev.get("investable_assessment"),
            "investable_reasoning": prev.get("investable_reasoning"),
            "probability_of_success": float(prev["our_prob_success"]) if prev.get("our_prob_success") is not None else None,
            "probability_of_higher_offer": float(prev["our_prob_higher_offer"]) if prev.get("our_prob_higher_offer") is not None else None,
            "break_price_estimate": float(prev["our_break_price"]) if prev.get("our_break_price") is not None else None,
            "implied_downside_estimate": float(prev["our_implied_downside"]) if prev.get("our_implied_downside") is not None else None,
            "deal_summary": prev.get("deal_summary"),
            "key_risks": ai_resp.get("key_risks", []),
            "watchlist_items": ai_resp.get("watchlist_items", []),
            "production_disagreements": ai_resp.get("production_disagreements", []),
            "assessment_changes": ai_resp.get("assessment_changes", []),
            "needs_attention": prev.get("needs_attention", False),
            "attention_reason": prev.get("attention_reason"),
        }

    async def _store_change(self, assessment_id, run_date, ticker, change: dict):
        """Insert a single risk factor change record."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO risk_factor_changes (
                    assessment_id, ticker, change_date, factor,
                    old_score, new_score, old_level, new_level,
                    direction, magnitude, explanation
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                assessment_id, ticker, run_date, change["factor"],
                change["old_score"], change["new_score"],
                change["old_level"], change["new_level"],
                change["direction"], change["magnitude"],
                change.get("explanation", ""),
            )

        # Also update the has_risk_change flag on the assessment
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE deal_risk_assessments SET has_risk_change = TRUE WHERE id = $1",
                assessment_id,
            )

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------
    async def _fetch_run_assessments(self, run_id) -> list:
        """Fetch all assessments for a given run."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM deal_risk_assessments WHERE run_id = $1 ORDER BY ticker",
                run_id,
            )
        return [dict(r) for r in rows]

    async def _fetch_run_changes(self, run_date) -> list:
        """Fetch all risk factor changes for a given date."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM risk_factor_changes WHERE change_date = $1 ORDER BY ticker, factor",
                run_date,
            )
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------
    async def _finish_run(self, run_id, status, error=None):
        """Mark a run as finished (used for early exits)."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE risk_assessment_runs
                   SET status = $2, finished_at = NOW(),
                       duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER * 1000,
                       error = $3
                   WHERE id = $1""",
                run_id, status, error,
            )
