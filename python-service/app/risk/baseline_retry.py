"""Retry failed baseline results with assistant prefill to force JSON output.

Extracted from tools/retry_baseline_failures.py for programmatic use
from the scheduler and API endpoints.
"""
import asyncio
import json
import logging
import re
import time

from anthropic import Anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from app.risk.model_config import compute_cost, CACHE_MIN_TOKENS
from app.risk.model_evaluator import (
    BASELINE_MODELS,
    _extract_grades,
    _extract_prob,
    _reasoning_depth,
)
from app.risk.prompts import RISK_ASSESSMENT_SYSTEM_PROMPT, build_deal_assessment_prompt

logger = logging.getLogger(__name__)

# Only retry models with reasonable JSON success rates
RETRY_MODELS = [m for m in BASELINE_MODELS if "haiku" not in m]

BATCH_POLL_INTERVAL = 30
BATCH_TIMEOUT = 3600
JSON_ENFORCE = """

CRITICAL FORMATTING REQUIREMENT: Your entire response must be a single valid JSON object.
Do NOT write any analysis, reasoning, or prose before or after the JSON.
Do NOT use markdown code fences.
Start your response with the opening brace { and end with the closing brace }.
The very first character of your response MUST be {"""


def _model_label(model: str) -> str:
    if "opus" in model:
        return "opus"
    if "sonnet" in model:
        return "sonnet"
    if "haiku" in model:
        return "haiku"
    return model[:10]


