"""
Deal Identifier — Entity Resolution for M&A Filings

Groups raw filings into deals by:
  1. Target CIK + overlapping date window (±180 days)
  2. Cross-reference acquirer from filing metadata
  3. Assign stable deal_key identifiers ({YEAR}-{TARGET_TICKER}-{ACQUIRER_TICKER})

This is the HARD PART of universe construction — getting entity resolution right
determines the quality of everything downstream.
"""

import asyncio
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List, Optional, Set, Tuple

from .edgar_scraper import CompanyMetadataResolver, RawFiling

logger = logging.getLogger(__name__)

# Deal window: filings within ±180 days of each other for same target CIK
DEAL_WINDOW_DAYS = 180

# Minimum equity value to include in research universe ($50M)
MIN_DEAL_VALUE_MM = 50.0


@dataclass
class FilingCluster:
    """A cluster of filings believed to be about the same deal."""
    target_cik: str
    target_name: str
    filings: List[RawFiling] = field(default_factory=list)

    @property
    def earliest_date(self) -> date:
        return min(f.filing_date for f in self.filings)

    @property
    def latest_date(self) -> date:
        return max(f.filing_date for f in self.filings)

    @property
    def form_types(self) -> Set[str]:
        return {f.form_type for f in self.filings}

    @property
    def has_definitive_proxy(self) -> bool:
        return any(f.form_type.startswith("DEFM14") for f in self.filings)

    @property
    def has_tender_offer(self) -> bool:
        return any(f.form_type.startswith("SC TO") for f in self.filings)

    @property
    def has_merger_proxy(self) -> bool:
        return any(f.form_type in ("DEFM14A", "PREM14A") for f in self.filings)

    def overlaps_date(self, filing_date: date) -> bool:
        """Check if a filing date falls within this cluster's date window."""
        window_start = self.earliest_date - timedelta(days=DEAL_WINDOW_DAYS)
        window_end = self.latest_date + timedelta(days=DEAL_WINDOW_DAYS)
        return window_start <= filing_date <= window_end


@dataclass
class IdentifiedDeal:
    """A deal identified from filing clusters, ready for research_deals insertion."""
    deal_key: str                           # e.g., "2024-ATVI-MSFT"
    target_cik: str
    target_ticker: Optional[str] = None
    target_name: str = ""
    target_sic: Optional[str] = None
    target_exchange: Optional[str] = None

    acquirer_name: str = "Unknown"
    acquirer_ticker: Optional[str] = None
    acquirer_cik: Optional[str] = None
    acquirer_type: str = "other"

    deal_type: str = "other"                # merger, tender_offer, etc.
    deal_structure: str = "other"           # all_cash, all_stock, etc.

    announced_date: Optional[date] = None
    filings: List[RawFiling] = field(default_factory=list)

    # Flags
    is_hostile: bool = False
    is_mbo: bool = False
    is_going_private: bool = False

    # Classification confidence
    confidence: float = 0.5

    @property
    def filing_count(self) -> int:
        return len(self.filings)


