"""Extract real risk assessment prompts for 5 representative deals.

Runs INSIDE the python-portfolio Docker container to access the DB and
the full prompt builder pipeline. Outputs JSON file with system prompt
+ user prompts for each ticker.

Usage (from droplet):
  docker exec python-portfolio python -m tools.extract_prompts
"""

import asyncio
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

# Add parent to path so imports work when run as a module
sys.path.insert(0, str(Path(__file__).parent.parent))


def _json_default(o):
    """JSON serialization helper for DB types."""
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, UUID):
        return str(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


# 5 representative deals:
# 1. CFLT  - Clean all-cash tech deal, Low risk (baseline)
# 2. HOLX  - PE buyout with CVR, Medium vote risk (complexity)
# 3. UNF   - Cash & Stock, wide spread (regulatory concern)
# 4. NVRI  - Cash + Spin-off, widest spread (complex structure)
# 5. EA    - Mega gaming deal, Silver Lake (large deal)
EXPERIMENT_TICKERS = ["CFLT", "HOLX", "UNF", "NVRI", "EA"]


async def main():
    import asyncpg
    from app.risk.engine import RiskAssessmentEngine
    from app.risk.prompts import RISK_ASSESSMENT_SYSTEM_PROMPT, build_deal_assessment_prompt

    db_url = os.environ.get("DATABASE_URL", "")
    if "sslmode=" in db_url:
        db_url = db_url.replace("?sslmode=require", "?ssl=require")

    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)

    # We only need the engine for collect_deal_context, so pass a dummy API key
    engine = RiskAssessmentEngine(pool, anthropic_key="dummy-not-used")

    output = {
        "extracted_at": datetime.now().isoformat(),
        "system_prompt": RISK_ASSESSMENT_SYSTEM_PROMPT,
        "deals": {},
    }

    for ticker in EXPERIMENT_TICKERS:
        print(f"Extracting context for {ticker}...")
        try:
            context = await engine.collect_deal_context(ticker)
            user_prompt = build_deal_assessment_prompt(context)

            # Store prompt and basic deal info
            row = context.get("sheet_row", {})
            output["deals"][ticker] = {
                "acquirer": row.get("acquiror", "Unknown"),
                "deal_price": float(row["deal_price"]) if row.get("deal_price") else None,
                "current_price": float(row["current_price"]) if row.get("current_price") else None,
                "category": row.get("category", "Unknown"),
                "vote_risk": row.get("vote_risk"),
                "user_prompt": user_prompt,
                "prompt_chars": len(user_prompt),
                "prompt_est_tokens": len(user_prompt) // 4,
                "has_previous_assessment": context.get("previous_assessment") is not None,
                "num_filings": len(context.get("recent_filings", [])),
                "num_halts": len(context.get("recent_halts", [])),
                "num_diffs": len(context.get("sheet_diffs", [])),
                "has_research": context.get("existing_research") is not None,
                "has_milestones": bool(context.get("milestones")),
                "has_predictions": bool(context.get("open_predictions")),
                "has_filing_impacts": bool(context.get("filing_impacts")),
                "has_news": bool(context.get("news_articles")),
            }
            print(f"  ✓ {ticker}: {len(user_prompt)} chars (~{len(user_prompt)//4} tokens)")
        except Exception as e:
            print(f"  ✗ {ticker}: {e}")
            output["deals"][ticker] = {"error": str(e)}

    await pool.close()

    # Write output
    out_path = Path("/tmp/experiment_prompts.json")
    with open(out_path, "w") as f:
        json.dump(output, f, default=_json_default, indent=2)
    print(f"\nSaved to {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    asyncio.run(main())
