"""Unified API cost tracker — logs every Anthropic API call.

Every call site in the system should call `log_api_call()` after making
an Anthropic API request. Budget.py reads from the `api_call_log` table
to compute the balance.

This replaces the old approach where budget.py only read from
risk_assessment_runs.total_cost_usd (missing baseline, filing_impact,
research_refresher costs).
"""

import logging
from typing import Any

from .model_config import compute_cost

logger = logging.getLogger(__name__)


async def log_api_call(
    pool,
    *,
    source: str,
    model: str,
    ticker: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
    cost_usd: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Log an API call to the unified api_call_log table.

    Args:
        pool: asyncpg connection pool.
        source: Call site identifier (e.g. 'risk_engine', 'baseline',
                'filing_impact', 'research_refresher').
        model: Model ID used (e.g. 'claude-opus-4-6').
        ticker: Deal ticker if applicable.
        input_tokens: Input tokens (uncached portion).
        output_tokens: Output tokens.
        cache_creation_tokens: Tokens written to cache.
        cache_read_tokens: Tokens read from cache.
        cost_usd: Pre-computed cost. If None, computed from model pricing.
        metadata: Optional dict of extra info (run_id, batch_id, etc.).
    """
    if cost_usd is None:
        cost_usd = compute_cost(
            model, input_tokens, output_tokens,
            cache_creation_tokens, cache_read_tokens,
        )

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO api_call_log
                   (source, model, ticker, input_tokens, output_tokens,
                    cache_creation_tokens, cache_read_tokens, cost_usd, metadata)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)""",
                source, model, ticker, input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens, cost_usd,
                __import__("json").dumps(metadata) if metadata else None,
            )
    except Exception as e:
        # Non-fatal — never let logging break the pipeline
        logger.warning("Failed to log API call (non-fatal): %s", e)
