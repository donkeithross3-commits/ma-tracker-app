"""
Fleet GPU monitoring API: receive checkins from GPU machines, serve status.

POST /fleet/checkin  — GPU machines push status (auth: X-Fleet-Key)
GET  /fleet/status   — Latest status for all machines (public, for dashboard)
GET  /fleet/alerts   — Current active alerts (public)
"""

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.fleet_monitor import process_checkin, load_latest_statuses, load_watchdog_state
from app.fleet_utilization import build_utilization_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fleet", tags=["fleet"])

FLEET_DATA_DIR = Path(os.environ.get("FLEET_DATA_DIR", "/home/don/apps/data/fleet"))


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

        machines.append({
            "machine": machine,
            "gpu": data.get("gpu", {}),
            "processes": data.get("processes", []),
            "heartbeats": data.get("heartbeats", {}),
            "queues": data.get("queues", {}),
            "datasets": data.get("datasets", []),
            "timestamp": data.get("timestamp"),
            "received_at": data.get("received_at"),
            "age_seconds": age_seconds,
        })

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
    """Daily/weekly GPU utilization attainment rollups for the dashboard."""
    statuses = load_latest_statuses(FLEET_DATA_DIR)
    report = build_utilization_report(
        fleet_data_dir=FLEET_DATA_DIR,
        latest_machines=sorted(statuses.keys()),
        daily_days=daily_days,
        weekly_weeks=weekly_weeks,
        timezone_name=tz,
        carry_max_seconds=carry_max_seconds,
    )
    return report
