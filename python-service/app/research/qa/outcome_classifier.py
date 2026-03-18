"""
Deal Outcome Classifier — Infer closed/terminated from filing metadata.

Uses filing patterns, deal age, and enrichment data to classify outcomes
WITHOUT downloading any filing documents. Pure metadata analysis.

DB constraint values: pending, closed, closed_amended, closed_higher_bid,
  terminated_mutual, terminated_target, terminated_acquirer, terminated_regulatory,
  terminated_vote, terminated_litigation, terminated_financing, terminated_other, withdrawn

Strategy (conservative):
  1. Enriched deals with actual_close_date → closed
  2. Enriched deals with terminated_date → terminated_other
  3. Pre-2024 deals with DEFM14A (definitive proxy = vote happened) → closed
  4. Pre-2024 deals with tender offer (SC TO-T) spanning >30 days → closed
  5. Pre-2024 deals with S-4/F-4 spanning >60 days → closed (stock deal registered)
  6. Pre-2024 deals with filing span >90 days → closed (deal progressed normally)
  7. Pre-2024 deals with single filing or <30 day span → closed (low confidence)
  8. 2024 deals → use same rules but mark as lower confidence
  9. 2025-2026 deals → leave as pending

~90% of announced M&A deals close. False positives (marking terminated as closed) are
acceptable for initial dataset construction — the higher-bid study filters further.

Usage:
    python -m app.research.qa.outcome_classifier --dry-run
    python -m app.research.qa.outcome_classifier --apply
    python -m app.research.qa.outcome_classifier --apply --year 2020
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class OutcomeClassification:
    deal_id: UUID
    deal_key: str
    outcome: str  # closed, terminated_other, pending (matches DB CHECK constraint)
    outcome_reason: str  # human-readable reason
    confidence: str  # high, medium, low
    method: str  # enrichment_date, defm14a, tender_offer, s4_registration, filing_span, age_inferred


async def classify_deal(
    conn: asyncpg.Connection,
    deal_id: UUID,
) -> OutcomeClassification:
    """Classify a single deal's outcome from filing metadata."""
    deal = await conn.fetchrow(
        """SELECT deal_id, deal_key, announced_date, actual_close_date,
                  terminated_date, expected_close_date, outside_date,
                  acquirer_name, deal_structure, target_ticker
           FROM research_deals WHERE deal_id = $1""",
        deal_id,
    )
    if not deal:
        raise ValueError(f"Deal {deal_id} not found")

    # Rule 1: Enriched with actual close date
    if deal["actual_close_date"]:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Actual close date: {deal['actual_close_date']}",
            confidence="high",
            method="enrichment_date",
        )

    # Rule 2: Enriched with terminated date
    if deal["terminated_date"]:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="terminated_other",
            outcome_reason=f"Terminated date: {deal['terminated_date']}",
            confidence="high",
            method="enrichment_date",
        )

    announced = deal["announced_date"]
    if not announced:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="pending",
            outcome_reason="No announced date",
            confidence="low",
            method="no_data",
        )

    # Recent deals: leave as pending
    if announced >= date(2025, 1, 1):
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="pending",
            outcome_reason="Deal too recent to classify (2025+)",
            confidence="low",
            method="too_recent",
        )

    # For pre-2025 deals, analyze filing patterns
    filing_stats = await conn.fetchrow(
        """SELECT
               count(*) as filing_count,
               min(filing_date) as first_filing,
               max(filing_date) as last_filing,
               max(filing_date) - min(filing_date) as span_days,
               bool_or(filing_type = 'DEFM14A') as has_defm14a,
               bool_or(filing_type LIKE 'SC TO-T%%') as has_tender,
               bool_or(filing_type LIKE 'SC 14D9%%' OR filing_type LIKE 'SC 14D-9%%') as has_14d9,
               bool_or(filing_type IN ('S-4', 'S-4/A', 'F-4', 'F-4/A')) as has_s4,
               bool_or(filing_type = 'PREM14A') as has_prem14a,
               bool_or(filing_type = 'DEFM14C') as has_defm14c
           FROM research_deal_filings
           WHERE deal_id = $1""",
        deal_id,
    )

    if not filing_stats or filing_stats["filing_count"] == 0:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason="Pre-2025 deal with no filing records",
            confidence="low",
            method="age_inferred",
        )

    span = filing_stats["span_days"] or 0
    # Handle timedelta vs int
    if hasattr(span, "days"):
        span = span.days

    is_2024 = announced.year == 2024
    conf = "medium" if is_2024 else "high"

    # Rule 3: Has definitive merger proxy (DEFM14A) = shareholder vote happened
    if filing_stats["has_defm14a"]:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Definitive merger proxy filed (DEFM14A), {filing_stats['filing_count']} filings over {span}d",
            confidence=conf,
            method="defm14a",
        )

    # Rule 3b: DEFM14C = written consent (no vote needed, but deal went definitive)
    if filing_stats["has_defm14c"]:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Definitive consent filing (DEFM14C), {filing_stats['filing_count']} filings",
            confidence=conf,
            method="defm14c",
        )

    # Rule 4: Tender offer with response (SC TO-T + SC 14D9) spanning >30d
    if filing_stats["has_tender"] and span > 30:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Tender offer filed with {span}d filing span, {filing_stats['filing_count']} filings",
            confidence=conf,
            method="tender_offer",
        )

    # Rule 5: S-4/F-4 registration spanning >60d (stock deal progressed through SEC review)
    if filing_stats["has_s4"] and span > 60:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"S-4/F-4 registration with {span}d span, {filing_stats['filing_count']} filings",
            confidence=conf,
            method="s4_registration",
        )

    # Rule 6: Long filing span (>90d) = deal progressed normally
    if span > 90:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Extended filing activity: {span}d span, {filing_stats['filing_count']} filings",
            confidence="medium" if is_2024 else "medium",
            method="filing_span",
        )

    # Rule 7: Shorter span or single filing — less certain
    if span > 30:
        return OutcomeClassification(
            deal_id=deal_id,
            deal_key=deal["deal_key"],
            outcome="closed",
            outcome_reason=f"Moderate filing activity: {span}d span, {filing_stats['filing_count']} filings",
            confidence="low",
            method="filing_span",
        )

    # Single filing or very short span
    return OutcomeClassification(
        deal_id=deal_id,
        deal_key=deal["deal_key"],
        outcome="closed",
        outcome_reason=f"Minimal filing activity: {span}d span, {filing_stats['filing_count']} filings (low confidence)",
        confidence="low",
        method="age_inferred",
    )


