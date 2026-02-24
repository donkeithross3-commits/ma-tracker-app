"""API routes for scheduler management — list, trigger, pause, resume, monitor jobs."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import datetime
import json
import logging
import time
import traceback
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scheduler", tags=["scheduler"])

_pool = None


def set_pool(pool):
    """Set the connection pool (called during startup)."""
    global _pool
    _pool = pool


def _get_pool():
    if _pool is not None:
        return _pool
    # Fallback: import from scheduler core (set during startup)
    from ..scheduler.core import pool as core_pool
    if core_pool is None:
        raise HTTPException(status_code=503, detail="Database pool not available")
    return core_pool


def _job_to_dict(job) -> dict:
    """Serialise an APScheduler Job object."""
    trigger = str(job.trigger) if job.trigger else None
    next_run = job.next_run_time.isoformat() if job.next_run_time else None
    return {
        "id": job.id,
        "name": job.name,
        "next_run_time": next_run,
        "trigger": trigger,
        "paused": job.next_run_time is None,
    }


# ---------------------------------------------------------------------------
# GET /scheduler/jobs
# ---------------------------------------------------------------------------
@router.get("/jobs")
async def list_jobs():
    """List all registered jobs with their last run status."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    pool = _get_pool()
    jobs = scheduler.get_jobs()

    results = []
    async with pool.acquire() as conn:
        for job in jobs:
            info = _job_to_dict(job)

            # Fetch most recent run
            last_run = await conn.fetchrow(
                """
                SELECT status, started_at, finished_at, duration_ms
                FROM job_runs
                WHERE job_id = $1
                ORDER BY started_at DESC
                LIMIT 1
                """,
                job.id,
            )
            if last_run:
                info["last_run"] = {
                    "status": last_run["status"],
                    "started_at": last_run["started_at"].isoformat() if last_run["started_at"] else None,
                    "finished_at": last_run["finished_at"].isoformat() if last_run["finished_at"] else None,
                    "duration_ms": last_run["duration_ms"],
                }
            else:
                info["last_run"] = None

            results.append(info)

    return {"jobs": results, "count": len(results)}


# ---------------------------------------------------------------------------
# GET /scheduler/jobs/{job_id}
# ---------------------------------------------------------------------------
@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get a specific job's details plus its recent run history."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    job = scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    info = _job_to_dict(job)
    pool = _get_pool()

    async with pool.acquire() as conn:
        runs = await conn.fetch(
            """
            SELECT id, status, started_at, finished_at, duration_ms,
                   result, error, triggered_by
            FROM job_runs
            WHERE job_id = $1
            ORDER BY started_at DESC
            LIMIT 20
            """,
            job_id,
        )

    info["recent_runs"] = [
        {
            "id": str(r["id"]),
            "status": r["status"],
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "finished_at": r["finished_at"].isoformat() if r["finished_at"] else None,
            "duration_ms": r["duration_ms"],
            "result": r["result"],
            "error": r["error"],
            "triggered_by": r["triggered_by"],
        }
        for r in runs
    ]

    return info


