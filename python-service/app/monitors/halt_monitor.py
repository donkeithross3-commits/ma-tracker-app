"""Trading Halt Monitor - Real-time scraping of NASDAQ and NYSE halt feeds"""
import asyncio
import aiohttp
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
import asyncpg
import os
import csv
from io import StringIO

logger = logging.getLogger(__name__)


class HaltData:
    """Represents a trading halt event"""

    def __init__(
        self,
        ticker: str,
        halt_time: datetime,
        halt_code: str,
        resumption_time: Optional[datetime] = None,
        exchange: str = "NASDAQ",
        company_name: Optional[str] = None
    ):
        self.ticker = ticker.upper()
        self.halt_time = halt_time
        self.halt_code = halt_code
        self.resumption_time = resumption_time
        self.exchange = exchange
        self.company_name = company_name

    def is_material_news_halt(self) -> bool:
        """Check if this is a T1 (news pending) or T2 (news dissemination) halt"""
        return self.halt_code in ['T1', 'T2', 'M1', 'M2']

    def to_dict(self) -> Dict[str, Any]:
        return {
            'ticker': self.ticker,
            'halt_time': self.halt_time.isoformat(),
            'halt_code': self.halt_code,
            'resumption_time': self.resumption_time.isoformat() if self.resumption_time else None,
            'exchange': self.exchange,
            'company_name': self.company_name
        }


