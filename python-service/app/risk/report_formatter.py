"""Morning report formatter — HTML email and WhatsApp summary."""

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("US/Eastern")

# ---------------------------------------------------------------------------
# Grade helpers
# ---------------------------------------------------------------------------

GRADE_ORDER = {"Low": 0, "Medium": 1, "High": 2}


def _grade_badge(grade: str | None) -> str:
    """Return an HTML badge for a grade value."""
    if not grade:
        return '<span style="color:#6b7280;">-</span>'
    colors = {
        "Low": ("#dcfce7", "#16a34a"),
        "Medium": ("#fef3c7", "#d97706"),
        "High": ("#fee2e2", "#dc2626"),
    }
    bg, fg = colors.get(grade, ("#f3f4f6", "#6b7280"))
    return (
        f'<span style="background:{bg};color:{fg};padding:2px 6px;'
        f'border-radius:3px;font-weight:600;font-size:12px;">{grade}</span>'
    )


def _severity_emoji(severity: str) -> str:
    """Return emoji marker for event severity."""
    return {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")


def _grade_letter(grade: str | None) -> str:
    """Return single letter for table display: L, M, H, or -."""
    if not grade:
        return "-"
    return grade[0].upper()


def _grade_cell(grade: str | None) -> str:
    """Return a colored table cell for a grade."""
    letter = _grade_letter(grade)
    colors = {"L": "#16a34a", "M": "#d97706", "H": "#dc2626"}
    color = colors.get(letter, "#6b7280")
    return f'<td style="text-align:center;color:{color};font-weight:700;">{letter}</td>'


# ---------------------------------------------------------------------------
# Discrepancy extraction
# ---------------------------------------------------------------------------

def _extract_discrepancies(assessments: list[dict]) -> list[dict]:
    """Pull discrepancy records from all assessments."""
    all_discrep = []
    for a in assessments:
        discreps = a.get("discrepancies")
        if not discreps:
            continue
        if isinstance(discreps, list):
            for d in discreps:
                d.setdefault("ticker", a.get("ticker", "?"))
                all_discrep.append(d)
        elif isinstance(discreps, dict):
            for key, val in discreps.items():
                if isinstance(val, dict):
                    val.setdefault("ticker", a.get("ticker", "?"))
                    val.setdefault("factor", key)
                    all_discrep.append(val)
    return all_discrep


# ---------------------------------------------------------------------------
# HTML report builder
# ---------------------------------------------------------------------------

def format_morning_report(
    run_data: dict,
    assessments: list[dict],
    overnight_events: list[dict],
    options_section: str | None = None,
) -> dict:
    """Build the morning report.

    Returns dict with: subject_line, html_body, whatsapp_summary, executive_summary
    """
    report_date = run_data.get("run_date", date.today())
    if isinstance(report_date, str):
        report_date = date.fromisoformat(report_date)
    date_str = report_date.strftime("%a, %b %-d, %Y")

    total_deals = run_data.get("total_deals", len(assessments))
    discrepancies = _extract_discrepancies(assessments)
    flagged = [a for a in assessments if a.get("needs_attention")]
    exec_summary = run_data.get("summary") or _build_executive_summary(
        assessments, overnight_events, discrepancies, flagged, total_deals,
    )

    subject = f"M&A Portfolio Intelligence Report - {date_str}"

    html = _build_html(
        date_str=date_str,
        exec_summary=exec_summary,
        overnight_events=overnight_events,
        discrepancies=discrepancies,
        assessments=assessments,
        total_deals=total_deals,
        flagged=flagged,
        options_section=options_section,
    )

    whatsapp = _build_whatsapp(
        report_date=report_date,
        total_deals=total_deals,
        overnight_events=overnight_events,
        discrepancies=discrepancies,
        flagged=flagged,
    )

    return {
        "subject_line": subject,
        "html_body": html,
        "whatsapp_summary": whatsapp,
        "executive_summary": exec_summary,
    }


# ---------------------------------------------------------------------------
# Executive summary fallback
# ---------------------------------------------------------------------------

def _build_executive_summary(
    assessments, overnight_events, discrepancies, flagged, total_deals,
) -> str:
    """Build a basic executive summary when AI summary is not provided."""
    high_events = [e for e in overnight_events if e.get("severity") == "high"]
    lines = [
        f"Portfolio scan complete: {total_deals} deals assessed.",
    ]
    if overnight_events:
        lines.append(
            f"{len(overnight_events)} overnight events detected"
            f" ({len(high_events)} high severity)."
        )
    if discrepancies:
        lines.append(f"{len(discrepancies)} discrepancies vs Google Sheet identified.")
    if flagged:
        tickers = ", ".join(a.get("ticker", "?") for a in flagged[:5])
        lines.append(f"{len(flagged)} deals flagged for attention: {tickers}.")
    return " ".join(lines)


# ---------------------------------------------------------------------------
# Full HTML email
# ---------------------------------------------------------------------------

def _build_html(
    *,
    date_str: str,
    exec_summary: str,
    overnight_events: list[dict],
    discrepancies: list[dict],
    assessments: list[dict],
    total_deals: int,
    flagged: list[dict],
    options_section: str | None,
) -> str:
    parts: list[str] = []

    # --- Wrapper ---
    parts.append(
        '<div style="max-width:700px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;'
        'color:#1e293b;line-height:1.5;">'
    )

    # --- Header ---
    parts.append(
        '<div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);'
        'color:#ffffff;padding:24px 28px;border-radius:8px 8px 0 0;">'
        f'<h1 style="margin:0;font-size:20px;letter-spacing:0.5px;">'
        f'M&A PORTFOLIO INTELLIGENCE REPORT</h1>'
        f'<p style="margin:6px 0 0;font-size:14px;opacity:0.85;">{date_str}</p>'
        '</div>'
    )

    # --- Executive Summary ---
    parts.append(_section_header("EXECUTIVE SUMMARY"))
    parts.append(
        f'<div style="padding:12px 20px 16px;font-size:14px;color:#334155;">'
        f'<p style="margin:0;">{_nl_to_br(exec_summary)}</p></div>'
    )

    # --- Overnight Events ---
    if overnight_events:
        parts.append(_section_header(f"OVERNIGHT EVENTS ({len(overnight_events)})"))
        parts.append('<div style="padding:8px 20px 12px;">')
        for ev in overnight_events:
            emoji = _severity_emoji(ev.get("severity", "low"))
            parts.append(
                f'<p style="margin:4px 0;font-size:13px;">'
                f'{emoji} <strong>{ev.get("ticker","?")}</strong>: {ev.get("detail","")}</p>'
            )
        parts.append("</div>")

    # --- Discrepancies ---
    if discrepancies:
        parts.append(_section_header(f"DISCREPANCIES VS GOOGLE SHEET ({len(discrepancies)})"))
        parts.append('<div style="padding:8px 20px 12px;">')
        for disc in discrepancies:
            ticker = disc.get("ticker", "?")
            factor = disc.get("factor", "unknown")
            sheet_says = disc.get("sheet_says", "?")
            we_say = disc.get("we_say", "?")
            reasoning = disc.get("reasoning", "")
            parts.append(
                f'<p style="margin:6px 0 2px;font-size:13px;">'
                f'<strong>{ticker} {factor.replace("_", " ").title()}</strong>: '
                f'Sheet "{sheet_says}" &rarr; We say "{we_say}"</p>'
            )
            if reasoning:
                parts.append(
                    f'<p style="margin:0 0 6px 16px;font-size:12px;color:#64748b;">{reasoning}</p>'
                )
        parts.append("</div>")

    # --- Deal-by-Deal Summary Table ---
    parts.append(_section_header("DEAL-BY-DEAL SUMMARY"))
    parts.append(_build_deal_table(assessments, overnight_events, discrepancies))

    # --- Options Section (from Plan 2, optional) ---
    if options_section:
        parts.append(_section_header("OPTIONS OPPORTUNITIES"))
        parts.append(f'<div style="padding:8px 20px 12px;">{options_section}</div>')

    # --- Detailed Deal Reviews ---
    parts.append(_section_header("DETAILED DEAL REVIEWS"))
    parts.append('<div style="padding:8px 20px 16px;">')
    for a in assessments:
        parts.append(_build_deal_block(a, overnight_events, discrepancies))
    parts.append("</div>")

    # --- Footer ---
    parts.append(
        '<div style="padding:12px 20px;font-size:11px;color:#94a3b8;'
        'border-top:1px solid #e2e8f0;text-align:center;">'
        'Generated by MA Tracker Risk Engine. '
        'This report is for internal use only.</div>'
    )

    parts.append("</div>")  # close wrapper
    return "\n".join(parts)


def _section_header(title: str) -> str:
    return (
        f'<div style="background:#f1f5f9;padding:8px 20px;'
        f'border-bottom:2px solid #2563eb;margin-top:4px;">'
        f'<h2 style="margin:0;font-size:14px;color:#1e3a5f;letter-spacing:0.3px;">'
        f'{title}</h2></div>'
    )


def _build_deal_table(
    assessments: list[dict],
    overnight_events: list[dict],
    discrepancies: list[dict],
) -> str:
    """Build the deal-by-deal summary HTML table."""
    event_tickers = {e.get("ticker") for e in overnight_events}
    disc_tickers = {d.get("ticker") for d in discrepancies}

    hdr_style = (
        "padding:6px 8px;font-size:11px;color:#64748b;text-align:center;"
        "border-bottom:2px solid #cbd5e1;white-space:nowrap;"
    )
    cell_style = "padding:5px 8px;font-size:12px;text-align:center;border-bottom:1px solid #e2e8f0;"

    rows = ['<table style="width:100%;border-collapse:collapse;margin:0;">']
    # Header row
    rows.append("<thead><tr>")
    for col in ["Ticker", "Acquiror", "Spread", "V", "F", "L", "R", "M", "ShV", "ShF", "ShL", "Inv", "Flags"]:
        align = "left" if col in ("Ticker", "Acquiror", "Flags") else "center"
        rows.append(f'<th style="{hdr_style}text-align:{align};">{col}</th>')
    rows.append("</tr></thead><tbody>")

    for i, a in enumerate(assessments):
        ticker = a.get("ticker", "?")
        bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
        row_style = f'style="background:{bg};"'

        # Flags
        flags = ""
        if ticker in event_tickers:
            flags += "&#9889;"  # lightning bolt
        if ticker in disc_tickers:
            flags += "&#9888;&#65039;"  # warning
        if a.get("needs_attention"):
            flags += "&#128314;"  # red triangle

        spread = a.get("gross_spread_pct")
        spread_str = f"{float(spread):.1f}%" if spread is not None else "-"

        acquiror = a.get("acquiror") or a.get("acquirer") or ""
        if len(acquiror) > 14:
            acquiror = acquiror[:13] + "..."

        inv = a.get("sheet_investable") or ""
        inv_short = "Y" if "yes" in inv.lower() else ("N" if "no" in inv.lower() else "-") if inv else "-"

        rows.append(f"<tr {row_style}>")
        rows.append(f'<td style="{cell_style}text-align:left;font-weight:600;">{ticker}</td>')
        rows.append(f'<td style="{cell_style}text-align:left;font-size:11px;">{acquiror}</td>')
        rows.append(f'<td style="{cell_style}">{spread_str}</td>')
        # Our grades: V, F, L, R, M
        for factor in ["vote_grade", "financing_grade", "legal_grade", "regulatory_grade", "mac_grade"]:
            rows.append(_grade_cell(a.get(factor)))
        # Sheet grades: V, F, L
        for sheet_f in ["sheet_vote_risk", "sheet_finance_risk", "sheet_legal_risk"]:
            val = a.get(sheet_f, "")
            rows.append(_grade_cell(_normalize_grade(val)))
        rows.append(f'<td style="{cell_style}">{inv_short}</td>')
        rows.append(f'<td style="{cell_style}text-align:left;font-size:13px;">{flags}</td>')
        rows.append("</tr>")

    rows.append("</tbody></table>")
    rows.append(
        '<p style="font-size:10px;color:#94a3b8;padding:4px 8px;margin:0;">'
        "V=Vote F=Finance L=Legal R=Regulatory M=MAC | "
        "&#9889;=overnight event &#9888;&#65039;=discrepancy &#128314;=needs attention"
        "</p>"
    )
    return "\n".join(rows)


def _build_deal_block(
    assessment: dict,
    overnight_events: list[dict],
    discrepancies: list[dict],
) -> str:
    """Build a detailed deal review block."""
    ticker = assessment.get("ticker", "?")
    acquiror = assessment.get("acquiror") or assessment.get("acquirer") or ""

    deal_price = assessment.get("deal_price")
    current_price = assessment.get("current_price")
    spread = assessment.get("gross_spread_pct")
    days = assessment.get("days_to_close")

    header_line = f"{ticker}"
    if acquiror:
        header_line += f" / {acquiror}"

    metrics = []
    if deal_price is not None:
        metrics.append(f"Deal ${float(deal_price):.2f}")
    if current_price is not None:
        metrics.append(f"Current ${float(current_price):.2f}")
    if spread is not None:
        metrics.append(f"Spread {float(spread):.1f}%")
    if days is not None:
        metrics.append(f"{days}d to close")
    metrics_str = " | ".join(metrics)

    # Our grades
    our_grades = []
    for label, key in [("V", "vote_grade"), ("F", "financing_grade"), ("L", "legal_grade"),
                        ("R", "regulatory_grade"), ("M", "mac_grade")]:
        g = assessment.get(key)
        our_grades.append(f"{label}-{_grade_letter(g)}")
    our_grades_str = " ".join(our_grades)

    # Sheet grades
    sheet_grades = []
    for label, key in [("V", "sheet_vote_risk"), ("F", "sheet_finance_risk"), ("L", "sheet_legal_risk")]:
        g = _normalize_grade(assessment.get(key, ""))
        sheet_grades.append(f"{label}-{_grade_letter(g)}")
    inv = assessment.get("sheet_investable", "")
    sheet_grades_str = " ".join(sheet_grades) + f" Inv={inv or '-'}"

    # Events for this ticker
    ticker_events = [e for e in overnight_events if e.get("ticker") == ticker]
    ticker_discreps = [d for d in discrepancies if d.get("ticker") == ticker]

    lines = [
        f'<div style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:10px;">',
        f'<p style="margin:0 0 4px;font-weight:700;font-size:14px;color:#1e3a5f;">{header_line}</p>',
    ]
    if metrics_str:
        lines.append(f'<p style="margin:0 0 6px;font-size:12px;color:#64748b;">{metrics_str}</p>')
    lines.append(
        f'<p style="margin:0 0 2px;font-size:12px;">'
        f'<strong>Our Assessment:</strong> {our_grades_str}</p>'
    )
    lines.append(
        f'<p style="margin:0 0 6px;font-size:12px;">'
        f'<strong>Sheet:</strong> {sheet_grades_str}</p>'
    )

    for ev in ticker_events:
        emoji = _severity_emoji(ev.get("severity", "low"))
        lines.append(
            f'<p style="margin:2px 0;font-size:12px;">'
            f'{emoji} <strong>OVERNIGHT:</strong> {ev.get("detail","")}</p>'
        )
    for disc in ticker_discreps:
        factor = disc.get("factor", "unknown")
        reasoning = disc.get("reasoning", "")
        lines.append(
            f'<p style="margin:2px 0;font-size:12px;">'
            f'&#9888;&#65039; <strong>DISCREPANCY ({factor}):</strong> '
            f'Sheet "{disc.get("sheet_says","?")}" vs Ours "{disc.get("we_say","?")}"</p>'
        )
        if reasoning:
            lines.append(
                f'<p style="margin:0 0 2px 16px;font-size:11px;color:#64748b;">{reasoning}</p>'
            )

    # Deal summary
    summary = assessment.get("deal_summary")
    if summary:
        lines.append(
            f'<p style="margin:6px 0 2px;font-size:12px;color:#334155;">{summary}</p>'
        )

    # Key risks
    key_risks = assessment.get("key_risks")
    if key_risks and isinstance(key_risks, list):
        lines.append(
            f'<p style="margin:4px 0 0;font-size:11px;color:#64748b;">'
            f'<strong>Key Risks:</strong> {", ".join(str(r) for r in key_risks[:5])}</p>'
        )

    # Attention reason
    if assessment.get("needs_attention") and assessment.get("attention_reason"):
        lines.append(
            f'<p style="margin:4px 0 0;font-size:12px;color:#dc2626;font-weight:600;">'
            f'&#128314; {assessment["attention_reason"]}</p>'
        )

    lines.append("</div>")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# WhatsApp summary
# ---------------------------------------------------------------------------

def _build_whatsapp(
    *,
    report_date: date,
    total_deals: int,
    overnight_events: list[dict],
    discrepancies: list[dict],
    flagged: list[dict],
) -> str:
    """Build condensed WhatsApp summary (max ~1024 chars)."""
    date_str = report_date.strftime("%b %-d")
    lines = [f"*M&A Morning Report -- {date_str}*", ""]

    lines.append(
        f"{total_deals} deals scanned | "
        f"{len(overnight_events)} overnight events | "
        f"{len(discrepancies)} discrepancies"
    )
    lines.append("")

    # Overnight (top 5)
    if overnight_events:
        high_first = sorted(overnight_events, key=lambda e: 0 if e.get("severity") == "high" else 1)
        lines.append("*Overnight:*")
        for ev in high_first[:5]:
            ticker = ev.get("ticker", "?")
            detail = ev.get("detail", "")
            if len(detail) > 60:
                detail = detail[:57] + "..."
            lines.append(f"- {ticker}: {detail}")
        if len(overnight_events) > 5:
            lines.append(f"  ...+{len(overnight_events) - 5} more")
        lines.append("")

    # Discrepancies (top 5)
    if discrepancies:
        lines.append("*Discrepancies:*")
        for disc in discrepancies[:5]:
            ticker = disc.get("ticker", "?")
            factor = disc.get("factor", "?")
            sheet = disc.get("sheet_says", "?")
            ours = disc.get("we_say", "?")
            lines.append(f"- {ticker}: {factor} {sheet} -> {ours}")
        if len(discrepancies) > 5:
            lines.append(f"  ...+{len(discrepancies) - 5} more")
        lines.append("")

    # Needs attention (top 5)
    if flagged:
        lines.append("*Needs Attention:*")
        for a in flagged[:5]:
            ticker = a.get("ticker", "?")
            reason = a.get("attention_reason", "")
            if len(reason) > 50:
                reason = reason[:47] + "..."
            lines.append(f"- {ticker}: {reason}")
        lines.append("")

    result = "\n".join(lines).strip()
    # Truncate to 1024 if needed
    if len(result) > 1024:
        result = result[:1020] + "..."
    return result


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _normalize_grade(val: str | None) -> str | None:
    """Normalize free-form sheet risk text to Low/Medium/High."""
    if not val:
        return None
    v = val.strip().lower()
    if v.startswith("low"):
        return "Low"
    if v.startswith("med") or v.startswith("moderate"):
        return "Medium"
    if v.startswith("high"):
        return "High"
    return None


def _nl_to_br(text: str) -> str:
    """Convert newlines to <br> for HTML."""
    return text.replace("\n\n", "</p><p style='margin:8px 0;'>").replace("\n", "<br>")
