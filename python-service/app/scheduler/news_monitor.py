"""News monitor — fetch M&A-relevant news from Polygon for tracked deal tickers.

Used by the morning pipeline to include recent news context in AI risk assessments.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

POLYGON_NEWS_URL = "https://api.polygon.io/v2/reference/news"

# Keywords that indicate M&A relevance in article title or description
MA_NEWS_KEYWORDS = {
    "merger", "acquisition", "acquire", "acquirer", "takeover", "buyout",
    "tender offer", "deal", "transaction",
    "regulatory", "antitrust", "ftc", "doj", "cfius",
    "shareholder", "vote", "proxy", "approval",
    "closing", "close", "completion",
    "termination", "break", "walk away",
    "financing", "debt", "commitment",
    "injunction", "lawsuit", "litigation", "class action",
    "hsr", "second request", "phase ii",
    "go-shop", "topping bid", "superior proposal", "overbid",
    "material adverse", "mac",
}


async def fetch_deal_news(
    ticker: str, api_key: str, days: int = 1, limit: int = 20
) -> List[Dict[str, Any]]:
    """Fetch recent news for a ticker from Polygon News API.

    Returns raw article dicts. Graceful on any failure.
    """
    if not api_key:
        return []

    published_after = (datetime.utcnow() - timedelta(days=days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    params = {
        "ticker": ticker,
        "published_utc.gte": published_after,
        "limit": limit,
        "sort": "published_utc",
        "order": "desc",
        "apiKey": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(POLYGON_NEWS_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            articles = data.get("results", [])
            logger.debug("Fetched %d articles for %s", len(articles), ticker)
            return articles
    except httpx.TimeoutException:
        logger.warning("Polygon news fetch timed out for %s", ticker)
        return []
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Polygon news HTTP error for %s: %s", ticker, e.response.status_code
        )
        return []
    except Exception as e:
        logger.warning("Polygon news fetch failed for %s: %s", ticker, e)
        return []


def filter_ma_relevant(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filter articles to those containing M&A-relevant keywords."""
    relevant = []
    for article in articles:
        text = (
            (article.get("title") or "") + " " + (article.get("description") or "")
        ).lower()
        matched = [kw for kw in MA_NEWS_KEYWORDS if kw in text]
        if matched:
            article["_matched_keywords"] = matched
            article["_relevance_score"] = min(len(matched) / 5.0, 1.0)
            relevant.append(article)
    return relevant


def classify_risk_factor(article: Dict[str, Any]) -> Optional[str]:
    """Classify which risk factor a news article most likely affects."""
    text = (
        (article.get("title") or "") + " " + (article.get("description") or "")
    ).lower()

    if any(kw in text for kw in ("ftc", "doj", "antitrust", "regulatory", "cfius",
                                  "hsr", "second request", "phase ii", "approval")):
        return "regulatory"
    if any(kw in text for kw in ("vote", "shareholder", "proxy", "meeting")):
        return "vote"
    if any(kw in text for kw in ("financing", "debt", "commitment", "loan", "credit")):
        return "financing"
    if any(kw in text for kw in ("lawsuit", "litigation", "injunction", "class action",
                                  "complaint", "fiduciary")):
        return "legal"
    if any(kw in text for kw in ("material adverse", "mac", "deterioration", "earnings",
                                  "guidance")):
        return "mac"
    if any(kw in text for kw in ("topping bid", "go-shop", "superior proposal",
                                  "overbid", "competing")):
        return "competing_bid"
    if any(kw in text for kw in ("closing", "timeline", "delay", "extension",
                                  "outside date")):
        return "timing"
    return None


async def store_news_articles(
    pool, ticker: str, articles: List[Dict[str, Any]]
) -> int:
    """Upsert M&A-relevant news articles into deal_news_articles.

    Returns number of new articles stored.
    """
    stored = 0
    async with pool.acquire() as conn:
        for article in articles:
            article_id = article.get("id") or (article.get("article_url") or "")[:100]
            if not article_id:
                continue

            publisher = ""
            pub_obj = article.get("publisher")
            if isinstance(pub_obj, dict):
                publisher = pub_obj.get("name", "")
            elif isinstance(pub_obj, str):
                publisher = pub_obj

            published_at = article.get("published_utc")
            if isinstance(published_at, str):
                try:
                    published_at = datetime.fromisoformat(
                        published_at.replace("Z", "+00:00")
                    )
                except (ValueError, TypeError):
                    published_at = None

            risk_factor = classify_risk_factor(article)
            relevance = article.get("_relevance_score", 0.5)

            try:
                result = await conn.execute(
                    """INSERT INTO deal_news_articles
                           (ticker, article_id, title, publisher, published_at,
                            article_url, summary, relevance_score,
                            risk_factor_affected)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                       ON CONFLICT (ticker, article_id) DO NOTHING""",
                    ticker,
                    str(article_id),
                    (article.get("title") or "")[:500],
                    publisher[:100],
                    published_at,
                    (article.get("article_url") or "")[:500],
                    (article.get("description") or "")[:1000],
                    relevance,
                    risk_factor,
                )
                if result == "INSERT 0 1":
                    stored += 1
            except Exception:
                logger.error(
                    "Failed to store news article for %s", ticker, exc_info=True
                )

    if stored:
        logger.info("Stored %d new news articles for %s", stored, ticker)
    return stored


async def get_recent_deal_news(
    pool, ticker: str, days: int = 7
) -> List[Dict[str, Any]]:
    """Return recent news articles for a ticker from the database."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT title, publisher, published_at, article_url,
                      summary, risk_factor_affected, relevance_score
               FROM deal_news_articles
               WHERE ticker = $1
                 AND published_at > NOW() - make_interval(days => $2)
               ORDER BY published_at DESC
               LIMIT 10""",
            ticker,
            days,
        )
    return [dict(r) for r in rows]


async def scan_all_deal_news(pool) -> Dict[str, Any]:
    """Main job function: scan Polygon news for all active deal tickers.

    Returns summary dict for job_runs.
    """
    api_key = os.environ.get("POLYGON_API_KEY")
    if not api_key:
        logger.warning("[news_monitor] No POLYGON_API_KEY set, skipping news scan")
        return {"skipped": True, "reason": "no_api_key"}

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
    total_stored = 0

    for ticker in tickers:
        try:
            articles = await fetch_deal_news(ticker, api_key, days=1)
            if not articles:
                continue
            relevant = filter_ma_relevant(articles)
            if relevant:
                stored = await store_news_articles(pool, ticker, relevant)
                total_stored += stored
        except Exception:
            logger.error(
                "[news_monitor] Error scanning news for %s", ticker, exc_info=True
            )

    logger.info(
        "[news_monitor] Scanned %d tickers, stored %d articles",
        len(tickers),
        total_stored,
    )
    return {"tickers": len(tickers), "articles_stored": total_stored}
