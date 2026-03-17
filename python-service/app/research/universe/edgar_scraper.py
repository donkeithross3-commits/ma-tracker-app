"""
EDGAR Historical Scraper — Universe Construction (Phase 1)

Two-source approach for comprehensive M&A deal discovery:
  1. PRIMARY: SEC master index files (quarterly, no result cap)
  2. SECONDARY: EFTS full-text search for 8-K coverage

Both sources feed into research_deal_filings and eventually research_deals
after entity resolution groups filings into deals.
"""

import asyncio
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import AsyncGenerator, Dict, List, Optional, Set, Tuple

import httpx

logger = logging.getLogger(__name__)

# SEC rate limit: 10 req/sec — we target 8 to be safe
SEC_RATE_LIMIT_DELAY = 0.125  # 8 requests/sec

# SEC requires a User-Agent with contact info
SEC_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT",
    "DR3 Research research@dr3-dashboard.com"
)

# M&A-specific SEC form types for master index filtering
MA_FORM_TYPES: Set[str] = {
    # Tender offers
    "SC TO-T",      # Tender offer by third party
    "SC TO-T/A",    # Amendment
    "SC TO-I",      # Issuer tender offer
    "SC TO-I/A",
    # Target responses
    "SC 14D9",      # Solicitation/recommendation statement
    "SC 14D9/A",
    "SC 14D-9",     # Alternate formatting
    "SC 14D-9/A",
    # Proxy statements
    "DEFM14A",      # Definitive merger proxy
    "PREM14A",      # Preliminary merger proxy
    "DEFM14C",      # Definitive information statement (merger)
    "PRELM14A",     # Less common variant
    "DEFA14A",      # Additional definitive proxy material
    # Registration statements (stock deals)
    "S-4",          # Registration for stock-for-stock mergers
    "S-4/A",
    "F-4",          # Foreign private issuer registration
    "F-4/A",
    # Ownership / activist
    "SC 13D",       # Beneficial ownership > 5% with intent
    "SC 13D/A",
}

# Broader set for EFTS text search (includes 8-K which is too common for form-type filter)
EFTS_FORM_TYPES: Set[str] = {
    "8-K", "8-K/A",
}

# M&A keywords for EFTS full-text search
EFTS_SEARCH_QUERIES = [
    '"agreement and plan of merger"',
    '"merger agreement"',
    '"tender offer"',
    '"definitive agreement" AND "acquisition"',
]


@dataclass
class RawFiling:
    """A filing record from either master index or EFTS search."""
    cik: str
    company_name: str
    form_type: str
    filing_date: date
    accession_number: str
    filename: Optional[str] = None  # path within EDGAR archives
    source: str = "master_index"    # master_index or efts
    # EFTS-specific fields
    efts_description: Optional[str] = None
    efts_file_number: Optional[str] = None

    @property
    def filing_url(self) -> str:
        """Construct the filing index URL from accession number and CIK."""
        acc_no_dashes = self.accession_number.replace("-", "")
        if self.filename:
            return f"https://www.sec.gov/Archives/edgar/data/{self.cik}/{acc_no_dashes}/{self.filename}"
        return f"https://www.sec.gov/Archives/edgar/data/{self.cik}/{acc_no_dashes}/{self.accession_number}-index.htm"

    @property
    def index_url(self) -> str:
        """Filing index page URL."""
        acc_no_dashes = self.accession_number.replace("-", "")
        return f"https://www.sec.gov/Archives/edgar/data/{self.cik}/{acc_no_dashes}/{self.accession_number}-index.htm"


@dataclass
class ScrapeProgress:
    """Track scraping progress for resumability."""
    total_quarters: int = 0
    completed_quarters: int = 0
    total_filings_found: int = 0
    total_ma_filings: int = 0
    unique_ciks: Set[str] = field(default_factory=set)
    errors: List[str] = field(default_factory=list)
    current_phase: str = ""

    @property
    def pct_complete(self) -> float:
        if self.total_quarters == 0:
            return 0.0
        return (self.completed_quarters / self.total_quarters) * 100


