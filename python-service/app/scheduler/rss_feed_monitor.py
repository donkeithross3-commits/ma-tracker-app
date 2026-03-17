"""RSS/ATOM feed monitor — scan firehose feeds for M&A-relevant articles.

Monitors 4 topic-filtered RSS/ATOM feeds + FTC HSR JSON API. These are NOT
per-ticker feeds — they're firehose feeds matched against our active deal tickers.

Sources:
  - DOJ Antitrust press releases (RSS)
  - FTC HSR Early Termination notices (JSON API)
  - PR Newswire M&A category (RSS)
  - GlobeNewswire M&A category (ATOM)
  - Business Wire (RSS)
"""

import asyncio
import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

try:
    import feedparser
except ImportError:
    feedparser = None  # type: ignore

from app.scheduler.news_monitor import classify_risk_factor, score_relevance

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Feed configuration
# ---------------------------------------------------------------------------

RSS_FEEDS: List[Dict[str, str]] = [
    {
        "name": "doj",
        "url": "https://www.justice.gov/news/rss?type[0]=press_release&field_component=376",
        "format": "rss",
        "publisher": "DOJ Antitrust Division",
    },
    {
        "name": "prnewswire",
        "url": "https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss",
        "format": "rss",
        "publisher": "PR Newswire",
    },
    {
        "name": "globenewswire",
        "url": "https://www.globenewswire.com/AtomFeed/subjectcode/27-Mergers%20And%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20And%20Acquisitions",
        "format": "atom",
        "publisher": "GlobeNewswire",
    },
    {
        "name": "businesswire",
        "url": "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpRWQ==",
        "format": "rss",
        "publisher": "Business Wire",
    },
]

FTC_HSR_URL = "https://api.ftc.gov/v0/hsr-early-termination-notices"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_active_deals(pool) -> Dict[str, str]:
    """Get active ticker -> company name mapping from latest sheet snapshot."""
    async with pool.acquire() as conn:
        snap = await conn.fetchrow(
            """SELECT id FROM sheet_snapshots
               WHERE status = 'success'
               ORDER BY ingested_at DESC LIMIT 1"""
        )
        if not snap:
            return {}
        rows = await conn.fetch(
            """SELECT sr.ticker, COALESCE(sd.target, sr.ticker) AS company_name
               FROM sheet_rows sr
               LEFT JOIN sheet_deal_details sd ON sr.ticker = sd.ticker
               WHERE sr.snapshot_id = $1 AND sr.ticker IS NOT NULL
                 AND (sr.is_excluded IS NOT TRUE)""",
            snap["id"],
        )
    return {r["ticker"]: r["company_name"] for r in rows}


def _match_deals(text: str, deals: Dict[str, str]) -> List[str]:
    """Match text against ticker symbols and company names.

    Returns list of matching tickers.
    """
    if not text:
        return []
    text_lower = text.lower()
    text_upper = text.upper()
    matched = []
    for ticker, company in deals.items():
        # Word-boundary match for ticker symbol
        if re.search(rf"\b{re.escape(ticker)}\b", text_upper):
            matched.append(ticker)
        # Case-insensitive company name substring (skip very short names)
        elif company and len(company) > 3 and company.lower() in text_lower:
            matched.append(ticker)
    return matched


def _make_article_id(source: str, entry) -> str:
    """Generate a unique article_id for deduplication."""
    entry_id = None
    if hasattr(entry, "id"):
        entry_id = entry.id
    elif hasattr(entry, "link"):
        entry_id = entry.link
    elif isinstance(entry, dict):
        entry_id = entry.get("id") or entry.get("link")

    if entry_id:
        return f"{source}:{entry_id}"[:100]

    # Fallback: hash of title + date
    title = getattr(entry, "title", "") if not isinstance(entry, dict) else entry.get("title", "")
    date_str = str(getattr(entry, "published", "")) if not isinstance(entry, dict) else str(entry.get("published", ""))
    h = hashlib.md5((title + date_str).encode()).hexdigest()[:16]
    return f"{source}:{h}"


