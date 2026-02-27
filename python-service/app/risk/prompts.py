"""Prompt templates for the Morning Risk Assessment Engine.

Grade-based system: Low/Medium/High for 5 sheet-aligned factors,
0-10 supplemental scores for 3 factors the sheet does not assess.
"""

import os
from datetime import date

from .research_refresher import _extract_research_sections

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
7. **Timing** — Days to expected close, outside date proximity, extension risk, delays.
   IMPORTANT: Calculate exact months from the provided Today's Date to the Expected Close Date.
   Do NOT estimate timing from training data or general knowledge — use the actual dates provided.
   If your estimated close timing differs materially from the sheet's Expected Close Date,
   include a production_disagreement with factor "timing", citing specific filings/dates as evidence.
8. **Competing Bid** — Likelihood of topping bid, strategic interest, go-shop results

## Grade Comparison (CRITICAL)

The Google Sheet contains the production team's grades for Vote, Financing, Legal, and Investability.
Your primary job is to COMPARE your independent assessment against the production grades.

For each graded factor, you MUST provide a "vs_production" field:
- "agree" if your grade matches the production sheet
- "disagree" if your grade differs — explain WHY you differ in the detail field
- "no_production_grade" if the sheet doesn't have a grade for this factor

When you disagree with production, your detail field should explicitly reference the production grade
and explain what evidence leads you to a different conclusion.

## Additional Assessments

- **Investability**: Is this deal investable? Answer "Yes", "No", or "Conditional" with reasoning.
  Compare against the production sheet's investable flag.
- **Probability of Success** (0-100): Provide your independent estimate of deal completion
  probability as a structured object with:
  - "value": the probability (0-100)
  - "confidence": your confidence in this estimate (0.0-1.0)
  - "factors": list of key factors that influenced it, each with:
    - "factor": description of the factor
    - "weight": "high", "medium", or "low"
    - "direction": "positive" or "negative"

- **Probability of Higher Offer** (0-100): Provide a structured object with:
  - "value": the probability (0-100)
  - "confidence": your confidence in this estimate (0.0-1.0)
  - "factors": list of specific signals, each with:
    - "factor": description (go-shop status, strategic interest, premium vs sector comps, activist involvement, standalone value)
    - "weight": "high", "medium", or "low"
    - "direction": "positive" or "negative"

- **Break Price Estimate** ($): The price the target would trade to if the deal breaks.
  Provide a structured object with:
  - "value": the estimated break price in dollars
  - "confidence": your confidence in this estimate (0.0-1.0)
  - "anchors": list of price anchors used, each with:
    - "anchor": description (e.g. "Pre-deal 30-day VWAP", "Termination fee floor", "Sector comparable valuation")
    - "value": dollar value of this anchor
  - "methodology": brief description of how you combined the anchors

- **Implied Downside Estimate**: Percentage loss from current price to break price (scalar value).
- **Deal Summary**: 2-3 sentence overview of the deal's current status and risk profile.
- **Key Risks**: List the top 3-5 specific risks to this deal.
- **Watchlist Items**: List things to monitor in the coming days/weeks.
- **Needs Attention**: Flag true if any graded factor is High, any supplemental score >= 7, or there are significant recent changes.
- **Production Disagreements**: For each factor where you disagree with the production sheet,
  provide a structured object (see JSON schema below). Rules:
  - **factor**: one of timing|vote|financing|legal|regulatory|investable|probability|mac
  - **severity**: "material" = could change trade sizing or position; "notable" = worth monitoring;
    "minor" = cosmetic or low-impact difference
  - **is_new**: true if this disagreement was NOT present in the previous assessment's
    production_disagreements list (or if no previous assessment exists). false if persisting.
  - **evidence**: cite 1-3 specific sources from the context (filing type + date, halt code + date,
    sheet diff field + date, deal attribute). Each evidence item needs source, date, and detail.
  - **reasoning**: 1-2 sentences linking the evidence to your conclusion.

- **Assessment Changes**: If previous assessment data is provided, list any factors where
  your current grade/score differs from your PREVIOUS assessment (not the production sheet).
  Each change object needs the factor name, previous value, current value, what triggered the
  change (cite a specific event with date), and direction (improved or worsened).

