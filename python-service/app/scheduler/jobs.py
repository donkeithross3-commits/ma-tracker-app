"""
Job registry for the portfolio scheduler.

Each job_* function is an async coroutine that gets registered as a cron
trigger on the AsyncIOScheduler. The `run_job` wrapper handles logging,
timing, and recording results to the job_runs table.
"""

import functools
import json
import logging
import os
import time
import traceback
import uuid
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.scheduler.core import pool as _pool_ref
from app.scheduler import core as _core

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: get the pool (with a clear error if startup hasn't set it yet)
# ---------------------------------------------------------------------------

def _get_pool():
    p = _core.pool
    if p is None:
        raise RuntimeError("Database pool not initialised — scheduler job cannot run")
    return p


# ---------------------------------------------------------------------------
# Job-run logging wrapper
# ---------------------------------------------------------------------------

def run_job(job_id: str, job_name: str):
    """Decorator that wraps an async job function with logging + DB recording."""

    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            pool = _get_pool()
            run_id = uuid.uuid4()
            started_at = datetime.utcnow()
            t0 = time.monotonic()
            logger.info("[scheduler] START %s (run=%s)", job_id, run_id)

            # Insert a 'running' row
            try:
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO job_runs
                            (id, job_id, job_name, status, started_at, triggered_by)
                        VALUES ($1, $2, $3, 'running', $4, 'scheduler')
                        """,
                        run_id, job_id, job_name, started_at,
                    )
            except Exception:
                logger.warning("[scheduler] Could not insert job_runs row", exc_info=True)

            # Execute the actual job
            status = "success"
            result_data = None
            error_text = None
            try:
                result_data = await fn(*args, **kwargs)
            except Exception as exc:
                status = "failure"
                error_text = f"{exc}\n{traceback.format_exc()}"
                logger.error("[scheduler] FAIL %s: %s", job_id, exc, exc_info=True)

            duration_ms = int((time.monotonic() - t0) * 1000)
            finished_at = datetime.utcnow()

            # Update the row with final status
            try:
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        UPDATE job_runs
                           SET status = $2,
                               finished_at = $3,
                               duration_ms = $4,
                               result = $5::jsonb,
                               error = $6
                         WHERE id = $1
                        """,
                        run_id,
                        status,
                        finished_at,
                        duration_ms,
                        json.dumps(result_data, default=str) if result_data else None,
                        error_text,
                    )
            except Exception:
                logger.warning("[scheduler] Could not update job_runs row", exc_info=True)

            logger.info(
                "[scheduler] END %s status=%s duration=%dms",
                job_id, status, duration_ms,
            )
            return result_data

        # Stash metadata so the API layer can inspect registered jobs
        wrapper._job_id = job_id
        wrapper._job_name = job_name
        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Job functions
# ---------------------------------------------------------------------------

@run_job("morning_sheet_ingest", "Morning Google Sheet Ingest")
async def job_morning_sheet_ingest():
    """Ingest the Dashboard tab from Google Sheets (6:30 AM ET weekdays)."""
    from app.portfolio.ingest import ingest_dashboard

    pool = _get_pool()
    result = await ingest_dashboard(pool)
    return result


@run_job("morning_detail_refresh", "Morning Deal Detail Refresh")
async def job_morning_detail_refresh():
    """Re-fetch every deal's detail tab (6:35 AM ET weekdays)."""
    from app.portfolio.ingest import DASHBOARD_GID
    from app.portfolio.detail_parser import ingest_deal_details

    pool = _get_pool()

    # Find the latest successful snapshot and its deals with GIDs
    async with pool.acquire() as conn:
        snap = await conn.fetchrow(
            """
            SELECT id FROM sheet_snapshots
            WHERE tab_gid = $1 AND status = 'success'
            ORDER BY ingested_at DESC LIMIT 1
            """,
            DASHBOARD_GID,
        )
        if snap is None:
            return {"status": "skipped", "reason": "no successful snapshot found"}

        snapshot_id = str(snap["id"])
        rows = await conn.fetch(
            """
            SELECT ticker, deal_tab_gid
            FROM sheet_rows
            WHERE snapshot_id = $1
              AND ticker IS NOT NULL
              AND deal_tab_gid IS NOT NULL
              AND is_excluded = false
            """,
            snap["id"],
        )

    deals = [{"ticker": r["ticker"], "gid": r["deal_tab_gid"]} for r in rows]
    if not deals:
        return {"status": "skipped", "reason": "no deals with GIDs in latest snapshot"}

    result = await ingest_deal_details(pool, snapshot_id, deals)
    return result


