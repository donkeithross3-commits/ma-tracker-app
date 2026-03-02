"""Seeking Alpha RSS monitor — fetch per-ticker analyst articles and transcripts.

SA's public XML feed provides unique content no other source covers:
analyst commentary, earnings call transcripts, and deep-dive research articles.
"""

import asyncio
import logging
from datetime import datetime, timezone
from time import mktime
from typing import Any, Dict, List, Optional

import httpx

try:
    import feedparser
except ImportError:
    feedparser = None  # type: ignore

from app.scheduler.news_monitor import classify_risk_factor, score_relevance

logger = logging.getLogger(__name__)

SA_FEED_URL = "https://seekingalpha.com/api/sa/combined/{ticker}.xml"

# Browser-like User-Agent (SA may block server-side requests)
SA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/xml, text/xml, application/rss+xml, application/atom+xml, */*",
}


def _parse_sa_date(entry) -> Optional[datetime]:
    """Extract published date from a feedparser entry."""
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                return datetime.fromtimestamp(mktime(parsed), tz=timezone.utc)
            except (ValueError, OverflowError, OSError):
                pass
    for attr in ("published", "updated"):
        val = getattr(entry, attr, None)
        if val and isinstance(val, str):
            try:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                pass
    return None


async def _fetch_sa_feed(
    client: httpx.AsyncClient, ticker: str,
) -> list:
    """Fetch and parse SA RSS feed for a single ticker."""
    if feedparser is None:
        return []

    url = SA_FEED_URL.format(ticker=ticker)
    try:
        resp = await client.get(url, timeout=15.0)
        if resp.status_code == 403:
            logger.debug("[seekingalpha] 403 for %s (blocked or no content)", ticker)
            return []
        if resp.status_code == 404:
            logger.debug("[seekingalpha] 404 for %s (no feed)", ticker)
            return []
        resp.raise_for_status()

        content = resp.text
        if not content or len(content) < 50:
            logger.debug("[seekingalpha] Empty/minimal response for %s", ticker)
            return []

        parsed = feedparser.parse(content)
        return parsed.entries or []
    except httpx.TimeoutException:
        logger.warning("[seekingalpha] Timeout for %s", ticker)
        return []
    except httpx.HTTPStatusError as e:
        logger.warning("[seekingalpha] HTTP %d for %s", e.response.status_code, ticker)
        return []
    except Exception as e:
        logger.warning("[seekingalpha] Error for %s: %s", ticker, e)
        return []


async def scan_seekingalpha_news(pool) -> Dict[str, Any]:
    """Main job function: scan SA RSS for all active deal tickers.

    Returns summary dict for job_runs.
    """
    if feedparser is None:
        logger.error("[seekingalpha] feedparser package not installed")
        return {"error": "feedparser not installed"}

    # Get active tickers from latest sheet snapshot
    async with pool.acquire() as conn:
        snap = await conn.fetchrow(
            """SELECT id FROM sheet_snapshots
               WHERE status = 'success'
               ORDER BY ingested_at DESC LIMIT 1"""
        )
        if not snap:
            return {"tickers": 0, "articles": 0}

        rows = await conn.fetch(
            """SELECT DISTINCT ticker FROM sheet_rows
               WHERE snapshot_id = $1 AND ticker IS NOT NULL
                 AND (is_excluded IS NOT TRUE)""",
            snap["id"],
        )

    tickers = [r["ticker"] for r in rows]
    logger.info("[seekingalpha] Starting scan: %d tickers", len(tickers))

    total_raw = 0
    total_keyword_matched = 0
    total_stored = 0
    blocked_count = 0

    async with httpx.AsyncClient(
        headers=SA_HEADERS,
        follow_redirects=True,
    ) as client:
        for ticker in tickers:
            try:
                entries = await _fetch_sa_feed(client, ticker)
                raw_count = len(entries)
                total_raw += raw_count

                if not entries:
                    if raw_count == 0:
                        blocked_count += 1
                    await asyncio.sleep(0.5)
                    continue

                # Convert entries to article format for scoring
                articles = []
                for entry in entries:
                    title = getattr(entry, "title", "") or ""
                    summary = getattr(entry, "summary", "") or ""
                    link = getattr(entry, "link", "") or ""
                    entry_id = getattr(entry, "id", None) or link

                    articles.append({
                        "title": title,
                        "description": summary,
                        "article_url": link,
                        "id": f"sa:{entry_id}" if entry_id else None,
                        "publisher": "Seeking Alpha",
                        "_published_at": _parse_sa_date(entry),
                    })

                # Score articles
                scored = score_relevance(articles)
                keyword_matched = sum(
                    1 for a in scored if a.get("_relevance_score", 0) > 0.1
                )
                total_keyword_matched += keyword_matched

                # Store articles
                async with pool.acquire() as conn:
                    for article in scored:
                        article_id = article.get("id")
                        if not article_id:
                            continue

                        risk_factor = classify_risk_factor(article)
                        relevance = article.get("_relevance_score", 0.5)
                        published_at = article.get("_published_at")

                        try:
                            result = await conn.execute(
                                """INSERT INTO deal_news_articles
                                       (ticker, article_id, title, publisher, published_at,
                                        article_url, summary, relevance_score,
                                        risk_factor_affected, source)
                                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                                   ON CONFLICT (ticker, article_id) DO NOTHING""",
                                ticker,
                                str(article_id)[:100],
                                (article.get("title") or "")[:500],
                                "Seeking Alpha",
                                published_at,
                                (article.get("article_url") or "")[:500],
                                (article.get("description") or "")[:1000],
                                relevance,
                                risk_factor,
                                "seekingalpha",
                            )
                            if result == "INSERT 0 1":
                                total_stored += 1
                        except Exception:
                            logger.error(
                                "[seekingalpha] Failed to store article for %s",
                                ticker,
                                exc_info=True,
                            )

            except Exception:
                logger.error("[seekingalpha] Error scanning %s", ticker, exc_info=True)

            # Be polite — no documented rate limit but don't hammer
            await asyncio.sleep(0.5)

    logger.info(
        "[seekingalpha] Scanned %d tickers: %d raw, %d keyword-matched, %d stored, %d blocked/empty",
        len(tickers), total_raw, total_keyword_matched, total_stored, blocked_count,
    )

    return {
        "tickers": len(tickers),
        "raw_articles": total_raw,
        "keyword_matched": total_keyword_matched,
        "articles_stored": total_stored,
        "blocked_or_empty": blocked_count,
    }