You MUST respond with valid JSON in exactly this format:
{
    "grades": {
        "vote": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.85, "vs_production": "agree|disagree|no_production_grade"},
        "financing": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.90, "vs_production": "agree|disagree|no_production_grade"},
        "legal": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.80, "vs_production": "agree|disagree|no_production_grade"},
        "regulatory": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.75, "vs_production": "no_production_grade"},
        "mac": {"grade": "Low|Medium|High", "detail": "...", "confidence": 0.70, "vs_production": "no_production_grade"}
    },
    "supplemental_scores": {
        "market": {"score": 0, "detail": "..."},
        "timing": {"score": 0, "detail": "..."},
        "competing_bid": {"score": 0, "detail": "..."}
    },
    "investable_assessment": "Yes|No|Conditional",
    "investable_reasoning": "...",
    "investable_vs_production": "agree|disagree",
    "probability_of_success": {
        "value": 95.5,
        "confidence": 0.85,
        "factors": [
            {"factor": "Committed financing in place", "weight": "high", "direction": "positive"},
            {"factor": "CFIUS only regulatory hurdle", "weight": "medium", "direction": "positive"}
        ]
    },
    "probability_of_higher_offer": {
        "value": 12.0,
        "confidence": 0.70,
        "factors": [
            {"factor": "Go-shop period expired with no topping bid", "weight": "high", "direction": "negative"},
            {"factor": "Strategic interest from peer acquirers", "weight": "medium", "direction": "positive"}
        ]
    },
    "break_price_estimate": {
        "value": 28.50,
        "confidence": 0.60,
        "anchors": [
            {"anchor": "Pre-deal 30-day VWAP", "value": 26.80},
            {"anchor": "Termination fee floor", "value": 27.50}
        ],
        "methodology": "Weighted average of pre-deal range and comps, floored by termination fee"
    },
    "implied_downside_estimate": -15.2,
    "deal_summary": "2-3 sentence overview",
    "key_risks": ["risk1", "risk2", "risk3"],
    "watchlist_items": ["item1", "item2"],
    "needs_attention": true,
    "attention_reason": "reason or null if needs_attention is false",
    "production_disagreements": [
        {
            "factor": "timing|vote|financing|legal|regulatory|investable|probability|mac",
            "sheet_says": "Q2 2026",
            "ai_says": "Q3-Q4 2026",
            "severity": "material|notable|minor",
            "is_new": true,
            "evidence": [
                {"source": "14D-9 filing", "date": "2026-02-15", "detail": "Outside date Sep 30, 2026"}
            ],
            "reasoning": "1-2 sentence linking evidence to conclusion"
        }
    ],
    "assessment_changes": [
        {
            "factor": "timing",
            "previous": "Score 4/10",
            "current": "Score 7/10",
            "trigger": "EU Phase II review opened 2026-02-20",
            "direction": "improved|worsened"
        }
    ],
    "predictions": [
        {
            "type": "deal_closes",
            "claim": "Deal will close at $25.50 per share",
            "by_date": "2026-06-30",
            "probability": 0.92,
            "confidence": 0.80,
            "evidence": [
                {"source": "HSR filing", "date": "2026-01-15", "detail": "No second request after 30 days"}
            ]
        },
        {
            "type": "milestone_completion",
            "claim": "Shareholder vote will pass",
            "by_date": "2026-04-15",
            "probability": 0.95,
            "confidence": 0.85,
            "evidence": [
                {"source": "DEFM14A filing", "date": "2026-02-10", "detail": "Board unanimously recommends"}
            ]
        }
    ]
}

## Predictions

Make 2-5 explicit, falsifiable predictions about this deal. Each prediction must be:
- **type**: one of "deal_closes", "milestone_completion", "spread_direction", "break_price"
- **claim**: a clear, falsifiable statement (e.g., "HSR clearance will be received by May 2026")
- **by_date**: YYYY-MM-DD when the prediction should resolve
- **probability**: your probability estimate (0.00-1.00)
- **confidence**: how confident you are in THIS estimate (0.0-1.0)
- **evidence**: list of 1-3 evidence items (same format as disagreement evidence: source, date, detail)

You MUST include at least one "deal_closes" prediction for every deal.
You MUST include at least one "spread_direction" or "break_price" prediction.
If YOUR OPEN PREDICTIONS are shown below, update or supersede them when new evidence changes your view.

