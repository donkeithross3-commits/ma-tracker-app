"""Ticker-based EDGAR scanner - scans SEC filings for specific tickers"""
import asyncio
import logging
import httpx
from typing import List, Optional
from datetime import datetime, timedelta

from .models import EdgarFiling
from .poller import MA_FILING_TYPES

logger = logging.getLogger(__name__)


class TickerScanner:
    """
    Scans SEC.gov for recent filings for a specific ticker.

    This is used to proactively find EDGAR filings when:
    1. A deal is detected from news sources (Seeking Alpha, Reuters, etc.)
    2. During regular EDGAR polling to check existing deals for new filings
    """

    def __init__(self):
        # SEC requires User-Agent header with contact info
        headers = {
            "User-Agent": "M&A Tracker don@limitlessventures.us",
            "Accept-Encoding": "gzip, deflate",
            "Host": "data.sec.gov"
        }
        self.client = httpx.AsyncClient(timeout=30.0, headers=headers)

    async def get_cik_from_ticker(self, ticker: str) -> Optional[str]:
        """
        Get CIK (Central Index Key) from ticker symbol.

        Args:
            ticker: Stock ticker symbol (e.g., "STAA", "AAPL")

        Returns:
            CIK string with leading zeros (10 digits) or None if not found
        """
        try:
            # SEC maintains ticker to CIK mapping at this URL
            url = "https://www.sec.gov/files/company_tickers.json"
            response = await self.client.get(url)
            response.raise_for_status()

            tickers_data = response.json()

            # Search for matching ticker (case-insensitive)
            ticker_upper = ticker.upper()
            for company_id, company_data in tickers_data.items():
                if company_data.get("ticker", "").upper() == ticker_upper:
                    # CIK is stored as integer, convert to 10-digit string with leading zeros
                    cik = str(company_data["cik_str"]).zfill(10)
                    logger.info(f"Found CIK {cik} for ticker {ticker}")
                    return cik

            logger.warning(f"No CIK found for ticker {ticker}")
            return None

        except Exception as e:
            logger.error(f"Error getting CIK for ticker {ticker}: {e}")
            return None

    async def get_recent_filings(
        self,
        ticker: str,
        lookback_days: int = 30,
        filing_types: Optional[set] = None
    ) -> List[EdgarFiling]:
        """
        Get recent filings for a ticker.

        Args:
            ticker: Stock ticker symbol
            lookback_days: How many days back to search
            filing_types: Set of filing types to filter for (defaults to M&A types)

        Returns:
            List of EdgarFiling objects
        """
        if filing_types is None:
            filing_types = MA_FILING_TYPES

        try:
            # Get CIK for ticker
            cik = await self.get_cik_from_ticker(ticker)
            if not cik:
                return []

            # Fetch company's recent filings from SEC API
            url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            response = await self.client.get(url)
            response.raise_for_status()

            data = response.json()
            company_name = data.get("name", "Unknown")

            # Get recent filings from 'filings.recent' section
            recent_filings = data.get("filings", {}).get("recent", {})

            # Parse filings
            filings = []
            cutoff_date = datetime.now() - timedelta(days=lookback_days)

            accession_numbers = recent_filings.get("accessionNumber", [])
            filing_dates = recent_filings.get("filingDate", [])
            forms = recent_filings.get("form", [])
            primary_documents = recent_filings.get("primaryDocument", [])

            for i in range(len(accession_numbers)):
                try:
                    filing_type = forms[i]
                    filing_date_str = filing_dates[i]
                    accession_number = accession_numbers[i]

                    # Parse filing date
                    filing_date = datetime.strptime(filing_date_str, "%Y-%m-%d")

                    # Skip if too old
                    if filing_date < cutoff_date:
                        continue

                    # Skip if not in requested filing types
                    if filing_type not in filing_types:
                        continue

                    # Build filing URL
                    # Format: https://www.sec.gov/Archives/edgar/data/CIK/accessionNumber/primaryDocument
                    accession_no_hyphens = accession_number.replace("-", "")
                    filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_no_hyphens}/{primary_documents[i]}"

                    filing = EdgarFiling(
                        accession_number=accession_number,
                        cik=cik,
                        company_name=company_name,
                        ticker=ticker.upper(),
                        filing_type=filing_type,
                        filing_date=filing_date,
                        filing_url=filing_url
                    )

                    filings.append(filing)
                    logger.info(f"Found {filing_type} filing for {ticker} on {filing_date_str}")

                except Exception as e:
                    logger.warning(f"Error parsing filing entry: {e}")
                    continue

            logger.info(f"Found {len(filings)} recent M&A filings for {ticker}")
            return filings

        except Exception as e:
            logger.error(f"Error getting recent filings for {ticker}: {e}")
            return []

    async def scan_deal_tickers(
        self,
        target_ticker: Optional[str] = None,
        acquirer_ticker: Optional[str] = None,
        lookback_days: int = 30
    ) -> List[EdgarFiling]:
        """
        Scan EDGAR for recent filings related to a deal.

        Args:
            target_ticker: Target company ticker
            acquirer_ticker: Acquirer company ticker
            lookback_days: How many days back to search

        Returns:
            Combined list of filings from both companies
        """
        all_filings = []

        if target_ticker:
            target_filings = await self.get_recent_filings(
                target_ticker,
                lookback_days=lookback_days
            )
            all_filings.extend(target_filings)

        if acquirer_ticker and acquirer_ticker != target_ticker:
            acquirer_filings = await self.get_recent_filings(
                acquirer_ticker,
                lookback_days=lookback_days
            )
            all_filings.extend(acquirer_filings)

        return all_filings

    async def close(self):
        """Clean up resources"""
        await self.client.aclose()


# Singleton instance
_ticker_scanner: Optional[TickerScanner] = None


def get_ticker_scanner() -> TickerScanner:
    """Get or create the ticker scanner singleton"""
    global _ticker_scanner
    if _ticker_scanner is None:
        _ticker_scanner = TickerScanner()
    return _ticker_scanner
