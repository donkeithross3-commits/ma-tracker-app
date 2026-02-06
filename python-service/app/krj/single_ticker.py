"""
Single-ticker KRJ signal computation using Polygon API (no IB dependency).
Reuses the same logic as the weekly batch: 25DMA, weekly low, Friday close, 3% rule.
"""

import csv
import os
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

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
    Fetch daily aggregates from Polygon.
    GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
    Returns list of { o, h, l, c, v, vw, t, n } per day.
    """
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/day/{from_date}/{to_date}"
    )
    params = {"apiKey": api_key, "adjusted": "true", "sort": "asc"}
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    if data.get("resultsCount", 0) == 0 or not data.get("results"):
        return []
    return data["results"]


def _trading_days_back(from_date: datetime, n: int) -> datetime:
    """Roughly n trading days before from_date (weekdays only)."""
    # ~5 days per week
    days = int(n * 1.4) + 5
    return from_date - timedelta(days=days)


def compute_signal_for_ticker(ticker: str) -> dict[str, Any] | None:
    """
    Fetch OHLCV from Polygon for the ticker, compute KRJ signal for the last completed week.
    Returns a row dict with keys matching the CSV schema, or None on error.
    """
    api_key = os.getenv("POLYGON_API_KEY", "").strip()
    if not api_key:
        logger.warning("POLYGON_API_KEY not set; cannot compute KRJ signal")
        return None

    ticker = (ticker or "").strip().upper()
    if not ticker:
        return None

    signal_date = _last_friday()
    to_date = signal_date.strftime("%Y-%m-%d")
    from_dt = _trading_days_back(signal_date, 35)
    from_date = from_dt.strftime("%Y-%m-%d")

    try:
        bars = _fetch_daily_bars(ticker, from_date, to_date, api_key)
    except httpx.HTTPStatusError as e:
        logger.warning("Polygon API error for %s: %s", ticker, e)
        return None
    except Exception as e:
        logger.exception("Failed to fetch Polygon data for %s: %s", ticker, e)
        return None

    if not bars:
        logger.warning("No daily bars returned for %s in range %s to %s", ticker, from_date, to_date)
        return None

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
        return None
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
        "vol_ratio": vol_ratio,
        "25DMA_range_bps": dma_range_bps,
        "25D_ADV_Shares_MM": adv_shares_mm,
        "25D_ADV_nortional_B": adv_notional_b,
        "avg_trade_size": avg_trade_size,
    }
    return row
