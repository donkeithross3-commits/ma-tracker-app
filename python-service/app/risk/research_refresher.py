"""Research report refresher — regenerates stale AI research for active deals.

The initial deal_research report is generated at deal approval and never updated.
This module detects when material context has changed since the last research report
and triggers a lightweight refresh that adds an "update" section rather than
regenerating from scratch.

Used by the morning pipeline to keep research context current.
"""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional

from anthropic import Anthropic

logger = logging.getLogger(__name__)

# Staleness threshold: if research is older than this many days, flag for refresh
STALE_DAYS = 14

RESEARCH_REFRESH_PROMPT = """You are an M&A research analyst providing an incremental update
to a previously generated research report on a pending merger.

## ORIGINAL RESEARCH (generated {research_date})
{original_research}

## NEW DEVELOPMENTS SINCE ORIGINAL RESEARCH

### New SEC Filings
{new_filings}

### Filing Impact Assessments
{filing_impacts}

### Recent News
{recent_news}

### Sheet Changes
{sheet_changes}

Your task: Write a concise UPDATE ADDENDUM (300-500 words) that:
1. Highlights what has materially changed since the original research
2. Notes any new risk factors or resolved risks
3. Updates the deal timeline if new information is available
4. Flags any developments that contradict the original research

Focus on NEW information only — do not repeat what the original research already covers.
If nothing material has changed, say so in 1-2 sentences.

Return JSON:
{{
    "has_material_changes": true/false,
    "update_summary": "1-2 sentence summary of changes",
    "update_text": "full addendum text",
    "risk_factors_changed": ["list of affected risk factors: vote/financing/legal/regulatory/mac/timing"],
    "staleness_resolved": true/false
}}"""


def _extract_research_sections(content: str, max_chars: int = 2000) -> str:
    """Extract the most informative sections from a research report.

    Instead of dumb truncation at 2000 chars, this picks the highest-signal
    sections: deal terms, risk assessment, and recommendation.
    """
    if not content or len(content) <= max_chars:
        return content or ""

    # Priority sections to look for (in order)
    priority_markers = [
        ("## Deal Terms", "## "),
        ("## Risk Assessment", "## "),
        ("## Key Risks", "## "),
        ("## Recommendation", "## "),
        ("## Deal Structure", "## "),
        ("## Regulatory", "## "),
        ("## Timeline", "## "),
    ]

    extracted_parts = []
    budget = max_chars
    content_lower = content.lower()

    for marker, end_marker in priority_markers:
        if budget <= 200:
            break

        idx = content_lower.find(marker.lower())
        if idx == -1:
            continue

        # Find the next section header after this one
        next_section = len(content)
        search_start = idx + len(marker)
        for next_marker, _ in priority_markers:
            next_idx = content_lower.find(next_marker.lower(), search_start)
            if next_idx != -1 and next_idx < next_section:
                next_section = next_idx

        section_text = content[idx:next_section].strip()
        if len(section_text) > budget:
            section_text = section_text[:budget] + "..."

        extracted_parts.append(section_text)
        budget -= len(section_text) + 2  # +2 for newlines

    if extracted_parts:
        return "\n\n".join(extracted_parts)

    # Fallback: first max_chars
    return content[:max_chars] + "... [truncated]"


async def check_research_staleness(pool, ticker: str) -> Optional[Dict[str, Any]]:
    """Check if a deal's research report is stale and needs refresh.

    Returns dict with staleness info, or None if research is fresh.
    """
    async with pool.acquire() as conn:
        research = await conn.fetchrow(
            "SELECT created_at, content FROM deal_research WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
            ticker,
        )
        if not research:
            return {"stale": True, "reason": "no_research", "age_days": None}

        age_days = (datetime.utcnow() - research["created_at"].replace(tzinfo=None)).days

        # Check for new filings since research was created
        new_filing_count = await conn.fetchval(
            """SELECT COUNT(*) FROM portfolio_edgar_filings
               WHERE ticker = $1 AND detected_at > $2""",
            ticker,
            research["created_at"],
        )

        # Check for filing impacts since research
        impact_count = 0
        try:
            impact_count = await conn.fetchval(
                """SELECT COUNT(*) FROM portfolio_filing_impacts
                   WHERE ticker = $1 AND assessed_at > $2 AND impact_level != 'none'""",
                ticker,
                research["created_at"],
            ) or 0
        except Exception:
            pass  # Table may not exist yet

        if age_days >= STALE_DAYS or new_filing_count > 2 or impact_count > 0:
            return {
                "stale": True,
                "reason": "age" if age_days >= STALE_DAYS else "new_developments",
                "age_days": age_days,
                "new_filings": new_filing_count,
                "filing_impacts": impact_count,
            }

    return None


