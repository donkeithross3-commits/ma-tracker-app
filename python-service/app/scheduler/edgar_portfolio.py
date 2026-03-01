"""
EDGAR portfolio filing watcher.

Primary source: SEC EDGAR submissions API (CIK-based) for complete, accurate
filings from target and acquiror companies. Supplements with EFTS full-text
search for third-party filings mentioning the deal.

Material filings (8-K Item 1.01, proxy amendments, etc.) trigger email alerts
via MessagingService.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.risk.filing_impact import assess_filing_impact
from app.services.messaging import MessagingService

logger = logging.getLogger(__name__)

# SEC requires a User-Agent header with contact info
SEC_HEADERS = {
    "User-Agent": "M&A Tracker alerts@ma-tracker.com",
    "Accept": "application/json",
}

# M&A-relevant form types to keep from the submissions API
MA_FORM_TYPES = {
    # Deal structure / registration
    "S-4", "S-4/A",
    "425",                    # Business combination communications
    # Tender offers
    "SC TO-T", "SC TO-T/A", "SC TO-I", "SC TO-I/A",
    "SC 14D-9", "SC 14D-9/A",
    # Merger proxies
    "DEFM14A", "PREM14A", "DEFC14A", "DFAN14A", "DEFA14A",
    # Ownership / activist
    "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A",
    # Current reports (material events)
    "8-K", "8-K/A",
}

# Subset that triggers alerts
MATERIAL_FILING_TYPES = {
    "8-K", "8-K/A", "SC TO-T", "SC TO-T/A", "SC 14D-9", "SC 14D-9/A",
    "DEFM14A", "PREM14A", "S-4", "S-4/A", "425",
}

# Module-level CIK cache: ticker -> (cik_int, company_title)
_cik_cache: Dict[str, Tuple[int, str]] = {}


async def check_portfolio_edgar_filings(
    pool,
    messaging: MessagingService,
) -> Dict[str, Any]:
    """Check EDGAR for new filings related to tracked deal tickers.

    Uses SEC submissions API (CIK-based) for reliable, complete filings.
    Falls back to announce_date for historical lookback on first run.

    Returns a summary dict for the job_runs result column.
    """
    tickers_with_context = await _get_active_tickers_with_context(pool)
    if not tickers_with_context:
        logger.debug("[edgar_portfolio] No active tickers to watch")
        return {"tickers": 0, "new_filings": 0, "alerts": 0}

    # Ensure CIK cache is loaded
    await _ensure_cik_cache()

    total_new = 0
    total_alerts = 0

    for ctx in tickers_with_context:
        ticker = ctx["ticker"]
        try:
            filings = await _fetch_deal_filings(ctx)
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
                        if impact:
                            await _store_filing_impact(pool, ticker, filing, impact)
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
        len(tickers_with_context), total_new, total_alerts,
    )
    return {"tickers": len(tickers_with_context), "new_filings": total_new, "alerts": total_alerts}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_active_tickers(pool) -> List[str]:
    """Return distinct tickers from the latest snapshot that are not excluded."""
    contexts = await _get_active_tickers_with_context(pool)
    return [c["ticker"] for c in contexts]


async def _get_active_tickers_with_context(pool) -> List[Dict[str, Any]]:
    """Return deal context dicts for all active tickers.

    Each dict has: ticker, acquiror, target, announce_date.
    """
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
            SELECT DISTINCT ON (sr.ticker)
                sr.ticker, sr.acquiror,
                sdd.target, sdd.announce_date
            FROM sheet_rows sr
            LEFT JOIN sheet_deal_details sdd ON sdd.ticker = sr.ticker
            WHERE sr.snapshot_id = $1
              AND sr.ticker IS NOT NULL
              AND (sr.is_excluded IS NOT TRUE)
            ORDER BY sr.ticker, sdd.fetched_at DESC NULLS LAST
            """,
            snap["id"],
        )
        return [
            {
                "ticker": r["ticker"],
                "acquiror": r.get("acquiror"),
                "target": r.get("target"),
                "announce_date": r.get("announce_date"),
            }
            for r in rows
        ]


# ---------------------------------------------------------------------------
# CIK lookup (SEC company_tickers.json)
# ---------------------------------------------------------------------------

