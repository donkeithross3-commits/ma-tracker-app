"""Data models for M&A intelligence platform"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List
from enum import Enum


class DealTier(str, Enum):
    """Deal tier classification"""
    ACTIVE = "active"
    RUMORED = "rumored"
    WATCHLIST = "watchlist"


class DealStatus(str, Enum):
    """Deal status progression"""
    RUMORED = "rumored"
    ANNOUNCED = "announced"
    PENDING_APPROVAL = "pending_approval"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    TERMINATED = "terminated"


class SourceType(str, Enum):
    """Source credibility type"""
    OFFICIAL = "official"  # EDGAR, FTC, NYSE, NASDAQ
    NEWS = "news"  # Reuters, Seeking Alpha
    SOCIAL = "social"  # Twitter
    INDICATOR = "indicator"  # FRED, QuantumOnline


class MentionType(str, Enum):
    """Type of mention from source"""
    RUMOR = "rumor"
    ANNOUNCEMENT = "announcement"
    FILING = "filing"
    CLEARANCE = "clearance"
    CORPORATE_ACTION = "corporate_action"
    TRADING_HALT = "trading_halt"


@dataclass
class DealMention:
    """A single mention of a deal from a source"""
    source_name: str
    source_type: SourceType
    mention_type: MentionType

    # Company information
    target_name: str
    target_ticker: Optional[str] = None
    acquirer_name: Optional[str] = None
    acquirer_ticker: Optional[str] = None

    # Deal details
    deal_value: Optional[float] = None  # In billions
    deal_type: Optional[str] = None

    # Source metadata
    source_url: Optional[str] = None
    headline: Optional[str] = None
    content_snippet: Optional[str] = None
    credibility_score: float = 0.5

    # Extracted structured data
    extracted_data: Optional[Dict[str, Any]] = None

    # Timeline
    source_published_at: Optional[datetime] = None
    detected_at: datetime = None

    def __post_init__(self):
        if self.detected_at is None:
            self.detected_at = datetime.utcnow()


@dataclass
class DealIntelligence:
    """Aggregated intelligence about a potential M&A deal"""
    deal_id: Optional[str] = None

    # Core deal information
    target_name: str = ""
    target_ticker: Optional[str] = None
    acquirer_name: Optional[str] = None
    acquirer_ticker: Optional[str] = None

    # Classification
    deal_tier: DealTier = DealTier.WATCHLIST
    deal_status: DealStatus = DealStatus.RUMORED

    # Deal details
    deal_value: Optional[float] = None
    deal_type: Optional[str] = None

    # Intelligence metadata
    confidence_score: float = 0.5
    source_count: int = 0
    sources: List[DealMention] = None

    # Timeline
    first_detected_at: Optional[datetime] = None
    last_updated_source_at: Optional[datetime] = None
    promoted_to_rumored_at: Optional[datetime] = None
    promoted_to_active_at: Optional[datetime] = None

    def __post_init__(self):
        if self.sources is None:
            self.sources = []
        if self.first_detected_at is None:
            self.first_detected_at = datetime.utcnow()


@dataclass
class TickerWatch:
    """Ticker watchlist entry with tier management"""
    ticker: str
    company_name: str
    watch_tier: DealTier = DealTier.WATCHLIST
    active_deal_id: Optional[str] = None

    # Timeline
    added_at: datetime = None
    promoted_to_rumored_at: Optional[datetime] = None
    promoted_to_active_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None

    notes: Optional[str] = None

    def __post_init__(self):
        if self.added_at is None:
            self.added_at = datetime.utcnow()
        if self.last_activity_at is None:
            self.last_activity_at = datetime.utcnow()


# Source credibility ratings
SOURCE_CREDIBILITY = {
    # Tier 1: Official Sources (5 stars)
    "edgar": 1.0,
    "ftc_early_termination": 1.0,
    "nasdaq_headlines": 1.0,
    "nyse_corporate_actions": 1.0,

    # Tier 2: News Sources (4 stars)
    "reuters_ma": 0.8,
    "seeking_alpha_ma": 0.6,

    # Tier 3: Social Sources (2 stars)
    "twitter_open_outcrier": 0.4,

    # Tier 4: Indicator Sources (3 stars - context only)
    "quantum_online": 0.6,
    "alpharank": 0.5,
    "fred_hy_spread": 0.5,
}


def calculate_confidence_score(sources: List[DealMention]) -> float:
    """
    Calculate aggregate confidence score based on sources.

    Rules:
    - Official source (EDGAR, FTC, Exchange) = 100% confidence
    - High-credibility news (Reuters) = 80% confidence
    - Multiple sources boost confidence
    - Social sources add small boost
    """
    if not sources:
        return 0.5

    # Check for official sources
    official_sources = [s for s in sources if s.source_type == SourceType.OFFICIAL]
    if official_sources:
        return 1.0  # Official = definitive

    # Check for high-credibility news
    news_sources = [s for s in sources if s.source_type == SourceType.NEWS]
    if news_sources:
        max_news_credibility = max(s.credibility_score for s in news_sources)
        if len(news_sources) >= 2:
            return min(0.9, max_news_credibility + 0.1)  # Multiple news = high confidence
        return max_news_credibility

    # Social sources only
    social_sources = [s for s in sources if s.source_type == SourceType.SOCIAL]
    if social_sources:
        if len(social_sources) >= 2:
            return 0.6  # Multiple social mentions
        return 0.4  # Single social mention

    return 0.5  # Default
