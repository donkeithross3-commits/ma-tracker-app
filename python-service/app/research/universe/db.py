"""
Database operations for the research universe.

All queries use raw asyncpg (consistent with the rest of the backend).
"""

import logging
import os
from datetime import date, datetime
from typing import Dict, List, Optional, Set, Tuple
from uuid import UUID

import asyncpg

from .deal_identifier import IdentifiedDeal
from .edgar_scraper import RawFiling

logger = logging.getLogger(__name__)


async def get_connection() -> asyncpg.Connection:
    """Get a database connection."""
    return await asyncpg.connect(os.environ["DATABASE_URL"])


async def get_pool() -> asyncpg.Pool:
    """Get or create a connection pool."""
    return await asyncpg.create_pool(
        os.environ["DATABASE_URL"],
        min_size=2,
        max_size=10,
    )


# ============================================================================
# research_deals CRUD
# ============================================================================

async def insert_deal(conn: asyncpg.Connection, deal: IdentifiedDeal) -> UUID:
    """Insert a new research deal and return its deal_id."""
    row = await conn.fetchrow(
        """
        INSERT INTO research_deals (
            deal_key, target_ticker, target_name, target_cik, target_sic,
            target_exchange, acquirer_name, acquirer_ticker, acquirer_cik,
            acquirer_type, deal_type, deal_structure,
            is_hostile, is_mbo, is_going_private,
            announced_date, outcome, discovery_source
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12,
            $13, $14, $15,
            $16, $17, $18
        )
        ON CONFLICT (deal_key) DO UPDATE SET
            updated_at = NOW()
        RETURNING deal_id
        """,
        deal.deal_key,
        deal.target_ticker or "UNK",
        deal.target_name,
        deal.target_cik,
        deal.target_sic,
        deal.target_exchange,
        deal.acquirer_name,
        deal.acquirer_ticker,
        deal.acquirer_cik,
        deal.acquirer_type,
        deal.deal_type,
        deal.deal_structure,
        deal.is_hostile,
        deal.is_mbo,
        deal.is_going_private,
        deal.announced_date,
        "pending",
        "edgar_master_idx",
    )
    return row["deal_id"]


async def get_existing_deal_keys(conn: asyncpg.Connection) -> Set[str]:
    """Get all existing deal keys to avoid duplicates."""
    rows = await conn.fetch("SELECT deal_key FROM research_deals")
    return {row["deal_key"] for row in rows}


async def get_deal_by_key(conn: asyncpg.Connection, deal_key: str) -> Optional[dict]:
    """Fetch a deal by its key."""
    row = await conn.fetchrow(
        "SELECT * FROM research_deals WHERE deal_key = $1",
        deal_key,
    )
    return dict(row) if row else None


async def get_deal_count(conn: asyncpg.Connection) -> int:
    """Get total number of research deals."""
    row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM research_deals")
    return row["cnt"]


async def get_deals_summary(conn: asyncpg.Connection) -> dict:
    """Get summary statistics for the research database."""
    rows = await conn.fetch("""
        SELECT
            COUNT(*) as total_deals,
            COUNT(*) FILTER (WHERE outcome = 'pending') as pending,
            COUNT(*) FILTER (WHERE outcome LIKE 'closed%') as closed,
            COUNT(*) FILTER (WHERE outcome LIKE 'terminated%') as terminated,
            COUNT(*) FILTER (WHERE outcome = 'withdrawn') as withdrawn,
            MIN(announced_date) as earliest_deal,
            MAX(announced_date) as latest_deal,
            COUNT(DISTINCT target_ticker) as unique_targets,
            COUNT(*) FILTER (WHERE clause_extraction_status = 'complete') as clauses_complete,
            COUNT(*) FILTER (WHERE market_data_status = 'complete') as market_data_complete
        FROM research_deals
    """)
    return dict(rows[0]) if rows else {}


async def list_deals(
    conn: asyncpg.Connection,
    limit: int = 50,
    offset: int = 0,
    outcome: Optional[str] = None,
    year: Optional[int] = None,
) -> List[dict]:
    """List research deals with optional filtering."""
    conditions = []
    params = []
    param_idx = 1

    if outcome:
        conditions.append(f"outcome = ${param_idx}")
        params.append(outcome)
        param_idx += 1

    if year:
        conditions.append(f"EXTRACT(YEAR FROM announced_date) = ${param_idx}")
        params.append(year)
        param_idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    params.extend([limit, offset])
    query = f"""
        SELECT deal_id, deal_key, target_ticker, target_name, acquirer_name,
               deal_type, deal_structure, announced_date, outcome,
               initial_deal_value_mm, initial_premium_1d_pct,
               clause_extraction_status, market_data_status,
               discovery_source, created_at
        FROM research_deals
        {where}
        ORDER BY announced_date DESC
        LIMIT ${param_idx} OFFSET ${param_idx + 1}
    """

    rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


# ============================================================================
# research_deal_filings CRUD
# ============================================================================

