"""
Base Rate Analysis — Descriptive statistics on the research deal universe.

Computes unconditional and conditional base rates from the enriched deal data.
This is Part A of the higher-bid study plan. While we can't compute the full
higher-bid target variable yet (requires clause extraction + event labeling),
we CAN compute:

1. Deal completion rates by category
2. Premium distributions
3. Deal structure trends
4. Duration statistics
5. Buyer type patterns
6. Sector concentration

These base rates serve as:
- Validation that the data is reasonable (compare to academic benchmarks)
- Feature importance priors (which categories matter)
- Calibration anchors for the risk assessment pipeline

Usage:
    python -m app.research.analysis.base_rates
    python -m app.research.analysis.base_rates --enriched-only
    python -m app.research.analysis.base_rates --year 2023
"""

import asyncio
import json
import logging
import os
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

import asyncpg

logger = logging.getLogger(__name__)


async def compute_base_rates(
    enriched_only: bool = False,
    year: Optional[int] = None,
) -> Dict:
    """Compute comprehensive base rates from the research database."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    results = {}

    # ================================================================
    # 1. Universe Summary
    # ================================================================
    conditions = []
    params = []
    idx = 1
    if enriched_only:
        conditions.append(f"acquirer_name IS NOT NULL AND acquirer_name != ${idx}")
        params.append("Unknown")
        idx += 1
    if year:
        conditions.append(f"EXTRACT(YEAR FROM announced_date) = ${idx}")
        params.append(year)
        idx += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = await conn.fetchval(
        f"SELECT count(*) FROM research_deals {where}", *params
    )
    results["universe"] = {
        "total_deals": total,
        "filter": {
            "enriched_only": enriched_only,
            "year": year,
        },
    }

    # ================================================================
    # 2. Outcome Distribution
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT outcome, count(*) as cnt,
                   round(count(*)::numeric / NULLIF(${idx}, 0) * 100, 1) as pct
            FROM research_deals {where}
            GROUP BY outcome ORDER BY cnt DESC""",
        *params, total,
    )
    results["outcomes"] = {r["outcome"]: {"count": r["cnt"], "pct": float(r["pct"] or 0)} for r in rows}

    # ================================================================
    # 3. Deals by Year
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT EXTRACT(YEAR FROM announced_date)::int as yr,
                   count(*) as cnt,
                   count(*) FILTER (WHERE outcome = 'closed') as closed_cnt
            FROM research_deals {where}
            GROUP BY yr ORDER BY yr""",
        *params,
    )
    results["by_year"] = {
        r["yr"]: {
            "total": r["cnt"],
            "closed": r["closed_cnt"],
            "close_rate": round(r["closed_cnt"] / r["cnt"] * 100, 1) if r["cnt"] else 0,
        }
        for r in rows
    }

    # ================================================================
    # 4. Deal Structure Distribution (enriched deals only)
    # ================================================================
    enrich_where = f"{where} {'AND' if where else 'WHERE'} acquirer_name IS NOT NULL AND acquirer_name != 'Unknown'"
    rows = await conn.fetch(
        f"""SELECT deal_structure, count(*) as cnt
            FROM research_deals {enrich_where}
            GROUP BY deal_structure ORDER BY cnt DESC""",
        *params,
    )
    enriched_total = sum(r["cnt"] for r in rows)
    results["deal_structures"] = {
        r["deal_structure"] or "unknown": {
            "count": r["cnt"],
            "pct": round(r["cnt"] / enriched_total * 100, 1) if enriched_total else 0,
        }
        for r in rows
    }
    results["enriched_count"] = enriched_total

    # ================================================================
    # 5. Buyer Type Distribution
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT acquirer_type, count(*) as cnt
            FROM research_deals {enrich_where}
            GROUP BY acquirer_type ORDER BY cnt DESC""",
        *params,
    )
    results["buyer_types"] = {
        r["acquirer_type"] or "unknown": {
            "count": r["cnt"],
            "pct": round(r["cnt"] / enriched_total * 100, 1) if enriched_total else 0,
        }
        for r in rows
    }

    # ================================================================
    # 6. Premium Statistics (enriched deals with prices)
    # ================================================================
    row = await conn.fetchrow(
        f"""SELECT
                count(initial_premium_1d_pct) as n,
                round(avg(initial_premium_1d_pct)::numeric, 1) as mean,
                round(percentile_cont(0.25) WITHIN GROUP (ORDER BY initial_premium_1d_pct)::numeric, 1) as p25,
                round(percentile_cont(0.50) WITHIN GROUP (ORDER BY initial_premium_1d_pct)::numeric, 1) as median,
                round(percentile_cont(0.75) WITHIN GROUP (ORDER BY initial_premium_1d_pct)::numeric, 1) as p75,
                round(min(initial_premium_1d_pct)::numeric, 1) as min_val,
                round(max(initial_premium_1d_pct)::numeric, 1) as max_val
            FROM research_deals {enrich_where}
            AND initial_premium_1d_pct IS NOT NULL""",
        *params,
    )
    results["premium_1d"] = {k: float(v) if v is not None else None for k, v in dict(row).items()}

    # ================================================================
    # 7. Deal Value Statistics
    # ================================================================
    row = await conn.fetchrow(
        f"""SELECT
                count(initial_deal_value_mm) as n,
                round(avg(initial_deal_value_mm)::numeric, 0) as mean,
                round(percentile_cont(0.25) WITHIN GROUP (ORDER BY initial_deal_value_mm)::numeric, 0) as p25,
                round(percentile_cont(0.50) WITHIN GROUP (ORDER BY initial_deal_value_mm)::numeric, 0) as median,
                round(percentile_cont(0.75) WITHIN GROUP (ORDER BY initial_deal_value_mm)::numeric, 0) as p75,
                round(min(initial_deal_value_mm)::numeric, 0) as min_val,
                round(max(initial_deal_value_mm)::numeric, 0) as max_val
            FROM research_deals {enrich_where}
            AND initial_deal_value_mm IS NOT NULL""",
        *params,
    )
    results["deal_value_mm"] = {k: float(v) if v is not None else None for k, v in dict(row).items()}

    # ================================================================
    # 8. Deal Duration Statistics
    # ================================================================
    row = await conn.fetchrow(
        f"""SELECT
                count(*) as n,
                round(avg(expected_close_date - announced_date)::numeric, 0) as mean_days,
                round(percentile_cont(0.50) WITHIN GROUP (ORDER BY (expected_close_date - announced_date))::numeric, 0) as median_days,
                min(expected_close_date - announced_date) as min_days,
                max(expected_close_date - announced_date) as max_days
            FROM research_deals {enrich_where}
            AND expected_close_date IS NOT NULL AND announced_date IS NOT NULL""",
        *params,
    )
    results["duration_to_expected_close"] = {
        k: int(v) if v is not None else None for k, v in dict(row).items()
    }

    # ================================================================
    # 9. Filing Type Coverage
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT f.filing_type, count(DISTINCT d.deal_id) as deal_count
            FROM research_deal_filings f
            JOIN research_deals d ON f.deal_id = d.deal_id
            {where}
            GROUP BY f.filing_type
            HAVING count(DISTINCT d.deal_id) > 10
            ORDER BY deal_count DESC
            LIMIT 15""",
        *params,
    )
    results["filing_coverage"] = {
        r["filing_type"]: r["deal_count"] for r in rows
    }

    # ================================================================
    # 10. Premium by Structure (cross-tab)
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT deal_structure,
                   count(*) as n,
                   round(avg(initial_premium_1d_pct)::numeric, 1) as avg_premium,
                   round(percentile_cont(0.50) WITHIN GROUP (ORDER BY initial_premium_1d_pct)::numeric, 1) as median_premium
            FROM research_deals {enrich_where}
            AND initial_premium_1d_pct IS NOT NULL
            GROUP BY deal_structure
            HAVING count(*) >= 3
            ORDER BY n DESC""",
        *params,
    )
    results["premium_by_structure"] = {
        r["deal_structure"]: {
            "n": r["n"],
            "avg_premium": float(r["avg_premium"]) if r["avg_premium"] else None,
            "median_premium": float(r["median_premium"]) if r["median_premium"] else None,
        }
        for r in rows
    }

    # ================================================================
    # 11. Premium by Buyer Type
    # ================================================================
    rows = await conn.fetch(
        f"""SELECT acquirer_type,
                   count(*) as n,
                   round(avg(initial_premium_1d_pct)::numeric, 1) as avg_premium,
                   round(percentile_cont(0.50) WITHIN GROUP (ORDER BY initial_premium_1d_pct)::numeric, 1) as median_premium
            FROM research_deals {enrich_where}
            AND initial_premium_1d_pct IS NOT NULL
            GROUP BY acquirer_type
            HAVING count(*) >= 3
            ORDER BY n DESC""",
        *params,
    )
    results["premium_by_buyer_type"] = {
        r["acquirer_type"]: {
            "n": r["n"],
            "avg_premium": float(r["avg_premium"]) if r["avg_premium"] else None,
            "median_premium": float(r["median_premium"]) if r["median_premium"] else None,
        }
        for r in rows
    }

    # ================================================================
    # 12. Hostile vs Friendly Breakdown
    # ================================================================
    row = await conn.fetchrow(
        f"""SELECT
                count(*) FILTER (WHERE is_hostile = true) as hostile,
                count(*) FILTER (WHERE is_hostile = false OR is_hostile IS NULL) as friendly,
                count(*) FILTER (WHERE is_going_private = true) as going_private,
                count(*) FILTER (WHERE is_mbo = true) as mbo,
                count(*) FILTER (WHERE has_cvr = true) as has_cvr
            FROM research_deals {enrich_where}""",
        *params,
    )
    results["deal_flags"] = {k: int(v) for k, v in dict(row).items()}

    await conn.close()
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Compute M&A base rates")
    parser.add_argument("--enriched-only", action="store_true")
    parser.add_argument("--year", type=int)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    results = asyncio.run(compute_base_rates(
        enriched_only=args.enriched_only,
        year=args.year,
    ))

    print(json.dumps(results, indent=2, default=str))