async def run_classification(
    dry_run: bool = True,
    year: Optional[int] = None,
    limit: int = 10000,
) -> Dict:
    """
    Classify outcomes for all pending deals.

    Args:
        dry_run: If True, print results without updating DB
        year: If set, only classify deals from this year
        limit: Max deals to process
    """
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    # Get pending deals
    conditions = ["outcome = 'pending'"]
    params: list = []
    idx = 1
    if year:
        conditions.append(f"EXTRACT(YEAR FROM announced_date) = ${idx}")
        params.append(year)
        idx += 1
    params.extend([limit])
    where = " AND ".join(conditions)

    deals = await conn.fetch(
        f"""SELECT deal_id FROM research_deals
            WHERE {where}
            ORDER BY announced_date
            LIMIT ${idx}""",
        *params,
    )

    logger.info(f"Classifying {len(deals)} pending deals (dry_run={dry_run})")

    results: Dict[str, int] = {
        "closed": 0,
        "terminated_other": 0,
        "pending": 0,
        "error": 0,
    }
    method_counts: Dict[str, int] = {}
    confidence_counts: Dict[str, int] = {}
    samples: Dict[str, List[str]] = {k: [] for k in results}

    for i, deal_row in enumerate(deals):
        try:
            c = await classify_deal(conn, deal_row["deal_id"])
            results[c.outcome] = results.get(c.outcome, 0) + 1
            method_counts[c.method] = method_counts.get(c.method, 0) + 1
            confidence_counts[c.confidence] = confidence_counts.get(c.confidence, 0) + 1

            # Keep first 5 samples per outcome
            if len(samples.get(c.outcome, [])) < 5:
                samples[c.outcome].append(
                    f"  {c.deal_key}: {c.outcome_reason} [{c.confidence}]"
                )

            if not dry_run:
                await conn.execute(
                    """UPDATE research_deals
                       SET outcome = $2, outcome_reason = $3, updated_at = NOW()
                       WHERE deal_id = $1""",
                    c.deal_id, c.outcome, c.outcome_reason,
                )

        except Exception as e:
            results["error"] += 1
            logger.error(f"Error classifying deal {deal_row['deal_id']}: {e}")

        if (i + 1) % 500 == 0:
            logger.info(f"Progress: {i+1}/{len(deals)}")

    await conn.close()

    # Print summary
    total = sum(results.values())
    print(f"\n{'='*60}")
    print(f"Outcome Classification {'(DRY RUN)' if dry_run else '(APPLIED)'}")
    print(f"{'='*60}")
    print(f"Total deals processed: {total}")
    print(f"\nOutcome distribution:")
    for outcome, count in sorted(results.items(), key=lambda x: -x[1]):
        pct = count / total * 100 if total else 0
        print(f"  {outcome:20s}: {count:5d} ({pct:.1f}%)")
    print(f"\nClassification method:")
    for method, count in sorted(method_counts.items(), key=lambda x: -x[1]):
        print(f"  {method:20s}: {count:5d}")
    print(f"\nConfidence levels:")
    for conf, count in sorted(confidence_counts.items(), key=lambda x: -x[1]):
        print(f"  {conf:10s}: {count:5d}")

    print(f"\nSamples:")
    for outcome, samps in samples.items():
        if samps:
            print(f"\n  [{outcome}]")
            for s in samps:
                print(s)

    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Classify deal outcomes from filing metadata")
    parser.add_argument("--apply", action="store_true", help="Apply classifications to DB (default: dry run)")
    parser.add_argument("--year", type=int, help="Only classify deals from this year")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run_classification(
        dry_run=not args.apply,
        year=args.year,
        limit=args.limit,
    ))
