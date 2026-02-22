"""
Single-ticker KRJ signal computation using Polygon API (no IB dependency).
Reuses the same logic as the weekly batch: 25DMA, weekly low, Friday close, 3% rule.

Resilience: retries on 429 (rate limit) and 5xx with exponential backoff; configurable
timeout via KRJ_POLYGON_TIMEOUT (default 30s). Paid Developer tier allows higher
throughput; retries reduce "No signal yet" when Polygon is briefly throttled.
"""

import csv
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Retries and backoff for Polygon (429 / 5xx)
POLYGON_MAX_ATTEMPTS = 3
POLYGON_BACKOFF_BASE_SEC = 2  # 2, 4, 8s

# Path to KRJ data directory (on droplet: ~/apps/data/krj/)
KRJ_DATA_DIR = Path(os.getenv("KRJ_DATA_DIR", "/home/don/apps/data/krj"))


def _get_spy_daily_range() -> float | None:
    """Read SPY's 25D average daily range from the latest ETFs/FX CSV."""
    csv_path = KRJ_DATA_DIR / "latest_etfs_fx.csv"
    if not csv_path.exists():
        logger.warning("ETFs/FX CSV not found at %s", csv_path)
        return None
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("ticker", "").upper() == "SPY":
                    range_str = row.get("25DMA_range_bps", "")
                    if range_str:
                        return float(range_str)
        logger.warning("SPY not found in ETFs/FX CSV")
    except Exception as e:
        logger.warning("Error reading SPY daily range: %s", e)
    return None

# CSV row keys to match dashboard schema
KRJ_ROW_KEYS = [
    "ticker", "c", "weekly_low", "25DMA", "25DMA_shifted",
    "long_signal_value", "short_signal_value", "signal", "signal_status_prior_week",
    "vol_ratio", "25DMA_range_bps", "25D_ADV_Shares_MM", "25D_ADV_nortional_B", "avg_trade_size",
]


def _last_friday() -> datetime:
    """Return the most recent Friday (date only, no time)."""
    today = datetime.utcnow().date()
    # weekday(): Monday=0, Friday=4
    days_back = (today.weekday() - 4) % 7
    if days_back == 0:
        # Today is Friday; use previous Friday (data may not be available for today yet)
        days_back = 7
    friday = today - timedelta(days=days_back)
    return datetime.combine(friday, datetime.min.time())


def _fetch_daily_bars(ticker: str, from_date: str, to_date: str, api_key: str) -> list[dict]:
    """
    Fetch daily aggregates from Polygon with retries.
    GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
    Returns list of { o, h, l, c, v, vw, t, n } per day.
    Retries on 429 (rate limit) and 5xx with exponential backoff; respects Retry-After when present.
    """
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/day/{from_date}/{to_date}"
    )
    params = {"apiKey": api_key, "adjusted": "true", "sort": "asc"}
    timeout_sec = float(os.getenv("KRJ_POLYGON_TIMEOUT", "30"))
    last_exc = None
    for attempt in range(POLYGON_MAX_ATTEMPTS):
        try:
            with httpx.Client(timeout=timeout_sec) as client:
                resp = client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
                if data.get("resultsCount", 0) == 0 or not data.get("results"):
                    return []
                return data["results"]
        except httpx.HTTPStatusError as e:
            last_exc = e
            status = e.response.status_code
            is_retriable = status == 429 or (500 <= status < 600)
            if not is_retriable or attempt == POLYGON_MAX_ATTEMPTS - 1:
                raise
            retry_after = e.response.headers.get("Retry-After")
            if retry_after and str(retry_after).isdigit():
                sleep_sec = int(retry_after)
            else:
                sleep_sec = POLYGON_BACKOFF_BASE_SEC ** (attempt + 1)
            logger.warning(
                "Polygon HTTP %s for %s (attempt %s/%s), retrying in %ss",
                status, ticker, attempt + 1, POLYGON_MAX_ATTEMPTS, sleep_sec,
            )
            time.sleep(sleep_sec)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_exc = e
            if attempt == POLYGON_MAX_ATTEMPTS - 1:
                raise
            sleep_sec = POLYGON_BACKOFF_BASE_SEC ** (attempt + 1)
            logger.warning(
                "Polygon request error for %s (attempt %s/%s): %s; retrying in %ss",
                ticker, attempt + 1, POLYGON_MAX_ATTEMPTS, e, sleep_sec,
            )
            time.sleep(sleep_sec)
    if last_exc:
        raise last_exc
    return []


def _trading_days_back(from_date: datetime, n: int) -> datetime:
    """Roughly n trading days before from_date (weekdays only)."""
    # ~5 days per week
    days = int(n * 1.4) + 5
    return from_date - timedelta(days=days)


class SignalError(Exception):
    """Raised when signal computation fails with a user-friendly reason."""
    pass


