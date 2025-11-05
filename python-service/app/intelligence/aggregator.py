"""Intelligence aggregation and tier management for M&A deals"""
import logging
import json
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from dataclasses import asdict
import asyncpg

from app.intelligence.models import (
    DealMention,
    DealIntelligence,
    DealTier,
    DealStatus,
    SourceType,
    calculate_confidence_score,
)
from app.intelligence.edgar_cross_reference import EdgarCrossReference

logger = logging.getLogger(__name__)


class IntelligenceAggregator:
    """
    Aggregates deal mentions from multiple sources into unified DealIntelligence objects.

    Handles:
    - Entity resolution (same deal, different sources)
    - Ticker extraction and normalization
    - Confidence scoring
    - Timeline reconstruction
    """

    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool
        self.edgar_cross_ref = EdgarCrossReference(db_pool)

    async def process_mention(self, mention: DealMention) -> str:
        """
        Process a new deal mention and update deal intelligence.

        Args:
            mention: The deal mention to process

        Returns:
            deal_id: UUID of the deal in deal_intelligence table
        """
        async with self.pool.acquire() as conn:
            # Try to find existing deal by target company name or ticker
            existing_deal = await self._find_existing_deal(conn, mention)

            if existing_deal:
                # Update existing deal with new source
                deal_id = existing_deal["deal_id"]
                await self._add_source_to_deal(conn, deal_id, mention)
                await self._update_deal_intelligence(conn, deal_id)
                # Sync ticker_master with updated deal info
                await self._sync_ticker_master(conn, deal_id, mention)
                logger.info(f"Updated existing deal {deal_id} with new source: {mention.source_name}")
            else:
                # Create new deal
                deal_id = await self._create_new_deal(conn, mention)
                logger.info(f"Created new deal {deal_id} from source: {mention.source_name}")

            # Automatic EDGAR cross-reference for non-official sources
            # This helps corroborate deals and boost confidence
            if mention.source_type != SourceType.OFFICIAL:
                await self._perform_edgar_cross_reference(conn, deal_id, mention)

            return deal_id

    async def _find_existing_deal(
        self, conn: asyncpg.Connection, mention: DealMention
    ) -> Optional[Dict[str, Any]]:
        """Find existing deal by target ticker or fuzzy name match"""
        # First try exact ticker match (most reliable)
        if mention.target_ticker:
            deal = await conn.fetchrow(
                """SELECT deal_id, target_name, target_ticker, acquirer_name
                   FROM deal_intelligence
                   WHERE target_ticker = $1
                   AND deal_status NOT IN ('completed', 'terminated')
                   ORDER BY first_detected_at DESC
                   LIMIT 1""",
                mention.target_ticker.upper(),
            )
            if deal:
                return dict(deal)

        # Try fuzzy company name match (less reliable, needs improvement)
        # For now, use simple case-insensitive match
        deal = await conn.fetchrow(
            """SELECT deal_id, target_name, target_ticker, acquirer_name
               FROM deal_intelligence
               WHERE LOWER(target_name) = LOWER($1)
               AND deal_status NOT IN ('completed', 'terminated')
               ORDER BY first_detected_at DESC
               LIMIT 1""",
            mention.target_name,
        )
        if deal:
            return dict(deal)

        return None

    async def _create_new_deal(self, conn: asyncpg.Connection, mention: DealMention) -> str:
        """Create new deal_intelligence entry"""
        deal_id = await conn.fetchval(
            """INSERT INTO deal_intelligence (
                target_name, target_ticker, acquirer_name, acquirer_ticker,
                deal_value, deal_type, confidence_score, source_count,
                first_detected_at, last_updated_source_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)
            RETURNING deal_id""",
            mention.target_name,
            mention.target_ticker.upper() if mention.target_ticker else None,
            mention.acquirer_name,
            mention.acquirer_ticker.upper() if mention.acquirer_ticker else None,
            mention.deal_value,
            mention.deal_type,
            mention.credibility_score,
            mention.detected_at,
        )

        # Add source mention
        await self._add_source_to_deal(conn, deal_id, mention)

        # Log to deal history
        await conn.execute(
            """INSERT INTO deal_history (deal_id, change_type, new_value, triggered_by)
               VALUES ($1, 'created', $2, $3)""",
            deal_id,
            {"source": mention.source_name, "target": mention.target_name},
            mention.source_name,
        )

        # Create/update ticker_master entries for target and acquirer
        await self._sync_ticker_master(conn, deal_id, mention)

        return deal_id

    async def _add_source_to_deal(
        self, conn: asyncpg.Connection, deal_id: str, mention: DealMention
    ) -> None:
        """Add source mention to deal_sources table (with deduplication)"""
        # Use ON CONFLICT DO NOTHING to gracefully handle duplicate sources
        # The unique index on (deal_id, source_url) will prevent duplicates
        await conn.execute(
            """INSERT INTO deal_sources (
                deal_id, source_name, source_type, source_url,
                mention_type, headline, content_snippet,
                credibility_score, extracted_data, source_published_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
            ON CONFLICT (deal_id, source_url) WHERE source_url IS NOT NULL
            DO NOTHING""",
            deal_id,
            mention.source_name,
            mention.source_type.value,
            mention.source_url,
            mention.mention_type.value,
            mention.headline,
            mention.content_snippet,
            mention.credibility_score,
            json.dumps(mention.extracted_data) if mention.extracted_data else None,
            mention.source_published_at,
        )

    async def _update_deal_intelligence(self, conn: asyncpg.Connection, deal_id: str) -> None:
        """Recalculate deal intelligence based on all sources"""
        # Get all sources for this deal
        sources = await conn.fetch(
            """SELECT * FROM deal_sources WHERE deal_id = $1 ORDER BY detected_at DESC""",
            deal_id,
        )

        # Convert to DealMention objects for scoring
        mentions = []
        for source in sources:
            mentions.append(
                DealMention(
                    source_name=source["source_name"],
                    source_type=SourceType(source["source_type"]),
                    mention_type=source["mention_type"],
                    target_name="",  # Not needed for scoring
                    credibility_score=source["credibility_score"],
                )
            )

        # Calculate new confidence score
        confidence_score = calculate_confidence_score(mentions)

        # Update deal_intelligence
        await conn.execute(
            """UPDATE deal_intelligence
               SET source_count = $1,
                   confidence_score = $2,
                   last_updated_source_at = $3
               WHERE deal_id = $4""",
            len(sources),
            confidence_score,
            datetime.utcnow(),
            deal_id,
        )

    async def _perform_edgar_cross_reference(
        self, conn: asyncpg.Connection, deal_id: str, mention: DealMention
    ) -> None:
        """
        Perform automatic EDGAR cross-reference to find corroborating filings.

        When a deal is detected from non-regulatory sources (news, social media),
        automatically search EDGAR for filings that could corroborate the deal.
        If found, add them as additional sources to boost confidence.
        """
        try:
            # Search for relevant EDGAR filings
            filings = await self.edgar_cross_ref.search_corroborating_filings(
                target_name=mention.target_name,
                target_ticker=mention.target_ticker,
                acquirer_name=mention.acquirer_name,
                days_lookback=90  # Look back 90 days
            )

            if not filings:
                # No corroborating filings found - log for transparency
                await self.edgar_cross_ref.create_cross_reference_log(
                    conn,
                    deal_id,
                    {
                        "target_name": mention.target_name,
                        "target_ticker": mention.target_ticker,
                        "days_lookback": 90
                    },
                    [],
                    0.0
                )
                logger.info(f"EDGAR cross-reference for {mention.target_name}: no filings found")
                return

            # Get confidence before adding EDGAR sources
            deal_before = await conn.fetchrow(
                "SELECT confidence_score FROM deal_intelligence WHERE deal_id = $1",
                deal_id
            )
            confidence_before = deal_before["confidence_score"] if deal_before else 0.0

            # Add top filings as additional sources (limit to top 3 to avoid noise)
            added_count = 0
            for filing in filings[:3]:  # Top 3 most relevant
                # Convert filing to DealMention
                edgar_mention = self.edgar_cross_ref.create_deal_mention_from_filing(
                    filing, deal_id
                )

                # Add as source
                await self._add_source_to_deal(conn, deal_id, edgar_mention)
                added_count += 1

            # Recalculate confidence with new EDGAR sources
            await self._update_deal_intelligence(conn, deal_id)

            # Get confidence after adding EDGAR sources
            deal_after = await conn.fetchrow(
                "SELECT confidence_score FROM deal_intelligence WHERE deal_id = $1",
                deal_id
            )
            confidence_after = deal_after["confidence_score"] if deal_after else 0.0

            # Calculate confidence impact
            confidence_impact = confidence_after - confidence_before

            # Log the cross-reference for transparency
            await self.edgar_cross_ref.create_cross_reference_log(
                conn,
                deal_id,
                {
                    "target_name": mention.target_name,
                    "target_ticker": mention.target_ticker,
                    "days_lookback": 90
                },
                filings,
                confidence_impact
            )

            logger.info(
                f"EDGAR cross-reference for {mention.target_name}: "
                f"added {added_count} filing(s), "
                f"confidence: {confidence_before:.1%} → {confidence_after:.1%} "
                f"(+{confidence_impact:.1%})"
            )

        except Exception as e:
            # Don't fail the whole mention processing if EDGAR search fails
            logger.error(f"EDGAR cross-reference failed for deal {deal_id}: {e}", exc_info=True)

    async def _sync_ticker_master(
        self, conn: asyncpg.Connection, deal_id: str, mention: DealMention
    ) -> None:
        """
        Create or update ticker_master entries for target and acquirer.

        This ensures the security master stays in sync with deal intelligence,
        tracking full lifecycle from rumor to delisting.
        """
        try:
            # Get the deal tier to determine lifecycle status and priority
            deal_info = await conn.fetchrow(
                """SELECT deal_tier, confidence_score FROM deal_intelligence WHERE deal_id = $1""",
                deal_id
            )

            if not deal_info:
                return

            deal_tier = deal_info["deal_tier"]
            confidence_score = deal_info["confidence_score"]

            # Map deal tier to lifecycle status and watch priority
            lifecycle_status_map = {
                "watchlist": "rumored",
                "rumored": "rumored",
                "active": "announced"
            }

            priority_map = {
                "watchlist": "normal",
                "rumored": "high",
                "active": "critical"
            }

            lifecycle_status = lifecycle_status_map.get(deal_tier, "rumored")
            watch_priority = priority_map.get(deal_tier, "normal")

            # Sync target ticker
            if mention.target_ticker:
                ticker = mention.target_ticker.upper()

                # Check if ticker already exists
                existing = await conn.fetchrow(
                    "SELECT ticker FROM ticker_master WHERE ticker = $1",
                    ticker
                )

                if existing:
                    # Update existing ticker
                    await conn.execute(
                        """UPDATE ticker_master
                           SET lifecycle_status = $1,
                               active_deal_id = $2,
                               role_in_deal = 'target',
                               watch_priority = $3,
                               edgar_monitoring_enabled = true,
                               updated_at = NOW()
                           WHERE ticker = $4""",
                        lifecycle_status,
                        deal_id,
                        watch_priority,
                        ticker
                    )

                    # Log lifecycle event
                    await conn.execute(
                        """SELECT log_ticker_event($1, $2, $3, $4, $5)""",
                        ticker,
                        'deal_associated',
                        'intelligence_aggregator',
                        json.dumps({
                            "deal_id": deal_id,
                            "deal_tier": deal_tier,
                            "confidence_score": float(confidence_score)
                        }),
                        f"Associated with {deal_tier} tier deal"
                    )

                    logger.info(f"Updated ticker_master for {ticker} (target)")
                else:
                    # Create new ticker entry
                    await conn.execute(
                        """INSERT INTO ticker_master (
                            ticker, company_name, lifecycle_status,
                            active_deal_id, role_in_deal, watch_priority,
                            first_rumor_detected_at, edgar_monitoring_enabled
                        ) VALUES ($1, $2, $3, $4, 'target', $5, $6, true)
                        ON CONFLICT (ticker) DO NOTHING""",
                        ticker,
                        mention.target_name,
                        lifecycle_status,
                        deal_id,
                        watch_priority,
                        mention.detected_at
                    )

                    # Log lifecycle event
                    await conn.execute(
                        """SELECT log_ticker_event($1, $2, $3, $4, $5)""",
                        ticker,
                        'rumor_detected',
                        'intelligence_aggregator',
                        json.dumps({
                            "deal_id": deal_id,
                            "source": mention.source_name
                        }),
                        f"First rumor detected from {mention.source_name}"
                    )

                    # Initialize monitoring schedule
                    await conn.execute(
                        """INSERT INTO ticker_monitoring_schedule (
                            ticker, edgar_next_check, news_next_check
                        ) VALUES ($1, NOW() + INTERVAL '5 minutes', NOW() + INTERVAL '10 minutes')
                        ON CONFLICT (ticker) DO NOTHING""",
                        ticker
                    )

                    logger.info(f"Created ticker_master entry for {ticker} (target)")

            # Sync acquirer ticker (if present)
            if mention.acquirer_ticker:
                ticker = mention.acquirer_ticker.upper()

                existing = await conn.fetchrow(
                    "SELECT ticker FROM ticker_master WHERE ticker = $1",
                    ticker
                )

                if existing:
                    # Update existing ticker
                    await conn.execute(
                        """UPDATE ticker_master
                           SET active_deal_id = $1,
                               role_in_deal = 'acquirer',
                               watch_priority = 'normal',
                               updated_at = NOW()
                           WHERE ticker = $2""",
                        deal_id,
                        ticker
                    )
                else:
                    # Create new ticker entry for acquirer
                    await conn.execute(
                        """INSERT INTO ticker_master (
                            ticker, company_name, lifecycle_status,
                            active_deal_id, role_in_deal, watch_priority,
                            edgar_monitoring_enabled
                        ) VALUES ($1, $2, 'normal', $3, 'acquirer', 'normal', false)
                        ON CONFLICT (ticker) DO NOTHING""",
                        ticker,
                        mention.acquirer_name,
                        deal_id
                    )

                logger.info(f"Synced ticker_master for {ticker} (acquirer)")

        except Exception as e:
            # Don't fail the whole mention processing if ticker sync fails
            logger.error(f"Failed to sync ticker_master for deal {deal_id}: {e}", exc_info=True)


