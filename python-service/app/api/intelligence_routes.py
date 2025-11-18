"""API routes for M&A Intelligence Platform"""
from fastapi import APIRouter, HTTPException
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime
import time

from app.edgar.database import EdgarDatabase
from app.intelligence.orchestrator import (
    start_intelligence_monitoring,
    stop_intelligence_monitoring,
    is_intelligence_monitoring_running,
    get_monitoring_stats,
    get_recent_scanned_articles,
)
from app.utils.timezone import convert_to_cst

# Simple in-memory cache for rumored deals with 30-second TTL
# This dramatically speeds up repeated loads while keeping data fresh
_rumored_deals_cache: Dict[str, Any] = {
    "data": None,
    "timestamp": 0,
    "ttl": 30  # seconds
}

def invalidate_rumored_deals_cache():
    """Invalidate the rumored deals cache when data changes"""
    _rumored_deals_cache["data"] = None
    _rumored_deals_cache["timestamp"] = 0

# Cache for intelligence deals listing
_intelligence_deals_cache: Dict[str, Any] = {
    "data": None,
    "cache_key": None,
    "timestamp": 0,
    "ttl": 30  # seconds
}

def invalidate_intelligence_deals_cache():
    """Invalidate the intelligence deals cache when data changes"""
    _intelligence_deals_cache["data"] = None
    _intelligence_deals_cache["cache_key"] = None
    _intelligence_deals_cache["timestamp"] = 0

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# Global database pool - created once and reused
_db_pool: Optional[EdgarDatabase] = None


async def get_db_pool() -> EdgarDatabase:
    """Get the global database pool from main.py"""
    from ..main import get_db
    return get_db()


class IntelligenceStatusResponse(BaseModel):
    is_running: bool
    message: str
    monitors_count: Optional[int] = None


class DealIntelligenceResponse(BaseModel):
    dealId: str
    targetName: str
    targetTicker: Optional[str]
    acquirerName: Optional[str]
    acquirerTicker: Optional[str]
    dealTier: str  # active, rumored, watchlist
    dealStatus: str  # rumored, announced, pending_approval, in_progress, completed, terminated
    dealValue: Optional[float]
    dealType: Optional[str]
    confidenceScore: float
    sourceCount: int
    firstDetectedAt: datetime
    lastUpdatedSourceAt: Optional[datetime]
    promotedToRumoredAt: Optional[datetime]
    promotedToActiveAt: Optional[datetime]


class DealSourceResponse(BaseModel):
    sourceId: str
    sourceName: str
    sourceType: str
    mentionType: str
    headline: Optional[str]
    sourceUrl: Optional[str]
    credibilityScore: float
    sourcePublishedAt: Optional[datetime]
    detectedAt: datetime


class TickerWatchlistResponse(BaseModel):
    ticker: str
    companyName: str
    watchTier: str  # active, rumored, general
    activeDealId: Optional[str]
    lastActivityAt: Optional[datetime]


@router.post("/monitoring/start", response_model=IntelligenceStatusResponse)
async def start_monitoring():
    """Start multi-source intelligence monitoring"""
    try:
        if is_intelligence_monitoring_running():
            return IntelligenceStatusResponse(
                is_running=True,
                message="Intelligence monitoring is already running"
            )

        # Get database pool
        db = EdgarDatabase()
        await db.connect()

        await start_intelligence_monitoring(db.pool)

        # Don't disconnect - monitoring needs the pool

        return IntelligenceStatusResponse(
            is_running=True,
            message="Intelligence monitoring started successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start monitoring: {str(e)}")


@router.post("/monitoring/stop", response_model=IntelligenceStatusResponse)
async def stop_monitoring():
    """Stop intelligence monitoring"""
    try:
        await stop_intelligence_monitoring()

        return IntelligenceStatusResponse(
            is_running=False,
            message="Intelligence monitoring stopped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop monitoring: {str(e)}")


@router.get("/monitoring/status")
async def get_status():
    """Get current intelligence monitoring status"""
    is_running = is_intelligence_monitoring_running()
    stats = await get_monitoring_stats()

    return {
        "is_running": is_running,
        "message": "Running" if is_running else "Stopped",
        **stats
    }


