"""Ticker Lookup Service - Maps company names to ticker symbols

Uses SEC's company_tickers.json as primary source with fuzzy matching.
"""
import asyncio
import logging
import httpx
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from difflib import SequenceMatcher
import re

logger = logging.getLogger(__name__)


class TickerLookupService:
    """
    Lookup ticker symbols from company names using SEC data with caching.

    Features:
    - Downloads SEC's ticker mapping on first use
    - Caches in memory for fast lookups
    - Fuzzy matching for company name variations
    - 24-hour cache TTL
    """

    def __init__(self):
        # SEC ticker data cache
        self._ticker_cache: Optional[Dict[str, Dict]] = None
        self._cache_loaded_at: Optional[datetime] = None
        self._cache_ttl = timedelta(hours=24)  # Refresh daily

        # HTTP client with proper SEC headers
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={
                "User-Agent": "M&A Tracker don@limitlessventures.us",
                "Accept-Encoding": "gzip, deflate"
            }
        )

    async def _load_sec_ticker_data(self) -> Dict[str, Dict]:
        """
        Load ticker mapping from SEC.

        Returns:
            Dict mapping ticker (uppercase) to company data:
            {
                "STAA": {
                    "cik_str": 1272661,
                    "ticker": "STAA",
                    "title": "STAAR SURGICAL CO"
                },
                ...
            }
        """
        try:
            logger.info("Loading SEC ticker mapping data...")

            url = "https://www.sec.gov/files/company_tickers.json"
            response = await self.client.get(url)
            response.raise_for_status()

            data = response.json()

            # Convert to ticker-keyed dict for faster lookups
            ticker_map = {}
            for item_id, company_data in data.items():
                ticker = company_data.get("ticker", "").upper()
                if ticker:
                    ticker_map[ticker] = {
                        "cik_str": company_data.get("cik_str"),
                        "ticker": ticker,
                        "title": company_data.get("title", "").upper()
                    }

            logger.info(f"Loaded {len(ticker_map)} ticker mappings from SEC")
            return ticker_map

        except Exception as e:
            logger.error(f"Failed to load SEC ticker data: {e}")
            return {}

    async def _ensure_cache_loaded(self) -> None:
        """Ensure ticker cache is loaded and fresh"""
        now = datetime.now()

        # Load if not loaded or expired
        if (self._ticker_cache is None or
            self._cache_loaded_at is None or
            now - self._cache_loaded_at > self._cache_ttl):

            self._ticker_cache = await self._load_sec_ticker_data()
            self._cache_loaded_at = now

    def _similarity_score(self, str1: str, str2: str) -> float:
        """
        Calculate similarity between two strings (0.0 to 1.0).

        Uses SequenceMatcher for fuzzy matching to handle variations like:
        - "STAAR Surgical" vs "STAAR SURGICAL CO"
        - "Apple Inc" vs "APPLE INC"
        """
        return SequenceMatcher(None, str1.upper(), str2.upper()).ratio()

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

    async def lookup_by_ticker(self, ticker: str) -> Optional[Dict]:
        """
        Look up company data by ticker symbol.

        Args:
            ticker: Stock ticker (e.g., "STAA", "AAPL")

        Returns:
            Company data dict or None:
            {
                "ticker": "STAA",
                "company_name": "STAAR SURGICAL CO",
                "cik": "0001272661"
            }
        """
        await self._ensure_cache_loaded()

        ticker_upper = ticker.upper()
        company_data = self._ticker_cache.get(ticker_upper)

        if company_data:
            return {
                "ticker": company_data["ticker"],
                "company_name": company_data["title"],
                "cik": str(company_data["cik_str"]).zfill(10)
            }

        return None

    async def lookup_ticker(self, company_name: str, min_similarity: float = 0.80) -> Optional[str]:
        """
        Look up ticker by company name with fuzzy matching.

        This is the main method for ticker lookups from company names.

        Args:
            company_name: Company name (e.g., "STAAR Surgical", "Apple Inc")
            min_similarity: Minimum similarity score (0.0-1.0) for a match

        Returns:
            Ticker symbol or None
        """
        result = await self.lookup_by_company_name(company_name, min_similarity)
        return result["ticker"] if result else None

    async def lookup_by_company_name(
        self,
        company_name: str,
        min_similarity: float = 0.80
    ) -> Optional[Dict]:
        """
        Look up ticker by company name with fuzzy matching.

        Args:
            company_name: Company name (e.g., "STAAR Surgical", "Apple Inc")
            min_similarity: Minimum similarity score (0.0-1.0) for a match

        Returns:
            Company data dict or None:
            {
                "ticker": "STAA",
                "company_name": "STAAR SURGICAL CO",
                "cik": "0001272661",
                "similarity_score": 0.95
            }
        """
        await self._ensure_cache_loaded()

        if not company_name or not self._ticker_cache:
            return None

        company_name_upper = company_name.upper()
        company_name_clean = self._clean_company_name(company_name).upper()

        # First try exact match
        for ticker, data in self._ticker_cache.items():
            if data["title"] == company_name_upper:
                return {
                    "ticker": ticker,
                    "company_name": data["title"],
                    "cik": str(data["cik_str"]).zfill(10),
                    "similarity_score": 1.0
                }

        # Fuzzy matching - find best match above threshold
        best_match = None
        best_score = 0.0

        for ticker, data in self._ticker_cache.items():
            # Try both raw and cleaned names
            score_raw = self._similarity_score(company_name, data["title"])
            score_clean = self._similarity_score(company_name_clean, self._clean_company_name(data["title"]))
            score = max(score_raw, score_clean)

            if score > best_score and score >= min_similarity:
                best_score = score
                best_match = {
                    "ticker": ticker,
                    "company_name": data["title"],
                    "cik": str(data["cik_str"]).zfill(10),
                    "similarity_score": score
                }

        if best_match:
            logger.info(
                f"Fuzzy matched '{company_name}' to '{best_match['company_name']}' "
                f"({best_match['ticker']}) with score {best_score:.2f}"
            )
        else:
            logger.debug(f"No ticker match found for '{company_name}'")

        return best_match

    async def enrich_deal_with_tickers(
        self,
        target_name: Optional[str] = None,
        acquirer_name: Optional[str] = None,
        target_ticker: Optional[str] = None,
        acquirer_ticker: Optional[str] = None
    ) -> Dict[str, Optional[str]]:
        """
        Enrich deal data with missing ticker symbols.

        Args:
            target_name: Target company name
            acquirer_name: Acquirer company name
            target_ticker: Target ticker (if already known)
            acquirer_ticker: Acquirer ticker (if already known)

        Returns:
            Dict with enriched ticker data:
            {
                "target_ticker": "STAA" or None,
                "acquirer_ticker": "ALC" or None,
                "target_cik": "0001272661" or None,
                "acquirer_cik": "0001234567" or None
            }
        """
        result = {
            "target_ticker": target_ticker,
            "acquirer_ticker": acquirer_ticker,
            "target_cik": None,
            "acquirer_cik": None
        }

        # Look up target ticker if missing
        if target_name and not target_ticker:
            target_data = await self.lookup_by_company_name(target_name)
            if target_data:
                result["target_ticker"] = target_data["ticker"]
                result["target_cik"] = target_data["cik"]
                logger.info(
                    f"Enriched target: '{target_name}' → {target_data['ticker']}"
                )

        # Look up acquirer ticker if missing
        if acquirer_name and not acquirer_ticker:
            acquirer_data = await self.lookup_by_company_name(acquirer_name)
            if acquirer_data:
                result["acquirer_ticker"] = acquirer_data["ticker"]
                result["acquirer_cik"] = acquirer_data["cik"]
                logger.info(
                    f"Enriched acquirer: '{acquirer_name}' → {acquirer_data['ticker']}"
                )

        return result

    async def close(self):
        """Clean up resources"""
        await self.client.aclose()


# Singleton instance
_ticker_lookup_service: Optional[TickerLookupService] = None


def get_ticker_lookup_service() -> TickerLookupService:
    """Get or create the ticker lookup service singleton"""
    global _ticker_lookup_service
    if _ticker_lookup_service is None:
        _ticker_lookup_service = TickerLookupService()
    return _ticker_lookup_service