async def _ensure_cik_cache() -> None:
    """Load the SEC ticker→CIK mapping into module-level cache (once)."""
    global _cik_cache
    if _cik_cache:
        return

    url = "https://www.sec.gov/files/company_tickers.json"
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=SEC_HEADERS) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        _cik_cache = {
            v["ticker"]: (v["cik_str"], v.get("title", ""))
            for v in data.values()
            if v.get("ticker")
        }
        logger.info("[edgar_portfolio] Loaded CIK cache: %d tickers", len(_cik_cache))
    except Exception:
        logger.error("[edgar_portfolio] Failed to load CIK cache", exc_info=True)


def _get_cik(ticker: str) -> Optional[int]:
    """Return CIK for a ticker, or None if not found."""
    entry = _cik_cache.get(ticker)
    return entry[0] if entry else None


def _get_company_title(ticker: str) -> str:
    """Return SEC company title for a ticker."""
    entry = _cik_cache.get(ticker)
    return entry[1] if entry else ""


# ---------------------------------------------------------------------------
# SEC submissions API — primary filing source
# ---------------------------------------------------------------------------

async def _fetch_submissions(cik: int) -> Optional[Dict[str, Any]]:
    """Fetch filings from SEC submissions API for a CIK."""
    padded = str(cik).zfill(10)
    url = f"https://data.sec.gov/submissions/CIK{padded}.json"
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=SEC_HEADERS) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception:
        logger.warning("[edgar_portfolio] Submissions API failed for CIK %s", padded)
        return None


def _parse_submissions_filings(
    data: Dict[str, Any],
    date_from: str,
    company_name: str,
) -> List[Dict[str, Any]]:
    """Parse filings from submissions API response.

    The ``filings.recent`` object has parallel arrays (column-store format).
    We filter by form type and date, then build filing dicts.
    """
    recent = data.get("filings", {}).get("recent", {})
    accessions = recent.get("accessionNumber", [])
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    primary_docs = recent.get("primaryDocument", [])
    descriptions = recent.get("primaryDocDescription", [])

    # The CIK for URL construction
    company_cik = str(data.get("cik", "")).lstrip("0")

    results = []
    for i in range(len(accessions)):
        form = forms[i] if i < len(forms) else ""
        filing_date = dates[i] if i < len(dates) else ""

        # Filter: M&A form types only
        if form not in MA_FORM_TYPES:
            continue

        # Filter: only filings after the deal announcement
        if filing_date < date_from:
            continue

        accession = accessions[i]
        primary_doc = primary_docs[i] if i < len(primary_docs) else ""
        desc = descriptions[i] if i < len(descriptions) else form

        # Build filing URL: use filer CIK from accession number (strip leading zeros)
        filer_cik = accession.split("-")[0].lstrip("0") if accession else company_cik
        acc_nodash = accession.replace("-", "")
        if primary_doc:
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{filer_cik}/{acc_nodash}/{primary_doc}"
        else:
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{filer_cik}/{acc_nodash}/{accession}-index.htm"

        results.append({
            "accession_number": accession,
            "filing_type": form,
            "company_name": company_name,
            "filing_date": filing_date,
            "filing_url": filing_url,
            "description": desc or form,
        })

    return results