@run_job("morning_risk_report", "Morning AI Risk Report")
async def job_morning_risk_report():
    """Placeholder: generate AI-powered risk report at 7:00 AM ET weekdays."""
    logger.info("[morning_risk_report] placeholder — not yet implemented")
    return {"status": "placeholder"}


@run_job("edgar_filing_check", "EDGAR Filing Check")
async def job_edgar_filing_check():
    """Check EDGAR for new M&A-relevant filings (every 5 min, 6AM-8PM ET weekdays)."""
    from app.scheduler.edgar_portfolio import check_portfolio_edgar_filings
    from app.services.messaging import get_messaging_service

    pool = _get_pool()
    messaging = get_messaging_service()
    result = await check_portfolio_edgar_filings(pool, messaging)
    return result


@run_job("spread_monitor_tick", "Spread Monitor Tick")
async def job_spread_monitor_tick():
    """Check deal spreads against live prices (every 1 min, 9:30 AM-4 PM ET weekdays)."""
    from app.scheduler.spread_monitor import get_spread_monitor

    monitor = get_spread_monitor()
    result = await monitor.run()
    return result


@run_job("weekly_cleanup", "Weekly Data Cleanup")
async def job_weekly_cleanup():
    """Placeholder: clean up old data on Sunday 3 AM ET."""
    logger.info("[weekly_cleanup] placeholder — not yet implemented")
    return {"status": "placeholder"}


@run_job("after_hours_summary", "After-Hours Summary")
async def job_after_hours_summary():
    """Collect the day's events and optionally send an end-of-day summary (4:15 PM ET weekdays)."""
    pool = _get_pool()

    # Collect today's activity
    filings = await pool.fetch(
        "SELECT * FROM portfolio_edgar_filings WHERE detected_at::date = CURRENT_DATE"
    )
    spread_alerts = await pool.fetchval("""
        SELECT COUNT(*) FROM job_runs
        WHERE job_id = 'spread_monitor_tick' AND started_at::date = CURRENT_DATE
        AND result::text LIKE '%alerts%'
    """)
    risk_changes = await pool.fetch(
        "SELECT * FROM risk_factor_changes WHERE change_date = CURRENT_DATE"
    )

    summary = {
        "new_filings": len(filings),
        "spread_alerts": spread_alerts,
        "risk_changes": len(risk_changes),
        "quiet_day": not filings and not spread_alerts and not risk_changes,
    }

    if os.environ.get("SEND_EOD_SUMMARY", "false").lower() == "true" and not summary["quiet_day"]:
        from app.services.messaging import get_messaging_service

        messaging = get_messaging_service()
        text = _format_eod_summary(filings, risk_changes)
        for recipient in messaging.whatsapp_recipients:
            await messaging.send_whatsapp(recipient, text)

    return summary


@run_job("options_opportunity_check", "Intraday Options Opportunity Check")
async def job_options_opportunity_check():
    """Compare current IV to morning snapshots; alert on spikes >20% (every 30 min, 10AM-3PM ET)."""
    from app.options.polygon_options import get_polygon_client
    from app.services.messaging import get_messaging_service

    pool = _get_pool()
    client = get_polygon_client()
    if client is None:
        return {"status": "skipped", "reason": "Polygon API key not configured"}

    # Fetch today's morning snapshots
    rows = await pool.fetch(
        """
        SELECT ticker, atm_iv
        FROM deal_options_snapshots
        WHERE snapshot_date = CURRENT_DATE AND atm_iv IS NOT NULL
        """
    )
    if not rows:
        return {"status": "skipped", "reason": "no morning snapshots for today"}

    alerts = []
    checked = 0
    for row in rows:
        ticker = row["ticker"]
        morning_iv = float(row["atm_iv"])
        if morning_iv <= 0:
            continue

        try:
            result = await client.get_current_atm_iv(ticker)
            current_iv = result.get("atm_iv")
            if current_iv is None:
                continue

            checked += 1
            change_pct = (current_iv - morning_iv) / morning_iv * 100
            if abs(change_pct) > 20:
                direction = "SPIKE" if change_pct > 0 else "CRUSH"
                alerts.append({
                    "ticker": ticker,
                    "morning_iv": round(morning_iv, 4),
                    "current_iv": round(current_iv, 4),
                    "change_pct": round(change_pct, 1),
                    "direction": direction,
                })
        except Exception as exc:
            logger.warning("[options_opportunity_check] %s failed: %s", ticker, exc)

    # Send WhatsApp alerts if any spikes detected
    if alerts:
        messaging = get_messaging_service()
        text = _format_iv_alert(alerts)
        for recipient in messaging.whatsapp_recipients:
            await messaging.send_whatsapp(recipient, text)

    return {"checked": checked, "alerts": len(alerts), "details": alerts}


