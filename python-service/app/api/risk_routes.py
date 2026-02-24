"""API routes for risk assessment data"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import date, datetime
import logging
import json
import os
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risk", tags=["risk"])

_pool = None


def set_pool(pool):
    """Set the connection pool (called by portfolio_main.py for standalone mode)."""
    global _pool
    _pool = pool


def _get_pool():
    """Get the database connection pool."""
    if _pool is not None:
        return _pool
    raise HTTPException(status_code=503, detail="Database pool not available")


def _row_to_dict(row) -> dict:
    """Convert an asyncpg Record to a JSON-safe dict."""
    if row is None:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, uuid.UUID):
            d[k] = str(v)
        elif isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        elif hasattr(v, 'as_tuple'):  # Decimal
            d[k] = float(v)
    return d


# ---------------------------------------------------------------------------
# GET /risk/latest
# ---------------------------------------------------------------------------
@router.get("/latest")
async def get_latest_assessments():
    """Returns latest assessment for all deals from the most recent run."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM deal_risk_assessments
                WHERE assessment_date = (SELECT MAX(assessment_date) FROM deal_risk_assessments)
                ORDER BY overall_risk_score DESC NULLS LAST"""
            )
            return [_row_to_dict(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch latest assessments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch latest assessments: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/deal/{ticker}
# ---------------------------------------------------------------------------
@router.get("/deal/{ticker}")
async def get_deal_risk_history(ticker: str):
    """Returns full risk history for one deal (last 30 days)."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM deal_risk_assessments
                WHERE ticker = $1 AND assessment_date >= CURRENT_DATE - INTERVAL '30 days'
                ORDER BY assessment_date DESC""",
                ticker
            )
            if not rows:
                raise HTTPException(status_code=404, detail=f"No risk assessments found for {ticker}")
            return [_row_to_dict(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk history for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk history: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/deal/{ticker}/latest
# ---------------------------------------------------------------------------
@router.get("/deal/{ticker}/latest")
async def get_deal_latest_risk(ticker: str):
    """Returns latest assessment for one deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT * FROM deal_risk_assessments
                WHERE ticker = $1 ORDER BY assessment_date DESC LIMIT 1""",
                ticker
            )
            if not row:
                raise HTTPException(status_code=404, detail=f"No risk assessment found for {ticker}")
            return _row_to_dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch latest risk for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch latest risk: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/runs
# ---------------------------------------------------------------------------
@router.get("/runs")
async def get_risk_runs():
    """List of all morning runs with metadata (last 30 days)."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM risk_assessment_runs ORDER BY run_date DESC LIMIT 30"
            )
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk runs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk runs: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/runs/{run_id}
# ---------------------------------------------------------------------------
@router.get("/runs/{run_id}")
async def get_risk_run(run_id: str):
    """Single run with all its assessments."""
    pool = _get_pool()
    try:
        run_uuid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id format")

    try:
        async with pool.acquire() as conn:
            run = await conn.fetchrow(
                "SELECT * FROM risk_assessment_runs WHERE id = $1",
                run_uuid
            )
            if not run:
                raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

            assessments = await conn.fetch(
                "SELECT * FROM deal_risk_assessments WHERE run_id = $1 ORDER BY overall_risk_score DESC NULLS LAST",
                run_uuid
            )
            return {
                "run": _row_to_dict(run),
                "assessments": [_row_to_dict(a) for a in assessments],
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk run: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/changes
# ---------------------------------------------------------------------------
@router.get("/changes")
async def get_risk_changes(
    days: int = Query(7, ge=1, le=90, description="Number of days to look back"),
    direction: Optional[str] = Query(None, description="Filter by direction: worsened, improved, or all"),
    ticker: Optional[str] = Query(None, description="Filter by ticker"),
):
    """Recent risk changes (filterable by direction and ticker)."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            query = """SELECT * FROM risk_factor_changes
                WHERE change_date >= CURRENT_DATE - INTERVAL '1 day' * $1"""
            params = [days]
            idx = 2

            if direction and direction in ("worsened", "improved"):
                query += f" AND direction = ${idx}"
                params.append(direction)
                idx += 1

            if ticker:
                query += f" AND ticker = ${idx}"
                params.append(ticker.upper())
                idx += 1

            query += " ORDER BY change_date DESC, magnitude DESC"

            rows = await conn.fetch(query, *params)
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk changes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk changes: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/changes/{ticker}
# ---------------------------------------------------------------------------
@router.get("/changes/{ticker}")
async def get_deal_risk_changes(ticker: str):
    """Changes for one deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM risk_factor_changes WHERE ticker = $1 ORDER BY change_date DESC LIMIT 100",
                ticker
            )
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk changes for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk changes: {str(e)}")


# ---------------------------------------------------------------------------
# POST /risk/assess
# ---------------------------------------------------------------------------
@router.post("/assess")
async def trigger_assessment(ticker: Optional[str] = Query(None)):
    """Trigger ad-hoc risk assessment. If ticker is omitted, assess all deals."""
    pool = _get_pool()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    try:
        from app.risk.engine import RiskAssessmentEngine
        engine = RiskAssessmentEngine(pool, api_key)

        if ticker:
            ticker = ticker.upper()
            context = await engine.collect_deal_context(ticker)
            result = await engine.assess_single_deal(context)
            # Store as a mini-run
            async with pool.acquire() as conn:
                run_id = uuid.uuid4()
                await conn.execute(
                    """INSERT INTO risk_assessment_runs (id, run_date, assessed_deals, flagged_deals, changed_deals)
                    VALUES ($1, CURRENT_DATE, 1, 0, 0)""",
                    run_id
                )
                if isinstance(result, dict) and "assessment" in result:
                    assessment = result["assessment"]
                    await conn.execute(
                        """INSERT INTO deal_risk_assessments
                        (id, run_id, ticker, assessment_date, overall_risk_score, risk_factors, summary, raw_response)
                        VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7)""",
                        uuid.uuid4(), run_id, ticker,
                        assessment.get("overall_risk_score"),
                        json.dumps(assessment.get("risk_factors", {})),
                        assessment.get("summary"),
                        json.dumps(assessment)
                    )
            return result
        else:
            result = await engine.run_morning_assessment()
            return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk assessment failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Risk assessment failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/summary
# ---------------------------------------------------------------------------
@router.get("/summary")
async def get_risk_summary():
    """Latest morning briefing text."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT summary, run_date, assessed_deals, flagged_deals, changed_deals
                FROM risk_assessment_runs
                WHERE summary IS NOT NULL
                ORDER BY run_date DESC LIMIT 1"""
            )
            if not row:
                raise HTTPException(status_code=404, detail="No risk summary available")
            return _row_to_dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk summary: {str(e)}")