async def refresh_research(pool, ticker: str) -> Optional[Dict[str, Any]]:
    """Generate a research update addendum for a stale deal.

    Returns the update dict or None on failure.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    async with pool.acquire() as conn:
        # Get original research
        research = await conn.fetchrow(
            "SELECT created_at, content FROM deal_research WHERE ticker = $1 ORDER BY created_at DESC LIMIT 1",
            ticker,
        )
        if not research:
            return None

        research_date = research["created_at"].strftime("%Y-%m-%d")
        original = _extract_research_sections(
            research.get("content") or research.get("research_text") or "",
            max_chars=3000,
        )

        # New filings since research
        filings = await conn.fetch(
            """SELECT filing_type, filing_date, description
               FROM portfolio_edgar_filings
               WHERE ticker = $1 AND detected_at > $2
               ORDER BY detected_at DESC LIMIT 10""",
            ticker,
            research["created_at"],
        )
        filings_text = "\n".join(
            f"- [{f['filing_type']}] {f['filing_date']}: {f['description']}"
            for f in filings
        ) or "No new filings."

        # Filing impact summaries
        impacts_text = "No impact assessments."
        try:
            impacts = await conn.fetch(
                """SELECT filing_type, impact_level, summary, risk_factor_affected
                   FROM portfolio_filing_impacts
                   WHERE ticker = $1 AND assessed_at > $2 AND impact_level != 'none'
                   ORDER BY assessed_at DESC LIMIT 5""",
                ticker,
                research["created_at"],
            )
            if impacts:
                impacts_text = "\n".join(
                    f"- [{i['filing_type']}] {i['impact_level'].upper()}: {i['summary']} (affects: {i['risk_factor_affected']})"
                    for i in impacts
                )
        except Exception:
            pass

        # Recent news
        news_text = "No recent news articles."
        try:
            news = await conn.fetch(
                """SELECT title, publisher, published_at, risk_factor_affected
                   FROM deal_news_articles
                   WHERE ticker = $1 AND published_at > $2
                   ORDER BY published_at DESC LIMIT 5""",
                ticker,
                research["created_at"],
            )
            if news:
                news_text = "\n".join(
                    f"- [{n.get('published_at', 'N/A')}] {n['title']} ({n.get('publisher', '')}) — affects: {n.get('risk_factor_affected', 'N/A')}"
                    for n in news
                )
        except Exception:
            pass

        # Sheet changes since research
        diffs = await conn.fetch(
            """SELECT field_name, old_value, new_value, detected_at
               FROM sheet_diffs
               WHERE ticker = $1 AND detected_at > $2
               ORDER BY detected_at DESC LIMIT 10""",
            ticker,
            research["created_at"],
        )
        changes_text = "\n".join(
            f"- {d['field_name']}: '{d['old_value']}' → '{d['new_value']}' ({d['detected_at'].strftime('%Y-%m-%d')})"
            for d in diffs
        ) or "No sheet changes."

    prompt = RESEARCH_REFRESH_PROMPT.format(
        research_date=research_date,
        original_research=original,
        new_filings=filings_text,
        filing_impacts=impacts_text,
        recent_news=news_text,
        sheet_changes=changes_text,
    )

    try:
        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text
        if raw.strip().startswith("```"):
            lines = raw.strip().split("\n")
            raw = "\n".join(lines[1:-1]) if len(lines) > 2 else raw

        result = json.loads(raw)

        # Store the addendum in deal_research as a new row
        if result.get("has_material_changes"):
            addendum_content = (
                f"## Research Update ({datetime.utcnow().strftime('%Y-%m-%d')})\n\n"
                f"{result.get('update_text', '')}\n\n"
                f"---\n"
                f"Risk factors changed: {', '.join(result.get('risk_factors_changed', []))}\n"
            )
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO deal_research (ticker, content, research_type, created_at)
                       VALUES ($1, $2, 'update', NOW())
                       ON CONFLICT DO NOTHING""",
                    ticker,
                    addendum_content,
                )

        logger.info(
            "[research_refresher] %s: material_changes=%s, summary=%s",
            ticker,
            result.get("has_material_changes"),
            result.get("update_summary", "")[:100],
        )
        return result

    except json.JSONDecodeError:
        logger.error("[research_refresher] Failed to parse AI response for %s", ticker, exc_info=True)
        return None
    except Exception:
        logger.error("[research_refresher] Refresh failed for %s", ticker, exc_info=True)
        return None
