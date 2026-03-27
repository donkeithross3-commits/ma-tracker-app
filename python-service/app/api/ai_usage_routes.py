"""
AI Usage Tracking API — unified telemetry for all AI consumption.

POST /ai-usage/ingest      — Collector pushes session data (auth: X-Fleet-Key)
GET  /ai-usage/summary     — Dashboard summary (daily/weekly/monthly)
GET  /ai-usage/sessions    — Session list with detail
GET  /ai-usage/burn-rate   — Real-time burn rate estimate
GET  /ai-usage/efficiency  — Overhead ratios, anomalies, machine×agent matrix
"""

import json
import logging
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from dateutil.parser import isoparse
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-usage", tags=["ai-usage"])

# Estimated weekly quota in API-equivalent dollars (for Max subscription).
# This is a rough heuristic — Anthropic doesn't publish exact limits.
WEEKLY_QUOTA_EQUIV = float(os.environ.get("AI_USAGE_WEEKLY_QUOTA", "5000"))

# Pricing per million tokens (for computing cost_usd when callers send $0)
_PRICING: dict[str, dict[str, float]] = {
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
    "claude-opus-4-6": {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-20250929": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-5-20250929": {"input": 3.0, "output": 15.0},
    "claude-haiku-3-5-20241022": {"input": 0.80, "output": 4.0},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.0},
}


def _compute_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Compute API cost from model + tokens. Returns 0 if model unknown."""
    pricing = _PRICING.get(model)
    if not pricing:
        # Try prefix matching for model variants
        for key, p in _PRICING.items():
            if model.startswith(key.rsplit("-", 1)[0]):
                pricing = p
                break
    if not pricing:
        return 0.0
    return (input_tokens * pricing["input"] / 1_000_000) + (
        output_tokens * pricing["output"] / 1_000_000
    )


# Re-use fleet auth pattern — same key, same trust model
def _validate_fleet_key(x_fleet_key: str | None) -> None:
    """Validate the X-Fleet-Key header."""
    expected = os.environ.get("FLEET_API_KEY", "")
    if not expected:
        raise HTTPException(status_code=500, detail="FLEET_API_KEY not configured")
    if not x_fleet_key or x_fleet_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Fleet-Key")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SessionIngest(BaseModel):
    """A single Claude Code session's usage data, from the collector."""
    session_id: str
    machine: str
    provider: str = "anthropic"
    account_id: str = "primary"
    project: str | None = None
    agent_persona: str | None = None
    model_primary: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    cost_equivalent: float = 0.0
    message_count: int = 0
    subagent_count: int = 0
    model_breakdown: dict[str, Any] | None = None


class CallIngest(BaseModel):
    """A single API/CLI call's usage data, from research_brain or other bridges."""
    source: str
    model: str
    auth_method: str = "cli_oauth"
    machine: str | None = None
    provider: str = "anthropic"
    account_id: str = "primary"
    ticker: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    cost_usd: float = 0.0
    metadata: dict[str, Any] | None = None


class IngestPayload(BaseModel):
    """Payload from the collector script."""
    sessions: list[SessionIngest] = Field(default_factory=list)
    calls: list[CallIngest] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helper: get DB pool from app state
# ---------------------------------------------------------------------------

def _get_pool():
    """Get the asyncpg pool from the EdgarDatabase singleton."""
    from ..main import get_db
    try:
        db = get_db()
        return db.pool
    except RuntimeError:
        return None


def _row_to_dict(row) -> dict:
    """Convert asyncpg Record to dict, serializing dates and Decimals."""
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif isinstance(v, date):
            d[k] = v.isoformat()
        elif hasattr(v, "__float__") and not isinstance(v, (int, float)):
            d[k] = float(v)
    return d


# ---------------------------------------------------------------------------
# POST /ai-usage/ingest — collector pushes session + call data
# ---------------------------------------------------------------------------