@router.get("/deals", response_model=List[DealIntelligenceResponse])
async def get_deals(tier: Optional[str] = None, status: Optional[str] = None, limit: int = 100):
    """Get all deals from intelligence system, optionally filtered by tier or status"""
    import logging
    logger = logging.getLogger(__name__)

    # Check cache first
    cache_key = f"tier_{tier}_status_{status}_limit_{limit}"
    current_time = time.time()

    if (_intelligence_deals_cache.get("cache_key") == cache_key and
        _intelligence_deals_cache["data"] is not None and
        current_time - _intelligence_deals_cache["timestamp"] < _intelligence_deals_cache["ttl"]):
        logger.debug(f"Returning cached intelligence deals for key: {cache_key}")
        return _intelligence_deals_cache["data"]

    logger.debug(f"Cache miss for intelligence deals, fetching from database")

    db = await get_db_pool()

    query = """
        SELECT deal_id, target_name, target_ticker, acquirer_name, acquirer_ticker,
               deal_tier, deal_status, deal_value, deal_type,
               confidence_score, source_count,
               first_detected_at, last_updated_source_at,
               promoted_to_rumored_at, promoted_to_active_at
        FROM deal_intelligence
    """

    params = []
    where_clauses = []

    if tier:
        where_clauses.append(f"deal_tier = ${len(params) + 1}")
        params.append(tier)

    if status:
        where_clauses.append(f"deal_status = ${len(params) + 1}")
        params.append(status)

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)

    query += " ORDER BY first_detected_at DESC LIMIT $" + str(len(params) + 1)
    params.append(limit)

    conn = await db.pool.acquire()
    try:
        deals = await conn.fetch(query, *params)

        results = []
        for deal in deals:
            results.append(DealIntelligenceResponse(
                dealId=str(deal["deal_id"]),
                targetName=deal["target_name"],
                targetTicker=deal.get("target_ticker"),
                acquirerName=deal.get("acquirer_name"),
                acquirerTicker=deal.get("acquirer_ticker"),
                dealTier=deal["deal_tier"],
                dealStatus=deal["deal_status"],
                dealValue=float(deal["deal_value"]) if deal.get("deal_value") else None,
                dealType=deal.get("deal_type"),
                confidenceScore=float(deal["confidence_score"]),
                sourceCount=deal["source_count"],
                firstDetectedAt=convert_to_cst(deal["first_detected_at"]),
                lastUpdatedSourceAt=convert_to_cst(deal.get("last_updated_source_at")),
                promotedToRumoredAt=convert_to_cst(deal.get("promoted_to_rumored_at")),
                promotedToActiveAt=convert_to_cst(deal.get("promoted_to_active_at")),
            ))

        # Update cache
        _intelligence_deals_cache["data"] = results
        _intelligence_deals_cache["cache_key"] = cache_key
        _intelligence_deals_cache["timestamp"] = current_time

        return results
    finally:
        await db.pool.release(conn)


@router.get("/deals/{deal_id}")
async def get_deal(deal_id: str):
    """Get detailed information about a specific deal including all sources"""
    db = await get_db_pool()

    conn = await db.pool.acquire()
    try:
        # Get deal info
        deal = await conn.fetchrow(
            """SELECT * FROM deal_intelligence WHERE deal_id = $1""",
            deal_id
        )

        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")

        # Get all sources for this deal
        sources = await conn.fetch(
            """SELECT * FROM deal_sources
               WHERE deal_id = $1
               ORDER BY detected_at DESC""",
            deal_id
        )

        return {
            "deal": dict(deal),
            "sources": [dict(s) for s in sources]
        }
    finally:
        await db.pool.release(conn)


class RejectDealRequest(BaseModel):
    rejection_reason: Optional[str] = None  # Free-text reason for rejection
    rejection_category: Optional[str] = None  # Structured category

class RejectDealResponse(BaseModel):
    success: bool
    message: str
    deal_id: str
    deal_status: str


