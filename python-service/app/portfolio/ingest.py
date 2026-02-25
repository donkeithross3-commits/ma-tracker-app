"""
M&A Portfolio Google Sheet Ingest Module

Fetches the production M&A portfolio from Google Sheets and stores
snapshots in PostgreSQL for the DR3 dashboard.
"""
import hashlib
import logging
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple
import json

import aiohttp
import asyncpg
import pandas as pd

logger = logging.getLogger(__name__)

SHEET_ID = "148_gz88_8cXhyZnCZyJxFufqlbqTzTnVSy37O19Fh2c"
DASHBOARD_GID = "184471543"
EXPORT_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid="

# Column name mapping from sheet headers to DB column names
COLUMN_MAP = {
    "Ticker": "ticker",
    "Acquiror": "acquiror",
    "Anncd": "announced_date_raw",
    "Close": "close_date_raw",
    "End Dt": "end_date_raw",
    "Cntdwn": "countdown_raw",
    "Deal Px": "deal_price_raw",
    "Crrnt Px": "current_price_raw",
    "Grss Yield": "gross_yield_raw",
    "Px Chng": "price_change_raw",
    "Crrnt Yield": "current_yield_raw",
    "Category": "category",
    "Investable": "investable",
    "Go Shop or Likely Overbid?": "go_shop_raw",
    "Vote Risk": "vote_risk",
    "Finance Risk": "finance_risk",
    "Legal Risk": "legal_risk",
    "CVR": "cvr_flag",
    "Link to Sheet": "link_to_sheet",
}


async def fetch_csv(gid: str) -> str:
    """Fetch raw CSV content from Google Sheets export.

    Args:
        gid: The Google Sheet tab GID to fetch.

    Returns:
        Raw CSV content as a string.

    Raises:
        aiohttp.ClientError: On network or HTTP errors.
        ValueError: If the response is not valid CSV content.
    """
    url = f"{EXPORT_URL}{gid}"
    logger.info("Fetching CSV from Google Sheets (gid=%s)", gid)

    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise ValueError(
                    f"Google Sheets returned HTTP {resp.status} for gid={gid}: {body[:200]}"
                )
            content = await resp.text()

    if not content.strip():
        raise ValueError(f"Empty CSV response for gid={gid}")

    # Basic sanity check: CSV should have commas and newlines
    if "\n" not in content or "," not in content:
        raise ValueError(
            f"Response for gid={gid} does not look like CSV (no commas or newlines)"
        )

    logger.info(
        "Fetched CSV: %d bytes, %d lines",
        len(content),
        content.count("\n"),
    )
    return content


def compute_hash(content: str) -> str:
    """SHA-256 hash of CSV content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def parse_price(raw: Any) -> Optional[Decimal]:
    """Parse '$15.85' -> Decimal('15.85'), '$0.00' -> Decimal('0.00').

    Strips dollar signs and whitespace. Returns None for empty/NaN values.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        logger.warning("Could not parse price: %r", raw)
        return None


def parse_percent(raw: Any) -> Optional[Decimal]:
    """Parse '-5.52%' -> Decimal('-0.0552'), '#DIV/0!' -> None.

    Strips percent signs, divides by 100. Returns None for errors and empty values.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s or s == "#DIV/0!" or s == "#VALUE!" or s == "#N/A":
        return None
    s = s.replace("%", "")
    if not s:
        return None
    try:
        return Decimal(s) / Decimal("100")
    except InvalidOperation:
        logger.warning("Could not parse percent: %r", raw)
        return None


def parse_date_mdy(raw: Any) -> Optional[date]:
    """Parse 'M/D/YY' -> date. '1/7/25' -> 2025-01-07.

    Two-digit years are interpreted as 20xx. Returns None for empty/NaN values.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%m/%d/%y")
        return dt.date()
    except ValueError:
        # Try 4-digit year format as fallback
        try:
            dt = datetime.strptime(s, "%m/%d/%Y")
            return dt.date()
        except ValueError:
            logger.warning("Could not parse date: %r", raw)
            return None


