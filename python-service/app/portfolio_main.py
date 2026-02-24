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

    # Initialise scheduler
    from .scheduler.core import get_scheduler
    from .scheduler import core as scheduler_core
    from .scheduler.jobs import register_default_jobs

    scheduler_core.pool = _pool
    scheduler = get_scheduler()
    register_default_jobs(scheduler)
    scheduler.start()
    logger.info("APScheduler started with %d jobs", len(scheduler.get_jobs()))

    logger.info("Portfolio service ready on port 8001")


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
app.include_router(portfolio_router)
app.include_router(scheduler_router)
app.include_router(risk_router)
