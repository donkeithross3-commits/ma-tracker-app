"""HTML email template for individual deal risk assessments.

Designed around the AI-vs-Production comparison: the centerpiece of each email
is a side-by-side table showing production sheet grades vs the AI's independent grades,
with disagreements highlighted.
"""
from datetime import datetime
from typing import Dict, Any, Optional


def _grade_color(grade: str) -> str:
    """Map risk grade to a color."""
    g = (grade or "").lower()
    if g == "low":
        return "#16a34a"  # green
    elif g == "medium":
        return "#d97706"  # amber
    elif g == "high":
        return "#dc2626"  # red
    return "#6b7280"  # gray


def _grade_badge(grade: str, small: bool = False) -> str:
    """Render a colored badge for a risk grade."""
    if not grade or grade == "N/A":
        return '<span style="color:#9ca3af;font-size:12px;">&mdash;</span>'
    color = _grade_color(grade)
    size = "11px" if small else "12px"
    pad = "2px 8px" if small else "3px 10px"
    return (
        f'<span style="display:inline-block;padding:{pad};border-radius:12px;'
        f'font-size:{size};font-weight:700;color:{color};background-color:{color}18;'
        f'border:1px solid {color}30;">{grade}</span>'
    )


def _match_icon(vs: str) -> str:
    """Render agree/disagree icon."""
    if vs == "agree":
        return '<span style="color:#16a34a;font-size:16px;font-weight:bold;">&#10003;</span>'
    elif vs == "disagree":
        return '<span style="color:#dc2626;font-size:16px;font-weight:bold;">&#10007;</span>'
    return '<span style="color:#9ca3af;font-size:12px;">&mdash;</span>'


def _extract_estimate(assessment: dict, key: str):
    """Extract estimate data, handling both structured and scalar formats."""
    raw = assessment.get(key)
    if isinstance(raw, dict):
        return raw
    if raw is not None:
        return {"value": raw}
    return None


def _confidence_badge(estimate_data: dict) -> str:
    """Render a small confidence badge if confidence is available."""
    if not estimate_data or not isinstance(estimate_data, dict):
        return ""
    conf = estimate_data.get("confidence")
    if conf is None:
        return ""
    pct = int(conf * 100)
    color = "#16a34a" if conf >= 0.8 else "#d97706" if conf >= 0.6 else "#dc2626"
    return (
        f'<div style="font-size:10px;color:{color};margin-top:2px;">'
        f'{pct}% confidence</div>'
    )


def _estimate_factors_html(estimate_data) -> str:
    """Render factor list with +/- icons and weight indicators."""
    if not isinstance(estimate_data, dict):
        return ""
    factors = estimate_data.get("factors", [])
    if not factors:
        return ""
    rows = ""
    for f in factors:
        direction = f.get("direction", "")
        weight = f.get("weight", "medium")
        factor_text = f.get("factor", "")
        icon = '<span style="color:#16a34a;font-weight:bold;">+</span>' if direction == "positive" else '<span style="color:#dc2626;font-weight:bold;">&minus;</span>'
        weight_color = "#1d4ed8" if weight == "high" else "#6b7280" if weight == "medium" else "#9ca3af"
        weight_label = weight.upper()
        rows += (
            f'<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:3px;font-size:11px;line-height:1.4;">'
            f'{icon} '
            f'<span style="color:#374151;">{factor_text}</span>'
            f'<span style="color:{weight_color};font-size:9px;font-weight:600;letter-spacing:0.3px;">{weight_label}</span>'
            f'</div>'
        )
    return (
        f'<div style="background:#f8fafc;border-radius:4px;padding:8px 10px;margin-top:8px;">'
        f'{rows}</div>'
    )


def _break_price_anchors_html(estimate_data) -> str:
    """Render anchor table (anchor name + dollar value)."""
    if not isinstance(estimate_data, dict):
        return ""
    anchors = estimate_data.get("anchors", [])
    methodology = estimate_data.get("methodology", "")
    if not anchors and not methodology:
        return ""
    rows = ""
    for a in anchors:
        anchor_name = a.get("anchor", "")
        anchor_val = a.get("value")
        val_str = f"${anchor_val:,.2f}" if anchor_val is not None else "N/A"
        rows += (
            f'<div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;">'
            f'<span style="color:#6b7280;">{anchor_name}</span>'
            f'<span style="color:#374151;font-weight:600;">{val_str}</span>'
            f'</div>'
        )
    if methodology:
        rows += f'<div style="font-size:10px;color:#9ca3af;margin-top:4px;font-style:italic;">{methodology}</div>'
    return (
        f'<div style="background:#f8fafc;border-radius:4px;padding:8px 10px;margin-top:8px;">'
        f'{rows}</div>'
    )