def parse_countdown(raw: Any) -> Optional[int]:
    """Parse countdown field. '175' -> 175, '11/3/1773' -> None, negative ok.

    The '11/3/1773' artifact indicates no end date is set. Returns None for
    that case and for empty/NaN values.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s:
        return None

    # Detect the 1773 artifact (date-like string with year < 1900)
    if "/" in s:
        logger.debug("Countdown contains '/' (likely artifact): %r -> None", s)
        return None

    try:
        return int(float(s))
    except (ValueError, OverflowError):
        logger.warning("Could not parse countdown: %r", raw)
        return None


def extract_gid(link: Any) -> Optional[str]:
    """Extract GID from sheet link.

    Handles both formats:
    - '?gid=1740096008#gid=1740096008' (most rows)
    - Full URL: 'https://docs.google.com/...?gid=NNN#gid=NNN' (e.g. SLAB)

    Returns the GID string, or None if not found.
    """
    if link is None or (isinstance(link, float) and pd.isna(link)):
        return None
    s = str(link).strip()
    if not s:
        return None

    # Look for gid= pattern in the string (works for both fragment and query param)
    match = re.search(r"gid=(\d+)", s)
    if match:
        return match.group(1)

    logger.warning("Could not extract GID from link: %r", s)
    return None


def _safe_str(val: Any) -> Optional[str]:
    """Convert a value to string, returning None for NaN/empty."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    return s if s else None


def parse_row(row: pd.Series, idx: int) -> Dict[str, Any]:
    """Parse a single sheet row into a database-ready dict.

    Stores both raw string values and parsed/cleaned values for each field.

    Args:
        row: A pandas Series representing one row of the spreadsheet.
        idx: The 0-based row index in the DataFrame.

    Returns:
        Dict with all column values, both raw and parsed.
    """
    # Map sheet column names to our internal names
    mapped = {}
    for sheet_col, db_col in COLUMN_MAP.items():
        mapped[db_col] = row.get(sheet_col)

    # Build the result dict with raw values preserved
    result: Dict[str, Any] = {
        "row_index": idx,
        "ticker": _safe_str(mapped.get("ticker")),
        "acquiror": _safe_str(mapped.get("acquiror")),
        "announced_date_raw": _safe_str(mapped.get("announced_date_raw")),
        "close_date_raw": _safe_str(mapped.get("close_date_raw")),
        "end_date_raw": _safe_str(mapped.get("end_date_raw")),
        "countdown_raw": _safe_str(mapped.get("countdown_raw")),
        "deal_price_raw": _safe_str(mapped.get("deal_price_raw")),
        "current_price_raw": _safe_str(mapped.get("current_price_raw")),
        "gross_yield_raw": _safe_str(mapped.get("gross_yield_raw")),
        "price_change_raw": _safe_str(mapped.get("price_change_raw")),
        "current_yield_raw": _safe_str(mapped.get("current_yield_raw")),
        "category": _safe_str(mapped.get("category")),
        "investable": _safe_str(mapped.get("investable")),
        "go_shop_raw": _safe_str(mapped.get("go_shop_raw")),
        "vote_risk": _safe_str(mapped.get("vote_risk")),
        "finance_risk": _safe_str(mapped.get("finance_risk")),
        "legal_risk": _safe_str(mapped.get("legal_risk")),
        "cvr_flag": _safe_str(mapped.get("cvr_flag")),
        "link_to_sheet": _safe_str(mapped.get("link_to_sheet")),
        # Parsed values
        "announced_date": parse_date_mdy(mapped.get("announced_date_raw")),
        "close_date": parse_date_mdy(mapped.get("close_date_raw")),
        "end_date": parse_date_mdy(mapped.get("end_date_raw")),
        "countdown_days": parse_countdown(mapped.get("countdown_raw")),
        "deal_price": parse_price(mapped.get("deal_price_raw")),
        "current_price": parse_price(mapped.get("current_price_raw")),
        "gross_yield": parse_percent(mapped.get("gross_yield_raw")),
        "price_change": parse_percent(mapped.get("price_change_raw")),
        "current_yield": parse_percent(mapped.get("current_yield_raw")),
        "deal_tab_gid": extract_gid(mapped.get("link_to_sheet")),
    }

    # Store original row as JSON for debugging / future use
    raw_dict = {}
    for col in row.index:
        val = row[col]
        if isinstance(val, float) and pd.isna(val):
            raw_dict[col] = None
        else:
            raw_dict[col] = val
    result["raw_json"] = json.dumps(raw_dict, default=str)

    return result


