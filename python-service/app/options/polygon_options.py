"""Polygon REST API client for options and stock data.

Primary data source for the curate/monitor tabs on the dashboard.
Falls back to IB via the WebSocket relay when Polygon is unavailable.

Uses httpx async client with retry/backoff for resilience.
Designed for low-latency REST polling (~100-500ms per call vs 3-180s via IB relay).
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.polygon.io"
_MAX_RETRIES = 3
_BACKOFF_BASE_S = 1.0
_DEFAULT_TIMEOUT = 15.0


class PolygonError(Exception):
    """Raised when Polygon API calls fail after retries."""
    pass


class PolygonOptionsClient:
    """Async Polygon REST client for stock quotes and options chain data.

    Call ``get_polygon_client()`` for the module-level shared instance.
    """

    def __init__(self, api_key: str | None = None, timeout: float = _DEFAULT_TIMEOUT):
        self._api_key = api_key or os.environ.get("POLYGON_API_KEY", "")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ── Stock quotes ─────────────────────────────────────────

    async def health_check(self, ticker: str = "SPY") -> dict:
        """Pre-open health check — validates API key, data freshness, and latency.

        Tests:
        1. API authentication (any successful call)
        2. Stock snapshot freshness (updated timestamp)
        3. Options chain reachability (at least 1 contract returned)
        4. Round-trip latency for each call

        Returns a dict with per-check results suitable for dashboard display.
        Stock snapshots clear at 3:30 AM EST and start updating ~4:00 AM EST.
        Options quotes reflect previous-day values until 9:30 AM open.
        """
        import time as _time

        results: dict[str, Any] = {
            "polygon_configured": self.is_configured,
            "ticker": ticker,
            "checks": {},
            "overall": "fail",
        }

        # 1. Stock snapshot — also proves auth
        t0 = _time.monotonic()
        try:
            data = await self._get(
                f"/v2/snapshot/locale/us/markets/stocks/tickers/{ticker.upper()}"
            )
            latency_ms = (_time.monotonic() - t0) * 1000
            snap = data.get("ticker", {})
            updated_ns = snap.get("updated", 0)
            # Polygon returns nanosecond epoch for 'updated'
            if updated_ns > 1e15:  # nanoseconds
                updated_dt = datetime.utcfromtimestamp(updated_ns / 1e9)
            elif updated_ns > 1e12:  # milliseconds
                updated_dt = datetime.utcfromtimestamp(updated_ns / 1e3)
            else:
                updated_dt = datetime.utcfromtimestamp(updated_ns) if updated_ns else None

            age_s = (datetime.utcnow() - updated_dt).total_seconds() if updated_dt else None
            prev_close = (snap.get("prevDay") or {}).get("c", 0)
            last_trade_price = (snap.get("lastTrade") or {}).get("p", 0)

            results["checks"]["stock_snapshot"] = {
                "ok": True,
                "latency_ms": round(latency_ms, 1),
                "updated": updated_dt.isoformat() + "Z" if updated_dt else None,
                "age_seconds": round(age_s, 0) if age_s is not None else None,
                "prev_close": prev_close,
                "last_trade": last_trade_price,
                "has_pre_market": bool(last_trade_price and last_trade_price != prev_close),
            }
        except Exception as exc:
            latency_ms = (_time.monotonic() - t0) * 1000
            results["checks"]["stock_snapshot"] = {
                "ok": False,
                "latency_ms": round(latency_ms, 1),
                "error": str(exc),
            }

        # 2. Previous day bar (always available, lightweight)
        t0 = _time.monotonic()
        try:
            prev = await self._get(
                f"/v2/aggs/ticker/{ticker.upper()}/prev"
            )
            latency_ms = (_time.monotonic() - t0) * 1000
            prev_results = prev.get("results", [])
            results["checks"]["prev_day"] = {
                "ok": bool(prev_results),
                "latency_ms": round(latency_ms, 1),
                "close": prev_results[0].get("c") if prev_results else None,
                "volume": prev_results[0].get("v") if prev_results else None,
            }
        except Exception as exc:
            latency_ms = (_time.monotonic() - t0) * 1000
            results["checks"]["prev_day"] = {
                "ok": False,
                "latency_ms": round(latency_ms, 1),
                "error": str(exc),
            }

        # 3. Options chain snapshot (1 page, small limit)
        t0 = _time.monotonic()
        try:
            opts = await self._get(
                f"/v3/snapshot/options/{ticker.upper()}",
                params={"limit": 5},
            )
            latency_ms = (_time.monotonic() - t0) * 1000
            opt_results = opts.get("results", [])
            has_greeks = any(
                (r.get("greeks") or {}).get("delta") is not None
                for r in opt_results
            )
            results["checks"]["options_chain"] = {
                "ok": bool(opt_results),
                "latency_ms": round(latency_ms, 1),
                "contracts_returned": len(opt_results),
                "has_greeks": has_greeks,
            }
        except Exception as exc:
            latency_ms = (_time.monotonic() - t0) * 1000
            results["checks"]["options_chain"] = {
                "ok": False,
                "latency_ms": round(latency_ms, 1),
                "error": str(exc),
            }

        # Overall verdict
        all_ok = all(c.get("ok") for c in results["checks"].values())
        results["overall"] = "pass" if all_ok else "degraded"
        # If stock snapshot failed, it's a hard fail (auth broken)
        if not results["checks"].get("stock_snapshot", {}).get("ok"):
            results["overall"] = "fail"

        return results

    async def get_stock_quote(self, ticker: str) -> dict:
        """Fetch real-time stock snapshot.

        Returns dict with keys: ticker, price, bid, ask, timestamp.
        """
        data = await self._get(
            f"/v2/snapshot/locale/us/markets/stocks/tickers/{ticker.upper()}"
        )
        snap = data.get("ticker", {})
        last_quote = snap.get("lastQuote", {})
        last_trade = snap.get("lastTrade", {})
        day = snap.get("day", {})

        price = last_trade.get("p", 0) or day.get("c", 0)
        bid = last_quote.get("p", 0)  # lowercase p = bid price
        ask = last_quote.get("P", 0)  # uppercase P = ask price

        return {
            "ticker": ticker.upper(),
            "price": price,
            "bid": bid,
            "ask": ask,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    async def get_batch_stock_quotes(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch real-time stock snapshots for multiple tickers in one call.

        Returns dict keyed by ticker with: ticker, price, change, change_pct, updated.
        """
        if not tickers:
            return {}
        joined = ",".join(t.upper() for t in tickers)
        data = await self._get(
            "/v2/snapshot/locale/us/markets/stocks/tickers",
            params={"tickers": joined},
        )
        results = {}
        for snap in data.get("tickers", []):
            t = snap.get("ticker", "")
            day = snap.get("day", {})
            last_trade = snap.get("lastTrade", {})
            prev_day = snap.get("prevDay", {})
            price = last_trade.get("p", 0) or day.get("c", 0)
            prev_close = prev_day.get("c", 0)
            change = price - prev_close if price and prev_close else 0
            change_pct = (change / prev_close) if prev_close else 0
            results[t] = {
                "ticker": t,
                "price": price,
                "change": round(change, 4),
                "change_pct": round(change_pct, 6),
                "updated": snap.get("updated", 0),
            }
        return results

    # ── Options chain ────────────────────────────────────────

    async def get_option_chain(
        self,
        underlying: str,
        *,
        expiration_date: str | None = None,
        expiration_date_gte: str | None = None,
        expiration_date_lte: str | None = None,
        strike_gte: float | None = None,
        strike_lte: float | None = None,
        contract_type: str | None = None,
        limit: int = 250,
    ) -> list[dict]:
        """Fetch options chain snapshot with optional filters.

        Returns list of parsed contract dicts matching the OptionContract schema.
        Handles pagination automatically.
        """
        params: dict[str, Any] = {"limit": limit}
        if expiration_date:
            params["expiration_date"] = expiration_date
        if expiration_date_gte:
            params["expiration_date.gte"] = expiration_date_gte
        if expiration_date_lte:
            params["expiration_date.lte"] = expiration_date_lte
        if strike_gte is not None:
            params["strike_price.gte"] = strike_gte
        if strike_lte is not None:
            params["strike_price.lte"] = strike_lte
        if contract_type:
            params["contract_type"] = contract_type

        all_contracts: list[dict] = []
        url: str | None = f"/v3/snapshot/options/{underlying.upper()}"
        page = 0

        while url:
            data = await self._get(url, params if page == 0 else None)
            for snap in data.get("results", []):
                all_contracts.append(
                    self._parse_option_snapshot(snap, underlying.upper())
                )
            url = data.get("next_url")
            page += 1

        return all_contracts

    async def get_option_prices(
        self, contracts: list[dict]
    ) -> list[dict | None]:
        """Fetch current prices for specific option contracts.

        Groups by (underlying, expiry) for efficient batching.
        Returns list parallel to input — None for contracts that couldn't be priced.
        """
        groups: dict[tuple[str, str], list[tuple[int, dict]]] = defaultdict(list)
        for idx, c in enumerate(contracts):
            ticker = c.get("ticker", "")
            expiry = c.get("expiry", "")
            groups[(ticker, expiry)].append((idx, c))

        results: list[dict | None] = [None] * len(contracts)

        for (ticker, expiry), items in groups.items():
            strikes = [it[1].get("strike", 0) for it in items]
            min_strike = min(strikes) - 0.5
            max_strike = max(strikes) + 0.5

            # Convert YYYYMMDD → YYYY-MM-DD for Polygon
            exp_fmt = (
                f"{expiry[:4]}-{expiry[4:6]}-{expiry[6:8]}"
                if len(expiry) == 8
                else expiry
            )

            try:
                chain = await self.get_option_chain(
                    underlying=ticker,
                    expiration_date=exp_fmt,
                    strike_gte=min_strike,
                    strike_lte=max_strike,
                )
            except PolygonError as exc:
                logger.warning(
                    "Polygon: failed to fetch prices for %s exp=%s: %s",
                    ticker, expiry, exc,
                )
                continue

            # Index by (strike, right) for O(1) lookup
            by_key: dict[tuple[float, str], dict] = {}
            for contract in chain:
                key = (contract["strike"], contract["right"])
                by_key[key] = contract

            logger.info(
                "Polygon chain for %s exp=%s: %d contracts, strikes=%s",
                ticker, exp_fmt, len(chain),
                sorted(set(k[0] for k in by_key.keys()))[:10],
            )

            for orig_idx, spec in items:
                key = (spec.get("strike", 0), spec.get("right", ""))
                match = by_key.get(key)
                if not match:
                    logger.warning(
                        "Polygon: no match for %s strike=%s right=%s (available: %s)",
                        ticker, spec.get("strike"), spec.get("right"),
                        sorted(set(k[0] for k in by_key.keys())),
                    )
                if match:
                    results[orig_idx] = {
                        "ticker": spec.get("ticker", ticker),
                        "strike": match["strike"],
                        "expiry": match["expiry"],
                        "right": match["right"],
                        "bid": match["bid"],
                        "ask": match["ask"],
                        "mid": match["mid"],
                        "last": match.get("last", 0),
                        "volume": match.get("volume", 0),
                        "openInterest": match.get("open_interest", 0),
                        "bidSize": match.get("bid_size", 0),
                        "askSize": match.get("ask_size", 0),
                    }

        return results

    async def check_options_available(self, ticker: str) -> dict:
        """Check if a ticker has listed options.

        Returns dict with ``available`` (bool) and ``expirationCount`` (int).
        """
        try:
            contracts = await self.get_option_chain(
                underlying=ticker, limit=250
            )
            if not contracts:
                return {"available": False, "expirationCount": 0}
            expirations = {c["expiry"] for c in contracts if c.get("expiry")}
            return {"available": True, "expirationCount": len(expirations)}
        except PolygonError:
            return {"available": False, "expirationCount": 0}

    async def get_sell_scan(
        self, ticker: str, right: str = "C", spot_price: float | None = None
    ) -> dict:
        """Fetch near-the-money contracts for selling.

        Returns dict with ``ticker``, ``spotPrice``, ``right``, ``expirations``,
        and ``contracts`` keys — matching the IB agent response format.
        """
        if spot_price is None:
            quote = await self.get_stock_quote(ticker)
            spot_price = quote["price"]

        if not spot_price or spot_price <= 0:
            raise PolygonError(f"Cannot determine spot price for {ticker}")

        # ATM ± sensible range (at least $5 or 3% of price)
        spread = max(5.0, spot_price * 0.03)
        strike_gte = spot_price - spread
        strike_lte = spot_price + spread

        # Next ~15 business days ≈ 21 calendar days
        today = datetime.utcnow().strftime("%Y-%m-%d")
        max_date = (datetime.utcnow() + timedelta(days=21)).strftime("%Y-%m-%d")

        contracts = await self.get_option_chain(
            underlying=ticker,
            expiration_date_gte=today,
            expiration_date_lte=max_date,
            strike_gte=strike_gte,
            strike_lte=strike_lte,
            contract_type="call" if right == "C" else "put",
        )

        # Only contracts with bid > 0
        contracts = [c for c in contracts if c.get("bid", 0) > 0]

        # Group by expiration
        by_expiry: dict[str, list[dict]] = defaultdict(list)
        for c in contracts:
            by_expiry[c["expiry"]].append(c)

        all_expirations = sorted(by_expiry.keys())
        flat_contracts = []
        for expiry in all_expirations:
            flat_contracts.extend(
                sorted(by_expiry[expiry], key=lambda x: x["strike"])
            )

        return {
            "ticker": ticker,
            "spotPrice": spot_price,
            "right": right,
            "expirations": all_expirations,
            "contracts": flat_contracts,
        }

    # ── IV / Volume helpers ────────────────────────────────────

    @staticmethod
    def get_atm_iv(chain: list[dict], current_price: float) -> float | None:
        """Extract ATM implied volatility from an already-fetched chain.

        Finds the call closest to *current_price* that has a non-None implied_vol.
        Returns the IV as a float (e.g. 0.35 for 35%) or None if unavailable.
        """
        if not chain or current_price <= 0:
            return None

        calls = [c for c in chain if c.get("right") == "C" and c.get("implied_vol") is not None]
        if not calls:
            # Fall back to puts
            calls = [c for c in chain if c.get("right") == "P" and c.get("implied_vol") is not None]
        if not calls:
            return None

        closest = min(calls, key=lambda c: abs(c["strike"] - current_price))
        return closest["implied_vol"]

    async def get_current_atm_iv(self, ticker: str) -> dict:
        """Quick lookup of the current ATM IV for a ticker.

        Returns dict with ``ticker``, ``price``, ``atm_iv``, and ``timestamp``.
        """
        quote = await self.get_stock_quote(ticker)
        price = quote["price"]
        if not price or price <= 0:
            return {"ticker": ticker, "price": 0, "atm_iv": None, "timestamp": quote["timestamp"]}

        # Fetch near-ATM chain (tight strike range, nearest 2 expirations)
        spread = max(2.0, price * 0.02)
        today = datetime.utcnow().strftime("%Y-%m-%d")
        max_date = (datetime.utcnow() + timedelta(days=45)).strftime("%Y-%m-%d")

        chain = await self.get_option_chain(
            underlying=ticker,
            expiration_date_gte=today,
            expiration_date_lte=max_date,
            strike_gte=price - spread,
            strike_lte=price + spread,
            contract_type="call",
            limit=50,
        )

        atm_iv = self.get_atm_iv(chain, price)
        return {
            "ticker": ticker,
            "price": price,
            "atm_iv": atm_iv,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    async def get_volume_analysis(self, ticker: str) -> dict:
        """Analyse call/put volume and detect unusual activity.

        Returns dict with ``total_call_volume``, ``total_put_volume``,
        ``put_call_ratio``, ``unusual_volume`` (bool), and ``unusual_detail``.
        """
        today = datetime.utcnow().strftime("%Y-%m-%d")
        max_date = (datetime.utcnow() + timedelta(days=60)).strftime("%Y-%m-%d")

        chain = await self.get_option_chain(
            underlying=ticker,
            expiration_date_gte=today,
            expiration_date_lte=max_date,
        )

        call_vol = 0
        put_vol = 0
        unusual_contracts: list[str] = []

        for c in chain:
            vol = c.get("volume", 0) or 0
            oi = c.get("open_interest", 0) or 0
            if c.get("right") == "C":
                call_vol += vol
            else:
                put_vol += vol

            # Flag contracts where daily volume exceeds open interest
            if oi > 0 and vol > oi * 2:
                unusual_contracts.append(
                    f"{c.get('right')}{c.get('strike')} exp={c.get('expiry')} vol={vol} oi={oi}"
                )

        total_vol = call_vol + put_vol
        pc_ratio = put_vol / call_vol if call_vol > 0 else 0.0
        unusual = bool(unusual_contracts)

        return {
            "ticker": ticker,
            "total_call_volume": call_vol,
            "total_put_volume": put_vol,
            "put_call_ratio": round(pc_ratio, 4),
            "unusual_volume": unusual,
            "unusual_detail": "; ".join(unusual_contracts[:10]) if unusual else None,
            "chain_depth": len(chain),
        }

    # ── Internal ─────────────────────────────────────────────

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=_BASE_URL,
                timeout=self._timeout,
            )
        return self._client

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> dict:
        """GET with retry, backoff, and rate-limit handling.

        *url* can be a relative path or a full next_url (pagination).
        """
        client = await self._ensure_client()
        merged_params = dict(params or {})

        # next_url from Polygon may or may not include the apiKey
        is_full_url = url.startswith("http")
        if not is_full_url:
            merged_params["apiKey"] = self._api_key
        elif "apiKey" not in url:
            # Pagination cursor URL missing API key — append it
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}apiKey={self._api_key}"

        last_err: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                if is_full_url:
                    resp = await client.get(url)
                else:
                    resp = await client.get(url, params=merged_params)

                if resp.status_code == 429:
                    wait = float(
                        resp.headers.get(
                            "Retry-After", _BACKOFF_BASE_S * 2**attempt
                        )
                    )
                    logger.warning(
                        "Polygon 429, retry in %.1fs (attempt %d)",
                        wait,
                        attempt + 1,
                    )
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code >= 500:
                    wait = _BACKOFF_BASE_S * 2**attempt
                    logger.warning(
                        "Polygon %d, retry in %.1fs", resp.status_code, wait
                    )
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                return resp.json()

            except httpx.TimeoutException as exc:
                last_err = exc
                wait = _BACKOFF_BASE_S * 2**attempt
                logger.warning(
                    "Polygon timeout (attempt %d), retry in %.1fs",
                    attempt + 1,
                    wait,
                )
                await asyncio.sleep(wait)

            except httpx.HTTPStatusError as exc:
                last_err = exc
                if exc.response.status_code < 500:
                    break  # Client error — don't retry
                wait = _BACKOFF_BASE_S * 2**attempt
                await asyncio.sleep(wait)

            except Exception as exc:
                last_err = exc
                break

        raise PolygonError(
            f"Polygon API failed after {_MAX_RETRIES} attempts: {last_err}"
        )

    @staticmethod
    def _parse_option_snapshot(snap: dict, underlying: str) -> dict:
        """Parse a single Polygon option snapshot into our OptionContract format."""
        details = snap.get("details") or {}
        greeks = snap.get("greeks") or {}
        day = snap.get("day") or {}
        last_quote = snap.get("last_quote") or {}

        bid = last_quote.get("bid", 0) or 0
        ask = last_quote.get("ask", 0) or 0
        mid = (bid + ask) / 2 if (bid + ask) > 0 else 0

        contract_type = (details.get("contract_type", "") or "").lower()
        right = "C" if contract_type == "call" else "P"

        # Convert expiration YYYY-MM-DD → YYYYMMDD (matches IB format)
        exp_raw = details.get("expiration_date", "") or ""
        expiry = exp_raw.replace("-", "")

        return {
            "symbol": underlying,
            "strike": details.get("strike_price", 0) or 0,
            "expiry": expiry,
            "right": right,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "last": 0,  # Polygon option snapshots don't include last trade
            "volume": day.get("volume", 0) or 0,
            "open_interest": snap.get("open_interest", 0) or day.get("open_interest", 0) or 0,
            "implied_vol": greeks.get("implied_volatility"),
            "delta": greeks.get("delta"),
            "gamma": greeks.get("gamma"),
            "theta": greeks.get("theta"),
            "vega": greeks.get("vega"),
            "bid_size": last_quote.get("bid_size", 0) or 0,
            "ask_size": last_quote.get("ask_size", 0) or 0,
        }


# ── Module-level singleton ──────────────────────────────────

_instance: PolygonOptionsClient | None = None


def get_polygon_client() -> PolygonOptionsClient | None:
    """Return the shared PolygonOptionsClient, or None if POLYGON_API_KEY is unset."""
    global _instance
    api_key = os.environ.get("POLYGON_API_KEY", "")
    if not api_key:
        return None
    if _instance is None:
        _instance = PolygonOptionsClient(api_key=api_key)
    return _instance