class HaltMonitor:
    """Monitor NASDAQ and NYSE for real-time trading halts"""

    # Official exchange halt feeds
    # NYSE provides a unified CSV API with both NYSE and NASDAQ halts
    NYSE_CSV_URL = "https://www.nyse.com/api/trade-halts/current/download"
    NASDAQ_URL = "https://www.nasdaqtrader.com/trader.aspx?id=tradehalts"

    # Poll interval in seconds
    POLL_INTERVAL = 10

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.db_pool = None
        self.is_running = False
        self.session = None

        # Cache of recently seen halts (to avoid duplicate alerts)
        self.seen_halts = set()

        # Track M&A deals we're monitoring
        self.tracked_tickers = set()

        # Logging rate limiting: log twice per minute
        self.checks_since_last_log = 0
        self.last_log_time = None
        self.LOG_EVERY_N_CHECKS = 15  # Every 15 checks at 2s interval = 30s = twice per minute

    async def initialize(self):
        """Initialize database connection pool"""
        if not self.db_pool:
            self.db_pool = await asyncpg.create_pool(self.db_url)
            logger.info("Halt monitor database pool initialized")

        # Load tracked tickers from deal_intelligence
        await self.refresh_tracked_tickers()

    async def refresh_tracked_tickers(self):
        """Load current M&A deal target tickers from database"""
        try:
            async with self.db_pool.acquire() as conn:
                # Get all active deal target tickers
                rows = await conn.fetch("""
                    SELECT DISTINCT target_ticker
                    FROM deal_intelligence
                    WHERE target_ticker IS NOT NULL
                    AND target_ticker != ''
                    AND deal_status NOT IN ('completed', 'terminated')
                """)

                self.tracked_tickers = {row['target_ticker'].upper() for row in rows}
                logger.info(f"Tracking {len(self.tracked_tickers)} M&A target tickers for halt monitoring")

        except Exception as e:
            logger.error(f"Failed to load tracked tickers: {e}")

    async def start(self):
        """Start the halt monitoring service"""
        self.is_running = True
        logger.info("Starting halt monitor...")

        await self.initialize()

        # Create aiohttp session
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        )

        # Start monitoring loop
        try:
            while self.is_running:
                try:
                    # Fetch halts from NYSE CSV API (includes both NYSE and NASDAQ)
                    all_halts = await self.fetch_nyse_csv_halts()

                    # Increment check counter
                    self.checks_since_last_log += 1

                    # Process new halts
                    await self.process_halts(all_halts)

                    # Refresh tracked tickers every 30 seconds
                    if self.checks_since_last_log % 15 == 0:
                        await self.refresh_tracked_tickers()

                except Exception as e:
                    logger.error(f"Halt monitor iteration error: {e}", exc_info=True)

                # Wait before next poll
                await asyncio.sleep(self.POLL_INTERVAL)

        finally:
            await self.cleanup()

    async def stop(self):
        """Stop the halt monitoring service"""
        self.is_running = False
        logger.info("Halt monitor stopping...")

    async def cleanup(self):
        """Clean up resources"""
        if self.session:
            await self.session.close()
        if self.db_pool:
            await self.db_pool.close()
        logger.info("Halt monitor cleaned up")

    async def fetch_nyse_csv_halts(self) -> List[HaltData]:
        """
        Fetch current halts from NYSE CSV API.
        This endpoint provides halts from both NYSE and NASDAQ exchanges in a single feed.
        """
        try:
            async with self.session.get(self.NYSE_CSV_URL) as response:
                if response.status != 200:
                    logger.warning(f"NYSE CSV API returned status {response.status}")
                    return []

                csv_text = await response.text()
                reader = csv.DictReader(StringIO(csv_text))

                halts = []
                for row in reader:
                    try:
                        # CSV format: Halt Date,Halt Time,Symbol,Name,Exchange,Reason,Resume Date,NYSE Resume Time
                        ticker = row['Symbol'].strip()
                        company_name = row['Name'].strip()
                        halt_date = row['Halt Date'].strip()
                        halt_time = row['Halt Time'].strip()
                        exchange = row['Exchange'].strip()
                        reason = row['Reason'].strip()
                        resume_date = row.get('Resume Date', '').strip()
                        resume_time = row.get('NYSE Resume Time', '').strip()

                        # Parse halt datetime
                        halt_datetime_str = f"{halt_date} {halt_time}"
                        halt_datetime = datetime.strptime(halt_datetime_str, "%Y-%m-%d %H:%M:%S")

                        # Parse resumption datetime if available
                        resumption_time = None
                        if resume_date and resume_time:
                            try:
                                resume_datetime_str = f"{resume_date} {resume_time}"
                                resumption_time = datetime.strptime(resume_datetime_str, "%Y-%m-%d %H:%M:%S")
                            except:
                                pass

                        # Map reason to halt code
                        # "News pending" maps to T1, "News dissemination" maps to T2
                        halt_code = "T1" if "news pending" in reason.lower() else "T2"

                        halt = HaltData(
                            ticker=ticker,
                            halt_time=halt_datetime,
                            halt_code=halt_code,
                            resumption_time=resumption_time,
                            exchange=exchange,
                            company_name=company_name
                        )

                        halts.append(halt)

                    except Exception as e:
                        logger.error(f"Failed to parse halt row: {e}, row: {row}")
                        continue

                # Only log every N checks to reduce verbosity
                if self.checks_since_last_log % self.LOG_EVERY_N_CHECKS == 0:
                    logger.info(
                        f"Halt monitor status: Checked {self.checks_since_last_log} times, "
                        f"currently {len(halts)} halts active"
                    )

                return halts

        except Exception as e:
            logger.error(f"Failed to fetch halts from NYSE CSV API: {e}")
            return []

    async def fetch_nasdaq_halts(self) -> List[HaltData]:
        """Fetch current halts from NASDAQ (DEPRECATED: Use fetch_nyse_csv_halts instead)"""
        try:
            async with self.session.get(self.NASDAQ_URL) as response:
                if response.status != 200:
                    logger.warning(f"NASDAQ returned status {response.status}")
                    return []

                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')

                # Find halt table
                table = soup.find('table', {'id': 'TradeHaltData'})
                if not table:
                    logger.warning("NASDAQ halt table not found")
                    return []

                halts = []
                rows = table.find_all('tr')[1:]  # Skip header

                for row in rows:
                    cols = row.find_all('td')
                    if len(cols) < 5:
                        continue

                    try:
                        # Parse halt data
                        # Format: NMS Symbol | Halt Time | Halt Code | Resumption Quote Time | Resumption Trade Time
                        ticker = cols[0].text.strip()
                        halt_time_str = cols[1].text.strip()
                        halt_code = cols[2].text.strip()
                        resumption_quote_time_str = cols[3].text.strip()

                        # Parse times
                        halt_time = self._parse_nasdaq_time(halt_time_str)
                        resumption_time = self._parse_nasdaq_time(resumption_quote_time_str) if resumption_quote_time_str else None

                        halt = HaltData(
                            ticker=ticker,
                            halt_time=halt_time,
                            halt_code=halt_code,
                            resumption_time=resumption_time,
                            exchange="NASDAQ"
                        )

                        halts.append(halt)

                    except Exception as e:
                        logger.error(f"Failed to parse NASDAQ halt row: {e}")
                        continue

                logger.info(f"Fetched {len(halts)} NASDAQ halts")
                return halts

        except Exception as e:
            logger.error(f"Failed to fetch NASDAQ halts: {e}")
            return []

    async def fetch_nyse_halts(self) -> List[HaltData]:
        """Fetch current halts from NYSE"""
        try:
            async with self.session.get(self.NYSE_URL) as response:
                if response.status != 200:
                    logger.warning(f"NYSE returned status {response.status}")
                    return []

                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')

                # Find halt table
                table = soup.find('table')
                if not table:
                    logger.warning("NYSE halt table not found")
                    return []

                halts = []
                rows = table.find_all('tr')[1:]  # Skip header

                for row in rows:
                    cols = row.find_all('td')
                    if len(cols) < 4:
                        continue

                    try:
                        # Parse halt data
                        # Format: Symbol | Name | Time | Reason Code
                        ticker = cols[0].text.strip()
                        company_name = cols[1].text.strip()
                        halt_time_str = cols[2].text.strip()
                        halt_code = cols[3].text.strip()

                        # Parse time
                        halt_time = self._parse_nyse_time(halt_time_str)

                        halt = HaltData(
                            ticker=ticker,
                            halt_time=halt_time,
                            halt_code=halt_code,
                            exchange="NYSE",
                            company_name=company_name
                        )

                        halts.append(halt)

                    except Exception as e:
                        logger.error(f"Failed to parse NYSE halt row: {e}")
                        continue

                logger.info(f"Fetched {len(halts)} NYSE halts")
                return halts

        except Exception as e:
            logger.error(f"Failed to fetch NYSE halts: {e}")
            return []

    def _parse_nasdaq_time(self, time_str: str) -> datetime:
        """Parse NASDAQ time format (MM/DD/YYYY HH:MM:SS)"""
        try:
            return datetime.strptime(time_str, "%m/%d/%Y %H:%M:%S")
        except:
            # Try without seconds
            try:
                return datetime.strptime(time_str, "%m/%d/%Y %H:%M")
            except:
                logger.warning(f"Failed to parse NASDAQ time: {time_str}")
                return datetime.now()

    def _parse_nyse_time(self, time_str: str) -> datetime:
        """Parse NYSE time format (HH:MM:SS or similar)"""
        try:
            # NYSE often only shows time, use today's date
            time_only = datetime.strptime(time_str, "%H:%M:%S").time()
            return datetime.combine(datetime.now().date(), time_only)
        except:
            try:
                # Try without seconds
                time_only = datetime.strptime(time_str, "%H:%M").time()
                return datetime.combine(datetime.now().date(), time_only)
            except:
                logger.warning(f"Failed to parse NYSE time: {time_str}")
                return datetime.now()

    async def process_halts(self, halts: List[HaltData]):
        """Process new halt events"""
        for halt in halts:
            # Create unique key for this halt
            halt_key = f"{halt.ticker}_{halt.halt_time.isoformat()}_{halt.halt_code}"

            # Skip if we've already seen this halt
            if halt_key in self.seen_halts:
                continue

            # Mark as seen
            self.seen_halts.add(halt_key)

            # Clean old entries from cache (older than 1 hour)
            if len(self.seen_halts) > 1000:
                self.seen_halts = set(list(self.seen_halts)[-500:])

            # Check if this ticker is tracked for M&A
            is_tracked = halt.ticker in self.tracked_tickers

            # Check if this is a material news halt
            is_material_news = halt.is_material_news_halt()

            # Log the halt
            logger.info(f"New halt: {halt.ticker} ({halt.halt_code}) at {halt.halt_time} - Tracked: {is_tracked}, Material News: {is_material_news}")

            # Store halt event in database
            await self.store_halt_event(halt, is_tracked)

            # If tracked M&A target AND material news halt, trigger high-priority alert
            if is_tracked and is_material_news:
                await self.trigger_halt_alert(halt)

            # NEW: For ALL material news halts (even untracked), create investigation task
            # This ensures we don't miss any potential M&A deals
            elif is_material_news:
                await self.create_halt_investigation_task(halt)

    async def store_halt_event(self, halt: HaltData, is_tracked: bool):
        """Store halt event in database"""
        try:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO halt_events (
                        ticker, halt_time, halt_code, resumption_time,
                        exchange, company_name, is_tracked_ticker, detected_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (ticker, halt_time, halt_code) DO NOTHING
                """,
                    halt.ticker,
                    halt.halt_time,
                    halt.halt_code,
                    halt.resumption_time,
                    halt.exchange,
                    halt.company_name,
                    is_tracked
                )
        except Exception as e:
            logger.error(f"Failed to store halt event: {e}")

    async def trigger_halt_alert(self, halt: HaltData):
        """Trigger alert for M&A target halt"""
        try:
            # Find the deal associated with this ticker
            async with self.db_pool.acquire() as conn:
                deal = await conn.fetchrow("""
                    SELECT deal_id, target_name, acquirer_name, deal_value_usd
                    FROM deal_intelligence
                    WHERE target_ticker = $1
                    AND deal_status NOT IN ('completed', 'terminated')
                    ORDER BY first_detected_at DESC
                    LIMIT 1
                """, halt.ticker)

                if not deal:
                    logger.warning(f"No active deal found for halted ticker {halt.ticker}")
                    return

                # Create alert message
                halt_reason = {
                    'T1': 'News Pending',
                    'T2': 'News Dissemination',
                    'M1': 'News Pending (NYSE)',
                    'M2': 'News Dissemination (NYSE)'
                }.get(halt.halt_code, halt.halt_code)

                message = f"""
🚨 TRADING HALT ALERT - M&A Target

Ticker: {halt.ticker}
Company: {deal['target_name']}
Halt Time: {halt.halt_time.strftime('%Y-%m-%d %H:%M:%S')}
Halt Reason: {halt_reason} ({halt.halt_code})
Exchange: {halt.exchange}

Deal Context:
- Acquirer: {deal['acquirer_name'] or 'N/A'}
- Deal Value: ${deal['deal_value_usd']:.2f}B
- Deal ID: {deal['deal_id']}

This may indicate material news about the acquisition.
                """.strip()

                # Store alert
                await conn.execute("""
                    INSERT INTO alert_notifications (
                        alert_type, severity, title, message,
                        related_deal_id, metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                """,
                    'trading_halt',
                    'high',
                    f"Trading Halt: {halt.ticker} - {halt_reason}",
                    message,
                    deal['deal_id'],
                    {
                        'ticker': halt.ticker,
                        'halt_code': halt.halt_code,
                        'halt_time': halt.halt_time.isoformat(),
                        'exchange': halt.exchange
                    }
                )

                logger.info(f"🚨 HALT ALERT: {halt.ticker} - {halt_reason}")

        except Exception as e:
            logger.error(f"Failed to trigger halt alert: {e}", exc_info=True)

    async def create_halt_investigation_task(self, halt: HaltData):
        """Create investigation task for untracked material news halt"""
        try:
            halt_reason = {
                'T1': 'News Pending',
                'T2': 'News Dissemination',
                'M1': 'M&A Activity Pending',
                'M2': 'M&A Activity Dissemination'
            }.get(halt.halt_code, halt.halt_code)

            async with self.db_pool.acquire() as conn:
                # Check if this ticker already has a recent investigation (within last 24 hours)
                existing = await conn.fetchval("""
                    SELECT COUNT(*)
                    FROM alert_notifications
                    WHERE alert_type = 'halt_investigation'
                    AND metadata->>'ticker' = $1
                    AND created_at > NOW() - INTERVAL '24 hours'
                """, halt.ticker)

                if existing > 0:
                    logger.info(f"Skipping duplicate investigation for {halt.ticker}")
                    return

                message = f"""
🔍 NEW TRADING HALT - Investigation Needed

Ticker: {halt.ticker}
Company: {halt.company_name or 'Unknown'}
Halt Time: {halt.halt_time.strftime('%Y-%m-%d %H:%M:%S')}
Halt Reason: {halt_reason} ({halt.halt_code})
Exchange: {halt.exchange}

This ticker is NOT currently tracked as an M&A target.
Investigate to determine if this halt is M&A-related:
- Check recent SEC filings (8-K, S-4, 425, DEFM14A)
- Search for news announcements
- Look for merger/acquisition language
- If M&A-related, create staged deal for approval

Note: Most T1/T2 halts are NOT M&A (clinical trials, earnings, compliance issues).
M1/M2 codes are more likely to be merger-related.
                """.strip()

                # Store investigation task with medium severity
                await conn.execute("""
                    INSERT INTO alert_notifications (
                        alert_type, severity, title, message,
                        metadata, status
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                """,
                    'halt_investigation',
                    'medium',
                    f"Investigate Halt: {halt.ticker} - {halt_reason}",
                    message,
                    {
                        'ticker': halt.ticker,
                        'company_name': halt.company_name,
                        'halt_code': halt.halt_code,
                        'halt_time': halt.halt_time.isoformat(),
                        'exchange': halt.exchange,
                        'requires_investigation': True
                    },
                    'pending'
                )

                logger.info(f"🔍 INVESTIGATION TASK: {halt.ticker} - {halt_reason}")

        except Exception as e:
            logger.error(f"Failed to create halt investigation task: {e}", exc_info=True)

    async def get_recent_halts(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent halt events from database"""
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT
                        ticker, halt_time, halt_code, resumption_time,
                        exchange, company_name, is_tracked_ticker, detected_at
                    FROM halt_events
                    ORDER BY halt_time DESC
                    LIMIT $1
                """, limit)

                return [dict(row) for row in rows]

        except Exception as e:
            logger.error(f"Failed to fetch recent halts: {e}")
            return []

    async def get_status(self) -> Dict[str, Any]:
        """Get halt monitor status"""
        return {
            'is_running': self.is_running,
            'tracked_tickers_count': len(self.tracked_tickers),
            'seen_halts_count': len(self.seen_halts),
            'poll_interval_seconds': self.POLL_INTERVAL
        }


# Global halt monitor instance
_halt_monitor = None


def get_halt_monitor() -> HaltMonitor:
    """Get or create halt monitor instance"""
    global _halt_monitor
    if _halt_monitor is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _halt_monitor = HaltMonitor(db_url)
    return _halt_monitor
