"""
AI Usage Tracking API — unified telemetry for all AI consumption.

POST /ai-usage/ingest    — Collector pushes session data (auth: X-Fleet-Key)
GET  /ai-usage/summary   — Dashboard summary (daily/weekly/monthly)
GET  /ai-usage/sessions  — Session list with detail
GET  /ai-usage/burn-rate — Real-time burn rate estimate
"""

import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from dateutil.parser import isoparse
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-usage", tags=["ai-usage"])

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
    """Get the asyncpg pool from the EdgarDatabase singleton.

    This module is registered in main.py (port 8000, bare metal FastAPI),
    NOT portfolio_main.py (port 8001, Docker container). The DB pool lives
    on the EdgarDatabase global instance.
    """
    from ..main import get_db
    try:
        db = get_db()
        return db.pool
    except RuntimeError:
        return None


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
        """Parse ISO timestamp string to datetime, or None."""
        if not val:
            return None
        try:
            return isoparse(val)
        except (ValueError, TypeError):
            return None

    async with pool.acquire() as conn:
        # Upsert sessions
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

        # Insert individual calls (from research_brain bridge etc.)
        for c in payload.calls:
            try:
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
                    c.cost_usd,
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
    """Daily usage summary over the requested window.

    Returns per-day totals from both api_call_log (programmatic) and
    ai_usage_sessions (interactive), plus overall totals.
    """
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    async with pool.acquire() as conn:
        # Per-day programmatic calls
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

        # Per-day interactive sessions
        # Use COALESCE(started_at, ended_at) because the collector may
        # not populate started_at (ccusage daily aggregates only have ended_at).
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

        # Totals
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

    def _row_to_dict(row):
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, date):
                d[k] = v.isoformat()
            elif hasattr(v, '__float__'):
                d[k] = float(v)
        return d

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
                       subagent_count, model_breakdown
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
            elif hasattr(v, '__float__') and not isinstance(v, (int, float)):
                d[k] = float(v)
        # Parse model_breakdown from JSON string if needed
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
    """Compute rolling burn rates for subscription budget estimation.

    Returns tokens/hour and equivalent-cost/hour over 1h, 6h, and 24h windows.
    """
    pool = _get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not ready")

    now = datetime.now(timezone.utc)
    windows = {"1h": 1, "6h": 6, "24h": 24}
    rates: dict[str, Any] = {}

    async with pool.acquire() as conn:
        for label, hours in windows.items():
            since = now - timedelta(hours=hours)

            # Programmatic calls — only count input + output tokens.
            # Cache tokens describe how input was served, not additional tokens.
            call_row = await conn.fetchrow(
                """SELECT COALESCE(SUM(input_tokens), 0) AS total_in,
                          COALESCE(SUM(output_tokens), 0) AS total_out,
                          COALESCE(SUM(cost_usd), 0) AS cost
                   FROM api_call_log WHERE called_at >= $1""",
                since,
            )

            # Interactive sessions
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
               FROM ai_usage_sessions WHERE started_at >= $1""",
            today_start,
        )

    return {
        "rates": rates,
        "today": {
            "cost_equivalent": round(
                float(today_calls["cost"]) + float(today_sessions["cost"]), 4
            ),
            "programmatic_calls": today_calls["call_count"],
            "interactive_sessions": today_sessions["session_count"],
        },
        "computed_at": now.isoformat(),
    }
