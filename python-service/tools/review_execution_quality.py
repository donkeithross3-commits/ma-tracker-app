#!/usr/bin/env python3
"""Review execution-quality telemetry for a single trading day.

Designed for real DR3 execution data. The report keeps options live-entry
statistics separate from futures and from broker reconciliation rows so venue
comparisons do not get mixed across unlike populations.
"""

import argparse
import asyncio
import json
import os
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg


def coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return value
    return value


def as_iso(value: Any, tz: ZoneInfo) -> str | None:
    if isinstance(value, datetime):
        return value.astimezone(tz).isoformat()
    return None


def mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 6) if values else None


def median(values: list[float]) -> float | None:
    return round(statistics.median(values), 6) if values else None


def post_fill_mid(post_fill: Any, key: str = "mid_60s") -> float | None:
    data = parse_jsonish(post_fill)
    if not isinstance(data, dict):
        return None
    return coerce_float(data.get(key))


def side_adjusted_adverse(row: dict[str, Any], key: str = "mid_60s") -> float | None:
    mid = post_fill_mid(row.get("post_fill"), key)
    price = coerce_float(row.get("avg_price"))
    if mid is None or price is None:
        return None
    side = str(row.get("side") or "").upper()
    if side in {"BOT", "BUY"}:
        return round(mid - price, 6)
    if side in {"SLD", "SELL"}:
        return round(price - mid, 6)
    return None


def flags(row: dict[str, Any]) -> dict[str, bool]:
    pre = parse_jsonish(row.get("pre_trade_snapshot"))
    degraded = parse_jsonish(row.get("degraded_reasons"))
    return {
        "pre": isinstance(pre, dict),
        "post60": post_fill_mid(row.get("post_fill"), "mid_60s") is not None,
        "commission": row.get("commission") is not None,
        "exec_id": bool(row.get("exec_id")),
        "route": bool(row.get("routing_exchange")),
        "fill_exchange": bool(row.get("fill_exchange")),
        "liq": row.get("last_liquidity") is not None,
        "slippage": row.get("slippage") is not None,
        "spread": row.get("effective_spread") is not None,
        "realized": row.get("realized_pnl_ib") is not None,
        "degraded_reasons": isinstance(degraded, list) and bool(degraded),
    }


def rate(rows: list[dict[str, Any]], key: str) -> float | None:
    if not rows:
        return None
    return round(sum(1 for row in rows if flags(row)[key]) / len(rows), 6)