async def _snapshot_exists_with_hash(
    conn: asyncpg.Connection,
    snapshot_date: date,
    tab_gid: str,
    content_hash: str,
) -> Tuple[bool, Optional[str]]:
    """Check if a snapshot already exists for this date/gid with the same hash.

    Returns:
        (exists_with_same_hash, existing_snapshot_id)
    """
    row = await conn.fetchrow(
        """
        SELECT id, content_hash
        FROM sheet_snapshots
        WHERE snapshot_date = $1 AND tab_gid = $2
        ORDER BY ingested_at DESC
        LIMIT 1
        """,
        snapshot_date,
        tab_gid,
    )
    if row is None:
        return False, None
    return row["content_hash"] == content_hash, str(row["id"])


async def _delete_existing_snapshot(
    conn: asyncpg.Connection,
    snapshot_id: str,
) -> None:
    """Delete an existing snapshot and its rows (for re-ingest with new data)."""
    sid = uuid.UUID(snapshot_id)
    await conn.execute("DELETE FROM sheet_rows WHERE snapshot_id = $1", sid)
    await conn.execute("DELETE FROM sheet_snapshots WHERE id = $1", sid)
    logger.info("Deleted existing snapshot %s for re-ingest", snapshot_id)


async def _insert_snapshot(
    conn: asyncpg.Connection,
    snapshot_id: uuid.UUID,
    snapshot_date: date,
    tab_gid: str,
    row_count: int,
    content_hash: str,
) -> None:
    """Insert a new sheet_snapshots record."""
    await conn.execute(
        """
        INSERT INTO sheet_snapshots
            (id, snapshot_date, tab_name, tab_gid, row_count, content_hash,
             status, ingested_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        """,
        snapshot_id,
        snapshot_date,
        "Dashboard",
        tab_gid,
        row_count,
        content_hash,
        "success",
    )


