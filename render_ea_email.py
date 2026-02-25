"""Quick render script to preview the EA risk assessment email template."""
import sys
sys.path.insert(0, "python-service")

from app.services.risk_email_template import risk_assessment_email

# EA Opus assessment data from the latest run
assessment = {
    "grades": {
        "vote": {
            "grade": "Low",
            "detail": "Board unanimously approved the transaction. Voting agreements covering 9.9% of outstanding shares secured. Only requires majority vote of outstanding shares, making approval highly likely.",
            "confidence": 0.90,
            "vs_production": "agree"
        },
        "financing": {
            "grade": "Medium",
            "detail": "Silver Lake has committed financing for the $55B+ transaction, but deal size makes it one of the largest PE buyouts ever. Credit market conditions and debt placement carry execution risk given the scale.",
            "confidence": 0.80,
            "vs_production": "agree"
        },
        "legal": {
            "grade": "Low",
            "detail": "No litigation or legal challenges identified. Standard merger agreement with customary termination provisions. Reverse termination fee provides downside protection.",
            "confidence": 0.90,
            "vs_production": "agree"
        },
        "regulatory": {
            "grade": "Low",
            "detail": "Primary regulatory hurdle is CFIUS review, which is typically routine for PE buyers without foreign ownership concerns. No antitrust issues apparent as Silver Lake is a financial buyer.",
            "confidence": 0.85,
            "vs_production": "no_production_grade"
        },
        "mac": {
            "grade": "Low",
            "detail": "EA's gaming business remains stable with strong franchise portfolio (FC, Madden, Apex Legends). No reported earnings deterioration or sector-wide disruption.",
            "confidence": 0.75,
            "vs_production": "no_production_grade"
        }
    },
    "supplemental_scores": {
        "market": {
            "score": 3,
            "detail": "Spread at 4.7% is reasonable for a large PE deal with ~7 month timeline. Minimal daily volatility in spread; stock tracking deal price closely."
        },
        "timing": {
            "score": 4,
            "detail": "Expected close in Q3 2026 with outside date in Q4 2026. Long timeline is normal for PE transactions of this scale but increases exposure to market events."
        },
        "competing_bid": {
            "score": 2,
            "detail": "No go-shop period. Voting agreements covering 9.9% and deal size (~$55B) make competing bids extremely unlikely. No strategic buyer has emerged."
        }
    },
    "investable_assessment": "Yes",
    "investable_reasoning": "Deal offers attractive annualized return of ~13% with manageable risks. Committed financing, board support, and straightforward regulatory path support investment despite the long timeline.",
    "investable_vs_production": "agree",
    "probability_of_success": 92.0,
    "probability_of_higher_offer": 3.0,
    "break_price_estimate": 155.00,
    "implied_downside_estimate": -22.9,
    "deal_summary": "Silver Lake's $210.38/share acquisition of Electronic Arts represents one of the largest PE buyouts in history at ~$55B enterprise value. The deal has secured board approval, 9.9% voting agreements, and committed financing. With CFIUS as the primary regulatory hurdle and no litigation risks identified, the 4.7% spread primarily reflects the lengthy ~7 month timeline and massive deal size.",
    "key_risks": [
        "Financing execution risk given unprecedented PE deal size ($55B+)",
        "Long timeline (~216 days) increases exposure to credit market volatility",
        "Gaming sector cyclicality could trigger MAC clause concerns",
        "Credit market deterioration could impact debt commitment viability"
    ],
    "watchlist_items": [
        "CFIUS review progress and any national security concerns",
        "Credit market conditions for large LBO financing packages",
        "EA quarterly earnings for business performance stability",
        "Any activist shareholder activity or competing interest"
    ],
    "needs_attention": False,
    "attention_reason": None,
    "production_disagreements": [
        {
            "factor": "timing",
            "sheet_says": "Q2 2026",
            "ai_says": "Q3-Q4 2026",
            "severity": "material",
            "is_new": True,
            "evidence": [
                {"source": "Merger Agreement (S-4)", "date": "2026-01-20", "detail": "Outside date set to Sep 30, 2026"},
                {"source": "Sheet countdown", "date": "2026-02-24", "detail": "216 days remaining implies Oct 2026 close"}
            ],
            "reasoning": "The outside date of Sep 30 and 216-day countdown are inconsistent with a Q2 2026 close. Expected timeline is Q3-Q4 2026."
        },
        {
            "factor": "financing",
            "sheet_says": "Medium",
            "ai_says": "Medium",
            "severity": "minor",
            "is_new": False,
            "evidence": [
                {"source": "Commitment letter", "date": "2026-01-15", "detail": "Fully committed financing from syndicate"}
            ],
            "reasoning": "Both agree on Medium but AI notes the unprecedented deal size ($55B+) warrants continued monitoring of credit market conditions."
        }
    ],
    "assessment_changes": [
        {
            "factor": "timing",
            "previous": "Score 3/10",
            "current": "Score 4/10",
            "trigger": "Calendar progression — 216 days still remaining as of 2026-02-24",
            "direction": "worsened"
        }
    ],
    "_meta": {
        "model": "claude-opus-4-20250514",
        "cost_usd": 0.0899,
        "processing_time_ms": 20300,
        "tokens_used": 1247,
    }
}

# Deal context (from sheet_row in the database)
deal_context = {
    "sheet_row": {
        "ticker": "EA",
        "target": "Electronic Arts",
        "acquiror": "Silver Lake",
        "category": "PE Buyout",
        "deal_price_raw": "$210.38",
        "current_price_raw": "$201.00",
        "gross_yield_raw": "4.67%",
        "current_yield_raw": "13.3%",
        "price_change_raw": "-0.15%",
        "countdown_raw": "216",
        "go_shop_raw": "No",
        "cvr_flag": "No",
        "vote_risk": "Low",
        "finance_risk": "Medium",
        "legal_risk": "Low",
        "investable": "Yes",
        "prob_success": "90%",
    }
}

html = risk_assessment_email(assessment, "EA", deal_context)

with open("ea_risk_assessment.html", "w") as f:
    f.write(html)

print("Rendered to ea_risk_assessment.html")
