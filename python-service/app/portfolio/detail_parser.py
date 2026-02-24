"""
Per-deal detail tab parser for the M&A portfolio Google Sheet.

Each deal has a detail tab with a vertical key-value layout containing
deal terms, CVR details, dividend schedules, price history, and
qualitative assessments.
"""
import asyncio
import json
import logging
import re
from datetime import date, datetime
from typing import Optional, Dict, Any, List
from io import StringIO

import aiohttp
import pandas as pd
import asyncpg

logger = logging.getLogger(__name__)

SHEET_ID = "148_gz88_8cXhyZnCZyJxFufqlbqTzTnVSy37O19Fh2c"
EXPORT_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid="


# ---------------------------------------------------------------------------
# Helper: locate labels and extract values
# ---------------------------------------------------------------------------

def _find_label_row(df: pd.DataFrame, label: str, col: int = 1) -> Optional[int]:
    """Find row index where column `col` matches `label` (case-insensitive, strip colons/whitespace)."""
    target = label.lower().rstrip(":").strip()
    for idx in range(len(df)):
        raw = df.iat[idx, col]
        if pd.isna(raw):
            continue
        cell = str(raw).lower().rstrip(":").strip()
        if cell == target:
            return idx
    return None


def _get_value(df: pd.DataFrame, row: int, col: int = 2) -> Optional[str]:
    """Get string value from df at (row, col), return None if NaN/empty."""
    if row is None or row < 0 or row >= len(df) or col >= df.shape[1]:
        return None
    val = df.iat[row, col]
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s if s else None


def _parse_price(raw: Optional[str]) -> Optional[float]:
    """Parse '$210.00' -> 210.00.  Also handles negatives and plain numbers."""
    if raw is None:
        return None
    cleaned = raw.replace("$", "").replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_percent(raw: Optional[str]) -> Optional[float]:
    """Parse '99.82%' -> 0.9982, '-0.60%' -> -0.006."""
    if raw is None:
        return None
    cleaned = raw.replace("%", "").replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned) / 100.0
    except ValueError:
        return None


def _parse_date(raw: Optional[str]) -> Optional[str]:
    """Parse 'M/D/YY' or 'M/D/YYYY' -> 'YYYY-MM-DD' string."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _parse_months(raw: Optional[str]) -> Optional[float]:
    """Parse '4.20' months string -> float."""
    if raw is None:
        return None
    cleaned = raw.strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Section extractors: price history, CVRs, dividends
# ---------------------------------------------------------------------------

def _extract_price_history(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Extract price time-series from columns 5-6 (Date, Close)."""
    results: List[Dict[str, Any]] = []

    # Find the header row with "Date" in col 5 and "Close" in col 6
    header_row = None
    for idx in range(len(df)):
        val5 = str(df.iat[idx, 5]).strip().lower() if not pd.isna(df.iat[idx, 5]) else ""
        val6 = str(df.iat[idx, 6]).strip().lower() if df.shape[1] > 6 and not pd.isna(df.iat[idx, 6]) else ""
        if val5 == "date" and val6 == "close":
            header_row = idx
            break

    if header_row is None:
        return results

    for idx in range(header_row + 1, len(df)):
        raw_date = df.iat[idx, 5] if not pd.isna(df.iat[idx, 5]) else None
        raw_close = df.iat[idx, 6] if df.shape[1] > 6 and not pd.isna(df.iat[idx, 6]) else None

        if raw_date is None and raw_close is None:
            # Allow a few blank rows in case of gaps, but stop after two consecutive blanks
            if idx + 1 < len(df):
                next_date = df.iat[idx + 1, 5] if not pd.isna(df.iat[idx + 1, 5]) else None
                if next_date is None:
                    break
            else:
                break
            continue

        parsed_date = _parse_date(str(raw_date)) if raw_date is not None else None
        parsed_close = _parse_price(str(raw_close)) if raw_close is not None else None

        if parsed_date and parsed_close is not None:
            results.append({"date": parsed_date, "close": parsed_close})

    return results


