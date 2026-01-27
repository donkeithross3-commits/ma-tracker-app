"""
Options Scanner API Routes
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime
from typing import List
import logging
import uuid

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
from ..scanner import MergerArbAnalyzer, DealInput
from .ws_relay import send_request_to_provider, get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/options", tags=["options"])


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
async def check_availability(ticker: str) -> AvailabilityCheckResponse:
    """
    Check if listed options exist for a ticker
    """
    try:
        logger.info(f"Checking option availability for {ticker}")
        
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
                   f"strike_lower={params.strikeLowerBound}%, strike_upper={params.strikeUpperBound}%")
        
        # Fetch option chain with custom parameters
        options = scanner.fetch_option_chain(
            request.ticker,
            expiry_months=6,
            current_price=spot_price,
            deal_close_date=close_date,
            days_before_close=params.daysBeforeClose,
            deal_price=request.dealPrice
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
                   f"long_lower={params.strikeLowerBound}%, "
                   f"call_short={params.callShortStrikeLower}%-{params.callShortStrikeUpper}%, "
                   f"put_short={params.putShortStrikeLower}%-{params.putShortStrikeUpper}%, "
                   f"top_n={params.topStrategiesPerExpiration}")
        
        opportunities = analyzer.find_best_opportunities(
            options, 
            current_price, 
            top_n=params.topStrategiesPerExpiration,
            long_strike_lower_pct=params.strikeLowerBound / 100.0,
            call_short_strike_lower_pct=params.callShortStrikeLower / 100.0,
            call_short_strike_upper_pct=params.callShortStrikeUpper / 100.0,
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
    Get current pricing for multiple spreads
    """
    try:
        logger.info(f"Pricing {len(request.spreads)} spreads")
        
        # Get IB client
        ib_client = IBClient()
        if not ib_client.is_connected():
            ib_client.connect()
        
        scanner = ib_client.get_scanner()
        if not scanner:
            raise HTTPException(status_code=503, detail="IB TWS not connected")
        
        prices = []
        
        for spread in request.spreads:
            try:
                # Fetch current prices for each leg
                leg_prices = []
                net_premium = 0.0
                
                for leg in spread.legs:
                    # Parse option symbol to get strike, expiry, right
                    # Assuming symbol format: TICKER YYMMDD C/P STRIKE
                    parts = leg.symbol.split()
                    if len(parts) >= 4:
                        ticker = parts[0]
                        expiry = parts[1]
                        right = parts[2]
                        strike = float(parts[3])
                        
                        # Fetch option data
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
                            
                            # Calculate net premium
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
                # Add with zero premium on error
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


# ============================================================================
# WebSocket Relay Routes - Forward requests to remote IB data providers
# ============================================================================

@router.post("/relay/fetch-chain")
async def relay_fetch_chain(request: FetchChainRequest) -> FetchChainResponse:
    """
    Fetch option chain through WebSocket relay to remote IB data provider.
    This is used when IB TWS runs on a different machine than this server.
    """
    try:
        logger.info(f"Relay: Fetching chain for {request.ticker} via WebSocket provider")
        
        # Check if any provider is connected
        registry = get_registry()
        status = registry.get_status()
        
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No IB data provider connected. Please start the local agent."
            )
        
        # Send request through WebSocket relay
        response_data = await send_request_to_provider(
            request_type="fetch_chain",
            payload={
                "ticker": request.ticker,
                "dealPrice": request.dealPrice,
                "expectedCloseDate": request.expectedCloseDate,
                "scanParams": request.scanParams.dict() if request.scanParams else {}
            },
            timeout=120.0  # IB option chain fetches can take 60+ seconds
        )
        
        # Check for errors in response
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        
        # Convert response to FetchChainResponse format
        contracts = []
        for c in response_data.get("contracts", []):
            contracts.append(OptionContract(
                symbol=c.get("symbol", request.ticker),
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


@router.get("/relay/test-futures")
async def relay_test_futures():
    """
    Test ES futures quote through WebSocket relay.
    Useful for verifying IB connectivity when options markets are closed.
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No IB data provider connected. Please start the local agent."
            )
        
        # Send request through WebSocket relay
        response_data = await send_request_to_provider(
            request_type="test_futures",
            payload={},
            timeout=15.0
        )
        
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay test futures error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/relay/ib-status")
async def relay_ib_status():
    """
    Check IB connection status through WebSocket relay.
    """
    try:
        registry = get_registry()
        status = registry.get_status()
        
        if status["providers_connected"] == 0:
            return {
                "connected": False,
                "source": "relay",
                "message": "No IB data provider connected"
            }
        
        # Ask the provider for IB status
        try:
            response_data = await send_request_to_provider(
                request_type="ib_status",
                payload={},
                timeout=10.0
            )
            
            return {
                "connected": response_data.get("connected", False),
                "source": "relay",
                "providers": status["providers"],
                "message": response_data.get("message", "")
            }
        except Exception as e:
            return {
                "connected": False,
                "source": "relay",
                "providers": status["providers"],
                "message": f"Provider error: {str(e)}"
            }
            
    except Exception as e:
        logger.error(f"Relay IB status error: {e}")
        return {
            "connected": False,
            "source": "error",
            "message": str(e)
        }


from pydantic import BaseModel
from typing import Optional

class ContractSpec(BaseModel):
    ticker: str
    strike: float
    expiry: str
    right: str

class FetchPricesRequest(BaseModel):
    contracts: List[ContractSpec]

class ContractPrice(BaseModel):
    ticker: str
    strike: float
    expiry: str
    right: str
    bid: float
    ask: float
    mid: float
    last: float

class FetchPricesResponse(BaseModel):
    success: bool
    contracts: List[Optional[ContractPrice]]

@router.post("/relay/fetch-prices")
async def relay_fetch_prices(request: FetchPricesRequest) -> FetchPricesResponse:
    """
    Fetch prices for specific contracts through WebSocket relay.
    Used by the Monitor tab to refresh watched spread prices.
    """
    try:
        logger.info(f"Relay: Fetching prices for {len(request.contracts)} contracts")
        
        # Check if any provider is connected
        registry = get_registry()
        status = registry.get_status()
        
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No IB data provider connected. Please start the local agent."
            )
        
        # Send request through WebSocket relay
        response_data = await send_request_to_provider(
            request_type="fetch_prices",
            payload={
                "contracts": [c.dict() for c in request.contracts]
            },
            timeout=60.0  # 60 seconds should be plenty for price fetches
        )
        
        # Check for errors in response
        if "error" in response_data:
            raise HTTPException(status_code=500, detail=response_data["error"])
        
        # Convert response
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
        
        return FetchPricesResponse(
            success=True,
            contracts=contracts
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relay fetch prices error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