# ---------------------------------------------------------------------------
# POST /scheduler/jobs/{job_id}/run
# ---------------------------------------------------------------------------
@router.post("/jobs/{job_id}/run")
async def run_job_now(job_id: str):
    """Trigger a job immediately (out-of-schedule). Records with triggered_by='api'."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    pool = _get_pool()
    job = scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    # Resolve names from the wrapper metadata
    job_name = getattr(job.func, "_job_name", job.name)

    # Use the unwrapped function to avoid the run_job decorator recording
    # a duplicate row with triggered_by='scheduler'. We record our own row
    # with triggered_by='api'.
    raw_fn = getattr(job.func, "__wrapped__", job.func)

    run_id = uuid.uuid4()
    started_at = datetime.utcnow()
    t0 = time.monotonic()

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO job_runs (id, job_id, job_name, status, started_at, triggered_by)
                VALUES ($1, $2, $3, 'running', $4, 'api')
                """,
                run_id, job_id, job_name, started_at,
            )
    except Exception:
        logger.warning("Could not insert job_runs row for API trigger", exc_info=True)

    status = "success"
    result_data = None
    error_text = None
    try:
        result_data = await raw_fn()
    except Exception as exc:
        status = "failure"
        error_text = f"{exc}\n{traceback.format_exc()}"
        logger.error("API-triggered job %s failed: %s", job_id, exc, exc_info=True)

    duration_ms = int((time.monotonic() - t0) * 1000)
    finished_at = datetime.utcnow()

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE job_runs
                   SET status = $2, finished_at = $3, duration_ms = $4,
                       result = $5::jsonb, error = $6
                 WHERE id = $1
                """,
                run_id, status, finished_at, duration_ms,
                json.dumps(result_data, default=str) if result_data else None,
                error_text,
            )
    except Exception:
        logger.warning("Could not update job_runs row for API trigger", exc_info=True)

    return {
        "run_id": str(run_id),
        "job_id": job_id,
        "status": status,
        "duration_ms": duration_ms,
        "result": result_data,
        "error": error_text,
    }


# ---------------------------------------------------------------------------
# POST /scheduler/jobs/{job_id}/pause
# ---------------------------------------------------------------------------
@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    """Pause a scheduled job (it will not fire until resumed)."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    job = scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    scheduler.pause_job(job_id)
    return {"status": "paused", "job_id": job_id}


# ---------------------------------------------------------------------------
# POST /scheduler/jobs/{job_id}/resume
# ---------------------------------------------------------------------------
@router.post("/jobs/{job_id}/resume")
async def resume_job(job_id: str):
    """Resume a previously paused job."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    job = scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    scheduler.resume_job(job_id)
    updated = scheduler.get_job(job_id)
    next_run = updated.next_run_time.isoformat() if updated and updated.next_run_time else None
    return {"status": "resumed", "job_id": job_id, "next_run_time": next_run}


# ---------------------------------------------------------------------------
# GET /scheduler/runs
# ---------------------------------------------------------------------------
@router.get("/runs")
async def list_runs(
    job_id: Optional[str] = Query(None, description="Filter by job ID"),
    status: Optional[str] = Query(None, description="Filter by status (success, failure, running)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Recent job runs, paginated and filterable."""
    pool = _get_pool()

    clauses = []
    params = []
    idx = 1

    if job_id:
        clauses.append(f"job_id = ${idx}")
        params.append(job_id)
        idx += 1
    if status:
        clauses.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.extend([limit, offset])

    query = f"""
        SELECT id, job_id, job_name, status, started_at, finished_at,
               duration_ms, result, error, triggered_by
        FROM job_runs
        {where}
        ORDER BY started_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        count_query = f"SELECT COUNT(*) FROM job_runs {where}"
        total = await conn.fetchval(count_query, *params[:-2]) if params[:-2] else await conn.fetchval(count_query)

    return {
        "runs": [
            {
                "id": str(r["id"]),
                "job_id": r["job_id"],
                "job_name": r["job_name"],
                "status": r["status"],
                "started_at": r["started_at"].isoformat() if r["started_at"] else None,
                "finished_at": r["finished_at"].isoformat() if r["finished_at"] else None,
                "duration_ms": r["duration_ms"],
                "result": r["result"],
                "error": r["error"],
                "triggered_by": r["triggered_by"],
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /scheduler/health
# ---------------------------------------------------------------------------
@router.get("/health")
async def scheduler_health():
    """Scheduler health: running state, job count, recent failures, next upcoming job."""
    from ..scheduler.core import get_scheduler

    scheduler = get_scheduler()
    pool = _get_pool()
    jobs = scheduler.get_jobs()

    # Find next upcoming job
    next_job = None
    next_time = None
    for job in jobs:
        if job.next_run_time is not None:
            if next_time is None or job.next_run_time < next_time:
                next_time = job.next_run_time
                next_job = job.id

    # Count failures in last 24h
    async with pool.acquire() as conn:
        failures_24h = await conn.fetchval(
            """
            SELECT COUNT(*) FROM job_runs
            WHERE status = 'failure'
              AND started_at > NOW() - INTERVAL '24 hours'
            """
        )

    return {
        "running": scheduler.running,
        "job_count": len(jobs),
        "failures_last_24h": failures_24h or 0,
        "next_job": next_job,
        "next_run_time": next_time.isoformat() if next_time else None,
    }
