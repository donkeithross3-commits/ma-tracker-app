"""EDGAR RSS feed poller for real-time M&A monitoring"""
import asyncio
import logging
from datetime import datetime, time as dt_time
from typing import List, Optional
import feedparser
import httpx
from .models import EdgarRSSItem, EdgarFiling

logger = logging.getLogger(__name__)

# EDGAR RSS feed URLs
EDGAR_RSS_FEEDS = {
    "xbrl": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=exclude&start=0&count=100&output=atom",
    "recent": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=0&count=100&output=atom"
}

# M&A relevant filing types
MA_FILING_TYPES = {
    "8-K",      # Current report (often announces M&A)
    "8-K/A",    # Amended current report
    "SC TO",    # Tender offer statement
    "SC TO-T",  # Tender offer continuation
    "SC TO-C",  # Tender offer corrective
    "DEFM14A",  # Definitive proxy for merger
    "PREM14A",  # Preliminary proxy for merger
    "S-4",      # Registration for business combinations
    "SC 13D",   # Beneficial ownership (activist, potential M&A)
    "SC 13E3",  # Going private transaction
    "425",      # Prospectus filed pursuant to merger
}

# Market hours (9:30 AM - 4:00 PM ET)
MARKET_OPEN = dt_time(9, 30)
MARKET_CLOSE = dt_time(16, 0)


class EdgarPoller:
    """Polls EDGAR RSS feeds for new filings"""

    def __init__(self, poll_interval: int = 60):
        self.poll_interval = poll_interval  # seconds
        self.seen_accession_numbers = set()
        # SEC requires User-Agent header with contact info
        headers = {
            "User-Agent": "M&A Tracker yourname@company.com",
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov"
        }
        self.client = httpx.AsyncClient(timeout=30.0, headers=headers)

    async def is_market_hours(self) -> bool:
        """Check if currently during market hours (ET)"""
        now = datetime.now()  # Should use ET timezone in production
        current_time = now.time()

        # Market is open Monday-Friday, 9:30 AM - 4:00 PM ET
        is_weekday = now.weekday() < 5
        is_trading_hours = MARKET_OPEN <= current_time <= MARKET_CLOSE

        return is_weekday and is_trading_hours

    async def fetch_rss_feed(self, feed_url: str) -> List[EdgarRSSItem]:
        """Fetch and parse EDGAR RSS feed"""
        try:
            response = await self.client.get(feed_url)
            response.raise_for_status()

            feed = feedparser.parse(response.text)
            items = []

            for entry in feed.entries:
                try:
                    # SEC feeds use 'updated_parsed' instead of 'published_parsed'
                    date_parsed = getattr(entry, 'updated_parsed', None) or getattr(entry, 'published_parsed', None)
                    if not date_parsed:
                        logger.warning(f"No date found for entry: {entry.get('title', 'Unknown')}")
                        continue

                    item = EdgarRSSItem(
                        title=entry.title,
                        link=entry.link,
                        description=entry.get('summary', ''),
                        pub_date=datetime(*date_parsed[:6]),
                        guid=entry.get('id', entry.link)
                    )
                    items.append(item)
                except Exception as e:
                    logger.warning(f"Failed to parse RSS entry: {e}")
                    continue

            return items
        except Exception as e:
            logger.error(f"Failed to fetch RSS feed {feed_url}: {e}")
            return []

    def parse_filing(self, rss_item: EdgarRSSItem) -> Optional[EdgarFiling]:
        """Parse RSS item into EdgarFiling"""
        try:
            # Title format: "8-K - COMPANY NAME INC (0001234567)"
            title_parts = rss_item.title.split(' - ', 1)
            if len(title_parts) < 2:
                return None

            filing_type = title_parts[0].strip()
            company_info = title_parts[1].strip()

            # Extract CIK from company info
            if '(' in company_info and ')' in company_info:
                company_name = company_info.split('(')[0].strip()
                cik = company_info.split('(')[1].split(')')[0].strip()
            else:
                company_name = company_info
                cik = "unknown"

            # Extract accession number from link (remove -index suffix from RSS links)
            accession_number = rss_item.link.split('/')[-1].replace('-index.htm', '').replace('.htm', '')

            # Keep the original -index.htm URL (it's the filing index page)
            filing_url = rss_item.link

            return EdgarFiling(
                accession_number=accession_number,
                cik=cik,
                company_name=company_name,
                ticker=None,  # Will be resolved later
                filing_type=filing_type,
                filing_date=rss_item.pub_date,
                filing_url=filing_url
            )
        except Exception as e:
            logger.warning(f"Failed to parse filing from RSS item: {e}")
            return None

    def is_ma_relevant_filing_type(self, filing_type: str) -> bool:
        """Check if filing type is potentially M&A relevant"""
        return filing_type in MA_FILING_TYPES

    async def poll_once(self) -> List[EdgarFiling]:
        """Single poll of EDGAR feeds, returns new M&A-relevant filings"""
        new_filings = []

        for feed_name, feed_url in EDGAR_RSS_FEEDS.items():
            items = await self.fetch_rss_feed(feed_url)
            logger.info(f"Fetched {len(items)} items from {feed_name} feed")

            for item in items:
                filing = self.parse_filing(item)
                if not filing:
                    continue

                # Skip if we've seen this filing before
                if filing.accession_number in self.seen_accession_numbers:
                    continue

                # Only process M&A-relevant filing types
                if not self.is_ma_relevant_filing_type(filing.filing_type):
                    continue

                self.seen_accession_numbers.add(filing.accession_number)
                new_filings.append(filing)
                logger.info(f"New M&A-relevant filing: {filing.filing_type} - {filing.company_name}")

        return new_filings

    async def start_polling(self, callback):
        """Start continuous polling loop"""
        logger.info(f"Starting EDGAR poller (interval: {self.poll_interval}s)")

        while True:
            try:
                # Adjust poll frequency based on market hours
                is_market_hours = await self.is_market_hours()
                current_interval = self.poll_interval if is_market_hours else self.poll_interval * 5

                logger.debug(f"Polling EDGAR (market_hours={is_market_hours})")
                start_time = datetime.now()

                new_filings = await self.poll_once()

                duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
                logger.info(f"Poll complete: {len(new_filings)} new filings in {duration_ms}ms")

                # Process each new filing via callback
                for filing in new_filings:
                    try:
                        await callback(filing)
                    except Exception as e:
                        logger.error(f"Callback failed for filing {filing.accession_number}: {e}")

                await asyncio.sleep(current_interval)

            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error

    async def close(self):
        """Clean up resources"""
        await self.client.aclose()
