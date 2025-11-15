"""EDGAR RSS feed poller for real-time M&A monitoring"""
import asyncio
import logging
from datetime import datetime, time as dt_time
from typing import List, Optional
import feedparser
import httpx
from .models import EdgarRSSItem, EdgarFiling
from app.services.ticker_lookup import get_ticker_lookup_service

logger = logging.getLogger(__name__)

# EDGAR RSS feed URLs
EDGAR_RSS_FEEDS = {
    "xbrl": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=exclude&start=0&count=100&output=atom",
    "recent": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=0&count=100&output=atom"
}

# M&A relevant filing types
MA_FILING_TYPES = {
    "8-K",       # Current report (often announces M&A - esp Items 1.01, 8.01)
    "8-K/A",     # Amended current report
    "SC TO",     # Tender offer statement
    "SC TO-T",   # Tender offer continuation
    "SC TO-C",   # Tender offer corrective
    "SC 14D-9",  # Target response to tender offer
    "DEFM14A",   # Definitive proxy for merger
    "PREM14A",   # Preliminary proxy for merger
    "S-4",       # Registration for business combinations
    "SC 13E3",   # Going private transaction
    "425",       # Business combination communications (Rule 425)
}

# High-priority filing types (likely to be first-time announcements)
# Focus on 8-K Items 1.01 and 8.01 for timeliest disclosure of new $50M+ deals
HIGH_PRIORITY_FILINGS = {
    "8-K",       # Initial current report - MOST COMMON for new deal announcements
                 # Especially Items 1.01 (Material Definitive Agreement) and 8.01 (Other Events)
    "SC TO",     # Tender offer commencement - always new announcement
    "SC 14D-9",  # Target response to tender offer - typically first disclosure from target
    "S-4",       # Registration for merger - initial filing for stock deals
    "SC 13E3",   # Going private - initial disclosure
}

# Medium-priority filing types (could be initial or ongoing communications)
MEDIUM_PRIORITY_FILINGS = {
    "425",       # Business combination communications
                 # Can be initial (filed with S-4) OR ongoing communications
                 # Requires careful analysis - check for historical references
}

# Low-priority filing types (typically updates to existing deals, NOT first announcements)
LOW_PRIORITY_FILINGS = {
    "8-K/A",     # Amended - BY DEFINITION updating previous filing (never new)
    "PREM14A",   # Preliminary proxy - for existing deals seeking shareholder vote
    "DEFM14A",   # Definitive proxy - for existing deals seeking shareholder vote
    "SC TO-T",   # Tender offer continuation - updating existing offer
    "SC TO-C",   # Tender offer corrective - updating existing offer
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

    async def parse_filing(self, rss_item: EdgarRSSItem) -> Optional[EdgarFiling]:
        """Parse RSS item into EdgarFiling with ticker lookup"""
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

            # Look up ticker from company name
            ticker = None
            try:
                ticker_service = get_ticker_lookup_service()
                ticker = await ticker_service.lookup_ticker(company_name)
                if ticker:
                    logger.debug(f"Found ticker {ticker} for {company_name}")
            except Exception as e:
                logger.debug(f"Ticker lookup failed for {company_name}: {e}")

            return EdgarFiling(
                accession_number=accession_number,
                cik=cik,
                company_name=company_name,
                ticker=ticker,
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

    def get_filing_priority(self, filing_type: str) -> str:
        """Get priority level for filing type (high/medium/low)

        Returns:
            'high' for filing types likely to be first-time announcements
                   (8-K Items 1.01/8.01, SC TO, SC 14D-9, S-4, SC 13E3)
            'medium' for filing types that could be initial OR ongoing
                     (Form 425 - requires careful analysis)
            'low' for filing types typically updating existing deals
                  (8-K/A, PREM14A, DEFM14A, SC TO-T, SC TO-C)
        """
        if filing_type in HIGH_PRIORITY_FILINGS:
            return 'high'
        elif filing_type in MEDIUM_PRIORITY_FILINGS:
            return 'medium'
        elif filing_type in LOW_PRIORITY_FILINGS:
            return 'low'
        else:
            return 'medium'  # Unknown filing types default to medium

    async def poll_once(self) -> List[EdgarFiling]:
        """Single poll of EDGAR feeds, returns new M&A-relevant filings"""
        new_filings = []

        for feed_name, feed_url in EDGAR_RSS_FEEDS.items():
            items = await self.fetch_rss_feed(feed_url)
            logger.info(f"Fetched {len(items)} items from {feed_name} feed")

            for item in items:
                filing = await self.parse_filing(item)
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