def bucket_summary(name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    slippages = [coerce_float(r.get("slippage")) for r in rows if coerce_float(r.get("slippage")) is not None]
    spreads = [coerce_float(r.get("effective_spread")) for r in rows if coerce_float(r.get("effective_spread")) is not None]
    adverse = [side_adjusted_adverse(r) for r in rows if side_adjusted_adverse(r) is not None]
    commissions = [coerce_float(r.get("commission")) for r in rows if coerce_float(r.get("commission")) is not None]
    realized = [coerce_float(r.get("realized_pnl_ib")) for r in rows if coerce_float(r.get("realized_pnl_ib")) is not None]
    return {
        "bucket": name,
        "fills": len(rows),
        "qty": sum(int(r.get("qty_filled") or 0) for r in rows),
        "slippage_avg": mean(slippages),
        "slippage_median": median(slippages),
        "effective_spread_avg": mean(spreads),
        "effective_spread_median": median(spreads),
        "adverse60_avg": mean(adverse),
        "adverse60_median": median(adverse),
        "commission_total": round(sum(commissions), 6) if commissions else None,
        "commission_avg": mean(commissions),
        "realized_pnl_total": round(sum(realized), 6) if realized else None,
        "pre_rate": rate(rows, "pre"),
        "post60_rate": rate(rows, "post60"),
        "commission_rate": rate(rows, "commission"),
        "slippage_rate": rate(rows, "slippage"),
        "spread_rate": rate(rows, "spread"),
        "degraded": sum(1 for r in rows if (r.get("analytics_status") or "") == "degraded"),
        "broker_enriched": sum(1 for r in rows if (r.get("analytics_status") or "") == "broker_enriched"),
        "finalized": sum(1 for r in rows if (r.get("analytics_status") or "") == "finalized"),
    }


async def fetch_rows(database_url: str, user_id: str, start: datetime, end: datetime) -> tuple[list[dict[str, Any]], datetime]:
    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch(
            """
            select *
            from algo_executions
            where coalesce(fill_time, captured_at, created_at) >= $1
              and coalesce(fill_time, captured_at, created_at) < $2
              and user_id = $3
            order by coalesce(fill_time, captured_at, created_at), broker_execution_key
            """,
            start,
            end,
            user_id,
        )
        as_of = await conn.fetchval("select now()")
    finally:
        await conn.close()

    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for key in ("pre_trade_snapshot", "post_fill", "degraded_reasons", "finalization_state"):
            item[key] = parse_jsonish(item.get(key))
        for key in ("strike", "avg_price", "pnl_pct", "commission", "realized_pnl_ib", "slippage", "effective_spread"):
            item[key] = coerce_float(item.get(key))
        normalized.append(item)
    return normalized, as_of


def load_ledger_rows(ledger_path: Path, start: datetime, end: datetime, tz: ZoneInfo) -> list[dict[str, Any]]:
    if not ledger_path.exists():
        return []
    ledger = json.loads(ledger_path.read_text())
    executions = ledger.get("executions", {}) if isinstance(ledger, dict) else {}
    rows = []
    for value in executions.values():
        ts = coerce_float(value.get("fill_time"))
        if ts is None:
            continue
        dt = datetime.fromtimestamp(ts, tz)
        if start <= dt < end:
            rows.append(value)
    return rows


async def main() -> None:
    parser = argparse.ArgumentParser(description="Review execution-quality telemetry for a single day")
    parser.add_argument("--date", required=True)
    parser.add_argument("--timezone", default="America/Chicago")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--ledger-path", default="standalone_agent/position_store.ledger.json")
    args = parser.parse_args()

    tz = ZoneInfo(args.timezone)
    start = datetime.fromisoformat(args.date).replace(tzinfo=tz)
    end = start + timedelta(days=1)

    database_url = os.environ["DATABASE_URL"].replace("?sslmode=require", "?ssl=require")
    rows, as_of = await fetch_rows(database_url, args.user_id, start, end)
    ledger_rows = load_ledger_rows(Path(args.ledger_path), start, end, tz)

    db_keys = {r.get("broker_execution_key") for r in rows if r.get("broker_execution_key")}
    ledger_keys = {r.get("broker_execution_key") for r in ledger_rows if r.get("broker_execution_key")}

    by_fill: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_route: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_liq: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_status: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_contract: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_sec_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_sec_type_source: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    source_venue: dict[tuple[str, str, str, str, str], int] = defaultdict(int)
    live_option_entries_by_fill: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reasons: dict[str, int] = defaultdict(int)

    for row in rows:
        fill_exchange = row.get("fill_exchange") or "(missing)"
        routing_exchange = row.get("routing_exchange") or "(missing)"
        source = row.get("source") or "(missing)"
        sec_type = row.get("sec_type") or "(missing)"
        level = row.get("level") or "(missing)"
        by_fill[fill_exchange].append(row)
        by_route[routing_exchange].append(row)
        by_liq[str(row.get("last_liquidity")) if row.get("last_liquidity") is not None else "(missing)"].append(row)
        by_source[source].append(row)
        by_status[row.get("analytics_status") or "(missing)"].append(row)
        by_sec_type[sec_type].append(row)
        by_sec_type_source[(sec_type, source)].append(row)
        source_venue[(sec_type, source, routing_exchange, fill_exchange, level)] += 1
        if sec_type == "OPT" and source == "position_store_fill" and level == "entry":
            live_option_entries_by_fill[fill_exchange].append(row)
        contract = f"{row.get('symbol')} {row.get('right_type')} {row.get('strike')} {row.get('expiry')}"
        by_contract[contract].append(row)
        degraded_reasons = parse_jsonish(row.get("degraded_reasons"))
        if isinstance(degraded_reasons, list):
            for reason in degraded_reasons:
                reasons[str(reason)] += 1

    output = {
        "date": args.date,
        "timezone": args.timezone,
        "as_of": as_iso(as_of, tz),
        "user_id": args.user_id,
        "total_rows": len(rows),
        "total_qty": sum(int(r.get("qty_filled") or 0) for r in rows),
        "db_vs_ledger": {
            "db_rows": len(rows),
            "ledger_rows": len(ledger_rows),
            "db_only": len(db_keys - ledger_keys),
            "ledger_only": len(ledger_keys - db_keys),
        },
        "sources": {k: len(v) for k, v in sorted(by_source.items(), key=lambda kv: (-len(kv[1]), kv[0]))},
        "sec_types": {k: len(v) for k, v in sorted(by_sec_type.items(), key=lambda kv: (-len(kv[1]), kv[0]))},
        "analytics_status": {k: len(v) for k, v in sorted(by_status.items(), key=lambda kv: (-len(kv[1]), kv[0]))},
        "completeness": {
            "fill_time_rate": round(sum(1 for r in rows if r.get("fill_time") is not None) / len(rows), 6) if rows else None,
            "exec_id_rate": rate(rows, "exec_id"),
            "routing_exchange_rate": rate(rows, "route"),
            "fill_exchange_rate": rate(rows, "fill_exchange"),
            "last_liquidity_rate": rate(rows, "liq"),
            "commission_rate": rate(rows, "commission"),
            "pre_trade_snapshot_rate": rate(rows, "pre"),
            "post_fill_60s_rate": rate(rows, "post60"),
            "slippage_rate": rate(rows, "slippage"),
            "effective_spread_rate": rate(rows, "spread"),
            "realized_pnl_rate": rate(rows, "realized"),
        },
        "overall": bucket_summary("all", rows),
        "by_fill_exchange": [bucket_summary(k, v) for k, v in sorted(by_fill.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
        "by_routing_exchange": [bucket_summary(k, v) for k, v in sorted(by_route.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
        "by_last_liquidity": [bucket_summary(k, v) for k, v in sorted(by_liq.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
        "by_source": [bucket_summary(k, v) for k, v in sorted(by_source.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
        "by_sec_type": [bucket_summary(k, v) for k, v in sorted(by_sec_type.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
        "by_sec_type_and_source": [
            {
                "sec_type": key[0],
                "source": key[1],
                **bucket_summary(f"{key[0]}:{key[1]}", value),
            }
            for key, value in sorted(by_sec_type_source.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ],
        "live_option_entries_by_fill_exchange": [
            bucket_summary(k, v) for k, v in sorted(live_option_entries_by_fill.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ],
        "source_venue_level_counts": [
            {
                "sec_type": key[0],
                "source": key[1],
                "routing_exchange": key[2],
                "fill_exchange": key[3],
                "level": key[4],
                "fills": value,
            }
            for key, value in sorted(source_venue.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "top_contracts": [bucket_summary(k, v) for k, v in sorted(by_contract.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:10]],
        "degraded_reason_counts": dict(sorted(reasons.items(), key=lambda kv: (-kv[1], kv[0]))),
        "sample": [
            {
                "fill_time": as_iso(r.get("fill_time"), tz),
                "contract_key": r.get("contract_key"),
                "side": r.get("side"),
                "level": r.get("level"),
                "qty_filled": r.get("qty_filled"),
                "avg_price": r.get("avg_price"),
                "routing_exchange": r.get("routing_exchange"),
                "fill_exchange": r.get("fill_exchange"),
                "last_liquidity": r.get("last_liquidity"),
                "slippage": r.get("slippage"),
                "effective_spread": r.get("effective_spread"),
                "commission": r.get("commission"),
                "analytics_status": r.get("analytics_status"),
                "degraded_reasons": r.get("degraded_reasons"),
                "post_fill_mid_60s": post_fill_mid(r.get("post_fill")),
                "adverse60_side_adjusted": side_adjusted_adverse(r),
            }
            for r in rows[:10]
        ],
    }
    print(json.dumps(output, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
