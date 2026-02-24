"""Message templates for email and WhatsApp notifications"""
from typing import Dict, Any, List, Optional
from datetime import datetime


def _format_currency(value: Optional[float], unit: str = "B") -> str:
    """Format a currency value for display."""
    if value is None:
        return "N/A"
    return f"${value:,.2f}{unit}"


def _format_pct(value: Optional[float], decimals: int = 2) -> str:
    """Format a percentage value for display."""
    if value is None:
        return "N/A"
    return f"{value:+.{decimals}f}%"


def morning_report_email(
    deals: List[Dict[str, Any]],
    changes: List[Dict[str, Any]],
    alerts: List[Dict[str, Any]],
) -> str:
    """Generate HTML email for the morning report.

    Args:
        deals: Active deals with current spread/price data.
        changes: Overnight spread or price changes.
        alerts: Risk flags or notable events.

    Returns:
        Full HTML string with inline CSS.
    """
    now = datetime.now().strftime("%A, %B %d, %Y")

    # --- deal table rows ---
    deal_rows = ""
    for d in deals:
        ticker = d.get("ticker", "???")
        target = d.get("target_name", ticker)
        spread = _format_pct(d.get("spread"))
        price = _format_currency(d.get("current_price"), "")
        deal_price = _format_currency(d.get("deal_price"), "")
        status = d.get("status", "active")
        deal_rows += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">{ticker}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{target}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{price}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{deal_price}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{spread}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">{status}</td>
        </tr>"""

    # --- overnight changes ---
    change_rows = ""
    for c in changes:
        ticker = c.get("ticker", "???")
        field = c.get("field", "spread")
        old = c.get("old_value", "")
        new = c.get("new_value", "")
        color = "#dc2626" if c.get("direction") == "widened" else "#16a34a"
        change_rows += f"""
        <tr>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">{ticker}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">{field}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">{old}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:{color};font-weight:600;">{new}</td>
        </tr>"""

    # --- risk alerts ---
    alert_items = ""
    for a in alerts:
        alert_items += f'<li style="margin-bottom:6px;">{a.get("message", "")}</li>'

    alerts_section = ""
    if alert_items:
        alerts_section = f"""
        <div style="margin-top:24px;">
            <h2 style="font-size:18px;color:#dc2626;margin:0 0 12px 0;">Risk Flags</h2>
            <ul style="margin:0;padding-left:20px;color:#374151;">{alert_items}</ul>
        </div>"""

    changes_section = ""
    if change_rows:
        changes_section = f"""
        <div style="margin-top:24px;">
            <h2 style="font-size:18px;color:#1f2937;margin:0 0 12px 0;">Overnight Changes</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                    <tr style="background-color:#f3f4f6;">
                        <th style="padding:8px 12px;text-align:left;">Ticker</th>
                        <th style="padding:8px 12px;text-align:left;">Field</th>
                        <th style="padding:8px 12px;text-align:right;">Previous</th>
                        <th style="padding:8px 12px;text-align:right;">Current</th>
                    </tr>
                </thead>
                <tbody>{change_rows}</tbody>
            </table>
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background-color:#f9fafb;">
    <div style="max-width:700px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:#ffffff;padding:24px;border-radius:8px 8px 0 0;">
            <h1 style="margin:0;font-size:22px;">M&A Morning Report</h1>
            <p style="margin:8px 0 0 0;opacity:0.85;font-size:14px;">{now} &mdash; {len(deals)} active deal(s)</p>
        </div>

        <div style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
            <h2 style="font-size:18px;color:#1f2937;margin:0 0 12px 0;">Active Deals</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                    <tr style="background-color:#f3f4f6;">
                        <th style="padding:8px 12px;text-align:left;">Ticker</th>
                        <th style="padding:8px 12px;text-align:left;">Target</th>
                        <th style="padding:8px 12px;text-align:right;">Price</th>
                        <th style="padding:8px 12px;text-align:right;">Deal Price</th>
                        <th style="padding:8px 12px;text-align:right;">Spread</th>
                        <th style="padding:8px 12px;text-align:center;">Status</th>
                    </tr>
                </thead>
                <tbody>{deal_rows}</tbody>
            </table>

            {changes_section}
            {alerts_section}

            <div style="margin-top:30px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
                <p style="margin:0;">Automated report from M&A Tracker. Do not reply.</p>
            </div>
        </div>
    </div>
