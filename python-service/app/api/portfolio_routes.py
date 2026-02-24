"""API routes for Google Sheet portfolio ingestion and deal tracking"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import date, datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _get_pool():
    """Get the database connection pool from the global EdgarDatabase instance."""
    from ..main import get_db
    db = get_db()
    if db.pool is None:
        raise HTTPException(status_code=503, detail="Database pool not available")
    return db.pool


# ---------------------------------------------------------------------------
# POST /portfolio/ingest
# ---------------------------------------------------------------------------
@router.post("/ingest")
async def ingest_dashboard_endpoint(
    force: bool = Query(False, description="Re-ingest even if hash matches"),
    date: Optional[str] = Query(None, description="Snapshot date (YYYY-MM-DD), default today"),
):
    """Trigger a manual ingest of the Google Sheet dashboard tab."""
    from app.portfolio.ingest import ingest_dashboard

    pool = _get_pool()

    snapshot_date: date
    if date:
        try:
            snapshot_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        from datetime import date as date_cls
        snapshot_date = date_cls.today()

    try:
        result = await ingest_dashboard(pool, snapshot_date, force)
        return result
    except Exception as e:
        logger.error(f"Dashboard ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Ingest failed: {str(e)}")


# ---------------------------------------------------------------------------
# POST /portfolio/ingest-details
# ---------------------------------------------------------------------------
@router.post("/ingest-details")
async def ingest_details_endpoint(
    ticker: Optional[str] = Query(None, description="Ingest details for a single deal ticker"),
):
    """Trigger ingest of all per-deal detail tabs for the latest snapshot."""
    from app.portfolio.ingest import ingest_dashboard
    from app.portfolio.detail_parser import ingest_deal_details

    pool = _get_pool()

    try:
        # Get the latest snapshot to find its id and deals
        async with pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id, snapshot_date FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshots found. Run /portfolio/ingest first.")

            snapshot_id = snapshot["id"]

            # Get deals from the snapshot
            if ticker:
                deals = await conn.fetch(
                    "SELECT parsed->>'ticker' as ticker FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' = $2",
                    snapshot_id, ticker.upper()
                )
            else:
                deals = await conn.fetch(
                    "SELECT DISTINCT parsed->>'ticker' as ticker FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' IS NOT NULL",
                    snapshot_id
                )

            deal_tickers = [r["ticker"] for r in deals if r["ticker"]]

        if not deal_tickers:
            raise HTTPException(status_code=404, detail="No deals found in the latest snapshot")

        result = await ingest_deal_details(pool, snapshot_id, deal_tickers)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Detail ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Detail ingest failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/snapshot
# ---------------------------------------------------------------------------
@router.get("/snapshot")
async def get_snapshot(
    tab: str = Query("dashboard", description="Tab name (default: dashboard)"),
    date: Optional[str] = Query(None, description="Snapshot date (YYYY-MM-DD), default latest"),
):
    """Get the latest snapshot data (or by date)."""
    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            if date:
                try:
                    snapshot_date = datetime.strptime(date, "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
                snapshot = await conn.fetchrow(
                    "SELECT id, snapshot_date, row_count, tab FROM sheet_snapshots WHERE snapshot_date = $1 AND tab = $2 ORDER BY ingested_at DESC LIMIT 1",
                    snapshot_date, tab
                )
            else:
                snapshot = await conn.fetchrow(
                    "SELECT id, snapshot_date, row_count, tab FROM sheet_snapshots WHERE tab = $1 ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1",
                    tab
                )

            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshot found")

            rows = await conn.fetch(
                "SELECT row_number, raw, parsed FROM sheet_rows WHERE snapshot_id = $1 ORDER BY row_number",
                snapshot["id"]
            )

            return {
                "snapshot_id": str(snapshot["id"]),
                "snapshot_date": str(snapshot["snapshot_date"]),
                "row_count": snapshot["row_count"],
                "rows": [
                    {
                        "row_number": r["row_number"],
                        "raw": r["raw"],
                        "parsed": r["parsed"],
                    }
                    for r in rows
                ],
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Snapshot fetch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshot: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/deal/{ticker}
# ---------------------------------------------------------------------------
@router.get("/deal/{ticker}")
async def get_deal(ticker: str):
    """Get detail data for a specific deal from the latest snapshot."""
    pool = _get_pool()
    ticker = ticker.upper()

    try:
        async with pool.acquire() as conn:
            # Get latest snapshot
            snapshot = await conn.fetchrow(
                "SELECT id FROM sheet_snapshots WHERE tab = 'dashboard' ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshots found")

            # Get dashboard row for this ticker
            dashboard_row = await conn.fetchrow(
                "SELECT row_number, raw, parsed FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' = $2",
                snapshot["id"], ticker
            )

            # Get deal details
            detail = await conn.fetchrow(
                "SELECT ticker, tab_name, raw, parsed, fetched_at FROM sheet_deal_details WHERE snapshot_id = $1 AND ticker = $2 ORDER BY fetched_at DESC LIMIT 1",
                snapshot["id"], ticker
            )

            if not dashboard_row and not detail:
                raise HTTPException(status_code=404, detail=f"No data found for ticker {ticker}")

            result = {"ticker": ticker}
            if dashboard_row:
                result["dashboard_row"] = {
                    "row_number": dashboard_row["row_number"],
                    "raw": dashboard_row["raw"],
                    "parsed": dashboard_row["parsed"],
                }
            else:
                result["dashboard_row"] = None

            if detail:
                result["detail"] = {
                    "tab_name": detail["tab_name"],
                    "raw": detail["raw"],
                    "parsed": detail["parsed"],
                    "fetched_at": str(detail["fetched_at"]),
                }
            else:
                result["detail"] = None

            return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Deal fetch failed for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch deal: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/deals
# ---------------------------------------------------------------------------
@router.get("/deals")
async def get_deals():
    """Get all deals from the latest snapshot (lightweight, key metrics only)."""
    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id FROM sheet_snapshots WHERE tab = 'dashboard' ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                return []

            rows = await conn.fetch(
                "SELECT parsed FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' IS NOT NULL ORDER BY row_number",
                snapshot["id"]
            )

            deals = []
            for r in rows:
                p = r["parsed"]
                if not p:
                    continue
                deals.append({
                    "ticker": p.get("ticker"),
                    "acquiror": p.get("acquiror"),
                    "category": p.get("category"),
                    "deal_price": p.get("deal_price"),
                    "current_price": p.get("current_price"),
                    "gross_yield": p.get("gross_yield"),
                    "current_yield": p.get("current_yield"),
                    "investable": p.get("investable"),
                })
            return deals
    except Exception as e:
        logger.error(f"Deals fetch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch deals: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/health
# ---------------------------------------------------------------------------
@router.get("/health")
async def portfolio_health():
    """Health check for portfolio ingest system."""
    from app.portfolio.ingest import check_ingest_health

    pool = _get_pool()

    try:
        result = await check_ingest_health(pool)
        return result
    except Exception as e:
        logger.error(f"Portfolio health check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/diff
# ---------------------------------------------------------------------------
@router.get("/diff")
async def get_diff(
    date: Optional[str] = Query(None, description="Snapshot date (YYYY-MM-DD), default latest"),
    prev_date: Optional[str] = Query(None, description="Previous date to compare (YYYY-MM-DD), default day before date"),
):
    """Get changes between two snapshot dates."""
    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            # Resolve the 'current' snapshot
            if date:
                try:
                    current_date = datetime.strptime(date, "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
                current_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date = $1 AND tab = 'dashboard' ORDER BY ingested_at DESC LIMIT 1",
                    current_date
                )
            else:
                current_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE tab = 'dashboard' ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
                )

            if not current_snap:
                raise HTTPException(status_code=404, detail="No current snapshot found")

            # Resolve the 'previous' snapshot
            if prev_date:
                try:
                    previous_date = datetime.strptime(prev_date, "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid prev_date format. Use YYYY-MM-DD")
                prev_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date = $1 AND tab = 'dashboard' ORDER BY ingested_at DESC LIMIT 1",
                    previous_date
                )
            else:
                prev_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date < $1 AND tab = 'dashboard' ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1",
                    current_snap["snapshot_date"]
                )

            if not prev_snap:
                raise HTTPException(status_code=404, detail="No previous snapshot found for comparison")

            # Get rows from both snapshots keyed by ticker
            current_rows = await conn.fetch(
                "SELECT parsed FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' IS NOT NULL",
                current_snap["id"]
            )
            prev_rows = await conn.fetch(
                "SELECT parsed FROM sheet_rows WHERE snapshot_id = $1 AND parsed->>'ticker' IS NOT NULL",
                prev_snap["id"]
            )

            current_by_ticker = {r["parsed"]["ticker"]: r["parsed"] for r in current_rows if r["parsed"] and r["parsed"].get("ticker")}
            prev_by_ticker = {r["parsed"]["ticker"]: r["parsed"] for r in prev_rows if r["parsed"] and r["parsed"].get("ticker")}

            current_tickers = set(current_by_ticker.keys())
            prev_tickers = set(prev_by_ticker.keys())

            diffs = []

            # Added deals
            for t in sorted(current_tickers - prev_tickers):
                diffs.append({"ticker": t, "diff_type": "added", "changed_fields": {}})

            # Removed deals
            for t in sorted(prev_tickers - current_tickers):
                diffs.append({"ticker": t, "diff_type": "removed", "changed_fields": {}})

            # Modified deals
            for t in sorted(current_tickers & prev_tickers):
                cur = current_by_ticker[t]
                prev = prev_by_ticker[t]
                changed = {}
                all_keys = set(cur.keys()) | set(prev.keys())
                for k in all_keys:
                    if k == "ticker":
                        continue
                    cv = cur.get(k)
                    pv = prev.get(k)
                    if cv != pv:
                        changed[k] = {"old": pv, "new": cv}
                if changed:
                    diffs.append({"ticker": t, "diff_type": "modified", "changed_fields": changed})

            return {
                "date": str(current_snap["snapshot_date"]),
                "prev_date": str(prev_snap["snapshot_date"]),
                "diffs": diffs,
                "added_count": sum(1 for d in diffs if d["diff_type"] == "added"),
                "removed_count": sum(1 for d in diffs if d["diff_type"] == "removed"),
                "modified_count": sum(1 for d in diffs if d["diff_type"] == "modified"),
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Diff computation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compute diff: {str(e)}")
