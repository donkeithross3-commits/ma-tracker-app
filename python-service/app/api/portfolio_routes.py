"""API routes for Google Sheet portfolio ingestion and deal tracking"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import date, datetime
import json
import logging
import re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


_pool = None


def set_pool(pool):
    """Set the connection pool (called by portfolio_main.py for standalone mode)."""
    global _pool
    _pool = pool


def _get_pool():
    """Get the database connection pool.

    In standalone mode (portfolio_main.py), uses the pool injected via set_pool().
    In monolith mode (main.py), falls back to the global EdgarDatabase instance.
    """
    if _pool is not None:
        return _pool
    # Fallback: running inside the monolith
    from ..main import get_db
    db = get_db()
    if db.pool is None:
        raise HTTPException(status_code=503, detail="Database pool not available")
    return db.pool


def _row_to_dict(row) -> dict:
    """Convert a sheet_rows record into a JSON-serializable dict."""
    return {
        "row_index": row["row_index"],
        "ticker": row["ticker"],
        "acquiror": row["acquiror"],
        "announced_date_raw": row["announced_date_raw"],
        "close_date_raw": row["close_date_raw"],
        "end_date_raw": row["end_date_raw"],
        "countdown_raw": row["countdown_raw"],
        "deal_price_raw": row["deal_price_raw"],
        "current_price_raw": row["current_price_raw"],
        "gross_yield_raw": row["gross_yield_raw"],
        "price_change_raw": row["price_change_raw"],
        "current_yield_raw": row["current_yield_raw"],
        "category": row["category"],
        "investable": row["investable"],
        "go_shop_raw": row["go_shop_raw"],
        "vote_risk": row["vote_risk"],
        "finance_risk": row["finance_risk"],
        "legal_risk": row["legal_risk"],
        "cvr_flag": row["cvr_flag"],
        "link_to_sheet": row["link_to_sheet"],
        "announced_date": str(row["announced_date"]) if row["announced_date"] else None,
        "close_date": str(row["close_date"]) if row["close_date"] else None,
        "end_date": str(row["end_date"]) if row["end_date"] else None,
        "countdown_days": row["countdown_days"],
        "deal_price": float(row["deal_price"]) if row["deal_price"] is not None else None,
        "current_price": float(row["current_price"]) if row["current_price"] is not None else None,
        "gross_yield": float(row["gross_yield"]) if row["gross_yield"] is not None else None,
        "price_change": float(row["price_change"]) if row["price_change"] is not None else None,
        "current_yield": float(row["current_yield"]) if row["current_yield"] is not None else None,
        "deal_tab_gid": row["deal_tab_gid"],
    }


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
    from app.portfolio.detail_parser import ingest_deal_details

    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id, snapshot_date FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshots found. Run /portfolio/ingest first.")

            snapshot_id = snapshot["id"]

            if ticker:
                rows = await conn.fetch(
                    "SELECT DISTINCT ticker, deal_tab_gid FROM sheet_rows WHERE snapshot_id = $1 AND ticker = $2 AND deal_tab_gid IS NOT NULL",
                    snapshot_id, ticker.upper()
                )
            else:
                rows = await conn.fetch(
                    "SELECT DISTINCT ticker, deal_tab_gid FROM sheet_rows WHERE snapshot_id = $1 AND ticker IS NOT NULL AND deal_tab_gid IS NOT NULL",
                    snapshot_id
                )

            deals = [{"ticker": r["ticker"], "gid": r["deal_tab_gid"]} for r in rows if r["ticker"] and r["deal_tab_gid"]]

        if not deals:
            raise HTTPException(status_code=404, detail="No deals with detail tab GIDs found in the latest snapshot")

        result = await ingest_deal_details(pool, snapshot_id, deals)
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
                    "SELECT id, snapshot_date, row_count, tab_name FROM sheet_snapshots WHERE snapshot_date = $1 ORDER BY ingested_at DESC LIMIT 1",
                    snapshot_date
                )
            else:
                snapshot = await conn.fetchrow(
                    "SELECT id, snapshot_date, row_count, tab_name FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
                )

            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshot found")

            rows = await conn.fetch(
                "SELECT * FROM sheet_rows WHERE snapshot_id = $1 ORDER BY row_index",
                snapshot["id"]
            )

            return {
                "snapshot_id": str(snapshot["id"]),
                "snapshot_date": str(snapshot["snapshot_date"]),
                "tab_name": snapshot["tab_name"],
                "row_count": snapshot["row_count"],
                "rows": [_row_to_dict(r) for r in rows],
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
                "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                raise HTTPException(status_code=404, detail="No snapshots found")

            # Get dashboard row for this ticker
            dashboard_row = await conn.fetchrow(
                "SELECT * FROM sheet_rows WHERE snapshot_id = $1 AND ticker = $2",
                snapshot["id"], ticker
            )

            # Get deal details
            detail = await conn.fetchrow(
                "SELECT * FROM sheet_deal_details WHERE snapshot_id = $1 AND ticker = $2 ORDER BY fetched_at DESC LIMIT 1",
                snapshot["id"], ticker
            )

            if not dashboard_row and not detail:
                raise HTTPException(status_code=404, detail=f"No data found for ticker {ticker}")

            result = {"ticker": ticker}
            if dashboard_row:
                result["dashboard"] = _row_to_dict(dashboard_row)
            else:
                result["dashboard"] = None

            if detail:
                def _f(val):
                    """Float-safe conversion for Decimal columns."""
                    return float(val) if val is not None else None

                def _s(col):
                    """Safe string extraction for columns that may not exist yet."""
                    try:
                        return detail[col]
                    except (KeyError, Exception):
                        return None

                result["detail"] = {
                    "target": detail["target"],
                    "acquiror": detail["acquiror"],
                    "category": detail["category"],
                    "cash_per_share": _f(detail["cash_per_share"]),
                    "cash_pct": _f(detail["cash_pct"]),
                    "stock_per_share": _f(detail["stock_per_share"]),
                    "stock_pct": _f(detail["stock_pct"]),
                    "stock_ratio": detail["stock_ratio"],
                    "stress_test_discount": detail["stress_test_discount"],
                    "dividends_other": _f(detail["dividends_other"]),
                    "dividends_other_pct": _f(detail["dividends_other_pct"]),
                    "total_price_per_share": _f(detail["total_price_per_share"]),
                    "target_current_price": _f(detail["target_current_price"]),
                    "acquiror_current_price": _f(detail["acquiror_current_price"]),
                    "current_spread": _f(detail["current_spread"]),
                    "spread_change": _f(detail["spread_change"]),
                    "deal_spread": _f(detail["deal_spread"]),
                    "deal_close_time_months": _f(detail["deal_close_time_months"]),
                    "expected_irr": _f(detail["expected_irr"]),
                    "ideal_price": _f(detail["ideal_price"]),
                    "hypothetical_irr": _f(detail["hypothetical_irr"]),
                    "hypothetical_irr_spread": _f(detail["hypothetical_irr_spread"]),
                    "announce_date": str(detail["announce_date"]) if detail["announce_date"] else None,
                    "expected_close_date": str(detail["expected_close_date"]) if detail["expected_close_date"] else None,
                    "expected_close_date_note": detail["expected_close_date_note"],
                    "outside_date": str(detail["outside_date"]) if detail["outside_date"] else None,
                    "shareholder_vote": detail["shareholder_vote"],
                    "premium_attractive": detail["premium_attractive"],
                    "board_approval": detail["board_approval"],
                    "voting_agreements": detail["voting_agreements"],
                    "aggressive_shareholders": detail["aggressive_shareholders"],
                    "regulatory_approvals": detail["regulatory_approvals"],
                    "revenue_mostly_us": _s("revenue_mostly_us"),
                    "reputable_acquiror": _s("reputable_acquiror"),
                    "target_business_description": _s("target_business_description"),
                    "mac_clauses": _s("mac_clauses"),
                    "termination_fee": detail["termination_fee"],
                    "termination_fee_pct": _f(detail["termination_fee_pct"]),
                    "closing_conditions": _s("closing_conditions"),
                    "sellside_pushback": _s("sellside_pushback"),
                    "target_marketcap": detail["target_marketcap"],
                    "target_enterprise_value": detail["target_enterprise_value"],
                    "go_shop_or_overbid": _s("go_shop_or_overbid"),
                    "financing_details": _s("financing_details"),
                    "shareholder_risk": detail["shareholder_risk"],
                    "financing_risk": detail["financing_risk"],
                    "legal_risk": detail["legal_risk"],
                    "investable_deal": detail["investable_deal"],
                    "pays_dividend": detail["pays_dividend"],
                    "prefs_or_baby_bonds": _s("prefs_or_baby_bonds"),
                    "has_cvrs": detail["has_cvrs"],
                    "probability_of_success": _f(_s("probability_of_success")),
                    "probability_of_higher_offer": _f(_s("probability_of_higher_offer")),
                    "offer_bump_premium": _f(_s("offer_bump_premium")),
                    "break_price": _f(_s("break_price")),
                    "implied_downside": _f(_s("implied_downside")),
                    "return_risk_ratio": _f(_s("return_risk_ratio")),
                    "optionable": _s("optionable"),
                    "long_naked_calls": _s("long_naked_calls"),
                    "long_vertical_call_spread": _s("long_vertical_call_spread"),
                    "long_covered_call": _s("long_covered_call"),
                    "short_put_vertical_spread": _s("short_put_vertical_spread"),
                    "cvrs": json.loads(detail["cvrs"]) if isinstance(detail["cvrs"], str) else (detail["cvrs"] or []),
                    "dividends": json.loads(detail["dividends"]) if isinstance(detail["dividends"], str) else (detail["dividends"] or []),
                    "price_history": json.loads(detail["price_history"]) if isinstance(detail["price_history"], str) else (detail["price_history"] or []),
                    "fetched_at": str(detail["fetched_at"]),
                }
            else:
                result["detail"] = None

            # Resolve BamSEC URL via SEC ticker lookup (CIK -> slug)
            try:
                from ..services.ticker_lookup import get_ticker_lookup_service
                svc = get_ticker_lookup_service()
                info = await svc.lookup_by_ticker(ticker)
                if info:
                    cik = str(info["cik"]).lstrip("0")
                    name_slug = re.sub(r"[^a-z0-9]+", "-", info["company_name"].lower()).strip("-")
                    result["bamsec_url"] = f"https://www.bamsec.com/companies/{cik}/{name_slug}"
            except Exception as e:
                logger.debug(f"BamSEC URL resolution failed for {ticker}: {e}")

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
async def get_deals(
    include_excluded: bool = Query(False, description="Include excluded (hidden) deals"),
):
    """Get all deals from the latest snapshot (lightweight, key metrics only)."""
    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                return []

            if include_excluded:
                rows = await conn.fetch(
                    """SELECT row_index, ticker, acquiror, category, deal_price, current_price,
                              gross_yield, current_yield, investable, vote_risk,
                              finance_risk, legal_risk, deal_price_raw, current_price_raw,
                              gross_yield_raw, current_yield_raw,
                              announced_date, close_date, end_date,
                              countdown_days, countdown_raw, price_change, price_change_raw,
                              go_shop_raw, cvr_flag, is_excluded,
                              announced_date_raw, close_date_raw, end_date_raw
                       FROM sheet_rows
                       WHERE snapshot_id = $1 AND ticker IS NOT NULL
                       ORDER BY row_index""",
                    snapshot["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT row_index, ticker, acquiror, category, deal_price, current_price,
                              gross_yield, current_yield, investable, vote_risk,
                              finance_risk, legal_risk, deal_price_raw, current_price_raw,
                              gross_yield_raw, current_yield_raw,
                              announced_date, close_date, end_date,
                              countdown_days, countdown_raw, price_change, price_change_raw,
                              go_shop_raw, cvr_flag, is_excluded,
                              announced_date_raw, close_date_raw, end_date_raw
                       FROM sheet_rows
                       WHERE snapshot_id = $1 AND ticker IS NOT NULL
                         AND (is_excluded IS NOT TRUE)
                       ORDER BY row_index""",
                    snapshot["id"]
                )

            deals = []
            for r in rows:
                deals.append({
                    "row_index": r["row_index"],
                    "ticker": r["ticker"],
                    "acquiror": r["acquiror"],
                    "category": r["category"],
                    "deal_price": float(r["deal_price"]) if r["deal_price"] is not None else None,
                    "current_price": float(r["current_price"]) if r["current_price"] is not None else None,
                    "gross_yield": float(r["gross_yield"]) if r["gross_yield"] is not None else None,
                    "current_yield": float(r["current_yield"]) if r["current_yield"] is not None else None,
                    "price_change": float(r["price_change"]) if r["price_change"] is not None else None,
                    "deal_price_raw": r["deal_price_raw"],
                    "current_price_raw": r["current_price_raw"],
                    "gross_yield_raw": r["gross_yield_raw"],
                    "current_yield_raw": r["current_yield_raw"],
                    "price_change_raw": r["price_change_raw"],
                    "investable": r["investable"],
                    "vote_risk": r["vote_risk"],
                    "finance_risk": r["finance_risk"],
                    "legal_risk": r["legal_risk"],
                    "announced_date": str(r["announced_date"]) if r["announced_date"] else None,
                    "close_date": str(r["close_date"]) if r["close_date"] else None,
                    "end_date": str(r["end_date"]) if r["end_date"] else None,
                    "countdown_days": r["countdown_days"],
                    "countdown_raw": r["countdown_raw"],
                    "go_shop_raw": r["go_shop_raw"],
                    "cvr_flag": r["cvr_flag"],
                    "is_excluded": r["is_excluded"] or False,
                    "announced_date_raw": r["announced_date_raw"],
                    "close_date_raw": r["close_date_raw"],
                    "end_date_raw": r["end_date_raw"],
                })
            return deals
    except Exception as e:
        logger.error(f"Deals fetch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch deals: {str(e)}")