@router.post("/deals/{deal_id}/reject", response_model=RejectDealResponse)
async def reject_deal(deal_id: str, request: Optional[RejectDealRequest] = None):
    """
    Mark an intelligence deal (rumored deal) as rejected.
    This prevents it from reappearing in rumored deals and hides it from the main queue.

    Optional rejection tracking for ML training:
    - rejection_category: not_rumor, insufficient_evidence, wrong_company, social_media_noise, already_in_production, other
    - rejection_reason: Free-text explanation
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Verify deal exists
            deal = await conn.fetchrow(
                """SELECT deal_id, target_name, deal_status FROM deal_intelligence WHERE deal_id = $1""",
                deal_id
            )

            if not deal:
                raise HTTPException(status_code=404, detail="Deal not found")

            # Extract rejection tracking data
            rejection_category = request.rejection_category if request else None
            rejection_reason = request.rejection_reason if request else None

            # Update deal status to rejected with tracking
            await conn.execute(
                """
                UPDATE deal_intelligence
                SET
                    review_status = 'rejected',
                    deal_status = 'rejected',
                    rejection_category = $2,
                    rejection_reason = $3,
                    reviewed_at = NOW(),
                    updated_at = NOW()
                WHERE deal_id = $1
                """,
                deal_id, rejection_category, rejection_reason
            )

            # Log the rejection in deal_history
            import json
            await conn.execute(
                """
                INSERT INTO deal_history (deal_id, change_type, old_value, new_value, triggered_by, notes)
                VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
                """,
                deal_id,
                'status_updated',
                json.dumps({'deal_status': deal['deal_status']}),
                json.dumps({'deal_status': 'rejected'}),
                'user',
                'Deal manually rejected from intelligence queue'
            )

            return RejectDealResponse(
                success=True,
                message=f"Deal '{deal['target_name']}' has been rejected",
                deal_id=str(deal_id),
                deal_status="rejected"
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


class PromoteDealResponse(BaseModel):
    success: bool
    message: str
    deal_id: str
    new_tier: str


@router.post("/deals/{deal_id}/promote", response_model=PromoteDealResponse)
async def promote_deal_to_active(deal_id: str):
    """
    Promote an intelligence deal from watchlist/rumored to active tier.
    This moves the deal to production tracking.
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Verify deal exists and get current state
            deal = await conn.fetchrow(
                """SELECT deal_id, target_name, deal_tier, deal_status
                   FROM deal_intelligence WHERE deal_id = $1""",
                deal_id
            )

            if not deal:
                raise HTTPException(status_code=404, detail="Deal not found")

            if deal['deal_status'] == 'rejected':
                raise HTTPException(status_code=400, detail="Cannot promote rejected deal")

            # Promote deal to active tier
            await conn.execute(
                """
                UPDATE deal_intelligence
                SET
                    deal_tier = 'active',
                    promoted_to_active_at = NOW(),
                    updated_at = NOW()
                WHERE deal_id = $1
                """,
                deal_id
            )

            return PromoteDealResponse(
                success=True,
                message=f"Deal '{deal['target_name']}' promoted to active tier",
                deal_id=str(deal_id),
                new_tier="active"
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


class IntelligenceRejectionStats(BaseModel):
    category: str
    count: int
    avg_confidence: float
    unique_tickers: int
    deal_tiers: List[str]


class IntelligenceRejectionAnalysis(BaseModel):
    total_rejections: int
    by_category: List[IntelligenceRejectionStats]
    recent_rejections: List[dict]


@router.get("/rejection-analysis", response_model=IntelligenceRejectionAnalysis)
async def get_intelligence_rejection_analysis():
    """
    Get analysis of intelligence rejection reasons for ML training.

    Excludes categories that represent valid deals (already_in_production, social_media_noise if duplicates).
    Includes false positive patterns to learn from: not_rumor, insufficient_evidence, wrong_company, other.
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get category breakdown (excluding valid duplicates from training data)
            category_stats = await conn.fetch(
                """
                SELECT
                    rejection_category as category,
                    COUNT(*) as count,
                    AVG(confidence_score) as avg_confidence,
                    COUNT(DISTINCT target_ticker) as unique_tickers,
                    array_agg(DISTINCT deal_tier) as deal_tiers
                FROM deal_intelligence
                WHERE review_status = 'rejected'
                AND rejection_category IS NOT NULL
                AND rejection_category NOT IN ('already_in_production')
                GROUP BY rejection_category
                ORDER BY count DESC
                """
            )

            # Get recent rejections with details for analysis
            recent_rejections = await conn.fetch(
                """
                SELECT
                    deal_id,
                    target_name,
                    target_ticker,
                    acquirer_name,
                    deal_tier,
                    confidence_score,
                    rejection_category,
                    rejection_reason,
                    reviewed_at,
                    first_detected_at
                FROM deal_intelligence
                WHERE review_status = 'rejected'
                AND rejection_category IS NOT NULL
                AND rejection_category NOT IN ('already_in_production')
                ORDER BY reviewed_at DESC
                LIMIT 100
                """
            )

            # Get total rejection count
            total = await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM deal_intelligence
                WHERE review_status = 'rejected'
                AND rejection_category IS NOT NULL
                AND rejection_category NOT IN ('already_in_production')
                """
            )

            by_category = [
                IntelligenceRejectionStats(
                    category=row['category'],
                    count=row['count'],
                    avg_confidence=float(row['avg_confidence'] or 0),
                    unique_tickers=row['unique_tickers'],
                    deal_tiers=row['deal_tiers'] or []
                )
                for row in category_stats
            ]

            recent = [
                {
                    'deal_id': row['deal_id'],
                    'target_name': row['target_name'],
                    'target_ticker': row['target_ticker'],
                    'acquirer_name': row['acquirer_name'],
                    'deal_tier': row['deal_tier'],
                    'confidence_score': float(row['confidence_score']),
                    'rejection_category': row['rejection_category'],
                    'rejection_reason': row['rejection_reason'],
                    'reviewed_at': convert_to_cst(row['reviewed_at']),
                    'first_detected_at': convert_to_cst(row['first_detected_at'])
                }
                for row in recent_rejections
            ]

            return IntelligenceRejectionAnalysis(
                total_rejections=total,
                by_category=by_category,
                recent_rejections=recent
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


class TrackDealRequest(BaseModel):
    production_deal_id: str


class TrackDealResponse(BaseModel):
    success: bool
    message: str
    tracking_status: str


@router.post("/deals/{deal_id}/track", response_model=TrackDealResponse)
async def track_deal_for_production(deal_id: str, request: TrackDealRequest):
    """
    Mark an intelligence deal as tracked for production.
    Updates the deal with production_deal_id and sets tracking status.
    Enables enhanced monitoring for continuous research and attribute extraction.
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Verify deal exists
            deal = await conn.fetchrow(
                """SELECT deal_id, target_name FROM deal_intelligence WHERE deal_id = $1""",
                deal_id
            )

            if not deal:
                raise HTTPException(status_code=404, detail="Deal not found")

            # Update deal with production tracking info
            await conn.execute(
                """
                UPDATE deal_intelligence
                SET
                    production_deal_id = $1,
                    tracking_status = 'synced_to_production',
                    last_synced_to_production = NOW(),
                    enhanced_monitoring_enabled = TRUE
                WHERE deal_id = $2
                """,
                request.production_deal_id,
                deal_id
            )

            return TrackDealResponse(
                success=True,
                message=f"Deal '{deal['target_name']}' is now tracked for production",
                tracking_status="synced_to_production"
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


class SuggestionResponse(BaseModel):
    suggestionId: str
    dealId: str
    productionDealId: str
    suggestionType: str
    suggestedField: Optional[str]
    currentValue: Optional[str]
    suggestedValue: Optional[str]
    confidenceScore: Optional[float]
    reasoning: str
    sourceCount: int
    status: str
    createdAt: datetime
    updatedAt: datetime


@router.get("/suggestions/{production_deal_id}", response_model=List[SuggestionResponse])
async def get_deal_suggestions(production_deal_id: str, status: Optional[str] = None):
    """Get all suggestions for a production deal, optionally filtered by status"""
    db = EdgarDatabase()
    await db.connect()

    try:
        query = """
            SELECT suggestion_id, deal_id, production_deal_id,
                   suggestion_type, suggested_field, current_value, suggested_value,
                   confidence_score, reasoning, source_count, status,
                   created_at, updated_at
            FROM production_deal_suggestions
            WHERE production_deal_id = $1
        """

        params = [production_deal_id]
        if status:
            query += " AND status = $2"
            params.append(status)

        query += " ORDER BY created_at DESC"

        conn = await db.pool.acquire()
        try:
            suggestions = await conn.fetch(query, *params)

            results = []
            for s in suggestions:
                results.append(SuggestionResponse(
                    suggestionId=str(s["suggestion_id"]),
                    dealId=str(s["deal_id"]),
                    productionDealId=s["production_deal_id"],
                    suggestionType=s["suggestion_type"],
                    suggestedField=s.get("suggested_field"),
                    currentValue=s.get("current_value"),
                    suggestedValue=s.get("suggested_value"),
                    confidenceScore=float(s["confidence_score"]) if s.get("confidence_score") else None,
                    reasoning=s["reasoning"],
                    sourceCount=s["source_count"],
                    status=s["status"],
                    createdAt=convert_to_cst(s["created_at"]),
                    updatedAt=convert_to_cst(s["updated_at"]),
                ))

            return results
        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


class AcceptSuggestionRequest(BaseModel):
    reviewed_by: str


class RejectSuggestionRequest(BaseModel):
    reviewed_by: str
    rejection_reason: Optional[str] = None


class SuggestionActionResponse(BaseModel):
    success: bool
    message: str
    suggestion: dict


@router.post("/suggestions/{suggestion_id}/accept", response_model=SuggestionActionResponse)
async def accept_suggestion(suggestion_id: str, request: AcceptSuggestionRequest):
    """Accept a suggestion and mark it as applied"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get suggestion details
            suggestion = await conn.fetchrow(
                """SELECT * FROM production_deal_suggestions WHERE suggestion_id = $1""",
                suggestion_id
            )

            if not suggestion:
                raise HTTPException(status_code=404, detail="Suggestion not found")

            if suggestion["status"] != "pending":
                raise HTTPException(
                    status_code=400,
                    detail=f"Suggestion is already {suggestion['status']}"
                )

            # Update suggestion status
            await conn.execute(
                """
                UPDATE production_deal_suggestions
                SET
                    status = 'accepted',
                    reviewed_by = $1,
                    reviewed_at = NOW(),
                    applied_at = NOW()
                WHERE suggestion_id = $2
                """,
                request.reviewed_by,
                suggestion_id
            )

            # Update the production deal to mark has_pending_suggestions
            await conn.execute(
                """
                UPDATE deals
                SET has_pending_suggestions = (
                    SELECT COUNT(*) > 0
                    FROM production_deal_suggestions
                    WHERE production_deal_id = $1 AND status = 'pending'
                )
                WHERE id = $1
                """,
                suggestion["production_deal_id"]
            )

            return SuggestionActionResponse(
                success=True,
                message="Suggestion accepted successfully",
                suggestion=dict(suggestion)
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.post("/suggestions/{suggestion_id}/reject", response_model=SuggestionActionResponse)
async def reject_suggestion(suggestion_id: str, request: RejectSuggestionRequest):
    """Reject a suggestion"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get suggestion details
            suggestion = await conn.fetchrow(
                """SELECT * FROM production_deal_suggestions WHERE suggestion_id = $1""",
                suggestion_id
            )

            if not suggestion:
                raise HTTPException(status_code=404, detail="Suggestion not found")

            if suggestion["status"] != "pending":
                raise HTTPException(
                    status_code=400,
                    detail=f"Suggestion is already {suggestion['status']}"
                )

            # Update suggestion status
            await conn.execute(
                """
                UPDATE production_deal_suggestions
                SET
                    status = 'rejected',
                    reviewed_by = $1,
                    reviewed_at = NOW()
                WHERE suggestion_id = $2
                """,
                request.reviewed_by,
                suggestion_id
            )

            # Update the production deal to mark has_pending_suggestions
            await conn.execute(
                """
                UPDATE deals
                SET has_pending_suggestions = (
                    SELECT COUNT(*) > 0
                    FROM production_deal_suggestions
                    WHERE production_deal_id = $1 AND status = 'pending'
                )
                WHERE id = $1
                """,
                suggestion["production_deal_id"]
            )

            return SuggestionActionResponse(
                success=True,
                message="Suggestion rejected successfully",
                suggestion=dict(suggestion)
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.get("/watchlist", response_model=List[TickerWatchlistResponse])
async def get_watchlist(tier: Optional[str] = None):
    """Get ticker watchlist, optionally filtered by tier"""
    db = EdgarDatabase()
    await db.connect()

    try:
        query = """
            SELECT ticker, company_name, watch_tier, active_deal_id, last_activity_at
            FROM ticker_watchlist
        """

        params = []
        if tier:
            query += " WHERE watch_tier = $1"
            params.append(tier)

        query += " ORDER BY last_activity_at DESC"

        conn = await db.pool.acquire()
        try:
            tickers = await conn.fetch(query, *params)

            results = []
            for ticker in tickers:
                results.append(TickerWatchlistResponse(
                    ticker=ticker["ticker"],
                    companyName=ticker["company_name"],
                    watchTier=ticker["watch_tier"],
                    activeDealId=str(ticker["active_deal_id"]) if ticker.get("active_deal_id") else None,
                    lastActivityAt=convert_to_cst(ticker.get("last_activity_at")),
                ))

            return results
        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.get("/sources/{source_name}/stats")
async def get_source_stats(source_name: str):
    """Get statistics for a specific source monitor"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            source = await conn.fetchrow(
                """SELECT * FROM source_monitors WHERE source_name = $1""",
                source_name
            )

            if not source:
                raise HTTPException(status_code=404, detail="Source not found")

            return dict(source)
        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.get("/rumored-deals")
async def get_rumored_deals_with_edgar_status(
    exclude_watch_list: bool = False,
    watch_list_only: bool = False
):
    """
    Get all rumored and watchlist deals with their EDGAR confirmation status.

    This shows:
    - Deals from non-regulatory sources (news, social media)
    - Whether EDGAR filings were found to corroborate
    - Confidence score and how EDGAR impacted it
    - When EDGAR was last searched

    Params:
    - exclude_watch_list: If true, exclude deals that are in rumor_watch_list
    - watch_list_only: If true, only show deals that are in rumor_watch_list
    """
    # Create cache key based on parameters
    cache_key = f"exclude_watch_list={exclude_watch_list},watch_list_only={watch_list_only}"
    current_time = time.time()

    # Check if we have cached data for this exact query that's still fresh
    if (_rumored_deals_cache.get("data") is not None and
        _rumored_deals_cache.get("cache_key") == cache_key and
        current_time - _rumored_deals_cache.get("timestamp", 0) < _rumored_deals_cache["ttl"]):
        return _rumored_deals_cache["data"]

    db = await get_db_pool()

    conn = await db.pool.acquire()
    try:
            # Build query based on filters
            query = """
                SELECT
                    di.deal_id,
                    di.target_name,
                    di.target_ticker,
                    di.acquirer_name,
                    di.acquirer_ticker,
                    di.deal_tier,
                    di.deal_status,
                    di.deal_value,
                    di.deal_type,
                    di.confidence_score,
                    di.source_count,
                    di.first_detected_at,
                    di.last_updated_source_at,
                    di.promoted_to_rumored_at,
                    di.promoted_to_active_at
                FROM deal_intelligence di
                WHERE di.deal_tier IN ('rumored', 'watchlist')
                  AND di.deal_status != 'rejected'
                  AND di.target_ticker IS NOT NULL
            """

            # Add watch list filtering
            if exclude_watch_list:
                query += """
                  AND di.target_ticker NOT IN (
                    SELECT ticker FROM rumor_watch_list WHERE is_active = TRUE
                  )
                """
            elif watch_list_only:
                query += """
                  AND di.target_ticker IN (
                    SELECT ticker FROM rumor_watch_list WHERE is_active = TRUE
                  )
                """

            query += " ORDER BY di.first_detected_at DESC, di.confidence_score DESC"

            deals = await conn.fetch(query)

            if not deals:
                return {"deals": [], "total": 0}

            # Batch fetch all sources and EDGAR history in 2 queries instead of N queries per deal
            deal_ids = [str(deal["deal_id"]) for deal in deals]

            # Fetch all sources for all deals in one query
            all_sources = await conn.fetch(
                """
                SELECT deal_id, source_name, source_type, mention_type, credibility_score, source_published_at
                FROM deal_sources
                WHERE deal_id = ANY($1::uuid[])
                ORDER BY deal_id, detected_at DESC
                """,
                deal_ids
            )

            # Fetch all EDGAR cross-reference history for all deals in one query
            all_edgar_history = await conn.fetch(
                """
                SELECT DISTINCT ON (deal_id)
                    deal_id, changed_at, old_value, new_value, notes
                FROM deal_history
                WHERE deal_id = ANY($1::uuid[])
                  AND change_type = 'edgar_cross_reference'
                ORDER BY deal_id, changed_at DESC
                """,
                deal_ids
            )

            # Group sources by deal_id for fast lookup
            sources_by_deal = {}
            for source in all_sources:
                deal_id = str(source["deal_id"])
                if deal_id not in sources_by_deal:
                    sources_by_deal[deal_id] = []
                sources_by_deal[deal_id].append(source)

            # Group EDGAR history by deal_id for fast lookup
            edgar_history_by_deal = {str(row["deal_id"]): row for row in all_edgar_history}

            # Build results
            results = []
            for deal in deals:
                deal_id = str(deal["deal_id"])
                sources = sources_by_deal.get(deal_id, [])

                # Check if deal has EDGAR sources
                edgar_sources = [s for s in sources if s["source_name"] == "edgar"]
                non_edgar_sources = [s for s in sources if s["source_name"] != "edgar"]

                # Get EDGAR cross-reference history
                edgar_history = edgar_history_by_deal.get(deal_id)

                edgar_status = {
                    "has_edgar_filing": len(edgar_sources) > 0,
                    "edgar_filing_count": len(edgar_sources),
                    "edgar_filing_types": [s["mention_type"] for s in edgar_sources],
                    "last_edgar_search": edgar_history["changed_at"] if edgar_history else None,
                    "confidence_impact": None,
                    "filings_found_in_last_search": 0,
                }

                # Extract confidence impact from last search
                if edgar_history and edgar_history["new_value"]:
                    new_val = dict(edgar_history["new_value"])
                    edgar_status["confidence_impact"] = new_val.get("confidence_impact", 0)
                    edgar_status["filings_found_in_last_search"] = new_val.get("filings_found", 0)

                # Get earliest source published date (when the original article/filing was published)
                source_published_dates = [s["source_published_at"] for s in sources if s.get("source_published_at")]
                earliest_published_at = min(source_published_dates) if source_published_dates else None

                results.append({
                    "deal_id": deal_id,
                    "target_name": deal["target_name"],
                    "target_ticker": deal["target_ticker"],
                    "acquirer_name": deal["acquirer_name"],
                    "acquirer_ticker": deal["acquirer_ticker"],
                    "deal_tier": deal["deal_tier"],
                    "deal_status": deal["deal_status"],
                    "deal_value": float(deal["deal_value"]) if deal["deal_value"] else None,
                    "deal_type": deal["deal_type"],
                    "confidence_score": float(deal["confidence_score"]),
                    "source_count": deal["source_count"],
                    "first_detected_at": convert_to_cst(deal["first_detected_at"]),
                    "last_updated_source_at": convert_to_cst(deal["last_updated_source_at"]),
                    "promoted_to_rumored_at": convert_to_cst(deal["promoted_to_rumored_at"]),
                    "promoted_to_active_at": convert_to_cst(deal["promoted_to_active_at"]),
                    "source_published_at": convert_to_cst(earliest_published_at),
                    "edgar_status": edgar_status,
                    "source_breakdown": {
                        "total": len(sources),
                        "edgar": len(edgar_sources),
                        "non_edgar": len(non_edgar_sources),
                    }
                })

            result = {"deals": results, "total": len(results)}

            # Update cache with fresh data
            _rumored_deals_cache["data"] = result
            _rumored_deals_cache["cache_key"] = cache_key
            _rumored_deals_cache["timestamp"] = current_time

            return result

    finally:
        await db.pool.release(conn)


@router.get("/deals/{deal_id}/research")
async def get_deal_research(deal_id: str):
    """Get research report for a specific deal"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            research = await conn.fetchrow(
                '''SELECT research_id, deal_id, report_markdown, extracted_deal_terms,
                          target_ticker, go_shop_end_date, vote_risk, finance_risk, legal_risk,
                          status, error_message, created_at, completed_at
                   FROM deal_research
                   WHERE deal_id = $1
                   ORDER BY created_at DESC
                   LIMIT 1''',
                deal_id
            )

            if not research:
                raise HTTPException(status_code=404, detail="No research found for this deal")

            # Convert to dict and handle JSON parsing
            import json
            result = dict(research)
            if result['extracted_deal_terms']:
                result['extracted_deal_terms'] = json.loads(result['extracted_deal_terms'])

            return result

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


# ============================================================================
# Rumor Watch List Endpoints
# ============================================================================

class WatchListItem(BaseModel):
    id: int
    ticker: str
    company_name: Optional[str]
    added_at: str
    notes: Optional[str]
    is_active: bool
    last_checked_at: Optional[str]


class AddToWatchListRequest(BaseModel):
    ticker: str
    company_name: Optional[str] = None
    notes: Optional[str] = None


class WatchListResponse(BaseModel):
    success: bool
    message: str
    watch_list: List[WatchListItem]


class AddToWatchListResponse(BaseModel):
    success: bool
    message: str
    item: WatchListItem


@router.get("/watch-list", response_model=WatchListResponse)
async def get_watch_list():
    """Get all active tickers in the rumor watch list"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            rows = await conn.fetch(
                """
                SELECT id, ticker, company_name, added_at, notes, is_active, last_checked_at
                FROM rumor_watch_list
                WHERE is_active = TRUE
                ORDER BY added_at DESC
                """
            )

            watch_list = [
                WatchListItem(
                    id=row['id'],
                    ticker=row['ticker'],
                    company_name=row['company_name'],
                    added_at=convert_to_cst(row['added_at']),
                    notes=row['notes'],
                    is_active=row['is_active'],
                    last_checked_at=convert_to_cst(row['last_checked_at']) if row['last_checked_at'] else None
                )
                for row in rows
            ]

            return WatchListResponse(
                success=True,
                message=f"Found {len(watch_list)} tickers in watch list",
                watch_list=watch_list
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.post("/watch-list/add", response_model=AddToWatchListResponse)
async def add_to_watch_list(request: AddToWatchListRequest):
    """Add a ticker to the rumor watch list"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Check if ticker already exists (active or inactive)
            existing = await conn.fetchrow(
                "SELECT id, is_active FROM rumor_watch_list WHERE ticker = $1",
                request.ticker.upper()
            )

            if existing:
                if existing['is_active']:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Ticker {request.ticker} is already in watch list"
                    )
                else:
                    # Reactivate the ticker
                    await conn.execute(
                        """UPDATE rumor_watch_list
                           SET is_active = TRUE, added_at = NOW(), updated_at = NOW(),
                               company_name = COALESCE($2, company_name),
                               notes = COALESCE($3, notes)
                           WHERE id = $1""",
                        existing['id'], request.company_name, request.notes
                    )
                    item_id = existing['id']
            else:
                # Insert new ticker
                item_id = await conn.fetchval(
                    """INSERT INTO rumor_watch_list (ticker, company_name, notes)
                       VALUES ($1, $2, $3)
                       RETURNING id""",
                    request.ticker.upper(), request.company_name, request.notes
                )

            # Fetch the complete item
            row = await conn.fetchrow(
                """SELECT id, ticker, company_name, added_at, notes, is_active, last_checked_at
                   FROM rumor_watch_list WHERE id = $1""",
                item_id
            )

            item = WatchListItem(
                id=row['id'],
                ticker=row['ticker'],
                company_name=row['company_name'],
                added_at=convert_to_cst(row['added_at']),
                notes=row['notes'],
                is_active=row['is_active'],
                last_checked_at=convert_to_cst(row['last_checked_at']) if row['last_checked_at'] else None
            )

            return AddToWatchListResponse(
                success=True,
                message=f"Added {request.ticker} to watch list",
                item=item
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.delete("/watch-list/{ticker}")
async def remove_from_watch_list(ticker: str):
    """Remove a ticker from the watch list (soft delete)"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            result = await conn.execute(
                """UPDATE rumor_watch_list
                   SET is_active = FALSE, updated_at = NOW()
                   WHERE ticker = $1 AND is_active = TRUE""",
                ticker.upper()
            )

            if result == "UPDATE 0":
                raise HTTPException(
                    status_code=404,
                    detail=f"Ticker {ticker} not found in watch list"
                )

            return {
                "success": True,
                "message": f"Removed {ticker} from watch list"
            }

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


