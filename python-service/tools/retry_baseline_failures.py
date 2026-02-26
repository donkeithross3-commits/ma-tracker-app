"""Retry failed baseline results with assistant prefill to force JSON output.

Thin CLI wrapper around app.risk.baseline_retry.retry_failures().

Usage:
    python -m tools.retry_baseline_failures [run_id]
"""
import asyncio
import logging
import os
import sys

import asyncpg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    run_id_str = sys.argv[1] if len(sys.argv) > 1 else None

    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=3)
    api_key = os.environ["ANTHROPIC_API_KEY"]

    # Find run
    if not run_id_str:
        async with pool.acquire() as conn:
            run = await conn.fetchrow(
                "SELECT id FROM baseline_runs ORDER BY created_at DESC LIMIT 1"
            )
            if not run:
                logger.error("No baseline run found")
                return
            run_id_str = str(run["id"])

    from app.risk.baseline_retry import retry_failures
    result = await retry_failures(pool, api_key, run_id_str)

    await pool.close()
    logger.info("Result: %s", result)


if __name__ == "__main__":
    asyncio.run(main())
