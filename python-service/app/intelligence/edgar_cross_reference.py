"""
EDGAR cross-reference module for deal corroboration.

When a deal is detected from non-regulatory sources (news, social media),
automatically searches EDGAR for corroborating filings to boost confidence.
"""
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import asyncpg

from app.intelligence.models import DealMention, SourceType, MentionType

logger = logging.getLogger(__name__)


# M&A-relevant filing types (in order of importance/reliability)
MA_FILING_TYPES = [
    # Highest confidence - definitive agreements
    "DEFM14A",  # Definitive proxy statement for merger
    "PREM14A",  # Preliminary proxy statement for merger

    # High confidence - material events
    "8-K",      # Current report (Item 1.01 for material definitive agreements)

    # High confidence - tender offers
    "SC TO",    # Tender offer statement
    "SC 13D",   # Beneficial ownership report (often filed in takeover situations)
    "SC 13E3",  # Going private transaction

    # Medium confidence - S-4 for mergers
    "S-4",      # Registration statement for business combinations

    # Lower confidence but relevant
    "13D",      # Beneficial ownership report
    "Schedule 13D",
]


class EdgarCrossReference:
    """
    Cross-references deal mentions with EDGAR filings for validation.

    When a deal is detected by news/social media sources, this module:
    1. Searches EDGAR for recent filings by the target company
    2. Identifies M&A-relevant filings
    3. Returns corroborating evidence to boost confidence
    """

    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool

    async def search_corroborating_filings(
        self,
        target_name: str,
        target_ticker: Optional[str] = None,
        acquirer_name: Optional[str] = None,
        days_lookback: int = 90
    ) -> List[Dict[str, Any]]:
        """
        Search for EDGAR filings that could corroborate a deal.

        Args:
            target_name: Name of target company
            target_ticker: Stock ticker of target (optional but recommended)
            acquirer_name: Name of acquirer (optional)
            days_lookback: How many days to look back for filings

        Returns:
            List of relevant filings with metadata
        """
        async with self.pool.acquire() as conn:
            # Build search query - prefer ticker match, fallback to name
            cutoff_date = datetime.utcnow() - timedelta(days=days_lookback)

            filings = []

            # First try ticker-based search (most reliable)
            if target_ticker:
                filings = await self._search_by_ticker(
                    conn, target_ticker, cutoff_date
                )
                logger.info(
                    f"EDGAR search for ticker {target_ticker}: found {len(filings)} filings"
                )

            # If no ticker or no results, try company name search
            if not filings:
                filings = await self._search_by_company_name(
                    conn, target_name, cutoff_date
                )
                logger.info(
                    f"EDGAR search for company '{target_name}': found {len(filings)} filings"
                )

            # Filter for M&A-relevant filings
            ma_filings = self._filter_ma_relevant_filings(filings)

            # Sort by filing type importance and date
            ma_filings = self._rank_filings(ma_filings)

            logger.info(
                f"Found {len(ma_filings)} M&A-relevant EDGAR filings for {target_name}"
            )

            return ma_filings

    async def _search_by_ticker(
        self,
        conn: asyncpg.Connection,
        ticker: str,
        cutoff_date: datetime
    ) -> List[Dict[str, Any]]:
        """Search EDGAR filings by stock ticker"""
        rows = await conn.fetch(
            """
            SELECT
                filing_id,
                accession_number,
                company_name,
                ticker,
                filing_type,
                filing_date,
                filing_url,
                is_ma_relevant,
                confidence_score,
                detected_keywords
            FROM edgar_filings
            WHERE ticker = $1
              AND filing_date >= $2
              AND status = 'analyzed'
            ORDER BY filing_date DESC
            """,
            ticker.upper(),
            cutoff_date
        )

        return [dict(row) for row in rows]

    async def _search_by_company_name(
        self,
        conn: asyncpg.Connection,
        company_name: str,
        cutoff_date: datetime
    ) -> List[Dict[str, Any]]:
        """Search EDGAR filings by company name (fuzzy match)"""
        # Use ILIKE for case-insensitive pattern matching
        search_pattern = f"%{company_name}%"

        rows = await conn.fetch(
            """
            SELECT
                filing_id,
                accession_number,
                company_name,
                ticker,
                filing_type,
                filing_date,
                filing_url,
                is_ma_relevant,
                confidence_score,
                detected_keywords
            FROM edgar_filings
            WHERE company_name ILIKE $1
              AND filing_date >= $2
              AND status = 'analyzed'
            ORDER BY filing_date DESC
            """,
            search_pattern,
            cutoff_date
        )

        return [dict(row) for row in rows]

    def _filter_ma_relevant_filings(
        self, filings: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Filter for M&A-relevant filing types"""
        ma_filings = []

        for filing in filings:
            filing_type = filing["filing_type"]

            # Check if filing type matches our M&A list
            is_ma_type = any(
                ma_type in filing_type
                for ma_type in MA_FILING_TYPES
            )

            # Also include filings marked as M&A relevant by detector
            is_detected_ma = filing.get("is_ma_relevant", False)

            if is_ma_type or is_detected_ma:
                ma_filings.append(filing)

        return ma_filings

    def _rank_filings(
        self, filings: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Rank filings by importance (filing type) and recency"""
        def get_filing_rank(filing: Dict[str, Any]) -> int:
            """Get rank for filing type (lower = more important)"""
            filing_type = filing["filing_type"]

            for i, ma_type in enumerate(MA_FILING_TYPES):
                if ma_type in filing_type:
                    return i

            # If not in our list but marked as MA relevant, give it medium priority
            if filing.get("is_ma_relevant"):
                return len(MA_FILING_TYPES) // 2

            return len(MA_FILING_TYPES)

        # Sort by rank (ascending) and date (descending)
        return sorted(
            filings,
            key=lambda f: (get_filing_rank(f), -f["filing_date"].timestamp())
        )

    def create_deal_mention_from_filing(
        self,
        filing: Dict[str, Any],
        deal_id: str
    ) -> DealMention:
        """
        Convert an EDGAR filing into a DealMention for adding to deal sources.

        This allows EDGAR filings to be treated as additional sources
        that corroborate the deal.
        """
        # Determine mention type based on filing type
        filing_type = filing["filing_type"]
        if any(ft in filing_type for ft in ["DEFM14A", "PREM14A", "SC TO", "SC 13E3"]):
            mention_type = MentionType.ANNOUNCEMENT
        elif "8-K" in filing_type:
            mention_type = MentionType.ANNOUNCEMENT
        else:
            mention_type = MentionType.FILING

        # EDGAR filings are highly credible (0.95)
        credibility_score = 0.95

        # Create headline from filing type
        headline = f"{filing['filing_type']} filed by {filing['company_name']}"

        # Extract key info for content snippet
        keywords = filing.get("detected_keywords", [])
        if keywords:
            content_snippet = f"M&A keywords detected: {', '.join(keywords[:5])}"
        else:
            content_snippet = f"{filing['filing_type']} filing detected"

        # Build extracted data
        extracted_data = {
            "filing_type": filing["filing_type"],
            "filing_date": filing["filing_date"].isoformat(),
            "accession_number": filing["accession_number"],
            "detected_keywords": keywords
        }

        if filing.get("confidence_score"):
            extracted_data["ma_confidence"] = filing["confidence_score"]

        return DealMention(
            source_name="edgar",
            source_type=SourceType.OFFICIAL,
            source_url=filing["filing_url"],
            mention_type=mention_type,
            target_name=filing["company_name"],
            target_ticker=filing.get("ticker"),
            acquirer_name=None,  # Would need to extract from filing content
            credibility_score=credibility_score,
            headline=headline,
            content_snippet=content_snippet,
            extracted_data=extracted_data,
            source_published_at=filing["filing_date"]
        )

    async def create_cross_reference_log(
        self,
        conn: asyncpg.Connection,
        deal_id: str,
        search_params: Dict[str, Any],
        filings_found: List[Dict[str, Any]],
        confidence_impact: float
    ) -> None:
        """
        Log EDGAR cross-reference search for transparency.

        Stores what was searched, what was found, and how it impacted confidence.
        This allows users to understand the confidence calculation.
        """
        # Create a transparency log entry
        await conn.execute(
            """
            INSERT INTO deal_history (
                deal_id,
                change_type,
                old_value,
                new_value,
                triggered_by,
                notes
            ) VALUES ($1, $2, $3, $4, $5, $6)
            """,
            deal_id,
            "edgar_cross_reference",
            {"search_params": search_params},
            {
                "filings_found": len(filings_found),
                "filing_types": [f["filing_type"] for f in filings_found[:3]],  # Top 3
                "confidence_impact": confidence_impact
            },
            "system",
            f"Automatic EDGAR cross-reference found {len(filings_found)} relevant filing(s)"
        )

        logger.info(
            f"EDGAR cross-reference for deal {deal_id}: "
            f"found {len(filings_found)} filings, "
            f"confidence impact: +{confidence_impact:.1%}"
        )
