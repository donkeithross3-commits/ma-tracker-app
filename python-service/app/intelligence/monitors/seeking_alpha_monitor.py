"""Seeking Alpha M&A News Monitor

Monitors: https://seekingalpha.com/market-news/m-a
Provides: Aggregated M&A news and analysis
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import httpx
from bs4 import BeautifulSoup
import re
import os
from anthropic import AsyncAnthropic

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType


class SeekingAlphaMAMonitor(BaseSourceMonitor):
    """
    Monitor Seeking Alpha M&A news section.

    Seeking Alpha is a news aggregator with mixed quality, but provides
    broad coverage and early signals.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(
            source_name="seeking_alpha_ma",
            source_type=SourceType.NEWS,
            config=config or {"url": "https://seekingalpha.com/market-news/m-a"}
        )
        self.base_url = self.config["url"]
        self.seen_articles = set()
        self.anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    async def fetch_updates(self) -> List[Dict[str, Any]]:
        """
        Fetch latest M&A articles from Seeking Alpha.

        Returns:
            List of article dictionaries with keys: title, link, published, tickers
        """
        self.logger.info(f"Fetching Seeking Alpha M&A news")

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # Set headers to avoid being blocked
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }

            response = await client.get(self.base_url, headers=headers)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            articles = []

            # Seeking Alpha uses specific article structures
            # Look for article cards or list items
            article_elements = soup.find_all("article") or soup.find_all("div", class_=re.compile(r"article|item|card"))

            for article in article_elements[:20]:  # Limit to 20 most recent
                # Try to find title link
                title_link = article.find("a", href=re.compile(r"/news/"))
                if not title_link:
                    continue

                href = title_link.get("href", "")
                if not href.startswith("http"):
                    href = f"https://seekingalpha.com{href}"

                if href not in self.seen_articles:
                    title = title_link.get_text(strip=True)

                    # Try to extract tickers from article
                    tickers = []
                    ticker_elements = article.find_all("a", href=re.compile(r"/symbol/"))
                    for ticker_elem in ticker_elements:
                        ticker_text = ticker_elem.get_text(strip=True).replace("$", "")
                        if ticker_text and len(ticker_text) <= 5:  # Valid ticker length
                            tickers.append(ticker_text)

                    # Try to extract date
                    date_elem = article.find("time")
                    published = date_elem.get("datetime", "") if date_elem else ""

                    if title and len(title) > 10:
                        articles.append({
                            "title": title,
                            "link": href,
                            "published": published,
                            "tickers": tickers,
                            "article_id": href
                        })
                        self.seen_articles.add(href)

            self.logger.info(f"Fetched {len(articles)} articles from Seeking Alpha")
            return articles

    async def parse_item(self, item: Dict[str, Any]) -> Optional[DealMention]:
        """
        Parse Seeking Alpha article into DealMention using Claude.

        Args:
            item: Article dictionary with title, link, published, tickers

        Returns:
            DealMention if article is M&A-relevant, None otherwise
        """
        try:
            # Use Claude to extract deal information
            tickers_str = ", ".join(item.get("tickers", [])) if item.get("tickers") else "None mentioned"

            prompt = f"""Analyze this Seeking Alpha article headline for M&A deal information.

Title: {item['title']}
Tickers mentioned: {tickers_str}

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
                    source_published_at = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
                except:
                    pass

            # Create DealMention
            mention = DealMention(
                source_name=self.source_name,
                source_type=self.source_type,
                mention_type=MentionType.ANNOUNCEMENT if data.get("acquirer_name") else MentionType.RUMOR,
                target_name=data["target_name"],
                target_ticker=data.get("target_ticker") or (item.get("tickers", [None])[0] if item.get("tickers") else None),
                acquirer_name=data.get("acquirer_name"),
                acquirer_ticker=data.get("acquirer_ticker"),
                deal_value=data.get("deal_value"),
                deal_type=data.get("deal_type"),
                source_url=item["link"],
                headline=item["title"],
                content_snippet="",
                credibility_score=self.get_credibility_score(),  # Seeking Alpha = 0.6
                extracted_data=data,
                source_published_at=source_published_at,
            )

            return mention

        except Exception as e:
            self.logger.error(f"Error parsing Seeking Alpha article: {e}", exc_info=True)
            return None


# Convenience factory function
def create_seeking_alpha_monitor(config: Optional[Dict[str, Any]] = None) -> SeekingAlphaMAMonitor:
    """Create and return a Seeking Alpha M&A monitor instance"""
    return SeekingAlphaMAMonitor(config)
