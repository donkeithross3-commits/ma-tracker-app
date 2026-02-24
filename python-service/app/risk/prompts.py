"""Prompt templates for the Morning Risk Assessment Engine."""

RISK_ASSESSMENT_SYSTEM_PROMPT = """You are an expert M&A risk analyst specializing in merger arbitrage.
You assess the risk profile of pending M&A deals by analyzing multiple risk factors.

For each deal, you evaluate 8 risk factors on a scale of 0-10:
- 0-2: Low risk (deal proceeding normally, no concerns)
- 2-4: Moderate risk (minor issues, manageable)
- 4-6: Elevated risk (notable concerns, requires monitoring)
- 6-8: High risk (significant issues, deal completion uncertain)
- 8-10: Critical risk (severe problems, deal may fail)

The 8 risk factors are:
1. **Regulatory** - Antitrust review status, FTC/DOJ/international regulators, HSR filing, second requests
2. **Shareholder Vote** - Vote approval likelihood, proxy fights, activist opposition, meeting scheduled
3. **Financing** - Acquirer's ability to fund, debt commitment stability, credit conditions
4. **Legal** - Litigation risk, class actions, injunctions, appraisal rights
5. **Timing** - Days to expected close, outside date proximity, extension risk, delays
6. **MAC (Material Adverse Change)** - Target business deterioration, earnings misses, sector headwinds
7. **Market** - Spread behavior, unusual widening, volume anomalies, market sentiment
8. **Competing Bid** - Likelihood of topping bid, strategic interest, go-shop results

You MUST respond with valid JSON in exactly this format:
{
    "overall_risk_score": <float 0-10>,
    "overall_risk_summary": "<2-3 sentence summary of the deal's risk profile>",
    "regulatory": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "vote": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "financing": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "legal": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "timing": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "mac": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "market": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "competing_bid": {"score": <float 0-10>, "detail": "<1-2 sentence explanation>"},
    "probability_of_success": <float 0-100>,
    "needs_attention": <boolean>,
    "attention_reason": "<reason if needs_attention is true, else null>"
}

Be precise and concise. Base scores on the evidence provided, not speculation.
If data is missing for a factor, note it and assign a moderate default score (3-5).
Flag needs_attention=true if any factor scores >= 7 or overall >= 6, or if there are
significant recent changes (new filings, halts, spread moves)."""


def build_deal_assessment_prompt(context: dict) -> str:
    """Build the user prompt with all available deal context for AI assessment.

    Args:
        context: Dictionary with keys like 'sheet_row', 'deal_details',
                 'previous_assessment', 'recent_filings', 'recent_halts',
                 'sheet_diffs', 'existing_research', 'deal_attributes',
                 'live_price'.
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
        sections.append(f"Vote Risk: {row.get('vote_risk', 'N/A')}")
        sections.append(f"Finance Risk: {row.get('finance_risk', 'N/A')}")
        sections.append(f"Legal Risk: {row.get('legal_risk', 'N/A')}")
        sections.append(f"Investable: {row.get('investable', 'N/A')}")
        sections.append(f"Go Shop: {row.get('go_shop_raw', 'N/A')}")
        sections.append(f"CVR Flag: {row.get('cvr_flag', 'N/A')}")
        sections.append("")

    # Section 2: Deal details (structure, terms, risk ratings from detail tab)
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

    # Section 3: Previous assessment (yesterday's scores for comparison)
    prev = context.get("previous_assessment")
    if prev:
        sections.append("## Previous Risk Assessment")
        sections.append(f"Date: {prev.get('assessment_date', 'N/A')}")
        sections.append(f"Overall Score: {prev.get('overall_risk_score', 'N/A')} ({prev.get('overall_risk_level', 'N/A')})")
        sections.append(f"Regulatory: {prev.get('regulatory_score', 'N/A')}")
        sections.append(f"Vote: {prev.get('vote_score', 'N/A')}")
        sections.append(f"Financing: {prev.get('financing_score', 'N/A')}")
        sections.append(f"Legal: {prev.get('legal_score', 'N/A')}")
        sections.append(f"Timing: {prev.get('timing_score', 'N/A')}")
        sections.append(f"MAC: {prev.get('mac_score', 'N/A')}")
        sections.append(f"Market: {prev.get('market_score', 'N/A')}")
        sections.append(f"Competing Bid: {prev.get('competing_bid_score', 'N/A')}")
        sections.append(f"Probability: {prev.get('probability_of_success', 'N/A')}%")
        sections.append(f"Summary: {prev.get('overall_risk_summary', 'N/A')}")
        sections.append("")
    else:
        sections.append("## Previous Risk Assessment")
        sections.append("No previous assessment available (first assessment for this deal).")
        sections.append("")

    # Section 4: Recent EDGAR filings (last 30 days)
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

    # Section 5: Recent trading halts
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

    # Section 6: Sheet diffs (changes in last 7 days)
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

    # Section 7: Existing AI research
    research = context.get("existing_research")
    if research:
        sections.append("## Existing AI Research")
        sections.append(f"Date: {research.get('created_at', 'N/A')}")
        content = research.get("content") or research.get("research_text") or ""
        if len(content) > 2000:
            content = content[:2000] + "... [truncated]"
        sections.append(content)
        sections.append("")

    # Section 8: Deal attributes (extracted terms)
    attrs = context.get("deal_attributes")
    if attrs:
        sections.append("## Deal Attributes (extracted)")
        # deal_attributes may store data as JSONB 'attributes' column or individual columns
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

    # Section 9: Live market data
    live = context.get("live_price")
    if live:
        sections.append("## Live Market Data")
        sections.append(f"Current Price: {live.get('price', 'N/A')}")
        sections.append(f"Change: {live.get('change', 'N/A')}")
        sections.append("")

    return "\n".join(sections)
