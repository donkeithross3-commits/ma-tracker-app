"""Finnhub news monitor — fetch per-ticker company news from Finnhub free API.

Covers publishers that Polygon misses: BusinessWire, AccessWire, PRNewswire,
SeekingAlpha, and many others. Free tier: 60 calls/min.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import httpx

from app.scheduler.news_monitor import classify_risk_factor, score_relevance

logger = logging.getLogger(__name__)

FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/company-news"


async def _fetch_ticker_news(
    client: httpx.AsyncClient, ticker: str, api_key: str, days: int = 7,
) -> List[Dict[str, Any]]:
    """Fetch company news for a single ticker from Finnhub."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    from_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        resp = await client.get(
            FINNHUB_NEWS_URL,
            params={
                "symbol": ticker,
                "from": from_date,
                "to": today,
                "token": api_key,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        articles = resp.json()
        if not isinstance(articles, list):
            return []
        return articles
    except httpx.TimeoutException:
        logger.warning("[finnhub] Timeout for %s", ticker)
        return []
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("[finnhub] Rate limited, stopping scan")
            raise  # Propagate to stop scanning
        logger.warning("[finnhub] HTTP %d for %s", e.response.status_code, ticker)
        return []
    except Exception as e:
        logger.warning("[finnhub] Error for %s: %s", ticker, e)
        return []


def _convert_finnhub_article(article: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Finnhub article format to our standard format for score_relevance()."""
    # Convert unix timestamp to ISO string
    ts = article.get("datetime")
    published_utc = None
    if ts:
        try:
            published_utc = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (ValueError, OSError, OverflowError):
            pass

    return {
        "id": f"finnhub:{article.get('id', '')}",
        "title": article.get("headline", ""),
        "description": article.get("summary", ""),
        "article_url": article.get("url", ""),
        "published_utc": published_utc,
        "publisher": article.get("source", ""),
    }


async def scan_finnhub_news(pool) -> Dict[str, Any]:
    """Main job function: scan Finnhub news for all active deal tickers.

    Returns summary dict for job_runs.
    """
    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        logger.warning("[finnhub] No FINNHUB_API_KEY set, skipping scan")
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
    logger.info("[finnhub] Starting scan: %d tickers", len(tickers))

    total_raw = 0
    total_keyword_matched = 0
    total_stored = 0
    rate_limited = False

    async with httpx.AsyncClient(
        headers={"User-Agent": "DR3-DealIntel/1.0"},
    ) as client:
        for ticker in tickers:
            if rate_limited:
                break

            try:
                articles = await _fetch_ticker_news(client, ticker, api_key)
                raw_count = len(articles)
                total_raw += raw_count

                if not articles:
                    await asyncio.sleep(1.0)  # Rate limit even on empty
                    continue

                # Convert to standard format and score
                converted = [_convert_finnhub_article(a) for a in articles]
                scored = score_relevance(converted)
                keyword_matched = sum(
                    1 for a in scored if a.get("_relevance_score", 0) > 0.1
                )
                total_keyword_matched += keyword_matched

                # Store articles
                async with pool.acquire() as conn:
                    for article in scored:
                        article_id = article.get("id", "")
                        if not article_id:
                            continue

                        published_at = None
                        pub_str = article.get("published_utc")
                        if pub_str:
                            try:
                                published_at = datetime.fromisoformat(
                                    pub_str.replace("Z", "+00:00")
                                )
                            except (ValueError, TypeError):
                                pass

                        risk_factor = classify_risk_factor(article)
                        relevance = article.get("_relevance_score", 0.5)

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
                                (article.get("publisher") or "")[:100],
                                published_at,
                                (article.get("article_url") or "")[:500],
                                (article.get("description") or "")[:1000],
                                relevance,
                                risk_factor,
                                "finnhub",
                            )
                            if result == "INSERT 0 1":
                                total_stored += 1
                        except Exception:
                            logger.error(
                                "[finnhub] Failed to store article for %s",
                                ticker,
                                exc_info=True,
                            )

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    rate_limited = True
                    logger.warning("[finnhub] Rate limited at ticker %s, stopping", ticker)
                    break
            except Exception:
                logger.error("[finnhub] Error scanning %s", ticker, exc_info=True)

            # Rate limit: 1s between tickers (60 calls/min limit)
            await asyncio.sleep(1.0)

    logger.info(
        "[finnhub] Scanned %d tickers: %d raw, %d keyword-matched, %d stored%s",
        len(tickers), total_raw, total_keyword_matched, total_stored,
        " (RATE LIMITED)" if rate_limited else "",
    )

    return {
        "tickers": len(tickers),
        "raw_articles": total_raw,
        "keyword_matched": total_keyword_matched,
        "articles_stored": total_stored,
        "rate_limited": rate_limited,
    }
