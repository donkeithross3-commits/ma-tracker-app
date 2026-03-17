"""
Universe Construction Pipeline — Phase 1 Orchestrator

Orchestrates the full pipeline:
  1. Download SEC master index files (quarterly, 2016-2026)
  2. Supplement with EFTS full-text search for 8-K coverage
  3. Deduplicate filings across sources
  4. Entity resolution: group filings into deals
  5. Insert deals + filings into research database
  6. Cross-reference with production system

Designed for resumability: checks existing data before inserting,
tracks progress in research_pipeline_runs.
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

import asyncpg

from .deal_identifier import DealIdentifier, IdentifiedDeal
from .edgar_scraper import (
    CompanyMetadataResolver,
    EdgarEFTSSearcher,
    EdgarMasterIndexScraper,
    RawFiling,
    deduplicate_filings,
)
from . import db

logger = logging.getLogger(__name__)


class UniverseConstructionPipeline:
    """
    Full Phase 1 pipeline: EDGAR scraping → entity resolution → database insertion.

    Usage:
        pipeline = UniverseConstructionPipeline()
        result = await pipeline.run()
    """

    def __init__(
        self,
        start_year: int = 2016,
        end_year: int = 2026,
        skip_efts: bool = False,
        skip_metadata: bool = False,
        dry_run: bool = False,
    ):
        self.start_year = start_year
        self.end_year = end_year
        self.skip_efts = skip_efts
        self.skip_metadata = skip_metadata
        self.dry_run = dry_run

        self.master_scraper = EdgarMasterIndexScraper(start_year, end_year)
        self.efts_searcher = EdgarEFTSSearcher(start_year, end_year)
        self.metadata_resolver = CompanyMetadataResolver()
        self.deal_identifier = DealIdentifier(self.metadata_resolver)

        self._pool: Optional[asyncpg.Pool] = None
        self._run_id: Optional[UUID] = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                os.environ["DATABASE_URL"],
                min_size=2,
                max_size=10,
            )
        return self._pool

    async def close(self):
        """Clean up all resources."""
        await self.master_scraper.close()
        await self.efts_searcher.close()
        await self.metadata_resolver.close()
        await self.deal_identifier.close()
        if self._pool:
            await self._pool.close()

    async def run(self) -> Dict:
        """
        Execute the full universe construction pipeline.

        Returns a summary dict with counts and timing.
        """
        start_time = datetime.now()
        result = {
            "status": "running",
            "start_time": start_time.isoformat(),
            "master_index_filings": 0,
            "efts_filings": 0,
            "total_unique_filings": 0,
            "deals_identified": 0,
            "deals_inserted": 0,
            "filings_linked": 0,
            "production_links": 0,
            "errors": [],
        }

        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                # Record pipeline run
                if not self.dry_run:
                    self._run_id = await db.start_pipeline_run(
                        conn,
                        pipeline_name="universe_construction",
                        phase="full",
                        config={
                            "start_year": self.start_year,
                            "end_year": self.end_year,
                            "skip_efts": self.skip_efts,
                            "skip_metadata": self.skip_metadata,
                        },
                    )

            # ---- Phase 1a: Master Index Scraping ----
            logger.info("=" * 60)
            logger.info("PHASE 1a: Downloading SEC master index files")
            logger.info("=" * 60)

            master_filings = await self.master_scraper.scrape_all_quarters()
            result["master_index_filings"] = len(master_filings)
            logger.info(f"Master index: {len(master_filings)} M&A filings found")

            # ---- Phase 1b: EFTS Search (optional) ----
            efts_filings: List[RawFiling] = []
            if not self.skip_efts:
                logger.info("=" * 60)
                logger.info("PHASE 1b: EFTS full-text search for 8-K coverage")
                logger.info("=" * 60)

                efts_filings = await self.efts_searcher.search_all_years()
                result["efts_filings"] = len(efts_filings)
                logger.info(f"EFTS: {len(efts_filings)} additional 8-K filings found")

            # ---- Combine and deduplicate ----
            all_filings = deduplicate_filings(master_filings + efts_filings)
            result["total_unique_filings"] = len(all_filings)
            logger.info(f"Total unique filings: {len(all_filings)}")

            # ---- Phase 1c: Entity Resolution ----
            logger.info("=" * 60)
            logger.info("PHASE 1c: Entity resolution — grouping filings into deals")
            logger.info("=" * 60)

            deals = await self.deal_identifier.identify_deals(
                filings=all_filings,
                resolve_metadata=not self.skip_metadata,
            )
            result["deals_identified"] = len(deals)
            logger.info(f"Identified {len(deals)} deals")

            if self.dry_run:
                logger.info("DRY RUN: Skipping database insertion")
                result["status"] = "dry_run_complete"
                self._log_deal_summary(deals)
                return result

            # ---- Phase 1d: Database Insertion ----
            logger.info("=" * 60)
            logger.info("PHASE 1d: Inserting deals and filings into database")
            logger.info("=" * 60)

            async with pool.acquire() as conn:
                existing_keys = await db.get_existing_deal_keys(conn)
                existing_accessions = await db.get_existing_accession_numbers(conn)

                inserted = 0
                updated = 0
                filings_linked = 0

                for i, deal in enumerate(deals):
                    try:
                        is_new = deal.deal_key not in existing_keys

                        # Insert deal (upsert)
                        deal_id = await db.insert_deal(conn, deal)

                        if is_new:
                            inserted += 1
                            existing_keys.add(deal.deal_key)

                            # Create initial announcement event
                            if deal.announced_date:
                                await db.insert_event(
                                    conn,
                                    deal_id=deal_id,
                                    event_type="ANNOUNCEMENT",
                                    event_subtype="initial_announcement",
                                    event_date=deal.announced_date,
                                    summary=f"Deal announced: {deal.acquirer_name} to acquire {deal.target_name}",
                                    source_type="derived",
                                )
                        else:
                            updated += 1

                        # Link filings
                        for filing in deal.filings:
                            if filing.accession_number not in existing_accessions:
                                filed = await db.insert_filing(conn, deal_id, filing)
                                if filed:
                                    filings_linked += 1
                                    existing_accessions.add(filing.accession_number)

                        if (i + 1) % 100 == 0:
                            logger.info(
                                f"Progress: {i + 1}/{len(deals)} deals processed "
                                f"({inserted} new, {updated} existing, {filings_linked} filings)"
                            )

                    except Exception as e:
                        error_msg = f"Error inserting deal {deal.deal_key}: {e}"
                        logger.error(error_msg)
                        result["errors"].append(error_msg)

                result["deals_inserted"] = inserted
                result["deals_updated"] = updated
                result["filings_linked"] = filings_linked

                logger.info(
                    f"Database insertion complete: {inserted} new deals, "
                    f"{updated} updated, {filings_linked} filings linked"
                )

            # ---- Phase 1e: Cross-reference with production ----
            logger.info("=" * 60)
            logger.info("PHASE 1e: Cross-referencing with production deals")
            logger.info("=" * 60)

            async with pool.acquire() as conn:
                prod_links = await db.link_production_deals(conn)
                canon_links = await db.link_canonical_deals(conn)
                result["production_links"] = prod_links + canon_links

            # ---- Finalize ----
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            result["status"] = "completed"
            result["duration_seconds"] = duration
            result["end_time"] = end_time.isoformat()

            # Update pipeline run record
            if self._run_id:
                async with pool.acquire() as conn:
                    await db.update_pipeline_run(
                        conn,
                        run_id=self._run_id,
                        status="completed",
                        total_items=len(all_filings),
                        processed_items=len(deals),
                        deals_created=inserted,
                        deals_updated=updated,
                        filings_linked=filings_linked,
                    )

            logger.info("=" * 60)
            logger.info(f"UNIVERSE CONSTRUCTION COMPLETE in {duration:.0f}s")
            logger.info(f"  Master index filings: {result['master_index_filings']}")
            logger.info(f"  EFTS filings: {result['efts_filings']}")
            logger.info(f"  Total unique filings: {result['total_unique_filings']}")
            logger.info(f"  Deals identified: {result['deals_identified']}")
            logger.info(f"  New deals inserted: {result['deals_inserted']}")
            logger.info(f"  Filings linked: {result['filings_linked']}")
            logger.info(f"  Production cross-refs: {result['production_links']}")
            logger.info("=" * 60)

            return result

        except Exception as e:
            logger.error(f"Pipeline failed: {e}", exc_info=True)
            result["status"] = "failed"
            result["errors"].append(str(e))

            if self._run_id:
                try:
                    pool = await self._get_pool()
                    async with pool.acquire() as conn:
                        await db.update_pipeline_run(
                            conn,
                            run_id=self._run_id,
                            status="failed",
                            last_error=str(e),
                        )
                except Exception:
                    pass

            return result

        finally:
            await self.close()

    def _log_deal_summary(self, deals: List[IdentifiedDeal]) -> None:
        """Log a summary of identified deals (for dry runs)."""
        by_year: Dict[int, int] = {}
        by_type: Dict[str, int] = {}

        for deal in deals:
            year = deal.announced_date.year if deal.announced_date else 0
            by_year[year] = by_year.get(year, 0) + 1
            by_type[deal.deal_type] = by_type.get(deal.deal_type, 0) + 1

        logger.info("Deal summary by year:")
        for year in sorted(by_year):
            logger.info(f"  {year}: {by_year[year]} deals")

        logger.info("Deal summary by type:")
        for dtype, count in sorted(by_type.items(), key=lambda x: -x[1]):
            logger.info(f"  {dtype}: {count} deals")


# ============================================================================
# CLI entry point
# ============================================================================

async def run_universe_construction(
    start_year: int = 2016,
    end_year: int = 2026,
    skip_efts: bool = False,
    skip_metadata: bool = False,
    dry_run: bool = False,
) -> Dict:
    """
    Entry point for running universe construction from CLI or API.

    Usage:
        python -m app.research.universe.pipeline
    """
    pipeline = UniverseConstructionPipeline(
        start_year=start_year,
        end_year=end_year,
        skip_efts=skip_efts,
        skip_metadata=skip_metadata,
        dry_run=dry_run,
    )
    return await pipeline.run()


if __name__ == "__main__":
    import argparse
    import sys

    # Load .env if present
    from pathlib import Path
    env_path = Path(__file__).parents[3] / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)

    parser = argparse.ArgumentParser(description="Run universe construction pipeline")
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year", type=int, default=2026)
    parser.add_argument("--skip-efts", action="store_true", help="Skip EFTS search")
    parser.add_argument("--skip-metadata", action="store_true", help="Skip SEC metadata resolution")
    parser.add_argument("--dry-run", action="store_true", help="Don't insert into database")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run_universe_construction(
        start_year=args.start_year,
        end_year=args.end_year,
        skip_efts=args.skip_efts,
        skip_metadata=args.skip_metadata,
        dry_run=args.dry_run,
    ))

    if result["status"] == "failed":
        print(f"Pipeline failed: {result.get('errors', [])}")
        sys.exit(1)
    else:
        print(f"Pipeline {result['status']}: {result.get('deals_identified', 0)} deals identified")
