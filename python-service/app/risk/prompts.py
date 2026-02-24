"""Prompt templates for the Morning Risk Assessment Engine.

Grade-based system: Low/Medium/High for 5 sheet-aligned factors,
0-10 supplemental scores for 3 factors the sheet does not assess.
"""

RISK_ASSESSMENT_SYSTEM_PROMPT = """You are an expert M&A risk analyst specializing in merger arbitrage.
You assess the risk profile of pending M&A deals by analyzing multiple risk factors.

## Graded Risk Factors (Low / Medium / High)

For the 5 factors below, assign a grade of Low, Medium, or High.
Arrive at your grades INDEPENDENTLY based on the evidence provided.
The Google Sheet grades are shown for comparison only — do NOT copy them blindly.

1. **Vote** — Shareholder vote approval likelihood, proxy fights, activist opposition, meeting status
2. **Financing** — Acquirer's ability to fund, debt commitment stability, credit conditions
3. **Legal** — Litigation risk, class actions, injunctions, appraisal rights
4. **Regulatory** — Antitrust review status, FTC/DOJ/international regulators, HSR filing, second requests
5. **MAC (Material Adverse Change)** — Target business deterioration, earnings misses, sector headwinds

Grade definitions:
- **Low**: Deal proceeding normally for this factor, no material concerns
- **Medium**: Notable concerns that require monitoring but are manageable
- **High**: Significant issues that could threaten deal completion

For each graded factor, also provide:
- A 1-2 sentence evidence-based detail explaining the grade
- A confidence score from 0.0 to 1.0 reflecting how certain you are

## Supplemental Scored Factors (0-10)

For these 3 factors, assign a numeric score from 0 to 10:
- 0-3: Low risk (normal conditions)
- 4-6: Elevated risk (requires monitoring)
- 7-10: High risk (significant concern)

6. **Market** — Spread behavior, unusual widening, volume anomalies, market sentiment
7. **Timing** — Days to expected close, outside date proximity, extension risk, delays
8. **Competing Bid** — Likelihood of topping bid, strategic interest, go-shop results

## Additional Assessments

- **Investability**: Is this deal investable? Answer "Yes", "No", or "Conditional" with reasoning.
- **Probability of Success**: Your independent estimate (0-100) of deal completion probability.
- **Probability of Higher Offer**: Estimate (0-100) of a competing or sweetened bid.
- **Break Price Estimate**: If the deal breaks, what price would the target trade to?
- **Implied Downside Estimate**: Percentage loss from current price to break price.
- **Deal Summary**: 2-3 sentence overview of the deal's current status and risk profile.
- **Key Risks**: List the top 3-5 specific risks to this deal.
- **Watchlist Items**: List things to monitor in the coming days/weeks.
- **Needs Attention**: Flag true if any graded factor is High, any supplemental score >= 7, or there are significant recent changes.

You MUST respond with valid JSON in exactly this format:
{
    "grades": {
        "vote": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.85},
        "financing": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.90},
        "legal": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.80},
        "regulatory": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.75},
        "mac": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.70}
    },
    "supplemental_scores": {
        "market": {"score": 0, "detail": "..."},
        "timing": {"score": 0, "detail": "..."},
        "competing_bid": {"score": 0, "detail": "..."}
    },
    "investable_assessment": "Yes|No|Conditional",
    "investable_reasoning": "...",
    "probability_of_success": 95.5,
    "probability_of_higher_offer": 12.0,
    "break_price_estimate": 28.50,
    "implied_downside_estimate": -15.2,
    "deal_summary": "2-3 sentence overview",
    "key_risks": ["risk1", "risk2", "risk3"],
    "watchlist_items": ["item1", "item2"],
    "needs_attention": true,
    "attention_reason": "reason or null if needs_attention is false"
}

Be precise and concise. Base grades and scores on the evidence provided, not speculation.
If data is missing for a factor, note it and assign a moderate default (Medium grade or score 4-5).
"""


