"""
EDGAR portfolio filing watcher.

Queries SEC EDGAR full-text search (EFTS) for new filings related to
tickers in the active deal portfolio. Material filings (8-K Item 1.01,
proxy amendments, etc.) trigger email alerts via MessagingService.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx

from app.risk.filing_impact import assess_filing_impact
from app.services.messaging import MessagingService

logger = logging.getLogger(__name__)

# SEC EDGAR EFTS full-text search endpoint
EFTS_BASE = "https://efts.sec.gov/LATEST/search-index"

# SEC requires a User-Agent header with contact info
SEC_HEADERS = {
    "User-Agent": "M&A Tracker alerts@ma-tracker.com",
    "Accept": "application/json",
}

# Filing types considered "material" for active M&A deals
MATERIAL_FILING_TYPES = {
    "8-K",       # Current report (Items 1.01, 8.01)
    "8-K/A",     # Amended current report
    "SC TO",     # Tender offer
    "SC 14D-9",  # Target response to tender offer
    "DEFM14A",   # Definitive proxy for merger
    "PREM14A",   # Preliminary proxy for merger
    "S-4",       # Registration for business combination
    "S-4/A",     # Amended registration
    "425",       # Business combination communications
}


async def check_portfolio_edgar_filings(
    pool,
    messaging: MessagingService,
) -> Dict[str, Any]:
    """Check EDGAR for new filings related to tracked deal tickers.

    This is designed to be called by the ``edgar_filing_check`` scheduled
    job (every 5 minutes during extended market hours).

    Returns a summary dict for the job_runs result column.
    """
    tickers = await _get_active_tickers(pool)
    if not tickers:
        logger.debug("[edgar_portfolio] No active tickers to watch")
        return {"tickers": 0, "new_filings": 0, "alerts": 0}

    total_new = 0
    total_alerts = 0

    for ticker in tickers:
        try:
            filings = await _search_edgar(ticker)
            if not filings:
                continue

            new_filings = await _filter_new_filings(pool, ticker, filings)
            if not new_filings:
                continue

            total_new += len(new_filings)

            for filing in new_filings:
                await _store_filing(pool, ticker, filing)

                if _is_material(filing):
                    total_alerts += 1
                    deal_info = {"ticker": ticker, "target_name": ticker}

                    # AI filing impact assessment
                    impact = None
                    try:
                        impact = await assess_filing_impact(pool, filing, ticker)
                    except Exception:
                        logger.error(
                            "[edgar_portfolio] Filing impact assessment failed for %s %s",
                            ticker, filing.get("accession_number"),
                            exc_info=True,
                        )

                    try:
                        if impact and impact.get("action_required"):
                            await messaging.send_filing_alert(
                                filing=filing,
                                deal=deal_info,
                                channels=["whatsapp", "email"],
                                impact_summary=impact.get("summary"),
                                impact_level=impact.get("impact"),
                            )
                        elif impact:
                            await messaging.send_filing_alert(
                                filing=filing,
                                deal=deal_info,
                                channels=["email"],
                                impact_summary=impact.get("summary"),
                                impact_level=impact.get("impact"),
                            )
                        else:
                            # Fallback: no AI assessment, send basic alert
                            await messaging.send_filing_alert(
                                filing=filing,
                                deal=deal_info,
                            )
                    except Exception:
                        logger.error(
                            "[edgar_portfolio] Failed to send alert for %s filing %s",
                            ticker, filing.get("accession_number"),
                            exc_info=True,
                        )

        except Exception:
            logger.error("[edgar_portfolio] Error processing ticker %s", ticker, exc_info=True)

    logger.info(
        "[edgar_portfolio] Checked %d tickers, %d new filings, %d alerts sent",
        len(tickers), total_new, total_alerts,
    )
    return {"tickers": len(tickers), "new_filings": total_new, "alerts": total_alerts}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_active_tickers(pool) -> List[str]:
    """Return distinct tickers from the latest snapshot that are not excluded."""
    async with pool.acquire() as conn:
        snap = await conn.fetchrow(
            """
            SELECT id FROM sheet_snapshots
            WHERE status = 'success'
            ORDER BY ingested_at DESC LIMIT 1
            """
        )
        if not snap:
            return []

        rows = await conn.fetch(
            """
            SELECT DISTINCT ticker
            FROM sheet_rows
            WHERE snapshot_id = $1
              AND ticker IS NOT NULL
              AND (is_excluded IS NOT TRUE)
            """,
            snap["id"],
        )
        return [r["ticker"] for r in rows]


async def _search_edgar(ticker: str) -> List[Dict[str, Any]]:
    """Query SEC EFTS for recent filings mentioning ``ticker``.

    Searches the last 2 days to avoid gaps between polling intervals.
    """
    date_from = (datetime.utcnow() - timedelta(days=2)).strftime("%Y-%m-%d")
    date_to = datetime.utcnow().strftime("%Y-%m-%d")

    params = {
        "q": f'"{ticker}"',
        "dateRange": "custom",
        "startdt": date_from,
        "enddt": date_to,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0, headers=SEC_HEADERS) as client:
            resp = await client.get(EFTS_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.error("[edgar_portfolio] EFTS request failed for %s", ticker, exc_info=True)
        return []

    results = []
    for hit in data.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        accession = source.get("file_num", "") or hit.get("_id", "")
        filing_type = source.get("form_type", "")
        results.append({
            "accession_number": accession,
            "filing_type": filing_type,
            "company_name": source.get("entity_name", ""),
            "filing_date": source.get("file_date", ""),
            "filing_url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={accession}&type=&dateb=&owner=include&count=40",
            "description": source.get("display_names", [""])[0] if source.get("display_names") else "",
        })

    return results


async def _filter_new_filings(
    pool, ticker: str, filings: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Return only filings whose accession_number is not already stored."""
    accession_numbers = [f["accession_number"] for f in filings if f.get("accession_number")]
    if not accession_numbers:
        return []

    async with pool.acquire() as conn:
        existing = await conn.fetch(
            """
            SELECT accession_number
            FROM portfolio_edgar_filings
            WHERE ticker = $1
              AND accession_number = ANY($2::text[])
            """,
            ticker,
            accession_numbers,
        )
        existing_set = {r["accession_number"] for r in existing}

    return [f for f in filings if f.get("accession_number") not in existing_set]


async def _store_filing(pool, ticker: str, filing: Dict[str, Any]) -> None:
    """Insert a new filing record."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO portfolio_edgar_filings
                (ticker, accession_number, filing_type, company_name,
                 filing_date, filing_url, description, detected_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (ticker, accession_number) DO NOTHING
            """,
            ticker,
            filing.get("accession_number", ""),
            filing.get("filing_type", ""),
            filing.get("company_name", ""),
            filing.get("filing_date", ""),
            filing.get("filing_url", ""),
            filing.get("description", ""),
        )


def _is_material(filing: Dict[str, Any]) -> bool:
    """Determine if a filing is material enough to warrant an alert."""
    filing_type = filing.get("filing_type", "")
    return filing_type in MATERIAL_FILING_TYPES
