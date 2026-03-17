"""
Research Database API Routes

Endpoints for managing the historical M&A research database:
  - View research deals and pipeline status
  - Trigger universe construction
  - View data quality metrics
  - Manage extraction pipeline

Mounted on portfolio_main.py (port 8001).
"""

import asyncio
import logging
import os
from typing import Optional

import asyncpg
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from ..research.universe import db
from ..research.universe.pipeline import UniverseConstructionPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research", tags=["research"])

# Track running pipelines to prevent concurrent runs
_running_pipeline: Optional[asyncio.Task] = None


async def _get_conn() -> asyncpg.Connection:
    """Get a database connection."""
    return await asyncpg.connect(os.environ["DATABASE_URL"])


# ============================================================================
# Deal browsing
# ============================================================================

@router.get("/deals")
async def list_deals(
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    outcome: Optional[str] = None,
    year: Optional[int] = None,
):
    """List research deals with optional filtering."""
    conn = await _get_conn()
    try:
        deals = await db.list_deals(conn, limit=limit, offset=offset, outcome=outcome, year=year)
        total = await db.get_deal_count(conn)
        return {
            "deals": deals,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        await conn.close()


@router.get("/deals/summary")
async def deals_summary():
    """Get aggregate statistics for the research database."""
    conn = await _get_conn()
    try:
        summary = await db.get_deals_summary(conn)

        # Convert any non-serializable types
        result = {}
        for k, v in summary.items():
            if hasattr(v, 'isoformat'):
                result[k] = v.isoformat()
            elif isinstance(v, (int, float, str, bool, type(None))):
                result[k] = v
            else:
                result[k] = str(v)

        return result
    finally:
        await conn.close()


@router.get("/deals/{deal_key}")
async def get_deal(deal_key: str):
    """Get full details for a specific research deal."""
    conn = await _get_conn()
    try:
        deal = await db.get_deal_by_key(conn, deal_key)
        if not deal:
            raise HTTPException(status_code=404, detail=f"Deal {deal_key} not found")

        # Also fetch filings and events
        deal_id = deal["deal_id"]
        filings = await db.get_filings_for_deal(conn, deal_id)

        events = await conn.fetch(
            """
            SELECT * FROM research_deal_events
            WHERE deal_id = $1
            ORDER BY event_date, event_sequence
            """,
            deal_id,
        )

        # Serialize
        for key in list(deal.keys()):
            if hasattr(deal[key], 'isoformat'):
                deal[key] = deal[key].isoformat()
            elif isinstance(deal[key], (bytes,)):
                deal[key] = deal[key].hex()

        serialized_filings = []
        for f in filings:
            sf = {}
            for k, v in f.items():
                if hasattr(v, 'isoformat'):
                    sf[k] = v.isoformat()
                else:
                    sf[k] = str(v) if not isinstance(v, (int, float, str, bool, type(None), list)) else v
            serialized_filings.append(sf)

        serialized_events = []
        for e in events:
            se = {}
            for k, v in dict(e).items():
                if hasattr(v, 'isoformat'):
                    se[k] = v.isoformat()
                else:
                    se[k] = str(v) if not isinstance(v, (int, float, str, bool, type(None), list, dict)) else v
            serialized_events.append(se)

        return {
            "deal": deal,
            "filings": serialized_filings,
            "events": serialized_events,
        }
    finally:
        await conn.close()


# ============================================================================
# Pipeline management
# ============================================================================

@router.get("/pipeline/status")
async def pipeline_status():
    """Get the status of the most recent pipeline run."""
    global _running_pipeline

    conn = await _get_conn()
    try:
        # Get most recent run
        row = await conn.fetchrow("""
            SELECT * FROM research_pipeline_runs
            ORDER BY started_at DESC
            LIMIT 1
        """)

        is_running = _running_pipeline is not None and not _running_pipeline.done()

        if row:
            result = dict(row)
            for k in list(result.keys()):
                if hasattr(result[k], 'isoformat'):
                    result[k] = result[k].isoformat()
                elif isinstance(result[k], bytes):
                    result[k] = result[k].hex()
                elif not isinstance(result[k], (int, float, str, bool, type(None), list, dict)):
                    result[k] = str(result[k])
            result["is_running"] = is_running
            return result

        return {"status": "no_runs", "is_running": is_running}
    finally:
        await conn.close()


@router.post("/pipeline/universe")
async def trigger_universe_construction(
    background_tasks: BackgroundTasks,
    start_year: int = Query(2016, ge=2000, le=2030),
    end_year: int = Query(2026, ge=2000, le=2030),
    skip_efts: bool = Query(False),
    skip_metadata: bool = Query(False),
    dry_run: bool = Query(False),
):
    """
    Trigger universe construction pipeline.

    This is a long-running operation (~30-60 min for full 2016-2026 range).
    Runs in the background; check /pipeline/status for progress.
    """
    global _running_pipeline

    if _running_pipeline is not None and not _running_pipeline.done():
        raise HTTPException(
            status_code=409,
            detail="A pipeline is already running. Check /pipeline/status.",
        )

    async def _run():
        global _running_pipeline
        try:
            pipeline = UniverseConstructionPipeline(
                start_year=start_year,
                end_year=end_year,
                skip_efts=skip_efts,
                skip_metadata=skip_metadata,
                dry_run=dry_run,
            )
            result = await pipeline.run()
            logger.info(f"Universe construction completed: {result}")
        except Exception as e:
            logger.error(f"Universe construction failed: {e}", exc_info=True)
        finally:
            _running_pipeline = None

    _running_pipeline = asyncio.create_task(_run())

    return {
        "status": "started",
        "config": {
            "start_year": start_year,
            "end_year": end_year,
            "skip_efts": skip_efts,
            "skip_metadata": skip_metadata,
            "dry_run": dry_run,
        },
        "message": "Universe construction started. Check /research/pipeline/status for progress.",
    }


@router.get("/pipeline/runs")
async def list_pipeline_runs(limit: int = Query(10, le=50)):
    """List recent pipeline runs."""
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            """
            SELECT run_id, pipeline_name, phase, status,
                   started_at, completed_at,
                   total_items, processed_items, failed_items,
                   deals_created, deals_updated, filings_linked,
                   last_error
            FROM research_pipeline_runs
            ORDER BY started_at DESC
            LIMIT $1
            """,
            limit,
        )
        results = []
        for row in rows:
            r = dict(row)
            for k in list(r.keys()):
                if hasattr(r[k], 'isoformat'):
                    r[k] = r[k].isoformat()
                elif not isinstance(r[k], (int, float, str, bool, type(None))):
                    r[k] = str(r[k])
            results.append(r)
        return {"runs": results}
    finally:
        await conn.close()


