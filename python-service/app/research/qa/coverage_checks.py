"""
Data Quality — Coverage and Consistency Checks

Automated QA queries from Section 10 of the plan.
These should be run after each pipeline phase to validate data integrity.
"""

import logging
from typing import Dict, List, Optional

import asyncpg

logger = logging.getLogger(__name__)


async def run_all_checks(conn: asyncpg.Connection) -> Dict[str, any]:
    """Run all QA checks and return a summary report."""
    results = {
        "coverage": await check_coverage(conn),
        "consistency": await check_consistency(conn),
        "outliers": await check_outliers(conn),
        "completeness": await check_completeness(conn),
    }

    # Compute overall health score
    total_issues = sum(
        r.get("issue_count", 0)
        for section in results.values()
        if isinstance(section, dict)
        for r in (section.values() if isinstance(section, dict) else [section])
        if isinstance(r, dict)
    )
    results["total_issues"] = total_issues
    results["health"] = "good" if total_issues == 0 else "warning" if total_issues < 10 else "critical"

    return results


async def check_coverage(conn: asyncpg.Connection) -> Dict[str, dict]:
    """Check data coverage — every deal should have filings, events, etc."""

    # Deals with no filings
    no_filings = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_filings)
    """)

    # Deals with no events
    no_events = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE deal_id NOT IN (SELECT DISTINCT deal_id FROM research_deal_events)
    """)

    # Closed deals with no outcomes
    no_outcomes = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE outcome NOT IN ('pending')
          AND deal_id NOT IN (SELECT deal_id FROM research_deal_outcomes)
    """)

    # Deals with no market data
    no_market = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE market_data_status = 'pending'
          AND announced_date < CURRENT_DATE - INTERVAL '30 days'
    """)

    return {
        "deals_without_filings": {"count": no_filings, "severity": "high", "issue_count": no_filings},
        "deals_without_events": {"count": no_events, "severity": "medium", "issue_count": no_events},
        "closed_deals_without_outcomes": {"count": no_outcomes, "severity": "high", "issue_count": no_outcomes},
        "stale_deals_without_market_data": {"count": no_market, "severity": "medium", "issue_count": no_market},
    }


async def check_consistency(conn: asyncpg.Connection) -> Dict[str, dict]:
    """Check logical consistency of deal data."""

    # Date ordering violations: announced <= signing <= expected_close <= outside
    date_violations = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE (signing_date IS NOT NULL AND announced_date > signing_date)
           OR (expected_close_date IS NOT NULL AND announced_date > expected_close_date)
           OR (outside_date IS NOT NULL AND expected_close_date IS NOT NULL
               AND expected_close_date > outside_date)
    """)

    # Event ordering: announcement before completion
    event_order_violations = await conn.fetchval("""
        SELECT COUNT(DISTINCT e1.deal_id) FROM research_deal_events e1
        JOIN research_deal_events e2 ON e1.deal_id = e2.deal_id
        WHERE e1.event_type = 'ANNOUNCEMENT' AND e1.event_subtype = 'initial_announcement'
          AND e2.event_type = 'COMPLETION' AND e2.event_subtype = 'closing'
          AND e1.event_date > e2.event_date
    """)

    # Go-shop without period days
    go_shop_incomplete = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deal_clauses
        WHERE has_go_shop = TRUE AND go_shop_period_days IS NULL
    """)

    return {
        "date_ordering_violations": {"count": date_violations, "severity": "high", "issue_count": date_violations},
        "event_ordering_violations": {"count": event_order_violations, "severity": "high", "issue_count": event_order_violations},
        "go_shop_missing_period": {"count": go_shop_incomplete, "severity": "medium", "issue_count": go_shop_incomplete},
    }


async def check_outliers(conn: asyncpg.Connection) -> Dict[str, dict]:
    """Check for suspicious outlier values."""

    # Impossible premiums (> 200% or < -10%)
    extreme_premiums = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deals
        WHERE initial_premium_1d_pct > 200 OR initial_premium_1d_pct < -10
    """)

    # Termination fee outside normal range (1-5% of deal value)
    unusual_fees = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deal_clauses
        WHERE target_termination_fee_pct IS NOT NULL
          AND (target_termination_fee_pct > 5 OR target_termination_fee_pct < 1)
    """)

    # Deals with suspiciously few trading days
    sparse_market = await conn.fetchval("""
        SELECT COUNT(*) FROM (
            SELECT d.deal_id, COUNT(m.id) as trading_days
            FROM research_deals d
            LEFT JOIN research_market_daily m ON d.deal_id = m.deal_id
            WHERE d.market_data_status = 'complete'
            GROUP BY d.deal_id
            HAVING COUNT(m.id) < 20
        ) sparse
    """)

    return {
        "extreme_premiums": {"count": extreme_premiums, "severity": "medium", "issue_count": extreme_premiums},
        "unusual_termination_fees": {"count": unusual_fees, "severity": "low", "issue_count": unusual_fees},
        "sparse_market_data": {"count": sparse_market, "severity": "medium", "issue_count": sparse_market},
    }


async def check_completeness(conn: asyncpg.Connection) -> Dict[str, dict]:
    """Check overall data completeness metrics."""

    total = await conn.fetchval("SELECT COUNT(*) FROM research_deals")

    if total == 0:
        return {"total_deals": {"count": 0, "issue_count": 0}}

    # Clause extraction coverage
    clauses_complete = await conn.fetchval(
        "SELECT COUNT(*) FROM research_deals WHERE clause_extraction_status = 'complete'"
    )

    # Market data coverage
    market_complete = await conn.fetchval(
        "SELECT COUNT(*) FROM research_deals WHERE market_data_status = 'complete'"
    )

    # Acquirer identified
    acquirer_known = await conn.fetchval(
        "SELECT COUNT(*) FROM research_deals WHERE acquirer_name != 'Unknown'"
    )

    # Low confidence extractions needing review
    low_confidence = await conn.fetchval("""
        SELECT COUNT(*) FROM research_deal_clauses
        WHERE extraction_confidence < 0.7 AND manually_verified = FALSE
    """)

    return {
        "total_deals": {"count": total, "issue_count": 0},
        "clauses_complete_pct": {
            "count": clauses_complete,
            "pct": round(clauses_complete / total * 100, 1),
            "issue_count": 0,
        },
        "market_data_complete_pct": {
            "count": market_complete,
            "pct": round(market_complete / total * 100, 1),
            "issue_count": 0,
        },
        "acquirer_identified_pct": {
            "count": acquirer_known,
            "pct": round(acquirer_known / total * 100, 1),
            "issue_count": total - acquirer_known,
        },
        "low_confidence_needing_review": {
            "count": low_confidence,
            "severity": "medium",
            "issue_count": low_confidence,
        },
    }