### Calibration Guidance (CRITICAL)
Base-rate: roughly 90% of announced M&A deals close. This means:
- A probability of 0.90-0.95 is the DEFAULT for a deal with no identified risk factors.
- Probabilities above 0.95 require STRONG justification (all milestones passed, no open risks).
- Probabilities below 0.80 require SPECIFIC identified threats (regulatory challenge, financing gap, shareholder opposition).
- If you assign >0.95 to more than 1 in 5 deals, you are likely overconfident.
- Spread your predictions across the probability range. Not every deal deserves 0.90+.

## Three-Signal Triangulation

When a SIGNAL COMPARISON section is provided, you MUST:
1. Note where the three signals agree (high confidence zone)
2. For each divergence >5pp, either:
   a. Justify YOUR estimate with specific evidence if you disagree with the market/sheet, OR
   b. Update your estimate toward the consensus if you lack contrary evidence
3. Never ignore the options-implied signal — it represents real money at risk

## Risk Factor Analysis Guide

When assessing each factor, look for these specific signals in the filing data and news:

### Vote Risk Signals
- Proxy filings (DEFM14A, PREM14A): Look for board recommendation, ISS/Glass Lewis opinions, activist positions
- Keywords: "dissenting shareholders", "proxy contest", "withhold recommendation", "insufficient quorum"
- Required vote threshold (simple majority vs supermajority) and insider ownership % that pre-commits
- Go-shop results: competing bids or lack thereof signal shareholder satisfaction

### Financing Risk Signals
- Commitment letters in 8-K Item 1.01: fully committed vs "highly confident" vs market-flex provisions
- Keywords: "financing condition", "reverse termination fee", "debt commitment", "bridge loan", "credit facility"
- Acquirer credit rating changes, leverage multiples, refinancing risk
- Cash-on-hand vs deal value ratio for all-cash deals

### Legal Risk Signals
- SC 14D-9 filings: target board recommendation changes, fiduciary out exercises
- Keywords: "class action", "appraisal rights", "fiduciary duty", "injunction", "TRO", "preliminary injunction"
- Litigation filed (check for complaint docket numbers in 8-K Item 8.01)
- Appraisal petition filings (esp. for low-premium deals <20%)

### Regulatory Risk Signals
- HSR filing date and 30-day waiting period status, second request issuance
- Keywords: "second request", "consent decree", "divestiture", "remedies", "phase II", "CFIUS"
- International filings: EC Phase I/II, CMA, ACCC, SAMR timelines
- Industry-specific regulators: FCC (telecom), FERC (energy), OCC/FDIC (banking)