</body>
</html>"""


def spread_alert_whatsapp(
    ticker: str,
    old_spread: float,
    new_spread: float,
    pct_change: float,
) -> str:
    """Generate a concise WhatsApp message for a spread change alert.

    Returns:
        Plain text with WhatsApp bold (*text*) and emoji formatting.
    """
    direction = "WIDENED" if new_spread > old_spread else "TIGHTENED"
    emoji = "\U0001f534" if direction == "WIDENED" else "\U0001f7e2"  # red/green circle

    return (
        f"{emoji} *Spread Alert: {ticker}*\n"
        f"\n"
        f"*Direction:* {direction}\n"
        f"*Old Spread:* {old_spread:+.2f}%\n"
        f"*New Spread:* {new_spread:+.2f}%\n"
        f"*Change:* {pct_change:+.1f}%\n"
        f"\n"
        f"\u23f0 {datetime.now().strftime('%I:%M %p ET')}\n"
        f"\n"
        f"\U0001f449 Review at: https://dr3-dashboard.com/deals"
    )


def filing_alert_email(
    filing: Dict[str, Any],
    deal: Dict[str, Any],
) -> str:
    """Generate HTML email for a new SEC filing related to a tracked deal.

    Args:
        filing: Filing data (filing_type, filing_url, company_name, filing_date, description).
        deal: Associated deal data (target_name, ticker, acquirer_name).

    Returns:
        Full HTML string with inline CSS.
    """
    filing_type = filing.get("filing_type", "Unknown")
    filing_url = filing.get("filing_url", "#")
    company = filing.get("company_name", "Unknown")
    filing_date = filing.get("filing_date", "")
    description = filing.get("description", "")

    target = deal.get("target_name", "Unknown")
    ticker = deal.get("ticker", "")
    acquirer = deal.get("acquirer_name", "")

    ticker_display = f" ({ticker})" if ticker else ""
    acquirer_line = f"""
            <div style="margin:10px 0;">
                <span style="font-weight:bold;color:#6b7280;">Acquirer:</span>
                <span style="color:#1f2937;">{acquirer}</span>
            </div>""" if acquirer else ""

    description_block = f"""
            <div style="margin-top:16px;padding:12px;background-color:#f9fafb;border-radius:6px;font-size:14px;color:#374151;">
                {description}
            </div>""" if description else ""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background-color:#f9fafb;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);color:#ffffff;padding:24px;border-radius:8px 8px 0 0;">
            <h1 style="margin:0;font-size:20px;">New SEC Filing: {filing_type}</h1>
            <p style="margin:8px 0 0 0;opacity:0.85;font-size:14px;">{target}{ticker_display}</p>
        </div>

        <div style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
            <div style="background-color:#f3f4f6;padding:16px;border-radius:6px;border-left:4px solid #7c3aed;">
                <div style="margin:0 0 10px 0;">
                    <span style="font-weight:bold;color:#6b7280;">Filing Type:</span>
                    <span style="color:#1f2937;font-weight:600;">{filing_type}</span>
                </div>
                <div style="margin:10px 0;">
                    <span style="font-weight:bold;color:#6b7280;">Company:</span>
                    <span style="color:#1f2937;">{company}</span>
                </div>
                <div style="margin:10px 0;">
                    <span style="font-weight:bold;color:#6b7280;">Target:</span>
                    <span style="color:#1f2937;">{target}{ticker_display}</span>
                </div>{acquirer_line}
                <div style="margin:10px 0;">
                    <span style="font-weight:bold;color:#6b7280;">Filed:</span>
                    <span style="color:#1f2937;">{filing_date}</span>
                </div>
            </div>
            {description_block}

            <div style="margin-top:20px;">
                <a href="{filing_url}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">View Filing on SEC.gov</a>
            </div>

            <div style="margin-top:30px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
                <p style="margin:0;">Automated alert from M&A Tracker. Do not reply.</p>
            </div>
        </div>
    </div>
</body>
</html>"""


def risk_change_alert(
    ticker: str,
    field: str,
    old_value: str,
    new_value: str,
) -> str:
    """Generate a plain-text alert message for a risk field change.

    Suitable for both WhatsApp and plain-text email fallback.

    Returns:
        Text with WhatsApp bold formatting.
    """
    return (
        f"\u26a0\ufe0f *Risk Change: {ticker}*\n"
        f"\n"
        f"*Field:* {field}\n"
        f"*Previous:* {old_value}\n"
        f"*Current:* {new_value}\n"
        f"\n"
        f"\u23f0 {datetime.now().strftime('%I:%M %p ET')}\n"
        f"\n"
        f"\U0001f449 Review at: https://dr3-dashboard.com/deals"
    )