def _format_iv_alert(alerts: list[dict]) -> str:
    """Format IV spike/crush alerts for WhatsApp."""
    now = datetime.now().strftime("%I:%M %p")
    lines = [f"*IV Alert* ({now})", ""]
    for a in alerts:
        emoji = "\u26a0\ufe0f" if a["direction"] == "SPIKE" else "\u2744\ufe0f"
        lines.append(
            f"{emoji} *{a['ticker']}*: {a['direction']} {a['change_pct']:+.1f}% "
            f"({a['morning_iv']:.2%} -> {a['current_iv']:.2%})"
        )
    lines.append("")
    lines.append("\U0001f449 https://dr3-dashboard.com/deals")
    return "\n".join(lines)


def _format_eod_summary(filings: list, risk_changes: list) -> str:
    """Format a concise WhatsApp end-of-day summary."""
    now = datetime.now().strftime("%A, %B %d")
    lines = [f"\U0001f4cb *End-of-Day Summary* — {now}", ""]

    if filings:
        lines.append(f"\U0001f4c4 *{len(filings)} New Filing(s):*")
        for f in filings[:5]:  # Cap at 5 to keep message concise
            ticker = f.get("ticker") or f.get("company_name") or "Unknown"
            ftype = f.get("filing_type") or "Filing"
            lines.append(f"  - {ticker}: {ftype}")
        if len(filings) > 5:
            lines.append(f"  ... and {len(filings) - 5} more")
        lines.append("")

    if risk_changes:
        lines.append(f"\u26a0\ufe0f *{len(risk_changes)} Risk Change(s):*")
        for rc in risk_changes[:5]:
            ticker = rc.get("ticker") or "Unknown"
            factor = rc.get("risk_factor") or rc.get("field") or "risk"
            old_val = rc.get("old_value") or "?"
            new_val = rc.get("new_value") or "?"
            lines.append(f"  - {ticker}: {factor} {old_val} \u2192 {new_val}")
        if len(risk_changes) > 5:
            lines.append(f"  ... and {len(risk_changes) - 5} more")
        lines.append("")

    if not filings and not risk_changes:
        lines.append("\u2705 Quiet day — no notable events.")
        lines.append("")

    lines.append("\U0001f449 https://dr3-dashboard.com/deals")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_default_jobs(scheduler: AsyncIOScheduler) -> None:
    """Register all cron jobs on the scheduler."""

    scheduler.add_job(
        job_morning_sheet_ingest,
        "cron",
        id="morning_sheet_ingest",
        day_of_week="mon-fri",
        hour=6, minute=30,
        replace_existing=True,
    )

    scheduler.add_job(
        job_morning_detail_refresh,
        "cron",
        id="morning_detail_refresh",
        day_of_week="mon-fri",
        hour=6, minute=35,
        replace_existing=True,
    )

    scheduler.add_job(
        job_morning_risk_report,
        "cron",
        id="morning_risk_report",
        day_of_week="mon-fri",
        hour=7, minute=0,
        replace_existing=True,
    )

    scheduler.add_job(
        job_edgar_filing_check,
        "cron",
        id="edgar_filing_check",
        day_of_week="mon-fri",
        hour="6-19",  # 6 AM through 7:xx PM (last fire at 19:55)
        minute="*/5",
        replace_existing=True,
    )

    scheduler.add_job(
        job_spread_monitor_tick,
        "cron",
        id="spread_monitor_tick",
        day_of_week="mon-fri",
        hour="9-15",  # 9:30 AM through 3:xx PM (last fire at 15:59)
        minute="*",
        replace_existing=True,
    )

    scheduler.add_job(
        job_after_hours_summary,
        "cron",
        id="after_hours_summary",
        day_of_week="mon-fri",
        hour=16, minute=15,
        replace_existing=True,
    )

    scheduler.add_job(
        job_options_opportunity_check,
        "cron",
        id="options_opportunity_check",
        day_of_week="mon-fri",
        hour="10-15",
        minute="0,30",
        replace_existing=True,
    )

    scheduler.add_job(
        job_weekly_cleanup,
        "cron",
        id="weekly_cleanup",
        day_of_week="sun",
        hour=3, minute=0,
        replace_existing=True,
    )

    logger.info(
        "[scheduler] Registered %d default jobs",
        len(scheduler.get_jobs()),
    )
