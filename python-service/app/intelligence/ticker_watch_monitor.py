"""
Ticker Watch Monitor - Continuously monitors EDGAR for any filings from rumored deal tickers.

This monitor is more aggressive than the cross-reference system:
- Cross-reference: One-time search when a deal is first detected
- Ticker Watch: Continuous monitoring of all tickers in watchlist/rumored tiers

When a deal is detected from non-regulatory sources (news, social media),
we add the ticker to our watch list and monitor EDGAR for ANY filings from that company.
This helps catch M&A activity that might be announced in various filing types.
"""
import logging
import asyncio
import json
from typing import List, Dict, Any, Set
from datetime import datetime, timedelta
from app.utils.timezone import get_current_utc
import asyncpg

from app.intelligence.models import DealMention, SourceType, MentionType
from app.intelligence.edgar_cross_reference import EdgarCrossReference

logger = logging.getLogger(__name__)


class TickerWatchMonitor:
    """
    Continuously monitors EDGAR for any filings from tickers in watchlist/rumored deals.

    This is a "broad net" approach - we watch for ANY filing type from companies
    in rumored deals, not just M&A-specific filings.
    """

    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool
        self.edgar_cross_ref = EdgarCrossReference(db_pool)
        self.monitored_tickers: Set[str] = set()
        self.last_check: Dict[str, datetime] = {}

    async def get_tickers_to_monitor(self) -> List[Dict[str, Any]]:
        """
        Get all tickers from deals in watchlist or rumored tier that need monitoring.

        Returns:
            List of dicts with ticker, company_name, and deal_id
        """
        async with self.pool.acquire() as conn:
            results = await conn.fetch(
                """
                SELECT DISTINCT
                    di.target_ticker as ticker,
                    di.target_name as company_name,
                    di.deal_id,
                    di.deal_tier,
                    di.confidence_score,
                    di.first_detected_at
                FROM deal_intelligence di
                WHERE di.deal_tier IN ('watchlist', 'rumored')
                  AND di.target_ticker IS NOT NULL
                  AND di.deal_status NOT IN ('completed', 'terminated')
                ORDER BY di.confidence_score DESC, di.first_detected_at DESC
                """
            )

            return [dict(row) for row in results]

    async def check_ticker_for_new_filings(
        self,
        ticker: str,
        company_name: str,
        deal_id: str,
        since_date: datetime
    ) -> List[Dict[str, Any]]:
        """
        Check EDGAR for any new filings from a specific ticker since a given date.

        Args:
            ticker: Stock ticker to monitor
            company_name: Company name (for logging)
            deal_id: Associated deal ID
            since_date: Only return filings after this date

        Returns:
            List of new filings found
        """
        async with self.pool.acquire() as conn:
            # Get all filings for this ticker since the last check
            filings = await conn.fetch(
                """
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
                    processed_at
                FROM edgar_filings
                WHERE ticker = $1
                  AND filing_date >= $2
                  AND status = 'analyzed'
                ORDER BY filing_date DESC
                """,
                ticker.upper(),
                since_date
            )

            results = [dict(row) for row in filings]

            if results:
                logger.info(
                    f"Ticker watch for {ticker} ({company_name}): "
                    f"found {len(results)} filing(s) since {since_date.date()}"
                )

            return results

    async def process_new_filings(
        self,
        deal_id: str,
        ticker: str,
        filings: List[Dict[str, Any]]
    ) -> int:
        """
        Process new filings found for a ticker and add them to the deal.

        Args:
            deal_id: Deal to update
            ticker: Ticker being monitored
            filings: New filings to process

        Returns:
            Number of filings added as sources
        """
        if not filings:
            return 0

        async with self.pool.acquire() as conn:
            added_count = 0

            for filing in filings:
                # Check if this filing is already a source for this deal
                existing = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM deal_sources
                    WHERE deal_id = $1
                      AND source_name = 'edgar'
                      AND extracted_data->>'accession_number' = $2
                    """,
                    deal_id,
                    filing['accession_number']
                )

                if existing > 0:
                    logger.debug(
                        f"Filing {filing['accession_number']} already exists for deal {deal_id}"
                    )
                    continue

                # Convert filing to DealMention
                mention = self.edgar_cross_ref.create_deal_mention_from_filing(
                    filing, deal_id
                )

                # Add as source
                import json as json_lib
                await conn.execute(
                    """
                    INSERT INTO deal_sources (
                        deal_id, source_name, source_type, source_url,
                        mention_type, headline, content_snippet,
                        credibility_score, extracted_data, source_published_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                    """,
                    deal_id,
                    mention.source_name,
                    mention.source_type.value,
                    mention.source_url,
                    mention.mention_type.value,
                    mention.headline,
                    mention.content_snippet,
                    mention.credibility_score,
                    json_lib.dumps(mention.extracted_data) if mention.extracted_data else None,
                    mention.source_published_at
                )

                added_count += 1
                logger.info(
                    f"Added filing {filing['filing_type']} ({filing['accession_number']}) "
                    f"to deal {deal_id}"
                )

            # If we added any filings, update the deal's confidence and source count
            if added_count > 0:
                # Get all sources
                sources = await conn.fetch(
                    """
                    SELECT source_name, source_type, credibility_score
                    FROM deal_sources
                    WHERE deal_id = $1
                    """,
                    deal_id
                )

                # Calculate new confidence (simple average for now)
                total_credibility = sum(s['credibility_score'] for s in sources)
                avg_confidence = total_credibility / len(sources)

                # Update deal
                await conn.execute(
                    """
                    UPDATE deal_intelligence
                    SET source_count = $1,
                        confidence_score = $2,
                        last_updated_source_at = $3
                    WHERE deal_id = $4
                    """,
                    len(sources),
                    avg_confidence,
                    get_current_utc(),
                    deal_id
                )

                # Log to history
                await conn.execute(
                    """
                    INSERT INTO deal_history (
                        deal_id, change_type, new_value, triggered_by, notes
                    ) VALUES ($1, $2, $3, $4, $5)
                    """,
                    deal_id,
                    'ticker_watch_filing_added',
                    json.dumps({
                        'filings_added': added_count,
                        'ticker': ticker,
                        'filing_types': [f['filing_type'] for f in filings[:5]]
                    }),
                    'ticker_watch_monitor',
                    f'Ticker watch monitor found {added_count} new filing(s) for {ticker}'
                )

            return added_count

    async def monitor_cycle(self) -> Dict[str, Any]:
        """
        Run one monitoring cycle - check all tickers for new filings.

        Returns:
            Statistics about the monitoring cycle
        """
        try:
            # Get tickers to monitor
            tickers_to_monitor = await self.get_tickers_to_monitor()

            if not tickers_to_monitor:
                logger.info("Ticker watch: No tickers to monitor")
                return {
                    'tickers_monitored': 0,
                    'filings_found': 0,
                    'deals_updated': 0
                }

            logger.info(f"Ticker watch: Monitoring {len(tickers_to_monitor)} ticker(s)")

            total_filings_found = 0
            deals_updated = 0

            for ticker_info in tickers_to_monitor:
                ticker = ticker_info['ticker']
                company_name = ticker_info['company_name']
                deal_id = str(ticker_info['deal_id'])

                # Determine lookback period
                # First time monitoring this ticker: look back 30 days
                # Subsequent checks: look back to last check (or 7 days max)
                if ticker in self.last_check:
                    since_date = max(
                        self.last_check[ticker],
                        get_current_utc() - timedelta(days=7)
                    )
                else:
                    # First time: look back 30 days
                    since_date = get_current_utc() - timedelta(days=30)

                # Check for new filings
                new_filings = await self.check_ticker_for_new_filings(
                    ticker, company_name, deal_id, since_date
                )

                if new_filings:
                    # Process and add to deal
                    added = await self.process_new_filings(
                        deal_id, ticker, new_filings
                    )

                    total_filings_found += len(new_filings)
                    if added > 0:
                        deals_updated += 1

                # Update last check time
                self.last_check[ticker] = get_current_utc()
                self.monitored_tickers.add(ticker)

                # Small delay to avoid hammering the database
                await asyncio.sleep(0.1)

            logger.info(
                f"Ticker watch cycle complete: "
                f"monitored {len(tickers_to_monitor)} tickers, "
                f"found {total_filings_found} new filings, "
                f"updated {deals_updated} deals"
            )

            return {
                'tickers_monitored': len(tickers_to_monitor),
                'filings_found': total_filings_found,
                'deals_updated': deals_updated,
                'monitored_tickers': list(self.monitored_tickers)
            }

        except Exception as e:
            logger.error(f"Error in ticker watch monitor cycle: {e}", exc_info=True)
            return {
                'tickers_monitored': 0,
                'filings_found': 0,
                'deals_updated': 0,
                'error': str(e)
            }

    async def run(self, interval_seconds: int = 300):
        """
        Run the ticker watch monitor continuously.

        Args:
            interval_seconds: How often to check for new filings (default: 5 minutes)
        """
        logger.info(f"Starting ticker watch monitor (interval: {interval_seconds}s)")

        while True:
            try:
                stats = await self.monitor_cycle()
                logger.info(f"Ticker watch stats: {stats}")

                # Wait before next cycle
                await asyncio.sleep(interval_seconds)

            except asyncio.CancelledError:
                logger.info("Ticker watch monitor stopped")
                break
            except Exception as e:
                logger.error(f"Error in ticker watch monitor: {e}", exc_info=True)
                # Wait a bit before retrying
                await asyncio.sleep(60)