@router.post("/ingest")
async def ingest_usage(
    payload: IngestPayload,
    x_fleet_key: str | None = Header(None),
):
    """Ingest AI usage data from collector scripts.

    Idempotent: sessions are upserted by session_id.
    """
    _validate_fleet_key(x_fleet_key)
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    sessions_upserted = 0
    calls_inserted = 0

    def _parse_ts(val: str | None) -> datetime | None:
        if not val:
            return None
        try:
            return isoparse(val)
        except (ValueError, TypeError):
            return None

    async with pool.acquire() as conn:
        for s in payload.sessions:
            try:
                await conn.execute(
                    """INSERT INTO ai_usage_sessions
                       (session_id, machine, provider, account_id, project,
                        agent_persona, model_primary, started_at, ended_at,
                        input_tokens, output_tokens, cache_creation_tokens,
                        cache_read_tokens, cost_equivalent, message_count,
                        subagent_count, model_breakdown)
                       VALUES ($1, $2, $3, $4, $5, $6, $7,
                               $8, $9,
                               $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
                       ON CONFLICT (session_id) DO UPDATE SET
                           ended_at = EXCLUDED.ended_at,
                           input_tokens = EXCLUDED.input_tokens,
                           output_tokens = EXCLUDED.output_tokens,
                           cache_creation_tokens = EXCLUDED.cache_creation_tokens,
                           cache_read_tokens = EXCLUDED.cache_read_tokens,
                           cost_equivalent = EXCLUDED.cost_equivalent,
                           message_count = EXCLUDED.message_count,
                           subagent_count = EXCLUDED.subagent_count,
                           model_breakdown = EXCLUDED.model_breakdown,
                           collected_at = NOW()""",
                    s.session_id, s.machine, s.provider, s.account_id,
                    s.project, s.agent_persona, s.model_primary,
                    _parse_ts(s.started_at), _parse_ts(s.ended_at),
                    s.input_tokens, s.output_tokens,
                    s.cache_creation_tokens, s.cache_read_tokens,
                    s.cost_equivalent, s.message_count, s.subagent_count,
                    json.dumps(s.model_breakdown) if s.model_breakdown else None,
                )
                sessions_upserted += 1
            except Exception as e:
                logger.warning("Failed to upsert session %s: %s", s.session_id, e)

        for c in payload.calls:
            try:
                # Compute cost if caller sent $0 (common for CLI-mode callers)
                cost = c.cost_usd
                if cost == 0.0 and c.auth_method == "api_key":
                    cost = _compute_cost(c.model, c.input_tokens, c.output_tokens)

                await conn.execute(
                    """INSERT INTO api_call_log
                       (source, model, ticker, input_tokens, output_tokens,
                        cache_creation_tokens, cache_read_tokens, cost_usd,
                        metadata, auth_method, machine, account_id, provider)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
                               $10, $11, $12, $13)""",
                    c.source, c.model, c.ticker,
                    c.input_tokens, c.output_tokens,
                    c.cache_creation_tokens, c.cache_read_tokens,
                    cost,
                    json.dumps(c.metadata) if c.metadata else None,
                    c.auth_method, c.machine, c.account_id, c.provider,
                )
                calls_inserted += 1
            except Exception as e:
                logger.warning("Failed to insert call: %s", e)

    return {
        "sessions_upserted": sessions_upserted,
        "calls_inserted": calls_inserted,
    }


# ---------------------------------------------------------------------------
# GET /ai-usage/summary — dashboard aggregate view
# ---------------------------------------------------------------------------

