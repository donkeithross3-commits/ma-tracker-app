"""API routes for M&A Intelligence Platform"""
from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.edgar.database import EdgarDatabase
from app.intelligence.orchestrator import (
    start_intelligence_monitoring,
    stop_intelligence_monitoring,
    is_intelligence_monitoring_running,
    get_monitoring_stats,
)

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# Global database pool - created once and reused
_db_pool: Optional[EdgarDatabase] = None


async def get_db_pool() -> EdgarDatabase:
    """Get or create the global database pool"""
    global _db_pool
    if _db_pool is None:
        _db_pool = EdgarDatabase()
        await _db_pool.connect()
    return _db_pool


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
async def get_deals(tier: Optional[str] = None, limit: int = 100):
    """Get all deals from intelligence system, optionally filtered by tier"""
    db = EdgarDatabase()
    await db.connect()

    try:
        query = """
            SELECT deal_id, target_name, target_ticker, acquirer_name, acquirer_ticker,
                   deal_tier, deal_status, deal_value, deal_type,
                   confidence_score, source_count,
                   first_detected_at, last_updated_source_at,
                   promoted_to_rumored_at, promoted_to_active_at
            FROM deal_intelligence
        """

        params = []
        if tier:
            query += " WHERE deal_tier = $1"
            params.append(tier)

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
                    firstDetectedAt=deal["first_detected_at"],
                    lastUpdatedSourceAt=deal.get("last_updated_source_at"),
                    promotedToRumoredAt=deal.get("promoted_to_rumored_at"),
                    promotedToActiveAt=deal.get("promoted_to_active_at"),
                ))

            return results
        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


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
                    createdAt=s["created_at"],
                    updatedAt=s["updated_at"],
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
                    lastActivityAt=ticker.get("last_activity_at"),
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
async def get_rumored_deals_with_edgar_status():
    """
    Get all rumored and watchlist deals with their EDGAR confirmation status.

    This shows:
    - Deals from non-regulatory sources (news, social media)
    - Whether EDGAR filings were found to corroborate
    - Confidence score and how EDGAR impacted it
    - When EDGAR was last searched
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get all rumored/watchlist deals
            deals = await conn.fetch(
                """
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
                ORDER BY di.confidence_score DESC, di.first_detected_at DESC
                """
            )

            results = []
            for deal in deals:
                deal_id = str(deal["deal_id"])

                # Get sources breakdown
                sources = await conn.fetch(
                    """
                    SELECT source_name, source_type, mention_type, credibility_score
                    FROM deal_sources
                    WHERE deal_id = $1
                    ORDER BY detected_at DESC
                    """,
                    deal_id
                )

                # Check if deal has EDGAR sources
                edgar_sources = [s for s in sources if s["source_name"] == "edgar"]
                non_edgar_sources = [s for s in sources if s["source_name"] != "edgar"]

                # Get EDGAR cross-reference history from deal_history
                edgar_searches = await conn.fetch(
                    """
                    SELECT
                        changed_at,
                        old_value,
                        new_value,
                        notes
                    FROM deal_history
                    WHERE deal_id = $1 AND change_type = 'edgar_cross_reference'
                    ORDER BY changed_at DESC
                    LIMIT 1
                    """,
                    deal_id
                )

                edgar_status = {
                    "has_edgar_filing": len(edgar_sources) > 0,
                    "edgar_filing_count": len(edgar_sources),
                    "edgar_filing_types": [s["mention_type"] for s in edgar_sources],
                    "last_edgar_search": edgar_searches[0]["changed_at"] if edgar_searches else None,
                    "confidence_impact": None,
                    "filings_found_in_last_search": 0,
                }

                # Extract confidence impact from last search
                if edgar_searches:
                    search_data = edgar_searches[0]
                    if search_data["new_value"]:
                        new_val = dict(search_data["new_value"])
                        edgar_status["confidence_impact"] = new_val.get("confidence_impact", 0)
                        edgar_status["filings_found_in_last_search"] = new_val.get("filings_found", 0)

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
                    "first_detected_at": deal["first_detected_at"],
                    "last_updated_source_at": deal["last_updated_source_at"],
                    "promoted_to_rumored_at": deal["promoted_to_rumored_at"],
                    "promoted_to_active_at": deal["promoted_to_active_at"],
                    "edgar_status": edgar_status,
                    "source_breakdown": {
                        "total": len(sources),
                        "edgar": len(edgar_sources),
                        "non_edgar": len(non_edgar_sources),
                    }
                })

            return {"deals": results, "total": len(results)}

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


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
