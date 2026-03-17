"""
Historical Options Data Loader — Polygon API

Loads options data for M&A deal targets to analyze:
  1. Above-deal-price call activity (higher-bid signal)
  2. ATM IV levels (overall uncertainty)
  3. Put/call ratios (directional sentiment)
  4. Covered call premiums (trade expression analysis)
  5. Term structure (front vs back month)

Architecture:
  Tier 1: research_options_daily — one row per deal per day (computed aggregates)
  Tier 2: research_options_chains — full snapshots at event windows only

Polygon API limitations:
  - No historical greeks/IV — we self-compute via Black-Scholes
  - Historical contracts via /v3/reference/options/contracts (paginated, 1000/page)
  - Per-contract daily OHLCV via /v2/aggs/ticker/{OCC_symbol}/range/1/day/{from}/{to}
  - Rate limit: ~100 req/s on paid plans, but be conservative
"""

import asyncio
import logging
import math
import os
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import asyncpg
import httpx

from .black_scholes import bs_delta, bs_gamma, bs_theta, implied_volatility

logger = logging.getLogger(__name__)

POLYGON_BASE_URL = "https://api.polygon.io"
POLYGON_RATE_DELAY = 0.05  # 20 req/s conservative


class OptionsDataLoader:
    """
    Loads historical options data from Polygon for M&A deal analysis.

    Key metrics computed per deal per day:
      - ATM IV (call and put)
      - Above-deal-price call volume, OI, and avg IV
      - Put/call ratio
      - Covered-call yield at deal-price strike
      - IV skew (upside vs downside)
      - Term structure
    """

    def __init__(self):
        self.api_key = os.environ.get("POLYGON_API_KEY", "")
        self.client: Optional[httpx.AsyncClient] = None
        self._risk_free_rate = 0.045  # Approximate, can be updated

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.api_key}"},
                follow_redirects=True,
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    # =========================================================================
    # Contract discovery
    # =========================================================================

    async def list_historical_contracts(
        self,
        underlying_ticker: str,
        expiration_gte: date,
        expiration_lte: date,
        as_of: Optional[date] = None,
    ) -> List[dict]:
        """
        List historical options contracts for a ticker.

        Uses Polygon's /v3/reference/options/contracts endpoint.
        Includes expired contracts (critical for historical analysis).
        """
        client = await self._get_client()
        all_contracts = []
        next_url = None

        params = {
            "underlying_ticker": underlying_ticker,
            "expiration_date.gte": expiration_gte.isoformat(),
            "expiration_date.lte": expiration_lte.isoformat(),
            "expired": "true",
            "limit": 1000,
            "order": "asc",
            "sort": "expiration_date",
        }
        if as_of:
            params["as_of"] = as_of.isoformat()

        url = f"{POLYGON_BASE_URL}/v3/reference/options/contracts"

        while True:
            try:
                await asyncio.sleep(POLYGON_RATE_DELAY)
                if next_url:
                    response = await client.get(next_url)
                else:
                    response = await client.get(url, params=params)

                if response.status_code == 429:
                    await asyncio.sleep(2)
                    continue

                response.raise_for_status()
                data = response.json()

                results = data.get("results", [])
                all_contracts.extend(results)

                next_url = data.get("next_url")
                if next_url:
                    # Polygon next_url includes API key
                    if "apiKey" not in next_url:
                        next_url += f"&apiKey={self.api_key}"
                else:
                    break

            except Exception as e:
                logger.error(f"Error listing contracts for {underlying_ticker}: {e}")
                break

        logger.info(
            f"Found {len(all_contracts)} option contracts for {underlying_ticker} "
            f"({expiration_gte} to {expiration_lte})"
        )
        return all_contracts

    # =========================================================================
    # Per-contract price data
    # =========================================================================

    async def fetch_contract_bars(
        self,
        occ_symbol: str,
        from_date: date,
        to_date: date,
    ) -> List[dict]:
        """
        Fetch daily OHLCV for a single options contract.

        OCC symbol format: O:{TICKER}{YYMMDD}{C/P}{STRIKE*1000}
        e.g., O:ATVI230120C00070000
        """
        client = await self._get_client()

        try:
            await asyncio.sleep(POLYGON_RATE_DELAY)
            response = await client.get(
                f"{POLYGON_BASE_URL}/v2/aggs/ticker/{occ_symbol}/range/1/day/"
                f"{from_date.isoformat()}/{to_date.isoformat()}",
                params={"adjusted": "true", "sort": "asc", "limit": 5000},
            )

            if response.status_code == 429:
                await asyncio.sleep(2)
                response = await client.get(
                    f"{POLYGON_BASE_URL}/v2/aggs/ticker/{occ_symbol}/range/1/day/"
                    f"{from_date.isoformat()}/{to_date.isoformat()}",
                    params={"adjusted": "true", "sort": "asc", "limit": 5000},
                )

            if response.status_code == 404:
                return []  # No data for this contract

            response.raise_for_status()
            data = response.json()
            return data.get("results", [])

        except Exception as e:
            logger.debug(f"Error fetching bars for {occ_symbol}: {e}")
            return []

    # =========================================================================
    # Chain reconstruction for a single date
    # =========================================================================

    async def reconstruct_chain(
        self,
        underlying_ticker: str,
        target_date: date,
        underlying_close: float,
        deal_price: Optional[float],
        contracts: List[dict],
    ) -> List[dict]:
        """
        Reconstruct the options chain for a specific date.

        For each contract that was active on target_date:
          - Fetch its OHLCV close on that date
          - Compute IV via Black-Scholes inversion
          - Compute greeks

        Returns list of chain entries with computed IV and greeks.
        """
        # Filter to contracts active on the target date
        active = []
        for c in contracts:
            exp = date.fromisoformat(c.get("expiration_date", "2000-01-01"))
            # Contract must expire after target date and have been listed before
            if exp >= target_date:
                active.append(c)

        if not active:
            return []

        # Batch fetch: get bars for each active contract on the target date
        chain = []
        for contract in active:
            ticker = contract.get("ticker", "")
            if not ticker:
                continue

            bars = await self.fetch_contract_bars(
                ticker,
                target_date,
                target_date + timedelta(days=1),
            )

            if not bars:
                continue

            bar = bars[0]
            close_price = bar.get("c", 0)
            if close_price <= 0:
                continue

            # Parse contract details
            strike = contract.get("strike_price", 0)
            exp_date = date.fromisoformat(contract.get("expiration_date", "2000-01-01"))
            opt_type = "C" if contract.get("contract_type", "").lower() == "call" else "P"

            # Time to expiry
            T = max((exp_date - target_date).days, 1) / 365.0

            # Compute IV
            mid = close_price  # Use close as proxy
            iv = implied_volatility(
                market_price=mid,
                S=underlying_close,
                K=strike,
                T=T,
                r=self._risk_free_rate,
                option_type=opt_type,
            )

            # Compute greeks if IV available
            delta = None
            gamma = None
            theta = None
            if iv and iv > 0:
                delta = bs_delta(underlying_close, strike, T, self._risk_free_rate, iv, opt_type)
                gamma = bs_gamma(underlying_close, strike, T, self._risk_free_rate, iv)
                theta = bs_theta(underlying_close, strike, T, self._risk_free_rate, iv, opt_type)

            chain.append({
                "contract_symbol": ticker,
                "expiration_date": exp_date,
                "strike": strike,
                "option_type": opt_type,
                "close": close_price,
                "bid": bar.get("l"),  # Low as proxy for bid
                "ask": bar.get("h"),  # High as proxy for ask
                "mid": close_price,
                "volume": bar.get("v", 0),
                "open_interest": contract.get("open_interest"),
                "implied_vol": iv,
                "delta": delta,
                "gamma": gamma,
                "theta": theta,
                "underlying_close": underlying_close,
                "deal_price": deal_price,
            })

        return chain

    # =========================================================================
    # Daily options summary computation
    # =========================================================================

    def compute_daily_summary(
        self,
        chain: List[dict],
        underlying_close: float,
        deal_price: Optional[float],
    ) -> dict:
        """
        Compute the daily options summary from a reconstructed chain.

        Key metrics for the higher-bid / covered-call analysis:
          - ATM IV (call and put)
          - Above-deal-price call metrics (THE higher-bid signal)
          - Covered-call yield at deal-price strike
          - Put/call ratio
          - IV skew
          - Term structure
        """
        if not chain:
            return {}

        calls = [c for c in chain if c["option_type"] == "C"]
        puts = [c for c in chain if c["option_type"] == "P"]

        # ATM = nearest strike to underlying
        atm_call_iv = self._nearest_atm_iv(calls, underlying_close)
        atm_put_iv = self._nearest_atm_iv(puts, underlying_close)

        # Volume and OI
        total_call_vol = sum(c.get("volume", 0) or 0 for c in calls)
        total_put_vol = sum(c.get("volume", 0) or 0 for c in puts)
        total_call_oi = sum(c.get("open_interest", 0) or 0 for c in calls)
        total_put_oi = sum(c.get("open_interest", 0) or 0 for c in puts)
        pcr = total_put_vol / total_call_vol if total_call_vol > 0 else None

        # Above-deal-price call metrics (THE key higher-bid signal)
        above_deal_call_vol = 0
        above_deal_call_oi = 0
        above_deal_ivs = []
        covered_call_yield = None

        if deal_price:
            for c in calls:
                if c["strike"] > deal_price * 1.005:  # Above deal price
                    above_deal_call_vol += c.get("volume", 0) or 0
                    above_deal_call_oi += c.get("open_interest", 0) or 0
                    if c.get("implied_vol"):
                        above_deal_ivs.append(c["implied_vol"])

            # Covered-call yield: premium from selling the call nearest to deal price
            deal_strike_call = self._nearest_strike_option(calls, deal_price)
            if deal_strike_call and deal_strike_call.get("close"):
                # Annualized covered-call yield
                premium = deal_strike_call["close"]
                days_to_exp = max(
                    (deal_strike_call["expiration_date"] - date.today()).days, 1
                )
                covered_call_yield = (premium / underlying_close) * (365 / days_to_exp)

        # Upside call IV (at deal price strike)
        upside_call_iv = None
        if deal_price:
            deal_call = self._nearest_strike_option(calls, deal_price)
            if deal_call:
                upside_call_iv = deal_call.get("implied_vol")

        # Downside put IV (at estimated break price — 20% below deal)
        downside_put_iv = None
        if deal_price:
            break_price = deal_price * 0.80
            break_put = self._nearest_strike_option(puts, break_price)
            if break_put:
                downside_put_iv = break_put.get("implied_vol")

        # Skew
        skew_ratio = None
        if upside_call_iv and downside_put_iv and downside_put_iv > 0:
            skew_ratio = upside_call_iv / downside_put_iv

        # 25-delta skew
        call_25d_iv = self._delta_targeted_iv(calls, 0.25)
        put_25d_iv = self._delta_targeted_iv(puts, -0.25)
        call_skew_25d = (call_25d_iv - atm_call_iv) if call_25d_iv and atm_call_iv else None
        put_skew_25d = (put_25d_iv - atm_put_iv) if put_25d_iv and atm_put_iv else None

        # Term structure (front month vs back month)
        front_iv, back_iv = self._term_structure(calls, underlying_close)
        term_slope = (back_iv - front_iv) if front_iv and back_iv else None

        return {
            "stock_close": underlying_close,
            "deal_price": deal_price,
            "atm_call_iv": atm_call_iv,
            "atm_put_iv": atm_put_iv,
            "upside_call_iv": upside_call_iv,
            "downside_put_iv": downside_put_iv,
            "call_skew_25d": call_skew_25d,
            "put_skew_25d": put_skew_25d,
            "skew_ratio": skew_ratio,
            "total_call_volume": total_call_vol,
            "total_put_volume": total_put_vol,
            "put_call_ratio": pcr,
            "total_call_oi": total_call_oi,
            "total_put_oi": total_put_oi,
            "above_deal_call_volume": above_deal_call_vol,
            "above_deal_call_oi": above_deal_call_oi,
            "above_deal_call_iv_avg": (
                sum(above_deal_ivs) / len(above_deal_ivs) if above_deal_ivs else None
            ),
            "front_month_iv": front_iv,
            "back_month_iv": back_iv,
            "term_structure_slope": term_slope,
            "chain_depth": len(chain),
            "covered_call_yield_ann": covered_call_yield,
        }

    # =========================================================================
    # Helper methods for chain analysis
    # =========================================================================

    @staticmethod
    def _nearest_atm_iv(options: List[dict], underlying: float) -> Optional[float]:
        """Find IV of the option with strike nearest to the underlying price."""
        if not options:
            return None
        nearest = min(options, key=lambda c: abs(c["strike"] - underlying))
        return nearest.get("implied_vol")

    @staticmethod
    def _nearest_strike_option(options: List[dict], target_strike: float) -> Optional[dict]:
        """Find the option with strike nearest to a target price."""
        if not options:
            return None
        return min(options, key=lambda c: abs(c["strike"] - target_strike))

    @staticmethod
    def _delta_targeted_iv(options: List[dict], target_delta: float) -> Optional[float]:
        """Find IV of the option with delta nearest to target."""
        with_delta = [c for c in options if c.get("delta") is not None]
        if not with_delta:
            return None
        nearest = min(with_delta, key=lambda c: abs(c["delta"] - target_delta))
        return nearest.get("implied_vol")

    @staticmethod
    def _term_structure(
        calls: List[dict], underlying: float
    ) -> Tuple[Optional[float], Optional[float]]:
        """
        Compute front-month and back-month ATM IV.

        Front = nearest expiration, Back = next expiration after front.
        """
        if not calls:
            return None, None

        # Group by expiration
        by_exp: Dict[date, List[dict]] = {}
        for c in calls:
            exp = c["expiration_date"]
            by_exp.setdefault(exp, []).append(c)

        sorted_exps = sorted(by_exp.keys())
        if len(sorted_exps) < 2:
            return None, None

        # Front month: nearest ATM call IV
        front_calls = by_exp[sorted_exps[0]]
        front_atm = min(front_calls, key=lambda c: abs(c["strike"] - underlying))
        front_iv = front_atm.get("implied_vol")

        # Back month: next expiration ATM call IV
        back_calls = by_exp[sorted_exps[1]]
        back_atm = min(back_calls, key=lambda c: abs(c["strike"] - underlying))
        back_iv = back_atm.get("implied_vol")

        return front_iv, back_iv

    # =========================================================================
    # Database storage
    # =========================================================================

    async def store_daily_summary(
        self,
        conn: asyncpg.Connection,
        deal_id: UUID,
        ticker: str,
        trade_date: date,
        summary: dict,
    ) -> bool:
        """Store a daily options summary row."""
        if not summary:
            return False

        try:
            await conn.execute(
                """
                INSERT INTO research_options_daily (
                    deal_id, ticker, trade_date,
                    stock_close, deal_price,
                    atm_call_iv, atm_put_iv,
                    upside_call_iv, downside_put_iv,
                    call_skew_25d, put_skew_25d, skew_ratio,
                    total_call_volume, total_put_volume, put_call_ratio,
                    total_call_oi, total_put_oi,
                    above_deal_call_volume, above_deal_call_oi, above_deal_call_iv_avg,
                    front_month_iv, back_month_iv, term_structure_slope,
                    chain_depth, source
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                )
                ON CONFLICT (deal_id, ticker, trade_date) DO UPDATE SET
                    atm_call_iv = $6, atm_put_iv = $7,
                    above_deal_call_volume = $18, above_deal_call_oi = $19,
                    chain_depth = $24
                """,
                deal_id, ticker, trade_date,
                summary.get("stock_close"),
                summary.get("deal_price"),
                summary.get("atm_call_iv"),
                summary.get("atm_put_iv"),
                summary.get("upside_call_iv"),
                summary.get("downside_put_iv"),
                summary.get("call_skew_25d"),
                summary.get("put_skew_25d"),
                summary.get("skew_ratio"),
                summary.get("total_call_volume"),
                summary.get("total_put_volume"),
                summary.get("put_call_ratio"),
                summary.get("total_call_oi"),
                summary.get("total_put_oi"),
                summary.get("above_deal_call_volume"),
                summary.get("above_deal_call_oi"),
                summary.get("above_deal_call_iv_avg"),
                summary.get("front_month_iv"),
                summary.get("back_month_iv"),
                summary.get("term_structure_slope"),
                summary.get("chain_depth"),
                "polygon",
            )
            return True
        except Exception as e:
            logger.warning(f"Error storing options daily for {ticker} {trade_date}: {e}")
            return False

    async def store_chain_snapshot(
        self,
        conn: asyncpg.Connection,
        deal_id: UUID,
        ticker: str,
        snapshot_date: date,
        snapshot_reason: str,
        chain: List[dict],
    ) -> int:
        """Store a full chain snapshot (event-window snapshots only)."""
        stored = 0
        for entry in chain:
            try:
                await conn.execute(
                    """
                    INSERT INTO research_options_chains (
                        deal_id, ticker, snapshot_date, snapshot_reason,
                        contract_symbol, expiration_date, strike, option_type,
                        bid, ask, mid, last,
                        implied_vol, delta, gamma, theta, vega,
                        volume, open_interest,
                        underlying_close, deal_price, source
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11, $12, $13, $14, $15, $16, NULL,
                        $17, $18, $19, $20, $21
                    )
                    """,
                    deal_id, ticker, snapshot_date, snapshot_reason,
                    entry.get("contract_symbol"),
                    entry.get("expiration_date"),
                    entry.get("strike"),
                    entry.get("option_type"),
                    entry.get("bid"),
                    entry.get("ask"),
                    entry.get("mid"),
                    entry.get("close"),
                    entry.get("implied_vol"),
                    entry.get("delta"),
                    entry.get("gamma"),
                    entry.get("theta"),
                    entry.get("volume"),
                    entry.get("open_interest"),
                    entry.get("underlying_close"),
                    entry.get("deal_price"),
                    "polygon",
                )
                stored += 1
            except Exception as e:
                logger.debug(f"Error storing chain entry: {e}")

        return stored

    # =========================================================================
    # High-level deal loading
    # =========================================================================

    async def load_options_for_deal(
        self,
        conn: asyncpg.Connection,
        deal_id: UUID,
        ticker: str,
        announced_date: date,
        deal_price: Optional[float],
        end_date: Optional[date] = None,
        weekly_snapshots: bool = True,
    ) -> Dict[str, int]:
        """
        Load all options data for a single deal.

        Steps:
          1. List all contracts for the ticker during the deal window
          2. For each Friday (weekly) or event date, reconstruct the chain
          3. Compute daily summary and store
          4. Store full chain snapshots for announcement and other events

        Returns count of daily summaries and chain snapshots stored.
        """
        window_start = announced_date - timedelta(days=5)
        window_end = end_date or (date.today() - timedelta(days=1))

        # Get underlying stock prices for the window
        stock_prices = await self._fetch_stock_closes(ticker, window_start, window_end)
        if not stock_prices:
            logger.warning(f"No stock data for {ticker} — skipping options")
            return {"daily_summaries": 0, "chain_snapshots": 0}

        # List all contracts (one API call, paginated)
        contracts = await self.list_historical_contracts(
            underlying_ticker=ticker,
            expiration_gte=window_start,
            expiration_lte=window_end + timedelta(days=180),
        )

        if not contracts:
            logger.warning(f"No options contracts found for {ticker}")
            return {"daily_summaries": 0, "chain_snapshots": 0}

        # Determine which dates to process
        # Weekly: every Friday + announcement day + announcement+5
        process_dates = set()

        # Announcement window
        for offset in [0, 1, 5]:
            d = announced_date + timedelta(days=offset)
            if d in stock_prices:
                process_dates.add(d)

        # Weekly Fridays
        if weekly_snapshots:
            current = window_start
            while current <= window_end:
                if current.weekday() == 4 and current in stock_prices:  # Friday
                    process_dates.add(current)
                current += timedelta(days=1)

        sorted_dates = sorted(process_dates)
        logger.info(
            f"Processing {len(sorted_dates)} dates for {ticker} "
            f"({len(contracts)} contracts)"
        )

        daily_count = 0
        chain_count = 0

        for proc_date in sorted_dates:
            underlying_close = stock_prices.get(proc_date)
            if not underlying_close:
                continue

            # Reconstruct chain for this date
            chain = await self.reconstruct_chain(
                underlying_ticker=ticker,
                target_date=proc_date,
                underlying_close=underlying_close,
                deal_price=deal_price,
                contracts=contracts,
            )

            if not chain:
                continue

            # Compute and store daily summary
            summary = self.compute_daily_summary(chain, underlying_close, deal_price)
            if await self.store_daily_summary(conn, deal_id, ticker, proc_date, summary):
                daily_count += 1

            # Store full chain snapshot for announcement dates
            reason = None
            if proc_date == announced_date:
                reason = "announcement"
            elif proc_date == announced_date + timedelta(days=1):
                reason = "announcement"
            elif proc_date == announced_date + timedelta(days=5):
                reason = "announcement"
            elif proc_date.weekday() == 4:
                reason = "weekly"

            if reason:
                stored = await self.store_chain_snapshot(
                    conn, deal_id, ticker, proc_date, reason, chain
                )
                chain_count += stored

        logger.info(
            f"Options loaded for {ticker}: {daily_count} daily summaries, "
            f"{chain_count} chain entries"
        )
        return {"daily_summaries": daily_count, "chain_snapshots": chain_count}

    async def _fetch_stock_closes(
        self, ticker: str, from_date: date, to_date: date
    ) -> Dict[date, float]:
        """Fetch daily close prices for the underlying stock."""
        client = await self._get_client()

        try:
            await asyncio.sleep(POLYGON_RATE_DELAY)
            response = await client.get(
                f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/"
                f"{from_date.isoformat()}/{to_date.isoformat()}",
                params={"adjusted": "true", "sort": "asc", "limit": 5000},
            )
            response.raise_for_status()
            data = response.json()

            prices = {}
            for bar in data.get("results", []):
                ts = bar.get("t", 0) / 1000
                bar_date = datetime.utcfromtimestamp(ts).date()
                prices[bar_date] = bar.get("c", 0)

            return prices
        except Exception as e:
            logger.error(f"Error fetching stock closes for {ticker}: {e}")
            return {}

    # =========================================================================
    # Bulk loading
    # =========================================================================

    async def load_all_deals(
        self,
        conn: asyncpg.Connection,
        limit: Optional[int] = None,
        min_year: int = 2019,  # Polygon options data starts ~2019
    ) -> Dict[str, int]:
        """
        Load options data for all deals that need it.

        Only processes deals from 2019+ (Polygon options data availability).
        Requires deal_price to be set (for above-deal-price analysis).
        """
        query = """
            SELECT deal_id, target_ticker, announced_date, actual_close_date,
                   terminated_date, initial_deal_value_mm
            FROM research_deals
            WHERE target_ticker IS NOT NULL
              AND target_ticker != 'UNK'
              AND announced_date >= $1
              AND deal_id NOT IN (
                  SELECT DISTINCT deal_id FROM research_options_daily
              )
            ORDER BY announced_date DESC
        """
        params = [date(min_year, 1, 1)]
        if limit:
            query += f" LIMIT {limit}"

        deals = await conn.fetch(query, *params)
        logger.info(f"Loading options data for {len(deals)} deals")

        results = {"loaded": 0, "failed": 0, "total_summaries": 0, "total_chains": 0}

        for deal in deals:
            try:
                end = deal["actual_close_date"] or deal["terminated_date"]
                counts = await self.load_options_for_deal(
                    conn=conn,
                    deal_id=deal["deal_id"],
                    ticker=deal["target_ticker"],
                    announced_date=deal["announced_date"],
                    deal_price=None,  # Will use from enrichment later
                    end_date=end,
                    weekly_snapshots=True,
                )
                results["loaded"] += 1
                results["total_summaries"] += counts["daily_summaries"]
                results["total_chains"] += counts["chain_snapshots"]
            except Exception as e:
                logger.error(f"Failed options for {deal['target_ticker']}: {e}")
                results["failed"] += 1

        return results