def compute_signal_for_ticker(ticker: str) -> dict[str, Any] | None:
    """
    Fetch OHLCV from Polygon for the ticker, compute KRJ signal for the last completed week.
    Returns a row dict with keys matching the CSV schema, or None on error.
    Raises SignalError with a specific user-friendly reason on failure.
    """
    api_key = os.getenv("POLYGON_API_KEY", "").strip()
    if not api_key:
        logger.warning("POLYGON_API_KEY not set; cannot compute KRJ signal")
        raise SignalError("POLYGON_API_KEY is not configured on the server")

    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise SignalError("Ticker is empty")

    signal_date = _last_friday()
    to_date = signal_date.strftime("%Y-%m-%d")
    from_dt = _trading_days_back(signal_date, 35)
    from_date = from_dt.strftime("%Y-%m-%d")

    try:
        bars = _fetch_daily_bars(ticker, from_date, to_date, api_key)
    except httpx.HTTPStatusError as e:
        logger.warning("Polygon API error for %s: %s", ticker, e)
        raise SignalError(f"Polygon API error for {ticker}: HTTP {e.response.status_code}")
    except Exception as e:
        logger.exception("Failed to fetch Polygon data for %s: %s", ticker, e)
        raise SignalError(f"Failed to fetch data from Polygon for {ticker}")

    if not bars:
        logger.warning("No daily bars returned for %s in range %s to %s", ticker, from_date, to_date)
        raise SignalError(f"No trading data found for {ticker} on Polygon (range {from_date} to {to_date})")

    # Bars are ascending by t (ms). Find the bar for signal_date (Friday) and the prior 24 days for 25DMA.
    from_ts = int(signal_date.timestamp() * 1000)
    # Get last 30 bars to be safe (in case of holidays)
    recent = bars[-30:] if len(bars) >= 30 else bars

    # Friday close = last bar that is on or before signal_date
    friday_bar = None
    for b in reversed(recent):
        if b["t"] <= from_ts:
            friday_bar = b
            break
    if not friday_bar:
        friday_bar = recent[-1]

    c = float(friday_bar["c"])
    # Weekly low = min(low) of bars in the same week (Mon–Fri)
    week_start_ts = from_ts - 4 * 24 * 3600 * 1000
    week_bars = [b for b in recent if week_start_ts <= b["t"] <= from_ts]
    weekly_low = min(b["l"] for b in week_bars) if week_bars else float(friday_bar["l"])

    # 25DMA = SMA of last 25 closing prices (including Friday)
    closes_25 = [float(b["c"]) for b in recent[-25:]]
    if len(closes_25) < 25:
        logger.warning("Insufficient bars for 25DMA for %s (have %d)", ticker, len(closes_25))
        raise SignalError(f"Insufficient trading history for {ticker}: need 25 days, have {len(closes_25)}")
    dma25 = sum(closes_25) / 25

    # 25DMA shifted 3 weeks (15 trading days) – approximate
    closes_shifted = [float(b["c"]) for b in recent[-40:-15]] if len(recent) >= 40 else closes_25
    dma25_shifted = sum(closes_shifted) / len(closes_shifted) if closes_shifted else dma25

    long_signal_value = (weekly_low - dma25) / dma25 if dma25 else 0.0
    short_signal_value = (c - dma25) / dma25 if dma25 else 0.0

    # Signal: Long if weekly low >= 3% above 25DMA; Short if Friday close <= 3% below 25DMA
    threshold = 0.03
    if weekly_low >= dma25 * (1 + threshold):
        signal = "Long"
    elif c <= dma25 * (1 - threshold):
        signal = "Short"
    else:
        signal = "Neutral"

    # Prior week signal: optional – use Neutral for on-demand to keep logic simple
    signal_status_prior_week = "Neutral"

    # Compute volume/ADV metrics from Polygon daily data
    last_25_bars = recent[-25:] if len(recent) >= 25 else recent
    
    # 25-day average daily volume (in shares)
    volumes = [float(b.get("v", 0)) for b in last_25_bars]
    adv_shares = sum(volumes) / len(volumes) if volumes else 0
    adv_shares_mm = adv_shares / 1_000_000 if adv_shares > 0 else 0
    
    # 25-day ADV notional (in $B) = ADV shares * average close price
    avg_close = sum(closes_25) / len(closes_25) if closes_25 else c
    adv_notional = adv_shares * avg_close
    adv_notional_b = adv_notional / 1_000_000_000 if adv_notional > 0 else 0
    
    # Average trade size = volume / number of trades
    trade_counts = [float(b.get("n", 0)) for b in last_25_bars]
    total_volume = sum(volumes)
    total_trades = sum(trade_counts)
    avg_trade_size = total_volume / total_trades if total_trades > 0 else 0
    
    # 25DMA range = average of daily (high - low) / close for each day
    daily_ranges = []
    for b in last_25_bars:
        bar_close = float(b.get("c", 0))
        bar_high = float(b.get("h", 0))
        bar_low = float(b.get("l", 0))
        if bar_close > 0:
            daily_range = (bar_high - bar_low) / bar_close
            daily_ranges.append(daily_range)
    dma_range_bps = sum(daily_ranges) / len(daily_ranges) if daily_ranges else 0
    
    # Vol ratio = ticker's average daily range / SPY's average daily range
    spy_daily_range = _get_spy_daily_range()
    if spy_daily_range and spy_daily_range > 0 and dma_range_bps > 0:
        vol_ratio = dma_range_bps / spy_daily_range
    else:
        vol_ratio = ""

    # Convert all values to strings to match CSV format expected by frontend
    row = {
        "ticker": ticker,
        "c": str(c),
        "weekly_low": str(weekly_low),
        "25DMA": str(dma25),
        "25DMA_shifted": str(dma25_shifted),
        "long_signal_value": str(long_signal_value),
        "short_signal_value": str(short_signal_value),
        "signal": signal,
        "signal_status_prior_week": signal_status_prior_week,
        "vol_ratio": str(vol_ratio) if vol_ratio != "" else "",
        "25DMA_range_bps": str(dma_range_bps) if dma_range_bps else "",
        "25D_ADV_Shares_MM": str(adv_shares_mm) if adv_shares_mm else "",
        "25D_ADV_nortional_B": str(adv_notional_b) if adv_notional_b else "",
        "avg_trade_size": str(avg_trade_size) if avg_trade_size else "",
    }
    return row