class EdgarMasterIndexScraper:
    """
    Downloads and parses SEC EDGAR quarterly master index files.

    The master index is the PRIMARY source for universe construction because
    it has NO result cap (unlike EFTS's 10K hard limit per query).

    Files are at: sec.gov/Archives/edgar/full-index/{YEAR}/QTR{Q}/master.idx
    Format: pipe-delimited with columns: CIK|Company Name|Form Type|Date Filed|Filename
    """

    def __init__(self, start_year: int = 2016, end_year: int = 2026):
        self.start_year = start_year
        self.end_year = end_year
        self.client: Optional[httpx.AsyncClient] = None
        self.progress = ScrapeProgress()

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=60.0,
                headers={
                    "User-Agent": SEC_USER_AGENT,
                    "Accept-Encoding": "gzip, deflate",
                },
                follow_redirects=True,
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    def _quarter_range(self) -> List[Tuple[int, int]]:
        """Generate (year, quarter) pairs for the date range."""
        quarters = []
        current_year = datetime.now().year
        current_quarter = (datetime.now().month - 1) // 3 + 1

        for year in range(self.start_year, self.end_year + 1):
            for qtr in range(1, 5):
                # Don't request future quarters
                if year > current_year or (year == current_year and qtr > current_quarter):
                    break
                quarters.append((year, qtr))
        return quarters

    async def download_master_index(self, year: int, quarter: int) -> List[RawFiling]:
        """
        Download and parse a single quarterly master index file.

        Returns all M&A-related filings found in that quarter.
        """
        url = f"https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{quarter}/master.idx"
        client = await self._get_client()

        try:
            await asyncio.sleep(SEC_RATE_LIMIT_DELAY)
            response = await client.get(url)
            response.raise_for_status()

            text = response.text
            filings = []

            for line in text.split("\n"):
                # Skip header lines (master.idx has variable header, then data)
                if "|" not in line:
                    continue

                parts = line.split("|")
                if len(parts) < 5:
                    continue

                cik = parts[0].strip()
                company_name = parts[1].strip()
                form_type = parts[2].strip()
                date_filed = parts[3].strip()
                filename = parts[4].strip()

                # Skip if not numeric CIK (header line)
                if not cik.isdigit():
                    continue

                # Filter for M&A form types
                if form_type not in MA_FORM_TYPES:
                    continue

                # Parse date
                try:
                    filing_date_parsed = datetime.strptime(date_filed, "%Y-%m-%d").date()
                except ValueError:
                    continue

                # Extract accession number from filename
                # Filename format: edgar/data/{CIK}/{ACCESSION_NO_DASHES}/{filename}
                accession_match = re.search(r"edgar/data/\d+/(\d{10}-\d{2}-\d{6})/", filename)
                if not accession_match:
                    # Try alternate: accession number without dashes in path
                    acc_match2 = re.search(r"edgar/data/\d+/(\d+)/", filename)
                    if acc_match2:
                        raw = acc_match2.group(1)
                        if len(raw) == 18:
                            accession_number = f"{raw[:10]}-{raw[10:12]}-{raw[12:]}"
                        else:
                            continue
                    else:
                        continue
                else:
                    accession_number = accession_match.group(1)

                # Extract just the filename part
                doc_filename = filename.split("/")[-1] if "/" in filename else filename

                filing = RawFiling(
                    cik=cik.zfill(10),
                    company_name=company_name,
                    form_type=form_type,
                    filing_date=filing_date_parsed,
                    accession_number=accession_number,
                    filename=doc_filename,
                    source="master_index",
                )
                filings.append(filing)

            logger.info(f"Master index {year}/QTR{quarter}: {len(filings)} M&A filings")
            return filings

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"Master index not found: {year}/QTR{quarter} (may be future)")
                return []
            raise
        except Exception as e:
            error_msg = f"Error downloading master index {year}/QTR{quarter}: {e}"
            logger.error(error_msg)
            self.progress.errors.append(error_msg)
            return []

    async def scrape_all_quarters(self) -> List[RawFiling]:
        """
        Download all quarterly master index files and extract M&A filings.

        Returns combined list of all M&A filings across the date range.
        """
        quarters = self._quarter_range()
        self.progress.total_quarters = len(quarters)
        self.progress.current_phase = "master_index"

        all_filings: List[RawFiling] = []

        for year, qtr in quarters:
            filings = await self.download_master_index(year, qtr)
            all_filings.extend(filings)

            self.progress.completed_quarters += 1
            self.progress.total_ma_filings = len(all_filings)
            for f in filings:
                self.progress.unique_ciks.add(f.cik)

            logger.info(
                f"Progress: {self.progress.completed_quarters}/{self.progress.total_quarters} "
                f"quarters, {len(all_filings)} M&A filings, "
                f"{len(self.progress.unique_ciks)} unique CIKs"
            )

        logger.info(
            f"Master index scrape complete: {len(all_filings)} M&A filings "
            f"from {len(self.progress.unique_ciks)} unique CIKs"
        )
        return all_filings