# ============================================================================
# Data quality
# ============================================================================

@router.get("/qa/coverage")
async def qa_coverage():
    """Data quality coverage report."""
    conn = await _get_conn()
    try:
        # Deals with no filings
        no_filings = await conn.fetchval("""
            SELECT COUNT(*) FROM research_deals
            WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_filings)
        """)

        # Deals with no events
        no_events = await conn.fetchval("""
            SELECT COUNT(*) FROM research_deals
            WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_events)
        """)

        # Clause extraction status
        clause_status = await conn.fetch("""
            SELECT clause_extraction_status, COUNT(*) as count
            FROM research_deals
            GROUP BY clause_extraction_status
        """)

        # Market data status
        market_status = await conn.fetch("""
            SELECT market_data_status, COUNT(*) as count
            FROM research_deals
            GROUP BY market_data_status
        """)

        # Deals by year
        by_year = await conn.fetch("""
            SELECT EXTRACT(YEAR FROM announced_date)::int as year, COUNT(*) as count
            FROM research_deals
            GROUP BY year
            ORDER BY year
        """)

        # Deals by outcome
        by_outcome = await conn.fetch("""
            SELECT outcome, COUNT(*) as count
            FROM research_deals
            GROUP BY outcome
            ORDER BY count DESC
        """)

        return {
            "deals_without_filings": no_filings,
            "deals_without_events": no_events,
            "clause_extraction_status": {r["clause_extraction_status"]: r["count"] for r in clause_status},
            "market_data_status": {r["market_data_status"]: r["count"] for r in market_status},
            "deals_by_year": {r["year"]: r["count"] for r in by_year},
            "deals_by_outcome": {r["outcome"]: r["count"] for r in by_outcome},
        }
    finally:
        await conn.close()
