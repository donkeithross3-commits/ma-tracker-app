"""API routes for risk assessment data"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timedelta
import logging
import json
import os
import re
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risk", tags=["risk"])

_pool = None


def set_pool(pool):
    """Set the connection pool (called by portfolio_main.py for standalone mode)."""
    global _pool
    _pool = pool


def _get_pool():
    """Get the database connection pool."""
    if _pool is not None:
        return _pool
    raise HTTPException(status_code=503, detail="Database pool not available")


def _row_to_dict(row) -> dict:
    """Convert an asyncpg Record to a JSON-safe dict."""
    if row is None:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, uuid.UUID):
            d[k] = str(v)
        elif isinstance(v, (date, datetime)):
            d[k] = v.isoformat()
        elif hasattr(v, 'as_tuple'):  # Decimal
            d[k] = float(v)
    return d


# ---------------------------------------------------------------------------
# GET /risk/latest
# ---------------------------------------------------------------------------
@router.get("/latest")
async def get_latest_assessments():
    """Returns latest assessment for all deals from the most recent run."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM deal_risk_assessments
                WHERE assessment_date = (SELECT MAX(assessment_date) FROM deal_risk_assessments)
                ORDER BY overall_risk_score DESC NULLS LAST"""
            )
            return [_row_to_dict(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch latest assessments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch latest assessments: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/deal/{ticker}
# ---------------------------------------------------------------------------
@router.get("/deal/{ticker}")
async def get_deal_risk_history(ticker: str):
    """Returns full risk history for one deal (last 30 days)."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM deal_risk_assessments
                WHERE ticker = $1 AND assessment_date >= CURRENT_DATE - INTERVAL '30 days'
                ORDER BY assessment_date DESC""",
                ticker
            )
            if not rows:
                raise HTTPException(status_code=404, detail=f"No risk assessments found for {ticker}")
            return [_row_to_dict(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk history for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk history: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/deal/{ticker}/latest
# ---------------------------------------------------------------------------
@router.get("/deal/{ticker}/latest")
async def get_deal_latest_risk(ticker: str):
    """Returns latest assessment for one deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT * FROM deal_risk_assessments
                WHERE ticker = $1 ORDER BY assessment_date DESC LIMIT 1""",
                ticker
            )
            if not row:
                raise HTTPException(status_code=404, detail=f"No risk assessment found for {ticker}")
            return _row_to_dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch latest risk for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch latest risk: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/runs
# ---------------------------------------------------------------------------
@router.get("/runs")
async def get_risk_runs():
    """List of all morning runs with metadata (last 30 days)."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM risk_assessment_runs ORDER BY run_date DESC LIMIT 30"
            )
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk runs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk runs: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/runs/{run_id}
# ---------------------------------------------------------------------------
@router.get("/runs/{run_id}")
async def get_risk_run(run_id: str):
    """Single run with all its assessments."""
    pool = _get_pool()
    try:
        run_uuid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id format")

    try:
        async with pool.acquire() as conn:
            run = await conn.fetchrow(
                "SELECT * FROM risk_assessment_runs WHERE id = $1",
                run_uuid
            )
            if not run:
                raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

            assessments = await conn.fetch(
                "SELECT * FROM deal_risk_assessments WHERE run_id = $1 ORDER BY overall_risk_score DESC NULLS LAST",
                run_uuid
            )
            return {
                "run": _row_to_dict(run),
                "assessments": [_row_to_dict(a) for a in assessments],
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk run: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/changes
# ---------------------------------------------------------------------------
@router.get("/changes")
async def get_risk_changes(
    days: int = Query(7, ge=1, le=90, description="Number of days to look back"),
    direction: Optional[str] = Query(None, description="Filter by direction: worsened, improved, or all"),
    ticker: Optional[str] = Query(None, description="Filter by ticker"),
):
    """Recent risk changes (filterable by direction and ticker)."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            query = """SELECT * FROM risk_factor_changes
                WHERE change_date >= CURRENT_DATE - INTERVAL '1 day' * $1"""
            params = [days]
            idx = 2

            if direction and direction in ("worsened", "improved"):
                query += f" AND direction = ${idx}"
                params.append(direction)
                idx += 1

            if ticker:
                query += f" AND ticker = ${idx}"
                params.append(ticker.upper())
                idx += 1

            query += " ORDER BY change_date DESC, magnitude DESC"

            rows = await conn.fetch(query, *params)
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk changes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk changes: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/changes/{ticker}
# ---------------------------------------------------------------------------
@router.get("/changes/{ticker}")
async def get_deal_risk_changes(ticker: str):
    """Changes for one deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM risk_factor_changes WHERE ticker = $1 ORDER BY change_date DESC LIMIT 100",
                ticker
            )
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch risk changes for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk changes: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/reports
# ---------------------------------------------------------------------------
@router.get("/reports")
async def get_morning_reports():
    """List recent morning reports."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, report_date, subject_line, total_deals, discrepancy_count, event_count, flagged_count, email_sent, whatsapp_sent, created_at FROM morning_reports ORDER BY report_date DESC LIMIT 30"
        )
        return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /risk/reports/latest
# ---------------------------------------------------------------------------
@router.get("/reports/latest")
async def get_latest_morning_report():
    """Get the latest morning report with full content."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM morning_reports ORDER BY report_date DESC LIMIT 1"
        )
        if not row:
            raise HTTPException(status_code=404, detail="No morning report found")
        return _row_to_dict(row)