class EdgarEFTSSearcher:
    """
    Searches SEC EFTS (Electronic Full-Text Search) for additional M&A filings.

    SECONDARY source: catches 8-K Item 1.01 announcements that precede proxy filings.

    Endpoint: https://efts.sec.gov/LATEST/search-index
    CRITICAL: EFTS has a hard 10K result cap per query — partition by year.
    """

    def __init__(self, start_year: int = 2016, end_year: int = 2026):
        self.start_year = start_year
        self.end_year = end_year
        self.client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=30.0,
                headers={
                    "User-Agent": SEC_USER_AGENT,
                    "Accept-Encoding": "gzip, deflate",
                },
                follow_redirects=True,
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def search_filings(
        self,
        query: str,
        date_range_start: str,
        date_range_end: str,
        forms: Optional[List[str]] = None,
        start_from: int = 0,
    ) -> Tuple[List[RawFiling], int]:
        """
        Execute a single EFTS search query.

        Args:
            query: Full-text search query (supports AND/OR/quotes)
            date_range_start: Start date YYYY-MM-DD
            date_range_end: End date YYYY-MM-DD
            forms: List of form types to filter (e.g., ["8-K"])
            start_from: Pagination offset

        Returns:
            (filings, total_hits) tuple
        """
        client = await self._get_client()

        params = {
            "q": query,
            "dateRange": "custom",
            "startdt": date_range_start,
            "enddt": date_range_end,
            "from": start_from,
        }
        if forms:
            params["forms"] = ",".join(forms)

        try:
            await asyncio.sleep(SEC_RATE_LIMIT_DELAY)
            response = await client.get(
                "https://efts.sec.gov/LATEST/search-index",
                params=params,
            )
            response.raise_for_status()

            data = response.json()
            total_hits = data.get("hits", {}).get("total", {}).get("value", 0)
            hits = data.get("hits", {}).get("hits", [])

            filings = []
            for hit in hits:
                source = hit.get("_source", {})

                # Parse filing date
                date_str = source.get("file_date", "")
                try:
                    filing_date_parsed = datetime.strptime(date_str, "%Y-%m-%d").date()
                except ValueError:
                    continue

                # Extract CIK
                cik = str(source.get("entity_id", "")).zfill(10)
                if not cik or cik == "0000000000":
                    continue

                filing = RawFiling(
                    cik=cik,
                    company_name=source.get("entity_name", "Unknown"),
                    form_type=source.get("file_type", ""),
                    filing_date=filing_date_parsed,
                    accession_number=source.get("accession_no", ""),
                    source="efts",
                    efts_description=source.get("file_description", ""),
                    efts_file_number=source.get("file_num", ""),
                )
                filings.append(filing)

            return filings, total_hits

        except Exception as e:
            logger.error(f"EFTS search error: {e}")
            return [], 0

    async def search_year(
        self,
        query: str,
        year: int,
        forms: Optional[List[str]] = None,
    ) -> List[RawFiling]:
        """
        Search EFTS for a single year, handling pagination.

        Partitioning by year keeps results under EFTS's 10K cap.
        """
        date_start = f"{year}-01-01"
        date_end = f"{year}-12-31"

        all_filings: List[RawFiling] = []
        offset = 0
        page_size = 100  # EFTS returns max 100 per page

        while True:
            filings, total_hits = await self.search_filings(
                query=query,
                date_range_start=date_start,
                date_range_end=date_end,
                forms=forms,
                start_from=offset,
            )

            if not filings:
                break

            all_filings.extend(filings)
            offset += page_size

            # Safety: stop at 10K (EFTS hard cap)
            if offset >= min(total_hits, 10000):
                if total_hits > 10000:
                    logger.warning(
                        f"EFTS query '{query}' year={year}: {total_hits} total hits "
                        f"exceeds 10K cap. Results truncated."
                    )
                break

            logger.debug(f"EFTS pagination: {offset}/{total_hits} for year {year}")

        return all_filings

    async def search_all_years(self) -> List[RawFiling]:
        """
        Run all EFTS search queries across all years.

        Returns combined, deduplicated list of filings.
        """
        seen_accessions: Set[str] = set()
        all_filings: List[RawFiling] = []

        for year in range(self.start_year, self.end_year + 1):
            for query in EFTS_SEARCH_QUERIES:
                filings = await self.search_year(
                    query=query,
                    year=year,
                    forms=list(EFTS_FORM_TYPES),
                )

                new_count = 0
                for f in filings:
                    if f.accession_number not in seen_accessions:
                        seen_accessions.add(f.accession_number)
                        all_filings.append(f)
                        new_count += 1

                logger.info(
                    f"EFTS year={year} query='{query[:40]}...': "
                    f"{len(filings)} hits, {new_count} new"
                )

        logger.info(f"EFTS search complete: {len(all_filings)} unique 8-K filings")
        return all_filings


