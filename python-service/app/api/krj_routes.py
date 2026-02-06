"""
KRJ signals API: single-ticker on-demand signal computation (Polygon, no IB).
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.krj.single_ticker import compute_signal_for_ticker, SignalError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/krj", tags=["krj"])


@router.get("/signals/single")
def get_single_ticker_signal(ticker: str = Query(..., min_length=1, max_length=10)) -> dict[str, Any]:
    """
    Compute KRJ weekly signal for one ticker using Polygon API.
    Returns a row in the same schema as the weekly CSV (ticker, c, weekly_low, 25DMA, signal, etc.).
    """
    ticker = ticker.strip().upper()
    try:
        row = compute_signal_for_ticker(ticker)
    except SignalError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if row is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not compute signal for {ticker} (unknown error)",
        )
    return row
