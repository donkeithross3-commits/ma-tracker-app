"""Morning options opportunities report.

Scans active deal tickers for covered call and spread opportunities,
collects IV and volume signals, and persists snapshots for intraday
comparison.
"""

import logging
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)


async def generate_morning_options_section(pool, tickers: list[str]) -> dict:
    """Generate the Options Opportunities section for the morning report.

    For each ticker: fetch option chain via Polygon, analyse covered calls
    and spreads, collect risk signals (ATM IV, volume anomalies), and
    persist a snapshot row.

    Args:
        pool: asyncpg connection pool.
        tickers: List of active deal ticker symbols to scan.

    Returns:
        Dict with covered_calls (top 10), spreads (top 10),
        risk_signals, scanned count, and timestamp.
    """
    from app.options.polygon_options import get_polygon_client

    client = get_polygon_client()
    if client is None:
        return {
            "covered_calls": [],
            "spreads": [],
            "risk_signals": [],
            "scanned": 0,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "error": "Polygon API key not configured",
        }

    covered_calls: list[dict] = []
    spreads: list[dict] = []
    risk_signals: list[dict] = []
    scanned = 0
    today = date.today()

    for ticker in tickers:
        try:
            # Fetch deal info for context
            deal_row = await pool.fetchrow(
                """
                SELECT ticker, deal_price, days_to_close, current_price
                FROM sheet_rows sr
                JOIN sheet_snapshots ss ON sr.snapshot_id = ss.id
                WHERE sr.ticker = $1 AND ss.status = 'success'
                  AND sr.is_excluded = false
                ORDER BY ss.ingested_at DESC LIMIT 1
                """,
                ticker,
            )

            current_price = 0.0
            deal_price = 0.0
            days_to_close = 90

            if deal_row:
                deal_price = float(deal_row["deal_price"] or 0)
                days_to_close = int(deal_row["days_to_close"] or 90)
                current_price = float(deal_row["current_price"] or 0)

            # Get stock quote for current price if not from sheet
            if current_price <= 0:
                try:
                    quote = await client.get_stock_quote(ticker)
                    current_price = quote["price"]
                except Exception:
                    logger.warning("[options_report] Could not get quote for %s", ticker)
                    continue

            if current_price <= 0:
                continue

            # Check if options exist
            avail = await client.check_options_available(ticker)
            has_options = avail.get("available", False)
            chain_depth = avail.get("expirationCount", 0)

            if not has_options:
                await _persist_snapshot(pool, today, ticker, has_options=False, chain_depth=0)
                continue

            # Fetch option chain (near-term, near-money)
            max_expiry = (datetime.utcnow() + timedelta(days=min(days_to_close + 30, 120))).strftime("%Y-%m-%d")
            today_str = datetime.utcnow().strftime("%Y-%m-%d")

            chain = await client.get_option_chain(
                underlying=ticker,
                expiration_date_gte=today_str,
                expiration_date_lte=max_expiry,
            )

            scanned += 1

            # ATM IV
            atm_iv = client.get_atm_iv(chain, current_price)

            # Volume analysis
            vol_data = await client.get_volume_analysis(ticker)

            # Analyse covered calls from the chain
            cc_results = _analyse_covered_calls(
                chain, ticker, current_price, deal_price, days_to_close
            )
            covered_calls.extend(cc_results)

            # Analyse spreads
            spread_results = _analyse_spreads(chain, ticker, current_price, deal_price)
            spreads.extend(spread_results)

            # Risk signals
            if atm_iv is not None and atm_iv > 0.5:
                risk_signals.append({
                    "ticker": ticker,
                    "signal": "high_iv",
                    "detail": f"ATM IV {atm_iv:.1%} — elevated",
                })
            if vol_data.get("unusual_volume"):
                risk_signals.append({
                    "ticker": ticker,
                    "signal": "unusual_volume",
                    "detail": vol_data.get("unusual_detail", ""),
                })

            # Persist snapshot
            best_cc = cc_results[0] if cc_results else {}
            best_spread = spread_results[0] if spread_results else {}
            await _persist_snapshot(
                pool, today, ticker,
                has_options=True,
                chain_depth=chain_depth,
                atm_iv=atm_iv,
                vol_data=vol_data,
                best_cc=best_cc,
                best_spread=best_spread,
            )

        except Exception as exc:
            logger.error("[options_report] Error scanning %s: %s", ticker, exc, exc_info=True)

    # Sort and trim to top 10
    covered_calls.sort(key=lambda c: c.get("ann_yield", 0), reverse=True)
    spreads.sort(key=lambda s: s.get("yield", 0), reverse=True)

    return {
        "covered_calls": covered_calls[:10],
        "spreads": spreads[:10],
        "risk_signals": risk_signals,
        "scanned": scanned,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------------------
# Covered call analysis (Polygon-based, standalone)
# ---------------------------------------------------------------------------

def _analyse_covered_calls(
    chain: list[dict],
    ticker: str,
    current_price: float,
    deal_price: float,
    days_to_close: int,
) -> list[dict]:
    """Analyse covered call opportunities from a Polygon chain.

    Strike selection: at or slightly above deal price (within +/- 2% buffer).
    Expiration: 14+ days out, not past deal close + 30 day buffer.
    Filters: bid > $0.01, open_interest >= 10.
    """
    results = []
    now = datetime.now()
    target_price = deal_price if deal_price > 0 else current_price
    strike_lower = target_price * 0.98
    strike_upper = target_price * 1.02
    max_expiry_days = days_to_close + 30

    for c in chain:
        if c.get("right") != "C":
            continue
        bid = c.get("bid", 0) or 0
        if bid <= 0.01:
            continue
        oi = c.get("open_interest", 0) or 0
        if oi < 10:
            continue

        strike = c.get("strike", 0)
        if strike < strike_lower or strike > strike_upper:
            continue

        expiry_str = c.get("expiry", "")
        if len(expiry_str) != 8:
            continue
        try:
            expiry_date = datetime.strptime(expiry_str, "%Y%m%d")
        except ValueError:
            continue

        dte = (expiry_date - now).days
        if dte < 14 or dte > max_expiry_days:
            continue

        # Calculations
        premium = bid
        ann_yield = (premium / current_price) * (365 / dte) if dte > 0 and current_price > 0 else 0
        cushion_pct = (strike - current_price) / current_price if current_price > 0 else 0

        results.append({
            "ticker": ticker,
            "strike": strike,
            "expiry": expiry_str,
            "premium": round(premium, 4),
            "ann_yield": round(ann_yield, 4),
            "cushion_pct": round(cushion_pct, 4),
            "dte": dte,
            "open_interest": oi,
            "iv": c.get("implied_vol"),
        })

    results.sort(key=lambda r: r.get("ann_yield", 0), reverse=True)
    return results


# ---------------------------------------------------------------------------
# Spread analysis
# ---------------------------------------------------------------------------

def _analyse_spreads(
    chain: list[dict],
    ticker: str,
    current_price: float,
    deal_price: float,
) -> list[dict]:
    """Find best put credit spreads from the chain.

    Looks for OTM put spreads below current price that benefit from
    deal completion (price rising to deal price).
    """
    results = []
    now = datetime.now()

    # Group puts by expiry
    puts_by_expiry: dict[str, list[dict]] = {}
    for c in chain:
        if c.get("right") != "P":
            continue
        bid = c.get("bid", 0) or 0
        if bid <= 0:
            continue
        exp = c.get("expiry", "")
        if len(exp) != 8:
            continue
        puts_by_expiry.setdefault(exp, []).append(c)

    for expiry, puts in puts_by_expiry.items():
        try:
            expiry_date = datetime.strptime(expiry, "%Y%m%d")
        except ValueError:
            continue
        dte = (expiry_date - now).days
        if dte < 14 or dte > 120:
            continue

        puts.sort(key=lambda p: p["strike"])

        # Look for credit spread: sell higher strike put, buy lower strike put
        for i in range(len(puts) - 1):
            long_put = puts[i]      # lower strike (buy)
            short_put = puts[i + 1]  # higher strike (sell)

            long_strike = long_put["strike"]
            short_strike = short_put["strike"]

            # Both must be below current price (OTM)
            if short_strike >= current_price:
                continue

            credit = (short_put.get("bid", 0) or 0) - (long_put.get("ask", 0) or 0)
            if credit <= 0:
                continue

            width = short_strike - long_strike
            if width <= 0:
                continue

            max_loss = width - credit
            if max_loss <= 0:
                continue

            spread_yield = credit / max_loss
            ann_yield = spread_yield * (365 / dte) if dte > 0 else 0

            results.append({
                "ticker": ticker,
                "type": "put_credit",
                "short_strike": short_strike,
                "long_strike": long_strike,
                "expiry": expiry,
                "credit": round(credit, 4),
                "max_loss": round(max_loss, 4),
                "yield": round(ann_yield, 4),
                "dte": dte,
            })

    results.sort(key=lambda r: r.get("yield", 0), reverse=True)
    return results


# ---------------------------------------------------------------------------
# Snapshot persistence
# ---------------------------------------------------------------------------

async def _persist_snapshot(
    pool,
    snapshot_date: date,
    ticker: str,
    *,
    has_options: bool = False,
    chain_depth: int = 0,
    atm_iv: float | None = None,
    vol_data: dict | None = None,
    best_cc: dict | None = None,
    best_spread: dict | None = None,
) -> None:
    """Upsert a row into deal_options_snapshots."""
    vol = vol_data or {}
    cc = best_cc or {}
    sp = best_spread or {}

    try:
        await pool.execute(
            """
            INSERT INTO deal_options_snapshots (
                snapshot_date, ticker,
                atm_iv, put_call_ratio,
                cc_best_strike, cc_best_expiry, cc_best_premium,
                cc_best_ann_yield, cc_best_cushion_pct,
                spread_best_type, spread_best_yield,
                total_call_volume, total_put_volume,
                unusual_volume, unusual_detail,
                has_options, chain_depth
            ) VALUES (
                $1, $2,
                $3, $4,
                $5, $6, $7, $8, $9,
                $10, $11,
                $12, $13,
                $14, $15,
                $16, $17
            )
            ON CONFLICT (snapshot_date, ticker)
            DO UPDATE SET
                atm_iv = EXCLUDED.atm_iv,
                put_call_ratio = EXCLUDED.put_call_ratio,
                cc_best_strike = EXCLUDED.cc_best_strike,
                cc_best_expiry = EXCLUDED.cc_best_expiry,
                cc_best_premium = EXCLUDED.cc_best_premium,
                cc_best_ann_yield = EXCLUDED.cc_best_ann_yield,
                cc_best_cushion_pct = EXCLUDED.cc_best_cushion_pct,
                spread_best_type = EXCLUDED.spread_best_type,
                spread_best_yield = EXCLUDED.spread_best_yield,
                total_call_volume = EXCLUDED.total_call_volume,
                total_put_volume = EXCLUDED.total_put_volume,
                unusual_volume = EXCLUDED.unusual_volume,
                unusual_detail = EXCLUDED.unusual_detail,
                has_options = EXCLUDED.has_options,
                chain_depth = EXCLUDED.chain_depth
            """,
            snapshot_date,
            ticker,
            atm_iv,
            vol.get("put_call_ratio"),
            cc.get("strike"),
            cc.get("expiry"),
            cc.get("premium"),
            cc.get("ann_yield"),
            cc.get("cushion_pct"),
            sp.get("type"),
            sp.get("yield"),
            vol.get("total_call_volume"),
            vol.get("total_put_volume"),
            vol.get("unusual_volume", False),
            vol.get("unusual_detail"),
            has_options,
            chain_depth,
        )
    except Exception as exc:
        logger.warning("[options_report] Failed to persist snapshot for %s: %s", ticker, exc)
