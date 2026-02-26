"""Background task runner for risk assessments.

Ensures at most one assessment runs at a time, tracks status,
and marks DB runs as 'failed' if the task crashes.
"""

import asyncio
import logging
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

# Module-level state — at most one assessment in flight
_active_task: Optional[asyncio.Task] = None
_run_id: Optional[uuid.UUID] = None
_started_at: Optional[float] = None
_triggered_by: Optional[str] = None
_last_error: Optional[str] = None


def is_running() -> bool:
    """True if a background assessment is currently in flight."""
    return _active_task is not None and not _active_task.done()


def get_run_status() -> dict:
    """Return current runner state for the /risk/run-status endpoint."""
    if is_running():
        return {
            "running": True,
            "run_id": str(_run_id),
            "triggered_by": _triggered_by,
            "elapsed_seconds": round(time.monotonic() - _started_at, 1),
        }
    # Not running — report last result
    status = {"running": False}
    if _run_id is not None:
        status["run_id"] = str(_run_id)
        status["triggered_by"] = _triggered_by
    if _last_error is not None:
        status["last_error"] = _last_error
    return status


def launch(coro, run_id: uuid.UUID, triggered_by: str, pool) -> uuid.UUID:
    """Fire a coroutine as a background task. Returns immediately."""
    global _active_task, _run_id, _started_at, _triggered_by, _last_error

    if is_running():
        raise RuntimeError("Assessment already in progress")

    _run_id = run_id
    _started_at = time.monotonic()
    _triggered_by = triggered_by
    _last_error = None

    _active_task = asyncio.create_task(_run_and_cleanup(coro, run_id, pool))
    return run_id


async def _run_and_cleanup(coro, run_id: uuid.UUID, pool):
    """Wrapper: run the coroutine; on crash, mark DB run as 'failed'."""
    global _last_error
    try:
        await coro
        logger.info("Background risk run %s completed", run_id)
    except Exception as exc:
        _last_error = str(exc)
        logger.error("Background risk run %s crashed: %s", run_id, exc, exc_info=True)
        # Mark the DB run as failed so it never stays stuck in 'running'
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE risk_assessment_runs
                       SET status = 'failed',
                           finished_at = NOW(),
                           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER * 1000,
                           error = $2
                       WHERE id = $1 AND status = 'running'""",
                    run_id, str(exc),
                )
        except Exception as db_err:
            logger.error("Failed to mark run %s as failed in DB: %s", run_id, db_err)
