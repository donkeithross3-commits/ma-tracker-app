"""Reuters M&A News Monitor

Monitors: https://www.reuters.com/legal/mergers-acquisitions/
Provides: Verified news articles on M&A deals
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import httpx
from bs4 import BeautifulSoup
import feedparser
import re

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType
from app.intelligence.headline_parser import get_headline_parser


class ReutersMAMonitor(BaseSourceMonitor):
    """
    Monitor Reuters M&A section for deal news.

    Reuters is a high-credibility news source that often breaks M&A stories
    before EDGAR filings appear.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(
            source_name="reuters_ma",
            source_type=SourceType.NEWS,
            config=config or {
                "url": "https://www.reuters.com/legal/mergers-acquisitions/",
                "rss_url": "https://www.reuters.com/legal/mergers-acquisitions/feed"
            }
        )
        self.base_url = self.config["url"]
        self.rss_url = self.config.get("rss_url")
        self.seen_articles_this_cycle = set()
        self.parser = get_headline_parser()

    async def fetch_updates(self) -> List[Dict[str, Any]]:
        """
        Fetch latest M&A articles from Reuters.

        First tries RSS feed, falls back to HTML scraping if RSS unavailable.

        Returns:
            List of article dictionaries with keys: title, link, published, summary
        """
        self.logger.info(f"Fetching Reuters M&A news")

        # Clear the cycle-specific seen set at the start of each fetch
        self.seen_articles_this_cycle.clear()

        articles = []

        # Try RSS feed first
        if self.rss_url:
            try:
                articles = await self._fetch_rss()
                if articles:
                    self.logger.info(f"Fetched {len(articles)} articles from Reuters RSS")
                    return articles
            except Exception as e:
                self.logger.warning(f"RSS fetch failed, falling back to HTML scraping: {e}")

        # Fallback to HTML scraping
        articles = await self._fetch_html()
        self.logger.info(f"Fetched {len(articles)} articles from Reuters HTML")
        return articles

    async def _fetch_rss(self) -> List[Dict[str, Any]]:
        """Fetch articles from RSS feed"""
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # Enhanced headers to avoid bot detection
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Cache-Control": "max-age=0"
            }

            response = await client.get(self.rss_url, headers=headers)
            response.raise_for_status()

            feed = feedparser.parse(response.text)

            articles = []
            for entry in feed.entries:
                article_id = entry.get("link", entry.get("id", ""))
                # Only skip if seen in THIS cycle (database handles cross-cycle deduplication)
                if article_id not in self.seen_articles_this_cycle:
                    articles.append({
                        "title": entry.get("title", ""),
                        "link": entry.get("link", ""),
                        "published": entry.get("published", ""),
                        "summary": entry.get("summary", ""),
                        "article_id": article_id
                    })
                    self.seen_articles_this_cycle.add(article_id)

            return articles

    async def _fetch_html(self) -> List[Dict[str, Any]]:
        """Fetch articles by scraping HTML"""
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # Enhanced headers to avoid bot detection
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Cache-Control": "max-age=0"
            }

            response = await client.get(self.base_url, headers=headers)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            articles = []

            # Look for article links (Reuters uses specific classes)
            article_links = soup.find_all("a", href=re.compile(r"/legal/mergers-acquisitions/"))

            for link in article_links[:20]:  # Limit to 20 most recent
                href = link.get("href", "")
                if not href.startswith("http"):
                    href = f"https://www.reuters.com{href}"

                # Only skip if seen in THIS cycle (database handles cross-cycle deduplication)
                if href not in self.seen_articles_this_cycle:
                    title = link.get_text(strip=True)
                    if title and len(title) > 10:  # Filter out navigation links
                        articles.append({
                            "title": title,
                            "link": href,
                            "published": "",  # Unknown from HTML
                            "summary": "",
                            "article_id": href
                        })
                        self.seen_articles_this_cycle.add(href)

            return articles

    async def parse_item(self, item: Dict[str, Any]) -> Optional[DealMention]:
        """
        Parse Reuters article into DealMention using rule-based parser.

        Args:
            item: Article dictionary with title, link, published, summary

        Returns:
            DealMention if article is M&A-relevant, None otherwise
        """
        try:
            # Use rule-based parser to extract deal information
            parsed = self.parser.parse(
                headline=item['title'],
                summary=item.get('summary', '')
            )

            if not parsed.is_ma_relevant:
                self.logger.debug(f"Article not M&A relevant: {item['title']}")
                return None

            # Parse published date
            source_published_at = None
            if item.get("published"):
                try:
                    source_published_at = datetime.fromisoformat(item["published"])
                except:
                    pass

            # Determine mention type
            mention_type = MentionType.RUMOR if parsed.is_rumor else MentionType.ANNOUNCEMENT

            # Create DealMention
            mention = DealMention(
                source_name=self.source_name,
                source_type=self.source_type,
                mention_type=mention_type,
                target_name=parsed.target_name,
                target_ticker=parsed.target_ticker,
                acquirer_name=parsed.acquirer_name,
                acquirer_ticker=parsed.acquirer_ticker,
                deal_value=parsed.deal_value,
                deal_type="rumor" if parsed.is_rumor else "acquisition",
                source_url=item["link"],
                headline=item["title"],
                content_snippet=item.get("summary", "")[:500],
                credibility_score=self.get_credibility_score() * parsed.confidence,  # Reuters = 0.8 * parse confidence
                extracted_data={
                    "parsed_confidence": parsed.confidence,
                    "is_rumor": parsed.is_rumor,
                    "reasoning": parsed.reasoning,
                },
                source_published_at=source_published_at,
            )

            self.logger.info(f"Parsed M&A mention: {parsed.reasoning}")
            return mention

        except Exception as e:
            self.logger.error(f"Error parsing Reuters article: {e}", exc_info=True)
            return None


# Convenience factory function
def create_reuters_monitor(config: Optional[Dict[str, Any]] = None) -> ReutersMAMonitor:
    """Create and return a Reuters M&A monitor instance"""
    return ReutersMAMonitor(config)
