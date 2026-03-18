"""
Static Deal Features — Fixed at announcement, no future information leakage.

Computes the "A. Static deal features" from the feature library spec in the plan.
These features are deterministic once the deal is enriched — no time-series.

Clause-dependent features (go_shop, match_rights, termination_fees) require
clause extraction to run first. This module gracefully returns None for those.

Usage:
    python -m app.research.features.static_features --limit 50
    python -m app.research.features.static_features --deal-key 2024-CALLON-UNK
"""

import asyncio
import logging
import os
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

# SIC code → sector mapping (first 2 digits)
SIC_SECTORS = {
    range(1, 10): "agriculture",
    range(10, 15): "mining",
    range(15, 18): "construction",
    range(20, 40): "manufacturing",
    range(40, 50): "transportation",
    range(50, 52): "wholesale",
    range(52, 60): "retail",
    range(60, 68): "finance",
    range(70, 90): "services",
    range(91, 100): "government",
}


def sic_to_sector(sic: Optional[str]) -> Optional[str]:
    """Map SIC code to broad sector."""
    if not sic:
        return None
    try:
        code = int(sic[:2])
    except (ValueError, TypeError):
        return None
    for r, sector in SIC_SECTORS.items():
        if code in r:
            return sector
    return "other"


@dataclass
class StaticFeatures:
    """Features fixed at deal announcement."""
    deal_id: UUID
    deal_key: str

    # Deal structure
    deal_value_mm: Optional[float] = None
    initial_premium_1d_pct: Optional[float] = None
    initial_premium_30d_pct: Optional[float] = None
    deal_structure: Optional[str] = None  # all_cash, all_stock, etc.
    buyer_type: Optional[str] = None  # strategic_public, financial_sponsor, etc.
    is_hostile: bool = False
    is_mbo: bool = False
    is_going_private: bool = False
    has_cvr: bool = False

    # Target characteristics
    target_sic_sector: Optional[str] = None
    target_exchange: Optional[str] = None
    target_ticker: Optional[str] = None

    # Deal consideration
    cash_per_share: Optional[float] = None
    stock_ratio: Optional[float] = None
    total_per_share: Optional[float] = None

    # Timeline
    announced_date: Optional[date] = None
    expected_close_date: Optional[date] = None
    outside_date: Optional[date] = None
    expected_duration_days: Optional[int] = None  # announced → expected close

    # Clause features (from research_deal_clauses — None until extracted)
    has_go_shop: Optional[bool] = None
    go_shop_period_days: Optional[int] = None
    has_match_right: Optional[bool] = None
    match_right_days: Optional[int] = None
    termination_fee_pct: Optional[float] = None
    reverse_termination_fee_pct: Optional[float] = None
    has_financing_condition: Optional[bool] = None
    regulatory_complexity: Optional[str] = None
    fiduciary_out_type: Optional[str] = None
    force_the_vote: Optional[bool] = None

    # Pre-signing process (from background section extraction)
    had_pre_signing_auction: Optional[bool] = None
    num_bidders_pre_signing: Optional[int] = None

    # Regime features (fixed at announcement date)
    vix_at_announcement: Optional[float] = None
    sp500_at_announcement: Optional[float] = None
    announcement_year: Optional[int] = None
    is_election_year: bool = False

    # Market data availability flags
    has_stock_data: bool = False
    has_options_data: bool = False
    has_clause_data: bool = False

    # Outcome (for labeling — NOT a feature for prediction)
    outcome: Optional[str] = None
    outcome_reason: Optional[str] = None


