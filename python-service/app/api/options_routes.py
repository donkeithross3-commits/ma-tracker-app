"""
Options Scanner API Routes
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator
from datetime import datetime, timedelta
from typing import List, Optional
import logging
import os
import re
import uuid
import asyncio

from ..options.ib_client import IBClient
from ..options.models import (
    AvailabilityCheckResponse,
    FetchChainRequest,
    FetchChainResponse,
    GenerateStrategiesRequest,
    GenerateStrategiesResponse,
    PriceSpreadsRequest,
    PriceSpreadsResponse,
    OptionContract,
    CandidateStrategy,
    StrategyLeg,
    SpreadPrice,
    ScanParameters,
)
from ..options.polygon_options import get_polygon_client, PolygonError
from ..scanner import MergerArbAnalyzer, DealInput
from ..utils.timing import RequestTimer
from .ws_relay import send_request_to_provider, get_registry, PendingRequest

logger = logging.getLogger(__name__)

# When true, relay endpoints try Polygon REST first and fall back to IB relay.
# Set POLYGON_PRIMARY=false to disable (e.g. if Polygon key expires).
POLYGON_PRIMARY = os.environ.get("POLYGON_PRIMARY", "true").lower() != "false"

router = APIRouter(prefix="/options", tags=["options"])

# --- Ticker validation helpers ---
_TICKER_RE = re.compile(r"^[A-Z]{1,10}$")


def validate_ticker(ticker: str) -> str:
    """Validate and normalise a ticker symbol. Raises HTTPException on bad input."""
    t = ticker.strip().upper()
    if not _TICKER_RE.match(t):
        raise HTTPException(status_code=400, detail=f"Invalid ticker format: {ticker!r}")
    return t


def _pydantic_ticker_validator(v: str) -> str:
    """Re-usable Pydantic field_validator for ticker fields."""
    t = v.strip().upper()
    if not _TICKER_RE.match(t):
        raise ValueError(f"Invalid ticker format: {v!r}")
    return t


@router.get("/ib-status")
async def get_ib_status():
    """
    Check IB TWS connection status
    """
    try:
        ib_client = IBClient()
        is_connected = ib_client.is_connected()
        
        # If not connected, try to connect
        if not is_connected:
            logger.info("IB not connected, attempting to connect...")
            is_connected = ib_client.connect()
        
        return {
            "connected": is_connected,
            "message": "IB TWS connected" if is_connected else "IB TWS not connected"
        }
    except Exception as e:
        logger.error(f"Error checking IB status: {e}")
        return {
            "connected": False,
            "message": f"Error checking IB status: {str(e)}"
        }


@router.post("/ib-reconnect")
async def reconnect_ib():
    """
    Force reconnect to IB TWS
    """
    try:
        ib_client = IBClient()
        
        # Disconnect if already connected
        if ib_client.is_connected():
            logger.info("Disconnecting existing IB connection...")
            ib_client.disconnect()
        
        # Connect with new client ID
        logger.info("Reconnecting to IB TWS...")
        connected = ib_client.connect()
        
        return {
            "success": connected,
            "connected": connected,
            "message": "Reconnected to IB TWS" if connected else "Failed to reconnect to IB TWS"
        }
    except Exception as e:
        logger.error(f"Error reconnecting to IB: {e}")
        return {
            "success": False,
            "connected": False,
            "message": f"Error reconnecting: {str(e)}"
        }


@router.get("/check-availability")
async def check_availability(ticker: str = Query(...)) -> AvailabilityCheckResponse:
    """
    Check if listed options exist for a ticker.
    Tries Polygon first (no IB dependency), falls back to local IB client.
    """
    ticker = validate_ticker(ticker)

    # ── Polygon primary path ──
    if POLYGON_PRIMARY:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                data = await polygon.check_options_available(ticker)
                if data["available"]:
                    return AvailabilityCheckResponse(
                        available=True,
                        expirationCount=data["expirationCount"],
                    )
                # Polygon says unavailable — could be data lag, try IB too
            except PolygonError as exc:
                logger.warning("Polygon check-availability failed for %s: %s", ticker, exc)

    # ── IB fallback ──
    try:
        logger.info(f"Checking option availability for {ticker} via IB")

        # Get IB client
        ib_client = IBClient()
        if not ib_client.is_connected():
            ib_client.connect()

        scanner = ib_client.get_scanner()
        if not scanner:
            return AvailabilityCheckResponse(
                available=False,
                expirationCount=0,
                error="IB TWS not connected"
            )

        # Resolve contract
        contract_id = scanner.resolve_contract(ticker)
        if not contract_id:
            return AvailabilityCheckResponse(
                available=False,
                expirationCount=0,
                error=f"Could not resolve ticker {ticker}"
            )

        # Get available expirations
        expirations = scanner.get_available_expirations(ticker, contract_id)

        return AvailabilityCheckResponse(
            available=len(expirations) > 0,
            expirationCount=len(expirations)
        )

    except Exception as e:
        logger.error(f"Error checking availability: {e}")
        return AvailabilityCheckResponse(
            available=False,
            expirationCount=0,
            error=str(e)
        )


@router.post("/chain")
async def fetch_chain(request: FetchChainRequest) -> FetchChainResponse:
    """
    Fetch option chain from IB TWS
    """
    try:
        logger.info(f"Fetching option chain for {request.ticker}")
        
        # Get IB client
        ib_client = IBClient()
        if not ib_client.is_connected():
            logger.info("IB not connected, attempting connection...")
            connected = ib_client.connect()
            if not connected:
                raise HTTPException(status_code=503, detail="Failed to connect to IB TWS. Please ensure TWS/Gateway is running and accepting API connections on port 7497.")
        
        scanner = ib_client.get_scanner()
        if not scanner:
            raise HTTPException(status_code=503, detail="IB TWS scanner not available")
        
        # Fetch underlying data
        underlying_data = scanner.fetch_underlying_data(request.ticker)
        if not underlying_data['price']:
            raise HTTPException(status_code=404, detail=f"Could not fetch price for {request.ticker}")
        
        spot_price = underlying_data['price']
        
        # Parse expected close date
        try:
            close_date = datetime.strptime(request.expectedCloseDate, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        
        # Use scan parameters if provided, otherwise use defaults
        params = request.scanParams or ScanParameters()
        
        logger.info(f"Fetching chain with params: days_before_close={params.daysBeforeClose}, "
                   f"call_long={params.callLongStrikeLower}%-{params.callLongStrikeUpper}%, "
                   f"call_short={params.callShortStrikeLower}%-{params.callShortStrikeUpper}%, "
                   f"put_long={params.putLongStrikeLower}%-{params.putLongStrikeUpper}%, "
                   f"put_short={params.putShortStrikeLower}%-{params.putShortStrikeUpper}%")
        
        # Fetch option chain with all 8 strategy params (fetch range derived from them)
        options = scanner.fetch_option_chain(
            request.ticker,
            expiry_months=6,
            current_price=spot_price,
            deal_close_date=close_date,
            days_before_close=params.daysBeforeClose,
            deal_price=request.dealPrice,
            call_long_strike_lower_pct=params.callLongStrikeLower / 100.0,
            call_long_strike_upper_pct=params.callLongStrikeUpper / 100.0,
            call_short_strike_lower_pct=params.callShortStrikeLower / 100.0,
            call_short_strike_upper_pct=params.callShortStrikeUpper / 100.0,
            put_long_strike_lower_pct=params.putLongStrikeLower / 100.0,
            put_long_strike_upper_pct=params.putLongStrikeUpper / 100.0,
            put_short_strike_lower_pct=params.putShortStrikeLower / 100.0,
            put_short_strike_upper_pct=params.putShortStrikeUpper / 100.0
        )
        
        # Convert to response format
        contracts = []
        expirations = set()
        
        for opt in options:
            expirations.add(opt.expiry)
            contracts.append(OptionContract(
                symbol=opt.symbol,
                strike=opt.strike,
                expiry=opt.expiry,
                right=opt.right,
                bid=opt.bid,
                ask=opt.ask,
                mid=opt.mid_price,
                last=opt.last,
                volume=opt.volume,
                open_interest=opt.open_interest,
                implied_vol=opt.implied_vol,
                delta=opt.delta,
                bid_size=opt.bid_size,
                ask_size=opt.ask_size
            ))
        
        return FetchChainResponse(
            ticker=request.ticker,
            spotPrice=spot_price,
            expirations=sorted(list(expirations)),
            contracts=contracts
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching chain: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-strategies")
async def generate_strategies(request: GenerateStrategiesRequest) -> GenerateStrategiesResponse:
    """
    Generate candidate strategies from option chain data
    """
    try:
        logger.info(f"Generating strategies for {request.ticker}")
        
        # Parse expected close date
        try:
            close_date = datetime.strptime(request.expectedCloseDate, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        
        # Use scan parameters if provided, otherwise use defaults
        params = request.scanParams or ScanParameters()
        
        # Create deal input
        deal_input = DealInput(
            ticker=request.ticker,
            deal_price=request.dealPrice,
            expected_close_date=close_date,
            confidence=params.dealConfidence
        )
        
        # Convert chain data to OptionData objects
        from ..scanner import OptionData
        options = []
        
        chain_contracts = request.chainData.get('contracts', [])
        for contract in chain_contracts:
            options.append(OptionData(
                symbol=contract.get('symbol', request.ticker),
                strike=contract['strike'],
                expiry=contract['expiry'],
                right=contract['right'],
                bid=contract['bid'],
                ask=contract['ask'],
                last=contract.get('last', 0),
                volume=contract.get('volume', 0),
                open_interest=contract.get('open_interest', 0),
                implied_vol=contract.get('implied_vol', 0.30),
                delta=contract.get('delta', 0),
                gamma=0,
                theta=0,
                vega=0
            ))
        
        # Analyze opportunities with custom parameters
        analyzer = MergerArbAnalyzer(deal_input)
        current_price = request.chainData.get('spotPrice', request.dealPrice)
        
        logger.info(f"Generating strategies with params: "
                   f"call_long={params.callLongStrikeLower}%-{params.callLongStrikeUpper}%, "
                   f"call_short={params.callShortStrikeLower}%-{params.callShortStrikeUpper}%, "
                   f"put_long={params.putLongStrikeLower}%-{params.putLongStrikeUpper}%, "
                   f"put_short={params.putShortStrikeLower}%-{params.putShortStrikeUpper}%, "
                   f"top_n={params.topStrategiesPerExpiration}")
        
        opportunities = analyzer.find_best_opportunities(
            options, 
            current_price, 
            top_n=params.topStrategiesPerExpiration,
            call_long_strike_lower_pct=params.callLongStrikeLower / 100.0,
            call_long_strike_upper_pct=params.callLongStrikeUpper / 100.0,
            call_short_strike_lower_pct=params.callShortStrikeLower / 100.0,
            call_short_strike_upper_pct=params.callShortStrikeUpper / 100.0,
            put_long_strike_lower_pct=params.putLongStrikeLower / 100.0,
            put_long_strike_upper_pct=params.putLongStrikeUpper / 100.0,
            put_short_strike_lower_pct=params.putShortStrikeLower / 100.0,
            put_short_strike_upper_pct=params.putShortStrikeUpper / 100.0
        )
        
        # Convert to response format
        candidates = []
        for opp in opportunities:
            legs = []
            for i, contract in enumerate(opp.contracts):
                # Determine side based on strategy
                if opp.strategy == 'call':
                    side = 'BUY'
                elif opp.strategy == 'spread':
                    side = 'BUY' if i == 0 else 'SELL'
                elif opp.strategy == 'put_spread':
                    side = 'BUY' if i == 0 else 'SELL'
                else:
                    side = 'BUY'
                
                legs.append(StrategyLeg(
                    symbol=contract.symbol,
                    strike=contract.strike,
                    right=contract.right,
                    quantity=1,
                    side=side,
                    bid=contract.bid,
                    ask=contract.ask,
                    mid=contract.mid_price,
                    volume=contract.volume,
                    openInterest=contract.open_interest,
                    bidSize=contract.bid_size,
                    askSize=contract.ask_size
                ))
            
            # Calculate liquidity score
            avg_bid_ask_spread = sum((leg.ask - leg.bid) / leg.mid if leg.mid > 0 else 0 for leg in legs) / len(legs)
            avg_volume = sum(leg.volume for leg in legs) / len(legs)
            avg_oi = sum(leg.openInterest for leg in legs) / len(legs)
            
            spread_score = 1 / (1 + avg_bid_ask_spread)
            volume_score = min(avg_volume / 100, 1)
            oi_score = min(avg_oi / 1000, 1)
            liquidity_score = (spread_score * 0.5 + volume_score * 0.25 + oi_score * 0.25) * 100
            
            candidate_strategy = CandidateStrategy(
                id=str(uuid.uuid4()),
                strategyType=opp.strategy,
                expiration=opp.contracts[0].expiry,
                legs=legs,
                netPremium=opp.entry_cost,
                netPremiumFarTouch=opp.entry_cost_ft,
                maxProfit=opp.max_profit,
                maxLoss=abs(opp.entry_cost),
                returnOnRisk=opp.edge_vs_market,
                annualizedYield=opp.annualized_return,
                annualizedYieldFarTouch=opp.annualized_return_ft,
                liquidityScore=liquidity_score,
                notes=opp.notes
            )
            
            # Debug logging for first few strategies
            if len(candidates) < 3:
                logger.info(f"Strategy {len(candidates)+1}: {opp.strategy} - "
                          f"annualized_return={opp.annualized_return:.4f}, "
                          f"annualized_return_ft={opp.annualized_return_ft:.4f}")
            
            candidates.append(candidate_strategy)
        
        return GenerateStrategiesResponse(candidates=candidates)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating strategies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/price-spreads")
async def price_spreads(request: PriceSpreadsRequest) -> PriceSpreadsResponse:
    """
    Get current pricing for multiple spreads — Polygon primary, IB fallback.
    """
    # ── Polygon primary path ──
    if POLYGON_PRIMARY:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                return await _polygon_price_spreads(polygon, request)
            except PolygonError as exc:
                logger.warning("Polygon price-spreads failed, falling back to IB: %s", exc)

    # ── IB fallback ──
    try:
        logger.info(f"Pricing {len(request.spreads)} spreads via IB")

        ib_client = IBClient()
        if not ib_client.is_connected():
            ib_client.connect()

        scanner = ib_client.get_scanner()
        if not scanner:
            raise HTTPException(status_code=503, detail="IB TWS not connected")

        prices = []

        for spread in request.spreads:
            try:
                leg_prices = []
                net_premium = 0.0

                for leg in spread.legs:
                    parts = leg.symbol.split()
                    if len(parts) >= 4:
                        ticker = parts[0]
                        expiry = parts[1]
                        right = parts[2]
                        strike = float(parts[3])

                        option_data = scanner.get_option_data(ticker, expiry, strike, right)

                        if option_data:
                            leg_prices.append(OptionContract(
                                symbol=option_data.symbol,
                                strike=option_data.strike,
                                expiry=option_data.expiry,
                                right=option_data.right,
                                bid=option_data.bid,
                                ask=option_data.ask,
                                mid=option_data.mid_price,
                                last=option_data.last,
                                volume=option_data.volume,
                                open_interest=option_data.open_interest,
                                implied_vol=option_data.implied_vol,
                                delta=option_data.delta,
                                bid_size=option_data.bid_size,
                                ask_size=option_data.ask_size
                            ))

                            if leg.side == 'BUY':
                                net_premium -= option_data.mid_price
                            else:
                                net_premium += option_data.mid_price

                prices.append(SpreadPrice(
                    spreadId=spread.spreadId,
                    premium=abs(net_premium),
                    timestamp=datetime.now().isoformat(),
                    legs=leg_prices if leg_prices else None
                ))

            except Exception as e:
                logger.error(f"Error pricing spread {spread.spreadId}: {e}")
                prices.append(SpreadPrice(
                    spreadId=spread.spreadId,
                    premium=0.0,
                    timestamp=datetime.now().isoformat()
                ))

        return PriceSpreadsResponse(prices=prices)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error pricing spreads: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _polygon_price_spreads(
    polygon, request: PriceSpreadsRequest
) -> PriceSpreadsResponse:
    """Price spreads via Polygon REST API."""
    prices = []

    for spread in request.spreads:
        try:
            leg_specs = []
            for leg in spread.legs:
                parts = leg.symbol.split()
                if len(parts) >= 4:
                    leg_specs.append({
                        "ticker": parts[0],
                        "expiry": parts[1],
                        "right": parts[2],
                        "strike": float(parts[3]),
                    })

            results = await polygon.get_option_prices(leg_specs)

            leg_contracts = []
            net_premium = 0.0
            for i, r in enumerate(results):
                if r:
                    mid = r.get("mid", 0)
                    leg_contracts.append(OptionContract(
                        symbol=r["ticker"],
                        strike=r["strike"],
                        expiry=r["expiry"],
                        right=r["right"],
                        bid=r["bid"],
                        ask=r["ask"],
                        mid=mid,
                        last=r.get("last", 0),
                        volume=0,
                        open_interest=0,
                        implied_vol=None,
                        delta=None,
                        bid_size=0,
                        ask_size=0,
                    ))
                    side = spread.legs[i].side if i < len(spread.legs) else "BUY"
                    if side == "BUY":
                        net_premium -= mid
                    else:
                        net_premium += mid

            prices.append(SpreadPrice(
                spreadId=spread.spreadId,
                premium=abs(net_premium),
                timestamp=datetime.utcnow().isoformat() + "Z",
                legs=leg_contracts if leg_contracts else None,
            ))
        except Exception as e:
            logger.error(f"Polygon: error pricing spread {spread.spreadId}: {e}")
            prices.append(SpreadPrice(
                spreadId=spread.spreadId,
                premium=0.0,
                timestamp=datetime.utcnow().isoformat() + "Z",
            ))

    return PriceSpreadsResponse(prices=prices)


# ============================================================================
# Data Source Health Check
# ============================================================================

@router.get("/polygon-quote")
async def polygon_quote(ticker: str = Query("SPY")):
    """Fetch a stock quote directly from Polygon REST API (no IB fallback).

    Used by the dashboard "Polygon: Test SPY" button to verify Polygon connectivity.
    """
    import time

    ticker = validate_ticker(ticker)
    polygon = get_polygon_client()

    if not polygon or not polygon.is_configured:
        return {"success": False, "error": "POLYGON_API_KEY not set"}

    t0 = time.perf_counter()
    try:
        data = await polygon.get_stock_quote(ticker)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "success": True,
            "ticker": ticker,
            "bid": data.get("bid"),
            "ask": data.get("ask"),
            "last": data.get("price"),
            "timestamp": data.get("timestamp"),
            "latency_ms": latency_ms,
        }
    except Exception as e:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.error("Polygon quote error for %s: %s", ticker, e)
        return {"success": False, "error": str(e), "latency_ms": latency_ms}


@router.get("/polygon-health")
async def polygon_health_check(ticker: str = Query("SPY")):
    """Pre-open health check for Polygon data source.

    Tests API auth, stock snapshot freshness, options chain reachability,
    and round-trip latency. Run before market open to verify data is flowing.

    Stock snapshots clear at 3:30 AM EST and start updating ~4:00 AM EST.
    Options data shows previous-day values until the 9:30 AM open.
    """
    ticker = validate_ticker(ticker)
    polygon = get_polygon_client()

    if not polygon or not polygon.is_configured:
        return {
            "polygon_configured": False,
            "overall": "fail",
            "error": "POLYGON_API_KEY not set",
        }

    try:
        result = await polygon.health_check(ticker)
        # Add IB agent status for comparison
        registry = get_registry()
        ib_status = registry.get_status()
        result["ib_agents_connected"] = ib_status.get("providers_connected", 0)
        result["polygon_primary_enabled"] = POLYGON_PRIMARY
        return result
    except Exception as e:
        logger.error("Polygon health check error: %s", e)
        return {
            "polygon_configured": True,
            "overall": "fail",
            "error": str(e),
        }


# ============================================================================
# Polygon diagnostics
# ============================================================================

@router.get("/polygon/test-option-price")
async def test_option_price(
    ticker: str = Query("AL"),
    expiry: str = Query("2026-05-15"),
    strike: float = Query(55),
    right: str = Query("C"),
):
    """Debug endpoint: test Polygon option pricing for a single contract.

    Returns raw chain data and matching result so we can see exactly what
    Polygon returns and where the match fails.

    Example: /options/polygon/test-option-price?ticker=AL&expiry=2026-05-15&strike=55&right=C
    """
    ticker = validate_ticker(ticker)
    polygon = get_polygon_client()
    if not polygon or not polygon.is_configured:
        return {"error": "POLYGON_API_KEY not set"}

    import time as _time
    t0 = _time.monotonic()

    # Normalize expiry to YYYY-MM-DD for Polygon API
    exp_fmt = (
        f"{expiry[:4]}-{expiry[4:6]}-{expiry[6:8]}"
        if len(expiry) == 8
        else expiry
    )

    try:
        chain = await polygon.get_option_chain(
            underlying=ticker,
            expiration_date=exp_fmt,
            strike_gte=strike - 0.5,
            strike_lte=strike + 0.5,
        )
    except Exception as exc:
        return {
            "error": f"Polygon API call failed: {exc}",
            "ticker": ticker,
            "expiry_sent": exp_fmt,
            "latency_ms": round((_time.monotonic() - t0) * 1000, 1),
        }

    latency_ms = round((_time.monotonic() - t0) * 1000, 1)

    # Try matching the specific contract
    match = None
    for c in chain:
        if c["strike"] == strike and c["right"] == right:
            match = c
            break

    return {
        "ticker": ticker,
        "expiry_sent": exp_fmt,
        "strike_requested": strike,
        "right_requested": right,
        "latency_ms": latency_ms,
        "chain_count": len(chain),
        "chain_strikes": sorted(set((c["strike"], c["right"]) for c in chain)),
        "match_found": match is not None,
        "match": match,
        "raw_first_contract": chain[0] if chain else None,
    }


# ============================================================================
# WebSocket Relay Routes - Forward requests to remote IB data providers
# ============================================================================

@router.post("/relay/fetch-chain")
async def relay_fetch_chain(request: FetchChainRequest) -> FetchChainResponse:
    """
    Fetch option chain — Polygon primary, IB relay fallback.

    Polygon path: ~200-800ms (REST snapshot, no IB agent required).
    IB path: 60-180s (sequential per-contract queries via relay).
    """
    timer = RequestTimer("relay_fetch_chain")

    # ── Polygon primary path ──
    if POLYGON_PRIMARY:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                chain_resp = await _polygon_fetch_chain(polygon, request, timer)
                return chain_resp
            except PolygonError as exc:
                logger.warning(
                    "Polygon fetch-chain failed for %s, falling back to IB: %s",
                    request.ticker, exc,
                )
                timer.stage("polygon_fallback")

    # ── IB relay fallback ──
    try:
        logger.info(f"Relay: Fetching chain for {request.ticker} via IB WebSocket provider")

        registry = get_registry()
        status = registry.get_status()

        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No data source available. Polygon failed and no IB agent connected."
            )
        timer.stage("registry_check")

        response_data = await send_request_to_provider(
            request_type="fetch_chain",
            payload={
                "ticker": request.ticker,
                "dealPrice": request.dealPrice,
                "expectedCloseDate": request.expectedCloseDate,
                "scanParams": request.scanParams.dict() if request.scanParams else {}
            },
            timeout=180.0,
            user_id=request.userId
        )
        timer.stage("provider_roundtrip")

        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])

        contracts = _parse_ib_contracts(response_data.get("contracts", []), request.ticker)
        timer.stage("deserialize")
        timer.finish(extra={"ticker": request.ticker, "contracts": len(contracts), "source": "ib"})

        return FetchChainResponse(
            ticker=response_data.get("ticker", request.ticker),
            spotPrice=response_data.get("spotPrice", 0),
            expirations=response_data.get("expirations", []),
            contracts=contracts
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay fetch chain error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _polygon_fetch_chain(
    polygon, request: FetchChainRequest, timer: RequestTimer
) -> FetchChainResponse:
    """Fetch chain from Polygon REST API."""
    # 1. Get spot price
    quote = await polygon.get_stock_quote(request.ticker)
    spot_price = quote["price"]
    timer.stage("polygon_stock_quote")

    # 2. Compute strike range from scan params or defaults
    deal_price = request.dealPrice or spot_price
    scan = request.scanParams
    if scan:
        pct_lower = max(
            scan.callLongStrikeLower or 25,
            scan.putShortStrikeLower or 10,
        )
        pct_upper = max(
            scan.callShortStrikeUpper or 10,
            scan.putLongStrikeUpper or 25,
        )
    else:
        pct_lower, pct_upper = 25, 25

    strike_gte = deal_price * (1 - pct_lower / 100.0)
    strike_lte = deal_price * (1 + pct_upper / 100.0)

    # 3. Expiration range: today through close date + buffer
    today = datetime.utcnow().strftime("%Y-%m-%d")
    exp_lte = None
    if request.expectedCloseDate:
        try:
            close_dt = datetime.strptime(request.expectedCloseDate, "%Y-%m-%d")
            exp_lte = (close_dt + timedelta(days=30)).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # 4. Fetch chain
    raw_contracts = await polygon.get_option_chain(
        underlying=request.ticker,
        expiration_date_gte=today,
        expiration_date_lte=exp_lte,
        strike_gte=strike_gte,
        strike_lte=strike_lte,
    )
    timer.stage("polygon_chain")

    # 5. Build response
    expirations = sorted({c["expiry"] for c in raw_contracts if c.get("expiry")})
    contracts = [
        OptionContract(
            symbol=c.get("symbol", request.ticker),
            strike=c["strike"],
            expiry=c["expiry"],
            right=c["right"],
            bid=c["bid"],
            ask=c["ask"],
            mid=c.get("mid", 0),
            last=c.get("last", 0),
            volume=c.get("volume", 0),
            open_interest=c.get("open_interest", 0),
            implied_vol=c.get("implied_vol"),
            delta=c.get("delta"),
            bid_size=c.get("bid_size", 0),
            ask_size=c.get("ask_size", 0),
        )
        for c in raw_contracts
    ]

    timer.finish(extra={
        "ticker": request.ticker, "contracts": len(contracts), "source": "polygon",
    })

    return FetchChainResponse(
        ticker=request.ticker,
        spotPrice=spot_price,
        expirations=expirations,
        contracts=contracts,
    )


def _parse_ib_contracts(raw: list[dict], default_ticker: str) -> list[OptionContract]:
    """Parse IB relay contract dicts into OptionContract models."""
    contracts = []
    for c in raw:
        contracts.append(OptionContract(
            symbol=c.get("symbol", default_ticker),
            strike=c["strike"],
            expiry=c["expiry"],
            right=c["right"],
            bid=c["bid"],
            ask=c["ask"],
            mid=c.get("mid", (c["bid"] + c["ask"]) / 2 if c["bid"] and c["ask"] else 0),
            last=c.get("last", 0),
            volume=c.get("volume", 0),
            open_interest=c.get("open_interest", 0),
            implied_vol=c.get("implied_vol"),
            delta=c.get("delta"),
            bid_size=c.get("bid_size", 0),
            ask_size=c.get("ask_size", 0)
        ))
    return contracts


@router.get("/relay/test-futures")
async def relay_test_futures(user_id: Optional[str] = Query(None)):
    """
    Test ES futures quote through WebSocket relay.
    Useful for verifying IB connectivity when options markets are closed.
    
    If user_id query param is provided, routes to that user's agent. Otherwise
    uses the first provider that has IB connected (for backwards compatibility).
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        logger.info(f"relay_test_futures: user_id param={user_id!r}, providers={status['providers_connected']}")
        
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No IB data provider connected. Please start the local agent."
            )
        
        # If user_id provided, try to route to that user's agent first
        target_user_id = user_id.strip() if user_id else None
        if target_user_id:
            provider = await registry.get_active_provider(user_id=target_user_id)
            logger.info(f"relay_test_futures: get_active_provider(user_id={target_user_id!r}) -> provider_id={getattr(provider, 'provider_id', None) if provider else None}")
            if provider:
                try:
                    # Quick ib_status check for this provider
                    request_id = str(uuid.uuid4())
                    loop = asyncio.get_running_loop()
                    future = loop.create_future()
                    pending = PendingRequest(
                        request_id=request_id,
                        request_type="ib_status",
                        payload={},
                        future=future
                    )
                    await registry.add_pending_request(pending)
                    await provider.websocket.send_json({
                        "type": "request",
                        "request_id": request_id,
                        "request_type": "ib_status",
                        "payload": {}
                    })
                    try:
                        response = await asyncio.wait_for(future, timeout=3.0)
                        if response.get("connected"):
                            response_data = await send_request_to_provider(
                                request_type="test_futures",
                                payload={},
                                timeout=25.0,
                                user_id=target_user_id
                            )
                            if "error" in response_data:
                                err = response_data["error"]
                                # Keep agent's specific message if already about subscription; else rewrite generic ones
                                if "not subscribed" not in (err or "").lower() and "market data subscription" not in (err or "").lower():
                                    if "market may be closed" in (err or "").lower() or "no futures data" in (err or "").lower():
                                        err = "Your agent did not receive ES futures data from IB. Often this is because CME is not subscribed in TWS: Account → Management → Market Data Subscriptions — add CME. Also: (2) Market is open (ES Sun 6pm–Fri 5pm ET), (3) Restart the agent after updating."
                                raise HTTPException(status_code=500, detail=err)
                            return response_data
                    except asyncio.TimeoutError:
                        pass
                    finally:
                        await registry.remove_pending_request(request_id)
                except HTTPException:
                    raise
            raise HTTPException(
                status_code=503,
                detail="Your agent is not connected or IB is not connected. Start the local agent and ensure TWS is running."
            )
        
        # No user_id: find first provider with IB connected (legacy behaviour)
        connected_user_id = None
        for provider_info in status["providers"]:
            provider_id = provider_info["id"]
            uid = provider_info.get("user_id")
            
            try:
                provider = await registry.get_provider_by_id(provider_id)
                if not provider:
                    continue
                request_id = str(uuid.uuid4())
                loop = asyncio.get_running_loop()
                future = loop.create_future()
                pending = PendingRequest(
                    request_id=request_id,
                    request_type="ib_status",
                    payload={},
                    future=future
                )
                await registry.add_pending_request(pending)
                await provider.websocket.send_json({
                    "type": "request",
                    "request_id": request_id,
                    "request_type": "ib_status",
                    "payload": {}
                })
                try:
                    response = await asyncio.wait_for(future, timeout=3.0)
                    if response.get("connected"):
                        connected_user_id = uid
                        break
                except asyncio.TimeoutError:
                    pass
                finally:
                    await registry.remove_pending_request(request_id)
            except Exception:
                continue
        
        if not connected_user_id:
            raise HTTPException(
                status_code=503,
                detail="No provider has IB TWS connected. Please ensure TWS is running."
            )
        
        response_data = await send_request_to_provider(
            request_type="test_futures",
            payload={},
            timeout=25.0,
            user_id=connected_user_id
        )
        
        if "error" in response_data:
            err = response_data["error"]
            # Keep agent's specific message if already about subscription; else rewrite generic ones
            if "not subscribed" not in (err or "").lower() and "market data subscription" not in (err or "").lower():
                if "market may be closed" in (err or "").lower() or "no futures data" in (err or "").lower():
                    err = "Your agent did not receive ES futures data from IB. Often this is because CME is not subscribed in TWS: Account → Management → Market Data Subscriptions — add CME. Also: (2) Market is open (ES Sun 6pm–Fri 5pm ET), (3) Restart the agent after updating."
            raise HTTPException(status_code=500, detail=err)
        
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay test futures error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/relay/positions")
async def relay_positions(user_id: Optional[str] = Query(None)):
    """
    Request positions from the user's agent only (reqPositions).
    Requires user_id. Never routes to another user's agent (permission: own account only).
    """
    timer = RequestTimer("relay_positions")
    logger.info("relay_positions called: user_id=%s", "***" if user_id else None)
    try:
        if not user_id or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id query param required for positions")
        target_user_id = user_id.strip()
        timer.stage("registry_check")
        # send_request_to_provider handles provider lookup and gives clear error
        # messages distinguishing "no agent" from "agent for a different account".
        response_data = await send_request_to_provider(
            request_type="get_positions",
            payload={"timeout_sec": 15.0},
            timeout=20.0,
            user_id=target_user_id,
            allow_fallback_to_any_provider=False,
        )
        timer.stage("provider_roundtrip")
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        position_count = len(response_data.get("positions", []))
        timer.finish(extra={"positions": position_count})
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay positions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PlaceOrderBody(BaseModel):
    contract: dict = {}
    order: dict = {}
    timeout_sec: Optional[float] = 30.0


