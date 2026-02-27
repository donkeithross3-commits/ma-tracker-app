"""Auto-seed milestones from deal details.

Reads sheet_deal_details for a ticker and creates canonical_deal_milestones
rows from known date fields and deal terms.  Idempotent: uses ON CONFLICT
DO NOTHING so duplicate calls are harmless.
"""

import logging
import re
from datetime import date
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _parse_date(val) -> Optional[date]:
    """Safely parse a date from str, date, datetime, or None."""
    if val is None:
        return None
    if isinstance(val, date):
        return val
    if hasattr(val, "date"):
        # datetime -> date
        return val.date()
    if isinstance(val, str):
        val = val.strip()
        if not val or val.lower() in ("n/a", "none", "tbd", "unknown", ""):
            return None
        # Try ISO format first
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
            try:
                from datetime import datetime as dt
                return dt.strptime(val, fmt).date()
            except ValueError:
                continue
    return None


async def seed_milestones_from_deal(pool, ticker: str) -> Dict[str, Any]:
    """Read deal details and auto-create milestones from known fields.

    Returns summary of what was created.
    """
    async with pool.acquire() as conn:
        details = await conn.fetchrow(
            "SELECT * FROM sheet_deal_details WHERE ticker = $1 ORDER BY fetched_at DESC LIMIT 1",
            ticker,
        )
    if not details:
        return {"ticker": ticker, "seeded": 0, "reason": "no_deal_details"}

    # Ensure canonical_deals row exists (FK target for milestones)
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM canonical_deals WHERE ticker = $1", ticker
        )
        if not exists:
            try:
                await conn.execute(
                    """INSERT INTO canonical_deals (ticker, target_name, acquiror_name, status)
                       VALUES ($1, $2, $3, 'active')
                       ON CONFLICT (ticker) DO NOTHING""",
                    ticker,
                    details.get("target"),
                    details.get("acquiror"),
                )
            except Exception:
                logger.warning(
                    "[milestone_seeder] Could not ensure canonical_deals row for %s",
                    ticker, exc_info=True,
                )
                return {"ticker": ticker, "seeded": 0, "reason": "no_canonical_deal"}

    milestones: List[Dict[str, Any]] = []

    # 1. Announcement date -> completed milestone
    announce = _parse_date(details.get("announce_date"))
    if announce:
        milestones.append({
            "type": "announcement",
            "milestone_date": announce,
            "expected_date": announce,
            "status": "completed",
            "source": "sheet_deal_details",
            "notes": "Deal announcement date",
            "risk_factor": None,
        })

    # 2. Expected close date -> pending closing milestone
    close = _parse_date(details.get("expected_close_date"))
    if close:
        milestones.append({
            "type": "closing",
            "milestone_date": None,
            "expected_date": close,
            "status": "pending",
            "source": "sheet_deal_details",
            "notes": "Expected closing date from deal sheet",
            "risk_factor": "timing",
        })

    # 3. Outside date -> pending milestone
    outside = _parse_date(details.get("outside_date"))
    if outside:
        milestones.append({
            "type": "outside_date",
            "milestone_date": None,
            "expected_date": outside,
            "status": "pending",
            "source": "sheet_deal_details",
            "notes": "Outside date (deal termination deadline)",
            "risk_factor": "timing",
        })

    # 4. Shareholder vote
    vote_field = str(details.get("shareholder_vote") or "").strip().lower()
    if vote_field and vote_field not in ("no", "n/a", "none", "not required", ""):
        milestones.append({
            "type": "shareholder_vote",
            "milestone_date": None,
            "expected_date": None,
            "status": "pending",
            "source": "sheet_deal_details",
            "notes": f"Shareholder vote required: {details.get('shareholder_vote')}",
            "risk_factor": "vote",
        })

    # 5. Regulatory approvals — parse for CFIUS, HSR, EC
    reg_field = str(details.get("regulatory_approvals") or "").lower()
    if reg_field:
        if "cfius" in reg_field:
            milestones.append({
                "type": "cfius_filing",
                "milestone_date": None,
                "expected_date": None,
                "status": "pending",
                "source": "sheet_deal_details",
                "notes": f"CFIUS review (from: {details.get('regulatory_approvals')})",
                "risk_factor": "regulatory",
            })
        if "hsr" in reg_field or "hart-scott" in reg_field:
            milestones.append({
                "type": "hsr_filing",
                "milestone_date": None,
                "expected_date": None,
                "status": "pending",
                "source": "sheet_deal_details",
                "notes": f"HSR filing (from: {details.get('regulatory_approvals')})",
                "risk_factor": "regulatory",
            })
        if re.search(r"\bec\b|european commission", reg_field):
            milestones.append({
                "type": "ec_approval",
                "milestone_date": None,
                "expected_date": None,
                "status": "pending",
                "source": "sheet_deal_details",
                "notes": f"EC approval (from: {details.get('regulatory_approvals')})",
                "risk_factor": "regulatory",
            })

    # Insert milestones idempotently
    # Unique constraint: (ticker, milestone_type, COALESCE(milestone_date, '1970-01-01'))
    created = 0
    async with pool.acquire() as conn:
        for m in milestones:
            try:
                result = await conn.execute(
                    """INSERT INTO canonical_deal_milestones
                           (ticker, milestone_type, milestone_date, expected_date,
                            status, source, notes, risk_factor_affected)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                       ON CONFLICT (ticker, milestone_type, COALESCE(milestone_date, '1970-01-01'::date))
                       DO NOTHING""",
                    ticker,
                    m["type"],
                    m["milestone_date"],
                    m["expected_date"],
                    m["status"],
                    m["source"],
                    m["notes"],
                    m["risk_factor"],
                )
                if result == "INSERT 0 1":
                    created += 1
            except Exception:
                logger.error(
                    "[milestone_seeder] Failed to insert %s milestone for %s",
                    m["type"], ticker, exc_info=True,
                )

    if created:
        logger.info("[milestone_seeder] Seeded %d milestones for %s", created, ticker)

    return {"ticker": ticker, "seeded": created, "attempted": len(milestones)}


async def seed_milestones_for_all(pool, tickers: list[str]) -> Dict[str, Any]:
    """Seed milestones for a list of tickers. Called in Phase 0 of morning run."""
    total_seeded = 0
    total_attempted = 0
    for ticker in tickers:
        try:
            result = await seed_milestones_from_deal(pool, ticker)
            total_seeded += result.get("seeded", 0)
            total_attempted += result.get("attempted", 0)
        except Exception:
            logger.error(
                "[milestone_seeder] Failed to seed milestones for %s",
                ticker, exc_info=True,
            )
    logger.info(
        "[milestone_seeder] Phase 0 complete: %d seeded across %d tickers (%d attempted)",
        total_seeded, len(tickers), total_attempted,
    )
    return {"tickers": len(tickers), "seeded": total_seeded, "attempted": total_attempted}