async def retry_failures(pool, api_key: str, run_id: str) -> dict:
    """Retry missing baseline results with JSON enforcement.

    Returns {stored, failed, cost}.
    """
    import uuid

    client = Anthropic(api_key=api_key)

    async with pool.acquire() as conn:
        run = await conn.fetchrow(
            "SELECT id FROM baseline_runs WHERE id = $1", uuid.UUID(run_id)
        )
        if not run:
            logger.error("No baseline run found for %s", run_id)
            return {"stored": 0, "failed": 0, "cost": 0.0, "error": "run not found"}

        run_uuid = run["id"]

        existing = await conn.fetch(
            "SELECT ticker, model FROM baseline_model_results WHERE run_id = $1",
            run_uuid,
        )
        existing_set = {(r["ticker"], r["model"]) for r in existing}

        snapshot = await conn.fetchrow(
            "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
        )
        rows = await conn.fetch(
            """SELECT DISTINCT ticker FROM sheet_rows
               WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)
               ORDER BY ticker""",
            snapshot["id"],
        )

    tickers = [r["ticker"] for r in rows]

    missing = []
    for ticker in tickers:
        for model in RETRY_MODELS:
            if (ticker, model) not in existing_set:
                missing.append((ticker, model))

    if not missing:
        logger.info("No missing results to retry!")
        return {"stored": 0, "failed": 0, "cost": 0.0}

    logger.info(
        "Found %d missing results to retry (%d Opus, %d Sonnet)",
        len(missing),
        sum(1 for _, m in missing if "opus" in m),
        sum(1 for _, m in missing if "sonnet" in m),
    )

    # Collect context and build prompts
    import os
    from app.risk.engine import RiskAssessmentEngine
    engine = RiskAssessmentEngine(pool, api_key)

    deal_prompts = {}
    for ticker in set(t for t, _ in missing):
        try:
            context = await engine.collect_deal_context(ticker)
            deal_prompts[ticker] = build_deal_assessment_prompt(context)
        except Exception as e:
            logger.error("Context failed for %s: %s", ticker, e)

    # Build batch requests with prefill
    batch_requests = []
    ticker_model_map = {}

    for ticker, model in missing:
        if ticker not in deal_prompts:
            continue

        label = _model_label(model)
        custom_id = f"risk-{ticker}--{label}"
        ticker_model_map[custom_id] = model

        min_tokens = CACHE_MIN_TOKENS.get(model, 1024)
        system_block = {"type": "text", "text": RISK_ASSESSMENT_SYSTEM_PROMPT}
        approx_tokens = len(RISK_ASSESSMENT_SYSTEM_PROMPT) // 4
        if approx_tokens >= min_tokens:
            system_block["cache_control"] = {"type": "ephemeral"}

        batch_requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=model,
                    temperature=0,
                    max_tokens=4096,
                    system=[system_block],
                    messages=[
                        {"role": "user", "content": deal_prompts[ticker] + JSON_ENFORCE},
                    ],
                ),
            )
        )

    if not batch_requests:
        logger.info("No valid requests to submit")
        return {"stored": 0, "failed": 0, "cost": 0.0}

    logger.info("Submitting %d retry requests with JSON prefill...", len(batch_requests))

    t0 = time.monotonic()
    message_batch = client.messages.batches.create(requests=batch_requests)
    batch_id = message_batch.id
    logger.info("Batch %s created, polling...", batch_id)

    elapsed = 0
    while elapsed < BATCH_TIMEOUT:
        await asyncio.sleep(BATCH_POLL_INTERVAL)
        elapsed = time.monotonic() - t0
        message_batch = client.messages.batches.retrieve(batch_id)
        counts = message_batch.request_counts
        logger.info(
            "Batch %s: %d succeeded, %d processing, %d errored",
            batch_id, counts.succeeded, counts.processing, counts.errored,
        )
        if message_batch.processing_status == "ended":
            break

    total_elapsed_ms = int((time.monotonic() - t0) * 1000)

    # Process results
    stored = 0
    failed = 0
    total_cost = 0.0

    async with pool.acquire() as conn:
        presented = await conn.fetch(
            "SELECT ticker FROM baseline_model_results WHERE run_id = $1 AND is_presented = TRUE",
            run_uuid,
        )
        presented_tickers = {r["ticker"] for r in presented}

    for result in client.messages.batches.results(batch_id):
        custom_id = result.custom_id
        compound_key = custom_id.replace("risk-", "", 1)
        parts = compound_key.split("--")
        ticker = parts[0]
        label = parts[1] if len(parts) > 1 else "unknown"
        model = ticker_model_map.get(custom_id, "unknown")

        if result.result.type != "succeeded":
            logger.warning("Retry %s errored: %s", custom_id, result.result.type)
            failed += 1
            continue

        msg = result.result.message
        raw_text = msg.content[0].text if msg.content else ""

        stripped = raw_text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
            stripped = re.sub(r"\n?```\s*$", "", stripped)

        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            logger.warning("Retry %s still invalid JSON (first 200): %s", custom_id, stripped[:200])
            failed += 1
            continue

        usage = msg.usage
        cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cost = compute_cost(
            model, usage.input_tokens, usage.output_tokens,
            cache_creation, cache_read,
        ) * 0.5
        total_cost += cost

        grades = _extract_grades(parsed)
        prob = _extract_prob(parsed)
        depth = _reasoning_depth(parsed)
        inv = parsed.get("investable_assessment", "")

        is_presented = ticker not in presented_tickers
        if is_presented:
            presented_tickers.add(ticker)

        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO baseline_model_results (
                        run_id, ticker, model, is_presented,
                        response, input_tokens, output_tokens,
                        cost_usd, latency_ms,
                        probability_of_success, investable_assessment,
                        reasoning_depth,
                        grade_vote, grade_financing, grade_legal,
                        grade_regulatory, grade_mac
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7,
                        $8, $9,
                        $10, $11,
                        $12,
                        $13, $14, $15,
                        $16, $17
                    )
                    ON CONFLICT (run_id, ticker, model) DO NOTHING""",
                    run_uuid, ticker, model, is_presented,
                    json.dumps(parsed),
                    usage.input_tokens, usage.output_tokens,
                    cost, total_elapsed_ms,
                    prob, inv, depth,
                    grades["grade_vote"], grades["grade_financing"],
                    grades["grade_legal"], grades["grade_regulatory"],
                    grades["grade_mac"],
                )
            stored += 1
            logger.info("Stored retry %s/%s (cost=$%.4f)", ticker, label, cost)
        except Exception as e:
            logger.error("DB error storing %s: %s", custom_id, e)
            failed += 1

    # Update run totals
    async with pool.acquire() as conn:
        current = await conn.fetchrow(
            "SELECT successful, total_cost_usd FROM baseline_runs WHERE id = $1", run_uuid
        )
        await conn.execute(
            """UPDATE baseline_runs
               SET successful = $2, total_cost_usd = $3
               WHERE id = $1""",
            run_uuid,
            (current["successful"] or 0) + stored,
            round(float(current["total_cost_usd"] or 0) + total_cost, 4),
        )

    logger.info(
        "Retry complete: %d stored, %d failed, $%.2f additional cost, %dms",
        stored, failed, total_cost, total_elapsed_ms,
    )

    return {"stored": stored, "failed": failed, "cost": round(total_cost, 4)}
