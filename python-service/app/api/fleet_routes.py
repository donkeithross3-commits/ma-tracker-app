"""
Fleet GPU monitoring API: receive checkins from GPU machines, serve status.

POST /fleet/checkin  — GPU machines push status (auth: X-Fleet-Key)
GET  /fleet/status   — Latest status for all machines (public, for dashboard)
GET  /fleet/alerts   — Current active alerts (public)
"""

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.fleet_monitor import process_checkin, load_latest_statuses, load_watchdog_state
from app.fleet_utilization import build_cpu_utilization_report, build_utilization_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fleet", tags=["fleet"])

FLEET_DATA_DIR = Path(os.environ.get("FLEET_DATA_DIR", "/home/don/apps/data/fleet"))

# ---------------------------------------------------------------------------
# In-memory cache for expensive utilization endpoints (telemetry.jsonl is huge)
# ---------------------------------------------------------------------------
UTILIZATION_CACHE_TTL = 300  # 5 minutes

_utilization_cache: dict[str, Any] = {"data": None, "ts": 0.0, "key": ""}
_cpu_utilization_cache: dict[str, Any] = {"data": None, "ts": 0.0, "key": ""}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class GPUInfo(BaseModel):
    util: Optional[int] = None
    temp: Optional[int] = None
    mem_used_mb: Optional[int] = None
    mem_total_mb: Optional[int] = None
    clock_mhz: Optional[int] = None
    power_w: Optional[float] = None  # GPU power draw in watts (reliable on WDDM)


class ProcessInfo(BaseModel):
    pid: int
    mem_mb: Optional[int] = None


class FleetCheckinPayload(BaseModel):
    machine: str = Field(..., min_length=1, max_length=64)
    timestamp: str
    gpu: dict[str, Any] = Field(default_factory=dict)
    processes: list[dict[str, Any]] = Field(default_factory=list)
    heartbeats: dict[str, dict[str, Any]] = Field(default_factory=dict)
    queues: dict[str, dict[str, Any]] = Field(default_factory=dict)
    datasets: list[str] = Field(default_factory=list)
    orchestrator: dict[str, Any] | None = None  # CPU orchestrator status (Mac only)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _validate_fleet_key(x_fleet_key: str | None) -> None:
    """Validate the X-Fleet-Key header against the configured API key."""
    expected = os.environ.get("FLEET_API_KEY", "")
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="FLEET_API_KEY not configured on server",
        )
    if not x_fleet_key or x_fleet_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Fleet-Key")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/checkin")
async def fleet_checkin(
    payload: FleetCheckinPayload,
    x_fleet_key: str | None = Header(None),
) -> dict[str, Any]:
    """Receive a GPU machine's status checkin.

    Auth: X-Fleet-Key header required.
    Stores status, runs detection checks, dedup, and fires Pushover alerts.
    Returns any new alerts.
    """
    _validate_fleet_key(x_fleet_key)

    logger.info("Fleet checkin from %s", payload.machine)

    new_alerts = process_checkin(FLEET_DATA_DIR, payload.model_dump())

    return {"ok": True, "alerts": new_alerts}


@router.get("/status")
async def fleet_status() -> dict[str, Any]:
    """Latest status for all machines (public, for dashboard/CLI)."""
    statuses = load_latest_statuses(FLEET_DATA_DIR)

    # Enrich with age calculation
    now = datetime.now(timezone.utc)
    machines: list[dict[str, Any]] = []

    for machine, data in sorted(statuses.items()):
        ts_raw = data.get("received_at") or data.get("timestamp")
        age_seconds: float | None = None
        if ts_raw:
            try:
                last_seen = datetime.fromisoformat(ts_raw)
                age_seconds = (now - last_seen).total_seconds()
            except (ValueError, TypeError):
                pass

        # Mark checkins as stale if too old (prevents phantom "busy" state)
        STALE_THRESHOLD_SECONDS = 300  # 5 minutes — checkins should come every 60s
        is_stale = age_seconds is not None and age_seconds > STALE_THRESHOLD_SECONDS

        entry: dict[str, Any] = {
            "machine": machine,
            "gpu": data.get("gpu", {}),
            "processes": data.get("processes", []),
            "heartbeats": data.get("heartbeats", {}),
            "queues": data.get("queues", {}),
            "datasets": data.get("datasets", []),
            "timestamp": data.get("timestamp"),
            "received_at": data.get("received_at"),
            "age_seconds": age_seconds,
            "stale": is_stale,
        }
        # Include orchestrator status if present — but mark state as
        # stale/dead if the checkin itself is stale.  This prevents
        # phantom "running" jobs from appearing on the dashboard when
        # a machine has stopped reporting.
        if data.get("orchestrator"):
            orch = dict(data["orchestrator"])
            if is_stale and orch.get("state") not in (None, "idle", "offline"):
                orch["_live_state"] = orch.get("state")  # preserve original
                orch["state"] = "stale"
                # Don't clear current_task — show it with stale indicator
                # so the user can see WHAT was running when it went silent
            entry["orchestrator"] = orch
        machines.append(entry)

    return {"machines": machines}