@router.post("/relay/place-order")
async def relay_place_order(
    user_id: Optional[str] = Query(None),
    body: Optional[PlaceOrderBody] = None,
):
    """
    Place an order via the user's agent only. Requires user_id.
    Never routes to another user's agent (permission: own account only).
    """
    try:
        if not user_id or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id query param required")
        target_user_id = user_id.strip()
        payload = {
            "contract": (body or PlaceOrderBody()).contract,
            "order": (body or PlaceOrderBody()).order,
            "timeout_sec": (body or PlaceOrderBody()).timeout_sec or 30.0,
        }
        response_data = await send_request_to_provider(
            request_type="place_order",
            payload=payload,
            timeout=payload["timeout_sec"] + 10,
            user_id=target_user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay place order error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CancelOrderBody(BaseModel):
    orderId: int


@router.post("/relay/cancel-order")
async def relay_cancel_order(
    user_id: Optional[str] = Query(None),
    body: Optional[CancelOrderBody] = None,
):
    """
    Cancel an order via the user's agent only. Requires user_id and body.orderId.
    Never routes to another user's agent (permission: own account only).
    """
    try:
        if not user_id or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id query param required")
        if not body or body.orderId is None:
            raise HTTPException(status_code=400, detail="orderId required in body")
        target_user_id = user_id.strip()
        response_data = await send_request_to_provider(
            request_type="cancel_order",
            payload={"orderId": body.orderId},
            timeout=10.0,
            user_id=target_user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay cancel order error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ModifyOrderBody(BaseModel):
    orderId: int
    contract: dict
    order: dict
    timeout_sec: float = 30.0


@router.post("/relay/modify-order")
async def relay_modify_order(
    user_id: Optional[str] = Query(None),
    body: Optional[ModifyOrderBody] = None,
):
    """
    Modify an existing order via the user's agent (re-sends placeOrder with same orderId).
    """
    try:
        if not user_id or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id query param required")
        if not body or body.orderId is None:
            raise HTTPException(status_code=400, detail="orderId required in body")
        target_user_id = user_id.strip()
        payload = {
            "orderId": body.orderId,
            "contract": body.contract,
            "order": body.order,
            "timeout_sec": body.timeout_sec,
        }
        response_data = await send_request_to_provider(
            request_type="modify_order",
            payload=payload,
            timeout=body.timeout_sec + 10,
            user_id=target_user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay modify order error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/relay/open-orders")
async def relay_open_orders(
    user_id: Optional[str] = Query(None),
):
    """
    Fetch all open/working orders from the user's agent.
    """
    try:
        if not user_id or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id query param required")
        target_user_id = user_id.strip()
        response_data = await send_request_to_provider(
            request_type="get_open_orders",
            payload={"timeout_sec": 10.0},
            timeout=20.0,
            user_id=target_user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay open orders error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/relay/registry")
async def relay_registry():
    """
    Return current relay registry state (connected providers) without querying IB.
    Use this to verify that an agent is registered (e.g. for debugging dashboard not seeing a new user).
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        return {
            "providers_connected": status["providers_connected"],
            "providers": status["providers"],
            "pending_requests": status["pending_requests"],
        }
    except Exception as e:
        logger.error(f"Relay registry error: {e}")
        return {"providers_connected": 0, "providers": [], "error": str(e)}


@router.get("/relay/account-events")
async def relay_account_events(
    user_id: Optional[str] = Query(None),
    since: float = Query(0),
):
    """Return account events (order fills, status changes) since a given timestamp.

    Designed for lightweight 3-second polling by the frontend to achieve
    near-real-time position/order updates without full position refreshes.
    """
    if not user_id:
        return {"events": []}
    try:
        registry = get_registry()
        events = await registry.get_account_events(user_id, since)
        return {"events": events}
    except Exception as e:
        logger.error(f"Account events error: {e}")
        return {"events": [], "error": str(e)}


@router.get("/relay/agent-state")
async def relay_agent_state():
    """
    Return the execution/resource state of all connected agents.
    
    The dashboard uses this to:
    - Show a warning icon when borrowing from an execution-active agent
    - Display available scan capacity
    - Inform users why a scan might be slower or rejected
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        return {
            "providers": [
                {
                    "provider_id": p["id"],
                    "user_id": p["user_id"],
                    "execution_active": p.get("execution_active", False),
                    "execution_lines_held": p.get("execution_lines_held", 0),
                    "available_scan_lines": p.get("available_scan_lines", 90),
                    "accept_external_scans": p.get("accept_external_scans", True),
                }
                for p in status["providers"]
            ],
        }
    except Exception as e:
        logger.error(f"Agent state error: {e}")
        return {"providers": [], "error": str(e)}


@router.get("/relay/ib-status")
async def relay_ib_status(user_id: Optional[str] = Query(None)):
    """
    Check IB connection status through WebSocket relay.
    
    If user_id is provided, returns connected=true only if that user's own
    agent has IB connected.  If user_id is omitted (legacy / admin), returns
    connected=true if ANY provider has IB connected.
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        
        if status["providers_connected"] == 0:
            logger.info("relay_ib_status: no providers connected")
            return {
                "connected": False,
                "source": "relay",
                "message": "No IB data provider connected"
            }
        
        # Decide which providers to query
        target_user_id = user_id.strip() if user_id else None
        providers_to_query = status["providers"]
        if target_user_id:
            # Only check the requesting user's own provider(s)
            providers_to_query = [
                p for p in providers_to_query
                if p.get("user_id") == target_user_id
            ]
            if not providers_to_query:
                logger.info(f"relay_ib_status: no provider for user {target_user_id}, {status['providers_connected']} other(s) connected")
                return {
                    "connected": False,
                    "source": "relay",
                    "message": (
                        "An IB agent is connected, but it belongs to a different account. "
                        "Log in with the account that generated the agent API key, "
                        "or re-download the agent from this account."
                    ),
                }
        
        logger.info(f"relay_ib_status: querying {len(providers_to_query)} provider(s) (user_filter={target_user_id})")
        
        # Query selected providers for their IB status
        connected_provider = None
        all_responses = []
        loop = asyncio.get_running_loop()
        
        for provider_info in providers_to_query:
            provider_id = provider_info["id"]
            prov_user_id = provider_info.get("user_id")
            
            try:
                # Get the actual provider object
                provider = await registry.get_provider_by_id(provider_id)
                if not provider:
                    logger.warning(f"relay_ib_status: provider {provider_id} no longer in registry, skipping")
                    continue
                    
                # Send ib_status request to this specific provider
                request_id = str(uuid.uuid4())
                future = loop.create_future()
                
                pending = PendingRequest(
                    request_id=request_id,
                    request_type="ib_status",
                    payload={},
                    future=future
                )
                await registry.add_pending_request(pending)
                
                await provider.websocket.send_json({
                    "type": "request",
                    "request_id": request_id,
                    "request_type": "ib_status",
                    "payload": {}
                })
                
                # Wait for response with short timeout
                try:
                    response_data = await asyncio.wait_for(future, timeout=5.0)
                    # Defensive: agent may send success=True but data=None in edge cases
                    if response_data is None:
                        response_data = {}
                    is_connected = response_data.get("connected", False)
                    all_responses.append({
                        "provider_id": provider_id,
                        "user_id": prov_user_id,
                        "connected": is_connected
                    })
                    if is_connected:
                        connected_provider = provider_id
                    logger.info(f"relay_ib_status: provider {provider_id} (user={prov_user_id}) -> connected={is_connected}")
                except asyncio.TimeoutError:
                    all_responses.append({
                        "provider_id": provider_id,
                        "user_id": prov_user_id,
                        "connected": False,
                        "error": "timeout"
                    })
                    logger.warning(f"relay_ib_status: provider {provider_id} (user={prov_user_id}) -> timeout")
                finally:
                    await registry.remove_pending_request(request_id)
                    
            except Exception as e:
                logger.error(f"Error querying provider {provider_id}: {e}")
                all_responses.append({
                    "provider_id": provider_id,
                    "user_id": prov_user_id,
                    "connected": False,
                    "error": str(e)
                })
        
        # Return connected if ANY provider has IB connected
        is_connected = connected_provider is not None
        logger.info(f"relay_ib_status: result connected={is_connected} (connected_provider={connected_provider})")
        
        return {
            "connected": is_connected,
            "source": "relay",
            "providers": status["providers"],
            "provider_statuses": all_responses,
            "connected_provider": connected_provider,
            "message": "IB TWS connected" if is_connected else "IB TWS not connected"
        }
            
    except Exception as e:
        logger.error(f"Relay IB status error: {e}")
        return {
            "connected": False,
            "source": "error",
            "message": str(e)
        }


class ContractSpec(BaseModel):
    ticker: str
    strike: float
    expiry: str
    right: str

    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, v: str) -> str:
        return _pydantic_ticker_validator(v)

class FetchPricesRequest(BaseModel):
    contracts: List[ContractSpec]
    userId: Optional[str] = None  # For routing to user's own IB agent

class ContractPrice(BaseModel):
    ticker: str
    strike: float
    expiry: str
    right: str
    bid: float
    ask: float
    mid: float
    last: float
    volume: int = 0
    openInterest: int = 0
    bidSize: int = 0
    askSize: int = 0

class FetchPricesResponse(BaseModel):
    success: bool
    contracts: List[Optional[ContractPrice]]

@router.post("/relay/fetch-prices")
async def relay_fetch_prices(request: FetchPricesRequest) -> FetchPricesResponse:
    """
    Fetch prices for specific contracts — Polygon primary, IB relay fallback.
    Used by the Monitor tab to refresh watched spread prices.
    """
    timer = RequestTimer("relay_fetch_prices")

    # ── Polygon primary path ──
    if POLYGON_PRIMARY:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                specs = [c.dict() for c in request.contracts]
                tickers_summary = {}
                for s in specs:
                    t = s.get("ticker", "?")
                    tickers_summary[t] = tickers_summary.get(t, 0) + 1
                logger.info(
                    "relay_fetch_prices: %d contracts, tickers=%s",
                    len(specs), tickers_summary,
                )
                results = await polygon.get_option_prices(specs)
                timer.stage("polygon_prices")

                contracts = []
                for r in results:
                    if r:
                        contracts.append(ContractPrice(
                            ticker=r["ticker"],
                            strike=r["strike"],
                            expiry=r["expiry"],
                            right=r["right"],
                            bid=r["bid"],
                            ask=r["ask"],
                            mid=r["mid"],
                            last=r.get("last", 0),
                            volume=int(r.get("volume", 0) or 0),
                            openInterest=int(r.get("openInterest", 0) or 0),
                            bidSize=int(r.get("bidSize", 0) or 0),
                            askSize=int(r.get("askSize", 0) or 0),
                        ))
                    else:
                        contracts.append(None)

                valid_count = sum(1 for c in contracts if c)
                timer.finish(extra={
                    "contracts_requested": len(request.contracts),
                    "contracts_returned": valid_count,
                    "source": "polygon",
                })
                # If Polygon returned zero valid contracts, fall through to IB
                if valid_count == 0:
                    logger.warning(
                        "Polygon returned 0 valid contracts out of %d requested, "
                        "falling back to IB",
                        len(request.contracts),
                    )
                    timer.stage("polygon_all_zero_fallback")
                else:
                    return FetchPricesResponse(success=True, contracts=contracts)

            except PolygonError as exc:
                logger.warning(
                    "Polygon fetch-prices failed, falling back to IB: %s", exc
                )
                timer.stage("polygon_fallback")

    # ── IB relay fallback ──
    try:
        logger.info(f"Relay: Fetching prices for {len(request.contracts)} contracts via IB")

        registry = get_registry()
        status = registry.get_status()

        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No data source available. Polygon failed and no IB agent connected."
            )

        response_data = await send_request_to_provider(
            request_type="fetch_prices",
            payload={
                "contracts": [c.dict() for c in request.contracts]
            },
            timeout=60.0,
            user_id=request.userId
        )
        timer.stage("provider_roundtrip")

        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])

        contracts = []
        for c in response_data.get("contracts", []):
            if c:
                contracts.append(ContractPrice(
                    ticker=c["ticker"],
                    strike=c["strike"],
                    expiry=c["expiry"],
                    right=c["right"],
                    bid=c["bid"],
                    ask=c["ask"],
                    mid=c["mid"],
                    last=c["last"]
                ))
            else:
                contracts.append(None)
        timer.stage("deserialize")
        timer.finish(extra={
            "contracts_requested": len(request.contracts),
            "contracts_returned": len(contracts),
            "source": "ib",
        })

        return FetchPricesResponse(
            success=True,
            contracts=contracts
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay fetch prices error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class StockQuoteRequest(BaseModel):
    ticker: str
    userId: Optional[str] = None  # For routing to user's own IB agent
    # Optional contract metadata for non-stock instruments (e.g. futures)
    secType: Optional[str] = None  # "FUT", "OPT", etc.  None → default STK
    exchange: Optional[str] = None
    lastTradeDateOrContractMonth: Optional[str] = None
    multiplier: Optional[str] = None
    conId: Optional[str] = None  # IB contract ID — most reliable way to identify a contract

    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, v: str) -> str:
        return _pydantic_ticker_validator(v)


class SellScanRequest(BaseModel):
    ticker: str
    right: str = "C"  # "C" or "P"
    userId: Optional[str] = None  # For routing to user's own IB agent

    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, v: str) -> str:
        return _pydantic_ticker_validator(v)


class StockQuoteResponse(BaseModel):
    ticker: str
    price: float
    bid: Optional[float] = None
    ask: Optional[float] = None
    timestamp: str

@router.post("/relay/stock-quote")
async def relay_stock_quote(request: StockQuoteRequest) -> StockQuoteResponse:
    """
    Fetch current stock quote — Polygon primary, IB relay fallback.
    Futures (secType=FUT) always use IB (Polygon doesn't cover futures).
    """
    is_futures = request.secType and request.secType.upper() == "FUT"

    # ── Polygon primary path (stocks only) ──
    if POLYGON_PRIMARY and not is_futures:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                data = await polygon.get_stock_quote(request.ticker)
                price = data.get("price", 0)
                if price and price > 0:
                    return StockQuoteResponse(
                        ticker=request.ticker.upper(),
                        price=price,
                        bid=data.get("bid"),
                        ask=data.get("ask"),
                        timestamp=data.get("timestamp", datetime.utcnow().isoformat() + "Z"),
                    )
                # Price is 0/None — might be outside market hours, try IB
                logger.info("Polygon returned zero price for %s, trying IB", request.ticker)
            except PolygonError as exc:
                logger.warning(
                    "Polygon stock quote failed for %s, falling back to IB: %s",
                    request.ticker, exc,
                )

    # ── IB relay fallback ──
    try:
        logger.info(f"Relay: Fetching stock quote for {request.ticker} via IB")

        registry = get_registry()
        status = registry.get_status()

        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No data source available. Polygon failed and no IB agent connected."
            )

        payload: dict = {"ticker": request.ticker.upper()}
        if request.secType:
            payload["secType"] = request.secType
        if request.exchange:
            payload["exchange"] = request.exchange
        if request.lastTradeDateOrContractMonth:
            payload["lastTradeDateOrContractMonth"] = request.lastTradeDateOrContractMonth
        if request.multiplier:
            payload["multiplier"] = request.multiplier
        if request.conId:
            payload["conId"] = request.conId

        response_data = await send_request_to_provider(
            request_type="fetch_underlying",
            payload=payload,
            timeout=15.0,
            user_id=request.userId
        )

        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])

        price = response_data.get("price")
        if price is None:
            raise HTTPException(status_code=404, detail=f"Could not get price for {request.ticker}")

        return StockQuoteResponse(
            ticker=request.ticker.upper(),
            price=price,
            bid=response_data.get("bid"),
            ask=response_data.get("ask"),
            timestamp=datetime.utcnow().isoformat() + "Z"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay stock quote error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/relay/sell-scan")
async def relay_sell_scan(request: SellScanRequest):
    """
    Fetch near-the-money calls or puts — Polygon primary, IB relay fallback.
    """
    right = (request.right or "C").upper()
    if right not in ("C", "P"):
        raise HTTPException(status_code=400, detail="right must be C or P")

    # ── Polygon primary path ──
    if POLYGON_PRIMARY:
        polygon = get_polygon_client()
        if polygon and polygon.is_configured:
            try:
                data = await polygon.get_sell_scan(request.ticker, right=right)
                return data
            except PolygonError as exc:
                logger.warning(
                    "Polygon sell-scan failed for %s, falling back to IB: %s",
                    request.ticker, exc,
                )

    # ── IB relay fallback ──
    try:
        logger.info(f"Relay: Sell scan for {request.ticker} {right} via IB")
        registry = get_registry()
        status = registry.get_status()
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No data source available. Polygon failed and no IB agent connected."
            )
        response_data = await send_request_to_provider(
            request_type="sell_scan",
            payload={"ticker": request.ticker.upper(), "right": right},
            timeout=120.0,
            user_id=request.userId,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay sell-scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Execution Engine Relay Endpoints ──
# All execution endpoints require the user's own agent (no fallback).

class ExecutionStartRequest(BaseModel):
    userId: str
    strategies: list  # list of {strategy_id, strategy_type, config}


class ExecutionStopRequest(BaseModel):
    userId: str


class ExecutionConfigRequest(BaseModel):
    userId: str
    strategy_id: str
    config: dict


@router.post("/relay/execution/start")
async def relay_execution_start(request: ExecutionStartRequest):
    """Start execution engine on the user's own agent with strategy configuration."""
    try:
        response_data = await send_request_to_provider(
            request_type="execution_start",
            payload={"strategies": request.strategies},
            timeout=30.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay execution/start error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/relay/execution/stop")
async def relay_execution_stop(request: ExecutionStopRequest):
    """Stop execution engine on the user's own agent."""
    try:
        response_data = await send_request_to_provider(
            request_type="execution_stop",
            payload={},
            timeout=15.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay execution/stop error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/relay/execution/status")
async def relay_execution_status(user_id: str = ""):
    """Get execution engine status, preferring stored telemetry for low latency.
    
    Returns the latest telemetry snapshot from the agent if available,
    otherwise queries the agent directly. Requires user_id.
    """
    if not user_id:
        return {"running": False, "error": "user_id required"}
    try:
        # First try to return cached telemetry from the relay (no round-trip)
        registry = get_registry()
        provider = await registry.get_active_provider(
            user_id=user_id,
            allow_fallback_to_any=False,
        )
        if provider and provider.execution_telemetry:
            return {
                "source": "cached_telemetry",
                **provider.execution_telemetry,
            }
        response_data = await send_request_to_provider(
            request_type="execution_status",
            payload={},
            timeout=10.0,
            user_id=user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return {"source": "direct_query", **response_data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay execution/status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/relay/execution/config")
async def relay_execution_config(request: ExecutionConfigRequest):
    """Update strategy configuration on the user's agent without restart."""
    try:
        response_data = await send_request_to_provider(
            request_type="execution_config",
            payload={"strategy_id": request.strategy_id, "config": request.config},
            timeout=10.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay execution/config error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ExecutionBudgetRequest(BaseModel):
    userId: str
    budget: int  # -1 = unlimited, 0 = halt, N>0 = exactly N orders


@router.post("/relay/execution/budget")
async def relay_execution_budget(request: ExecutionBudgetRequest):
    """Set the order budget (lifeguard on duty) on the user's agent."""
    try:
        response_data = await send_request_to_provider(
            request_type="execution_budget",
            payload={"budget": request.budget},
            timeout=10.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay execution/budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# BMC (Big Move Convexity) relay endpoints
# ---------------------------------------------------------------------------

class BMCStartRequest(BaseModel):
    userId: str
    config: dict = {}  # Legacy: single-ticker config (backward compat)
    tickers: list = []  # Multi-ticker: list of {ticker, config} dicts


@router.post("/relay/bmc-start")
async def relay_bmc_start(request: BMCStartRequest):
    """Start BigMoveConvexityStrategy instance(s) on the user's agent.

    Multi-ticker: pass tickers=[{ticker: "SPY", config: {...}}, {ticker: "SLV", config: {...}}].
    Each ticker gets its own strategy instance with strategy_id="bmc_{ticker}".

    Legacy single-ticker: pass config={...} (defaults to SPY, backward compat).
    """
    timer = RequestTimer("relay_bmc_start")
    try:
        strategies = []
        if request.tickers:
            # Multi-ticker mode
            for entry in request.tickers:
                ticker = entry.get("ticker", "SPY").upper()
                cfg = entry.get("config", {})
                cfg["ticker"] = ticker
                strategies.append({
                    "strategy_id": f"bmc_{ticker.lower()}",
                    "strategy_type": "big_move_convexity",
                    "config": cfg,
                })
        else:
            # Legacy single-ticker mode (backward compat)
            ticker = request.config.get("ticker", "SPY").upper()
            request.config["ticker"] = ticker
            strategies.append({
                "strategy_id": f"bmc_{ticker.lower()}",
                "strategy_type": "big_move_convexity",
                "config": request.config,
            })

        response_data = await send_request_to_provider(
            request_type="execution_start",
            payload={"strategies": strategies},
            timeout=30.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        timer.finish()
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay bmc-start error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BMCConfigRequest(BaseModel):
    userId: str
    config: dict  # hot-reload config: signal_threshold, auto_entry, etc.
    ticker: str = "SPY"  # which ticker's strategy to update


@router.post("/relay/bmc-config")
async def relay_bmc_config(request: BMCConfigRequest):
    """Hot-reload BigMoveConvexityStrategy configuration for a specific ticker.

    Updates strategy config without restart: threshold, cooldown,
    auto_entry toggle, scan window, max contracts, etc.
    """
    try:
        strategy_id = f"bmc_{request.ticker.lower()}"
        response_data = await send_request_to_provider(
            request_type="execution_config",
            payload={"strategy_id": strategy_id, "config": request.config},
            timeout=10.0,
            user_id=request.userId,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay bmc-config error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_bmc_strategies(strategies_list: list) -> list:
    """Extract all BMC strategy states from a strategies list.

    Returns a list of {ticker, strategy_id, signal, config} dicts.
    """
    results = []
    for strat in strategies_list:
        sid = strat.get("strategy_id", "")
        if sid.startswith("bmc_"):
            state = strat.get("strategy_state", {})
            results.append({
                "ticker": state.get("ticker", sid.replace("bmc_", "").upper()),
                "strategy_id": sid,
                "signal": state,
                "config": strat.get("config"),
            })
    return results


@router.get("/relay/bmc-signal")
async def relay_bmc_signal(user_id: str = ""):
    """Read all BMC strategy states from execution telemetry.

    Returns signals for ALL running BMC tickers (multi-ticker).
    Response format:
        {
            "running": true,
            "strategies": [
                {"ticker": "SPY", "strategy_id": "bmc_spy", "signal": {...}, "config": {...}},
                {"ticker": "SLV", "strategy_id": "bmc_slv", "signal": {...}, "config": {...}},
            ],
            // Legacy compat: "signal" and "config" still present for first/only strategy
            "signal": {...},
            "config": {...},
        }
    """
    if not user_id:
        return {"error": "user_id required", "signal": None}
    try:
        # Try cached telemetry first (no round-trip)
        registry = get_registry()
        provider = await registry.get_active_provider(
            user_id=user_id,
            allow_fallback_to_any=False,
        )
        if provider and provider.execution_telemetry:
            telemetry = provider.execution_telemetry
            bmc_strategies = _extract_bmc_strategies(telemetry.get("strategies", []))
            result = {
                "source": "cached_telemetry",
                "running": telemetry.get("running", False),
                "strategies": bmc_strategies,
            }
            # Legacy compat: populate top-level signal/config from first strategy
            if bmc_strategies:
                result["signal"] = bmc_strategies[0]["signal"]
                result["config"] = bmc_strategies[0]["config"]
            else:
                result["signal"] = None
                result["config"] = None
            return result

        # Fallback: direct query
        response_data = await send_request_to_provider(
            request_type="execution_status",
            payload={},
            timeout=10.0,
            user_id=user_id,
            allow_fallback_to_any_provider=False,
        )
        if "error" in response_data:
            return {"source": "direct_query", "running": False, "signal": None, "strategies": []}

        bmc_strategies = _extract_bmc_strategies(response_data.get("strategies", []))
        result = {
            "source": "direct_query",
            "running": response_data.get("running", False),
            "strategies": bmc_strategies,
        }
        if bmc_strategies:
            result["signal"] = bmc_strategies[0]["signal"]
            result["config"] = bmc_strategies[0]["config"]
        else:
            result["signal"] = None
            result["config"] = None
        return result
    except Exception as e:
        logger.error(f"Relay bmc-signal error: {e}")
        return {"error": str(e), "signal": None, "strategies": []}