def _estimate_factors_section(prob_data, prob_higher_data, break_data) -> str:
    """Render the combined estimate reasoning section below hero cards."""
    prob_factors = _estimate_factors_html(prob_data) if prob_data else ""
    higher_factors = _estimate_factors_html(prob_higher_data) if prob_higher_data else ""
    break_anchors = _break_price_anchors_html(break_data) if break_data else ""

    if not prob_factors and not higher_factors and not break_anchors:
        return ""

    sections = []
    if prob_factors:
        sections.append(
            f'<div style="flex:1;min-width:200px;">'
            f'<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Success Factors</div>'
            f'{prob_factors}</div>'
        )
    if higher_factors:
        sections.append(
            f'<div style="flex:1;min-width:200px;">'
            f'<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Higher Offer Signals</div>'
            f'{higher_factors}</div>'
        )
    if break_anchors:
        sections.append(
            f'<div style="flex:1;min-width:200px;">'
            f'<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Break Price Anchors</div>'
            f'{break_anchors}</div>'
        )

    content = "".join(sections)
    return (
        f'<div style="padding:12px 24px;border-bottom:1px solid #e2e8f0;background:#fafbfc;">'
        f'<h2 style="font-size:13px;color:#0f172a;margin:0 0 8px 0;">Estimate Reasoning</h2>'
        f'<div style="display:flex;gap:16px;flex-wrap:wrap;">{content}</div>'
        f'</div>'
    )


def _score_bar(score: int, max_score: int = 5) -> str:
    """Render a simple inline score indicator (filled/empty dots)."""
    filled = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:#2563eb;margin-right:3px;"></span>'
    empty = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:#e5e7eb;margin-right:3px;"></span>'
    return filled * score + empty * (max_score - score)


