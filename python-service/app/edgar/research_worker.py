"""Background worker for generating research on staged deals"""
import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from anthropic import Anthropic

from .database import EdgarDatabase

logger = logging.getLogger(__name__)


class ResearchWorker:
    """Generates AI research for staged deals"""

    def __init__(self, anthropic_api_key: str):
        self.db = EdgarDatabase()
        self.anthropic = Anthropic(api_key=anthropic_api_key)
        self.is_running = False

    async def connect(self):
        """Connect to database"""
        await self.db.connect()
        logger.info("Research worker connected to database")

    async def disconnect(self):
        """Disconnect from database"""
        await self.db.disconnect()
        logger.info("Research worker disconnected from database")

    async def generate_analysis(
        self,
        analyzer_type: str,
        deal_info: dict,
        filing_text: str
    ) -> str:
        """Generate research analysis using Claude"""

        prompts = {
            "topping_bid": f"""Analyze the topping bid risk for this M&A deal:

Target: {deal_info['target_name']}
Acquirer: {deal_info['acquirer_name']}
Deal Value: {deal_info['deal_value']}
Deal Type: {deal_info['deal_type']}

Filing Information:
{filing_text[:20000]}

Provide a comprehensive topping bid analysis covering:
1. Deal premium analysis (is the offer price competitive?)
2. Target attractiveness (are there likely other suitors?)
3. Deal protections (termination fees, no-shop provisions, matching rights)
4. Market precedents for similar deals
5. Likelihood of competing bids (0-100%)
6. Risk factors that could attract competing bidders

Format as markdown with clear sections.""",

            "antitrust": f"""Analyze the antitrust/regulatory risk for this M&A deal:

Target: {deal_info['target_name']}
Acquirer: {deal_info['acquirer_name']}
Deal Value: {deal_info['deal_value']}
Deal Type: {deal_info['deal_type']}

Filing Information:
{filing_text[:20000]}

Provide a comprehensive antitrust analysis covering:
1. Market concentration analysis
2. Regulatory jurisdictions (FTC, DOJ, EU, etc.)
3. Historical precedents for similar deals
4. Potential remedies (divestitures, behavioral conditions)
5. Timeline for regulatory review
6. Probability of regulatory approval (0-100%)
7. Key risk factors

Format as markdown with clear sections.""",

            "contract": f"""Analyze the deal contract terms and structure:

Target: {deal_info['target_name']}
Acquirer: {deal_info['acquirer_name']}
Deal Value: {deal_info['deal_value']}
Deal Type: {deal_info['deal_type']}

Filing Information:
{filing_text[:20000]}

Provide a comprehensive contract analysis covering:
1. Deal structure (merger, tender offer, cash/stock mix)
2. Purchase price and consideration
3. Closing conditions
4. Termination rights and fees
5. Timing and milestones
6. Shareholder approval requirements
7. Financing terms (if disclosed)
8. Material adverse change (MAC) provisions

Format as markdown with clear sections."""
        }

        try:
            prompt = prompts.get(analyzer_type, prompts["topping_bid"])

            response = self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}]
            )

            return response.content[0].text

        except Exception as e:
            logger.error(f"Failed to generate {analyzer_type} analysis: {e}")
            return f"# Analysis Failed\n\nError generating {analyzer_type} analysis: {str(e)}"

    async def process_research_queue(self):
        """Process one item from research queue"""
        try:
            # Get next pending research job
            job = await self.db.researchqueue.find_first(
                where={"status": "pending"},
                order={"priority": "desc"}  # Higher priority first
            )

            if not job:
                return False  # No work to do

            logger.info(f"Processing research job {job.id} for deal {job.stagedDealId}")

            # Update job status
            await self.db.researchqueue.update(
                where={"id": job.id},
                data={"status": "processing"}
            )

            # Get staged deal
            deal = await self.db.stageddeal.find_unique(
                where={"id": job.stagedDealId},
                include={"sourceFiling": True}
            )

            if not deal:
                logger.error(f"Staged deal {job.stagedDealId} not found")
                await self.db.researchqueue.update(
                    where={"id": job.id},
                    data={"status": "failed", "attempts": job.attempts + 1}
                )
                return True

            # Fetch filing text (using a simple approach - in production, cache this)
            filing_url = deal.sourceFiling.filingUrl
            import httpx
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(filing_url)
                filing_text = response.text[:50000]

            deal_info = {
                "target_name": deal.targetName,
                "acquirer_name": deal.acquirerName or "Unknown",
                "deal_value": f"${deal.dealValue}B" if deal.dealValue else "Not disclosed",
                "deal_type": deal.dealType or "acquisition"
            }

            # Generate research for each analyzer type
            for analyzer_type in job.analyzerTypes:
                logger.info(f"Generating {analyzer_type} analysis...")

                analysis_markdown = await self.generate_analysis(
                    analyzer_type,
                    deal_info,
                    filing_text
                )

                # Save research
                await self.db.stageddealresearch.create(
                    data={
                        "stagedDealId": job.stagedDealId,
                        "analyzerType": analyzer_type,
                        "analysisMarkdown": analysis_markdown,
                        "status": "completed"
                    }
                )

                logger.info(f"Saved {analyzer_type} analysis")

            # Mark job as completed
            await self.db.researchqueue.update(
                where={"id": job.id},
                data={"status": "completed"}
            )

            # Update staged deal research status
            await self.db.stageddeal.update(
                where={"id": job.stagedDealId},
                data={"researchStatus": "completed"}
            )

            logger.info(f"Research completed for deal {job.stagedDealId}")
            return True

        except Exception as e:
            logger.error(f"Error processing research queue: {e}", exc_info=True)
            if job:
                await self.db.researchqueue.update(
                    where={"id": job.id},
                    data={
                        "status": "failed",
                        "attempts": job.attempts + 1
                    }
                )
            return True

    async def run(self):
        """Start the research worker loop"""
        logger.info("Starting research worker")
        self.is_running = True

        try:
            await self.connect()

            while self.is_running:
                try:
                    # Process one job
                    had_work = await self.process_research_queue()

                    if not had_work:
                        # No work available, wait longer
                        await asyncio.sleep(30)
                    else:
                        # Work processed, check again soon
                        await asyncio.sleep(5)

                except Exception as e:
                    logger.error(f"Research worker error: {e}", exc_info=True)
                    await asyncio.sleep(60)

        finally:
            await self.disconnect()

    async def stop(self):
        """Stop the worker"""
        logger.info("Stopping research worker")
        self.is_running = False


# Background task management
_research_worker_task: Optional[asyncio.Task] = None
_research_worker: Optional[ResearchWorker] = None


async def start_research_worker():
    """Start research worker as a background task"""
    global _research_worker_task, _research_worker

    if _research_worker_task and not _research_worker_task.done():
        logger.warning("Research worker already running")
        return

    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    _research_worker = ResearchWorker(anthropic_api_key=anthropic_api_key)
    _research_worker_task = asyncio.create_task(_research_worker.run())
    logger.info("Research worker started")


async def stop_research_worker():
    """Stop research worker"""
    global _research_worker_task, _research_worker

    if _research_worker:
        await _research_worker.stop()

    if _research_worker_task:
        _research_worker_task.cancel()
        try:
            await _research_worker_task
        except asyncio.CancelledError:
            pass

    logger.info("Research worker stopped")


def is_research_worker_running() -> bool:
    """Check if research worker is running"""
    global _research_worker_task
    return _research_worker_task is not None and not _research_worker_task.done()