# ---------------------------------------------------------------------------
# GET /portfolio/allowlist
# ---------------------------------------------------------------------------
@router.get("/allowlist")
async def get_allowlist():
    """Get the full deal allowlist."""
    pool = _get_pool()

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT ticker, status, source, notes, updated_at, created_at FROM deal_allowlist ORDER BY ticker"
            )
            return [
                {
                    "ticker": r["ticker"],
                    "status": r["status"],
                    "source": r["source"],
                    "notes": r["notes"],
                    "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in rows
            ]
    except Exception as e:
        logger.error(f"Allowlist fetch failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch allowlist: {str(e)}")


# ---------------------------------------------------------------------------
# POST /portfolio/allowlist
# ---------------------------------------------------------------------------
@router.post("/allowlist")
async def set_allowlist_status(
    ticker: str = Query(..., description="Ticker symbol"),
    status: str = Query(..., description="Status: 'active' or 'excluded'"),
    notes: Optional[str] = Query(None, description="Optional notes"),
):
    """Set a ticker's allowlist status (active or excluded)."""
    pool = _get_pool()
    ticker = ticker.upper()

    if status not in ("active", "excluded"):
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'excluded'")

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO deal_allowlist (ticker, status, source, notes, updated_at, created_at)
                VALUES ($1, $2, 'manual', $3, NOW(), NOW())
                ON CONFLICT (ticker) DO UPDATE
                SET status = $2, source = 'manual', notes = $3, updated_at = NOW()
                """,
                ticker, status, notes,
            )
            return {"ticker": ticker, "status": status, "notes": notes}
    except Exception as e:
        logger.error(f"Allowlist update failed for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update allowlist: {str(e)}")


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
# GET /portfolio/live-prices
# ---------------------------------------------------------------------------
@router.get("/live-prices")
async def get_live_prices():
    """Fetch live stock prices from Polygon for all active portfolio tickers."""
    from app.options.polygon_options import get_polygon_client
    client = get_polygon_client()
    if not client:
        raise HTTPException(status_code=503, detail="Polygon API not configured")
    pool = _get_pool()
    async with pool.acquire() as conn:
        snapshot = await conn.fetchrow(
            "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
        )
        if not snapshot:
            return {"prices": {}, "timestamp": datetime.utcnow().isoformat() + "Z"}
        rows = await conn.fetch(
            "SELECT DISTINCT ticker FROM sheet_rows WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)",
            snapshot["id"]
        )
        tickers = [r["ticker"] for r in rows]
    prices = await client.get_batch_stock_quotes(tickers)
    return {
        "prices": prices,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "count": len(prices),
    }


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
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date = $1 ORDER BY ingested_at DESC LIMIT 1",
                    current_date
                )
            else:
                current_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
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
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date = $1 ORDER BY ingested_at DESC LIMIT 1",
                    previous_date
                )
            else:
                prev_snap = await conn.fetchrow(
                    "SELECT id, snapshot_date FROM sheet_snapshots WHERE snapshot_date < $1 ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1",
                    current_snap["snapshot_date"]
                )

            if not prev_snap:
                raise HTTPException(status_code=404, detail="No previous snapshot found for comparison")

            # Get rows from both snapshots keyed by ticker
            current_rows = await conn.fetch(
                "SELECT * FROM sheet_rows WHERE snapshot_id = $1 AND ticker IS NOT NULL",
                current_snap["id"]
            )
            prev_rows = await conn.fetch(
                "SELECT * FROM sheet_rows WHERE snapshot_id = $1 AND ticker IS NOT NULL",
                prev_snap["id"]
            )

            current_by_ticker = {r["ticker"]: _row_to_dict(r) for r in current_rows}
            prev_by_ticker = {r["ticker"]: _row_to_dict(r) for r in prev_rows}

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
            compare_fields = [
                "deal_price_raw", "current_price_raw", "gross_yield_raw",
                "current_yield_raw", "category", "investable", "vote_risk",
                "finance_risk", "legal_risk", "close_date_raw", "end_date_raw",
                "countdown_raw", "go_shop_raw", "cvr_flag",
            ]
            for t in sorted(current_tickers & prev_tickers):
                cur = current_by_ticker[t]
                prev = prev_by_ticker[t]
                changed = {}
                for k in compare_fields:
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
