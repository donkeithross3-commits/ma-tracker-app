"""Risk Assessment Engine — runs morning risk analysis for all active deals.

Grade-based system: Low/Medium/High for 5 sheet-aligned factors,
0-10 supplemental scores for 3 factors the sheet does not assess.
"""

import json
import logging
import re
import time
import uuid
from datetime import date, datetime

from anthropic import Anthropic

from .prompts import RISK_ASSESSMENT_SYSTEM_PROMPT, build_deal_assessment_prompt

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

    MODEL = "claude-sonnet-4-20250514"
    # Sonnet pricing: $3/M input, $15/M output
    INPUT_COST_PER_TOKEN = 3 / 1_000_000
    OUTPUT_COST_PER_TOKEN = 15 / 1_000_000

    def __init__(self, pool, anthropic_key: str):
        self.pool = pool
        self.anthropic = Anthropic(api_key=anthropic_key)

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
            filings = await conn.fetch(
                """SELECT * FROM edgar_filings
                   WHERE ticker = $1 AND filed_at > NOW() - INTERVAL '30 days'
                   ORDER BY filed_at DESC""",
                ticker,
            )
            context["recent_filings"] = [dict(f) for f in filings]

            # 5. Recent trading halts (last 7 days)
            halts = await conn.fetch(
                """SELECT * FROM halt_events
                   WHERE ticker = $1 AND halted_at > NOW() - INTERVAL '7 days'
                   ORDER BY halted_at DESC""",
                ticker,
            )
            context["recent_halts"] = [dict(h) for h in halts]

            # 6. Recent sheet diffs (last 7 days)
            diffs = await conn.fetch(
                """SELECT * FROM sheet_diffs
                   WHERE ticker = $1 AND diff_date > CURRENT_DATE - INTERVAL '7 days'
                   ORDER BY diff_date DESC""",
                ticker,
            )
            context["sheet_diffs"] = [dict(d) for d in diffs]

            # 7. Existing AI research
            research = await conn.fetchrow(
                "SELECT * FROM deal_research WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
                ticker,
            )
            if research:
                context["existing_research"] = dict(research)

            # 8. Deal attributes
            attrs = await conn.fetchrow(
                "SELECT * FROM deal_attributes WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
                ticker,
            )
            if attrs:
                context["deal_attributes"] = dict(attrs)

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
    async def assess_single_deal(self, context: dict) -> dict:
        """Call Claude to assess risk for a single deal. Returns parsed JSON response."""
        ticker = context.get("ticker", "UNKNOWN")
        prompt = build_deal_assessment_prompt(context)

        t0 = time.monotonic()
        try:
            response = self.anthropic.messages.create(
                model=self.MODEL,
                temperature=0,
                max_tokens=2000,
                system=RISK_ASSESSMENT_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            logger.error("Claude API error for %s: %s", ticker, e)
            raise

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        tokens_used = response.usage.input_tokens + response.usage.output_tokens
        cost = (
            response.usage.input_tokens * self.INPUT_COST_PER_TOKEN
            + response.usage.output_tokens * self.OUTPUT_COST_PER_TOKEN
        )

        raw_text = response.content[0].text
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError:
            logger.error("Malformed JSON from Claude for %s: %s", ticker, raw_text[:500])
            raise ValueError(f"Claude returned invalid JSON for {ticker}")

        # Enrich with metadata
        parsed["_meta"] = {
            "model": self.MODEL,
            "tokens_used": tokens_used,
            "processing_time_ms": elapsed_ms,
            "cost_usd": cost,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
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

        for ticker in tickers:
            try:
                # Collect context
                context = await self.collect_deal_context(ticker)

                # Run AI assessment
                assessment = await self.assess_single_deal(context)

                # Detect discrepancies against sheet
                sheet_data = context.get("sheet_comparison", {})
                discrepancies = detect_discrepancies(assessment, sheet_data)

                # Detect changes from previous assessment
                prev = context.get("previous_assessment")
                score_changes = await self.detect_changes(ticker, assessment, prev)

                # Store assessment
                assessment_id = await self._store_assessment(
                    run_id, run_date, ticker, assessment, context, discrepancies,
                )

                # Store changes
                for change in score_changes:
                    await self._store_change(assessment_id, run_date, ticker, change)

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
                    "needs_attention": assessment.get("needs_attention", False),
                    "discrepancies": len(discrepancies),
                    "changes": len(score_changes),
                    "grades": {
                        f: assessment.get("grades", {}).get(f, {}).get("grade")
                        for f in GRADED_FACTORS
                    },
                })
                logger.info(
                    "Assessed %s: attention=%s, discrepancies=%d, changes=%d",
                    ticker,
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
                       summary = $9
                   WHERE id = $1""",
                run_id, total_deals, assessed, failed, flagged, changed,
                total_tokens, total_cost, summary,
            )

        logger.info(
            "Risk run %s completed: %d/%d assessed, %d flagged, %d changed, %d discrepancies, %d failed",
            run_id, assessed, total_deals, flagged, changed, total_discrepancies, failed,
        )

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
            model=self.MODEL,
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
            d.get("field_name") in ("current_price_raw", "gross_yield_raw", "current_yield_raw")
            for d in (context or {}).get("sheet_diffs", [])
        )

        meta = assessment.get("_meta", {})
        disc_list = discrepancies or []

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
                    run_id
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
                    $58
                )""",
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
                # Our estimates
                assessment.get("probability_of_success"),
                assessment.get("probability_of_higher_offer"),
                assessment.get("break_price_estimate"),
                assessment.get("implied_downside_estimate"),
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
                assessment.get("probability_of_success"),
                # Flags
                has_new_filing, has_new_halt,
                has_spread_change, False,  # has_risk_change set after change detection
                assessment.get("needs_attention", False),
                assessment.get("attention_reason"),
                # Raw data
                json.dumps({"ticker": ticker, "context_keys": list((context or {}).keys())}),
                json.dumps(assessment),
                meta.get("model", self.MODEL),
                meta.get("tokens_used", 0),
                meta.get("processing_time_ms", 0),
                run_id,
            )

        return assessment_id

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
