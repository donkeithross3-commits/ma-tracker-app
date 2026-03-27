"""Fail-fast completeness check for canonical execution telemetry."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import asyncpg

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Threshold:
    field: str
    minimum_rate: float


def _load_database_url() -> str:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        env_file = ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not db_url:
        raise RuntimeError("DATABASE_URL not set and python-service/.env not found")
    if "?sslmode=require" in db_url:
        db_url = db_url.replace("?sslmode=require", "?ssl=require")
    return db_url


def _window(date_text: str, tz_name: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(tz_name)
    start = datetime.fromisoformat(date_text).replace(tzinfo=tz)
    end = start + timedelta(days=1)
    return start, end


async def run_smoke(args: argparse.Namespace) -> dict:
    db_url = _load_database_url()
    conn = await asyncpg.connect(db_url)
    try:
        table_exists = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'algo_executions'
            )
            """
        )
        if not table_exists:
            raise RuntimeError("algo_executions does not exist")

        start, end = _window(args.date, args.timezone)
        row = await conn.fetchrow(
            """
            WITH sample AS (
                SELECT *
                FROM algo_executions
                WHERE COALESCE(fill_time, captured_at, created_at) >= $1::timestamptz
                  AND COALESCE(fill_time, captured_at, created_at) < $2::timestamptz
                  AND ($3::varchar = '' OR user_id = $3)
            )
            SELECT
                COUNT(*) AS total_rows,
                COUNT(*) FILTER (WHERE fill_time IS NOT NULL) AS with_fill_time,
                COUNT(*) FILTER (WHERE exec_id IS NOT NULL AND exec_id <> '') AS with_exec_id,
                COUNT(*) FILTER (WHERE routing_exchange IS NOT NULL AND routing_exchange <> '') AS with_routing_exchange,
                COUNT(*) FILTER (WHERE fill_exchange IS NOT NULL AND fill_exchange <> '') AS with_fill_exchange,
                COUNT(*) FILTER (WHERE commission IS NOT NULL) AS with_commission,
                COUNT(*) FILTER (WHERE pre_trade_snapshot IS NOT NULL) AS with_pre_trade_snapshot,
                COUNT(*) FILTER (
                    WHERE COALESCE(post_fill->>'mid_60s', '') <> ''
                ) AS with_post_fill_60s,
                MIN(COALESCE(fill_time, captured_at, created_at)) AS first_seen_at,
                MAX(COALESCE(fill_time, captured_at, created_at)) AS last_seen_at
            FROM sample
            """,
            start,
            end,
            args.user_id,
        )
    finally:
        await conn.close()

    total_rows = int(row["total_rows"] or 0)
    rates = {}
    for field in (
        "fill_time",
        "exec_id",
        "routing_exchange",
        "fill_exchange",
        "commission",
        "pre_trade_snapshot",
        "post_fill_60s",
    ):
        numerator = int(row[f"with_{field}"] or 0)
        rates[field] = {
            "count": numerator,
            "rate": (numerator / total_rows) if total_rows else 0.0,
        }

    thresholds = [
        Threshold("fill_time", args.min_fill_time_rate),
        Threshold("exec_id", args.min_exec_id_rate),
        Threshold("routing_exchange", args.min_routing_exchange_rate),
        Threshold("fill_exchange", args.min_fill_exchange_rate),
        Threshold("commission", args.min_commission_rate),
        Threshold("pre_trade_snapshot", args.min_pre_trade_snapshot_rate),
        Threshold("post_fill_60s", args.min_post_fill_rate),
    ]
    violations = [
        {
            "field": threshold.field,
            "rate": rates[threshold.field]["rate"],
            "minimum_rate": threshold.minimum_rate,
            "count": rates[threshold.field]["count"],
            "total_rows": total_rows,
        }
        for threshold in thresholds
        if rates[threshold.field]["rate"] < threshold.minimum_rate
    ]

    result = {
        "date": args.date,
        "timezone": args.timezone,
        "user_id": args.user_id or None,
        "total_rows": total_rows,
        "first_seen_at": row["first_seen_at"].isoformat() if row["first_seen_at"] else None,
        "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
        "rates": rates,
        "violations": violations,
        "passed": total_rows > 0 and not violations,
    }
    if total_rows == 0:
        result["violations"].append({
            "field": "total_rows",
            "rate": 0.0,
            "minimum_rate": 1.0,
            "count": 0,
            "total_rows": 0,
        })
        result["passed"] = False
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fail-fast completeness check for algo_executions telemetry",
    )
    parser.add_argument("--date", required=True, help="Session date, e.g. 2026-03-26")
    parser.add_argument("--timezone", default="America/Chicago")
    parser.add_argument("--user-id", default="")
    parser.add_argument("--min-fill-time-rate", type=float, default=0.99)
    parser.add_argument("--min-exec-id-rate", type=float, default=0.8)
    parser.add_argument("--min-routing-exchange-rate", type=float, default=0.8)
    parser.add_argument("--min-fill-exchange-rate", type=float, default=0.8)
    parser.add_argument("--min-commission-rate", type=float, default=0.8)
    parser.add_argument("--min-pre-trade-snapshot-rate", type=float, default=0.5)
    parser.add_argument("--min-post-fill-rate", type=float, default=0.5)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    result = asyncio.run(run_smoke(args))
    print(json.dumps(result, indent=2, default=str))
    if not result["passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