async def _insert_rows(
    conn: asyncpg.Connection,
    snapshot_id: uuid.UUID,
    rows: List[Dict[str, Any]],
) -> int:
    """Batch-insert parsed sheet rows into sheet_rows table.

    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    count = 0
    for row_data in rows:
        row_id = uuid.uuid4()
        await conn.execute(
            """
            INSERT INTO sheet_rows (
                id, snapshot_id, row_index,
                ticker, acquiror,
                announced_date_raw, close_date_raw, end_date_raw,
                countdown_raw, deal_price_raw, current_price_raw,
                gross_yield_raw, price_change_raw, current_yield_raw,
                category, investable, go_shop_raw,
                vote_risk, finance_risk, legal_risk, cvr_flag,
                link_to_sheet,
                announced_date, close_date, end_date,
                countdown_days, deal_price, current_price,
                gross_yield, price_change, current_yield,
                deal_tab_gid, raw_json, is_excluded, created_at
            ) VALUES (
                $1, $2, $3,
                $4, $5,
                $6, $7, $8,
                $9, $10, $11,
                $12, $13, $14,
                $15, $16, $17,
                $18, $19, $20, $21,
                $22,
                $23, $24, $25,
                $26, $27, $28,
                $29, $30, $31,
                $32, $33::jsonb, $34, NOW()
            )
            """,
            row_id,
            snapshot_id,
            row_data["row_index"],
            row_data["ticker"],
            row_data["acquiror"],
            row_data["announced_date_raw"],
            row_data["close_date_raw"],
            row_data["end_date_raw"],
            row_data["countdown_raw"],
            row_data["deal_price_raw"],
            row_data["current_price_raw"],
            row_data["gross_yield_raw"],
            row_data["price_change_raw"],
            row_data["current_yield_raw"],
            row_data["category"],
            row_data["investable"],
            row_data["go_shop_raw"],
            row_data["vote_risk"],
            row_data["finance_risk"],
            row_data["legal_risk"],
            row_data["cvr_flag"],
            row_data["link_to_sheet"],
            row_data["announced_date"],
            row_data["close_date"],
            row_data["end_date"],
            row_data["countdown_days"],
            row_data["deal_price"],
            row_data["current_price"],
            row_data["gross_yield"],
            row_data["price_change"],
            row_data["current_yield"],
            row_data["deal_tab_gid"],
            row_data["raw_json"],
            row_data.get("is_excluded", False),
        )
        count += 1

    return count


async def _apply_allowlist(
    conn: asyncpg.Connection,
    parsed_rows: List[Dict[str, Any]],
) -> int:
    """Cross-reference parsed rows with deal_allowlist.

    - Auto-seeds new tickers with status='active', source='ingest_auto'
    - Marks rows with excluded tickers via is_excluded=True

    Returns count of excluded rows.
    """
    # Fetch current allowlist
    allowlist_rows = await conn.fetch("SELECT ticker, status FROM deal_allowlist")
    allowlist = {r["ticker"]: r["status"] for r in allowlist_rows}

    # Auto-seed new tickers
    current_tickers = {r["ticker"] for r in parsed_rows if r["ticker"]}
    new_tickers = current_tickers - set(allowlist.keys())
    for ticker in sorted(new_tickers):
        await conn.execute(
            """
            INSERT INTO deal_allowlist (ticker, status, source, created_at, updated_at)
            VALUES ($1, 'active', 'ingest_auto', NOW(), NOW())
            ON CONFLICT (ticker) DO NOTHING
            """,
            ticker,
        )
        allowlist[ticker] = "active"
    if new_tickers:
        logger.info("Auto-seeded %d new tickers to allowlist: %s", len(new_tickers), sorted(new_tickers))

    # Mark excluded rows
    excluded_count = 0
    for row_data in parsed_rows:
        ticker = row_data.get("ticker")
        if ticker and allowlist.get(ticker) == "excluded":
            row_data["is_excluded"] = True
            excluded_count += 1
        else:
            row_data["is_excluded"] = False

    if excluded_count:
        logger.info("Marked %d rows as excluded via allowlist", excluded_count)
    return excluded_count


async def _store_diffs(
    conn: asyncpg.Connection,
    snapshot_id: uuid.UUID,
    parsed_rows: List[Dict[str, Any]],
) -> int:
    """Compute and store diffs vs previous snapshot in sheet_diffs table.

    Returns count of diff records created.
    """
    # Get previous snapshot
    prev_snap = await conn.fetchrow(
        """
        SELECT id FROM sheet_snapshots
        WHERE tab_gid = $1 AND id != $2 AND status = 'success'
        ORDER BY snapshot_date DESC, ingested_at DESC
        LIMIT 1
        """,
        DASHBOARD_GID,
        snapshot_id,
    )
    if not prev_snap:
        return 0

    prev_rows = await conn.fetch(
        "SELECT ticker, deal_price_raw, current_price_raw, gross_yield_raw, "
        "current_yield_raw, category, investable, vote_risk, finance_risk, "
        "legal_risk, close_date_raw, end_date_raw, countdown_raw, go_shop_raw, cvr_flag "
        "FROM sheet_rows WHERE snapshot_id = $1 AND ticker IS NOT NULL",
        prev_snap["id"],
    )
    prev_by_ticker = {r["ticker"]: dict(r) for r in prev_rows}

    current_by_ticker = {}
    compare_fields = [
        "deal_price_raw", "current_price_raw", "gross_yield_raw",
        "current_yield_raw", "category", "investable", "vote_risk",
        "finance_risk", "legal_risk", "close_date_raw", "end_date_raw",
        "countdown_raw", "go_shop_raw", "cvr_flag",
    ]
    for r in parsed_rows:
        if r.get("ticker"):
            current_by_ticker[r["ticker"]] = {k: r.get(k) for k in compare_fields}

    current_tickers = set(current_by_ticker.keys())
    prev_tickers = set(prev_by_ticker.keys())
    diff_count = 0

    # Added
    for t in current_tickers - prev_tickers:
        await conn.execute(
            """INSERT INTO sheet_diffs (id, snapshot_id, ticker, diff_type, changed_fields, detected_at)
               VALUES ($1, $2, $3, 'added', '{}'::jsonb, NOW())""",
            uuid.uuid4(), snapshot_id, t,
        )
        diff_count += 1

    # Removed
    for t in prev_tickers - current_tickers:
        await conn.execute(
            """INSERT INTO sheet_diffs (id, snapshot_id, ticker, diff_type, changed_fields, detected_at)
               VALUES ($1, $2, $3, 'removed', '{}'::jsonb, NOW())""",
            uuid.uuid4(), snapshot_id, t,
        )
        diff_count += 1

    # Modified
    for t in current_tickers & prev_tickers:
        changed = {}
        cur = current_by_ticker[t]
        prev = prev_by_ticker[t]
        for k in compare_fields:
            cv = cur.get(k)
            pv = prev.get(k)
            if cv != pv:
                changed[k] = {"old": pv, "new": cv}
        if changed:
            await conn.execute(
                """INSERT INTO sheet_diffs (id, snapshot_id, ticker, diff_type, changed_fields, detected_at)
                   VALUES ($1, $2, $3, 'modified', $4::jsonb, NOW())""",
                uuid.uuid4(), snapshot_id, t, json.dumps(changed, default=str),
            )
            diff_count += 1

    if diff_count:
        logger.info("Stored %d diffs vs previous snapshot", diff_count)
    return diff_count


async def _cleanup_old_snapshots(conn: asyncpg.Connection) -> int:
    """Delete snapshots older than 30 days, keeping at least 2.

    Returns count of deleted snapshots.
    """
    # Count total snapshots
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM sheet_snapshots WHERE tab_gid = $1 AND status = 'success'",
        DASHBOARD_GID,
    )
    if total is None or total <= 2:
        return 0

    # Find cutoff: snapshots older than 30 days, but keep at least 2
    old_ids = await conn.fetch(
        """
        SELECT id FROM sheet_snapshots
        WHERE tab_gid = $1 AND status = 'success'
          AND ingested_at < NOW() - INTERVAL '30 days'
        ORDER BY ingested_at ASC
        LIMIT $2
        """,
        DASHBOARD_GID,
        max(0, total - 2),
    )

    deleted = 0
    for row in old_ids:
        sid = row["id"]
        await conn.execute("DELETE FROM sheet_diffs WHERE snapshot_id = $1", sid)
        await conn.execute("DELETE FROM sheet_deal_details WHERE snapshot_id = $1", sid)
        await conn.execute("DELETE FROM sheet_rows WHERE snapshot_id = $1", sid)
        await conn.execute("DELETE FROM sheet_snapshots WHERE id = $1", sid)
        deleted += 1

    if deleted:
        logger.info("Cleaned up %d old snapshots (>30 days)", deleted)
    return deleted


async def ingest_dashboard(
    db_pool: asyncpg.Pool,
    snapshot_date: Optional[date] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Main ingest function. Fetches dashboard tab, parses, stores in DB.

    Args:
        db_pool: asyncpg connection pool.
        snapshot_date: Date to associate with the snapshot (defaults to today).
        force: If True, skip hash-based deduplication and always re-ingest.

    Returns:
        Dict with: snapshot_id, row_count, status, skipped (bool if hash matched).
    """
    if snapshot_date is None:
        snapshot_date = date.today()

    gid = DASHBOARD_GID
    logger.info(
        "Starting dashboard ingest for date=%s, gid=%s, force=%s",
        snapshot_date,
        gid,
        force,
    )

    # Step 1: Fetch CSV
    try:
        csv_content = await fetch_csv(gid)
    except Exception:
        logger.error("Failed to fetch CSV from Google Sheets", exc_info=True)
        # Record the failure in the database
        async with db_pool.acquire() as conn:
            error_id = uuid.uuid4()
            await conn.execute(
                """
                INSERT INTO sheet_snapshots
                    (id, snapshot_date, tab_name, tab_gid, row_count, content_hash,
                     status, error_message, ingested_at)
                VALUES ($1, $2, $3, $4, 0, '', $5, $6, NOW())
                """,
                error_id,
                snapshot_date,
                "Dashboard",
                gid,
                "error",
                "Failed to fetch CSV from Google Sheets",
            )
        raise

    # Step 2: Compute hash for idempotency
    content_hash = compute_hash(csv_content)
    logger.info("CSV content hash: %s", content_hash)

    # Step 3: Check for existing identical snapshot
    async with db_pool.acquire() as conn:
        if not force:
            same_hash, existing_id = await _snapshot_exists_with_hash(
                conn, snapshot_date, gid, content_hash
            )
            if same_hash and existing_id:
                logger.info(
                    "Snapshot for date=%s gid=%s already exists with same hash, skipping",
                    snapshot_date,
                    gid,
                )
                return {
                    "snapshot_id": existing_id,
                    "row_count": 0,
                    "status": "skipped",
                    "skipped": True,
                    "content_hash": content_hash,
                }

    # Step 4: Parse CSV into DataFrame
    try:
        df = pd.read_csv(StringIO(csv_content), keep_default_na=False, na_values=[""])
    except Exception:
        logger.error("Failed to parse CSV content", exc_info=True)
        raise ValueError("Could not parse CSV content from Google Sheets")

    logger.info("Parsed CSV: %d rows, %d columns", len(df), len(df.columns))
    logger.info("Columns found: %s", list(df.columns))

    # Step 5: Parse each row
    parsed_rows: List[Dict[str, Any]] = []
    parse_errors = 0
    for idx, row in df.iterrows():
        try:
            parsed = parse_row(row, int(idx))
            # Skip rows with no ticker (likely empty/separator rows)
            if parsed["ticker"] is None:
                logger.debug("Skipping row %d: no ticker", idx)
                continue
            parsed_rows.append(parsed)
        except Exception:
            parse_errors += 1
            logger.warning("Error parsing row %d", idx, exc_info=True)

    if parse_errors > 0:
        logger.warning(
            "Encountered %d parse errors out of %d rows", parse_errors, len(df)
        )

    logger.info("Parsed %d valid deal rows", len(parsed_rows))

    # Step 6: Write to database in a transaction
    snapshot_id = uuid.uuid4()
    excluded_count = 0
    diff_count = 0
    async with db_pool.acquire() as conn:
        async with conn.transaction():
            # Delete existing snapshot for same date/gid if hash differs (re-ingest)
            _, existing_id = await _snapshot_exists_with_hash(
                conn, snapshot_date, gid, content_hash
            )
            if existing_id:
                await _delete_existing_snapshot(conn, existing_id)

            # Apply allowlist: auto-seed new tickers, mark excluded rows
            excluded_count = await _apply_allowlist(conn, parsed_rows)

            # Insert snapshot record
            await _insert_snapshot(
                conn, snapshot_id, snapshot_date, gid, len(parsed_rows), content_hash
            )

            # Insert all rows
            inserted = await _insert_rows(conn, snapshot_id, parsed_rows)

            # Compute and store diffs vs previous snapshot
            diff_count = await _store_diffs(conn, snapshot_id, parsed_rows)

        # Snapshot cleanup (outside transaction to not block ingest on failure)
        try:
            await _cleanup_old_snapshots(conn)
        except Exception:
            logger.warning("Snapshot cleanup failed (non-critical)", exc_info=True)

    logger.info(
        "Ingest complete: snapshot_id=%s, %d rows inserted, %d excluded, %d diffs",
        snapshot_id, inserted, excluded_count, diff_count,
    )

    # Dual-write: sync to canonical_deals table
    canonical_synced = 0
    try:
        canonical_synced = await sync_to_canonical(db_pool, parsed_rows)
    except Exception:
        logger.warning("Canonical sync failed (non-critical)", exc_info=True)

    return {
        "snapshot_id": str(snapshot_id),
        "row_count": inserted,
        "status": "success",
        "skipped": False,
        "content_hash": content_hash,
        "parse_errors": parse_errors,
        "excluded_count": excluded_count,
        "diff_count": diff_count,
        "canonical_synced": canonical_synced,
    }