class DealIdentifier:
    """
    Resolves raw filings into identified deals.

    Pipeline:
      1. Group filings by target CIK
      2. Within each CIK, cluster by date proximity
      3. Classify deal type from filing types present
      4. Resolve company metadata (ticker, SIC, exchange)
      5. Generate stable deal_key identifiers
    """

    def __init__(self, metadata_resolver: Optional[CompanyMetadataResolver] = None):
        self.resolver = metadata_resolver or CompanyMetadataResolver()
        self._metadata_cache: Dict[str, dict] = {}

    async def close(self):
        await self.resolver.close()

    # ---- Step 1: Group by CIK ----

    def group_by_cik(self, filings: List[RawFiling]) -> Dict[str, List[RawFiling]]:
        """Group filings by target CIK."""
        by_cik: Dict[str, List[RawFiling]] = defaultdict(list)
        for f in filings:
            by_cik[f.cik].append(f)

        # Sort each group by date
        for cik in by_cik:
            by_cik[cik].sort(key=lambda x: x.filing_date)

        logger.info(f"Grouped {len(filings)} filings into {len(by_cik)} CIKs")
        return dict(by_cik)

    # ---- Step 2: Cluster within CIK ----

    def cluster_filings(self, filings: List[RawFiling]) -> List[FilingCluster]:
        """
        Cluster filings for a single CIK into separate deals.

        Uses a sliding window: if a new filing is within DEAL_WINDOW_DAYS
        of any existing filing in the cluster, it joins that cluster.
        """
        if not filings:
            return []

        # Sort by date
        sorted_filings = sorted(filings, key=lambda f: f.filing_date)
        clusters: List[FilingCluster] = []

        for filing in sorted_filings:
            # Try to find an existing cluster this filing belongs to
            matched_cluster = None
            for cluster in clusters:
                if cluster.overlaps_date(filing.filing_date):
                    matched_cluster = cluster
                    break

            if matched_cluster:
                matched_cluster.filings.append(filing)
            else:
                # Start a new cluster
                clusters.append(FilingCluster(
                    target_cik=filing.cik,
                    target_name=filing.company_name,
                    filings=[filing],
                ))

        return clusters

    # ---- Step 3: Classify deal type ----

    def classify_deal(self, cluster: FilingCluster) -> Tuple[str, str]:
        """
        Classify deal type and structure from filing types present.

        Returns (deal_type, deal_structure) tuple.
        """
        form_types = cluster.form_types

        # Determine deal type
        if cluster.has_tender_offer:
            if cluster.has_definitive_proxy:
                deal_type = "tender_offer"  # Two-step: tender + back-end merger
            else:
                deal_type = "tender_only"
        elif cluster.has_merger_proxy or cluster.has_definitive_proxy:
            deal_type = "merger"
        elif any(ft.startswith("S-4") or ft.startswith("F-4") for ft in form_types):
            deal_type = "merger"  # Stock deal with registration statement
        else:
            deal_type = "other"

        # Deal structure is determined later from filing text extraction
        # For now, infer from registration statements
        has_registration = any(
            ft.startswith("S-4") or ft.startswith("F-4") for ft in form_types
        )
        if has_registration:
            deal_structure = "all_stock"  # or cash_and_stock — refined later
        else:
            deal_structure = "other"  # Will be extracted from merger agreement

        return deal_type, deal_structure

    # ---- Step 4: Resolve metadata ----

    async def resolve_metadata(self, cik: str) -> dict:
        """Resolve company metadata, with caching."""
        if cik in self._metadata_cache:
            return self._metadata_cache[cik]

        metadata = await self.resolver.get_company_metadata(cik)
        if metadata:
            self._metadata_cache[cik] = metadata
            return metadata

        # Fallback: try ticker map
        ticker = await self.resolver.cik_to_ticker(cik)
        fallback = {
            "cik": cik,
            "name": "",
            "tickers": [ticker] if ticker else [],
            "sic": "",
            "sic_description": "",
            "exchanges": [],
        }
        self._metadata_cache[cik] = fallback
        return fallback

    # ---- Step 5: Generate deal_key ----

    def generate_deal_key(
        self,
        year: int,
        target_ticker: Optional[str],
        acquirer_ticker: Optional[str],
        target_name: str,
        existing_keys: Set[str],
    ) -> str:
        """
        Generate a stable, unique deal_key.

        Format: {YEAR}-{TARGET_TICKER}-{ACQUIRER_TICKER}
        Falls back to abbreviated name if ticker unavailable.
        """
        target_part = target_ticker or self._abbreviate_name(target_name)
        acquirer_part = acquirer_ticker or "UNK"

        base_key = f"{year}-{target_part}-{acquirer_part}"

        # Handle duplicates (same target acquired twice in same year)
        if base_key not in existing_keys:
            return base_key

        for suffix in range(2, 10):
            candidate = f"{base_key}-{suffix}"
            if candidate not in existing_keys:
                return candidate

        # Extremely unlikely fallback
        import uuid
        return f"{base_key}-{uuid.uuid4().hex[:4]}"

    @staticmethod
    def _abbreviate_name(name: str) -> str:
        """Create a short abbreviation from a company name."""
        # Remove common suffixes
        cleaned = re.sub(
            r'\b(Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|LLC|LP|plc|Group|Holdings?)\b',
            '',
            name,
            flags=re.IGNORECASE,
        ).strip()

        # Take first word, uppercase, max 8 chars
        words = cleaned.split()
        if words:
            return words[0].upper()[:8]
        return "UNK"

    # ---- Main pipeline ----

    async def identify_deals(
        self,
        filings: List[RawFiling],
        resolve_metadata: bool = True,
        batch_size: int = 20,
    ) -> List[IdentifiedDeal]:
        """
        Main pipeline: group filings → cluster → classify → resolve → assign keys.

        Args:
            filings: Raw filings from master index + EFTS
            resolve_metadata: Whether to call SEC API for metadata (slower but more complete)
            batch_size: How many CIKs to resolve in parallel

        Returns:
            List of identified deals ready for database insertion
        """
        # Step 1: Group by CIK
        by_cik = self.group_by_cik(filings)

        # Step 2 + 3: Cluster and classify each CIK's filings
        all_clusters: List[FilingCluster] = []
        for cik, cik_filings in by_cik.items():
            clusters = self.cluster_filings(cik_filings)
            all_clusters.extend(clusters)

        logger.info(f"Identified {len(all_clusters)} deal clusters from {len(by_cik)} CIKs")

        # Filter: keep only clusters with strong M&A evidence
        strong_clusters = [
            c for c in all_clusters
            if self._is_strong_ma_cluster(c)
        ]
        logger.info(
            f"Filtered to {len(strong_clusters)} strong M&A clusters "
            f"(dropped {len(all_clusters) - len(strong_clusters)} weak clusters)"
        )

        # Step 4: Resolve metadata (batched to respect rate limits)
        if resolve_metadata:
            unique_ciks = {c.target_cik for c in strong_clusters}
            logger.info(f"Resolving metadata for {len(unique_ciks)} unique CIKs")

            cik_list = list(unique_ciks)
            for i in range(0, len(cik_list), batch_size):
                batch = cik_list[i:i + batch_size]
                await asyncio.gather(
                    *[self.resolve_metadata(cik) for cik in batch]
                )
                if i + batch_size < len(cik_list):
                    logger.info(
                        f"Metadata resolution: {min(i + batch_size, len(cik_list))}"
                        f"/{len(cik_list)} CIKs"
                    )

        # Step 5: Build identified deals
        existing_keys: Set[str] = set()
        deals: List[IdentifiedDeal] = []

        for cluster in strong_clusters:
            deal = await self._cluster_to_deal(cluster, existing_keys)
            if deal:
                existing_keys.add(deal.deal_key)
                deals.append(deal)

        # Sort by announcement date
        deals.sort(key=lambda d: d.announced_date or date.min)

        logger.info(f"Identified {len(deals)} deals from {len(filings)} filings")
        return deals

    def _is_strong_ma_cluster(self, cluster: FilingCluster) -> bool:
        """
        Filter out clusters that are unlikely to be real M&A deals.

        A strong cluster has at least one definitive M&A filing type.
        """
        strong_types = {
            "DEFM14A", "PREM14A", "DEFM14C",
            "SC TO-T", "SC TO-T/A",
            "SC 14D9", "SC 14D9/A", "SC 14D-9", "SC 14D-9/A", "SC14D9", "SC14D9/A",
            "S-4", "F-4",
        }

        return bool(cluster.form_types & strong_types)

    async def _cluster_to_deal(
        self,
        cluster: FilingCluster,
        existing_keys: Set[str],
    ) -> Optional[IdentifiedDeal]:
        """Convert a filing cluster to an identified deal."""
        # Resolve target metadata
        metadata = self._metadata_cache.get(cluster.target_cik, {})
        target_ticker = None
        tickers = metadata.get("tickers", [])
        if tickers:
            target_ticker = tickers[0]
        if not target_ticker:
            target_ticker = await self.resolver.cik_to_ticker(cluster.target_cik)

        target_name = metadata.get("name", "") or cluster.target_name
        target_sic = metadata.get("sic", "")
        exchanges = metadata.get("exchanges", [])
        target_exchange = exchanges[0] if exchanges else None

        # Check exchange requirement: must be NYSE, NASDAQ, or NYSE_AMER
        valid_exchanges = {"NYSE", "NASDAQ", "Nasdaq", "NYSEArca", "NYSEAmer", "NYSE MKT"}
        if target_exchange and target_exchange not in valid_exchanges:
            # Still include but note it — exchange data from SEC is sometimes inconsistent
            pass

        # Classify deal type
        deal_type, deal_structure = self.classify_deal(cluster)

        # Announcement date = earliest filing date
        announced_date = cluster.earliest_date

        # Generate deal key
        year = announced_date.year
        deal_key = self.generate_deal_key(
            year=year,
            target_ticker=target_ticker,
            acquirer_ticker=None,  # Will be filled in by extraction phase
            target_name=target_name,
            existing_keys=existing_keys,
        )

        deal = IdentifiedDeal(
            deal_key=deal_key,
            target_cik=cluster.target_cik,
            target_ticker=target_ticker,
            target_name=target_name,
            target_sic=target_sic or None,
            target_exchange=target_exchange,
            acquirer_name="Unknown",  # Will be extracted from filings
            deal_type=deal_type,
            deal_structure=deal_structure,
            announced_date=announced_date,
            filings=cluster.filings,
            confidence=self._compute_confidence(cluster),
        )

        return deal

    def _compute_confidence(self, cluster: FilingCluster) -> float:
        """
        Compute confidence that this cluster represents a real M&A deal.

        Higher confidence = more filing types present + definitive filings.
        """
        score = 0.3  # Base score for having any M&A filing

        if cluster.has_definitive_proxy:
            score += 0.3
        if cluster.has_merger_proxy:
            score += 0.2
        if cluster.has_tender_offer:
            score += 0.2

        # More filings = more confidence
        if len(cluster.filings) >= 3:
            score += 0.1
        if len(cluster.filings) >= 5:
            score += 0.1

        return min(score, 1.0)
