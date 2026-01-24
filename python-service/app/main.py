"""
FastAPI service for M&A Options Scanner
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional
import logging
import os
from pathlib import Path

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        logger = logging.getLogger(__name__)
        logger.info(f"Loaded environment from {env_path}")
except ImportError:
    pass

from .scanner import IBMergerArbScanner, MergerArbAnalyzer, DealInput
from .futures import get_futures_scanner
from .api.edgar_routes import router as edgar_router
from .api.intelligence_routes import router as intelligence_router
from .api.webhooks import router as webhooks_router
from .api.halt_routes import router as halt_router
from .api.options_routes import router as options_router
from .edgar.database import EdgarDatabase

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global database instance
db_instance: Optional[EdgarDatabase] = None

def get_db() -> EdgarDatabase:
    """Get the global database instance"""
    if db_instance is None:
        raise RuntimeError("Database not initialized - call during startup event")
    return db_instance

app = FastAPI(
    title="M&A Options Scanner API",
    description="API for analyzing merger arbitrage options strategies",
    version="1.0.0"
)

# Include EDGAR monitoring routes
app.include_router(edgar_router)

# Include Intelligence platform routes
app.include_router(intelligence_router)

# Include Webhook routes
app.include_router(webhooks_router)

# Include Halt monitoring routes
app.include_router(halt_router)

# Include Options scanner routes
app.include_router(options_router)

# Configure CORS - allow requests from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models for API
class DealRequest(BaseModel):
    ticker: str = Field(..., description="Stock ticker symbol")
    deal_price: float = Field(..., description="Deal price per share")
    expected_close_date: str = Field(..., description="Expected close date (YYYY-MM-DD)")
    dividend_before_close: float = Field(0.0, description="Expected dividend before close")
    ctr_value: float = Field(0.0, description="CVR or other value per share")
    confidence: float = Field(0.75, ge=0, le=1, description="Deal confidence (0-1)")
    days_before_close: int = Field(0, ge=0, description="How many days before deal close to look for option expirations (0 = on or after close date only)")


class OptionContract(BaseModel):
    symbol: str
    strike: float
    expiry: str
    right: str
    bid: float
    ask: float
    last: float
    volume: int
    open_interest: int
    implied_vol: Optional[float] = None  # May be None when IB doesn't provide Greeks
    delta: Optional[float] = None  # May be None when IB doesn't provide Greeks
    mid_price: float


class Opportunity(BaseModel):
    strategy: str
    entry_cost: float  # Midpoint cost
    max_profit: float
    breakeven: float
    expected_return: float  # Midpoint expected return
    annualized_return: float  # Midpoint annualized return
    probability_of_profit: float
    edge_vs_market: float
    notes: str
    contracts: List[OptionContract]
    # Far-touch metrics
    entry_cost_ft: float = 0.0
    expected_return_ft: float = 0.0
    annualized_return_ft: float = 0.0


class ScannerResponse(BaseModel):
    success: bool
    ticker: str
    current_price: Optional[float]
    deal_value: float
    spread_pct: Optional[float]
    days_to_close: int
    opportunities: List[Opportunity]
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    ib_connected: bool


# Global scanner instance (reused for performance)
scanner_instance = None


def reset_scanner():
    """Force reset scanner instance"""
    global scanner_instance
    if scanner_instance:
        try:
            scanner_instance.disconnect()
        except:
            pass
    scanner_instance = None
    logger.info("Scanner instance reset")


def get_scanner():
    """Get or create scanner instance"""
    global scanner_instance
    if scanner_instance is None:
        # Force reimport to get latest code
        import importlib
        import app.scanner
        importlib.reload(app.scanner)
        from app.scanner import IBMergerArbScanner as ReloadedScanner

        scanner_instance = ReloadedScanner()
        logger.info("Created new scanner instance with reloaded code")
        # Try to connect to IB
        connected = scanner_instance.connect_to_ib()
        if not connected:
            logger.warning("IB not connected - scanner will not work properly")
    return scanner_instance


@app.get("/", response_model=dict)
async def root():
    """Root endpoint"""
    return {
        "service": "M&A Options Scanner API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    scanner = get_scanner()
    return HealthResponse(
        status="healthy",
        ib_connected=scanner.isConnected() if scanner else False
    )


@app.post("/scan", response_model=ScannerResponse)
async def scan_deal(deal: DealRequest):
    """
    Scan for option opportunities for a merger deal
    """
    try:
        logger.info(f"Scanning deal for {deal.ticker}")

        # Get scanner instance
        scanner = get_scanner()

        if not scanner.isConnected():
            # Try to reconnect
            logger.info("Reconnecting to IB...")
            connected = scanner.connect_to_ib()
            if not connected:
                raise HTTPException(
                    status_code=503,
                    detail="Cannot connect to Interactive Brokers. Please ensure TWS/Gateway is running."
                )

        # Parse date
        try:
            close_date = datetime.strptime(deal.expected_close_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

        # Create deal input
        deal_input = DealInput(
            ticker=deal.ticker.upper(),
            deal_price=deal.deal_price,
            expected_close_date=close_date,
            dividend_before_close=deal.dividend_before_close,
            ctr_value=deal.ctr_value,
            confidence=deal.confidence
        )

        # Fetch underlying data
        logger.info(f"Fetching underlying data for {deal.ticker}")
        underlying_data = scanner.fetch_underlying_data(deal.ticker.upper())

        if not underlying_data['price']:
            raise HTTPException(
                status_code=404,
                detail=f"Could not fetch price data for {deal.ticker}. Check ticker symbol."
            )

        current_price = underlying_data['price']

        # Calculate spread
        spread_pct = ((deal_input.total_deal_value - current_price) / current_price) * 100

        # Fetch option chain - use deal close date to select appropriate expirations
        logger.info(f"Fetching option chain for {deal.ticker}")
        options = scanner.fetch_option_chain(
            deal.ticker.upper(),
            expiry_months=6,
            current_price=current_price,
            deal_close_date=deal_input.expected_close_date,
            days_before_close=deal.days_before_close,
            deal_price=deal.deal_price
        )

        if not options:
            return ScannerResponse(
                success=True,
                ticker=deal.ticker.upper(),
                current_price=current_price,
                deal_value=deal_input.total_deal_value,
                spread_pct=spread_pct,
                days_to_close=deal_input.days_to_close,
                opportunities=[],
                error="No option data available for this ticker"
            )

        # Analyze opportunities
        logger.info(f"Analyzing opportunities for {deal.ticker}")
        analyzer = MergerArbAnalyzer(deal_input)
        opportunities = analyzer.find_best_opportunities(options, current_price, top_n=10)

        # Convert to response format
        opportunity_list = []
        for opp in opportunities:
            contracts = []
            for contract in opp.contracts:
                contracts.append(OptionContract(
                    symbol=contract.symbol,
                    strike=contract.strike,
                    expiry=contract.expiry,
                    right=contract.right,
                    bid=contract.bid,
                    ask=contract.ask,
                    last=contract.last,
                    volume=contract.volume,
                    open_interest=contract.open_interest,
                    implied_vol=contract.implied_vol,
                    delta=contract.delta,
                    mid_price=contract.mid_price
                ))

            opportunity_list.append(Opportunity(
                strategy=opp.strategy,
                entry_cost=opp.entry_cost,
                max_profit=opp.max_profit,
                breakeven=opp.breakeven,
                expected_return=opp.expected_return,
                annualized_return=opp.annualized_return,
                probability_of_profit=opp.probability_of_profit,
                edge_vs_market=opp.edge_vs_market,
                notes=opp.notes,
                contracts=contracts,
                entry_cost_ft=opp.entry_cost_ft,
                expected_return_ft=opp.expected_return_ft,
                annualized_return_ft=opp.annualized_return_ft
            ))

        return ScannerResponse(
            success=True,
            ticker=deal.ticker.upper(),
            current_price=current_price,
            deal_value=deal_input.total_deal_value,
            spread_pct=spread_pct,
            days_to_close=deal_input.days_to_close,
            opportunities=opportunity_list
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scanning deal: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@app.get("/test-scan/{ticker}", response_model=ScannerResponse)
async def test_scan(ticker: str):
    """
    Quick test endpoint - scans a ticker with default parameters
    Uses current price + 5% as deal price to simulate realistic merger scenario
    """
    from datetime import timedelta

    # Get scanner to fetch current price
    scanner = get_scanner()

    if not scanner.isConnected():
        raise HTTPException(
            status_code=503,
            detail="Cannot connect to Interactive Brokers"
        )

    # Fetch underlying data to get current price
    underlying_data = scanner.fetch_underlying_data(ticker.upper())
    current_price = underlying_data.get('price', 100.0)

    # Set deal price 5% above current (realistic merger premium)
    deal_price = round(current_price * 1.05, 2)

    # Use default test parameters - close date 90 days from now
    future_date = (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")

    deal = DealRequest(
        ticker=ticker,
        deal_price=deal_price,
        expected_close_date=future_date,
        dividend_before_close=0.0,
        ctr_value=0.0,
        confidence=0.75
    )
    return await scan_deal(deal)


@app.get("/test-futures")
async def test_futures():
    """
    Test ES futures data feed - useful for overnight testing when options markets are closed

    This endpoint:
    - Verifies IB Gateway connectivity
    - Tests real-time market data flow
    - Works 23 hours/day (futures market hours)
    """
    try:
        scanner = get_futures_scanner()

        if not scanner.isConnected():
            raise HTTPException(
                status_code=503,
                detail="Futures scanner not connected to Interactive Brokers"
            )

        # Fetch ES futures data (Dec 2025 contract)
        futures_data = scanner.fetch_es_futures(contract_month="202512")

        if not futures_data.get('success'):
            raise HTTPException(
                status_code=500,
                detail=futures_data.get('error', 'Failed to fetch futures data')
            )

        return {
            "success": True,
            "message": "ES futures data retrieved successfully",
            "data": futures_data,
            "note": "This endpoint is useful for testing overnight when options markets are closed"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching futures data: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


@app.post("/reset-scanner")
async def reset_scanner_endpoint():
    """Force reset the scanner instance to reload code"""
    reset_scanner()
    return {"success": True, "message": "Scanner instance reset - next scan will use reloaded code"}


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global db_instance

    logger.info("=" * 50)
    logger.info("STARTUP INITIATED - Initializing services...")
    logger.info("=" * 50)

    # Initialize global database connection pool
    try:
        logger.info("Creating global database connection pool...")
        db_instance = EdgarDatabase()
        await db_instance.connect()
        logger.info("✓ Database connection pool created")
    except Exception as e:
        logger.error(f"Failed to create database pool: {e}")
        logger.warning("API endpoints will create their own connections...")

    # Start Halt Monitoring (commented out until migration is applied)
    # Will auto-start monitoring M&A target tickers for trading halts
    try:
        from .monitors.halt_monitor import get_halt_monitor
        import asyncio

        logger.info("Starting Halt Monitor...")
        monitor = get_halt_monitor()

        # Start monitor in background task
        asyncio.create_task(monitor.start())

        logger.info("✓ Halt Monitor started - polling NASDAQ/NYSE every 2 seconds")
    except Exception as e:
        logger.error(f"Failed to start Halt Monitor: {e}")
        logger.warning("Continuing without halt monitoring...")

    logger.info("=" * 50)
    logger.info("STARTUP COMPLETE")
    logger.info("=" * 50)


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global db_instance

    logger.info("=" * 50)
    logger.info("SHUTDOWN INITIATED - Cleaning up resources...")
    logger.info("=" * 50)

    # 1. Close global database connection pool
    try:
        if db_instance:
            logger.info("Closing global database connection pool...")
            await db_instance.disconnect()
            logger.info("✓ Database pool closed")
    except Exception as e:
        logger.error(f"Error closing database pool: {e}")

    # 2. Stop Halt Monitor
    try:
        from .monitors.halt_monitor import get_halt_monitor
        logger.info("Stopping Halt Monitor...")
        monitor = get_halt_monitor()
        await monitor.stop()
        logger.info("✓ Halt Monitor stopped")
    except Exception as e:
        logger.error(f"Error stopping Halt Monitor: {e}")

    # 2. Stop EDGAR monitoring
    try:
        from .api.edgar_routes import stop_edgar_monitoring, stop_research_worker
        logger.info("Stopping EDGAR monitoring...")
        await stop_edgar_monitoring()
        logger.info("Stopping research worker...")
        await stop_research_worker()
        logger.info("✓ EDGAR services stopped")
    except Exception as e:
        logger.error(f"Error stopping EDGAR services: {e}")

    # 3. Stop Intelligence monitoring
    try:
        from .intelligence.orchestrator import stop_intelligence_monitoring
        logger.info("Stopping Intelligence monitoring...")
        await stop_intelligence_monitoring()
        logger.info("✓ Intelligence services stopped")
    except Exception as e:
        logger.error(f"Error stopping Intelligence services: {e}")

    # 4. Disconnect IB scanner
    try:
        global scanner_instance
        if scanner_instance and scanner_instance.isConnected():
            logger.info("Disconnecting from IB...")
            scanner_instance.disconnect()
            logger.info("✓ IB disconnected")
    except Exception as e:
        logger.error(f"Error disconnecting IB: {e}")

    logger.info("=" * 50)
    logger.info("SHUTDOWN COMPLETE - All resources cleaned up")
    logger.info("=" * 50)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
