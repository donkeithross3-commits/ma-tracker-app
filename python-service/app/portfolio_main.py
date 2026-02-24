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

    # Inject pool into portfolio_routes
    from .api.portfolio_routes import set_pool
    set_pool(_pool)

    logger.info("Portfolio service ready on port 8001")


@app.on_event("shutdown")
async def shutdown():
    global _pool
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


# Mount portfolio router
from .api.portfolio_routes import router as portfolio_router  # noqa: E402
app.include_router(portfolio_router)
