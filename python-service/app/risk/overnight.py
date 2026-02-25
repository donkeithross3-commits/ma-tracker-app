"""Overnight event scanner — detects events since previous market close."""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("US/Eastern")

_pool = None


def set_pool(pool):
    global _pool
    _pool = pool


def _get_pool():
    if _pool is not None:
        return _pool
    raise RuntimeError("Overnight scanner pool not initialized")


def yesterday_4pm_et() -> datetime:
    """Return 4:00 PM ET yesterday (or Friday if today is Monday)."""
    now = datetime.now(ET)
    today = now.date()
    # If Monday, go back to Friday
    if today.weekday() == 0:  # Monday
        target_date = today - timedelta(days=3)
    else:
        target_date = today - timedelta(days=1)
    return datetime(target_date.year, target_date.month, target_date.day, 16, 0, 0, tzinfo=ET)


async def scan_overnight_events(pool, tickers: list[str]) -> list[dict]:
    """Scan for overnight events across all sources.

    Returns a list of event dicts with keys:
        type: "filing" | "halt" | "sheet_change" | "price_gap"
        ticker: str
        detail: str (human-readable description)
        severity: "high" | "medium" | "low"
        timestamp: str (ISO format)
        metadata: dict (source-specific data)
    """
    cutoff = yesterday_4pm_et()
    events = []

    async with pool.acquire() as conn:
        # 1. New EDGAR filings since close (portfolio_edgar_filings table)
        try:
            filings = await conn.fetch(
                """SELECT ticker, filing_type, detected_at, description
                   FROM portfolio_edgar_filings
                   WHERE ticker = ANY($1) AND detected_at > $2
                   ORDER BY detected_at DESC""",
                tickers, cutoff,
            )
            for f in filings:
                filing_type = f["filing_type"] or "Filing"
                headline = f["description"] or "New filing"
                severity = "high" if filing_type in ("8-K", "SC 13D", "SC TO-T", "DEFM14A") else "medium"
                events.append({
                    "type": "filing",
                    "ticker": f["ticker"],
                    "detail": f"{filing_type} filed {_fmt_time(f['detected_at'])}: {headline}",
                    "severity": severity,
                    "timestamp": f["detected_at"].isoformat() if f["detected_at"] else None,
                    "metadata": {"filing_type": filing_type, "headline": headline},
                })
        except Exception as e:
            logger.warning("EDGAR filing scan skipped: %s", e)

        # 2. Trading halts since close (skip if table doesn't exist)
        try:
            halts = await conn.fetch(
                """SELECT ticker, halt_time, resumption_time, halt_code
                   FROM halt_events
                   WHERE ticker = ANY($1) AND halt_time > $2
                   ORDER BY halt_time DESC""",
                tickers, cutoff,
            )
            for h in halts:
                code = h["halt_code"] or ""
                resumed = f", resumed {_fmt_time(h['resumption_time'])}" if h.get("resumption_time") else ""
                events.append({
                    "type": "halt",
                    "ticker": h["ticker"],
                    "detail": f"Trading halt {_fmt_time(h['halt_time'])} (code {code}){resumed}",
                    "severity": "high",
                    "timestamp": h["halt_time"].isoformat() if h["halt_time"] else None,
                    "metadata": {"halt_code": code},
                })
        except Exception as e:
            logger.warning("Halt scan skipped: %s", e)

        # 3. Sheet diffs (PM may have updated grades overnight)
        # changed_fields is JSONB: {"field_name": {"old": "X", "new": "Y"}}
        diffs = await conn.fetch(
            """SELECT ticker, detected_at, changed_fields
               FROM sheet_diffs
               WHERE detected_at >= $1
                 AND changed_fields IS NOT NULL
               ORDER BY detected_at DESC""",
            cutoff,
        )
        risk_fields = {
            "vote_risk", "finance_risk", "legal_risk", "investable",
            "deal_price_raw", "current_price_raw",
            "close_date", "end_date", "countdown_raw",
        }
        for d in diffs:
            changed = d["changed_fields"]
            if not isinstance(changed, dict):
                continue
            for field, vals in changed.items():
                if field not in risk_fields:
                    continue
                old_val = vals.get("old", "N/A") if isinstance(vals, dict) else "N/A"
                new_val = vals.get("new", "N/A") if isinstance(vals, dict) else "N/A"
                severity = "high" if field in ("vote_risk", "finance_risk", "legal_risk", "investable") else "medium"
                events.append({
                    "type": "sheet_change",
                    "ticker": d["ticker"] or "PORTFOLIO",
                    "detail": f"Sheet updated: {field} changed from '{old_val}' to '{new_val}'",
                    "severity": severity,
                    "timestamp": d["created_at"].isoformat() if d["created_at"] else None,
                    "metadata": {"field": field, "old": old_val, "new": new_val},
                })

        # 4. Pre-market price gaps (compare latest vs previous snapshot prices)
        price_gaps = await conn.fetch(
            """WITH latest AS (
                SELECT ticker, current_price, deal_price
                FROM sheet_rows
                WHERE snapshot_id = (
                    SELECT id FROM sheet_snapshots
                    ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1
                )
                AND ticker = ANY($1)
            ),
            previous AS (
                SELECT ticker, current_price
                FROM sheet_rows
                WHERE snapshot_id = (
                    SELECT id FROM sheet_snapshots
                    WHERE id != (SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1)
                    ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1
                )
                AND ticker = ANY($1)
            )
            SELECT l.ticker, l.current_price AS new_price, p.current_price AS old_price,
                   l.deal_price
            FROM latest l
            JOIN previous p ON l.ticker = p.ticker
            WHERE p.current_price > 0
              AND ABS(l.current_price - p.current_price) / p.current_price > 0.015
            """,
            tickers,
        )
        for g in price_gaps:
            old_p = float(g["old_price"])
            new_p = float(g["new_price"])
            gap_pct = (new_p - old_p) / old_p * 100
            severity = "high" if abs(gap_pct) > 3.0 else "medium"
            events.append({
                "type": "price_gap",
                "ticker": g["ticker"],
                "detail": f"Price ${new_p:.2f} vs prior ${old_p:.2f} ({gap_pct:+.1f}% gap)",
                "severity": severity,
                "timestamp": datetime.now(ET).isoformat(),
                "metadata": {"old_price": old_p, "new_price": new_p, "gap_pct": round(gap_pct, 2)},
            })

    logger.info("Overnight scan found %d events for %d tickers", len(events), len(tickers))
    return events


def _fmt_time(dt) -> str:
    """Format a datetime for display."""
    if dt is None:
        return "N/A"
    if hasattr(dt, "strftime"):
        return dt.strftime("%-I:%M %p")
    return str(dt)