@router.get("/summary")
async def usage_summary(
    days: int = Query(default=7, ge=1, le=90),
):
    """Daily usage summary over the requested window."""
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    async with pool.acquire() as conn:
        call_rows = await conn.fetch(
            """SELECT called_at::date AS day,
                      COALESCE(auth_method, 'api_key') AS auth_method,
                      COALESCE(source, 'unknown') AS source,
                      SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      SUM(cache_creation_tokens) AS cache_creation_tokens,
                      SUM(cache_read_tokens) AS cache_read_tokens,
                      SUM(cost_usd) AS cost_usd,
                      COUNT(*) AS call_count
               FROM api_call_log
               WHERE called_at >= $1
               GROUP BY day, auth_method, source
               ORDER BY day DESC""",
            since,
        )

        # Use COALESCE(started_at, ended_at) — collector may only set ended_at.
        session_rows = await conn.fetch(
            """SELECT COALESCE(started_at, ended_at)::date AS day,
                      machine,
                      agent_persona,
                      SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      SUM(cache_creation_tokens) AS cache_creation_tokens,
                      SUM(cache_read_tokens) AS cache_read_tokens,
                      SUM(cost_equivalent) AS cost_equivalent,
                      COUNT(*) AS session_count,
                      SUM(message_count) AS message_count
               FROM ai_usage_sessions
               WHERE COALESCE(started_at, ended_at) >= $1
               GROUP BY day, machine, agent_persona
               ORDER BY day DESC""",
            since,
        )

        call_totals = await conn.fetchrow(
            """SELECT SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      SUM(cache_creation_tokens) AS cache_creation_tokens,
                      SUM(cache_read_tokens) AS cache_read_tokens,
                      SUM(cost_usd) AS cost_usd,
                      COUNT(*) AS call_count
               FROM api_call_log WHERE called_at >= $1""",
            since,
        )

        session_totals = await conn.fetchrow(
            """SELECT SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      SUM(cache_creation_tokens) AS cache_creation_tokens,
                      SUM(cache_read_tokens) AS cache_read_tokens,
                      SUM(cost_equivalent) AS cost_equivalent,
                      COUNT(*) AS session_count,
                      SUM(message_count) AS message_count
               FROM ai_usage_sessions WHERE COALESCE(started_at, ended_at) >= $1""",
            since,
        )

    return {
        "period_days": days,
        "since": since.isoformat(),
        "programmatic_calls": [_row_to_dict(r) for r in call_rows],
        "interactive_sessions": [_row_to_dict(r) for r in session_rows],
        "totals": {
            "programmatic": _row_to_dict(call_totals) if call_totals else {},
            "interactive": _row_to_dict(session_totals) if session_totals else {},
        },
    }


