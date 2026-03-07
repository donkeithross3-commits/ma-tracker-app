"""Fleet GPU utilization rollups for dashboard reporting.

Computes utilization attainment (% of theoretical 100% GPU-time) from
``telemetry.jsonl`` checkins produced by the fleet collector.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


# Below this wattage = idle. Active training is 100-350W.
GPU_POWER_IDLE_WATTS = 50
# When util reports 0% but power is above idle, estimate effective util%.
# Conservative: 80% — the GPU is doing real work, just can't measure it.
GPU_POWER_ACTIVE_UTIL_PCT = 80


@dataclass
class TelemetryPoint:
    ts: datetime
    util_pct: int


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    raw = raw.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


def _parse_util(raw: Any) -> int:
    try:
        val = int(float(raw))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, val))


def _load_points(
    telemetry_file: Path,
    *,
    machine_names: list[str],
    earliest_start: datetime,
) -> dict[str, list[TelemetryPoint]]:
    points: dict[str, list[TelemetryPoint]] = {m: [] for m in machine_names}
    last_before: dict[str, TelemetryPoint] = {}
    machine_set = set(machine_names)

    if not telemetry_file.exists():
        return points

    with open(telemetry_file, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue

            machine = str(rec.get("machine", "")).strip()
            if not machine or machine not in machine_set:
                continue

            ts = _parse_ts(rec.get("received_at")) or _parse_ts(rec.get("timestamp"))
            if ts is None:
                continue

            gpu = rec.get("gpu") or {}
            util = _parse_util(gpu.get("util"))
            # WDDM workaround: if util is 0% but power draw shows active GPU,
            # substitute a conservative estimate so attainment isn't zeroed out.
            if util == 0:
                power_w = gpu.get("power_w")
                if power_w is not None:
                    try:
                        if float(power_w) >= GPU_POWER_IDLE_WATTS:
                            util = GPU_POWER_ACTIVE_UTIL_PCT
                    except (ValueError, TypeError):
                        pass
            pt = TelemetryPoint(ts=ts, util_pct=util)

            if ts < earliest_start:
                prev = last_before.get(machine)
                if prev is None or prev.ts < ts:
                    last_before[machine] = pt
            else:
                points[machine].append(pt)

    for machine in machine_names:
        machine_points = points[machine]
        machine_points.sort(key=lambda p: p.ts)
        if machine in last_before:
            machine_points.insert(0, last_before[machine])

    return points


def _integrate_window(
    points: list[TelemetryPoint],
    *,
    start: datetime,
    end: datetime,
    carry_max_seconds: int,
) -> tuple[float, float, int]:
    """Integrate util% over [start, end] using piecewise-constant carry-forward.

    Returns: (achieved_gpu_seconds, observed_seconds, samples_in_window)
    """
    if end <= start:
        return 0.0, 0.0, 0
    if not points:
        return 0.0, 0.0, 0

    achieved = 0.0
    observed = 0.0
    samples = 0

    for idx, point in enumerate(points):
        if start <= point.ts < end:
            samples += 1
        if point.ts >= end:
            break

        next_ts = end
        if idx + 1 < len(points):
            next_ts = min(next_ts, points[idx + 1].ts)

        seg_start = max(point.ts, start)
        seg_end = min(next_ts, end)
        if seg_end <= seg_start:
            continue

        seg_seconds = (seg_end - seg_start).total_seconds()
        if carry_max_seconds > 0:
            seg_seconds = min(seg_seconds, float(carry_max_seconds))
        if seg_seconds <= 0:
            continue

        util_frac = point.util_pct / 100.0
        achieved += util_frac * seg_seconds
        observed += seg_seconds

    return achieved, observed, samples


def _window_summary(
    *,
    machine_points: dict[str, list[TelemetryPoint]],
    machine_names: list[str],
    start: datetime,
    end: datetime,
    carry_max_seconds: int,
) -> dict[str, Any]:
    window_seconds = max(0.0, (end - start).total_seconds())
    per_machine: dict[str, dict[str, Any]] = {}
    total_achieved = 0.0
    total_observed = 0.0

    for machine in machine_names:
        achieved, observed, samples = _integrate_window(
            machine_points.get(machine, []),
            start=start,
            end=end,
            carry_max_seconds=carry_max_seconds,
        )
        total_achieved += achieved
        total_observed += observed

        possible_hours = window_seconds / 3600.0
        achieved_hours = achieved / 3600.0
        attainment_pct = (achieved / window_seconds * 100.0) if window_seconds > 0 else 0.0
        coverage_pct = (observed / window_seconds * 100.0) if window_seconds > 0 else 0.0
        observed_avg_util_pct = (achieved / observed * 100.0) if observed > 0 else 0.0

        per_machine[machine] = {
            "attainment_pct": round(attainment_pct, 2),
            "coverage_pct": round(coverage_pct, 2),
            "observed_avg_util_pct": round(observed_avg_util_pct, 2),
            "achieved_gpu_hours": round(achieved_hours, 3),
            "possible_gpu_hours": round(possible_hours, 3),
            "samples": samples,
        }

    machine_count = max(1, len(machine_names))
    fleet_possible_seconds = window_seconds * machine_count
    fleet_attainment_pct = (
        total_achieved / fleet_possible_seconds * 100.0 if fleet_possible_seconds > 0 else 0.0
    )
    fleet_coverage_pct = (
        total_observed / fleet_possible_seconds * 100.0 if fleet_possible_seconds > 0 else 0.0
    )

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "hours": round(window_seconds / 3600.0, 3),
        "fleet_attainment_pct": round(fleet_attainment_pct, 2),
        "fleet_coverage_pct": round(fleet_coverage_pct, 2),
        "achieved_gpu_hours": round(total_achieved / 3600.0, 3),
        "possible_gpu_hours": round(fleet_possible_seconds / 3600.0, 3),
        "machines": per_machine,
    }


def _resolve_machine_names(latest_machines: list[str]) -> list[str]:
    configured = os.environ.get("FLEET_EXPECTED_MACHINES", "gaming-pc,garage-pc")
    names = [s.strip() for s in configured.split(",") if s.strip()]
    seen = set(names)
    for machine in latest_machines:
        if machine not in seen:
            names.append(machine)
            seen.add(machine)
    return sorted(names)


def _local_day_start(now_local: datetime) -> datetime:
    return datetime.combine(now_local.date(), time.min, tzinfo=now_local.tzinfo)


def _local_week_start(now_local: datetime) -> datetime:
    day_start = _local_day_start(now_local)
    return day_start - timedelta(days=day_start.weekday())


def build_utilization_report(
    *,
    fleet_data_dir: Path,
    latest_machines: list[str],
    daily_days: int = 14,
    weekly_weeks: int = 8,
    timezone_name: str = "America/New_York",
    carry_max_seconds: int = 600,
    now_utc: datetime | None = None,
) -> dict[str, Any]:
    daily_days = max(1, min(60, int(daily_days)))
    weekly_weeks = max(1, min(26, int(weekly_weeks)))
    carry_max_seconds = max(0, min(3600, int(carry_max_seconds)))

    try:
        tz = ZoneInfo(timezone_name)
        tz_effective = timezone_name
    except Exception:
        tz = ZoneInfo("UTC")
        tz_effective = "UTC"

    now_utc = now_utc.astimezone(UTC) if now_utc else datetime.now(UTC)
    now_local = now_utc.astimezone(tz)
    day_start_local = _local_day_start(now_local)
    week_start_local = _local_week_start(now_local)

    oldest_daily_start_local = day_start_local - timedelta(days=daily_days - 1)
    oldest_week_start_local = week_start_local - timedelta(weeks=weekly_weeks - 1)
    earliest_start = min(
        oldest_daily_start_local.astimezone(UTC),
        oldest_week_start_local.astimezone(UTC),
        (now_utc - timedelta(days=7)),
    )

    machine_names = _resolve_machine_names(latest_machines)
    telemetry_file = fleet_data_dir / "telemetry.jsonl"
    machine_points = _load_points(
        telemetry_file,
        machine_names=machine_names,
        earliest_start=earliest_start,
    )

    trailing_day = _window_summary(
        machine_points=machine_points,
        machine_names=machine_names,
        start=now_utc - timedelta(days=1),
        end=now_utc,
        carry_max_seconds=carry_max_seconds,
    )
    trailing_week = _window_summary(
        machine_points=machine_points,
        machine_names=machine_names,
        start=now_utc - timedelta(days=7),
        end=now_utc,
        carry_max_seconds=carry_max_seconds,
    )

    daily: list[dict[str, Any]] = []
    for offset in range(daily_days - 1, -1, -1):
        start_local = day_start_local - timedelta(days=offset)
        end_local = start_local + timedelta(days=1)
        start_utc = start_local.astimezone(UTC)
        end_utc = min(end_local.astimezone(UTC), now_utc)
        if end_utc <= start_utc:
            continue
        summary = _window_summary(
            machine_points=machine_points,
            machine_names=machine_names,
            start=start_utc,
            end=end_utc,
            carry_max_seconds=carry_max_seconds,
        )
        summary["label"] = start_local.date().isoformat()
        summary["complete"] = end_local <= now_local
        daily.append(summary)

    weekly: list[dict[str, Any]] = []
    for offset in range(weekly_weeks - 1, -1, -1):
        start_local = week_start_local - timedelta(weeks=offset)
        end_local = start_local + timedelta(weeks=1)
        start_utc = start_local.astimezone(UTC)
        end_utc = min(end_local.astimezone(UTC), now_utc)
        if end_utc <= start_utc:
            continue
        summary = _window_summary(
            machine_points=machine_points,
            machine_names=machine_names,
            start=start_utc,
            end=end_utc,
            carry_max_seconds=carry_max_seconds,
        )
        summary["label"] = start_local.date().isoformat()
        summary["complete"] = end_local <= now_local
        weekly.append(summary)

    return {
        "as_of": now_utc.isoformat(),
        "timezone": tz_effective,
        "machines": machine_names,
        "settings": {
            "daily_days": daily_days,
            "weekly_weeks": weekly_weeks,
            "carry_max_seconds": carry_max_seconds,
        },
        "trailing": {
            "day": trailing_day,
            "week": trailing_week,
        },
        "daily": daily,
        "weekly": weekly,
    }