def _parse_date(entry) -> Optional[datetime]:
    """Extract published date from a feedparser entry."""
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                from time import mktime
                return datetime.fromtimestamp(mktime(parsed), tz=timezone.utc)
            except (ValueError, OverflowError, OSError):
                pass
    # Try ISO string
    for attr in ("published", "updated"):
        val = getattr(entry, attr, None)
        if val and isinstance(val, str):
            try:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                pass
    return None


async def _store_article(
    conn, ticker: str, article_id: str, title: str, publisher: str,
    published_at: Optional[datetime], url: str, summary: str,
    relevance: float, risk_factor: Optional[str], source: str,
) -> bool:
    """Store a single article. Returns True if newly inserted."""
    try:
        result = await conn.execute(
            """INSERT INTO deal_news_articles
                   (ticker, article_id, title, publisher, published_at,
                    article_url, summary, relevance_score,
                    risk_factor_affected, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (ticker, article_id) DO NOTHING""",
            ticker,
            article_id[:100],
            (title or "")[:500],
            (publisher or "")[:100],
            published_at,
            (url or "")[:500],
            (summary or "")[:1000],
            relevance,
            risk_factor,
            source,
        )
        return result == "INSERT 0 1"
    except Exception:
        logger.error("Failed to store RSS article for %s", ticker, exc_info=True)
        return False


# ---------------------------------------------------------------------------
# RSS/ATOM feed processing
# ---------------------------------------------------------------------------

async def _fetch_and_parse_feed(client: httpx.AsyncClient, feed: Dict[str, str]) -> list:
    """Fetch an RSS/ATOM feed and return parsed entries."""
    if feedparser is None:
        logger.warning("[rss_feed] feedparser not installed, skipping %s", feed["name"])
        return []

    try:
        resp = await client.get(feed["url"], timeout=15.0)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        entries = parsed.entries or []
        logger.debug("[rss_feed] %s: %d entries", feed["name"], len(entries))
        return entries
    except httpx.TimeoutException:
        logger.warning("[rss_feed] Timeout fetching %s", feed["name"])
        return []
    except httpx.HTTPStatusError as e:
        logger.warning("[rss_feed] HTTP %d from %s", e.response.status_code, feed["name"])
        return []
    except Exception as e:
        logger.warning("[rss_feed] Error fetching %s: %s", feed["name"], e)
        return []


async def _process_rss_feed(
    pool, client: httpx.AsyncClient, feed: Dict[str, str],
    deals: Dict[str, str],
) -> Dict[str, int]:
    """Process a single RSS/ATOM feed and store matching articles."""
    entries = await _fetch_and_parse_feed(client, feed)
    source_name = feed["name"]
    publisher = feed["publisher"]
    stats = {"entries": len(entries), "matched": 0, "stored": 0}

    async with pool.acquire() as conn:
        for entry in entries:
            title = getattr(entry, "title", "") or ""
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
            link = getattr(entry, "link", "") or ""
            text = f"{title} {summary}"

            matching_tickers = _match_deals(text, deals)
            if not matching_tickers:
                continue

            stats["matched"] += 1
            article_id = _make_article_id(source_name, entry)
            published_at = _parse_date(entry)

            # Score relevance using the shared scoring function
            fake_article = {"title": title, "description": summary}
            scored = score_relevance([fake_article])
            relevance = scored[0].get("_relevance_score", 0.5) if scored else 0.5
            risk_factor = classify_risk_factor(fake_article)

            for ticker in matching_tickers:
                stored = await _store_article(
                    conn, ticker, article_id, title, publisher,
                    published_at, link, summary, relevance, risk_factor, source_name,
                )
                if stored:
                    stats["stored"] += 1

    return stats


# ---------------------------------------------------------------------------
# FTC HSR Early Termination (JSON API)
# ---------------------------------------------------------------------------