# ---------------------------------------------------------------------------
# GET /ai-usage/sessions — session detail list
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    days: int = Query(default=7, ge=1, le=90),
    machine: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List interactive Claude Code sessions with token details."""
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    conditions = ["COALESCE(started_at, ended_at) >= $1"]
    params: list[Any] = [since]
    idx = 2

    if machine:
        conditions.append(f"machine = ${idx}")
        params.append(machine)
        idx += 1
    if agent:
        conditions.append(f"agent_persona = ${idx}")
        params.append(agent)
        idx += 1

    where = " AND ".join(conditions)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT session_id, machine, provider, account_id, project,
                       agent_persona, model_primary, started_at, ended_at,
                       input_tokens, output_tokens, cache_creation_tokens,
                       cache_read_tokens, cost_equivalent, message_count,
                       subagent_count, model_breakdown,
                       CASE WHEN (input_tokens + output_tokens) > 0
                            THEN ROUND(cache_creation_tokens::numeric / (input_tokens + output_tokens), 1)
                            ELSE 0 END AS overhead_ratio
                FROM ai_usage_sessions
                WHERE {where}
                ORDER BY COALESCE(started_at, ended_at) DESC
                LIMIT ${idx} OFFSET ${idx + 1}""",
            *params, limit, offset,
        )

        count_row = await conn.fetchrow(
            f"SELECT COUNT(*) AS total FROM ai_usage_sessions WHERE {where}",
            *params,
        )

    def _session_to_dict(row):
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, datetime):
                d[k] = v.isoformat()
            elif isinstance(v, date):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, float)):
                d[k] = float(v)
        if d.get("model_breakdown") and isinstance(d["model_breakdown"], str):
            try:
                d["model_breakdown"] = json.loads(d["model_breakdown"])
            except Exception:
                pass
        return d

    return {
        "sessions": [_session_to_dict(r) for r in rows],
        "total": count_row["total"] if count_row else 0,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /ai-usage/burn-rate — real-time consumption rate
# ---------------------------------------------------------------------------

@router.get("/burn-rate")
async def burn_rate():
    """Compute rolling burn rates for subscription budget estimation."""
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    now = datetime.now(timezone.utc)
    windows = {"1h": 1, "6h": 6, "24h": 24}
    rates: dict[str, Any] = {}

    async with pool.acquire() as conn:
        for label, hours in windows.items():
            since = now - timedelta(hours=hours)

            call_row = await conn.fetchrow(
                """SELECT COALESCE(SUM(input_tokens), 0) AS total_in,
                          COALESCE(SUM(output_tokens), 0) AS total_out,
                          COALESCE(SUM(cost_usd), 0) AS cost
                   FROM api_call_log WHERE called_at >= $1""",
                since,
            )

            session_row = await conn.fetchrow(
                """SELECT COALESCE(SUM(input_tokens), 0) AS total_in,
                          COALESCE(SUM(output_tokens), 0) AS total_out,
                          COALESCE(SUM(cost_equivalent), 0) AS cost
                   FROM ai_usage_sessions
                   WHERE COALESCE(started_at, ended_at) >= $1""",
                since,
            )

            total_in = int(call_row["total_in"]) + int(session_row["total_in"])
            total_out = int(call_row["total_out"]) + int(session_row["total_out"])
            total_cost = float(call_row["cost"]) + float(session_row["cost"])

            rates[label] = {
                "tokens_per_hour": round((total_in + total_out) / hours),
                "cost_per_hour": round(total_cost / hours, 4),
                "total_tokens": total_in + total_out,
                "total_cost_equivalent": round(total_cost, 4),
                "window_hours": hours,
            }

        # Today's totals
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_calls = await conn.fetchrow(
            """SELECT COALESCE(SUM(cost_usd), 0) AS cost,
                      COUNT(*) AS call_count
               FROM api_call_log WHERE called_at >= $1""",
            today_start,
        )
        today_sessions = await conn.fetchrow(
            """SELECT COALESCE(SUM(cost_equivalent), 0) AS cost,
                      COUNT(*) AS session_count
               FROM ai_usage_sessions
               WHERE COALESCE(started_at, ended_at) >= $1""",
            today_start,
        )

        # Quota health: trailing 7d subscription cost vs estimated weekly quota
        week_ago = now - timedelta(days=7)
        quota_row = await conn.fetchrow(
            """SELECT COALESCE(SUM(cost_equivalent), 0) AS used_7d
               FROM ai_usage_sessions
               WHERE COALESCE(started_at, ended_at) >= $1""",
            week_ago,
        )

    used_7d = float(quota_row["used_7d"]) if quota_row else 0.0

    return {
        "rates": rates,
        "today": {
            "cost_equivalent": round(
                float(today_calls["cost"]) + float(today_sessions["cost"]), 4
            ),
            "programmatic_calls": today_calls["call_count"],
            "interactive_sessions": today_sessions["session_count"],
        },
        "quota_health": {
            "estimated_weekly_equiv": WEEKLY_QUOTA_EQUIV,
            "used_7d": round(used_7d, 2),
            "pct": round(used_7d / WEEKLY_QUOTA_EQUIV * 100, 1) if WEEKLY_QUOTA_EQUIV > 0 else 0,
        },
        "computed_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# GET /ai-usage/efficiency — overhead analysis and anomaly detection
# ---------------------------------------------------------------------------

@router.get("/efficiency")
async def efficiency_analysis(
    days: int = Query(default=7, ge=1, le=90),
):
    """Compute overhead ratios, machine×agent matrix, and detect anomalies.

    Overhead ratio = cache_creation_tokens / (input_tokens + output_tokens).
    High ratios indicate workloads where per-session system prompt overhead
    dominates — candidates for migration from CLI to API.
    """
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT session_id, machine,
                      COALESCE(agent_persona, 'unknown') AS agent_persona,
                      model_primary,
                      COALESCE(started_at, ended_at)::date AS day,
                      input_tokens, output_tokens, cache_creation_tokens,
                      cost_equivalent,
                      CASE WHEN (input_tokens + output_tokens) > 0
                           THEN cache_creation_tokens::float / (input_tokens + output_tokens)
                           ELSE 0 END AS overhead_ratio
               FROM ai_usage_sessions
               WHERE COALESCE(started_at, ended_at) >= $1
               ORDER BY cost_equivalent DESC""",
            since,
        )

    # Labels that represent normal interactive Claude Code usage
    # (high overhead is expected — system prompt caching is inherent to CLI sessions)
    _INTERACTIVE_LABELS = {"unknown", "interactive", "subagent"}

    # Build per-session list
    per_session = []
    for r in rows:
        d = _row_to_dict(r)
        # Only flag as inefficient if it's an identified automated workload
        # Interactive sessions naturally have high overhead from system prompts
        is_automated = d["agent_persona"] not in _INTERACTIVE_LABELS
        d["is_inefficient"] = (
            is_automated and d["overhead_ratio"] > 10 and d["cost_equivalent"] > 5
        )
        per_session.append(d)

    # Machine × Agent matrix
    matrix: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for s in per_session:
        matrix[s["machine"]][s["agent_persona"]] += s["cost_equivalent"]
    # Convert to regular dicts for JSON
    matrix_out = {m: dict(agents) for m, agents in matrix.items()}

    # Per-agent aggregation
    agent_agg: dict[str, dict[str, Any]] = {}
    for s in per_session:
        key = f"{s['agent_persona']}:{s['machine']}"
        if key not in agent_agg:
            agent_agg[key] = {
                "agent": s["agent_persona"],
                "machine": s["machine"],
                "sessions": 0,
                "total_cost": 0.0,
                "total_overhead_weighted": 0.0,
                "total_useful_tokens": 0,
            }
        agg = agent_agg[key]
        agg["sessions"] += 1
        agg["total_cost"] += s["cost_equivalent"]
        useful = s["input_tokens"] + s["output_tokens"]
        agg["total_useful_tokens"] += useful
        agg["total_overhead_weighted"] += s["overhead_ratio"] * useful

    per_agent = []
    for agg in sorted(agent_agg.values(), key=lambda x: -x["total_cost"]):
        if agg["total_useful_tokens"] > 0:
            avg_overhead = agg["total_overhead_weighted"] / agg["total_useful_tokens"]
        else:
            avg_overhead = 0.0
        is_automated = agg["agent"] not in _INTERACTIVE_LABELS
        per_agent.append({
            "agent": agg["agent"],
            "machine": agg["machine"],
            "sessions": agg["sessions"],
            "total_cost": round(agg["total_cost"], 2),
            "avg_overhead_ratio": round(avg_overhead, 1),
            "is_inefficient": is_automated and avg_overhead > 10 and agg["total_cost"] > 50,
        })

    # Anomaly detection
    anomalies = []

    # 1. High overhead on AUTOMATED workloads (not interactive sessions)
    for pa in per_agent:
        if pa["is_inefficient"]:
            anomalies.append({
                "type": "high_overhead",
                "severity": "high",
                "machine": pa["machine"],
                "agent": pa["agent"],
                "detail": (
                    f"{pa['agent']} on {pa['machine']}: "
                    f"{pa['avg_overhead_ratio']:.0f}:1 overhead across "
                    f"{pa['sessions']} session{'s' if pa['sessions'] != 1 else ''} "
                    f"(${pa['total_cost']:.0f} equiv) — migrate to API"
                ),
            })

    # 2. Single-day spike >$500
    daily_cost: dict[str, float] = defaultdict(float)
    for s in per_session:
        daily_cost[str(s["day"])] += s["cost_equivalent"]
    for day, cost in sorted(daily_cost.items(), reverse=True):
        if cost > 500:
            anomalies.append({
                "type": "daily_spike",
                "severity": "medium",
                "machine": None,
                "agent": None,
                "detail": f"{day}: ${cost:,.0f} subscription equivalent",
            })

    return {
        "period_days": days,
        "per_session": per_session[:100],  # Cap to avoid huge responses
        "per_agent": per_agent,
        "machine_agent_matrix": matrix_out,
        "anomalies": anomalies,
    }