async def sync_to_canonical(
    db_pool: asyncpg.Pool,
    parsed_rows: List[Dict[str, Any]],
) -> int:
    """Sync parsed sheet rows to canonical_deals table (dual-write).

    Upserts canonical_deals for each deal in the latest snapshot.
    Called after ingest_dashboard() completes.

    Returns count of deals synced.
    """
    synced = 0
    async with db_pool.acquire() as conn:
        for row_data in parsed_rows:
            ticker = row_data.get("ticker")
            if not ticker:
                continue
            if row_data.get("is_excluded", False):
                continue

            try:
                await conn.execute(
                    """
                    INSERT INTO canonical_deals (
                        ticker, acquiror_name, deal_structure,
                        deal_price, current_price,
                        announced_date, expected_close_date, outside_date,
                        has_cvr, sheet_investable, investable_flag,
                        go_shop_text, sheet_detail_gid,
                        status, sheet_last_updated,
                        data_provenance, updated_at
                    ) VALUES (
                        $1, $2, $3,
                        $4, $5,
                        $6, $7, $8,
                        $9, $10, $11,
                        $12, $13,
                        'active', NOW(),
                        $14::jsonb, NOW()
                    )
                    ON CONFLICT (ticker) DO UPDATE SET
                        acquiror_name = COALESCE(EXCLUDED.acquiror_name, canonical_deals.acquiror_name),
                        deal_structure = COALESCE(EXCLUDED.deal_structure, canonical_deals.deal_structure),
                        deal_price = COALESCE(EXCLUDED.deal_price, canonical_deals.deal_price),
                        current_price = COALESCE(EXCLUDED.current_price, canonical_deals.current_price),
                        announced_date = COALESCE(EXCLUDED.announced_date, canonical_deals.announced_date),
                        expected_close_date = COALESCE(EXCLUDED.expected_close_date, canonical_deals.expected_close_date),
                        outside_date = COALESCE(EXCLUDED.outside_date, canonical_deals.outside_date),
                        has_cvr = EXCLUDED.has_cvr,
                        sheet_investable = EXCLUDED.sheet_investable,
                        investable_flag = EXCLUDED.investable_flag,
                        go_shop_text = COALESCE(EXCLUDED.go_shop_text, canonical_deals.go_shop_text),
                        sheet_detail_gid = COALESCE(EXCLUDED.sheet_detail_gid, canonical_deals.sheet_detail_gid),
                        sheet_last_updated = NOW(),
                        data_provenance = canonical_deals.data_provenance || EXCLUDED.data_provenance,
                        updated_at = NOW()
                    """,
                    ticker,
                    row_data.get("acquiror"),
                    row_data.get("category"),
                    row_data.get("deal_price"),
                    row_data.get("current_price"),
                    row_data.get("announced_date"),
                    row_data.get("close_date"),
                    row_data.get("end_date"),
                    row_data.get("cvr_flag", "").upper() == "YES" if row_data.get("cvr_flag") else False,
                    row_data.get("investable"),
                    row_data.get("investable", "").strip().lower() in ("yes", "y") if row_data.get("investable") else None,
                    row_data.get("go_shop_raw"),
                    row_data.get("deal_tab_gid"),
                    json.dumps({
                        "deal_price": {"source": "sheet", "date": str(date.today())},
                        "current_price": {"source": "sheet", "date": str(date.today())},
                        "acquiror_name": {"source": "sheet", "date": str(date.today())},
                    }),
                )
                synced += 1
            except Exception:
                logger.warning("Failed to sync %s to canonical_deals", ticker, exc_info=True)

    logger.info("Synced %d deals to canonical_deals", synced)
    return synced