async def _process_ftc_hsr(
    pool, client: httpx.AsyncClient, deals: Dict[str, str],
) -> Dict[str, int]:
    """Fetch and process FTC HSR Early Termination notices."""
    api_key = os.environ.get("FTC_API_KEY", "DEMO_KEY")
    stats = {"entries": 0, "matched": 0, "stored": 0}

    try:
        resp = await client.get(
            FTC_HSR_URL,
            params={"api_key": api_key, "limit": 50, "sort": "-created"},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.TimeoutException:
        logger.warning("[rss_feed] Timeout fetching FTC HSR")
        return stats
    except httpx.HTTPStatusError as e:
        logger.warning("[rss_feed] HTTP %d from FTC HSR", e.response.status_code)
        return stats
    except Exception as e:
        logger.warning("[rss_feed] Error fetching FTC HSR: %s", e)
        return stats

    results = data.get("results", [])
    if not results and isinstance(data, list):
        results = data

    stats["entries"] = len(results)

    async with pool.acquire() as conn:
        for item in results:
            # FTC HSR entries have company names
            attrs = item.get("attributes", item)
            company1 = attrs.get("company1", "") or ""
            company2 = attrs.get("company2", "") or ""
            created = attrs.get("created", "") or ""
            text = f"{company1} {company2}"

            matching_tickers = _match_deals(text, deals)
            if not matching_tickers:
                continue

            stats["matched"] += 1
            item_id = attrs.get("id") or attrs.get("transaction_number") or hashlib.md5(
                f"{company1}{company2}{created}".encode()
            ).hexdigest()[:16]
            article_id = f"ftc_hsr:{item_id}"

            title = f"HSR Early Termination: {company1} / {company2}"
            summary = f"FTC granted early termination of the HSR waiting period for a transaction involving {company1} and {company2}."
            published_at = None
            if created:
                try:
                    published_at = datetime.fromisoformat(created.replace("Z", "+00:00"))
                except ValueError:
                    pass

            for ticker in matching_tickers:
                stored = await _store_article(
                    conn, ticker, article_id, title, "FTC HSR",
                    published_at, "https://www.ftc.gov/legal-library/browse/hsr-early-termination-notices",
                    summary, 0.8, "regulatory", "ftc_hsr",
                )
                if stored:
                    stats["stored"] += 1

    return stats


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def scan_rss_feeds(pool) -> Dict[str, Any]:
    """Fetch all RSS/ATOM feeds + FTC HSR, match against active deal tickers.

    Returns summary dict for job_runs.
    """
    if feedparser is None:
        logger.error("[rss_feed] feedparser package not installed — pip install feedparser")
        return {"error": "feedparser not installed"}

    deals = await _get_active_deals(pool)
    if not deals:
        logger.info("[rss_feed] No active deals found, skipping scan")
        return {"skipped": True, "reason": "no_active_deals"}

    logger.info("[rss_feed] Starting scan: %d active deals, %d RSS feeds + FTC HSR",
                len(deals), len(RSS_FEEDS))

    results = {}
    total_entries = 0
    total_matched = 0
    total_stored = 0

    async with httpx.AsyncClient(
        headers={"User-Agent": "DR3-DealIntel/1.0 (news monitor)"},
        follow_redirects=True,
    ) as client:
        # Process RSS/ATOM feeds
        for feed in RSS_FEEDS:
            try:
                feed_stats = await _process_rss_feed(pool, client, feed, deals)
                results[feed["name"]] = feed_stats
                total_entries += feed_stats["entries"]
                total_matched += feed_stats["matched"]
                total_stored += feed_stats["stored"]
            except Exception:
                logger.error("[rss_feed] Error processing %s", feed["name"], exc_info=True)
                results[feed["name"]] = {"error": True}

        # Process FTC HSR
        try:
            ftc_stats = await _process_ftc_hsr(pool, client, deals)
            results["ftc_hsr"] = ftc_stats
            total_entries += ftc_stats["entries"]
            total_matched += ftc_stats["matched"]
            total_stored += ftc_stats["stored"]
        except Exception:
            logger.error("[rss_feed] Error processing FTC HSR", exc_info=True)
            results["ftc_hsr"] = {"error": True}

    logger.info(
        "[rss_feed] Scan complete: %d entries, %d matched, %d stored",
        total_entries, total_matched, total_stored,
    )

    return {
        "active_deals": len(deals),
        "total_entries": total_entries,
        "total_matched": total_matched,
        "total_stored": total_stored,
        "feeds": results,
    }