# ---------------------------------------------------------------------------
# POST /risk/assess
# ---------------------------------------------------------------------------
@router.post("/assess")
async def trigger_assessment(ticker: Optional[str] = Query(None)):
    """Trigger ad-hoc risk assessment. If ticker is omitted, assess all deals."""
    pool = _get_pool()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    try:
        from app.risk.engine import RiskAssessmentEngine
        engine = RiskAssessmentEngine(pool, api_key)

        if ticker:
            ticker = ticker.upper()
            context = await engine.collect_deal_context(ticker)
            result = await engine.assess_single_deal(context)
            return {"ticker": ticker, "assessment": result}
        else:
            result = await engine.run_morning_assessment(triggered_by="manual")
            return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk assessment failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Risk assessment failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/summary
# ---------------------------------------------------------------------------
@router.get("/summary")
async def get_risk_summary():
    """Latest morning briefing text."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT summary, run_date, assessed_deals, flagged_deals, changed_deals
                FROM risk_assessment_runs
                WHERE summary IS NOT NULL
                ORDER BY run_date DESC LIMIT 1"""
            )
            if not row:
                raise HTTPException(status_code=404, detail="No risk summary available")
            return _row_to_dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch risk summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch risk summary: {str(e)}")


# ===========================================================================
# Estimate Tracking & Accuracy Endpoints
# ===========================================================================