class CompanyMetadataResolver:
    """
    Resolves company metadata from SEC APIs.

    Uses:
      - sec.gov/files/company_tickers.json for CIK→ticker mapping
      - data.sec.gov/submissions/CIK{cik}.json for full company metadata
    """

    def __init__(self):
        self.client: Optional[httpx.AsyncClient] = None
        self._ticker_map: Optional[Dict[str, dict]] = None  # CIK → {ticker, name}
        self._reverse_ticker_map: Optional[Dict[str, str]] = None  # ticker → CIK

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=30.0,
                headers={
                    "User-Agent": SEC_USER_AGENT,
                    "Accept-Encoding": "gzip, deflate",
                    "Host": "data.sec.gov",
                },
                follow_redirects=True,
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def load_ticker_map(self) -> Dict[str, dict]:
        """
        Load the SEC CIK-to-ticker mapping.
        Returns dict keyed by zero-padded CIK.
        """
        if self._ticker_map is not None:
            return self._ticker_map

        client = await self._get_client()
        await asyncio.sleep(SEC_RATE_LIMIT_DELAY)

        response = await client.get("https://www.sec.gov/files/company_tickers.json")
        response.raise_for_status()
        data = response.json()

        self._ticker_map = {}
        self._reverse_ticker_map = {}

        for entry in data.values():
            cik = str(entry.get("cik_str", "")).zfill(10)
            ticker = entry.get("ticker", "")
            name = entry.get("title", "")

            self._ticker_map[cik] = {"ticker": ticker, "name": name}
            if ticker:
                self._reverse_ticker_map[ticker.upper()] = cik

        logger.info(f"Loaded {len(self._ticker_map)} CIK-ticker mappings")
        return self._ticker_map

    async def cik_to_ticker(self, cik: str) -> Optional[str]:
        """Look up ticker for a CIK."""
        ticker_map = await self.load_ticker_map()
        padded = cik.zfill(10)
        entry = ticker_map.get(padded)
        return entry["ticker"] if entry else None

    async def ticker_to_cik(self, ticker: str) -> Optional[str]:
        """Look up CIK for a ticker."""
        await self.load_ticker_map()
        return self._reverse_ticker_map.get(ticker.upper()) if self._reverse_ticker_map else None

    async def get_company_metadata(self, cik: str) -> Optional[dict]:
        """
        Fetch full company metadata from SEC submissions API.

        Returns dict with: name, tickers, sic, sicDescription, exchanges, stateOfIncorporation,
        ein, category, fiscalYearEnd, filings (recent + historical)
        """
        client = await self._get_client()
        padded = cik.zfill(10)

        try:
            await asyncio.sleep(SEC_RATE_LIMIT_DELAY)
            response = await client.get(
                f"https://data.sec.gov/submissions/CIK{padded}.json"
            )
            response.raise_for_status()
            data = response.json()

            return {
                "cik": padded,
                "name": data.get("name", ""),
                "tickers": data.get("tickers", []),
                "sic": data.get("sic", ""),
                "sic_description": data.get("sicDescription", ""),
                "exchanges": data.get("exchanges", []),
                "state": data.get("stateOfIncorporation", ""),
                "category": data.get("category", ""),
                "fiscal_year_end": data.get("fiscalYearEnd", ""),
                "entity_type": data.get("entityType", ""),
            }

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"No SEC data for CIK {padded}")
                return None
            raise
        except Exception as e:
            logger.error(f"Error fetching metadata for CIK {padded}: {e}")
            return None

    async def get_filings_for_cik(
        self,
        cik: str,
        form_types: Optional[Set[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[RawFiling]:
        """
        Get all filings for a CIK from the submissions API.

        This is useful for filling gaps after master index discovery.
        """
        client = await self._get_client()
        padded = cik.zfill(10)

        try:
            await asyncio.sleep(SEC_RATE_LIMIT_DELAY)
            response = await client.get(
                f"https://data.sec.gov/submissions/CIK{padded}.json"
            )
            response.raise_for_status()
            data = response.json()

            company_name = data.get("name", "Unknown")
            recent = data.get("filings", {}).get("recent", {})

            accessions = recent.get("accessionNumber", [])
            dates = recent.get("filingDate", [])
            forms = recent.get("form", [])
            primary_docs = recent.get("primaryDocument", [])

            filings = []
            for i in range(len(accessions)):
                form_type = forms[i]

                if form_types and form_type not in form_types:
                    continue

                try:
                    filing_dt = datetime.strptime(dates[i], "%Y-%m-%d").date()
                except ValueError:
                    continue

                if start_date and filing_dt < start_date:
                    continue
                if end_date and filing_dt > end_date:
                    continue

                doc_name = primary_docs[i] if i < len(primary_docs) else None

                filing = RawFiling(
                    cik=padded,
                    company_name=company_name,
                    form_type=form_type,
                    filing_date=filing_dt,
                    accession_number=accessions[i],
                    filename=doc_name,
                    source="submissions_api",
                )
                filings.append(filing)

            return filings

        except Exception as e:
            logger.error(f"Error fetching filings for CIK {padded}: {e}")
            return []


def deduplicate_filings(filings: List[RawFiling]) -> List[RawFiling]:
    """
    Deduplicate filings by accession number, preferring master_index source.
    """
    by_accession: Dict[str, RawFiling] = {}

    for f in filings:
        key = f.accession_number
        if key not in by_accession:
            by_accession[key] = f
        elif f.source == "master_index" and by_accession[key].source != "master_index":
            # Prefer master index records (they have filenames)
            by_accession[key] = f

    result = list(by_accession.values())
    logger.info(f"Deduplication: {len(filings)} → {len(result)} unique filings")
    return result