### MAC Risk Signals
- Target's quarterly earnings (10-Q/10-K) relative to deal signing date
- Keywords: "material adverse change", "material adverse effect", "ordinary course", "interim covenants"
- Revenue/EBITDA trajectory vs projections used in fairness opinion
- Sector-wide headwinds: compare target's stock to sector ETF since announcement
- Covenant compliance in credit agreements

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

    # Anchor the model to the real current date
    sections.append(f"Today's Date: {date.today().isoformat()}")
    sections.append("")

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
        # Include previous disagreements so AI can flag new vs persisting
        ai_resp = prev.get("ai_response")
        if isinstance(ai_resp, str):
            try:
                ai_resp = __import__("json").loads(ai_resp)
            except (TypeError, ValueError):
                ai_resp = None
        if isinstance(ai_resp, dict):
            prev_disagreements = ai_resp.get("production_disagreements", [])
            if prev_disagreements:
                sections.append("Previous Production Disagreements:")
                for pd in prev_disagreements:
                    if isinstance(pd, dict):
                        sections.append(f"  - {pd.get('factor', '?')}: AI said {pd.get('ai_says', '?')} vs sheet {pd.get('sheet_says', '?')} (severity: {pd.get('severity', '?')})")
                    else:
                        sections.append(f"  - {pd}")
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

    # Section 8: Existing AI research (smart extraction of key sections)
    research = context.get("existing_research")
    if research:
        sections.append("## Existing AI Research")
        sections.append(f"Date: {research.get('created_at', 'N/A')}")
        content = research.get("content") or research.get("research_text") or ""
        content = _extract_research_sections(content, max_chars=2000)
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

    # Section 11: Options-implied probability
    options_prob = context.get("options_implied_probability")
    if options_prob is not None:
        sections.append("## Options-Implied Probability")
        sections.append(f"Deal Completion Probability: {options_prob * 100:.1f}%")
        options_snap = context.get("options_snapshot")
        if options_snap:
            sections.append(f"ATM IV: {options_snap.get('atm_iv', 'N/A')}")
            sections.append(f"Put/Call Ratio: {options_snap.get('put_call_ratio', 'N/A')}")
            sections.append(f"Unusual Volume: {options_snap.get('unusual_volume', 'N/A')}")
        sections.append("")

    # Section 12: Milestone timeline
    milestones = context.get("milestones")
    if milestones:
        sections.append("## Milestone Timeline")
        for m in milestones:
            status = m.get("status", "PENDING").upper()
            m_type = m.get("milestone_type", "unknown").replace("_", " ").title()
            m_date = m.get("expected_date") or m.get("milestone_date") or "N/A"
            affects = m.get("risk_factor_affected") or "N/A"
            sections.append(f"- [{status}] {m_type}: {m_date} (affects: {affects})")
        sections.append("")

    # Section 13: Three-signal comparison
    signal_comparison = context.get("signal_comparison")
    if signal_comparison:
        sections.append("## SIGNAL COMPARISON (three-signal triangulation)")
        signals = signal_comparison.get("signals", {})
        for signal_name, signal_val in signals.items():
            sections.append(f"- {signal_name}: {signal_val * 100:.1f}%")
        divergences = signal_comparison.get("divergences", [])
        if divergences:
            sections.append("Divergences (explain why or update your estimate):")
            for d in divergences:
                sections.append(f"  - {d['higher']} is {d['gap_pp']}pp more optimistic than {d['lower']}")
        sections.append("")

    # Section 14: Open predictions (for update/supersede)
    if os.environ.get("RISK_PREDICTIONS", "false").lower() == "true":
        open_preds = context.get("open_predictions", [])
        if open_preds:
            sections.append("## YOUR OPEN PREDICTIONS (update or supersede if evidence changed)")
            for p in open_preds:
                sections.append(
                    f"- [{p.get('prediction_type')}] {p.get('claim')} "
                    f"(P={p.get('probability')}, by {p.get('by_date')}, "
                    f"made {p.get('assessment_date')})"
                )
            sections.append("")

    # Section 15: Calibration feedback (computed once per run, same for all deals)
    calibration_text = context.get("calibration_text")
    if calibration_text:
        sections.append(calibration_text)

    # Section 16: Human corrections feedback
    corrections_text = context.get("corrections_text")
    if corrections_text:
        sections.append(corrections_text)

    # Section 17: Signal track record / weights
    signal_weights_text = context.get("signal_weights_text")
    if signal_weights_text:
        sections.append(signal_weights_text)

    # Section 18: Position status (M&A account)
    pos_data = context.get("position_data")
    if pos_data:
        qty = pos_data.get("position_qty", 0)
        avg = pos_data.get("avg_cost")
        sections.append("## POSITION STATUS")
        if avg is not None:
            sections.append(f"Currently held: Yes | {int(qty)} shares @ ${avg:.2f} avg cost")
        else:
            sections.append(f"Currently held: Yes | {int(qty)} shares")
        sections.append("")
    else:
        sections.append("## POSITION STATUS")
        sections.append("Currently held: No (surveillance only)")
        sections.append("")

    # Section 19: AI filing impact assessments (last 30 days)
    filing_impacts = context.get("filing_impacts", [])
    if filing_impacts:
        sections.append("## AI Filing Impact Assessments (last 30 days)")
        for fi in filing_impacts:
            level = (fi.get("impact_level") or "none").upper()
            sections.append(
                f"- [{fi.get('filing_type', 'N/A')}] {level}: "
                f"{fi.get('summary', 'N/A')} "
                f"(affects: {fi.get('risk_factor_affected', 'N/A')}, "
                f"grade change: {fi.get('grade_change_suggested') or 'none'})"
            )
            if fi.get("key_detail"):
                sections.append(f"  Key detail: {fi['key_detail']}")
        sections.append("")

    # Section 20: Recent M&A news articles (last 7 days)
    news_articles = context.get("news_articles", [])
    if news_articles:
        sections.append("## Recent M&A News (last 7 days)")
        for article in news_articles:
            pub_date = article.get("published_at")
            if hasattr(pub_date, "strftime"):
                pub_date = pub_date.strftime("%Y-%m-%d")
            sections.append(
                f"- [{pub_date or 'N/A'}] {article.get('title', 'N/A')} "
                f"({article.get('publisher', 'N/A')}) "
                f"— risk factor: {article.get('risk_factor_affected') or 'general'}"
            )
            if article.get("summary"):
                # Include first 200 chars of summary
                summary = article["summary"][:200]
                if len(article["summary"]) > 200:
                    summary += "..."
                sections.append(f"  {summary}")
        sections.append("")

    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Delta assessment prompts (Phase 3)
