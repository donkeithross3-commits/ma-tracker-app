"""Unified API cost tracker — logs every AI call (API, CLI, and interactive).

Every call site in the system should call `log_api_call()` after making
an AI request. Budget.py reads from the `api_call_log` table to compute
the API key balance. The session collector uses `ai_usage_sessions` for
subscription usage tracking.

Columns added in migration 059:
  auth_method: 'api_key' | 'cli_oauth' | 'interactive'
  machine:     'mac' | 'droplet' | 'gaming-pc' | 'garage-pc'
  session_id:  Claude Code session UUID
  account_id:  Subscription account (for CAAM multi-account)
  provider:    'anthropic' | 'openai' (future Codex support)
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
    # --- New telemetry columns (migration 059) ---
    auth_method: str = "api_key",
    machine: str | None = None,
    session_id: str | None = None,
    account_id: str = "primary",
    provider: str = "anthropic",
) -> None:
    """Log an AI call to the unified api_call_log table.

    Args:
        pool: asyncpg connection pool.
        source: Call site identifier (e.g. 'risk_engine', 'baseline',
                'filing_impact', 'research_refresher', 'deal_enricher').
        model: Model ID used (e.g. 'claude-opus-4-6', 'cli-opus').
        ticker: Deal ticker if applicable.
        input_tokens: Input tokens (uncached portion).
        output_tokens: Output tokens.
        cache_creation_tokens: Tokens written to cache.
        cache_read_tokens: Tokens read from cache.
        cost_usd: Pre-computed cost. If None, computed from model pricing.
        metadata: Optional dict of extra info (run_id, batch_id, etc.).
        auth_method: 'api_key', 'cli_oauth', or 'interactive'.
        machine: Machine identifier ('mac', 'droplet', etc.).
        session_id: Claude Code session UUID if applicable.
        account_id: Subscription account identifier (default 'primary').
        provider: AI provider ('anthropic' or 'openai').
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
                    cache_creation_tokens, cache_read_tokens, cost_usd, metadata,
                    auth_method, machine, session_id, account_id, provider)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
                           $10, $11, $12, $13, $14)""",
                source, model, ticker, input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens, cost_usd,
                __import__("json").dumps(metadata) if metadata else None,
                auth_method, machine, session_id, account_id, provider,
            )
    except Exception as e:
        # Non-fatal — never let logging break the pipeline
        logger.warning("Failed to log API call (non-fatal): %s", e)
