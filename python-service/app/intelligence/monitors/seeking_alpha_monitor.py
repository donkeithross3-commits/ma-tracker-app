"""Seeking Alpha M&A News Monitor

Monitors: https://seekingalpha.com/market-news/m-a
Provides: Aggregated M&A news and analysis
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import httpx
from bs4 import BeautifulSoup
import re

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType
from app.intelligence.headline_parser import get_headline_parser


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
        self.seen_articles_this_cycle = set()
        self.parser = get_headline_parser()

    async def fetch_updates(self) -> List[Dict[str, Any]]:
        """
        Fetch latest M&A articles from Seeking Alpha.

        Returns:
            List of article dictionaries with keys: title, link, published, tickers
        """
        self.logger.info(f"Fetching Seeking Alpha M&A news")

        # Clear the cycle-specific seen set at the start of each fetch
        self.seen_articles_this_cycle.clear()

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # Enhanced headers to avoid bot detection
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
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

            # Seeking Alpha uses specific article structures
            # Look for article cards or list items
            article_elements = soup.find_all("article") or soup.find_all("div", class_=re.compile(r"article|item|card"))

            for article in article_elements[:100]:  # Fetch up to 100 articles
                # Try to find title link
                title_link = article.find("a", href=re.compile(r"/news/"))
                if not title_link:
                    continue

                href = title_link.get("href", "")
                if not href.startswith("http"):
                    href = f"https://seekingalpha.com{href}"

                # Only skip if we've seen it in THIS cycle (prevents duplicates within one fetch)
                # Database will handle deduplication across cycles
                if href not in self.seen_articles_this_cycle:
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
                        self.seen_articles_this_cycle.add(href)

            self.logger.info(f"Fetched {len(articles)} articles from Seeking Alpha")
            return articles

    async def parse_item(self, item: Dict[str, Any]) -> Optional[DealMention]:
        """
        Parse Seeking Alpha article into DealMention using rule-based parser.

        Args:
            item: Article dictionary with title, link, published, tickers

        Returns:
            DealMention if article is M&A-relevant, None otherwise
        """
        try:
            # Use rule-based parser to extract deal information
            parsed = self.parser.parse(headline=item['title'], summary="")

            if not parsed.is_ma_relevant:
                self.logger.debug(f"Article not M&A relevant: {item['title']}")
                return None

            # Use tickers from article if parser didn't find them
            if not parsed.target_ticker and item.get("tickers"):
                parsed.target_ticker = item["tickers"][0] if len(item["tickers"]) >= 1 else None
            if not parsed.acquirer_ticker and item.get("tickers") and len(item.get("tickers", [])) >= 2:
                parsed.acquirer_ticker = item["tickers"][1]

            # Parse published date
            source_published_at = None
            if item.get("published"):
                try:
                    source_published_at = datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
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
                content_snippet="",
                credibility_score=self.get_credibility_score() * parsed.confidence,  # Scale by parse confidence
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
            self.logger.error(f"Error parsing Seeking Alpha article: {e}", exc_info=True)
            return None


# Convenience factory function
def create_seeking_alpha_monitor(config: Optional[Dict[str, Any]] = None) -> SeekingAlphaMAMonitor:
    """Create and return a Seeking Alpha M&A monitor instance"""
    return SeekingAlphaMAMonitor(config)
