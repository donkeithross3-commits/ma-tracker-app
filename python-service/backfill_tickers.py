#!/usr/bin/env python3
"""
Comprehensive ticker backfill script for all tables with missing tickers.

This script uses the improved token-based ticker lookup logic (from commit 9b97126)
to find and update missing tickers across both EDGAR and intelligence systems.

Tables updated:
- deal_intelligence (intelligence system)
- staged_deals (EDGAR system)

Usage:
    /Users/donaldross/opt/anaconda3/bin/python3 backfill_tickers.py [--dry-run]
"""
import asyncio
import asyncpg
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional
import logging

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.ticker_lookup import get_ticker_lookup_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TickerBackfill:
    """Backfill missing tickers across all tables"""

    def __init__(self, db_pool: asyncpg.Pool, dry_run: bool = False):
        self.pool = db_pool
        self.dry_run = dry_run
        self.ticker_service = get_ticker_lookup_service()

        # Statistics
        self.stats = {
            "deal_intelligence": {
                "total_checked": 0,
                "target_tickers_found": 0,
                "acquirer_tickers_found": 0,
                "records_updated": 0,
                "failed_lookups": []
            },
            "staged_deals": {
                "total_checked": 0,
                "target_tickers_found": 0,
                "acquirer_tickers_found": 0,
                "records_updated": 0,
                "failed_lookups": []
            }
        }

    async def backfill_deal_intelligence(self) -> None:
        """Backfill tickers for deal_intelligence table (intelligence system)"""
        logger.info("=" * 80)
        logger.info("BACKFILLING: deal_intelligence (Intelligence System)")
        logger.info("=" * 80)

        async with self.pool.acquire() as conn:
            # Find records with missing tickers
            rows = await conn.fetch(
                """SELECT deal_id, target_name, target_ticker, acquirer_name, acquirer_ticker
                   FROM deal_intelligence
                   WHERE target_ticker IS NULL OR acquirer_ticker IS NULL
                   ORDER BY first_detected_at DESC"""
            )

            self.stats["deal_intelligence"]["total_checked"] = len(rows)
            logger.info(f"Found {len(rows)} deals with missing tickers")

            for row in rows:
                deal_id = row["deal_id"]
                target_name = row["target_name"]
                acquirer_name = row["acquirer_name"]
                current_target_ticker = row["target_ticker"]
                current_acquirer_ticker = row["acquirer_ticker"]

                logger.info(f"\nProcessing deal: {deal_id}")
                logger.info(f"  Target: {target_name} (current ticker: {current_target_ticker or 'NONE'})")
                logger.info(f"  Acquirer: {acquirer_name} (current ticker: {current_acquirer_ticker or 'NONE'})")

                updates = {}

                # Look up target ticker if missing
                if not current_target_ticker and target_name:
                    logger.info(f"  Looking up target ticker for: {target_name}")
                    target_data = await self.ticker_service.lookup_by_company_name(target_name)
                    if target_data:
                        updates["target_ticker"] = target_data["ticker"]
                        self.stats["deal_intelligence"]["target_tickers_found"] += 1
                        logger.info(f"  ✓ Found target ticker: {target_data['ticker']} (score: {target_data['similarity_score']:.2f})")
                    else:
                        self.stats["deal_intelligence"]["failed_lookups"].append({
                            "deal_id": str(deal_id),
                            "company_name": target_name,
                            "type": "target"
                        })
                        logger.warning(f"  ✗ No ticker found for target: {target_name}")

                # Look up acquirer ticker if missing
                if not current_acquirer_ticker and acquirer_name:
                    logger.info(f"  Looking up acquirer ticker for: {acquirer_name}")
                    acquirer_data = await self.ticker_service.lookup_by_company_name(acquirer_name)
                    if acquirer_data:
                        updates["acquirer_ticker"] = acquirer_data["ticker"]
                        self.stats["deal_intelligence"]["acquirer_tickers_found"] += 1
                        logger.info(f"  ✓ Found acquirer ticker: {acquirer_data['ticker']} (score: {acquirer_data['similarity_score']:.2f})")
                    else:
                        self.stats["deal_intelligence"]["failed_lookups"].append({
                            "deal_id": str(deal_id),
                            "company_name": acquirer_name,
                            "type": "acquirer"
                        })
                        logger.warning(f"  ✗ No ticker found for acquirer: {acquirer_name}")

                # Update record if we found any tickers
                if updates:
                    if self.dry_run:
                        logger.info(f"  [DRY RUN] Would update: {updates}")
                    else:
                        set_clauses = []
                        values = []
                        param_idx = 1

                        for field, value in updates.items():
                            set_clauses.append(f"{field} = ${param_idx}")
                            values.append(value)
                            param_idx += 1

                        values.append(deal_id)

                        update_query = f"""
                            UPDATE deal_intelligence
                            SET {', '.join(set_clauses)}, updated_at = NOW()
                            WHERE deal_id = ${param_idx}
                        """

                        await conn.execute(update_query, *values)
                        self.stats["deal_intelligence"]["records_updated"] += 1
                        logger.info(f"  ✓ Updated deal_intelligence record")

    async def backfill_staged_deals(self) -> None:
        """Backfill tickers for staged_deals table (EDGAR system)"""
        logger.info("\n" + "=" * 80)
        logger.info("BACKFILLING: staged_deals (EDGAR System)")
        logger.info("=" * 80)

        async with self.pool.acquire() as conn:
            # Find records with missing tickers (only pending/approved, not rejected)
            rows = await conn.fetch(
                """SELECT staged_deal_id, target_name, target_ticker, acquirer_name, acquirer_ticker, status
                   FROM staged_deals
                   WHERE (target_ticker IS NULL OR acquirer_ticker IS NULL)
                   AND status IN ('pending', 'approved')
                   ORDER BY detected_at DESC"""
            )

            self.stats["staged_deals"]["total_checked"] = len(rows)
            logger.info(f"Found {len(rows)} staged deals with missing tickers")

            for row in rows:
                deal_id = row["staged_deal_id"]
                target_name = row["target_name"]
                acquirer_name = row["acquirer_name"]
                current_target_ticker = row["target_ticker"]
                current_acquirer_ticker = row["acquirer_ticker"]
                status = row["status"]

                logger.info(f"\nProcessing staged deal: {deal_id} (status: {status})")
                logger.info(f"  Target: {target_name} (current ticker: {current_target_ticker or 'NONE'})")
                logger.info(f"  Acquirer: {acquirer_name} (current ticker: {current_acquirer_ticker or 'NONE'})")

                updates = {}

                # Look up target ticker if missing
                if not current_target_ticker and target_name:
                    logger.info(f"  Looking up target ticker for: {target_name}")
                    target_data = await self.ticker_service.lookup_by_company_name(target_name)
                    if target_data:
                        updates["target_ticker"] = target_data["ticker"]
                        self.stats["staged_deals"]["target_tickers_found"] += 1
                        logger.info(f"  ✓ Found target ticker: {target_data['ticker']} (score: {target_data['similarity_score']:.2f})")
                    else:
                        self.stats["staged_deals"]["failed_lookups"].append({
                            "deal_id": str(deal_id),
                            "company_name": target_name,
                            "type": "target"
                        })
                        logger.warning(f"  ✗ No ticker found for target: {target_name}")

                # Look up acquirer ticker if missing
                if not current_acquirer_ticker and acquirer_name:
                    logger.info(f"  Looking up acquirer ticker for: {acquirer_name}")
                    acquirer_data = await self.ticker_service.lookup_by_company_name(acquirer_name)
                    if acquirer_data:
                        updates["acquirer_ticker"] = acquirer_data["ticker"]
                        self.stats["staged_deals"]["acquirer_tickers_found"] += 1
                        logger.info(f"  ✓ Found acquirer ticker: {acquirer_data['ticker']} (score: {acquirer_data['similarity_score']:.2f})")
                    else:
                        self.stats["staged_deals"]["failed_lookups"].append({
                            "deal_id": str(deal_id),
                            "company_name": acquirer_name,
                            "type": "acquirer"
                        })
                        logger.warning(f"  ✗ No ticker found for acquirer: {acquirer_name}")

                # Update record if we found any tickers
                if updates:
                    if self.dry_run:
                        logger.info(f"  [DRY RUN] Would update: {updates}")
                    else:
                        set_clauses = []
                        values = []
                        param_idx = 1

                        for field, value in updates.items():
                            set_clauses.append(f"{field} = ${param_idx}")
                            values.append(value)
                            param_idx += 1

                        values.append(deal_id)

                        update_query = f"""
                            UPDATE staged_deals
                            SET {', '.join(set_clauses)}, updated_at = NOW()
                            WHERE staged_deal_id = ${param_idx}
                        """

                        await conn.execute(update_query, *values)
                        self.stats["staged_deals"]["records_updated"] += 1
                        logger.info(f"  ✓ Updated staged_deals record")

    def print_summary(self) -> None:
        """Print summary statistics"""
        logger.info("\n" + "=" * 80)
        logger.info("BACKFILL SUMMARY")
        logger.info("=" * 80)

        if self.dry_run:
            logger.info("MODE: DRY RUN (no database changes made)")
        else:
            logger.info("MODE: LIVE (database updated)")

        logger.info("\n--- deal_intelligence (Intelligence System) ---")
        di = self.stats["deal_intelligence"]
        logger.info(f"Total records checked: {di['total_checked']}")
        logger.info(f"Target tickers found: {di['target_tickers_found']}")
        logger.info(f"Acquirer tickers found: {di['acquirer_tickers_found']}")
        logger.info(f"Records updated: {di['records_updated']}")
        logger.info(f"Failed lookups: {len(di['failed_lookups'])}")

        if di['failed_lookups']:
            logger.info("\nFailed lookups (deal_intelligence):")
            for fail in di['failed_lookups'][:10]:  # Show first 10
                logger.info(f"  - {fail['type']}: {fail['company_name']} (deal: {fail['deal_id']})")
            if len(di['failed_lookups']) > 10:
                logger.info(f"  ... and {len(di['failed_lookups']) - 10} more")

        logger.info("\n--- staged_deals (EDGAR System) ---")
        sd = self.stats["staged_deals"]
        logger.info(f"Total records checked: {sd['total_checked']}")
        logger.info(f"Target tickers found: {sd['target_tickers_found']}")
        logger.info(f"Acquirer tickers found: {sd['acquirer_tickers_found']}")
        logger.info(f"Records updated: {sd['records_updated']}")
        logger.info(f"Failed lookups: {len(sd['failed_lookups'])}")

        if sd['failed_lookups']:
            logger.info("\nFailed lookups (staged_deals):")
            for fail in sd['failed_lookups'][:10]:  # Show first 10
                logger.info(f"  - {fail['type']}: {fail['company_name']} (deal: {fail['deal_id']})")
            if len(sd['failed_lookups']) > 10:
                logger.info(f"  ... and {len(sd['failed_lookups']) - 10} more")

        logger.info("\n--- TOTALS ---")
        total_checked = di['total_checked'] + sd['total_checked']
        total_tickers = (di['target_tickers_found'] + di['acquirer_tickers_found'] +
                         sd['target_tickers_found'] + sd['acquirer_tickers_found'])
        total_updated = di['records_updated'] + sd['records_updated']
        total_failed = len(di['failed_lookups']) + len(sd['failed_lookups'])

        logger.info(f"Total records checked: {total_checked}")
        logger.info(f"Total tickers found: {total_tickers}")
        logger.info(f"Total records updated: {total_updated}")
        logger.info(f"Total failed lookups: {total_failed}")
        logger.info("=" * 80)

    async def run(self) -> None:
        """Execute full backfill process"""
        start_time = datetime.now()
        logger.info(f"Starting ticker backfill at {start_time}")
        logger.info(f"Dry run: {self.dry_run}")

        try:
            # Backfill intelligence system
            await self.backfill_deal_intelligence()

            # Backfill EDGAR system
            await self.backfill_staged_deals()

            # Print summary
            self.print_summary()

        finally:
            # Clean up ticker service
            await self.ticker_service.close()

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        logger.info(f"\nCompleted in {duration:.1f} seconds")


async def main():
    """Main entry point"""
    # Check for dry-run flag
    dry_run = "--dry-run" in sys.argv

    # Get database URL
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL environment variable not set")
        sys.exit(1)

    # Create database pool
    logger.info(f"Connecting to database...")
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=3)

    try:
        # Run backfill
        backfill = TickerBackfill(pool, dry_run=dry_run)
        await backfill.run()

    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