# ---------------------------------------------------------------------------
# GET /risk/estimates/divergences
# (must be before /estimates/{ticker} so FastAPI doesn't match "divergences" as ticker)
# ---------------------------------------------------------------------------
@router.get("/estimates/divergences")
async def get_estimate_divergences():
    """Today's largest sheet-vs-AI divergences."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM deal_estimate_snapshots
                WHERE snapshot_date = CURRENT_DATE
                  AND (grade_mismatches > 0 OR has_investable_mismatch = TRUE
                       OR ABS(COALESCE(prob_success_divergence, 0)) > 0.05)
                ORDER BY ABS(COALESCE(prob_success_divergence, 0)) DESC,
                         grade_mismatches DESC
            """)
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch estimate divergences: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch estimate divergences: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/estimates/{ticker}
# ---------------------------------------------------------------------------
@router.get("/estimates/{ticker}")
async def get_estimate_history(ticker: str):
    """Estimate history — all daily snapshots for a deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM deal_estimate_snapshots
                WHERE ticker = $1
                ORDER BY snapshot_date DESC
            """, ticker)
            if not rows:
                raise HTTPException(status_code=404, detail=f"No estimate snapshots found for {ticker}")
            return [_row_to_dict(r) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch estimate history for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch estimate history: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/accuracy
# ---------------------------------------------------------------------------
@router.get("/accuracy")
async def get_accuracy_leaderboard():
    """Accuracy leaderboard across all scored deals."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM estimate_accuracy_scores
                ORDER BY scored_at DESC
            """)
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch accuracy leaderboard: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch accuracy leaderboard: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/accuracy/{ticker}
# ---------------------------------------------------------------------------
@router.get("/accuracy/{ticker}")
async def get_deal_accuracy(ticker: str):
    """Detailed accuracy for one deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM estimate_accuracy_scores
                WHERE ticker = $1
                ORDER BY scored_at DESC LIMIT 1
            """, ticker)
            if not row:
                raise HTTPException(status_code=404, detail=f"No accuracy scores found for {ticker}")
            return _row_to_dict(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch accuracy for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch accuracy: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/outcomes/pending
# (must be before /outcomes/{ticker} to avoid matching "pending" as a ticker)
# ---------------------------------------------------------------------------
@router.get("/outcomes/pending")
async def get_pending_outcomes():
    """Deals that may need outcome recording (potential closings, breaks, etc.)."""
    pool = _get_pool()
    try:
        from app.risk.estimate_tracker import detect_potential_outcomes
        candidates = await detect_potential_outcomes(pool)
        return candidates
    except Exception as e:
        logger.error(f"Failed to detect pending outcomes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to detect pending outcomes: {str(e)}")


# ---------------------------------------------------------------------------
# GET /risk/outcomes
# ---------------------------------------------------------------------------
@router.get("/outcomes")
async def get_all_outcomes():
    """List all recorded deal outcomes."""
    pool = _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM deal_outcomes
                ORDER BY outcome_date DESC NULLS LAST
            """)
            return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch outcomes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch outcomes: {str(e)}")


# ---------------------------------------------------------------------------
# POST /risk/outcomes/{ticker}
# ---------------------------------------------------------------------------
class OutcomeRequest(BaseModel):
    outcome: str  # closed_at_deal, closed_higher, broke, withdrawn, extended, renegotiated
    outcome_date: date
    outcome_price: float
    original_deal_price: Optional[float] = None
    announced_date: Optional[date] = None
    original_acquiror: Optional[str] = None
    had_competing_bid: Optional[bool] = False
    final_acquiror: Optional[str] = None
    final_price: Optional[float] = None
    bump_over_original_pct: Optional[float] = None
    days_to_outcome: Optional[int] = None
    was_extended: Optional[bool] = False
    extension_count: Optional[int] = 0
    primary_risk_factor: Optional[str] = None
    outcome_notes: Optional[str] = None


@router.post("/outcomes/{ticker}")
async def record_deal_outcome(ticker: str, body: OutcomeRequest):
    """Record a deal outcome (triggers accuracy scoring)."""
    pool = _get_pool()
    ticker = ticker.upper()

    valid_outcomes = {"closed_at_deal", "closed_higher", "broke", "withdrawn", "extended", "renegotiated"}
    if body.outcome not in valid_outcomes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outcome '{body.outcome}'. Must be one of: {', '.join(sorted(valid_outcomes))}"
        )

    try:
        from app.risk.estimate_tracker import record_outcome
        kwargs = body.model_dump(exclude={"outcome", "outcome_date", "outcome_price"}, exclude_none=True)
        await record_outcome(
            pool, ticker, body.outcome, body.outcome_date, body.outcome_price,
            **kwargs,
        )
        return {"status": "ok", "ticker": ticker, "outcome": body.outcome}
    except Exception as e:
        logger.error(f"Failed to record outcome for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to record outcome: {str(e)}")


# ===========================================================================
# Covered Calls Scanner
# ===========================================================================

_TICKER_RE = re.compile(r"^[A-Z]{1,10}$")


# ---------------------------------------------------------------------------
# POST /risk/covered-calls
# ---------------------------------------------------------------------------
@router.post("/covered-calls")
async def scan_covered_calls(
    ticker: Optional[str] = Query(None, description="Single ticker to scan (omit to scan all active deals)"),
    min_yield: float = Query(0.05, ge=0, description="Minimum annualized yield filter"),
    min_liquidity: float = Query(50.0, ge=0, description="Minimum open interest filter"),
):
    """Scan for covered call opportunities on M&A deal stocks.

    Uses Polygon for option chain data and the MergerArbAnalyzer for strategy analysis.
    """
    from app.options.polygon_options import get_polygon_client
    from app.scanner import MergerArbAnalyzer, DealInput, OptionData

    pool = _get_pool()
    client = get_polygon_client()
    if not client:
        raise HTTPException(status_code=503, detail="Polygon API not configured (POLYGON_API_KEY missing)")

    # Determine tickers to scan
    if ticker:
        ticker = ticker.upper()
        if not _TICKER_RE.match(ticker):
            raise HTTPException(status_code=400, detail="Invalid ticker format")
        tickers_to_scan = [ticker]
    else:
        async with pool.acquire() as conn:
            snapshot = await conn.fetchrow(
                "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
            )
            if not snapshot:
                return {"results": [], "scanned": 0, "filters": {"min_yield": min_yield, "min_liquidity": min_liquidity}}
            rows = await conn.fetch(
                """SELECT DISTINCT ticker FROM sheet_rows
                   WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)
                   ORDER BY ticker""",
                snapshot["id"],
            )
            tickers_to_scan = [r["ticker"] for r in rows]

    all_results = []
    scanned = 0
    errors = []

    for t in tickers_to_scan:
        try:
            # Get deal info from DB
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT ticker, deal_price, current_price, close_date, countdown_days
                       FROM sheet_rows
                       WHERE ticker = $1
                         AND snapshot_id = (SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1)
                       LIMIT 1""",
                    t,
                )
            if not row or not row["deal_price"] or not row["current_price"]:
                continue

            deal_price = float(row["deal_price"])
            current_price = float(row["current_price"])
            countdown_days = row["countdown_days"] if row["countdown_days"] else 90

            # Build close date from countdown or close_date field
            if row["close_date"]:
                close_dt = datetime.combine(row["close_date"], datetime.min.time())
            else:
                close_dt = datetime.now() + timedelta(days=countdown_days)

            deal = DealInput(
                ticker=t,
                deal_price=deal_price,
                expected_close_date=close_dt,
                confidence=0.80,
            )
            analyzer = MergerArbAnalyzer(deal)

            # Fetch call options near deal price from Polygon
            strike_lower = deal_price * 0.95
            strike_upper = deal_price * 1.05
            min_exp = datetime.now().strftime("%Y-%m-%d")
            max_exp = (close_dt + timedelta(days=30)).strftime("%Y-%m-%d")

            chain = await client.get_option_chain(
                underlying=t,
                contract_type="call",
                strike_gte=strike_lower,
                strike_lte=strike_upper,
                expiration_date_gte=min_exp,
                expiration_date_lte=max_exp,
            )

            scanned += 1

            # Convert Polygon contracts to OptionData and analyze
            for contract in chain:
                opt = OptionData(
                    symbol=contract.get("symbol", t),
                    strike=contract.get("strike", 0),
                    expiry=contract.get("expiry", ""),
                    right=contract.get("right", "C"),
                    bid=contract.get("bid", 0),
                    ask=contract.get("ask", 0),
                    last=contract.get("last", 0),
                    volume=contract.get("volume", 0),
                    open_interest=contract.get("open_interest", 0),
                    implied_vol=contract.get("implied_vol") or 0,
                    delta=contract.get("delta") or 0,
                    gamma=contract.get("gamma") or 0,
                    theta=contract.get("theta") or 0,
                    vega=contract.get("vega") or 0,
                    bid_size=contract.get("bid_size", 0),
                    ask_size=contract.get("ask_size", 0),
                )

                opp = analyzer.analyze_covered_call(opt, current_price)
                if not opp:
                    continue

                # Apply filters
                if opp.annualized_return < min_yield:
                    continue
                if opt.open_interest < min_liquidity:
                    continue

                all_results.append({
                    "ticker": t,
                    "strike": opt.strike,
                    "expiry": opt.expiry,
                    "bid": opt.bid,
                    "ask": opt.ask,
                    "open_interest": opt.open_interest,
                    "volume": opt.volume,
                    "implied_vol": opt.implied_vol,
                    "deal_price": deal_price,
                    "current_price": current_price,
                    "premium": opt.bid,
                    "effective_basis": current_price - opt.bid,
                    "static_return": opp.edge_vs_market,
                    "if_called_return": opp.expected_return,
                    "annualized_yield": opp.annualized_return,
                    "downside_cushion": opt.bid / current_price if current_price > 0 else 0,
                    "breakeven": opp.breakeven,
                    "days_to_expiry": (datetime.strptime(opt.expiry, "%Y%m%d") - datetime.now()).days if opt.expiry else 0,
                    "notes": opp.notes,
                })

        except Exception as e:
            logger.warning(f"Covered call scan failed for {t}: {e}")
            errors.append({"ticker": t, "error": str(e)})

    # Sort by annualized yield descending
    all_results.sort(key=lambda x: x.get("annualized_yield", 0), reverse=True)

    return {
        "results": all_results,
        "scanned": scanned,
        "total_opportunities": len(all_results),
        "filters": {
            "min_yield": min_yield,
            "min_liquidity": min_liquidity,
            "ticker": ticker,
        },
        "errors": errors if errors else None,
    }