def risk_assessment_email(
    assessment: Dict[str, Any],
    ticker: str,
    deal_context: Optional[Dict[str, Any]] = None,
    model_label: Optional[str] = None,
) -> str:
    """Generate a polished HTML email for a single deal risk assessment.

    The email centers on the comparison between AI grades and the production
    Google Sheet grades, highlighting agreements and disagreements.
    """
    now = datetime.now().strftime("%A, %B %d, %Y")
    grades = assessment.get("grades", {})
    supplemental = assessment.get("supplemental_scores", {})
    meta = assessment.get("_meta", {})

    # Deal header info from context
    sheet = {}
    if deal_context:
        sheet = deal_context.get("sheet_row", {})

    deal_price_raw = sheet.get("deal_price_raw") or ""
    current_price_raw = sheet.get("current_price_raw") or ""
    acquirer = sheet.get("acquirer") or sheet.get("acquiror") or ""
    target = sheet.get("target") or sheet.get("company") or ticker
    category = sheet.get("category") or ""
    spread_raw = sheet.get("gross_yield_raw") or sheet.get("spread") or ""
    current_yield_raw = sheet.get("current_yield_raw") or ""
    countdown = sheet.get("countdown_raw") or ""

    # Production grades from the sheet
    prod_vote = sheet.get("vote_risk") or "N/A"
    prod_finance = sheet.get("finance_risk") or "N/A"
    prod_legal = sheet.get("legal_risk") or "N/A"
    prod_investable = sheet.get("investable") or "N/A"

    prod_grades = {
        "vote": prod_vote,
        "financing": prod_finance,
        "legal": prod_legal,
        "regulatory": None,  # Not in production sheet
        "mac": None,  # Not in production sheet
    }

    # Count agreements/disagreements
    agree_count = 0
    disagree_count = 0
    for key in ("vote", "financing", "legal", "regulatory", "mac"):
        vs = grades.get(key, {}).get("vs_production", "")
        if vs == "agree":
            agree_count += 1
        elif vs == "disagree":
            disagree_count += 1

    # Also check investable
    inv_vs = assessment.get("investable_vs_production", "")
    if inv_vs == "agree":
        agree_count += 1
    elif inv_vs == "disagree":
        disagree_count += 1

    # Header detail string
    header_parts = []
    if acquirer:
        header_parts.append(acquirer)
    if category:
        header_parts.append(category)
    if countdown:
        header_parts.append(f"{countdown} days to close")
    header_detail_str = " &bull; ".join(header_parts)

    # Extract structured estimate data
    prob_data = _extract_estimate(assessment, "probability_of_success")
    prob_higher_data = _extract_estimate(assessment, "probability_of_higher_offer")
    break_data = _extract_estimate(assessment, "break_price_estimate")

    # Probability & investability
    prob = prob_data.get("value") if prob_data else None
    prob_str = f"{prob:.0f}%" if prob is not None else "N/A"
    prob_color = "#16a34a" if prob and prob >= 80 else "#d97706" if prob and prob >= 60 else "#dc2626"

    investable = assessment.get("investable_assessment", "N/A")
    inv_color = "#16a34a" if investable == "Yes" else "#dc2626" if investable == "No" else "#d97706"

    # Agreement summary color
    if disagree_count == 0:
        agreement_color = "#16a34a"
        agreement_label = "Full Agreement"
    elif disagree_count <= 2:
        agreement_color = "#d97706"
        agreement_label = f"{disagree_count} Disagreement{'s' if disagree_count > 1 else ''}"
    else:
        agreement_color = "#dc2626"
        agreement_label = f"{disagree_count} Disagreements"

    # Build the comparison table rows
    grade_labels = {
        "vote": ("Shareholder Vote", "vote_risk"),
        "financing": ("Financing", "finance_risk"),
        "legal": ("Legal / Litigation", "legal_risk"),
        "regulatory": ("Regulatory", None),
        "mac": ("Material Adverse Change", None),
    }

    comparison_rows = ""
    for key, (label, prod_key) in grade_labels.items():
        g = grades.get(key, {})
        ai_grade = g.get("grade", "N/A")
        detail = g.get("detail", "")
        confidence = g.get("confidence")
        vs = g.get("vs_production", "no_production_grade")
        prod_val = prod_grades.get(key)

        conf_str = f' <span style="color:#9ca3af;font-size:10px;">({confidence:.0%})</span>' if confidence else ""

        # Row background: light red tint for disagreements
        row_bg = "background-color:#fef2f2;" if vs == "disagree" else ""

        prod_cell = _grade_badge(prod_val, small=True) if prod_val else '<span style="color:#9ca3af;font-size:11px;">N/A</span>'

        comparison_rows += f"""
        <tr style="{row_bg}">
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;font-size:13px;vertical-align:top;width:150px;">{label}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;width:70px;">{prod_cell}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;width:70px;">{_grade_badge(ai_grade, small=True)}{conf_str}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;width:30px;">{_match_icon(vs)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.4;vertical-align:top;">{detail}</td>
        </tr>"""

    # Investable comparison row
    inv_row_bg = "background-color:#fef2f2;" if inv_vs == "disagree" else ""
    prod_inv_badge = f'<span style="font-weight:700;color:{"#16a34a" if prod_investable == "Yes" else "#dc2626"};font-size:12px;">{prod_investable}</span>' if prod_investable != "N/A" else '<span style="color:#9ca3af;">N/A</span>'
    ai_inv_badge = f'<span style="font-weight:700;color:{inv_color};font-size:12px;">{investable}</span>'
    inv_reasoning = assessment.get("investable_reasoning", "")

    comparison_rows += f"""
        <tr style="{inv_row_bg}">
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;font-size:13px;vertical-align:top;">Investable</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;">{prod_inv_badge}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;">{ai_inv_badge}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;vertical-align:top;">{_match_icon(inv_vs)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.4;vertical-align:top;">{inv_reasoning}</td>
        </tr>"""

    # Supplemental scores
    supp_labels = {
        "market": "Market Conditions",
        "timing": "Timing / Timeline",
        "competing_bid": "Competing Bid Risk",
    }
    supp_rows = ""
    for key, label in supp_labels.items():
        s = supplemental.get(key, {})
        score = s.get("score", 0)
        detail = s.get("detail", "")
        supp_rows += f"""
        <tr>
            <td style="padding:10px 16px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;width:180px;vertical-align:top;">{label}</td>
            <td style="padding:10px 16px;border-bottom:1px solid #f3f4f6;vertical-align:top;width:90px;">{_score_bar(score)}</td>
            <td style="padding:10px 16px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.4;">{detail}</td>
        </tr>"""

    # Key risks list
    risks = assessment.get("key_risks", [])
    risk_items = "".join(f'<li style="margin-bottom:6px;color:#374151;font-size:13px;line-height:1.5;">{r}</li>' for r in risks)

    # Watchlist items
    watchlist = assessment.get("watchlist_items", [])
    watch_items = "".join(f'<li style="margin-bottom:6px;color:#374151;font-size:13px;line-height:1.5;">{w}</li>' for w in watchlist)

    # Production disagreements callout
    disagreements = assessment.get("production_disagreements", [])
    disagreement_section = ""
    if disagreements:
        items = "".join(f'<li style="margin-bottom:8px;color:#374151;font-size:13px;line-height:1.5;">{d}</li>' for d in disagreements)
        disagreement_section = f"""
            <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:#fef2f2;">
                <h2 style="font-size:16px;color:#dc2626;margin:0 0 10px 0;">Where AI Disagrees with Production</h2>
                <ul style="margin:0;padding-left:20px;">{items}</ul>
            </div>"""

    # Deal summary
    summary = assessment.get("deal_summary", "")

    # Break price / downside / higher offer — extract scalar values from structured data
    break_price = break_data.get("value") if break_data else None
    downside_data = _extract_estimate(assessment, "implied_downside_estimate")
    downside = downside_data.get("value") if downside_data else None
    prob_higher = prob_higher_data.get("value") if prob_higher_data else None

    scenario_items = ""
    if break_price is not None:
        scenario_items += f"""
                <div style="flex:1;min-width:130px;text-align:center;padding:12px;background:#fef2f2;border-radius:6px;">
                    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Break Price</div>
                    <div style="font-size:20px;font-weight:700;color:#dc2626;">${break_price:.2f}</div>
                    {f'<div style="font-size:11px;color:#6b7280;">{downside:+.1f}%</div>' if downside is not None else ''}
                    {_confidence_badge(break_data)}
                </div>"""
    if prob_higher is not None:
        scenario_items += f"""
                <div style="flex:1;min-width:130px;text-align:center;padding:12px;background:#f0fdf4;border-radius:6px;">
                    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Higher Offer</div>
                    <div style="font-size:20px;font-weight:700;color:#16a34a;">{prob_higher:.0f}%</div>
                    <div style="font-size:11px;color:#6b7280;">probability</div>
                    {_confidence_badge(prob_higher_data)}
                </div>"""

    # Model / cost footer
    model_name = meta.get("model", "unknown")
    cost = meta.get("cost_usd", 0)
    latency = meta.get("processing_time_ms", 0)
    tokens = meta.get("tokens_used", 0)

    if "opus" in model_name:
        friendly_model = "Claude Opus"
    elif "sonnet" in model_name:
        friendly_model = "Claude Sonnet"
    elif "haiku" in model_name:
        friendly_model = "Claude Haiku"
    else:
        friendly_model = model_name
    if model_label:
        friendly_model = model_label

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;background-color:#f1f5f9;">
    <div style="max-width:740px;margin:0 auto;padding:20px;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1d4ed8 100%);color:#ffffff;padding:28px 24px;border-radius:12px 12px 0 0;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.6;margin-bottom:4px;">AI Risk Assessment</div>
            <h1 style="margin:0;font-size:28px;font-weight:800;">{ticker} &mdash; {target}</h1>
            <p style="margin:6px 0 0 0;font-size:14px;opacity:0.85;">{header_detail_str}</p>

            <!-- Price bar -->
            <div style="margin-top:14px;display:flex;gap:20px;flex-wrap:wrap;">
                <div>
                    <div style="font-size:10px;text-transform:uppercase;opacity:0.5;">Deal Price</div>
                    <div style="font-size:20px;font-weight:700;">{deal_price_raw or 'N/A'}</div>
                </div>
                <div>
                    <div style="font-size:10px;text-transform:uppercase;opacity:0.5;">Current</div>
                    <div style="font-size:20px;font-weight:700;">{current_price_raw or 'N/A'}</div>
                </div>
                <div>
                    <div style="font-size:10px;text-transform:uppercase;opacity:0.5;">Spread</div>
                    <div style="font-size:20px;font-weight:700;">{spread_raw or 'N/A'}</div>
                </div>
                <div>
                    <div style="font-size:10px;text-transform:uppercase;opacity:0.5;">Ann. Yield</div>
                    <div style="font-size:20px;font-weight:700;">{current_yield_raw or 'N/A'}</div>
                </div>
            </div>
            <p style="margin:8px 0 0 0;font-size:11px;opacity:0.5;">{now}</p>
        </div>

        <!-- Main body -->
        <div style="background:#ffffff;padding:0;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;">

            <!-- Hero metrics row -->
            <div style="display:flex;padding:16px 24px;border-bottom:1px solid #e2e8f0;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:130px;text-align:center;padding:14px;background:#f8fafc;border-radius:8px;">
                    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Success Prob.</div>
                    <div style="font-size:28px;font-weight:800;color:{prob_color};">{prob_str}</div>
                    {_confidence_badge(prob_data)}
                </div>
                <div style="flex:1;min-width:130px;text-align:center;padding:14px;background:#f8fafc;border-radius:8px;">
                    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">AI vs Production</div>
                    <div style="font-size:20px;font-weight:800;color:{agreement_color};">{agreement_label}</div>
                    <div style="font-size:11px;color:#6b7280;">{agree_count} agree, {disagree_count} differ</div>
                </div>
                {scenario_items}
            </div>

            <!-- Estimate Reasoning -->
            {_estimate_factors_section(prob_data, prob_higher_data, break_data)}

            <!-- Deal Summary -->
            <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
                <h2 style="font-size:15px;color:#0f172a;margin:0 0 8px 0;">Deal Summary</h2>
                <p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">{summary}</p>
            </div>

            {disagreement_section}

            <!-- Grade Comparison Table -->
            <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
                <h2 style="font-size:15px;color:#0f172a;margin:0 0 12px 0;">Production vs AI Grades</h2>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Factor</th>
                            <th style="padding:8px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Sheet</th>
                            <th style="padding:8px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">AI</th>
                            <th style="padding:8px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;width:30px;"></th>
                            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">AI Reasoning</th>
                        </tr>
                    </thead>
                    <tbody>{comparison_rows}</tbody>
                </table>
            </div>

            <!-- Supplemental Scores -->
            <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
                <h2 style="font-size:15px;color:#0f172a;margin:0 0 10px 0;">Supplemental Scores</h2>
                <table style="width:100%;border-collapse:collapse;">
                    <tbody>{supp_rows}</tbody>
                </table>
            </div>

            <!-- Key Risks + Watchlist side by side -->
            <div style="display:flex;gap:0;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;">
                <div style="flex:1;min-width:280px;padding:16px 24px;border-right:1px solid #e2e8f0;">
                    <h2 style="font-size:15px;color:#dc2626;margin:0 0 8px 0;">Key Risks</h2>
                    <ul style="margin:0;padding-left:18px;">{risk_items}</ul>
                </div>
                <div style="flex:1;min-width:280px;padding:16px 24px;">
                    <h2 style="font-size:15px;color:#d97706;margin:0 0 8px 0;">Watchlist</h2>
                    <ul style="margin:0;padding-left:18px;">{watch_items}</ul>
                </div>
            </div>

            <!-- Footer -->
            <div style="padding:14px 24px;background:#f8fafc;border-radius:0 0 12px 12px;">
                <div style="font-size:11px;color:#9ca3af;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <span>Model: {friendly_model}</span>
                    <span>Tokens: {tokens:,}</span>
                    <span>Latency: {latency/1000:.1f}s</span>
                    <span>Cost: ${cost:.4f}</span>
                </div>
                <div style="margin-top:6px;font-size:11px;color:#9ca3af;">
                    M&A Tracker Risk Engine &bull; <a href="https://dr3-dashboard.com" style="color:#2563eb;text-decoration:none;">dr3-dashboard.com</a>
                </div>
            </div>
        </div>
    </div>
</body>
</html>"""