# ---------------------------------------------------------------------------

RISK_DELTA_SYSTEM_PROMPT = """You are an expert M&A risk analyst updating a previous assessment.

You will receive:
1. Your previous assessment (grades, scores, estimates, reasoning)
2. A list of what changed since yesterday

Your job: update grades and scores ONLY where the new information warrants it.
Preserve unchanged grades/scores exactly as they were. Update reasoning/detail
fields to reference new developments where relevant.

Respond with the SAME JSON format as a full assessment. Every field must be present.
If a grade hasn't changed, keep the previous value but you may update the detail text.

For production_disagreements, use the structured format with evidence citations:
each disagreement must include factor, sheet_says, ai_says, severity, is_new, evidence
(with source/date/detail), and reasoning. Check previous disagreements to set is_new
correctly (true only if this is a NEW disagreement not in the previous list).

For assessment_changes, list any factors where YOUR grade/score changed from the
previous assessment. Cite the specific trigger (event + date) and direction
(improved or worsened).

Be precise and concise. Only change grades when evidence clearly justifies it.
"""


def build_delta_assessment_prompt(
    context: dict,
    prev_assessment: dict,
    changes: list[str],
    significance: str,
) -> str:
    """Build a delta prompt with yesterday's assessment + only changed data.

    Much smaller than a full prompt: includes the compact previous assessment
    and only the sections that actually changed.
    """
    sections = []
    ticker = context.get("ticker", "UNKNOWN")

    # Anchor the model to the real current date
    sections.append(f"Today's Date: {date.today().isoformat()}")
    sections.append("")

    sections.append(f"## Delta Assessment for {ticker}")
    sections.append(f"Change significance: {significance}")
    sections.append("")

    # Previous assessment (compact)
    sections.append("## YOUR PREVIOUS ASSESSMENT")
    if prev_assessment:
        # Grades
        for f in ("vote", "financing", "legal", "regulatory", "mac"):
            grade = prev_assessment.get(f"{f}_grade", "N/A")
            detail = prev_assessment.get(f"{f}_detail", "")
            sections.append(f"  {f}: {grade} — {detail}")
        # Supplemental scores
        for f in ("market", "timing", "competing_bid"):
            score = prev_assessment.get(f"{f}_score", "N/A")
            detail = prev_assessment.get(f"{f}_detail", "")
            sections.append(f"  {f}: {score}/10 — {detail}")
        sections.append(f"  Investable: {prev_assessment.get('investable_assessment', 'N/A')}")
        prob_val = prev_assessment.get('our_prob_success', 'N/A')
        sections.append(f"  Prob Success: {prob_val}")
        # Include previous estimate reasoning if available (from ai_response)
        ai_resp = prev_assessment.get("ai_response")
        if isinstance(ai_resp, str):
            try:
                ai_resp = __import__("json").loads(ai_resp)
            except (TypeError, ValueError):
                ai_resp = None
        if isinstance(ai_resp, dict):
            for est_key, label in [
                ("probability_of_success", "Prob Success Factors"),
                ("probability_of_higher_offer", "Higher Offer Factors"),
                ("break_price_estimate", "Break Price Anchors"),
            ]:
                est = ai_resp.get(est_key)
                if isinstance(est, dict):
                    items = est.get("factors") or est.get("anchors") or []
                    if items:
                        sections.append(f"  {label}:")
                        for item in items:
                            if "factor" in item:
                                sections.append(f"    - {item['factor']} ({item.get('weight', '?')}, {item.get('direction', '?')})")
                            elif "anchor" in item:
                                sections.append(f"    - {item['anchor']}: ${item.get('value', '?')}")
        sections.append(f"  Summary: {prev_assessment.get('deal_summary', 'N/A')}")
        # Include previous disagreements so AI can flag new vs persisting
        prev_disagreements = ai_resp.get("production_disagreements", []) if isinstance(ai_resp, dict) else []
        if prev_disagreements:
            sections.append("  Previous Production Disagreements:")
            for pd in prev_disagreements:
                if isinstance(pd, dict):
                    sections.append(f"    - {pd.get('factor', '?')}: AI said {pd.get('ai_says', '?')} vs sheet {pd.get('sheet_says', '?')} (severity: {pd.get('severity', '?')})")
                else:
                    sections.append(f"    - {pd}")
    sections.append("")

    # What changed
    sections.append("## CHANGES SINCE LAST ASSESSMENT")
    if changes:
        for c in changes:
            sections.append(f"- {c}")
    else:
        sections.append("- Minor price drift only")
    sections.append("")

    # Include only changed data sections
    row = context.get("sheet_row")
    if row:
        sections.append("## Current Deal Metrics")
        sections.append(f"Deal Price: {row.get('deal_price_raw', 'N/A')}")
        sections.append(f"Current Price: {row.get('current_price_raw', 'N/A')}")
        sections.append(f"Gross Yield: {row.get('gross_yield_raw', 'N/A')}")
        sections.append(f"Countdown: {row.get('countdown_raw', 'N/A')}")
        sections.append("")

    # Include new filings if they're part of the change
    filings = context.get("recent_filings", [])
    prev_filing_count = 0
    if prev_assessment and prev_assessment.get("input_data"):
        try:
            prev_data = prev_assessment["input_data"]
            if isinstance(prev_data, str):
                prev_data = __import__("json").loads(prev_data)
            prev_filing_count = prev_data.get("filing_count", 0) or 0
        except (TypeError, KeyError):
            pass
    new_filings = filings[: len(filings) - prev_filing_count] if len(filings) > prev_filing_count else []
    if new_filings:
        sections.append("## NEW SEC Filings (since last assessment)")
        for f in new_filings:
            sections.append(f"- [{f.get('filing_type', 'N/A')}] {f.get('filed_at', 'N/A')}: {f.get('description', f.get('headline', 'N/A'))}")
        sections.append("")

    # Include recent halts if new
    halts = context.get("recent_halts", [])
    if halts:
        sections.append("## Recent Trading Halts")
        for h in halts:
            sections.append(f"- {h.get('halted_at', 'N/A')}: Code {h.get('halt_code', 'N/A')}")
        sections.append("")

    # Include sheet diffs if new
    diffs = context.get("sheet_diffs", [])
    if diffs:
        sections.append("## Recent Sheet Changes")
        for d in diffs:
            sections.append(f"- {d.get('diff_date', 'N/A')}: {d.get('field_name', 'N/A')} changed to '{d.get('new_value', 'N/A')}'")
        sections.append("")

    # Sheet comparison (always include for reference)
    comparison = context.get("sheet_comparison", {})
    if comparison:
        sections.append("## GOOGLE SHEET GRADES (for comparison)")
        sections.append(f"Vote Risk: {comparison.get('vote_risk', 'N/A')}")
        sections.append(f"Finance Risk: {comparison.get('finance_risk', 'N/A')}")
        sections.append(f"Legal Risk: {comparison.get('legal_risk', 'N/A')}")
        sections.append(f"Investable: {comparison.get('investable', 'N/A')}")
        sections.append("")

    # Signal divergences (for delta updates)
    signal_comparison = context.get("signal_comparison")
    if signal_comparison:
        divergences = signal_comparison.get("divergences", [])
        if divergences:
            sections.append("## SIGNAL DIVERGENCES (address in your update)")
            for d in divergences:
                sections.append(f"- {d['higher']} is {d['gap_pp']}pp more optimistic than {d['lower']}")
            sections.append("")

    return "\n".join(sections)