async def _fetch_deal_filings(ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch all M&A-relevant filings for a deal from SEC submissions API.

    Searches both the target company and acquiror company filings.
    Uses announce_date for historical lookback (defaults to 180 days).
    """
    ticker = ctx["ticker"]
    acquiror_name = ctx.get("acquiror")
    target_name = ctx.get("target")
    announce_date = ctx.get("announce_date")

    # Determine date cutoff — go back to deal announcement
    if announce_date:
        # Start 7 days before announcement to catch pre-announcement filings
        if isinstance(announce_date, str):
            try:
                dt = datetime.strptime(announce_date, "%Y-%m-%d")
            except ValueError:
                dt = datetime.utcnow() - timedelta(days=180)
        else:
            dt = announce_date if hasattr(announce_date, 'strftime') else datetime.utcnow() - timedelta(days=180)
        date_from = (dt - timedelta(days=7)).strftime("%Y-%m-%d")
    else:
        date_from = (datetime.utcnow() - timedelta(days=180)).strftime("%Y-%m-%d")

    all_filings = []
    seen_accessions = set()

    # 1. Target company filings (the ticker itself)
    target_cik = _get_cik(ticker)
    if target_cik:
        company_title = _clean_company_title(_get_company_title(ticker))
        data = await _fetch_submissions(target_cik)
        if data:
            filings = _parse_submissions_filings(data, date_from, company_title)
            for f in filings:
                if f["accession_number"] not in seen_accessions:
                    seen_accessions.add(f["accession_number"])
                    all_filings.append(f)
            logger.debug(
                "[edgar_portfolio] %s target CIK %s: %d filings since %s",
                ticker, target_cik, len(filings), date_from,
            )

    # 2. Acquiror company filings (if acquiror is a public company)
    if acquiror_name:
        acquiror_ticker = _extract_ticker_from_name(acquiror_name)
        if acquiror_ticker and acquiror_ticker != ticker:
            acq_cik = _get_cik(acquiror_ticker)
            if acq_cik:
                acq_title = _clean_company_title(_get_company_title(acquiror_ticker))
                data = await _fetch_submissions(acq_cik)
                if data:
                    filings = _parse_submissions_filings(data, date_from, acq_title)
                    for f in filings:
                        if f["accession_number"] not in seen_accessions:
                            seen_accessions.add(f["accession_number"])
                            all_filings.append(f)
                    logger.debug(
                        "[edgar_portfolio] %s acquiror %s CIK %s: %d filings",
                        ticker, acquiror_ticker, acq_cik, len(filings),
                    )

    if not all_filings:
        logger.debug("[edgar_portfolio] %s: no CIK found or no filings", ticker)

    return all_filings


def _extract_ticker_from_name(name: str) -> Optional[str]:
    """Try to extract a ticker from an acquiror name.

    Handles formats like "Silver Lake / EA" or "AAPL" or "Broadcom Inc (AVGO)".
    Returns None if no clear ticker can be extracted.
    """
    if not name:
        return None
    # If the name is itself a valid ticker (all caps, short)
    cleaned = name.strip().upper()
    if len(cleaned) <= 5 and cleaned.isalpha() and cleaned in _cik_cache:
        return cleaned
    # Check for ticker in parentheses
    import re
    m = re.search(r'\(([A-Z]{1,5})\)', name)
    if m and m.group(1) in _cik_cache:
        return m.group(1)
    return None


def _clean_company_title(title: str) -> str:
    """Clean SEC company title for display.

    Converts "ELECTRONIC ARTS INC." → "Electronic Arts Inc."
    """
    if not title:
        return ""
    # Title-case but preserve known abbreviations
    words = title.split()
    result = []
    for w in words:
        if w.upper() in ("INC.", "INC", "CORP.", "CORP", "LLC", "LTD.", "LTD", "LP", "L.P."):
            result.append(w.capitalize())
        elif w.upper() in ("II", "III", "IV"):
            result.append(w.upper())
        elif len(w) <= 2 and w.upper() == w:
            result.append(w.upper())
        else:
            result.append(w.capitalize())
    return " ".join(result)


# ---------------------------------------------------------------------------
# Storage & filtering
# ---------------------------------------------------------------------------

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


async def _store_filing_impact(
    pool, ticker: str, filing: Dict[str, Any], impact: Dict[str, Any]
) -> None:
    """Persist an AI filing impact assessment to the portfolio_filing_impacts table."""
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO portfolio_filing_impacts
                       (ticker, filing_accession, filing_type, filed_at,
                        impact_level, summary, key_detail,
                        risk_factor_affected, grade_change_suggested,
                        action_required)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                   ON CONFLICT DO NOTHING""",
                ticker,
                filing.get("accession_number", ""),
                filing.get("filing_type", ""),
                filing.get("filing_date", ""),
                impact.get("impact", "none"),
                impact.get("summary", ""),
                impact.get("key_detail", ""),
                impact.get("risk_factor_affected", "none"),
                impact.get("grade_change_suggested"),
                impact.get("action_required", False),
            )
        logger.debug(
            "[edgar_portfolio] Stored filing impact for %s: %s (%s)",
            ticker, impact.get("impact"), filing.get("filing_type"),
        )
    except Exception:
        logger.error(
            "[edgar_portfolio] Failed to store filing impact for %s",
            ticker, exc_info=True,
        )
