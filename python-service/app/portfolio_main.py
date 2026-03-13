"""
Standalone FastAPI service for Event Driven Portfolio.
Runs independently from the trading/IB backend on port 8001.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
import os
import logging
from pathlib import Path

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Event Driven Portfolio API",
    description="Standalone portfolio service — isolated from trading/IB backend",
    version="1.0.0",
)

# CORS — same pattern as main.py
_cors_env = os.environ.get("CORS_ALLOWED_ORIGINS", "https://dr3-dashboard.com,http://localhost:3000")
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global connection pool
_pool: asyncpg.Pool | None = None


def _fix_database_url(url: str) -> str:
    """Convert Prisma-style sslmode param to asyncpg format."""
    if "?sslmode=" in url:
        return url.replace("?sslmode=require", "?ssl=require")
    return url


@app.on_event("startup")
async def startup():
    global _pool
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.error("DATABASE_URL not set — portfolio service cannot start")
        raise RuntimeError("DATABASE_URL is required")
    db_url = _fix_database_url(db_url)
    _pool = await asyncpg.create_pool(db_url, min_size=2, max_size=10)
    logger.info("Portfolio DB pool created (min: 2, max: 10)")

    # Inject pool into route modules
    from .api.portfolio_routes import set_pool
    from .api.scheduler_routes import set_pool as set_scheduler_pool
    from .api.risk_routes import set_pool as set_risk_pool
    set_pool(_pool)
    set_scheduler_pool(_pool)
    set_risk_pool(_pool)

    # Mark any stale 'running' risk assessment runs as 'interrupted'
    # and recover costs from orphaned Anthropic batches
    try:
        async with _pool.acquire() as conn:
            # Find runs with batch_ids that were interrupted
            stale_runs = await conn.fetch(
                "SELECT id, batch_id FROM risk_assessment_runs WHERE status = 'running'"
            )
            if stale_runs:
                orphaned_batch_ids = [r["batch_id"] for r in stale_runs if r["batch_id"]]
                updated = await conn.execute(
                    "UPDATE risk_assessment_runs SET status = 'interrupted' WHERE status = 'running'"
                )
                logger.warning("Marked stale risk runs as interrupted: %s", updated)

                # Recover costs from orphaned batches
                if orphaned_batch_ids:
                    try:
                        await _recover_orphaned_batches(_pool, orphaned_batch_ids)
                    except Exception as e:
                        logger.warning("Orphaned batch recovery failed (non-fatal): %s", e)
    except Exception:
        logger.warning("Could not clean up stale risk runs", exc_info=True)

    # Initialise scheduler (can be disabled with ENABLE_SCHEDULER=false to prevent
    # duplicate job execution when multiple portfolio service instances are running)
    if os.environ.get("ENABLE_SCHEDULER", "true").lower() == "true":
        from .scheduler.core import get_scheduler
        from .scheduler import core as scheduler_core
        from .scheduler.jobs import register_default_jobs

        scheduler_core.pool = _pool
        scheduler = get_scheduler()
        register_default_jobs(scheduler)
        scheduler.start()
        logger.info("APScheduler started with %d jobs", len(scheduler.get_jobs()))
    else:
        logger.info("Scheduler disabled (ENABLE_SCHEDULER != true)")

    logger.info("Portfolio service ready on port 8001")


async def _recover_orphaned_batches(pool, batch_ids: list[str]):
    """Recover costs from Anthropic batches that completed while we were down.

    When the container restarts mid-batch, the batch keeps running server-side.
    We get charged but lose the results. This function checks each orphaned
    batch_id, and if it completed, backfills the costs into api_call_log.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return

    try:
        from anthropic import Anthropic
        from .risk.model_config import compute_cost
        from .risk.api_cost_tracker import log_api_call
    except ImportError:
        logger.warning("Cannot import Anthropic SDK for batch recovery")
        return

    client = Anthropic(api_key=api_key)

    for batch_id in batch_ids:
        try:
            batch = client.messages.batches.retrieve(batch_id)
            if batch.processing_status != "ended":
                logger.info("Orphaned batch %s still processing, skipping", batch_id)
                continue

            # Check if we already backfilled this batch
            async with pool.acquire() as conn:
                existing = await conn.fetchval(
                    "SELECT count(*) FROM api_call_log WHERE metadata->>'batch_id' = $1",
                    batch_id,
                )
                if existing > 0:
                    logger.info("Orphaned batch %s already backfilled (%d rows), skipping", batch_id, existing)
                    continue

            # Backfill costs from completed batch results
            recovered = 0
            total_cost = 0.0
            for entry in client.messages.batches.results(batch_id):
                if entry.result.type == "succeeded":
                    msg = entry.result.message
                    usage = msg.usage
                    cache_create = getattr(usage, "cache_creation_input_tokens", 0) or 0
                    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
                    cost = compute_cost(
                        msg.model, usage.input_tokens, usage.output_tokens,
                        cache_create, cache_read,
                    ) * 0.5  # Batch discount

                    ticker = entry.custom_id.replace("risk-", "", 1)
                    await log_api_call(
                        pool, source="risk_engine", model=msg.model, ticker=ticker,
                        input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
                        cache_creation_tokens=cache_create, cache_read_tokens=cache_read,
                        cost_usd=cost,
                        metadata={"batch_id": batch_id, "recovered_orphan": True},
                    )
                    recovered += 1
                    total_cost += cost

            logger.info(
                "Recovered orphaned batch %s: %d calls, $%.4f total",
                batch_id, recovered, total_cost,
            )

        except Exception as e:
            logger.warning("Failed to recover batch %s: %s", batch_id, e)


@app.on_event("shutdown")
async def shutdown():
    global _pool

    # Shut down scheduler before closing the pool
    from .scheduler.core import get_scheduler
    from .scheduler import core as scheduler_core
    try:
        scheduler = get_scheduler()
        if scheduler.running:
            scheduler.shutdown(wait=False)
            logger.info("APScheduler shut down")
    except Exception:
        logger.warning("Error shutting down scheduler", exc_info=True)
    scheduler_core.pool = None

    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Portfolio DB pool closed")


@app.get("/")
async def root():
    return {"service": "Event Driven Portfolio API", "version": "1.0.0", "status": "running"}


@app.get("/health")
async def health():
    if _pool is None:
        return {"status": "unhealthy", "reason": "no db pool"}
    try:
        async with _pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "healthy"}
    except Exception as e:
        return {"status": "unhealthy", "reason": str(e)}


# Mount routers
from .api.portfolio_routes import router as portfolio_router  # noqa: E402
from .api.scheduler_routes import router as scheduler_router  # noqa: E402
from .api.risk_routes import router as risk_router  # noqa: E402
from .api.cos_routes import router as cos_router  # noqa: E402
app.include_router(portfolio_router)
app.include_router(scheduler_router)
app.include_router(risk_router)
app.include_router(cos_router)
