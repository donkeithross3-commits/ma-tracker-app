"""Fleet monitoring: detection logic, dedup, alerting, and silence watchdog.

Ported from ``py_proj/big_move_convexity/scripts/fleet_watchdog.py`` with one
key simplification: no SSH calls. All data arrives in the POST checkin payload.

Also adds a silence detection background loop — if a machine fails to POST
for >10 minutes, fire an "unreachable" alert via Pushover.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEDUP_WINDOW = timedelta(hours=2)
SILENCE_THRESHOLD = timedelta(minutes=10)


# ---------------------------------------------------------------------------
# Alert model
# ---------------------------------------------------------------------------


@dataclass
class Alert:
    """A single fleet alert."""

    machine: str
    level: str  # "warning" or "critical"
    category: str  # heartbeat_stale, gpu_idle, queue_exhausted, dataset_missing, unreachable
    message: str
    key: str  # dedup key: f"{machine}:{category}:{detail}"


# ---------------------------------------------------------------------------
# Detection functions (ported from fleet_watchdog.py)
# ---------------------------------------------------------------------------


def check_heartbeat_stale(machine: str, heartbeats: dict[str, dict]) -> list[Alert]:
    """Flag heartbeats that claim 'running' but whose timestamp is >5 min old."""
    alerts: list[Alert] = []
    now = datetime.now(timezone.utc)

    for stem, hb in heartbeats.items():
        state = hb.get("state", "")
        ts_raw = hb.get("timestamp", "")
        if state != "running" or not ts_raw:
            continue

        try:
            ts = datetime.fromisoformat(ts_raw)
        except (ValueError, TypeError):
            continue

        age = now - ts
        if age > timedelta(minutes=5):
            age_min = age.total_seconds() / 60
            alerts.append(Alert(
                machine=machine,
                level="critical",
                category="heartbeat_stale",
                message=(
                    f"heartbeat {stem} claims 'running' but last update "
                    f"was {age_min:.0f}m ago (job: {hb.get('current_job', '?')})"
                ),
                key=f"{machine}:heartbeat_stale:{stem}",
            ))

    return alerts


GPU_POWER_IDLE_WATTS = 50  # Below this = truly idle (active training is 100-350W)


def check_gpu_idle(
    machine: str,
    gpu_info: dict[str, Any],
    heartbeats: dict[str, dict],
    queues: dict[str, dict],
) -> list[Alert]:
    """Flag GPU sitting idle while pending jobs exist.

    On WDDM drivers, nvidia-smi reports utilization.gpu as 0% even during
    active compute. Power draw (watts) is the reliable activity signal:
    idle ~20-30W, active training 100-350W. If util is 0 but power > 50W,
    the GPU is working — not idle.
    """
    alerts: list[Alert] = []

    util = gpu_info.get("util")
    if util is None:
        return alerts

    try:
        util_int = int(util)
    except (ValueError, TypeError):
        return alerts

    if util_int >= 5:
        return alerts

    # WDDM workaround: check power draw before declaring idle
    power_w = gpu_info.get("power_w")
    if power_w is not None:
        try:
            if float(power_w) >= GPU_POWER_IDLE_WATTS:
                return alerts  # GPU is active despite 0% util (WDDM bug)
        except (ValueError, TypeError):
            pass

    total_pending = 0
    for stem, qs in queues.items():
        for job in qs.get("jobs", []):
            if job.get("status") == "pending":
                total_pending += 1

    if total_pending > 0:
        alerts.append(Alert(
            machine=machine,
            level="warning",
            category="gpu_idle",
            message=f"GPU util is {util_int}% but {total_pending} job(s) are pending",
            key=f"{machine}:gpu_idle",
        ))

    return alerts


def check_queue_exhausted(
    machine: str,
    queues: dict[str, dict],
    heartbeats: dict[str, dict],
) -> list[Alert]:
    """Flag queues that have finished all work (0 pending, 0 running)."""
    alerts: list[Alert] = []

    for stem, qs in queues.items():
        jobs = qs.get("jobs", [])
        if not jobs:
            continue

        n_pending = sum(1 for j in jobs if j.get("status") == "pending")
        n_running = sum(1 for j in jobs if j.get("status") == "running")
        n_completed = sum(1 for j in jobs if j.get("status") == "completed")
        n_failed = sum(1 for j in jobs if j.get("status") in ("failed", "timeout"))

        if n_pending > 0 or n_running > 0:
            continue
        if n_completed == 0 and n_failed == 0:
            continue

        # Skip if heartbeat says "polling" — that is normal idle
        hb = heartbeats.get(stem, {})
        if hb.get("state") == "polling":
            continue

        alerts.append(Alert(
            machine=machine,
            level="warning",
            category="queue_exhausted",
            message=(
                f"queue {stem} exhausted: {n_completed} completed, "
                f"{n_failed} failed, 0 pending"
            ),
            key=f"{machine}:queue_exhausted:{stem}",
        ))

    return alerts


def check_dataset_preflight(
    machine: str,
    queues: dict[str, dict],
    datasets: list[str],
) -> list[Alert]:
    """Flag pending jobs that reference datasets not present on the machine."""
    alerts: list[Alert] = []
    dataset_set = set(datasets)

    for stem, qs in queues.items():
        for job in qs.get("jobs", []):
            if job.get("status") != "pending":
                continue

            dataset_path = _extract_dataset_arg(job)
            if not dataset_path:
                continue

            filename = Path(dataset_path).name
            if filename not in dataset_set:
                job_name = job.get("name", "?")
                alerts.append(Alert(
                    machine=machine,
                    level="critical",
                    category="dataset_missing",
                    message=f"job {job_name} references missing dataset {filename}",
                    key=f"{machine}:dataset_missing:{filename}",
                ))

    return alerts


def _extract_dataset_arg(job: dict) -> str | None:
    """Extract the --dataset value from a job's args list."""
    args = job.get("args", [])
    if isinstance(args, str):
        args = args.split()

    for i, arg in enumerate(args):
        if arg == "--dataset" and i + 1 < len(args):
            return args[i + 1]
        if arg.startswith("--dataset="):
            return arg.split("=", 1)[1]

    return None