class TierManager:
    """
    Manages automatic promotion/demotion of deals between tiers.

    Auto-Promotion Rules:
    - Watchlist → Rumored:
      - 2+ news sources mention deal
      - 1 high-credibility news source (Reuters) mentions deal
      - Twitter mention + any other source

    - Rumored → Active:
      - EDGAR filing
      - FTC early termination notice
      - Exchange corporate action announcement
      - 3+ news sources converge on same deal

    Demotion Rules:
    - Rumored → Watchlist: No new mentions in 30 days
    - Active → Watchlist: Deal terminated/completed
    """

    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool

    async def evaluate_tier_promotion(self, deal_id: str) -> bool:
        """
        Evaluate if a deal should be promoted to a higher tier.

        Returns:
            True if tier was changed, False otherwise
        """
        async with self.pool.acquire() as conn:
            # Get current deal info
            deal = await conn.fetchrow(
                """SELECT deal_tier, deal_status, confidence_score, source_count
                   FROM deal_intelligence WHERE deal_id = $1""",
                deal_id,
            )

            if not deal:
                return False

            current_tier = DealTier(deal["deal_tier"])
            confidence = deal["confidence_score"]
            source_count = deal["source_count"]

            # Get source breakdown
            sources = await conn.fetch(
                """SELECT source_name, source_type, mention_type
                   FROM deal_sources WHERE deal_id = $1""",
                deal_id,
            )

            official_sources = [s for s in sources if s["source_type"] == "official"]
            news_sources = [s for s in sources if s["source_type"] == "news"]

            # Check for promotion to ACTIVE
            if current_tier != DealTier.ACTIVE:
                if official_sources:
                    # Any official source = ACTIVE
                    await self._promote_to_active(conn, deal_id)
                    logger.info(f"Promoted deal {deal_id} to ACTIVE (official source)")
                    return True
                elif len(news_sources) >= 3:
                    # 3+ news sources = ACTIVE
                    await self._promote_to_active(conn, deal_id)
                    logger.info(f"Promoted deal {deal_id} to ACTIVE (3+ news sources)")
                    return True

            # Check for promotion to RUMORED
            if current_tier == DealTier.WATCHLIST:
                if len(news_sources) >= 2:
                    # 2+ news sources = RUMORED
                    await self._promote_to_rumored(conn, deal_id)
                    logger.info(f"Promoted deal {deal_id} to RUMORED (2+ news sources)")
                    return True
                elif confidence >= 0.8:
                    # High credibility single source = RUMORED
                    await self._promote_to_rumored(conn, deal_id)
                    logger.info(f"Promoted deal {deal_id} to RUMORED (high credibility)")
                    return True

            return False

    async def _promote_to_rumored(self, conn: asyncpg.Connection, deal_id: str) -> None:
        """Promote deal to RUMORED tier"""
        await conn.execute(
            """UPDATE deal_intelligence
               SET deal_tier = 'rumored',
                   promoted_to_rumored_at = $1
               WHERE deal_id = $2""",
            datetime.utcnow(),
            deal_id,
        )

        # Log to history
        await conn.execute(
            """INSERT INTO deal_history (deal_id, change_type, old_value, new_value, triggered_by)
               VALUES ($1, 'tier_promoted', $2, $3, 'system')""",
            deal_id,
            {"tier": "watchlist"},
            {"tier": "rumored"},
        )

        # Update ticker watchlist
        ticker = await conn.fetchval(
            "SELECT target_ticker FROM deal_intelligence WHERE deal_id = $1", deal_id
        )
        if ticker:
            await conn.execute(
                """INSERT INTO ticker_watchlist (ticker, company_name, watch_tier, active_deal_id, promoted_to_rumored_at)
                   SELECT target_ticker, target_name, 'rumored', deal_id, $1
                   FROM deal_intelligence WHERE deal_id = $2
                   ON CONFLICT (ticker) DO UPDATE
                   SET watch_tier = 'rumored',
                       active_deal_id = $2,
                       promoted_to_rumored_at = $1,
                       last_activity_at = $1""",
                datetime.utcnow(),
                deal_id,
            )

    async def _promote_to_active(self, conn: asyncpg.Connection, deal_id: str) -> None:
        """Promote deal to ACTIVE tier"""
        await conn.execute(
            """UPDATE deal_intelligence
               SET deal_tier = 'active',
                   deal_status = 'announced',
                   promoted_to_active_at = $1
               WHERE deal_id = $2""",
            datetime.utcnow(),
            deal_id,
        )

        # Log to history
        await conn.execute(
            """INSERT INTO deal_history (deal_id, change_type, old_value, new_value, triggered_by)
               VALUES ($1, 'tier_promoted', $2, $3, 'system')""",
            deal_id,
            {"tier": "rumored"},
            {"tier": "active"},
        )

        # Update ticker watchlist
        ticker = await conn.fetchval(
            "SELECT target_ticker FROM deal_intelligence WHERE deal_id = $1", deal_id
        )
        if ticker:
            await conn.execute(
                """INSERT INTO ticker_watchlist (ticker, company_name, watch_tier, active_deal_id, promoted_to_active_at)
                   SELECT target_ticker, target_name, 'active', deal_id, $1
                   FROM deal_intelligence WHERE deal_id = $2
                   ON CONFLICT (ticker) DO UPDATE
                   SET watch_tier = 'active',
                       active_deal_id = $2,
                       promoted_to_active_at = $1,
                       last_activity_at = $1""",
                datetime.utcnow(),
                deal_id,
            )
