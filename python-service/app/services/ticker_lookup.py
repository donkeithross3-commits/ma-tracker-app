"""Ticker Lookup Service - Resolves company names to ticker symbols"""
import httpx
import logging
from typing import Optional
import re

logger = logging.getLogger(__name__)


class TickerLookupService:
    """Service to look up stock tickers from company names"""

    def __init__(self):
        self.cache = {}  # Simple in-memory cache

    async def lookup_ticker(self, company_name: str) -> Optional[str]:
        """
        Look up ticker symbol for a company name.
        Returns ticker symbol or None if not found.
        """
        if not company_name:
            return None

        # Clean the company name
        clean_name = self._clean_company_name(company_name)

        # Check cache first
        if clean_name in self.cache:
            logger.info(f"Cache hit for {clean_name}: {self.cache[clean_name]}")
            return self.cache[clean_name]

        # Try Yahoo Finance search
        ticker = await self._yahoo_finance_search(clean_name)

        if ticker:
            self.cache[clean_name] = ticker
            logger.info(f"Found ticker for {clean_name}: {ticker}")
        else:
            logger.warning(f"Could not find ticker for {clean_name}")

        return ticker

    def _clean_company_name(self, name: str) -> str:
        """Clean company name for better matching"""
        # Remove common suffixes
        suffixes = [
            r'\s+Inc\.?$',
            r'\s+Corporation$',
            r'\s+Corp\.?$',
            r'\s+Company$',
            r'\s+Co\.?$',
            r'\s+Ltd\.?$',
            r'\s+Limited$',
            r'\s+LLC$',
            r'\s+L\.L\.C\.$',
            r',\s*Inc\.?$',
            r',\s*Corp\.?$',
        ]

        cleaned = name
        for suffix in suffixes:
            cleaned = re.sub(suffix, '', cleaned, flags=re.IGNORECASE)

        return cleaned.strip()

    async def _yahoo_finance_search(self, company_name: str) -> Optional[str]:
        """
        Search for ticker using Yahoo Finance search API.
        Free, no API key required.
        """
        try:
            url = "https://query2.finance.yahoo.com/v1/finance/search"
            params = {
                "q": company_name,
                "quotesCount": 5,
                "newsCount": 0,
                "enableFuzzyQuery": False,
                "quotesQueryId": "tss_match_phrase_query"
            }

            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()

                data = response.json()
                quotes = data.get("quotes", [])

                if not quotes:
                    return None

                # Find first equity match
                for quote in quotes:
                    if quote.get("quoteType") in ["EQUITY", "ETF"]:
                        ticker = quote.get("symbol")
                        # Prefer US exchanges
                        exchange = quote.get("exchange", "")
                        if ticker and not any(suffix in ticker for suffix in [".L", ".TO", ".AX"]):
                            return ticker

                # If no US equity found, return first result
                if quotes:
                    return quotes[0].get("symbol")

                return None

        except Exception as e:
            logger.error(f"Yahoo Finance search failed for {company_name}: {e}")
            return None


# Singleton instance
_ticker_lookup_service = None

def get_ticker_lookup_service() -> TickerLookupService:
    """Get or create the ticker lookup service instance"""
    global _ticker_lookup_service
    if _ticker_lookup_service is None:
        _ticker_lookup_service = TickerLookupService()
    return _ticker_lookup_service