async def compute_static_features(
    conn: asyncpg.Connection,
    deal_id: UUID,
) -> Optional[StaticFeatures]:
    """Compute static features for a single deal."""

    # Get deal record
    deal = await conn.fetchrow(
        """SELECT d.*, c.cash_per_share, c.stock_ratio, c.total_per_share,
                  c.total_deal_value_mm as consideration_value_mm,
                  c.premium_to_prior_close as consideration_premium
           FROM research_deals d
           LEFT JOIN research_deal_consideration c
             ON d.deal_id = c.deal_id AND c.version = 1
           WHERE d.deal_id = $1""",
        deal_id,
    )
    if not deal:
        return None

    features = StaticFeatures(
        deal_id=deal_id,
        deal_key=deal["deal_key"],
        deal_value_mm=_to_float(deal.get("initial_deal_value_mm") or deal.get("consideration_value_mm")),
        initial_premium_1d_pct=_to_float(deal.get("initial_premium_1d_pct") or deal.get("consideration_premium")),
        initial_premium_30d_pct=_to_float(deal.get("initial_premium_30d_pct")),
        deal_structure=deal.get("deal_structure"),
        buyer_type=deal.get("acquirer_type"),
        is_hostile=deal.get("is_hostile") or False,
        is_mbo=deal.get("is_mbo") or False,
        is_going_private=deal.get("is_going_private") or False,
        has_cvr=deal.get("has_cvr") or False,
        target_sic_sector=sic_to_sector(deal.get("target_sic")),
        target_exchange=deal.get("target_exchange"),
        target_ticker=deal.get("target_ticker"),
        cash_per_share=_to_float(deal.get("cash_per_share")),
        stock_ratio=_to_float(deal.get("stock_ratio")),
        total_per_share=_to_float(deal.get("total_per_share")),
        announced_date=deal.get("announced_date"),
        expected_close_date=deal.get("expected_close_date"),
        outside_date=deal.get("outside_date"),
        outcome=deal.get("outcome"),
        outcome_reason=deal.get("outcome_reason"),
    )

    # Compute expected duration
    if features.announced_date and features.expected_close_date:
        features.expected_duration_days = (
            features.expected_close_date - features.announced_date
        ).days

    # Year and election year
    if features.announced_date:
        features.announcement_year = features.announced_date.year
        features.is_election_year = features.announced_date.year in (2016, 2020, 2024)

    # Clause features (from research_deal_clauses if available)
    clause = await conn.fetchrow(
        """SELECT * FROM research_deal_clauses
           WHERE deal_id = $1 LIMIT 1""",
        deal_id,
    )
    if clause:
        features.has_clause_data = True
        features.has_go_shop = clause.get("has_go_shop")
        features.go_shop_period_days = clause.get("go_shop_period_days")
        features.has_match_right = clause.get("has_match_right")
        features.match_right_days = clause.get("match_period_days")
        features.termination_fee_pct = _to_float(clause.get("target_fee_pct"))
        features.reverse_termination_fee_pct = _to_float(clause.get("acquirer_fee_pct"))
        features.has_financing_condition = clause.get("has_financing_condition")
        features.regulatory_complexity = clause.get("regulatory_complexity")
        features.fiduciary_out_type = clause.get("fiduciary_out_type")
        features.force_the_vote = clause.get("force_the_vote")

    # VIX and S&P 500 at announcement (from market data if loaded)
    if features.announced_date:
        mkt = await conn.fetchrow(
            """SELECT vix_close, sp500_close
               FROM research_market_daily
               WHERE deal_id = $1 AND trade_date <= $2
               ORDER BY trade_date DESC LIMIT 1""",
            deal_id, features.announced_date,
        )
        if mkt:
            features.vix_at_announcement = _to_float(mkt.get("vix_close"))
            features.sp500_at_announcement = _to_float(mkt.get("sp500_close"))

    # Data availability flags
    stock_count = await conn.fetchval(
        "SELECT count(*) FROM research_market_daily WHERE deal_id = $1", deal_id
    )
    features.has_stock_data = (stock_count or 0) > 0

    options_count = await conn.fetchval(
        "SELECT count(*) FROM research_options_daily WHERE deal_id = $1", deal_id
    )
    features.has_options_data = (options_count or 0) > 0

    return features


def _to_float(v) -> Optional[float]:
    """Safely convert Decimal/int/str to float."""
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


