"""Main orchestrator for EDGAR monitoring and M&A detection"""
import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from anthropic import Anthropic

from .poller import EdgarPoller
from .detector import MADetector
from .extractor import DealExtractor
from .alerts import AlertManager
from .models import EdgarFiling, AlertPayload
from .database import EdgarDatabase
from app.services.ticker_lookup import get_ticker_lookup_service

logger = logging.getLogger(__name__)


class EdgarOrchestrator:
    """Orchestrates the entire EDGAR monitoring pipeline"""

    def __init__(
        self,
        anthropic_api_key: str,
        sendgrid_api_key: Optional[str] = None,
        whatsapp_api_key: Optional[str] = None,
        whatsapp_phone_number: Optional[str] = None,
        alert_recipients: Optional[list] = None,
        poll_interval: int = 60
    ):
        self.db = EdgarDatabase()
        self.poller = EdgarPoller(poll_interval=poll_interval)
        self.detector = MADetector(anthropic_api_key=anthropic_api_key)
        self.extractor = DealExtractor(anthropic_api_key=anthropic_api_key)
        self.alert_manager = AlertManager(
            sendgrid_api_key=sendgrid_api_key,
            whatsapp_api_key=whatsapp_api_key,
            whatsapp_phone_number=whatsapp_phone_number,
            alert_recipients=alert_recipients
        )
        self.is_running = False

    async def connect(self):
        """Connect to database"""
        await self.db.connect()
        logger.info("Connected to database")

    async def disconnect(self):
        """Disconnect from database and clean up"""
        logger.info("Cleaning up EDGAR orchestrator resources...")

        try:
            await self.db.disconnect()
            logger.info("✓ Database disconnected")
        except Exception as e:
            logger.error(f"Error disconnecting database: {e}")

        try:
            await self.poller.close()
            logger.info("✓ Poller closed")
        except Exception as e:
            logger.error(f"Error closing poller: {e}")

        try:
            await self.detector.close()
            logger.info("✓ Detector closed")
        except Exception as e:
            logger.error(f"Error closing detector: {e}")

        try:
            await self.alert_manager.close()
            logger.info("✓ Alert manager closed")
        except Exception as e:
            logger.error(f"Error closing alert manager: {e}")

        logger.info("EDGAR orchestrator cleanup complete")

    async def process_filing(self, filing: EdgarFiling):
        """Process a single filing through the entire pipeline"""
        try:
            logger.info(f"Processing filing: {filing.accession_number} - {filing.company_name}")

            # Step 1: Check if we've already processed this filing
            if await self.db.filing_exists(filing.accession_number):
                logger.info(f"Filing {filing.accession_number} already processed")
                return

            # Step 2: Save filing to database (status=pending)
            filing_id = await self.db.create_filing(
                accession_number=filing.accession_number,
                cik=filing.cik,
                company_name=filing.company_name,
                ticker=filing.ticker,
                filing_type=filing.filing_type,
                filing_date=filing.filing_date,
                filing_url=filing.filing_url
            )

            # Step 3: Detect M&A relevance (with filing priority for better filtering)
            filing_priority = self.poller.get_filing_priority(filing.filing_type)
            detection_result = await self.detector.detect_ma_relevance(filing, filing_priority=filing_priority)

            # Step 4: Update filing with detection results
            await self.db.update_filing_detection(
                filing_id=filing_id,
                is_ma_relevant=detection_result.is_ma_relevant,
                confidence_score=detection_result.confidence_score,
                detected_keywords=detection_result.detected_keywords,
                reasoning=detection_result.reasoning
            )

            # Step 5: If not M&A relevant, stop here
            if not detection_result.is_ma_relevant:
                logger.info(f"Filing {filing.accession_number} not M&A relevant")
                return

            logger.info(f"M&A deal detected! Confidence: {detection_result.confidence_score:.2%}")

            # Step 6: Fetch filing text for extraction
            filing_text = await self.detector.fetch_filing_text(filing.filing_url)

            # Step 7: Extract deal information
            deal_info = await self.extractor.extract_deal_info(filing, filing_text)

            if not deal_info:
                logger.warning(f"Could not extract deal info from {filing.accession_number}")
                return

            # Step 7.5: Enrich with ticker lookups (AI often misses tickers)
            ticker_service = get_ticker_lookup_service()
            enriched = await ticker_service.enrich_deal_with_tickers(
                target_name=deal_info.target_name,
                acquirer_name=deal_info.acquirer_name,
                target_ticker=deal_info.target_ticker,
                acquirer_ticker=deal_info.acquirer_ticker
            )

            # Use enriched tickers (fallback to AI-extracted if lookup fails)
            final_target_ticker = enriched["target_ticker"] or deal_info.target_ticker
            final_acquirer_ticker = enriched["acquirer_ticker"] or deal_info.acquirer_ticker

            # Step 7.7: Reject deals with no target ticker (private companies)
            if not final_target_ticker:
                logger.info(
                    f"Rejecting deal for {deal_info.target_name}: No ticker found. "
                    f"Likely a private company acquisition. Skipping staged deal creation."
                )
                return

            # Step 7.8: Check for duplicate deals before creating
            existing_deal = await self.db.check_duplicate_deal(
                target_name=deal_info.target_name,
                acquirer_name=deal_info.acquirer_name
            )

            if existing_deal:
                logger.info(
                    f"Duplicate deal detected for {deal_info.target_name}. "
                    f"Existing deal in {existing_deal['source']} with status {existing_deal['status']}. "
                    f"Skipping creation of new staged deal."
                )
                return

            # Step 7.9: Extract matched text excerpt showing why deal was detected
            matched_excerpt = self.detector.extract_matched_text_excerpt(
                text=filing_text,
                detected_keywords=detection_result.detected_keywords
            )

            # Step 8: Create staged deal
            staged_deal_id = await self.db.create_staged_deal(
                target_name=deal_info.target_name,
                target_ticker=final_target_ticker,
                acquirer_name=deal_info.acquirer_name,
                acquirer_ticker=final_acquirer_ticker,
                deal_value=deal_info.deal_value,
                deal_type=deal_info.deal_type,
                source_filing_id=filing_id,
                confidence_score=deal_info.confidence_score,
                matched_text_excerpt=matched_excerpt
            )

            logger.info(f"Created staged deal: {staged_deal_id}")

            # Step 9: Queue research generation
            await self.db.create_research_queue(
                staged_deal_id=staged_deal_id,
                analyzer_types=["topping_bid", "antitrust", "contract"],
                priority=10  # High priority for new deals
            )

            # Step 10: Send alerts
            alert_payload = AlertPayload(
                staged_deal_id=staged_deal_id,
                target_name=deal_info.target_name,
                acquirer_name=deal_info.acquirer_name,
                deal_value=deal_info.deal_value,
                filing_type=filing.filing_type,
                confidence_score=deal_info.confidence_score,
                filing_url=filing.filing_url,
                detected_at=datetime.now()
            )

            alert_results = await self.alert_manager.send_all_alerts(alert_payload)

            # Step 11: Mark alert as sent
            await self.db.update_staged_deal_alert(staged_deal_id)

            logger.info(f"Alerts sent for deal {staged_deal_id}: {alert_results}")

        except Exception as e:
            logger.error(f"Error processing filing {filing.accession_number}: {e}", exc_info=True)

    async def run(self):
        """Start the EDGAR monitoring loop"""
        logger.info("Starting EDGAR orchestrator")
        self.is_running = True

        try:
            await self.connect()

            # Start polling with our process_filing callback
            await self.poller.start_polling(callback=self.process_filing)

        except Exception as e:
            logger.error(f"Orchestrator error: {e}", exc_info=True)
        finally:
            await self.disconnect()

    async def stop(self):
        """Stop the orchestrator"""
        logger.info("Stopping EDGAR orchestrator")
        self.is_running = False

        # Give polling loop time to finish current iteration
        import asyncio
        await asyncio.sleep(2)