def build_deal_assessment_prompt(context: dict) -> str:
    """Build the user prompt with all available deal context for AI assessment.

    Args:
        context: Dictionary with keys like 'sheet_row', 'deal_details',
                 'previous_assessment', 'recent_filings', 'recent_halts',
                 'sheet_diffs', 'existing_research', 'deal_attributes',
                 'live_price', 'sheet_comparison'.
    """
    sections = []

    # Section 1: Sheet row data (core deal metrics)
    row = context.get("sheet_row")
    if row:
        sections.append("## Deal Overview (from portfolio sheet)")
        sections.append(f"Ticker: {row.get('ticker', 'N/A')}")
        sections.append(f"Acquiror: {row.get('acquiror', 'N/A')}")
        sections.append(f"Category: {row.get('category', 'N/A')}")
        sections.append(f"Deal Price: {row.get('deal_price_raw', 'N/A')}")
        sections.append(f"Current Price: {row.get('current_price_raw', 'N/A')}")
        sections.append(f"Gross Yield: {row.get('gross_yield_raw', 'N/A')}")
        sections.append(f"Current Yield: {row.get('current_yield_raw', 'N/A')}")
        sections.append(f"Price Change: {row.get('price_change_raw', 'N/A')}")
        sections.append(f"Countdown (days): {row.get('countdown_raw', 'N/A')}")
        sections.append(f"Go Shop: {row.get('go_shop_raw', 'N/A')}")
        sections.append(f"CVR Flag: {row.get('cvr_flag', 'N/A')}")
        sections.append("")

    # Section 2: Google Sheet grades (for comparison -- arrive at your own grades)
    comparison = context.get("sheet_comparison", {})
    if comparison:
        sections.append("## GOOGLE SHEET GRADES (for comparison — arrive at your own grades)")
        sections.append(f"Vote Risk: {comparison.get('vote_risk', 'N/A')}")
        sections.append(f"Finance Risk: {comparison.get('finance_risk', 'N/A')}")
        sections.append(f"Legal Risk: {comparison.get('legal_risk', 'N/A')}")
        sections.append(f"Investable: {comparison.get('investable', 'N/A')}")
        sections.append(f"Prob Success: {comparison.get('prob_success', 'N/A')}")
        sections.append("")
    elif row:
        # Fallback: pull from row if sheet_comparison not explicitly provided
        sections.append("## GOOGLE SHEET GRADES (for comparison — arrive at your own grades)")
        sections.append(f"Vote Risk: {row.get('vote_risk', 'N/A')}")
        sections.append(f"Finance Risk: {row.get('finance_risk', 'N/A')}")
        sections.append(f"Legal Risk: {row.get('legal_risk', 'N/A')}")
        sections.append(f"Investable: {row.get('investable', 'N/A')}")
        sections.append(f"Prob Success: {row.get('prob_success', 'N/A')}")
        sections.append("")

    # Section 3: Deal details (structure, terms, risk ratings from detail tab)
    details = context.get("deal_details")
    if details:
        sections.append("## Deal Structure & Terms")
        sections.append(f"Cash Per Share: {details.get('cash_per_share', 'N/A')}")
        sections.append(f"Cash %: {details.get('cash_pct', 'N/A')}")
        sections.append(f"Stock Per Share: {details.get('stock_per_share', 'N/A')}")
        sections.append(f"Stock %: {details.get('stock_pct', 'N/A')}")
        sections.append(f"Stock Ratio: {details.get('stock_ratio', 'N/A')}")
        sections.append(f"Termination Fee: {details.get('termination_fee', 'N/A')} ({details.get('termination_fee_pct', 'N/A')}%)")
        sections.append(f"Regulatory Approvals: {details.get('regulatory_approvals', 'N/A')}")
        sections.append(f"Shareholder Vote: {details.get('shareholder_vote', 'N/A')}")
        sections.append(f"Board Approval: {details.get('board_approval', 'N/A')}")
        sections.append(f"Voting Agreements: {details.get('voting_agreements', 'N/A')}")
        sections.append(f"Expected Close Date: {details.get('expected_close_date', 'N/A')}")
        sections.append(f"Outside Date: {details.get('outside_date', 'N/A')}")
        sections.append(f"Probability of Success: {details.get('probability_of_success', 'N/A')}")
        sections.append(f"MAC Clauses: {details.get('mac_clauses', 'N/A')}")
        sections.append(f"Closing Conditions: {details.get('closing_conditions', 'N/A')}")
        sections.append(f"Financing Details: {details.get('financing_details', 'N/A')}")
        sections.append(f"Go Shop / Overbid: {details.get('go_shop_or_overbid', 'N/A')}")
        sections.append(f"Shareholder Risk: {details.get('shareholder_risk', 'N/A')}")
        sections.append(f"Financing Risk: {details.get('financing_risk', 'N/A')}")
        sections.append(f"Legal Risk: {details.get('legal_risk', 'N/A')}")
        sections.append("")

    # Section 4: Previous AI assessment (yesterday's grades)
    prev = context.get("previous_assessment")
    if prev:
        sections.append("## PREVIOUS AI ASSESSMENT")
        sections.append(f"Date: {prev.get('assessment_date', 'N/A')}")
        # Show grades if available (new format)
        if prev.get("vote_grade"):
            sections.append(f"Vote: {prev.get('vote_grade', 'N/A')} (confidence: {prev.get('vote_confidence', 'N/A')})")
            sections.append(f"Financing: {prev.get('financing_grade', 'N/A')} (confidence: {prev.get('financing_confidence', 'N/A')})")
            sections.append(f"Legal: {prev.get('legal_grade', 'N/A')} (confidence: {prev.get('legal_confidence', 'N/A')})")
            sections.append(f"Regulatory: {prev.get('regulatory_grade', 'N/A')} (confidence: {prev.get('regulatory_confidence', 'N/A')})")
            sections.append(f"MAC: {prev.get('mac_grade', 'N/A')} (confidence: {prev.get('mac_confidence', 'N/A')})")
        else:
            # Fallback to old numeric scores
            sections.append(f"Vote Score: {prev.get('vote_score', 'N/A')}")
            sections.append(f"Financing Score: {prev.get('financing_score', 'N/A')}")
            sections.append(f"Legal Score: {prev.get('legal_score', 'N/A')}")
            sections.append(f"Regulatory Score: {prev.get('regulatory_score', 'N/A')}")
            sections.append(f"MAC Score: {prev.get('mac_score', 'N/A')}")
        # Supplemental scores (always numeric)
        sections.append(f"Market Score: {prev.get('market_score', 'N/A')}")
        sections.append(f"Timing Score: {prev.get('timing_score', 'N/A')}")
        sections.append(f"Competing Bid Score: {prev.get('competing_bid_score', 'N/A')}")
        sections.append(f"Investable: {prev.get('investable_assessment', prev.get('overall_risk_level', 'N/A'))}")
        sections.append(f"Probability: {prev.get('our_prob_success', prev.get('probability_of_success', 'N/A'))}")
        sections.append(f"Summary: {prev.get('deal_summary', prev.get('overall_risk_summary', 'N/A'))}")
        sections.append("")
    else:
        sections.append("## PREVIOUS AI ASSESSMENT")
        sections.append("No previous assessment available (first assessment for this deal).")
        sections.append("")

    # Section 5: Recent EDGAR filings (last 30 days)
    filings = context.get("recent_filings", [])
    if filings:
        sections.append("## Recent SEC Filings (last 30 days)")
        for f in filings:
            sections.append(f"- [{f.get('filing_type', 'N/A')}] {f.get('filed_at', 'N/A')}: {f.get('description', f.get('headline', 'N/A'))}")
            if f.get("relevance_reasoning"):
                sections.append(f"  Relevance: {f['relevance_reasoning']}")
        sections.append("")
    else:
        sections.append("## Recent SEC Filings (last 30 days)")
        sections.append("No recent filings found.")
        sections.append("")

    # Section 6: Recent trading halts
    halts = context.get("recent_halts", [])
    if halts:
        sections.append("## Recent Trading Halts (last 7 days)")
        for h in halts:
            sections.append(f"- {h.get('halted_at', 'N/A')}: Code {h.get('halt_code', 'N/A')} - {h.get('reason', h.get('halt_reason', 'N/A'))}")
        sections.append("")
    else:
        sections.append("## Recent Trading Halts (last 7 days)")
        sections.append("No recent halts.")
        sections.append("")

    # Section 7: Sheet diffs (changes in last 7 days)
    diffs = context.get("sheet_diffs", [])
    if diffs:
        sections.append("## Portfolio Sheet Changes (last 7 days)")
        for d in diffs:
            sections.append(f"- {d.get('diff_date', 'N/A')}: {d.get('field_name', 'N/A')} changed from '{d.get('old_value', 'N/A')}' to '{d.get('new_value', 'N/A')}'")
        sections.append("")
    else:
        sections.append("## Portfolio Sheet Changes (last 7 days)")
        sections.append("No recent changes detected.")
        sections.append("")

    # Section 8: Existing AI research
    research = context.get("existing_research")
    if research:
        sections.append("## Existing AI Research")
        sections.append(f"Date: {research.get('created_at', 'N/A')}")
        content = research.get("content") or research.get("research_text") or ""
        if len(content) > 2000:
            content = content[:2000] + "... [truncated]"
        sections.append(content)
        sections.append("")

    # Section 9: Deal attributes (extracted terms)
    attrs = context.get("deal_attributes")
    if attrs:
        sections.append("## Deal Attributes (extracted)")
        if isinstance(attrs, dict):
            for k, v in attrs.items():
                if k not in ("id", "ticker", "created_at", "updated_at") and v is not None:
                    sections.append(f"- {k}: {v}")
        else:
            # asyncpg Record - iterate keys
            for k in attrs.keys():
                if k not in ("id", "ticker", "created_at", "updated_at"):
                    v = attrs[k]
                    if v is not None:
                        sections.append(f"- {k}: {v}")
        sections.append("")

    # Section 10: Live market data
    live = context.get("live_price")
    if live:
        sections.append("## Live Market Data")
        sections.append(f"Current Price: {live.get('price', 'N/A')}")
        sections.append(f"Change: {live.get('change', 'N/A')}")
        sections.append("")

    return "\n".join(sections)