# ===========================================================================
# Unified Options Scan
# ===========================================================================


def _option_data_to_dict(opt: "OptionData") -> dict:
    """Serialize an OptionData dataclass to a JSON-safe dict."""
    return {
        "symbol": opt.symbol,
        "strike": opt.strike,
        "expiry": opt.expiry,
        "right": opt.right,
        "bid": opt.bid,
        "ask": opt.ask,
        "volume": opt.volume,
        "open_interest": opt.open_interest,
        "implied_vol": opt.implied_vol,
    }


def _trade_opportunity_to_dict(opp: "TradeOpportunity") -> dict:
    """Serialize a TradeOpportunity dataclass to a JSON-safe dict."""
    return {
        "strategy": opp.strategy,
        "entry_cost": round(opp.entry_cost, 4),
        "max_profit": round(opp.max_profit, 4),
        "breakeven": round(opp.breakeven, 4),
        "expected_return": round(opp.expected_return, 4),
        "annualized_return": round(opp.annualized_return, 4),
        "probability_of_profit": round(opp.probability_of_profit, 4),
        "edge_vs_market": round(opp.edge_vs_market, 4),
        "notes": opp.notes,
        "contracts": [_option_data_to_dict(c) for c in opp.contracts],
        "entry_cost_ft": round(opp.entry_cost_ft, 4),
        "expected_return_ft": round(opp.expected_return_ft, 4),
        "annualized_return_ft": round(opp.annualized_return_ft, 4),
    }


