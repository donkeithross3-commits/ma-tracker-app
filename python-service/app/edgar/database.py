"""Database utilities for EDGAR monitoring using asyncpg"""
import asyncpg
import os
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


def load_database_url() -> Optional[str]:
    """Try to load DATABASE_URL from multiple locations"""
    # First, try environment variable
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")

    # Try loading from .env files in multiple locations
    try:
        from dotenv import load_dotenv
    except ImportError:
        logger.warning("python-dotenv not installed, skipping .env file loading")
        return None

    # Paths to check (relative to this file)
    env_paths = [
        Path(__file__).parent.parent.parent.parent / '.env.local',  # Project root
        Path(__file__).parent.parent.parent / '.env',  # python-service dir
        Path.cwd() / '.env.local',  # Current working directory
        Path.cwd() / '.env',
    ]

    for env_path in env_paths:
        if env_path.exists():
            logger.info(f"Loading environment from {env_path}")
            load_dotenv(env_path)
            if os.getenv("DATABASE_URL"):
                return os.getenv("DATABASE_URL")

    return None


class EdgarDatabase:
    """Database operations for EDGAR monitoring"""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or load_database_url()
        if not self.database_url:
            raise ValueError(
                "DATABASE_URL not set. Please set DATABASE_URL environment variable "
                "or create a .env file with DATABASE_URL in the project root."
            )

        # Fix Prisma-style connection string for asyncpg
        if "?sslmode=" in self.database_url:
            # Convert Prisma format to asyncpg format
            self.database_url = self.database_url.replace("?sslmode=require", "?ssl=require")

        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Create connection pool"""
        if not self.pool:
            self.pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            logger.info("Database connection pool created")

    async def disconnect(self):
        """Close connection pool"""
        if self.pool:
            try:
                # Close pool with timeout to prevent hanging
                import asyncio
                await asyncio.wait_for(self.pool.close(), timeout=5.0)
                self.pool = None
                logger.info("Database connection pool closed")
            except asyncio.TimeoutError:
                logger.warning("Database pool close timed out after 5s - forcing close")
                self.pool = None
            except Exception as e:
                logger.error(f"Error closing database pool: {e}")
                self.pool = None

    async def filing_exists(self, accession_number: str) -> bool:
        """Check if filing already exists"""
        async with self.pool.acquire() as conn:
            result = await conn.fetchval(
                'SELECT filing_id FROM edgar_filings WHERE accession_number = $1',
                accession_number
            )
            return result is not None

    async def create_filing(
        self,
        accession_number: str,
        cik: str,
        company_name: Optional[str],
        ticker: Optional[str],
        filing_type: str,
        filing_date: datetime,
        filing_url: str
    ) -> str:
        """Create new filing record"""
        async with self.pool.acquire() as conn:
            filing_id = await conn.fetchval(
                '''INSERT INTO edgar_filings
                   (filing_id, accession_number, cik, company_name, ticker, filing_type,
                    filing_date, filing_url, status, is_ma_relevant, created_at, updated_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'pending', false, NOW(), NOW())
                   RETURNING filing_id''',
                accession_number, cik, company_name, ticker, filing_type, filing_date, filing_url
            )
            return filing_id

    async def update_filing_detection(
        self,
        filing_id: str,
        is_ma_relevant: bool,
        confidence_score: float,
        detected_keywords: List[str]
    ):
        """Update filing with M&A detection results"""
        async with self.pool.acquire() as conn:
            await conn.execute(
                '''UPDATE edgar_filings
                   SET is_ma_relevant = $2, confidence_score = $3,
                       detected_keywords = $4, status = 'analyzed',
                       processed_at = NOW(), updated_at = NOW()
                   WHERE filing_id = $1''',
                filing_id, is_ma_relevant, confidence_score, detected_keywords
            )

    async def get_filing(self, filing_id: str) -> Optional[Dict[str, Any]]:
        """Get filing by ID"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM edgar_filings WHERE filing_id = $1',
                filing_id
            )
            return dict(row) if row else None

    async def create_staged_deal(
        self,
        target_name: str,
        target_ticker: Optional[str],
        acquirer_name: Optional[str],
        deal_value: Optional[float],
        deal_type: Optional[str],
        source_filing_id: str,
        confidence_score: float
    ) -> str:
        """Create staged deal"""
        async with self.pool.acquire() as conn:
            # First, get the filing type from the source filing
            filing_row = await conn.fetchrow(
                'SELECT filing_type FROM edgar_filings WHERE filing_id = $1',
                source_filing_id
            )
            filing_type = filing_row['filing_type'] if filing_row else 'UNKNOWN'

            deal_id = await conn.fetchval(
                '''INSERT INTO staged_deals
                   (staged_deal_id, target_name, target_ticker, acquirer_name, deal_value,
                    deal_type, source_filing_id, source_filing_type, confidence_score, status,
                    "researchStatus", alert_sent, detected_at, created_at, updated_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'queued', false, NOW(), NOW(), NOW())
                   RETURNING staged_deal_id''',
                target_name, target_ticker, acquirer_name, deal_value, deal_type,
                source_filing_id, filing_type, confidence_score
            )
            return deal_id

    async def get_staged_deal(self, deal_id: str) -> Optional[Dict[str, Any]]:
        """Get staged deal by ID"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                '''SELECT sd.*, ef.filing_type, ef.filing_url, ef.filing_date
                   FROM staged_deals sd
                   JOIN edgar_filings ef ON sd.source_filing_id = ef.filing_id
                   WHERE sd.staged_deal_id = $1''',
                deal_id
            )
            return dict(row) if row else None

    async def list_staged_deals(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List staged deals"""
        async with self.pool.acquire() as conn:
            if status:
                rows = await conn.fetch(
                    '''SELECT sd.*, ef.filing_type, ef.filing_url, ef.filing_date
                       FROM staged_deals sd
                       JOIN edgar_filings ef ON sd.source_filing_id = ef.filing_id
                       WHERE sd.status = $1
                       ORDER BY sd.detected_at DESC''',
                    status
                )
            else:
                rows = await conn.fetch(
                    '''SELECT sd.*, ef.filing_type, ef.filing_url, ef.filing_date
                       FROM staged_deals sd
                       JOIN edgar_filings ef ON sd.source_filing_id = ef.filing_id
                       ORDER BY sd.detected_at DESC'''
                )
            return [dict(row) for row in rows]

    async def update_staged_deal_alert(self, deal_id: str):
        """Mark deal alert as sent"""
        async with self.pool.acquire() as conn:
            await conn.execute(
                'UPDATE staged_deals SET alert_sent = true, alert_sent_at = NOW(), updated_at = NOW() WHERE staged_deal_id = $1',
                deal_id
            )

    async def create_research_queue(
        self,
        staged_deal_id: str,
        analyzer_types: List[str],
        priority: int = 5
    ) -> str:
        """Create research queue item"""
        async with self.pool.acquire() as conn:
            queue_id = await conn.fetchval(
                '''INSERT INTO research_queue
                   (queue_id, staged_deal_id, analyzer_types, priority, status, attempts, created_at, updated_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, 'pending', 0, NOW(), NOW())
                   RETURNING queue_id''',
                staged_deal_id, analyzer_types, priority
            )
            return queue_id

    async def approve_staged_deal(
        self,
        deal_id: str,
        reviewer_id: Optional[str] = None
    ) -> str:
        """Approve staged deal and create production deal"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Get staged deal info
                deal = await conn.fetchrow(
                    'SELECT * FROM staged_deals WHERE staged_deal_id = $1',
                    deal_id
                )

                if not deal:
                    raise ValueError(f"Staged deal {deal_id} not found")

                # Create production deal
                prod_deal_id = await conn.fetchval(
                    '''INSERT INTO deals
                       (deal_id, ticker, target_name, acquiror_name, status, created_at, updated_at)
                       VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW(), NOW())
                       RETURNING deal_id''',
                    deal['target_ticker'] or 'UNKNOWN',
                    deal['target_name'],
                    deal['acquirer_name'] or 'Unknown'
                )

                # Update staged deal status
                await conn.execute(
                    '''UPDATE staged_deals
                       SET status = 'approved', reviewed_at = NOW(),
                           reviewed_by = $2, approved_deal_id = $3, updated_at = NOW()
                       WHERE staged_deal_id = $1''',
                    deal_id, reviewer_id, prod_deal_id
                )

                # Copy research reports - only if there's a corresponding target table
                # For now, skip this until we have the production research table set up

                return prod_deal_id

    async def reject_staged_deal(
        self,
        deal_id: str,
        reviewer_id: Optional[str] = None
    ):
        """Reject staged deal"""
        async with self.pool.acquire() as conn:
            await conn.execute(
                '''UPDATE staged_deals
                   SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2, updated_at = NOW()
                   WHERE staged_deal_id = $1''',
                deal_id, reviewer_id
            )

    async def list_recent_filings(
        self,
        limit: int = 50,
        ma_relevant_only: bool = False
    ) -> List[Dict[str, Any]]:
        """List recent filings"""
        async with self.pool.acquire() as conn:
            if ma_relevant_only:
                rows = await conn.fetch(
                    '''SELECT * FROM edgar_filings
                       WHERE is_ma_relevant = true
                       ORDER BY filing_date DESC
                       LIMIT $1''',
                    limit
                )
            else:
                rows = await conn.fetch(
                    '''SELECT * FROM edgar_filings
                       ORDER BY filing_date DESC
                       LIMIT $1''',
                    limit
                )
            return [dict(row) for row in rows]
