"""Model A/B comparison framework for risk assessments.

Sends identical prompts to two models and compares quality metrics,
cost, and latency. Results are stored in model_comparison_runs.
"""

import json
import logging
import random
import time
import uuid

from anthropic import Anthropic

from .model_config import compute_cost, get_pricing
from .prompts import RISK_ASSESSMENT_SYSTEM_PROMPT, build_deal_assessment_prompt

logger = logging.getLogger(__name__)

GRADED_FACTORS = ["vote", "financing", "legal", "regulatory", "mac"]


def _reasoning_depth(response: dict) -> int:
    """Total chars of detail/reasoning fields in a parsed response."""
    total = 0
    for f in GRADED_FACTORS:
        total += len(response.get("grades", {}).get(f, {}).get("detail", ""))
    for f in ("market", "timing", "competing_bid"):
        total += len(response.get("supplemental_scores", {}).get(f, {}).get("detail", ""))
    total += len(response.get("investable_reasoning", ""))
    total += len(response.get("deal_summary", ""))
    for item in response.get("key_risks", []):
        total += len(str(item))
    return total


def _compare_responses(resp_a: dict, resp_b: dict) -> dict:
    """Compute quality comparison metrics between two parsed responses."""
    # Grade agreement (0-5)
    agreement = 0
    for f in GRADED_FACTORS:
        g_a = resp_a.get("grades", {}).get(f, {}).get("grade")
        g_b = resp_b.get("grades", {}).get(f, {}).get("grade")
        if g_a and g_b and g_a == g_b:
            agreement += 1

    # Probability divergence
    prob_a = resp_a.get("probability_of_success")
    prob_b = resp_b.get("probability_of_success")
    prob_diff = None
    if prob_a is not None and prob_b is not None:
        try:
            prob_diff = abs(float(prob_a) - float(prob_b))
        except (ValueError, TypeError):
            pass

    # Investability agreement
    inv_a = resp_a.get("investable_assessment", "").strip()
    inv_b = resp_b.get("investable_assessment", "").strip()
    investable_agree = inv_a == inv_b if (inv_a and inv_b) else None

    return {
        "grade_agreement": agreement,
        "prob_success_diff": prob_diff,
        "investable_agree": investable_agree,
        "reasoning_depth_a": _reasoning_depth(resp_a),
        "reasoning_depth_b": _reasoning_depth(resp_b),
    }


async def _call_model(anthropic: Anthropic, model: str, prompt: str) -> dict:
    """Call a single model and return parsed response + metadata."""
    t0 = time.monotonic()
    response = anthropic.messages.create(
        model=model,
        temperature=0,
        max_tokens=2000,
        system=[{
            "type": "text",
            "text": RISK_ASSESSMENT_SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": prompt}],
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)

    raw_text = response.content[0].text
    # Strip markdown code fences if present
    stripped = raw_text.strip()
    if stripped.startswith("```"):
        import re
        stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    parsed = json.loads(stripped)

    cache_creation = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
    cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0

    cost = compute_cost(
        model,
        response.usage.input_tokens,
        response.usage.output_tokens,
        cache_creation,
        cache_read,
    )

    return {
        "parsed": parsed,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "cost_usd": cost,
        "latency_ms": elapsed_ms,
    }


async def run_model_comparison(
    pool,
    api_key: str,
    model_a: str,
    model_b: str,
    sample_size: int = 5,
) -> dict:
    """Run A/B comparison on a random sample of deals.

    Returns summary of comparison results.
    """
    anthropic = Anthropic(api_key=api_key)

    # Import engine here to avoid circular imports
    from .engine import RiskAssessmentEngine
    engine = RiskAssessmentEngine(pool, api_key)

    # Get active tickers
    async with pool.acquire() as conn:
        snapshot = await conn.fetchrow(
            "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
        )
        if not snapshot:
            return {"error": "No snapshots found", "comparisons": []}

        rows = await conn.fetch(
            """SELECT DISTINCT ticker FROM sheet_rows
               WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)
               ORDER BY ticker""",
            snapshot["id"],
        )

    tickers = [r["ticker"] for r in rows]
    sample = random.sample(tickers, min(sample_size, len(tickers)))

    comparisons = []
    for ticker in sample:
        try:
            context = await engine.collect_deal_context(ticker)
            prompt = build_deal_assessment_prompt(context)

            result_a = await _call_model(anthropic, model_a, prompt)
            result_b = await _call_model(anthropic, model_b, prompt)

            metrics = _compare_responses(result_a["parsed"], result_b["parsed"])

            comparison_id = uuid.uuid4()
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO model_comparison_runs (
                        id, ticker, model_a, model_b,
                        grade_agreement, prob_success_diff, investable_agree,
                        reasoning_depth_a, reasoning_depth_b,
                        input_tokens_a, output_tokens_a, cost_usd_a, latency_ms_a,
                        input_tokens_b, output_tokens_b, cost_usd_b, latency_ms_b,
                        response_a, response_b
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7,
                        $8, $9,
                        $10, $11, $12, $13,
                        $14, $15, $16, $17,
                        $18, $19
                    )""",
                    comparison_id, ticker, model_a, model_b,
                    metrics["grade_agreement"],
                    metrics["prob_success_diff"],
                    metrics["investable_agree"],
                    metrics["reasoning_depth_a"],
                    metrics["reasoning_depth_b"],
                    result_a["input_tokens"], result_a["output_tokens"],
                    result_a["cost_usd"], result_a["latency_ms"],
                    result_b["input_tokens"], result_b["output_tokens"],
                    result_b["cost_usd"], result_b["latency_ms"],
                    json.dumps(result_a["parsed"]),
                    json.dumps(result_b["parsed"]),
                )

            comparisons.append({
                "ticker": ticker,
                "comparison_id": str(comparison_id),
                "grade_agreement": metrics["grade_agreement"],
                "prob_success_diff": metrics["prob_success_diff"],
                "investable_agree": metrics["investable_agree"],
                "cost_a": round(result_a["cost_usd"], 6),
                "cost_b": round(result_b["cost_usd"], 6),
                "latency_a": result_a["latency_ms"],
                "latency_b": result_b["latency_ms"],
            })

            logger.info(
                "Compared %s: agreement=%d/5, prob_diff=%.1f, cost_a=$%.4f, cost_b=$%.4f",
                ticker,
                metrics["grade_agreement"],
                metrics["prob_success_diff"] or 0,
                result_a["cost_usd"],
                result_b["cost_usd"],
            )

        except Exception as e:
            logger.error("Model comparison failed for %s: %s", ticker, e, exc_info=True)
            comparisons.append({"ticker": ticker, "error": str(e)})

    # Aggregate
    successful = [c for c in comparisons if "error" not in c]
    total_cost = sum(c.get("cost_a", 0) + c.get("cost_b", 0) for c in successful)

    return {
        "model_a": model_a,
        "model_b": model_b,
        "sample_size": len(sample),
        "successful": len(successful),
        "total_cost_usd": round(total_cost, 4),
        "avg_grade_agreement": (
            round(sum(c["grade_agreement"] for c in successful) / len(successful), 2)
            if successful else None
        ),
        "comparisons": comparisons,
    }
