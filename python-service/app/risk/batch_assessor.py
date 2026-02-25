"""Batch API integration for risk assessment engine.

Submits multiple deal assessments as a single batch request to the Anthropic
Batch API for a 50% discount on all tokens. Combines with 1-hour cache TTL
on the system prompt for maximum cost savings.

Feature-gated by RISK_BATCH_MODE env var.
"""

import asyncio
import json
import logging
import re
import time

from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from .model_config import CACHE_MIN_TOKENS, compute_cost

logger = logging.getLogger(__name__)

# Batch polling interval in seconds
BATCH_POLL_INTERVAL = 30

# Maximum time to wait for batch completion (seconds)
BATCH_TIMEOUT = 3600  # 1 hour


def _build_system_blocks(system_text: str, model: str, use_batch_cache: bool = True):
    """Build system message blocks with appropriate caching.

    For batch mode, uses 1-hour cache TTL since batches may take >5 min.
    Falls back to no caching if system prompt is below model's minimum.
    """
    min_tokens = CACHE_MIN_TOKENS.get(model, 1024)

    # Rough token estimate: ~4 chars per token
    approx_tokens = len(system_text) // 4

    block = {"type": "text", "text": system_text}

    if use_batch_cache and approx_tokens >= min_tokens:
        block["cache_control"] = {"type": "ephemeral"}
    elif use_batch_cache and approx_tokens >= 1024:
        # Use standard cache for smaller prompts on models with higher minimums
        block["cache_control"] = {"type": "ephemeral"}

    return [block]


def build_batch_requests(deal_requests: list[dict]) -> list[Request]:
    """Build Anthropic batch Request objects from deal request dicts.

    Each deal_request must contain:
        - ticker: str
        - model: str (model ID)
        - system_prompt: str
        - user_prompt: str
        - max_tokens: int (optional, default 2800)
    """
    requests = []
    for dr in deal_requests:
        ticker = dr["ticker"]
        model = dr["model"]
        system_text = dr["system_prompt"]
        user_prompt = dr["user_prompt"]
        max_tokens = dr.get("max_tokens", 2800)

        system_blocks = _build_system_blocks(system_text, model)

        requests.append(
            Request(
                custom_id=f"risk-{ticker}",
                params=MessageCreateParamsNonStreaming(
                    model=model,
                    temperature=0,
                    max_tokens=max_tokens,
                    system=system_blocks,
                    messages=[{"role": "user", "content": user_prompt}],
                ),
            )
        )

    return requests


async def run_batch_assessment(
    client,
    deal_requests: list[dict],
) -> dict[str, dict]:
    """Submit deal assessments as a batch and poll for results.

    Args:
        client: Anthropic client instance.
        deal_requests: List of dicts with ticker, model, system_prompt, user_prompt.

    Returns:
        Dict mapping ticker to parsed response dict (with _meta).
        Failed tickers are included with _meta.error set.
    """
    if not deal_requests:
        return {}

    batch_requests = build_batch_requests(deal_requests)
    ticker_model_map = {f"risk-{dr['ticker']}": dr["model"] for dr in deal_requests}

    logger.info("Submitting batch of %d deal assessments", len(batch_requests))
    t0 = time.monotonic()

    try:
        message_batch = client.messages.batches.create(requests=batch_requests)
    except Exception as e:
        logger.error("Failed to create batch: %s", e)
        raise

    batch_id = message_batch.id
    logger.info("Batch %s created, polling for completion...", batch_id)

    # Poll for completion
    elapsed = 0
    while elapsed < BATCH_TIMEOUT:
        await asyncio.sleep(BATCH_POLL_INTERVAL)
        elapsed = time.monotonic() - t0

        try:
            message_batch = client.messages.batches.retrieve(batch_id)
        except Exception as e:
            logger.warning("Batch poll error: %s", e)
            continue

        counts = message_batch.request_counts
        logger.info(
            "Batch %s: %d succeeded, %d processing, %d errored, %d expired",
            batch_id, counts.succeeded, counts.processing,
            counts.errored, counts.expired,
        )

        if message_batch.processing_status == "ended":
            break
    else:
        logger.error("Batch %s timed out after %ds", batch_id, BATCH_TIMEOUT)

    total_elapsed_ms = int((time.monotonic() - t0) * 1000)

    # Process results
    results = {}
    try:
        for result in client.messages.batches.results(batch_id):
            custom_id = result.custom_id
            # Extract ticker from custom_id (format: "risk-TICKER")
            ticker = custom_id.replace("risk-", "", 1)
            model = ticker_model_map.get(custom_id, "unknown")

            if result.result.type == "succeeded":
                msg = result.result.message
                raw_text = msg.content[0].text if msg.content else ""

                # Strip markdown fences
                stripped = raw_text.strip()
                if stripped.startswith("```"):
                    stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
                    stripped = re.sub(r"\n?```\s*$", "", stripped)

                try:
                    parsed = json.loads(stripped)
                except json.JSONDecodeError:
                    logger.error("Malformed JSON in batch for %s: %s", ticker, raw_text[:500])
                    results[ticker] = {
                        "_meta": {"error": "invalid_json", "model": model},
                    }
                    continue

                # Extract cache token counts
                usage = msg.usage
                cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
                cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

                tokens_used = usage.input_tokens + usage.output_tokens
                # Batch pricing is 50% off — compute_cost gives standard rate,
                # so we halve it for batch
                cost = compute_cost(
                    model, usage.input_tokens, usage.output_tokens,
                    cache_creation, cache_read,
                ) * 0.5

                parsed["_meta"] = {
                    "model": model,
                    "tokens_used": tokens_used,
                    "processing_time_ms": total_elapsed_ms,
                    "cost_usd": cost,
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                    "cache_creation_tokens": cache_creation,
                    "cache_read_tokens": cache_read,
                    "batch_id": batch_id,
                }
                results[ticker] = parsed

            elif result.result.type == "errored":
                logger.error("Batch error for %s: %s", ticker, result.result.error)
                results[ticker] = {
                    "_meta": {"error": "batch_errored", "model": model},
                }

            elif result.result.type == "expired":
                logger.warning("Batch request expired for %s", ticker)
                results[ticker] = {
                    "_meta": {"error": "batch_expired", "model": model},
                }

    except Exception as e:
        logger.error("Failed to process batch results: %s", e)

    succeeded = sum(1 for r in results.values() if "_meta" in r and "error" not in r["_meta"])
    failed = len(results) - succeeded
    missing = len(deal_requests) - len(results)

    logger.info(
        "Batch %s complete: %d succeeded, %d failed, %d missing, %dms total",
        batch_id, succeeded, failed, missing, total_elapsed_ms,
    )

    return results
