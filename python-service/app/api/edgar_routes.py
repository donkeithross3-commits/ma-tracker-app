"""API routes for EDGAR monitoring and staged deals management"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Body
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime
import logging
import json
import time

from app.edgar.database import EdgarDatabase
from app.edgar.orchestrator import (
    start_edgar_monitoring,
    stop_edgar_monitoring,
    is_edgar_monitoring_running
)
from app.edgar.research_worker import (
    start_research_worker,
    stop_research_worker,
    is_research_worker_running
)
from app.edgar.deal_research_generator import create_research_generator
from app.utils.timezone import convert_to_cst

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/edgar", tags=["edgar"])

# Simple in-memory cache for staged deals with 30-second TTL
# This dramatically speeds up repeated loads while keeping data fresh
_staged_deals_cache: Dict[str, Any] = {
    "data": None,
    "timestamp": 0,
    "ttl": 30  # seconds
}

def invalidate_staged_deals_cache():
    """Invalidate the staged deals cache when data changes"""
    _staged_deals_cache["data"] = None
    _staged_deals_cache["timestamp"] = 0


async def generate_and_store_research(deal_id: str, deal_info: dict, filing_url: str, db: EdgarDatabase):
    """Background task to generate and store research for a deal"""
    try:
        logger.info(f"Starting research generation for deal {deal_id}")

        # Create research generator
        generator = create_research_generator()

        # Generate research
        result = await generator.generate_research(deal_info, filing_url)

        # Get database connection
        conn = await db.pool.acquire()
        try:
            if result['success']:
                extracted_data = result['extracted_data']

                # Store research in database
                await conn.execute(
                    '''INSERT INTO deal_research
                       (deal_id, report_markdown, extracted_deal_terms,
                        target_ticker, go_shop_end_date, vote_risk, finance_risk, legal_risk,
                        status, completed_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())''',
                    deal_id,
                    result['markdown_report'],
                    json.dumps(extracted_data),
                    extracted_data.get('deal_terms', {}).get('target_ticker'),
                    extracted_data.get('go_shop_provision', {}).get('go_shop_end_date'),
                    extracted_data.get('risk_assessment', {}).get('vote_risk'),
                    extracted_data.get('risk_assessment', {}).get('finance_risk'),
                    extracted_data.get('risk_assessment', {}).get('legal_risk'),
                    'completed'
                )
                logger.info(f"Research stored successfully for deal {deal_id}")
            else:
                # Store error
                await conn.execute(
                    '''INSERT INTO deal_research
                       (deal_id, status, error_message, created_at)
                       VALUES ($1, $2, $3, NOW())''',
                    deal_id,
                    'failed',
                    result.get('error', 'Unknown error')
                )
                logger.error(f"Research generation failed for deal {deal_id}: {result.get('error')}")
        finally:
            await db.pool.release(conn)

    except Exception as e:
        logger.error(f"Failed to generate/store research for deal {deal_id}: {e}", exc_info=True)


class EdgarStatusResponse(BaseModel):
    is_running: bool
    message: str


class StagedDealResponse(BaseModel):
    id: str
    targetName: str
    targetTicker: Optional[str]
    acquirerName: Optional[str]
    dealValue: Optional[float]
    dealType: Optional[str]
    confidenceScore: Optional[float]
    status: str
    researchStatus: str
    detectedAt: datetime
    filingDate: datetime
    filingType: str
    filingUrl: str
    matchedTextExcerpt: Optional[str] = None
    rejectionCategory: Optional[str] = None
    rejectionReason: Optional[str] = None


class ApprovalRequest(BaseModel):
    action: str  # "approve" or "reject"
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None  # Free-text reason for rejection
    rejection_category: Optional[str] = None  # Structured category: not_ma, duplicate, wrong_company, regulatory_only, incomplete, other


@router.post("/monitoring/start", response_model=EdgarStatusResponse)
async def start_monitoring():
    """Start EDGAR real-time monitoring"""
    try:
        if is_edgar_monitoring_running():
            return EdgarStatusResponse(
                is_running=True,
                message="EDGAR monitoring is already running"
            )

        await start_edgar_monitoring()

        return EdgarStatusResponse(
            is_running=True,
            message="EDGAR monitoring started successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start monitoring: {str(e)}")


@router.post("/monitoring/stop", response_model=EdgarStatusResponse)
async def stop_monitoring():
    """Stop EDGAR monitoring"""
    try:
        await stop_edgar_monitoring()

        return EdgarStatusResponse(
            is_running=False,
            message="EDGAR monitoring stopped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop monitoring: {str(e)}")


@router.get("/monitoring/status", response_model=EdgarStatusResponse)
async def get_monitoring_status():
    """Get current monitoring status"""
    is_running = is_edgar_monitoring_running()

    return EdgarStatusResponse(
        is_running=is_running,
        message="Running" if is_running else "Stopped"
    )


@router.get("/staged-deals", response_model=List[StagedDealResponse])
async def get_staged_deals(status: Optional[str] = None):
    """Get all staged deals, optionally filtered by status"""
    # Check cache first
    cache_key = f"status_{status}"
    current_time = time.time()

    if (_staged_deals_cache.get("cache_key") == cache_key and
        _staged_deals_cache["data"] is not None and
        current_time - _staged_deals_cache["timestamp"] < _staged_deals_cache["ttl"]):
        logger.debug(f"Returning cached staged deals (age: {current_time - _staged_deals_cache['timestamp']:.1f}s)")
        return _staged_deals_cache["data"]

    # Cache miss or expired - fetch from database
    from ..main import get_db
    db = get_db()

    deals = await db.list_staged_deals(status=status)

    results = []
    for deal in deals:
        results.append(StagedDealResponse(
            id=deal["staged_deal_id"],
            targetName=deal["target_name"],
            targetTicker=deal.get("target_ticker"),
            acquirerName=deal.get("acquirer_name"),
            dealValue=float(deal["deal_value"]) if deal.get("deal_value") else None,
            dealType=deal.get("deal_type"),
            confidenceScore=deal.get("confidence_score"),
            status=deal["status"],
            researchStatus=deal.get("researchStatus") or deal.get("researchstatus"),
            detectedAt=convert_to_cst(deal["detected_at"]),
            filingDate=convert_to_cst(deal["filing_date"]),
            filingType=deal["filing_type"],
            filingUrl=deal["filing_url"],
            matchedTextExcerpt=deal.get("matched_text_excerpt"),
            rejectionCategory=deal.get("rejection_category"),
            rejectionReason=deal.get("rejection_reason")
        ))

    # Update cache
    _staged_deals_cache["data"] = results
    _staged_deals_cache["cache_key"] = cache_key
    _staged_deals_cache["timestamp"] = current_time
    logger.debug(f"Cached {len(results)} staged deals")

    return results


@router.get("/staged-deals/{deal_id}", response_model=StagedDealResponse)
async def get_staged_deal(deal_id: str):
    """Get a specific staged deal by ID"""
    db = EdgarDatabase()
    await db.connect()

    try:
        deal = await db.get_staged_deal(deal_id)

        if not deal:
            raise HTTPException(status_code=404, detail="Staged deal not found")

        return StagedDealResponse(
            id=deal["staged_deal_id"],
            targetName=deal["target_name"],
            targetTicker=deal.get("target_ticker"),
            acquirerName=deal.get("acquirer_name"),
            dealValue=float(deal["deal_value"]) if deal.get("deal_value") else None,
            dealType=deal.get("deal_type"),
            confidenceScore=deal.get("confidence_score"),
            status=deal["status"],
            researchStatus=deal.get("researchStatus") or deal.get("researchstatus"),
            detectedAt=convert_to_cst(deal["detected_at"]),
            filingDate=convert_to_cst(deal["filing_date"]),
            filingType=deal["filing_type"],
            filingUrl=deal["filing_url"],
            matchedTextExcerpt=deal.get("matched_text_excerpt"),
            rejectionCategory=deal.get("rejection_category"),
            rejectionReason=deal.get("rejection_reason")
        )

    finally:
        await db.disconnect()


@router.post("/staged-deals/{deal_id}/review")
async def review_staged_deal(deal_id: str, request: ApprovalRequest):
    """Approve or reject a staged deal"""
    db = EdgarDatabase()
    await db.connect()

    try:
        if request.action == "approve":
            # Get staged deal info with filing details
            conn = await db.pool.acquire()
            try:
                deal = await conn.fetchrow(
                    '''SELECT sd.*, ef.filing_type, ef.filing_url, ef.filing_date
                       FROM staged_deals sd
                       JOIN edgar_filings ef ON sd.source_filing_id = ef.filing_id
                       WHERE sd.staged_deal_id = $1''',
                    deal_id
                )

                if not deal:
                    raise HTTPException(status_code=404, detail=f"Staged deal {deal_id} not found")

                # Check if intelligence deal already exists for this target
                existing_deal = await conn.fetchrow(
                    '''SELECT deal_id FROM deal_intelligence
                       WHERE LOWER(target_name) = LOWER($1)
                       AND deal_status NOT IN ('completed', 'terminated')
                       LIMIT 1''',
                    deal['target_name']
                )

                intelligence_deal_id = None

                if existing_deal:
                    # Use existing intelligence deal
                    intelligence_deal_id = existing_deal['deal_id']

                    # Add EDGAR filing as a source if not already there
                    # Check if source already exists
                    existing_source = await conn.fetchval(
                        'SELECT source_id FROM deal_sources WHERE deal_id = $1 AND source_url = $2',
                        intelligence_deal_id, deal['filing_url']
                    )

                    if not existing_source:
                        await conn.execute(
                            '''INSERT INTO deal_sources
                               (deal_id, source_name, source_type, source_url, mention_type, headline, content_snippet, detected_at)
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)''',
                            intelligence_deal_id,
                            'EDGAR',
                            'official',
                            deal['filing_url'],
                            'filing',
                            f"{deal['filing_type']} filing for {deal['target_name']}",
                            f"EDGAR filing detected: {deal['target_name']} - {deal['filing_type']}",
                            deal['detected_at']
                        )

                    # Update source count and confidence
                    await conn.execute(
                        '''UPDATE deal_intelligence
                           SET source_count = (SELECT COUNT(*) FROM deal_sources WHERE deal_id = $1),
                               confidence_score = GREATEST(confidence_score, 0.85),
                               updated_at = NOW()
                           WHERE deal_id = $1''',
                        intelligence_deal_id
                    )
                else:
                    # Create new intelligence deal
                    intelligence_deal_id = await conn.fetchval(
                        '''INSERT INTO deal_intelligence
                           (target_name, target_ticker, acquirer_name, deal_tier, deal_status,
                            deal_type, deal_value, confidence_score, source_count,
                            first_detected_at, created_at, updated_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
                           RETURNING deal_id''',
                        deal['target_name'],
                        deal['target_ticker'],
                        deal['acquirer_name'],
                        'rumored',  # Start as rumored, will be upgraded with more sources
                        'rumored',  # Valid status: rumored, announced, pending_approval, in_progress, completed, terminated
                        deal['deal_type'],
                        deal['deal_value'],
                        0.85,  # High confidence from EDGAR
                        1,
                        deal['detected_at']
                    )

                    # Add EDGAR filing as the first source
                    await conn.execute(
                        '''INSERT INTO deal_sources
                           (deal_id, source_name, source_type, source_url, mention_type, headline, content_snippet, detected_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)''',
                        intelligence_deal_id,
                        'EDGAR',
                        'official',
                        deal['filing_url'],
                        'filing',
                        f"{deal['filing_type']} filing for {deal['target_name']}",
                        f"EDGAR filing detected: {deal['target_name']} - {deal['filing_type']}",
                        deal['detected_at']
                    )

                # Update staged deal status
                await conn.execute(
                    '''UPDATE staged_deals
                       SET status = 'approved', reviewed_at = NOW(),
                           approved_deal_id = $2, updated_at = NOW()
                       WHERE staged_deal_id = $1''',
                    deal_id, str(intelligence_deal_id)
                )

                # Generate research report for the deal
                deal_info = {
                    "target_name": deal['target_name'],
                    "acquirer_name": deal.get('acquirer_name'),
                    "deal_value": deal.get('deal_value'),
                    "filing_type": deal['filing_type']
                }

                # Trigger research generation (async, but we wait for it)
                logger.info(f"Triggering research generation for deal {intelligence_deal_id}")
                await generate_and_store_research(
                    str(intelligence_deal_id),
                    deal_info,
                    deal['filing_url'],
                    db
                )

                # Invalidate cache since we modified staged deals
                invalidate_staged_deals_cache()

                return {
                    "status": "approved",
                    "dealId": str(intelligence_deal_id),
                    "message": f"Deal approved and added to intelligence tracking (ID: {intelligence_deal_id})"
                }
            finally:
                await db.pool.release(conn)

        elif request.action == "reject":
            await db.reject_staged_deal(
                deal_id,
                rejection_reason=request.rejection_reason,
                rejection_category=request.rejection_category
            )

            # Invalidate cache since we modified staged deals
            invalidate_staged_deals_cache()

            return {
                "status": "rejected",
                "message": "Deal rejected and removed from queue"
            }

        else:
            raise HTTPException(status_code=400, detail="Invalid action. Must be 'approve' or 'reject'")

    finally:
        await db.disconnect()


@router.get("/filings/recent")
async def get_recent_filings(limit: int = 50, ma_relevant_only: bool = False):
    """Get recent EDGAR filings"""
    db = EdgarDatabase()
    await db.connect()

    try:
        filings = await db.list_recent_filings(limit=limit, ma_relevant_only=ma_relevant_only)
        return filings

    finally:
        await db.disconnect()


@router.post("/research-worker/start", response_model=EdgarStatusResponse)
async def start_research():
    """Start research worker"""
    try:
        if is_research_worker_running():
            return EdgarStatusResponse(
                is_running=True,
                message="Research worker is already running"
            )

        await start_research_worker()

        return EdgarStatusResponse(
            is_running=True,
            message="Research worker started successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start research worker: {str(e)}")


@router.post("/research-worker/stop", response_model=EdgarStatusResponse)
async def stop_research():
    """Stop research worker"""
    try:
        await stop_research_worker()

        return EdgarStatusResponse(
            is_running=False,
            message="Research worker stopped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop research worker: {str(e)}")


@router.get("/research-worker/status", response_model=EdgarStatusResponse)
async def get_research_status():
    """Get research worker status"""
    is_running = is_research_worker_running()

    return EdgarStatusResponse(
        is_running=is_running,
        message="Running" if is_running else "Stopped"
    )


@router.post("/staged-deals/{deal_id}/unapprove")
async def unapprove_staged_deal(deal_id: str):
    """Unapprove a deal and send it back to staging area"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get the staged deal
            staged_deal = await conn.fetchrow(
                '''SELECT staged_deal_id, status, approved_deal_id, target_name
                   FROM staged_deals
                   WHERE staged_deal_id = $1''',
                deal_id
            )

            if not staged_deal:
                raise HTTPException(status_code=404, detail=f"Staged deal {deal_id} not found")

            if staged_deal['status'] != 'approved':
                raise HTTPException(
                    status_code=400,
                    detail=f"Deal is not approved (current status: {staged_deal['status']})"
                )

            # Reset staged deal to pending
            await conn.execute(
                '''UPDATE staged_deals
                   SET status = 'pending',
                       approved_deal_id = NULL,
                       reviewed_at = NULL,
                       reviewed_by = NULL,
                       updated_at = NOW()
                   WHERE staged_deal_id = $1''',
                deal_id
            )

            logger.info(f"Unapproved staged deal {deal_id} (target: {staged_deal['target_name']})")

            # Invalidate cache since we modified staged deals
            invalidate_staged_deals_cache()

            return {
                "status": "success",
                "message": f"Deal sent back to staging area",
                "dealId": deal_id,
                "targetName": staged_deal['target_name']
            }

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.post("/intelligence-deals/{intelligence_deal_id}/unapprove")
async def unapprove_intelligence_deal(intelligence_deal_id: str):
    """Unapprove an intelligence deal by resetting all associated staged deals back to pending"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Check if intelligence deal exists
            intelligence_deal = await conn.fetchrow(
                '''SELECT deal_id, target_name FROM deal_intelligence WHERE deal_id = $1''',
                intelligence_deal_id
            )

            if not intelligence_deal:
                raise HTTPException(status_code=404, detail=f"Intelligence deal {intelligence_deal_id} not found")

            # Find all staged deals that reference this intelligence deal
            staged_deals = await conn.fetch(
                '''SELECT staged_deal_id, target_name FROM staged_deals
                   WHERE approved_deal_id = $1 AND status = 'approved' ''',
                intelligence_deal_id
            )

            if not staged_deals:
                raise HTTPException(
                    status_code=400,
                    detail=f"No approved staged deals found for intelligence deal {intelligence_deal_id}"
                )

            # Reset all staged deals to pending
            await conn.execute(
                '''UPDATE staged_deals
                   SET status = 'pending',
                       approved_deal_id = NULL,
                       reviewed_at = NULL,
                       reviewed_by = NULL,
                       updated_at = NOW()
                   WHERE approved_deal_id = $1 AND status = 'approved' ''',
                intelligence_deal_id
            )

            reset_count = len(staged_deals)
            logger.info(f"Unapproved {reset_count} staged deal(s) for intelligence deal {intelligence_deal_id} (target: {intelligence_deal['target_name']})")

            return {
                "status": "success",
                "message": f"Sent {reset_count} deal(s) back to staging area",
                "intelligenceDealId": intelligence_deal_id,
                "targetName": intelligence_deal['target_name'],
                "stagedDealsReset": reset_count
            }

        finally:
            await db.pool.release(conn)

    finally:
        await db.disconnect()


@router.post("/filings/clear")
async def clear_processed_filings():
    """Clear all processed filings from database to allow re-processing"""
    try:
        db = EdgarDatabase()
        await db.connect()

        # Count and delete all filings
        conn = await db.pool.acquire()
        try:
            count = await conn.fetchval("SELECT COUNT(*) FROM edgar_filings")
            if count > 0:
                await conn.execute("DELETE FROM edgar_filings")
                message = f"Cleared {count} processed filings. They will be re-processed on next poll."
            else:
                message = "No filings to clear"
        finally:
            await db.pool.release(conn)
            await db.disconnect()

        return {"success": True, "message": message, "cleared_count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear filings: {str(e)}")


@router.get("/rejection-analysis")
async def get_rejection_analysis():
    """Get analysis of rejection reasons for ML training and filter improvement"""
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Get aggregated stats from the view we created
            category_stats = await conn.fetch(
                "SELECT * FROM staged_deals_rejection_analysis"
            )

            # Get recent rejections with full details for training
            # EXCLUDE only: duplicate, already_in_production (these are valid detections, just redundant)
            # INCLUDE: previously_announced (key pattern to learn - historical references)
            recent_rejections = await conn.fetch(
                '''SELECT
                    target_name,
                    target_ticker,
                    acquirer_name,
                    deal_type,
                    confidence_score,
                    rejection_category,
                    rejection_reason,
                    matched_text_excerpt,
                    reviewed_at
                FROM staged_deals
                WHERE status = 'rejected'
                AND rejection_category IS NOT NULL
                AND rejection_category NOT IN ('duplicate', 'already_in_production')
                ORDER BY reviewed_at DESC
                LIMIT 100'''
            )

            # Get most common rejection patterns
            # EXCLUDE only: duplicate, already_in_production (these are valid detections, just redundant)
            # INCLUDE: previously_announced (key pattern to learn - historical references)
            common_patterns = await conn.fetch(
                '''SELECT
                    rejection_category,
                    rejection_reason,
                    COUNT(*) as count,
                    AVG(confidence_score) as avg_confidence
                FROM staged_deals
                WHERE status = 'rejected'
                AND rejection_reason IS NOT NULL
                AND rejection_category NOT IN ('duplicate', 'already_in_production')
                GROUP BY rejection_category, rejection_reason
                HAVING COUNT(*) > 1
                ORDER BY count DESC
                LIMIT 20'''
            )

            return {
                "summary": [dict(row) for row in category_stats],
                "recent_rejections": [dict(row) for row in recent_rejections],
                "common_patterns": [dict(row) for row in common_patterns],
                "total_rejections": len(recent_rejections)
            }

        finally:
            await db.pool.release(conn)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get rejection analysis: {str(e)}")
    finally:
        await db.disconnect()


@router.get("/filings")
async def get_analyzed_filings(
    status: str = "all",  # all, relevant, not_relevant
    days: int = 7,
    min_keywords: int = 0,
    min_confidence: float = 0.0,
    ticker: str = None  # Optional ticker search
):
    """Get analyzed EDGAR filings for review and tuning

    This endpoint provides visibility into what the detector is analyzing
    so users can tune the filtering logic based on actual results.
    Supports optional ticker search across all filings in database.
    """
    db = EdgarDatabase()
    await db.connect()

    try:
        conn = await db.pool.acquire()
        try:
            # Build WHERE clause based on filters
            where_clauses = []
            params = []

            # Date filter
            params.append(days)
            where_clauses.append(f"filing_date >= NOW() - make_interval(days => ${len(params)})")

            # Status filter
            if status == "relevant":
                where_clauses.append("is_ma_relevant = true")
            elif status == "not_relevant":
                where_clauses.append("is_ma_relevant = false")

            # Keyword count filter
            if min_keywords > 0:
                params.append(min_keywords)
                where_clauses.append(f"COALESCE(array_length(detected_keywords, 1), 0) >= ${len(params)}")

            # Confidence filter
            if min_confidence > 0:
                params.append(min_confidence)
                where_clauses.append(f"confidence_score >= ${len(params)}")

            # Ticker search filter (case-insensitive, partial match)
            if ticker:
                params.append(f"%{ticker.upper()}%")
                where_clauses.append(f"UPPER(ticker) LIKE ${len(params)}")

            where_clause = " AND ".join(where_clauses)

            query = f'''
                SELECT
                    filing_id,
                    accession_number,
                    company_name,
                    ticker,
                    filing_type,
                    filing_date,
                    filing_url,
                    is_ma_relevant,
                    confidence_score,
                    detected_keywords,
                    reasoning,
                    status,
                    processed_at
                FROM edgar_filings
                WHERE {where_clause}
                ORDER BY filing_date DESC, confidence_score DESC NULLS LAST
                LIMIT 500
            '''

            filings = await conn.fetch(query, *params)

            # Convert to dicts and format
            results = []
            for f in filings:
                results.append({
                    "filing_id": f["filing_id"],
                    "accession_number": f["accession_number"],
                    "company_name": f["company_name"],
                    "ticker": f["ticker"],
                    "filing_type": f["filing_type"],
                    "filing_date": f["filing_date"].isoformat() if f["filing_date"] else None,
                    "filing_url": f["filing_url"],
                    "is_ma_relevant": f["is_ma_relevant"],
                    "confidence_score": float(f["confidence_score"]) if f["confidence_score"] is not None else None,
                    "detected_keywords": f["detected_keywords"] or [],
                    "keyword_count": len(f["detected_keywords"]) if f["detected_keywords"] else 0,
                    "reasoning": f["reasoning"],
                    "status": f["status"],
                    "processed_at": f["processed_at"].isoformat() if f["processed_at"] else None,
                })

            return {
                "filings": results,
                "count": len(results),
                "filters": {
                    "status": status,
                    "days": days,
                    "min_keywords": min_keywords,
                    "min_confidence": min_confidence
                }
            }

        finally:
            await db.pool.release(conn)

    except Exception as e:
        logger.error(f"Failed to get filings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get filings: {str(e)}")
    finally:
        await db.disconnect()


@router.post("/filings/{filing_id}/create-deal")
async def create_deal_from_filing(
    filing_id: str,
    target_name: str = Body(...),
    target_ticker: Optional[str] = Body(None),
    acquirer_name: Optional[str] = Body(None),
    acquirer_ticker: Optional[str] = Body(None),
    notes: Optional[str] = Body(None)
):
    """Create a staged deal from a filing (marks filing as false negative)"""
    db = EdgarDatabase()
    await db.connect()

    try:
        # Get the filing info
        filing = await db.get_filing(filing_id)
        if not filing:
            raise HTTPException(status_code=404, detail="Filing not found")

        # Create staged deal
        staged_deal_id = await db.create_staged_deal(
            target_name=target_name,
            target_ticker=target_ticker,
            acquirer_name=acquirer_name,
            acquirer_ticker=acquirer_ticker,
            deal_value=None,
            deal_type=None,
            source_filing_id=filing_id,
            confidence_score=1.0,  # Manual confirmation = 100% confidence
            matched_text_excerpt=None
        )

        # Record as false negative
        await db.create_false_negative_record(
            filing_id=filing_id,
            staged_deal_id=staged_deal_id,
            reported_by="manual",
            notes=notes or "Manually identified from All Filings view"
        )

        logger.info(f"Created staged deal {staged_deal_id} from filing {filing_id} (false negative)")

        return {
            "staged_deal_id": staged_deal_id,
            "message": "Staged deal created and marked as false negative"
        }

    except Exception as e:
        logger.error(f"Failed to create deal from filing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await db.disconnect()