# ---------------------------------------------------------------------------
# Run all checks on a checkin payload
# ---------------------------------------------------------------------------


def run_checks(payload: dict[str, Any]) -> list[Alert]:
    """Run all 4 detection checks on a single machine's checkin payload."""
    machine = payload.get("machine", "unknown")
    gpu = payload.get("gpu", {})
    heartbeats = payload.get("heartbeats", {})
    queues = payload.get("queues", {})
    datasets = payload.get("datasets", [])

    alerts: list[Alert] = []
    alerts += check_heartbeat_stale(machine, heartbeats)
    alerts += check_gpu_idle(machine, gpu, heartbeats, queues)
    alerts += check_queue_exhausted(machine, queues, heartbeats)
    alerts += check_dataset_preflight(machine, queues, datasets)
    return alerts


# ---------------------------------------------------------------------------
# Alert dedup
# ---------------------------------------------------------------------------


def load_watchdog_state(path: Path) -> dict[str, Any]:
    """Load watchdog state file, returning empty state on any error."""
    if not path.exists():
        return {"alerts": {}}
    try:
        with open(path, "r") as f:
            state = json.load(f)
        if not isinstance(state, dict):
            return {"alerts": {}}
        if "alerts" not in state:
            state["alerts"] = {}
        return state
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load watchdog state from %s: %s", path, exc)
        return {"alerts": {}}


