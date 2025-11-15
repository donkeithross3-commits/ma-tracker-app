"""GlobeNewswire RSS Monitor

Monitors: GlobeNewswire RSS feeds (M&A, Corporate Actions, Executive Changes)
Provides: Official company press releases with high credibility
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import httpx
import xml.etree.ElementTree as ET
import re

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType
from app.intelligence.headline_parser import get_headline_parser


class GlobeNewswireMonitor(BaseSourceMonitor):
    """
    Monitor GlobeNewswire RSS feeds for M&A-related press releases.

    GlobeNewswire is a major press release distribution service used by public companies.
    It provides structured RSS feeds with ticker information and categorization.

    Feed Categories:
    - M&A (subjectcode/27): Direct M&A announcements
    - Corporate Actions (subjectcode/14): Strategic reviews, proposals, etc.
    - Executive Changes (subjectcode/33): Leadership changes that may signal M&A
    """

    # RSS feed URLs by category
    FEED_URLS = {
        "ma": "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20And%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20And%20Acquisitions",
        "corporate_actions": "https://www.globenewswire.com/RssFeed/subjectcode/14-Corporate%20Actions/feedTitle/GlobeNewswire%20-%20Corporate%20Actions",
        "executive_changes": "https://www.globenewswire.com/RssFeed/subjectcode/33-Executive%20Leadership%20and%20Board%20Changes/feedTitle/GlobeNewswire%20-%20Executive%20Leadership%20and%20Board%20Changes"
    }

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(
            source_name="globenewswire",
            source_type=SourceType.NEWS,
            config=config or {"feed_category": "ma"}
        )
        self.feed_category = self.config.get("feed_category", "ma")
        self.feed_url = self.FEED_URLS.get(self.feed_category, self.FEED_URLS["ma"])
        self.seen_guids_this_cycle = set()
        self.parser = get_headline_parser()

    async def fetch_updates(self) -> List[Dict[str, Any]]:
        """
        Fetch latest press releases from GlobeNewswire RSS feed.

        Returns:
            List of article dictionaries with keys: title, link, published,
            description, guid, contributor, tickers
        """
        self.logger.info(f"Fetching GlobeNewswire {self.feed_category} RSS feed")

        # Clear the cycle-specific seen set at the start of each fetch
        self.seen_guids_this_cycle.clear()

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }

            response = await client.get(self.feed_url, headers=headers)
            response.raise_for_status()

            articles = []

            # Parse RSS XML
            root = ET.fromstring(response.text)

            # Find all items in the feed
            for item in root.findall(".//item"):
                try:
                    # Extract basic fields
                    title = item.findtext("title", "").strip()
                    link = item.findtext("link", "").strip()
                    guid = item.findtext("guid", link).strip()
                    description = item.findtext("description", "").strip()
                    pub_date = item.findtext("pubDate", "").strip()

                    # Extract Dublin Core fields (dc: namespace)
                    # Namespace handling for Dublin Core
                    dc_ns = {"dc": "http://purl.org/dc/elements/1.1/"}
                    contributor = item.find("dc:contributor", dc_ns)
                    contributor_name = contributor.text if contributor is not None else None

                    # Extract tickers from category tags
                    # Format: <category>NASDAQ:TICK</category> or <category>NYSE:TICK</category>
                    tickers = []
                    for category in item.findall("category"):
                        cat_text = category.text or ""
                        # Match ticker patterns like "NASDAQ:AAPL" or "NYSE:IBM"
                        ticker_match = re.search(r'(?:NASDAQ|NYSE|AMEX|OTC):([A-Z]{1,5})', cat_text)
                        if ticker_match:
                            tickers.append(ticker_match.group(1))

                    # Deduplicate by guid (only within this cycle, database handles cross-cycle deduplication)
                    if guid and guid not in self.seen_guids_this_cycle:
                        if title and len(title) > 10:
                            articles.append({
                                "title": title,
                                "link": link,
                                "guid": guid,
                                "description": description,
                                "published": pub_date,
                                "contributor": contributor_name,
                                "tickers": list(set(tickers)),  # Remove duplicates
                                "feed_category": self.feed_category
                            })
                            self.seen_guids_this_cycle.add(guid)

                except Exception as e:
                    self.logger.error(f"Error parsing RSS item: {e}")
                    continue

            self.logger.info(f"Fetched {len(articles)} new articles from GlobeNewswire {self.feed_category}")
            return articles

    async def parse_item(self, item: Dict[str, Any]) -> Optional[DealMention]:
        """
        Parse GlobeNewswire press release into DealMention using rule-based parser.

        Args:
            item: Article dictionary with title, link, published, description, tickers

        Returns:
            DealMention if article is M&A-relevant, None otherwise
        """
        try:
            description = item.get("description", "")
            feed_category = item.get("feed_category", "ma")

            # Use rule-based parser to extract deal information
            parsed = self.parser.parse(
                headline=item['title'],
                summary=description
            )

            if not parsed.is_ma_relevant:
                self.logger.debug(f"Article not M&A relevant: {item['title']}")
                return None

            # Prefer ticker from parsed data, fall back to item tickers
            if not parsed.target_ticker and item.get("tickers"):
                parsed.target_ticker = item["tickers"][0] if len(item["tickers"]) >= 1 else None
            if not parsed.acquirer_ticker and item.get("tickers") and len(item.get("tickers", [])) >= 2:
                parsed.acquirer_ticker = item["tickers"][1]

            # Parse published date
            source_published_at = None
            if item.get("published"):
                try:
                    # RFC 822 date format used by RSS
                    from email.utils import parsedate_to_datetime
                    from datetime import timezone
                    source_published_at = parsedate_to_datetime(item["published"])
                    # Convert to naive UTC for PostgreSQL compatibility
                    if source_published_at:
                        if source_published_at.tzinfo is not None:
                            # Convert timezone-aware to UTC naive
                            source_published_at = source_published_at.astimezone(timezone.utc).replace(tzinfo=None)
                        # If already naive, assume it's UTC (no conversion needed)
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
                content_snippet=description[:500],
                credibility_score=self.get_credibility_score() * parsed.confidence,  # Scale by parse confidence
                extracted_data={
                    "parsed_confidence": parsed.confidence,
                    "is_rumor": parsed.is_rumor,
                    "reasoning": parsed.reasoning,
                    "feed_category": feed_category,
                },
                source_published_at=source_published_at,
            )

            self.logger.info(f"Parsed M&A mention: {parsed.reasoning}")
            return mention

        except Exception as e:
            self.logger.error(f"Error parsing GlobeNewswire article: {e}", exc_info=True)
            return None

    def get_credibility_score(self) -> float:
        """
        Return credibility score for GlobeNewswire.

        GlobeNewswire is an official press release service, so scores are high:
        - M&A feed: 0.85 (official M&A announcements)
        - Corporate Actions: 0.80 (strategic reviews, proposals)
        - Executive Changes: 0.70 (indirect signals)
        """
        scores = {
            "ma": 0.85,
            "corporate_actions": 0.80,
            "executive_changes": 0.70
        }
        return scores.get(self.feed_category, 0.80)


# Convenience factory functions for each feed type
def create_globenewswire_ma_monitor(config: Optional[Dict[str, Any]] = None) -> GlobeNewswireMonitor:
    """Create and return a GlobeNewswire M&A monitor instance"""
    config = config or {}
    config["feed_category"] = "ma"
    return GlobeNewswireMonitor(config)


def create_globenewswire_corporate_actions_monitor(config: Optional[Dict[str, Any]] = None) -> GlobeNewswireMonitor:
    """Create and return a GlobeNewswire Corporate Actions monitor instance"""
    config = config or {}
    config["feed_category"] = "corporate_actions"
    return GlobeNewswireMonitor(config)


def create_globenewswire_executive_changes_monitor(config: Optional[Dict[str, Any]] = None) -> GlobeNewswireMonitor:
    """Create and return a GlobeNewswire Executive Changes monitor instance"""
    config = config or {}
    config["feed_category"] = "executive_changes"
    return GlobeNewswireMonitor(config)
