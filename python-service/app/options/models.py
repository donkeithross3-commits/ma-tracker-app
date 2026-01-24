"""
Pydantic models for options scanner API
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class OptionContract(BaseModel):
    """Option contract data"""
    symbol: str
    strike: float
    expiry: str
    right: str  # 'C' or 'P'
    bid: float
    ask: float
    mid: float
    last: float
    volume: int
    open_interest: int
    implied_vol: Optional[float] = None
    delta: Optional[float] = None
    bid_size: int = 0
    ask_size: int = 0


class StrategyLeg(BaseModel):
    """Single leg of a strategy"""
    symbol: str
    strike: float
    right: str  # 'C' or 'P'
    quantity: int
    side: str  # 'BUY' or 'SELL'
    bid: float
    ask: float
    mid: float
    volume: int
    openInterest: int
    bidSize: int = 0
    askSize: int = 0


class CandidateStrategy(BaseModel):
    """Candidate strategy for watchlist"""
    id: str
    strategyType: str
    expiration: str
    legs: List[StrategyLeg]
    netPremium: float
    netPremiumFarTouch: float
    maxProfit: float
    maxLoss: float
    returnOnRisk: float
    annualizedYield: float
    annualizedYieldFarTouch: float
    liquidityScore: float
    notes: str


class AvailabilityCheckResponse(BaseModel):
    """Response for availability check"""
    available: bool
    expirationCount: int
    error: Optional[str] = None


class ScanParameters(BaseModel):
    """Optional scan parameters"""
    daysBeforeClose: Optional[int] = 60
    strikeLowerBound: Optional[float] = 20.0  # % below deal price
    strikeUpperBound: Optional[float] = 10.0  # % above deal/spot price
    shortStrikeLower: Optional[float] = 10.0  # % below deal price
    shortStrikeUpper: Optional[float] = 20.0  # % above deal price
    topStrategiesPerExpiration: Optional[int] = 5
    dealConfidence: Optional[float] = 0.75


class FetchChainRequest(BaseModel):
    """Request to fetch option chain"""
    ticker: str
    dealPrice: float
    expectedCloseDate: str
    scanParams: Optional[ScanParameters] = None


class FetchChainResponse(BaseModel):
    """Response with option chain data"""
    ticker: str
    spotPrice: float
    expirations: List[str]
    contracts: List[OptionContract]


class GenerateStrategiesRequest(BaseModel):
    """Request to generate strategies"""
    ticker: str
    dealPrice: float
    expectedCloseDate: str
    chainData: dict  # Full chain data
    scanParams: Optional[ScanParameters] = None


class GenerateStrategiesResponse(BaseModel):
    """Response with candidate strategies"""
    candidates: List[CandidateStrategy]


class SpreadLeg(BaseModel):
    """Leg for pricing request"""
    symbol: str
    quantity: int
    side: str


class PriceSpreadRequest(BaseModel):
    """Request to price a spread"""
    spreadId: str
    legs: List[SpreadLeg]


class PriceSpreadsRequest(BaseModel):
    """Request to price multiple spreads"""
    spreads: List[PriceSpreadRequest]


class SpreadPrice(BaseModel):
    """Price for a single spread"""
    spreadId: str
    premium: float
    timestamp: str
    legs: Optional[List[OptionContract]] = None


class PriceSpreadsResponse(BaseModel):
    """Response with spread prices"""
    prices: List[SpreadPrice]

