"""AI-powered SEC filing impact assessment for active M&A deals."""

import json
import logging
import os
from typing import Any, Dict, Optional

import httpx
from anthropic import Anthropic

logger = logging.getLogger(__name__)

FILING_IMPACT_PROMPT = """You are an M&A analyst reviewing a new SEC filing for a pending deal.

Deal: {ticker} — {acquiror} acquiring at ${deal_price}
Current spread: {spread}% | Close expected: {close_date}

Filing type: {filing_type}
Filed: {filed_at}

Filing content (excerpt, first 50,000 chars):
{content}

Assess this filing's impact on deal completion risk:

Return JSON:
{{
    "impact": "none|low|moderate|high|critical",
    "summary": "one sentence on what the filing contains",
    "action_required": true/false,
    "risk_factor_affected": "vote|financing|legal|regulatory|mac|timing|none",
    "grade_change_suggested": "Low→Medium" or null,
    "key_detail": "the single most important fact from this filing"
}}"""


async def assess_filing_impact(
    pool, filing: Dict[str, Any], ticker: str
) -> Optional[Dict[str, Any]]:
    """AI-assess a new filing's impact on deal risk.

    Returns a dict with impact assessment fields, or None on any failure.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("[filing_impact] No ANTHROPIC_API_KEY set, skipping assessment")
        return None

    try:
        deal = await _fetch_deal_context(pool, ticker)
        if not deal:
            logger.warning("[filing_impact] No deal context found for %s", ticker)
            return None

        content = await _fetch_filing_content(filing.get("filing_url", ""))
        if not content:
            logger.warning("[filing_impact] Could not fetch filing content for %s", ticker)
            return None

        deal_price = deal.get("deal_price") or deal.get("total_price_per_share") or "Unknown"
        current_price = deal.get("current_price")
        if deal_price != "Unknown" and current_price:
            spread = round((float(deal_price) - float(current_price)) / float(current_price) * 100, 2)
        else:
            spread = "N/A"

        prompt = FILING_IMPACT_PROMPT.format(
            ticker=ticker,
            acquiror=deal.get("acquiror") or "Unknown",
            deal_price=deal_price,
            spread=spread,
            close_date=deal.get("expected_close_date") or "Unknown",
            filing_type=filing.get("filing_type", "Unknown"),
            filed_at=filing.get("filing_date", "Unknown"),
            content=content[:50000],
        )

        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text
        # Strip markdown fences if present
        if raw.strip().startswith("```"):
            lines = raw.strip().split("\n")
            raw = "\n".join(lines[1:-1]) if len(lines) > 2 else raw

        result = json.loads(raw)
        logger.info(
            "[filing_impact] %s %s -> impact=%s action_required=%s",
            ticker,
            filing.get("filing_type"),
            result.get("impact"),
            result.get("action_required"),
        )
        return result

    except json.JSONDecodeError:
        logger.error("[filing_impact] Failed to parse AI response as JSON for %s", ticker, exc_info=True)
        return None
    except Exception:
        logger.error("[filing_impact] Assessment failed for %s", ticker, exc_info=True)
        return None


async def _fetch_deal_context(pool, ticker: str) -> Optional[Dict[str, Any]]:
    """Load deal context from the database for the given ticker."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT r.ticker, r.acquiror, r.deal_price, r.current_price,
                   d.total_price_per_share, d.expected_close_date
            FROM sheet_rows r
            LEFT JOIN sheet_deal_details d ON d.ticker = r.ticker
            WHERE r.ticker = $1
            ORDER BY r.snapshot_id DESC LIMIT 1
            """,
            ticker,
        )
        return dict(row) if row else None


async def _fetch_filing_content(url: str) -> Optional[str]:
    """Fetch the text content of an SEC filing from the given URL."""
    if not url:
        return None

    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            headers={
                "User-Agent": "M&A Tracker alerts@ma-tracker.com",
                "Accept": "text/html,application/xhtml+xml,text/plain",
            },
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text
    except Exception:
        logger.error("[filing_impact] Failed to fetch filing content from %s", url, exc_info=True)
        return None