def _extract_cvrs(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Extract CVR details from the CVR section.

    Looks for a header row containing 'NPV', 'Value', 'Probability' in columns 6+.
    Then reads subsequent rows until empty.
    """
    results: List[Dict[str, Any]] = []

    # Scan for CVR header row (NPV / Value / Probability)
    header_row = None
    npv_col = None
    for idx in range(len(df)):
        for c in range(6, min(df.shape[1], 13)):
            cell = str(df.iat[idx, c]).strip().lower() if not pd.isna(df.iat[idx, c]) else ""
            if cell == "npv":
                npv_col = c
                header_row = idx
                break
        if header_row is not None:
            break

    if header_row is None or npv_col is None:
        return results

    # Expected column order starting at npv_col: NPV, Value, Probability, Payment, Deadline, Years
    col_offsets = {
        "npv": npv_col,
        "value": npv_col + 1,
        "probability": npv_col + 2,
        "payment": npv_col + 3,
        "deadline": npv_col + 4,
        "years": npv_col + 5,
    }

    for idx in range(header_row + 1, min(header_row + 20, len(df))):
        npv_raw = _get_value(df, idx, col_offsets["npv"])
        if npv_raw is None:
            break

        entry: Dict[str, Any] = {
            "npv": _parse_price(npv_raw),
            "value": _parse_price(_get_value(df, idx, col_offsets["value"])),
            "probability": _parse_percent(_get_value(df, idx, col_offsets["probability"])),
            "payment": _get_value(df, idx, col_offsets["payment"]),
            "deadline": _parse_date(_get_value(df, idx, col_offsets["deadline"])),
            "years": _parse_months(_get_value(df, idx, col_offsets["years"])),
        }
        # Skip formula residue rows (npv=0, value=0, years negative)
        if (entry["npv"] is not None and entry["npv"] == 0
                and (entry["value"] is None or entry["value"] == 0)
                and (entry["years"] is not None and entry["years"] < 0)):
            continue
        results.append(entry)

    return results


def _extract_dividends(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Extract dividend schedule.

    Supports two layouts:
    1. Vertical: header row with 'Date', 'Value', 'Paid?' in columns 6+, data in subsequent rows.
    2. Horizontal: 'Dividends' label followed by numbered columns (1, 2, 3...) with
       Date/Value/Paid? as row labels and data across columns.
    """
    results: List[Dict[str, Any]] = []

    # --- Try vertical layout first ---
    header_row = None
    date_col = None
    for idx in range(10, len(df)):
        for c in range(6, min(df.shape[1], 13)):
            cell = str(df.iat[idx, c]).strip().lower() if not pd.isna(df.iat[idx, c]) else ""
            if cell == "date":
                # Check next col for "value" or "paid"
                next_cell = str(df.iat[idx, c + 1]).strip().lower() if c + 1 < df.shape[1] and not pd.isna(df.iat[idx, c + 1]) else ""
                if "value" in next_cell or "paid" in next_cell:
                    header_row = idx
                    date_col = c
                    break
                # Also check c+2 for "Paid?"
                if c + 2 < df.shape[1]:
                    next2 = str(df.iat[idx, c + 2]).strip().lower() if not pd.isna(df.iat[idx, c + 2]) else ""
                    if "paid" in next2:
                        header_row = idx
                        date_col = c
                        break
        if header_row is not None:
            break

    if header_row is not None and date_col is not None:
        val_col = date_col + 1
        paid_col = date_col + 2

        for idx in range(header_row + 1, min(header_row + 50, len(df))):
            raw_date = _get_value(df, idx, date_col)
            if raw_date is None:
                break

            entry: Dict[str, Any] = {
                "date": _parse_date(raw_date),
                "value": _parse_price(_get_value(df, idx, val_col)),
                "paid": _get_value(df, idx, paid_col),
            }
            results.append(entry)

        if results:
            return results

    # --- Try horizontal layout ---
    # Look for "Dividends" label in columns 5-7, then numbered sub-headers (1, 2, 3...)
    # across columns, with Date/Value/Paid? as row labels below.
    for idx in range(10, len(df)):
        for c in range(5, min(df.shape[1], 10)):
            cell = str(df.iat[idx, c]).strip().lower() if not pd.isna(df.iat[idx, c]) else ""
            if cell == "dividends":
                # Found "Dividends" header. Look for Date/Value/Paid? rows below.
                date_row = None
                value_row = None
                paid_row = None
                for sub_idx in range(idx + 1, min(idx + 6, len(df))):
                    sub_cell = str(df.iat[sub_idx, c]).strip().lower() if not pd.isna(df.iat[sub_idx, c]) else ""
                    if sub_cell == "date":
                        date_row = sub_idx
                    elif sub_cell == "value":
                        value_row = sub_idx
                    elif "paid" in sub_cell:
                        paid_row = sub_idx

                if date_row is not None and value_row is not None:
                    # Read across columns starting from c+1
                    for dc in range(c + 1, df.shape[1]):
                        raw_date = _get_value(df, date_row, dc)
                        if raw_date is None:
                            break
                        parsed_date = _parse_date(raw_date)
                        if parsed_date is None:
                            continue
                        entry: Dict[str, Any] = {
                            "date": parsed_date,
                            "value": _parse_price(_get_value(df, value_row, dc)),
                            "paid": _get_value(df, paid_row, dc) if paid_row is not None else None,
                        }
                        results.append(entry)
                    return results

    return results


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def parse_deal_detail(csv_content: str, ticker: str) -> Dict[str, Any]:
    """
    Parse a per-deal detail tab CSV into a structured dict.

    Returns dict matching sheet_deal_details columns.
    """
    df = pd.read_csv(StringIO(csv_content), header=None, keep_default_na=False, na_values=[""])

    # Pad to at least 15 columns so column references don't blow up
    while df.shape[1] < 15:
        df[df.shape[1]] = pd.NA

    result: Dict[str, Any] = {"ticker": ticker}

    # --- Deal identification ---
    row = _find_label_row(df, "Target")
    result["target"] = _get_value(df, row)

    row = _find_label_row(df, "Target current price")
    result["target_current_price"] = _parse_price(_get_value(df, row))

    row = _find_label_row(df, "Acquiror")
    result["acquiror"] = _get_value(df, row)

    row = _find_label_row(df, "Acquiror current price")
    result["acquiror_current_price"] = _parse_price(_get_value(df, row))

    # --- Spread ---
    row = _find_label_row(df, "Current Spread")
    result["current_spread"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Spread Change")
    result["spread_change"] = _parse_percent(_get_value(df, row))

    # --- Deal terms ---
    row = _find_label_row(df, "Category")
    result["category"] = _get_value(df, row)

    row = _find_label_row(df, "Cash per share")
    result["cash_per_share"] = _parse_price(_get_value(df, row))
    result["cash_pct"] = _parse_percent(_get_value(df, row, 3))

    row = _find_label_row(df, "Stock ratio")
    result["stock_ratio"] = _get_value(df, row)

    row = _find_label_row(df, "Stress test discount")
    result["stress_test_discount"] = _get_value(df, row)

    row = _find_label_row(df, "Stock per share")
    result["stock_per_share"] = _parse_price(_get_value(df, row))
    result["stock_pct"] = _parse_percent(_get_value(df, row, 3))

    row = _find_label_row(df, "Dividends / Other")
    if row is None:
        row = _find_label_row(df, "Dividends/Other")
    result["dividends_other"] = _parse_price(_get_value(df, row))
    result["dividends_other_pct"] = _parse_percent(_get_value(df, row, 3))

    row = _find_label_row(df, "Total price per share")
    result["total_price_per_share"] = _parse_price(_get_value(df, row))

    # --- Spread / IRR ---
    row = _find_label_row(df, "Deal spread")
    result["deal_spread"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Deal Close Time (Months)")
    if row is None:
        row = _find_label_row(df, "Deal Close Time")
    result["deal_close_time_months"] = _parse_months(_get_value(df, row))

    # Expected IRR appears twice (deal terms row and hypothetical row).
    # We want the first one (deal terms).
    row = _find_label_row(df, "Expected IRR")
    result["expected_irr"] = _parse_percent(_get_value(df, row))

    # --- Hypothetical terms ---
    row = _find_label_row(df, "Ideal price")
    result["ideal_price"] = _parse_price(_get_value(df, row))

    # Hypothetical IRR: the second "Expected IRR" row (after "Hypothetical Terms")
    hypo_row = _find_label_row(df, "Hypothetical Terms")
    if hypo_row is not None:
        for idx in range(hypo_row + 1, min(hypo_row + 5, len(df))):
            cell = str(df.iat[idx, 1]).strip().lower().rstrip(":") if not pd.isna(df.iat[idx, 1]) else ""
            if cell == "expected irr":
                result["hypothetical_irr"] = _parse_percent(_get_value(df, idx))
                result["hypothetical_irr_spread"] = _parse_percent(_get_value(df, idx, 3))
                break

    # --- Dates ---
    row = _find_label_row(df, "Today's Date")
    result["todays_date"] = _parse_date(_get_value(df, row))

    row = _find_label_row(df, "Announce Date")
    result["announce_date"] = _parse_date(_get_value(df, row))

    row = _find_label_row(df, "Expected close date")
    result["expected_close_date"] = _parse_date(_get_value(df, row))
    result["expected_close_date_note"] = _get_value(df, row, 3)

    # --- Qualitative fields ---
    row = _find_label_row(df, "Shareholder vote")
    result["shareholder_vote"] = _get_value(df, row)

    row = _find_label_row(df, "Premium attractive")
    result["premium_attractive"] = _get_value(df, row)

    row = _find_label_row(df, "Board approval")
    result["board_approval"] = _get_value(df, row)

    row = _find_label_row(df, "Voting agreements")
    result["voting_agreements"] = _get_value(df, row)

    row = _find_label_row(df, "Aggressive Shareholders?")
    if row is None:
        row = _find_label_row(df, "Aggressive Shareholders")
    result["aggressive_shareholders"] = _get_value(df, row)

    row = _find_label_row(df, "Regulatory approvals")
    result["regulatory_approvals"] = _get_value(df, row)

    row = _find_label_row(df, "Revenue mostly US?")
    if row is None:
        row = _find_label_row(df, "Revenue mostly US")
    result["revenue_mostly_us"] = _get_value(df, row)

    row = _find_label_row(df, "Reputable Acquiror?")
    if row is None:
        row = _find_label_row(df, "Reputable Acquiror")
    result["reputable_acquiror"] = _get_value(df, row)

    row = _find_label_row(df, "Target Business Description")
    result["target_business_description"] = _get_value(df, row)

    row = _find_label_row(df, "MAC Clauses")
    result["mac_clauses"] = _get_value(df, row)

    row = _find_label_row(df, "Termination Fee?")
    if row is None:
        row = _find_label_row(df, "Termination Fee")
    result["termination_fee"] = _get_value(df, row)
    result["termination_fee_pct"] = _parse_percent(_get_value(df, row, 3))

    row = _find_label_row(df, "Closing conditions")
    result["closing_conditions"] = _get_value(df, row)

    row = _find_label_row(df, "Sellside pushback?")
    if row is None:
        row = _find_label_row(df, "Sellside pushback")
    result["sellside_pushback"] = _get_value(df, row)

    row = _find_label_row(df, "Outside Date")
    result["outside_date"] = _parse_date(_get_value(df, row))

    row = _find_label_row(df, "Target Marketcap")
    result["target_marketcap"] = _get_value(df, row)

    row = _find_label_row(df, "Target Enterprise Value")
    result["target_enterprise_value"] = _get_value(df, row)

    row = _find_label_row(df, "Go Shop or Likely Overbid?")
    if row is None:
        row = _find_label_row(df, "Go Shop or Likely Overbid")
    result["go_shop_or_overbid"] = _get_value(df, row)

    row = _find_label_row(df, "Financing details")
    result["financing_details"] = _get_value(df, row)

    # --- Risk ratings ---
    row = _find_label_row(df, "Shareholder Risk")
    result["shareholder_risk"] = _get_value(df, row)

    row = _find_label_row(df, "Financing Risk")
    result["financing_risk"] = _get_value(df, row)

    row = _find_label_row(df, "Legal Risk")
    result["legal_risk"] = _get_value(df, row)

    # --- Boolean flags ---
    row = _find_label_row(df, "Investable Deal?")
    if row is None:
        row = _find_label_row(df, "Investable Deal")
    result["investable_deal"] = _get_value(df, row)

    row = _find_label_row(df, "Pays A Dividend?")
    if row is None:
        row = _find_label_row(df, "Pays A Dividend")
    result["pays_dividend"] = _get_value(df, row)

    row = _find_label_row(df, "Prefs or Baby Bonds?")
    if row is None:
        row = _find_label_row(df, "Prefs or Baby Bonds")
    result["prefs_or_baby_bonds"] = _get_value(df, row)

    row = _find_label_row(df, "CVRs?")
    if row is None:
        row = _find_label_row(df, "CVRs")
    result["has_cvrs"] = _get_value(df, row)

    # --- Probability / risk analysis ---
    row = _find_label_row(df, "Probability of Success")
    result["probability_of_success"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Probability of Higher Offer")
    result["probability_of_higher_offer"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Offer Bump Premium")
    result["offer_bump_premium"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Break Price")
    result["break_price"] = _parse_price(_get_value(df, row))

    row = _find_label_row(df, "Implied Downside")
    result["implied_downside"] = _parse_percent(_get_value(df, row))

    row = _find_label_row(df, "Return/Risk Ratio")
    if row is None:
        row = _find_label_row(df, "Return / Risk Ratio")
    result["return_risk_ratio"] = _parse_months(_get_value(df, row))  # plain number

    # --- Options section ---
    row = _find_label_row(df, "Optionable")
    result["optionable"] = _get_value(df, row)

    row = _find_label_row(df, "Long Naked Calls")
    result["long_naked_calls"] = _get_value(df, row)

    row = _find_label_row(df, "Long Vertical Call Spread")
    result["long_vertical_call_spread"] = _get_value(df, row)

    row = _find_label_row(df, "Long Covered Call")
    result["long_covered_call"] = _get_value(df, row)

    row = _find_label_row(df, "Short Put Vertical Spread")
    result["short_put_vertical_spread"] = _get_value(df, row)

    # --- Structured sub-sections ---
    result["price_history"] = _extract_price_history(df)
    result["cvrs"] = _extract_cvrs(df)
    result["dividends"] = _extract_dividends(df)

    logger.info(
        "Parsed deal detail for %s: %d price points, %d CVRs, %d dividends",
        ticker,
        len(result["price_history"]),
        len(result["cvrs"]),
        len(result["dividends"]),
    )

    return result


# ---------------------------------------------------------------------------
# Async fetch + parse
# ---------------------------------------------------------------------------

async def fetch_and_parse_deal(
    session: aiohttp.ClientSession,
    gid: str,
    ticker: str,
) -> Dict[str, Any]:
    """Fetch a deal detail tab CSV and parse it."""
    url = f"{EXPORT_URL}{gid}"
    async with session.get(url) as resp:
        resp.raise_for_status()
        csv_content = await resp.text()

    return parse_deal_detail(csv_content, ticker)


# ---------------------------------------------------------------------------
# Batch ingest into database
# ---------------------------------------------------------------------------

_UPSERT_SQL = """
INSERT INTO sheet_deal_details (
    snapshot_id, ticker, target, acquiror,
    target_current_price, acquiror_current_price,
    current_spread, spread_change,
    category, cash_per_share, cash_pct,
    stock_ratio, stress_test_discount,
    stock_per_share, stock_pct,
    dividends_other, dividends_other_pct,
    total_price_per_share,
    deal_spread, deal_close_time_months, expected_irr,
    ideal_price, hypothetical_irr, hypothetical_irr_spread,
    todays_date, announce_date, expected_close_date, expected_close_date_note,
    shareholder_vote, premium_attractive, board_approval,
    voting_agreements, aggressive_shareholders,
    regulatory_approvals, revenue_mostly_us, reputable_acquiror,
    target_business_description, mac_clauses,
    termination_fee, termination_fee_pct,
    closing_conditions, sellside_pushback,
    outside_date, target_marketcap, target_enterprise_value,
    go_shop_or_overbid, financing_details,
    shareholder_risk, financing_risk, legal_risk,
    investable_deal, pays_dividend, prefs_or_baby_bonds, has_cvrs,
    probability_of_success, probability_of_higher_offer,
    offer_bump_premium, break_price, implied_downside, return_risk_ratio,
    optionable, long_naked_calls, long_vertical_call_spread,
    long_covered_call, short_put_vertical_spread,
    price_history, cvrs, dividends
)
VALUES (
    $1, $2, $3, $4,
    $5, $6,
    $7, $8,
    $9, $10, $11,
    $12, $13,
    $14, $15,
    $16, $17,
    $18,
    $19, $20, $21,
    $22, $23, $24,
    $25, $26, $27, $28,
    $29, $30, $31,
    $32, $33,
    $34, $35, $36,
    $37, $38,
    $39, $40,
    $41, $42,
    $43, $44, $45,
    $46, $47,
    $48, $49, $50,
    $51, $52, $53, $54,
    $55, $56,
    $57, $58, $59, $60,
    $61, $62, $63,
    $64, $65,
    $66, $67, $68
)
ON CONFLICT (snapshot_id, ticker) DO UPDATE SET
    target = EXCLUDED.target,
    acquiror = EXCLUDED.acquiror,
    target_current_price = EXCLUDED.target_current_price,
    acquiror_current_price = EXCLUDED.acquiror_current_price,
    current_spread = EXCLUDED.current_spread,
    spread_change = EXCLUDED.spread_change,
    category = EXCLUDED.category,
    cash_per_share = EXCLUDED.cash_per_share,
    cash_pct = EXCLUDED.cash_pct,
    stock_ratio = EXCLUDED.stock_ratio,
    stress_test_discount = EXCLUDED.stress_test_discount,
    stock_per_share = EXCLUDED.stock_per_share,
    stock_pct = EXCLUDED.stock_pct,
    dividends_other = EXCLUDED.dividends_other,
    dividends_other_pct = EXCLUDED.dividends_other_pct,
    total_price_per_share = EXCLUDED.total_price_per_share,
    deal_spread = EXCLUDED.deal_spread,
    deal_close_time_months = EXCLUDED.deal_close_time_months,
    expected_irr = EXCLUDED.expected_irr,
    ideal_price = EXCLUDED.ideal_price,
    hypothetical_irr = EXCLUDED.hypothetical_irr,
    hypothetical_irr_spread = EXCLUDED.hypothetical_irr_spread,
    todays_date = EXCLUDED.todays_date,
    announce_date = EXCLUDED.announce_date,
    expected_close_date = EXCLUDED.expected_close_date,
    expected_close_date_note = EXCLUDED.expected_close_date_note,
    shareholder_vote = EXCLUDED.shareholder_vote,
    premium_attractive = EXCLUDED.premium_attractive,
    board_approval = EXCLUDED.board_approval,
    voting_agreements = EXCLUDED.voting_agreements,
    aggressive_shareholders = EXCLUDED.aggressive_shareholders,
    regulatory_approvals = EXCLUDED.regulatory_approvals,
    revenue_mostly_us = EXCLUDED.revenue_mostly_us,
    reputable_acquiror = EXCLUDED.reputable_acquiror,
    target_business_description = EXCLUDED.target_business_description,
    mac_clauses = EXCLUDED.mac_clauses,
    termination_fee = EXCLUDED.termination_fee,
    termination_fee_pct = EXCLUDED.termination_fee_pct,
    closing_conditions = EXCLUDED.closing_conditions,
    sellside_pushback = EXCLUDED.sellside_pushback,
    outside_date = EXCLUDED.outside_date,
    target_marketcap = EXCLUDED.target_marketcap,
    target_enterprise_value = EXCLUDED.target_enterprise_value,
    go_shop_or_overbid = EXCLUDED.go_shop_or_overbid,
    financing_details = EXCLUDED.financing_details,
    shareholder_risk = EXCLUDED.shareholder_risk,
    financing_risk = EXCLUDED.financing_risk,
    legal_risk = EXCLUDED.legal_risk,
    investable_deal = EXCLUDED.investable_deal,
    pays_dividend = EXCLUDED.pays_dividend,
    prefs_or_baby_bonds = EXCLUDED.prefs_or_baby_bonds,
    has_cvrs = EXCLUDED.has_cvrs,
    probability_of_success = EXCLUDED.probability_of_success,
    probability_of_higher_offer = EXCLUDED.probability_of_higher_offer,
    offer_bump_premium = EXCLUDED.offer_bump_premium,
    break_price = EXCLUDED.break_price,
    implied_downside = EXCLUDED.implied_downside,
    return_risk_ratio = EXCLUDED.return_risk_ratio,
    optionable = EXCLUDED.optionable,
    long_naked_calls = EXCLUDED.long_naked_calls,
    long_vertical_call_spread = EXCLUDED.long_vertical_call_spread,
    long_covered_call = EXCLUDED.long_covered_call,
    short_put_vertical_spread = EXCLUDED.short_put_vertical_spread,
    price_history = EXCLUDED.price_history,
    cvrs = EXCLUDED.cvrs,
    dividends = EXCLUDED.dividends
"""


def _str_to_date(s: Optional[str]) -> Optional[date]:
    """Convert 'YYYY-MM-DD' string to date object for asyncpg."""
    if s is None:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


async def _store_deal_detail(
    db_pool: asyncpg.Pool,
    snapshot_id: str,
    detail: Dict[str, Any],
) -> None:
    """Insert or update a single deal detail row."""
    d = detail
    async with db_pool.acquire() as conn:
        await conn.execute(
            _UPSERT_SQL,
            snapshot_id,
            d.get("ticker"),
            d.get("target"),
            d.get("acquiror"),
            d.get("target_current_price"),
            d.get("acquiror_current_price"),
            d.get("current_spread"),
            d.get("spread_change"),
            d.get("category"),
            d.get("cash_per_share"),
            d.get("cash_pct"),
            d.get("stock_ratio"),
            d.get("stress_test_discount"),
            d.get("stock_per_share"),
            d.get("stock_pct"),
            d.get("dividends_other"),
            d.get("dividends_other_pct"),
            d.get("total_price_per_share"),
            d.get("deal_spread"),
            d.get("deal_close_time_months"),
            d.get("expected_irr"),
            d.get("ideal_price"),
            d.get("hypothetical_irr"),
            d.get("hypothetical_irr_spread"),
            _str_to_date(d.get("todays_date")),
            _str_to_date(d.get("announce_date")),
            _str_to_date(d.get("expected_close_date")),
            d.get("expected_close_date_note"),
            d.get("shareholder_vote"),
            d.get("premium_attractive"),
            d.get("board_approval"),
            d.get("voting_agreements"),
            d.get("aggressive_shareholders"),
            d.get("regulatory_approvals"),
            d.get("revenue_mostly_us"),
            d.get("reputable_acquiror"),
            d.get("target_business_description"),
            d.get("mac_clauses"),
            d.get("termination_fee"),
            d.get("termination_fee_pct"),
            d.get("closing_conditions"),
            d.get("sellside_pushback"),
            _str_to_date(d.get("outside_date")),
            d.get("target_marketcap"),
            d.get("target_enterprise_value"),
            d.get("go_shop_or_overbid"),
            d.get("financing_details"),
            d.get("shareholder_risk"),
            d.get("financing_risk"),
            d.get("legal_risk"),
            d.get("investable_deal"),
            d.get("pays_dividend"),
            d.get("prefs_or_baby_bonds"),
            d.get("has_cvrs"),
            d.get("probability_of_success"),
            d.get("probability_of_higher_offer"),
            d.get("offer_bump_premium"),
            d.get("break_price"),
            d.get("implied_downside"),
            d.get("return_risk_ratio"),
            d.get("optionable"),
            d.get("long_naked_calls"),
            d.get("long_vertical_call_spread"),
            d.get("long_covered_call"),
            d.get("short_put_vertical_spread"),
            json.dumps(d.get("price_history", [])),
            json.dumps(d.get("cvrs", [])),
            json.dumps(d.get("dividends", [])),
        )


async def ingest_deal_details(
    db_pool: asyncpg.Pool,
    snapshot_id: str,
    deals: List[Dict[str, str]],  # [{"ticker": "EA", "gid": "137229779"}, ...]
    concurrency: int = 3,
) -> Dict[str, Any]:
    """
    Fetch and store deal details for all deals in a snapshot.
    Rate-limited to `concurrency` concurrent requests with a 0.5s pause between batches.

    Returns summary: {total, succeeded, failed, errors: [...]}
    """
    sem = asyncio.Semaphore(concurrency)
    summary: Dict[str, Any] = {
        "total": len(deals),
        "succeeded": 0,
        "failed": 0,
        "errors": [],
    }

    async def _process_one(
        session: aiohttp.ClientSession,
        deal: Dict[str, str],
    ) -> None:
        ticker = deal["ticker"]
        gid = deal["gid"]
        async with sem:
            try:
                detail = await fetch_and_parse_deal(session, gid, ticker)
                await _store_deal_detail(db_pool, snapshot_id, detail)
                summary["succeeded"] += 1
                logger.info("Ingested detail for %s (gid=%s)", ticker, gid)
            except Exception as exc:
                summary["failed"] += 1
                msg = f"{ticker} (gid={gid}): {exc}"
                summary["errors"].append(msg)
                logger.warning("Failed to ingest detail for %s: %s", ticker, exc)
            finally:
                # Be gentle with Google Sheets
                await asyncio.sleep(0.5)

    async with aiohttp.ClientSession() as session:
        tasks = [_process_one(session, deal) for deal in deals]
        await asyncio.gather(*tasks)

    logger.info(
        "Deal detail ingest complete: %d/%d succeeded, %d failed",
        summary["succeeded"],
        summary["total"],
        summary["failed"],
    )
    return summary