# ============================================================================
# Update Intelligence Deal Ticker
# ============================================================================

class UpdateTickerRequest(BaseModel):
    ticker: Optional[str] = None


class UpdateTickerResponse(BaseModel):
    success: bool
    message: str
    deal_id: str
    ticker: Optional[str]


@router.patch("/deals/{deal_id}/ticker", response_model=UpdateTickerResponse)
async def update_deal_ticker(deal_id: str, request: UpdateTickerRequest):
    """Update the target ticker for an intelligence deal"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Verify deal exists
            deal = await conn.fetchrow(
                "SELECT deal_id, target_name FROM deal_intelligence WHERE deal_id = $1",
                deal_id
            )

            if not deal:
                raise HTTPException(status_code=404, detail="Deal not found")

            # Update ticker
            ticker = request.ticker.upper().strip() if request.ticker else None

            await conn.execute(
                """UPDATE deal_intelligence
                   SET target_ticker = $2, updated_at = NOW()
                   WHERE deal_id = $1""",
                deal_id, ticker
            )

            return UpdateTickerResponse(
                success=True,
                message=f"Updated ticker for {deal['target_name']}",
                deal_id=deal_id,
                ticker=ticker
            )

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


# ============================================================================
# All Articles - Monitor Performance Visibility
# ============================================================================

@router.get("/sources")
async def get_all_sources(
    days: int = None,
    source_name: Optional[str] = None,
    min_confidence: float = 0.0,
    limit: int = 10
):
    """
    Get all monitored sources (articles) that were detected as M&A-relevant.
    This helps verify monitors are working correctly and identify potential false negatives.

    Similar to EDGAR's "All Filings" tab, but for intelligence sources.
    Shows the most recent M&A-relevant articles from all monitors, grouped by source.

    Params:
    - days: Look back this many days (optional - if not provided, shows most recent regardless of date)
    - source_name: Filter by specific source (e.g., 'reuters_ma', 'seeking_alpha_ma')
    - min_confidence: Minimum credibility score (0.0-1.0)
    - limit: Max articles per source (default 10)
    """
    db = await get_db_pool()

    conn = await db.pool.acquire()
    try:
        # Build query to get all sources from deal_sources table
        # Use a window function to get the top N most recent per source
        query = """
            WITH ranked_sources AS (
                SELECT
                    source_id,
                    deal_id,
                    source_name,
                    source_type,
                    source_url,
                    mention_type,
                    headline,
                    content_snippet,
                    credibility_score,
                    source_published_at,
                    detected_at,
                    ROW_NUMBER() OVER (PARTITION BY source_name ORDER BY detected_at DESC) as rn
                FROM deal_sources
                WHERE 1=1
        """

        params = []
        param_index = 1

        if days is not None:
            query += f" AND detected_at >= NOW() - INTERVAL '{days} days'"

        if source_name:
            query += f" AND source_name = ${param_index}"
            params.append(source_name)
            param_index += 1

        if min_confidence > 0:
            query += f" AND credibility_score >= ${param_index}"
            params.append(min_confidence)
            param_index += 1

        query += f"""
            )
            SELECT
                source_id, deal_id, source_name, source_type, source_url,
                mention_type, headline, content_snippet, credibility_score,
                source_published_at, detected_at
            FROM ranked_sources
            WHERE rn <= ${param_index}
            ORDER BY source_name, detected_at DESC
        """
        params.append(limit)

        sources = await conn.fetch(query, *params)

        # Group sources by source_name (window function already limited to N per source)
        sources_by_type = {}
        for source in sources:
            src_name = source['source_name']
            if src_name not in sources_by_type:
                sources_by_type[src_name] = []

            sources_by_type[src_name].append({
                'source_id': str(source['source_id']),
                'deal_id': str(source['deal_id']) if source['deal_id'] else None,
                'source_name': source['source_name'],
                'source_type': source['source_type'],
                'source_url': source['source_url'],
                'mention_type': source['mention_type'],
                'headline': source['headline'],
                'content_snippet': source['content_snippet'],
                'credibility_score': float(source['credibility_score']) if source['credibility_score'] else 0.0,
                'source_published_at': convert_to_cst(source['source_published_at']) if source['source_published_at'] else None,
                'detected_at': convert_to_cst(source['detected_at'])
            })

        # Get monitor stats from source_monitors table
        monitor_stats = await conn.fetch(
            """
            SELECT
                source_name,
                last_check_at,
                last_success_at,
                last_article_count,
                total_checks,
                total_articles_fetched,
                total_ma_mentions_found,
                is_enabled,
                check_interval_seconds
            FROM source_monitors
            ORDER BY source_name
            """
        )

        stats_by_source = {
            row['source_name']: {
                'last_check_at': convert_to_cst(row['last_check_at']) if row['last_check_at'] else None,
                'last_success_at': convert_to_cst(row['last_success_at']) if row['last_success_at'] else None,
                'last_article_count': row['last_article_count'],
                'total_checks': row['total_checks'],
                'total_articles_fetched': row['total_articles_fetched'],
                'total_ma_mentions_found': row['total_ma_mentions_found'],
                'is_enabled': row['is_enabled'],
                'check_interval_seconds': row['check_interval_seconds']
            }
            for row in monitor_stats
        }

        return {
            'sources_by_type': sources_by_type,
            'monitor_stats': stats_by_source,
            'total_sources': sum(len(sources) for sources in sources_by_type.values()),
            'filters': {
                'days': days,
                'source_name': source_name,
                'min_confidence': min_confidence,
                'limit_per_source': limit
            }
        }

    finally:
        await db.pool.release(conn)


@router.get("/articles/recent")
async def get_recent_scanned_articles_endpoint():
    """
    Get recent scanned articles from all monitors (for debugging filter performance).

    This endpoint shows ALL articles that monitors fetched in their most recent scan,
    along with whether each article passed the M&A relevance filter.

    Unlike /sources which shows M&A-relevant articles from the database,
    this shows the raw scan results including articles that were filtered out.

    Returns:
        - status: "running" or "not_running"
        - monitors: List of monitor scan results
            - source_name: Monitor name (e.g., "seeking_alpha_ma")
            - source_type: Type of source ("news", "official", etc.)
            - last_scan_time: When the monitor last scanned
            - articles: List of scanned articles with filter results
                - title: Article headline
                - url: Article link
                - is_ma_relevant: Whether it passed M&A filter
                - target_name: Extracted target company (if relevant)
                - acquirer_name: Extracted acquirer (if relevant)
                - scanned_at: When this article was scanned
            - total_scanned: Total articles in last scan
            - ma_relevant_count: How many passed M&A filter
    """
    result = await get_recent_scanned_articles()
    return result