async def insert_filing(
    conn: asyncpg.Connection,
    deal_id: UUID,
    filing: RawFiling,
) -> Optional[UUID]:
    """Insert a filing linked to a deal. Returns None if duplicate accession."""
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO research_deal_filings (
                deal_id, accession_number, filing_type, filing_date,
                filed_by_cik, filed_by_name, filing_url, primary_doc_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (accession_number) DO NOTHING
            RETURNING id
            """,
            deal_id,
            filing.accession_number,
            filing.form_type,
            filing.filing_date,
            filing.cik,
            filing.company_name,
            filing.index_url,
            filing.filing_url,
        )
        return row["id"] if row else None
    except Exception as e:
        logger.warning(f"Error inserting filing {filing.accession_number}: {e}")
        return None


async def get_filings_for_deal(
    conn: asyncpg.Connection,
    deal_id: UUID,
) -> List[dict]:
    """Get all filings linked to a deal."""
    rows = await conn.fetch(
        """
        SELECT * FROM research_deal_filings
        WHERE deal_id = $1
        ORDER BY filing_date
        """,
        deal_id,
    )
    return [dict(r) for r in rows]


async def get_existing_accession_numbers(conn: asyncpg.Connection) -> Set[str]:
    """Get all accession numbers already in the research database."""
    rows = await conn.fetch("SELECT accession_number FROM research_deal_filings")
    return {row["accession_number"] for row in rows}


# ============================================================================
# research_deal_events CRUD
# ============================================================================

async def insert_event(
    conn: asyncpg.Connection,
    deal_id: UUID,
    event_type: str,
    event_subtype: Optional[str],
    event_date: date,
    summary: str,
    source_type: str = "derived",
    source_filing_accession: Optional[str] = None,
    details: Optional[dict] = None,
    new_price: Optional[float] = None,
    old_price: Optional[float] = None,
    is_competing_bid: bool = False,
    competing_bidder: Optional[str] = None,
) -> UUID:
    """Insert a deal event."""
    import json

    row = await conn.fetchrow(
        """
        INSERT INTO research_deal_events (
            deal_id, event_type, event_subtype, event_date, summary,
            source_type, source_filing_accession,
            details, new_price, old_price,
            is_competing_bid, competing_bidder
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING event_id
        """,
        deal_id,
        event_type,
        event_subtype,
        event_date,
        summary,
        source_type,
        source_filing_accession,
        json.dumps(details) if details else None,
        new_price,
        old_price,
        is_competing_bid,
        competing_bidder,
    )
    return row["event_id"]


# ============================================================================
# research_pipeline_runs CRUD
# ============================================================================

async def start_pipeline_run(
    conn: asyncpg.Connection,
    pipeline_name: str,
    phase: str,
    config: Optional[dict] = None,
) -> UUID:
    """Record the start of a pipeline run."""
    import json

    row = await conn.fetchrow(
        """
        INSERT INTO research_pipeline_runs (pipeline_name, phase, config)
        VALUES ($1, $2, $3)
        RETURNING run_id
        """,
        pipeline_name,
        phase,
        json.dumps(config) if config else None,
    )
    return row["run_id"]


async def update_pipeline_run(
    conn: asyncpg.Connection,
    run_id: UUID,
    status: Optional[str] = None,
    processed_items: Optional[int] = None,
    failed_items: Optional[int] = None,
    deals_created: Optional[int] = None,
    deals_updated: Optional[int] = None,
    filings_linked: Optional[int] = None,
    last_error: Optional[str] = None,
    total_items: Optional[int] = None,
) -> None:
    """Update pipeline run progress."""
    updates = []
    params = []
    idx = 1

    if status:
        updates.append(f"status = ${idx}")
        params.append(status)
        idx += 1
        if status in ("completed", "failed", "cancelled"):
            updates.append(f"completed_at = NOW()")

    for field_name, value in [
        ("processed_items", processed_items),
        ("failed_items", failed_items),
        ("deals_created", deals_created),
        ("deals_updated", deals_updated),
        ("filings_linked", filings_linked),
        ("last_error", last_error),
        ("total_items", total_items),
    ]:
        if value is not None:
            updates.append(f"{field_name} = ${idx}")
            params.append(value)
            idx += 1

    if not updates:
        return

    params.append(run_id)
    query = f"UPDATE research_pipeline_runs SET {', '.join(updates)} WHERE run_id = ${idx}"
    await conn.execute(query, *params)


# ============================================================================
# Cross-reference with production
# ============================================================================

async def link_production_deals(conn: asyncpg.Connection) -> int:
    """
    Cross-reference research deals with existing production deal_intelligence records.
    Links by matching target_ticker.
    Returns number of deals linked.
    """
    result = await conn.execute("""
        UPDATE research_deals rd
        SET production_deal_id = di.deal_id,
            updated_at = NOW()
        FROM deal_intelligence di
        WHERE UPPER(rd.target_ticker) = UPPER(di.ticker)
          AND rd.production_deal_id IS NULL
          AND di.status IN ('active', 'closed')
    """)
    count = int(result.split()[-1]) if result else 0
    logger.info(f"Linked {count} research deals to production deal_intelligence")
    return count


async def link_canonical_deals(conn: asyncpg.Connection) -> int:
    """
    Cross-reference research deals with canonical_deals records.
    Links by matching target_ticker.
    """
    try:
        result = await conn.execute("""
            UPDATE research_deals rd
            SET canonical_deal_id = cd.id,
                updated_at = NOW()
            FROM canonical_deals cd
            WHERE UPPER(rd.target_ticker) = UPPER(cd.ticker)
              AND rd.canonical_deal_id IS NULL
        """)
        count = int(result.split()[-1]) if result else 0
        logger.info(f"Linked {count} research deals to canonical_deals")
        return count
    except Exception as e:
        # canonical_deals may not exist in all environments
        logger.warning(f"Could not link canonical deals: {e}")
        return 0
