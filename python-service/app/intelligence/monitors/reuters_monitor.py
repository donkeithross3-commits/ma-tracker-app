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
import os
from anthropic import AsyncAnthropic

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType


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
        self.seen_articles = set()
        self.anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    async def fetch_updates(self) -> List[Dict[str, Any]]:
        """
        Fetch latest M&A articles from Reuters.

        First tries RSS feed, falls back to HTML scraping if RSS unavailable.

        Returns:
            List of article dictionaries with keys: title, link, published, summary
        """
        self.logger.info(f"Fetching Reuters M&A news")

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
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(self.rss_url)
            response.raise_for_status()

            feed = feedparser.parse(response.text)

            articles = []
            for entry in feed.entries:
                article_id = entry.get("link", entry.get("id", ""))
                if article_id not in self.seen_articles:
                    articles.append({
                        "title": entry.get("title", ""),
                        "link": entry.get("link", ""),
                        "published": entry.get("published", ""),
                        "summary": entry.get("summary", ""),
                        "article_id": article_id
                    })
                    self.seen_articles.add(article_id)

            return articles

    async def _fetch_html(self) -> List[Dict[str, Any]]:
        """Fetch articles by scraping HTML"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(self.base_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            articles = []

            # Look for article links (Reuters uses specific classes)
            article_links = soup.find_all("a", href=re.compile(r"/legal/mergers-acquisitions/"))

            for link in article_links[:20]:  # Limit to 20 most recent
                href = link.get("href", "")
                if not href.startswith("http"):
                    href = f"https://www.reuters.com{href}"

                if href not in self.seen_articles:
                    title = link.get_text(strip=True)
                    if title and len(title) > 10:  # Filter out navigation links
                        articles.append({
                            "title": title,
                            "link": href,
                            "published": "",  # Unknown from HTML
                            "summary": "",
                            "article_id": href
                        })
                        self.seen_articles.add(href)

            return articles

    async def parse_item(self, item: Dict[str, Any]) -> Optional[DealMention]:
        """
        Parse Reuters article into DealMention using Claude.

        Args:
            item: Article dictionary with title, link, published, summary

        Returns:
            DealMention if article is M&A-relevant, None otherwise
        """
        try:
            # Combine title and summary for analysis
            text = f"Title: {item['title']}\n\nSummary: {item.get('summary', '')}"

            # Use Claude to extract deal information
            prompt = f"""Analyze this Reuters article headline and summary for M&A deal information.

{text}

Extract the following information if present:
1. Target company name (company being acquired)
2. Target ticker symbol if mentioned
3. Acquirer company name (company doing the acquisition)
4. Acquirer ticker symbol if mentioned
5. Deal value (in billions USD) if mentioned
6. Deal type (merger, acquisition, tender_offer, etc.)

If this is NOT about an M&A deal, respond with: NOT_MA_RELEVANT

Otherwise, respond in this exact JSON format:
{{
  "target_name": "Company Name",
  "target_ticker": "TICK" or null,
  "acquirer_name": "Acquirer Name" or null,
  "acquirer_ticker": "TICK" or null,
  "deal_value": 1.5 or null,
  "deal_type": "acquisition" or null,
  "is_ma_relevant": true
}}"""

            response = await self.anthropic.messages.create(
                model="claude-3-5-haiku-20241022",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )

            result = response.content[0].text.strip()

            if "NOT_MA_RELEVANT" in result:
                return None

            # Parse JSON response
            import json
            try:
                data = json.loads(result)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                json_match = re.search(r'\{.*\}', result, re.DOTALL)
                if json_match:
                    data = json.loads(json_match.group())
                else:
                    self.logger.warning(f"Could not parse Claude response: {result}")
                    return None

            if not data.get("is_ma_relevant"):
                return None

            # Parse published date
            source_published_at = None
            if item.get("published"):
                try:
                    source_published_at = datetime.fromisoformat(item["published"])
                except:
                    pass

            # Create DealMention
            mention = DealMention(
                source_name=self.source_name,
                source_type=self.source_type,
                mention_type=MentionType.ANNOUNCEMENT if data.get("acquirer_name") else MentionType.RUMOR,
                target_name=data["target_name"],
                target_ticker=data.get("target_ticker"),
                acquirer_name=data.get("acquirer_name"),
                acquirer_ticker=data.get("acquirer_ticker"),
                deal_value=data.get("deal_value"),
                deal_type=data.get("deal_type"),
                source_url=item["link"],
                headline=item["title"],
                content_snippet=item.get("summary", "")[:500],
                credibility_score=self.get_credibility_score(),  # Reuters = 0.8
                extracted_data=data,
                source_published_at=source_published_at,
            )

            return mention

        except Exception as e:
            self.logger.error(f"Error parsing Reuters article: {e}", exc_info=True)
            return None


# Convenience factory function
def create_reuters_monitor(config: Optional[Dict[str, Any]] = None) -> ReutersMAMonitor:
    """Create and return a Reuters M&A monitor instance"""
    return ReutersMAMonitor(config)