async def compute_all_features(
    limit: int = 100,
    enriched_only: bool = True,
    deal_key: Optional[str] = None,
) -> List[StaticFeatures]:
    """Compute static features for multiple deals."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    if deal_key:
        deals = await conn.fetch(
            "SELECT deal_id FROM research_deals WHERE deal_key = $1",
            deal_key,
        )
    elif enriched_only:
        deals = await conn.fetch(
            """SELECT deal_id FROM research_deals
               WHERE acquirer_name IS NOT NULL AND acquirer_name != 'Unknown'
               ORDER BY announced_date DESC LIMIT $1""",
            limit,
        )
    else:
        deals = await conn.fetch(
            "SELECT deal_id FROM research_deals ORDER BY announced_date DESC LIMIT $1",
            limit,
        )

    logger.info(f"Computing features for {len(deals)} deals")
    results = []

    for i, row in enumerate(deals):
        try:
            f = await compute_static_features(conn, row["deal_id"])
            if f:
                results.append(f)
        except Exception as e:
            logger.error(f"Error computing features for {row['deal_id']}: {e}")

        if (i + 1) % 50 == 0:
            logger.info(f"Progress: {i+1}/{len(deals)}")

    await conn.close()
    return results


def features_summary(features: List[StaticFeatures]) -> Dict:
    """Generate summary statistics from computed features."""
    if not features:
        return {"count": 0}

    total = len(features)
    summary = {
        "count": total,
        "with_deal_value": sum(1 for f in features if f.deal_value_mm),
        "with_premium": sum(1 for f in features if f.initial_premium_1d_pct),
        "with_close_date": sum(1 for f in features if f.expected_close_date),
        "with_stock_data": sum(1 for f in features if f.has_stock_data),
        "with_options_data": sum(1 for f in features if f.has_options_data),
        "with_clause_data": sum(1 for f in features if f.has_clause_data),
        "with_vix": sum(1 for f in features if f.vix_at_announcement),
    }

    # Deal structure distribution
    structures = {}
    for f in features:
        s = f.deal_structure or "unknown"
        structures[s] = structures.get(s, 0) + 1
    summary["deal_structures"] = structures

    # Buyer type distribution
    buyers = {}
    for f in features:
        b = f.buyer_type or "unknown"
        buyers[b] = buyers.get(b, 0) + 1
    summary["buyer_types"] = buyers

    # Outcome distribution
    outcomes = {}
    for f in features:
        o = f.outcome or "unknown"
        outcomes[o] = outcomes.get(o, 0) + 1
    summary["outcomes"] = outcomes

    # Year distribution
    years = {}
    for f in features:
        y = f.announcement_year or 0
        years[y] = years.get(y, 0) + 1
    summary["years"] = dict(sorted(years.items()))

    # Numeric stats
    values = [f.deal_value_mm for f in features if f.deal_value_mm]
    if values:
        summary["deal_value_stats"] = {
            "min": min(values),
            "max": max(values),
            "mean": sum(values) / len(values),
            "median": sorted(values)[len(values) // 2],
        }

    premiums = [f.initial_premium_1d_pct for f in features if f.initial_premium_1d_pct]
    if premiums:
        summary["premium_stats"] = {
            "min": min(premiums),
            "max": max(premiums),
            "mean": sum(premiums) / len(premiums),
            "median": sorted(premiums)[len(premiums) // 2],
        }

    return summary


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Compute static deal features")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--deal-key", type=str)
    parser.add_argument("--all", action="store_true", help="Include non-enriched deals")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    features = asyncio.run(compute_all_features(
        limit=args.limit,
        enriched_only=not args.all,
        deal_key=args.deal_key,
    ))

    summary = features_summary(features)
    print(json.dumps(summary, indent=2, default=str))

    # Print a sample feature set
    if features:
        print(f"\nSample feature set ({features[0].deal_key}):")
        d = asdict(features[0])
        for k, v in d.items():
            if v is not None and v is not False and v != 0:
                print(f"  {k}: {v}")