def save_watchdog_state(path: Path, state: dict[str, Any]) -> None:
    """Write watchdog state file atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2, default=str)
        tmp.replace(path)
    except OSError as exc:
        logger.error("Failed to save watchdog state to %s: %s", path, exc)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def filter_dedup(
    alerts: list[Alert],
    state: dict[str, Any],
    now: datetime,
) -> list[Alert]:
    """Filter alerts through dedup window, updating state in place."""
    existing = state.get("alerts", {})
    new_alerts: list[Alert] = []
    current_keys: set[str] = set()

    for alert in alerts:
        current_keys.add(alert.key)
        last_fired_raw = existing.get(alert.key)

        if last_fired_raw:
            try:
                last_fired = datetime.fromisoformat(last_fired_raw)
                if (now - last_fired) < DEDUP_WINDOW:
                    logger.debug("Suppressed (dedup): %s", alert.key)
                    continue
            except (ValueError, TypeError):
                pass

        new_alerts.append(alert)
        existing[alert.key] = now.isoformat()

    # Self-cleaning: remove keys for conditions that no longer exist
    stale_keys = [k for k in existing if k not in current_keys]
    for k in stale_keys:
        del existing[k]

    state["alerts"] = existing
    return new_alerts


# ---------------------------------------------------------------------------
# Pushover notifications
# ---------------------------------------------------------------------------


def send_pushover(alerts: list[Alert]) -> None:
    """Send a batched Pushover notification. Silently returns if not configured."""
    token = os.environ.get("PUSHOVER_TOKEN", "")
    user = os.environ.get("PUSHOVER_USER", "")
    if not token or not user:
        logger.debug("Pushover not configured (missing PUSHOVER_TOKEN or PUSHOVER_USER)")
        return

    has_critical = any(a.level == "critical" for a in alerts)
    priority = 1 if has_critical else 0

    lines: list[str] = []
    for a in alerts:
        lines.append(f"[{a.level.upper()}] {a.machine}: {a.message}")
    body = "\n".join(lines)

    if len(body) > 1024:
        body = body[:1020] + "..."

    title = f"Fleet Monitor: {len(alerts)} alert(s)"

    data = urllib.parse.urlencode({
        "token": token,
        "user": user,
        "title": title,
        "message": body,
        "priority": priority,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.pushover.net/1/messages.json",
        data=data,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                logger.info("Pushover notification sent (%d alerts)", len(alerts))
            else:
                logger.warning("Pushover returned status %d", resp.status)
    except (urllib.error.URLError, OSError) as exc:
        logger.warning("Failed to send Pushover notification: %s", exc)


# ---------------------------------------------------------------------------
# File storage helpers
# ---------------------------------------------------------------------------


def store_checkin(fleet_data_dir: Path, payload: dict[str, Any]) -> None:
    """Write latest checkin to {machine}.json and append to telemetry.jsonl."""
    fleet_data_dir.mkdir(parents=True, exist_ok=True)
    machine = payload.get("machine", "unknown")

    # Latest checkin (atomic write)
    status_file = fleet_data_dir / f"{machine}.json"
    record = {
        **payload,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    tmp = status_file.with_suffix(".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(record, f, indent=2, default=str)
        tmp.replace(status_file)
    except OSError as exc:
        logger.error("Failed to write %s: %s", status_file, exc)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass

    # Append to telemetry log
    telemetry_file = fleet_data_dir / "telemetry.jsonl"
    try:
        with open(telemetry_file, "a") as f:
            f.write(json.dumps(record, default=str) + "\n")
    except OSError as exc:
        logger.error("Failed to append telemetry: %s", exc)


def load_latest_statuses(fleet_data_dir: Path) -> dict[str, dict[str, Any]]:
    """Load latest checkin for each machine."""
    statuses: dict[str, dict[str, Any]] = {}
    if not fleet_data_dir.exists():
        return statuses
    for f in fleet_data_dir.glob("*.json"):
        if f.name in ("watchdog_state.json",):
            continue
        try:
            with open(f, "r") as fh:
                data = json.load(fh)
            machine = data.get("machine", f.stem)
            statuses[machine] = data
        except (json.JSONDecodeError, OSError):
            pass
    return statuses


# ---------------------------------------------------------------------------
# Process a single checkin (called from route handler)
# ---------------------------------------------------------------------------


def process_checkin(fleet_data_dir: Path, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Store checkin, run detection, dedup, alert. Returns list of new alert dicts."""
    now = datetime.now(timezone.utc)

    # 1. Store
    store_checkin(fleet_data_dir, payload)

    # 2. Detect
    all_alerts = run_checks(payload)

    # 3. Dedup
    state_path = fleet_data_dir / "watchdog_state.json"
    state = load_watchdog_state(state_path)
    new_alerts = filter_dedup(all_alerts, state, now)
    save_watchdog_state(state_path, state)

    # 4. Send Pushover for new alerts
    if new_alerts:
        send_pushover(new_alerts)

    return [asdict(a) for a in new_alerts]


# ---------------------------------------------------------------------------
# Silence detection (background asyncio task)
# ---------------------------------------------------------------------------


async def silence_watchdog_loop(
    fleet_data_dir: Path,
    interval: int = 300,
) -> None:
    """Background task: check for machines that stopped checking in.

    Runs every ``interval`` seconds. If a machine's last checkin is older
    than SILENCE_THRESHOLD, fires an "unreachable" alert via Pushover with
    dedup.
    """
    logger.info("Silence watchdog started (interval=%ds, threshold=%s)", interval, SILENCE_THRESHOLD)

    while True:
        await asyncio.sleep(interval)

        try:
            now = datetime.now(timezone.utc)
            state_path = fleet_data_dir / "watchdog_state.json"
            state = load_watchdog_state(state_path)
            silence_alerts: list[Alert] = []

            if not fleet_data_dir.exists():
                continue

            for status_file in fleet_data_dir.glob("*.json"):
                if status_file.name in ("watchdog_state.json",):
                    continue

                try:
                    with open(status_file, "r") as f:
                        data = json.load(f)
                except (json.JSONDecodeError, OSError):
                    continue

                machine = data.get("machine", status_file.stem)

                # Check received_at (set by us) or timestamp (from collector)
                ts_raw = data.get("received_at") or data.get("timestamp")
                if not ts_raw:
                    continue

                try:
                    last_seen = datetime.fromisoformat(ts_raw)
                except (ValueError, TypeError):
                    continue

                age = now - last_seen
                if age > SILENCE_THRESHOLD:
                    age_min = age.total_seconds() / 60
                    silence_alerts.append(Alert(
                        machine=machine,
                        level="critical",
                        category="unreachable",
                        message=f"{machine} silent for {age_min:.0f}m (last checkin: {last_seen.strftime('%H:%M UTC')})",
                        key=f"{machine}:unreachable",
                    ))

            if silence_alerts:
                new_alerts = filter_dedup(silence_alerts, state, now)
                save_watchdog_state(state_path, state)
                if new_alerts:
                    send_pushover(new_alerts)
                    logger.warning(
                        "Silence watchdog fired %d alert(s): %s",
                        len(new_alerts),
                        ", ".join(a.machine for a in new_alerts),
                    )

        except Exception as exc:
            logger.error("Silence watchdog error: %s", exc, exc_info=True)