async def check_ingest_health(db_pool: asyncpg.Pool) -> Dict[str, Any]:
    """Health check: last successful ingest date, row count, any recent failures.

    Returns a dict with:
        - last_success_date: Date of last successful ingest (or None)
        - last_success_rows: Row count of last successful ingest
        - last_ingest_at: Timestamp of last ingest attempt
        - recent_failures: Count of failed ingests in the last 7 days
        - status: 'healthy', 'stale', or 'unhealthy'
    """
    async with db_pool.acquire() as conn:
        # Last successful ingest
        last_success = await conn.fetchrow(
            """
            SELECT snapshot_date, row_count, ingested_at, content_hash
            FROM sheet_snapshots
            WHERE tab_gid = $1 AND status = 'success'
            ORDER BY ingested_at DESC
            LIMIT 1
            """,
            DASHBOARD_GID,
        )

        # Recent failures (last 7 days)
        failure_count = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM sheet_snapshots
            WHERE tab_gid = $1
              AND status = 'error'
              AND ingested_at > NOW() - INTERVAL '7 days'
            """,
            DASHBOARD_GID,
        )

        # Last ingest attempt of any status
        last_attempt = await conn.fetchrow(
            """
            SELECT snapshot_date, status, ingested_at, error_message
            FROM sheet_snapshots
            WHERE tab_gid = $1
            ORDER BY ingested_at DESC
            LIMIT 1
            """,
            DASHBOARD_GID,
        )

    result: Dict[str, Any] = {
        "last_success_date": None,
        "last_success_rows": 0,
        "last_success_at": None,
        "last_attempt_at": None,
        "last_attempt_status": None,
        "recent_failures": failure_count or 0,
        "status": "unhealthy",
    }

    if last_success:
        result["last_success_date"] = str(last_success["snapshot_date"])
        result["last_success_rows"] = last_success["row_count"]
        result["last_success_at"] = (
            last_success["ingested_at"].isoformat()
            if last_success["ingested_at"]
            else None
        )

        # Determine staleness: if last success is more than 2 days old, it's stale
        days_since = (date.today() - last_success["snapshot_date"]).days
        if days_since <= 2:
            result["status"] = "healthy"
        else:
            result["status"] = "stale"
    else:
        result["status"] = "unhealthy"

    if last_attempt:
        result["last_attempt_at"] = (
            last_attempt["ingested_at"].isoformat()
            if last_attempt["ingested_at"]
            else None
        )
        result["last_attempt_status"] = last_attempt["status"]
        if last_attempt["error_message"]:
            result["last_error"] = last_attempt["error_message"]

    return result