@router.get("/alerts")
async def fleet_alerts() -> dict[str, Any]:
    """Current active alert keys and their last-fired timestamps."""
    state_path = FLEET_DATA_DIR / "watchdog_state.json"
    state = load_watchdog_state(state_path)
    alert_entries = state.get("alerts", {})

    return {
        "active_count": len(alert_entries),
        "alerts": alert_entries,
    }


@router.get("/utilization")
async def fleet_utilization(
    daily_days: int = Query(14, ge=1, le=60),
    weekly_weeks: int = Query(8, ge=1, le=26),
    tz: str = Query("America/New_York"),
    carry_max_seconds: int = Query(600, ge=0, le=3600),
) -> dict[str, Any]:
    """Daily/weekly GPU utilization attainment rollups for the dashboard.

    Results are cached in-memory for 5 minutes — telemetry.jsonl can be
    hundreds of MB and parsing it on every request causes 524 timeouts.
    """
    cache_key = f"{daily_days}:{weekly_weeks}:{tz}:{carry_max_seconds}"
    now = time.monotonic()
    if (
        _utilization_cache["data"] is not None
        and _utilization_cache["key"] == cache_key
        and (now - _utilization_cache["ts"]) < UTILIZATION_CACHE_TTL
    ):
        return _utilization_cache["data"]

    statuses = load_latest_statuses(FLEET_DATA_DIR)
    # Filter out machines with no GPU data (e.g. Mac CPU orchestrator node)
    gpu_machines = [
        m for m, data in statuses.items()
        if data.get("gpu") and any(v is not None for v in data["gpu"].values())
    ]
    t0 = time.monotonic()
    report = build_utilization_report(
        fleet_data_dir=FLEET_DATA_DIR,
        latest_machines=sorted(gpu_machines),
        daily_days=daily_days,
        weekly_weeks=weekly_weeks,
        timezone_name=tz,
        carry_max_seconds=carry_max_seconds,
    )
    elapsed = time.monotonic() - t0
    logger.info("[perf] fleet utilization report built in %.2fs", elapsed)

    _utilization_cache["data"] = report
    _utilization_cache["ts"] = time.monotonic()
    _utilization_cache["key"] = cache_key
    return report


@router.get("/cpu-utilization")
async def fleet_cpu_utilization(
    daily_days: int = Query(7, ge=1, le=30),
    tz: str = Query("America/New_York"),
    carry_max_seconds: int = Query(600, ge=0, le=3600),
) -> dict[str, Any]:
    """CPU utilization rollups for Mac research workers."""
    cache_key = f"{daily_days}:{tz}:{carry_max_seconds}"
    now = time.monotonic()
    if (
        _cpu_utilization_cache["data"] is not None
        and _cpu_utilization_cache["key"] == cache_key
        and (now - _cpu_utilization_cache["ts"]) < UTILIZATION_CACHE_TTL
    ):
        return _cpu_utilization_cache["data"]

    t0 = time.monotonic()
    report = build_cpu_utilization_report(
        fleet_data_dir=FLEET_DATA_DIR,
        daily_days=daily_days,
        timezone_name=tz,
        carry_max_seconds=carry_max_seconds,
    )
    elapsed = time.monotonic() - t0
    logger.info("[perf] fleet cpu-utilization report built in %.2fs", elapsed)

    _cpu_utilization_cache["data"] = report
    _cpu_utilization_cache["ts"] = time.monotonic()
    _cpu_utilization_cache["key"] = cache_key
    return report