# ---------------------------------------------------------------------------
# GET /risk/options-scan
# ---------------------------------------------------------------------------
@router.get("/options-scan")
async def scan_deal_options(ticker: str = Query(..., description="Ticker to scan")):
    """Unified options scan: fetches full option chain and runs all strategies
    (long calls, call spreads, put spreads, covered calls) via MergerArbAnalyzer.
    """
    import time as _time
    from app.options.polygon_options import get_polygon_client, PolygonError
    from app.scanner import MergerArbAnalyzer, DealInput, OptionData

    t0 = _time.monotonic()
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")

    pool = _get_pool()
    client = get_polygon_client()
    if not client:
        raise HTTPException(status_code=503, detail="Polygon API not configured (POLYGON_API_KEY missing)")

    # 1. Fetch deal data from sheet_rows
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT ticker, deal_price, current_price, close_date, countdown_days
               FROM sheet_rows
               WHERE ticker = $1
                 AND snapshot_id = (SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1)
               LIMIT 1""",
            ticker,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found in sheet data")

    deal_price = float(row["deal_price"]) if row["deal_price"] else None
    current_price = float(row["current_price"]) if row["current_price"] else None
    countdown_days = row["countdown_days"] if row["countdown_days"] else 90

    if row["close_date"]:
        close_dt = datetime.combine(row["close_date"], datetime.min.time())
        expected_close_str = str(row["close_date"])
    else:
        close_dt = datetime.now() + timedelta(days=countdown_days)
        expected_close_str = close_dt.strftime("%Y-%m-%d")

    days_to_close = max((close_dt - datetime.now()).days, 1)

    # If no deal_price, return partial info
    if not deal_price or not current_price:
        return {
            "ticker": ticker,
            "deal_price": deal_price,
            "current_price": current_price,
            "days_to_close": days_to_close,
            "expected_close": expected_close_str,
            "optionable": False,
            "categories": {},
            "total_opportunities": 0,
            "scan_time_ms": round((_time.monotonic() - t0) * 1000),
        }

    # 2. Fetch full option chain from Polygon (calls + puts, wide strike range)
    strike_lower = deal_price * 0.75
    strike_upper = deal_price * 1.10
    min_exp = datetime.now().strftime("%Y-%m-%d")
    max_exp = (close_dt + timedelta(days=30)).strftime("%Y-%m-%d")

    try:
        chain = await client.get_option_chain(
            underlying=ticker,
            strike_gte=strike_lower,
            strike_lte=strike_upper,
            expiration_date_gte=min_exp,
            expiration_date_lte=max_exp,
        )
    except PolygonError as exc:
        raise HTTPException(status_code=502, detail=f"Polygon API error: {exc}")

    if not chain:
        return {
            "ticker": ticker,
            "deal_price": deal_price,
            "current_price": current_price,
            "days_to_close": days_to_close,
            "expected_close": expected_close_str,
            "optionable": False,
            "categories": {},
            "total_opportunities": 0,
            "scan_time_ms": round((_time.monotonic() - t0) * 1000),
        }

    # 3. Convert Polygon contracts to OptionData
    options: list = []
    for contract in chain:
        options.append(OptionData(
            symbol=contract.get("symbol", ticker),
            strike=contract.get("strike", 0),
            expiry=contract.get("expiry", ""),
            right=contract.get("right", "C"),
            bid=contract.get("bid", 0),
            ask=contract.get("ask", 0),
            last=contract.get("last", 0),
            volume=contract.get("volume", 0),
            open_interest=contract.get("open_interest", 0),
            implied_vol=contract.get("implied_vol") or 0,
            delta=contract.get("delta") or 0,
            gamma=contract.get("gamma") or 0,
            theta=contract.get("theta") or 0,
            vega=contract.get("vega") or 0,
            bid_size=contract.get("bid_size", 0),
            ask_size=contract.get("ask_size", 0),
        ))

    # 4. Run all strategies via MergerArbAnalyzer
    deal = DealInput(
        ticker=ticker,
        deal_price=deal_price,
        expected_close_date=close_dt,
        confidence=0.80,
    )
    analyzer = MergerArbAnalyzer(deal)
    all_opps = analyzer.find_best_opportunities(options, current_price)

    # 5. Group by strategy, pick best per category
    from collections import defaultdict
    by_strategy: dict[str, list] = defaultdict(list)
    for opp in all_opps:
        by_strategy[opp.strategy].append(opp)

    categories = {}
    for strategy, opps in by_strategy.items():
        opps.sort(key=lambda x: x.annualized_return, reverse=True)
        categories[strategy] = {
            "best": _trade_opportunity_to_dict(opps[0]),
            "count": len(opps),
            "all": [_trade_opportunity_to_dict(o) for o in opps],
        }

    scan_time_ms = round((_time.monotonic() - t0) * 1000)

    return {
        "ticker": ticker,
        "deal_price": deal_price,
        "current_price": current_price,
        "days_to_close": days_to_close,
        "expected_close": expected_close_str,
        "optionable": True,
        "categories": categories,
        "total_opportunities": len(all_opps),
        "scan_time_ms": scan_time_ms,
    }