# Background task management
_orchestrator_task: Optional[asyncio.Task] = None
_orchestrator: Optional[EdgarOrchestrator] = None


async def start_edgar_monitoring():
    """Start EDGAR monitoring as a background task"""
    global _orchestrator_task, _orchestrator

    if _orchestrator_task and not _orchestrator_task.done():
        logger.warning("EDGAR monitoring already running")
        return

    # Get configuration from environment
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    sendgrid_api_key = os.getenv("SENDGRID_API_KEY")
    whatsapp_api_key = os.getenv("WHATSAPP_API_KEY")
    whatsapp_phone_number = os.getenv("WHATSAPP_PHONE_NUMBER")
    alert_recipients = os.getenv("ALERT_RECIPIENTS", "").split(",")

    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    _orchestrator = EdgarOrchestrator(
        anthropic_api_key=anthropic_api_key,
        sendgrid_api_key=sendgrid_api_key,
        whatsapp_api_key=whatsapp_api_key,
        whatsapp_phone_number=whatsapp_phone_number,
        alert_recipients=[r.strip() for r in alert_recipients if r.strip()],
        poll_interval=60
    )

    _orchestrator_task = asyncio.create_task(_orchestrator.run())
    logger.info("EDGAR monitoring started")


async def stop_edgar_monitoring():
    """Stop EDGAR monitoring"""
    global _orchestrator_task, _orchestrator

    if _orchestrator:
        await _orchestrator.stop()

    if _orchestrator_task:
        _orchestrator_task.cancel()
        try:
            await _orchestrator_task
        except asyncio.CancelledError:
            pass

    logger.info("EDGAR monitoring stopped")


def is_edgar_monitoring_running() -> bool:
    """Check if EDGAR monitoring is running"""
    global _orchestrator_task
    return _orchestrator_task is not None and not _orchestrator_task.done()
