"""
Enrichment Failure Classifier — Analyzes WHY enrichment failed for each deal.

Classifies every non-enriched deal into actionable categories:
  - not_ma: No high-quality M&A filings, likely a false positive
  - extraction_failed: Had good filings but Claude couldn't extract (retry with different filing)
  - sec_failed: SEC fetch failures (retriable immediately)
  - no_filings: Deal record exists but has no linked filings
  - pending: Never attempted

This runs purely on existing DB data — no SEC requests, no Claude calls.

Usage:
    python -m app.research.qa.enrichment_classifier --dry-run
    python -m app.research.qa.enrichment_classifier --apply
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Dict, Optional
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

# Filing types that strongly indicate real M&A
HIGH_QUALITY_MA_TYPES = {
    'DEFM14A',    # Definitive merger proxy
    'SC TO-T',    # Tender offer statement (acquirer)
    'SC 14D9',    # Target response to tender offer
    'SC 14D-9',   # Same as above, variant
    'PREM14A',    # Preliminary merger proxy
    'DEFM14C',    # Definitive information statement (written consent merger)
}

# Filing types that suggest M&A but are less definitive
MEDIUM_QUALITY_MA_TYPES = {
    'SC TO-T/A',   # Tender offer amendment
    'SC 14D9/A',   # Target response amendment
    'SC TO-I',     # Issuer tender offer
    'SC TO-I/A',   # Issuer tender offer amendment
}

# Filing types that are common in M&A but also in non-M&A contexts
LOW_QUALITY_TYPES = {
    'DEFA14A',   # Proxy supplement — very common, often not M&A
    'S-4',       # Registration for stock deal — also used for spin-offs
    'S-4/A',
    'F-4',       # Foreign registration
    'F-4/A',
}


async def classify_enrichment_failures(
    conn: asyncpg.Connection,
    dry_run: bool = True,
) -> Dict[str, int]:
    """
    Classify all non-enriched deals by failure reason.

    Returns counts by category.
    """
    # Get all non-enriched deals with their filing info
    deals = await conn.fetch("""
        SELECT d.deal_id, d.deal_key, d.acquirer_name, d.last_enriched,
               d.announced_date, d.target_name,
               array_agg(DISTINCT f.filing_type) FILTER (WHERE f.filing_type IS NOT NULL) as filing_types,
               count(f.id) as filing_count,
               max(f.filing_date) - min(f.filing_date) as filing_span_days,
               bool_or(f.filing_type IN ('DEFM14A', 'SC TO-T', 'PREM14A', 'SC 14D9', 'SC 14D-9', 'DEFM14C')) as has_high_quality,
               bool_or(f.filing_type IN ('SC TO-T/A', 'SC 14D9/A', 'SC TO-I', 'SC TO-I/A')) as has_medium_quality
        FROM research_deals d
        LEFT JOIN research_deal_filings f ON d.deal_id = f.deal_id
        WHERE d.acquirer_name IS NULL OR d.acquirer_name = 'Unknown'
        GROUP BY d.deal_id, d.deal_key, d.acquirer_name, d.last_enriched,
                 d.announced_date, d.target_name
    """)

    results = {
        "not_ma": 0,
        "extraction_failed": 0,
        "sec_failed": 0,
        "no_filings": 0,
        "pending": 0,
        "total": len(deals),
    }

    # Also track sub-categories for extraction failures
    extraction_sub = {
        "has_defm14a_untried": 0,      # Has DEFM14A but wasn't tried (SEC failure during attempt)
        "has_tender_untried": 0,        # Has SC TO-T but wasn't tried
        "only_amendments_tried": 0,     # Only amendment filings were tried
        "many_filings_real_deal": 0,    # 20+ filings, long span — almost certainly real
        "few_filings_ambiguous": 0,     # Attempted, few filings, genuinely ambiguous
    }

    for deal in deals:
        filing_types = set(deal["filing_types"] or [])
        has_high = deal["has_high_quality"] or False
        has_medium = deal["has_medium_quality"] or False
        was_attempted = deal["last_enriched"] is not None
        filing_count = deal["filing_count"] or 0

        span = deal["filing_span_days"]
        if span and hasattr(span, "days"):
            span = span.days
        elif span is None:
            span = 0

        # Classify
        if filing_count == 0:
            status = "no_filings"
            reason = "No SEC filings linked to this deal"

        elif not has_high and not has_medium and filing_types <= LOW_QUALITY_TYPES | {'DEFA14A', 'DEFA14A/A'}:
            # Only has DEFA14A / S-4 type filings — likely not a real acquisition
            status = "not_ma"
            reason = f"Only low-quality filing types: {', '.join(sorted(filing_types))}"

        elif was_attempted and not has_high:
            # Was attempted but only had low-quality filings
            status = "not_ma"
            reason = f"Enrichment attempted, no high-quality M&A filings. Types: {', '.join(sorted(filing_types))}"

        elif was_attempted and has_high:
            # This is the interesting one — had good filings, was attempted, but failed
            status = "extraction_failed"
            if filing_count > 20 and span > 60:
                reason = f"Real deal candidate ({filing_count} filings, {span}d span). Re-try with different filing or larger text window."
                extraction_sub["many_filings_real_deal"] += 1
            else:
                reason = f"Extraction returned Unknown. {filing_count} filings, types: {', '.join(sorted(filing_types & HIGH_QUALITY_MA_TYPES))}"
                extraction_sub["few_filings_ambiguous"] += 1

        elif not was_attempted and has_high:
            # Has good filings but was never attempted — likely SEC failure during the run
            status = "sec_failed"
            high_types = sorted(filing_types & HIGH_QUALITY_MA_TYPES)
            reason = f"Never enriched despite having {', '.join(high_types)}. Likely SEC 503 during fetch."
            if 'DEFM14A' in filing_types:
                extraction_sub["has_defm14a_untried"] += 1
            if 'SC TO-T' in filing_types:
                extraction_sub["has_tender_untried"] += 1

        elif not was_attempted and has_medium:
            # Has medium-quality filings, never attempted
            status = "sec_failed"
            reason = f"Not attempted. Has medium-quality filings: {', '.join(sorted(filing_types & MEDIUM_QUALITY_MA_TYPES))}"

        elif not was_attempted:
            # Never attempted, only low-quality filings
            status = "not_ma"
            reason = f"Never attempted, only types: {', '.join(sorted(filing_types))}"

        else:
            status = "pending"
            reason = "Unclassified"

        results[status] += 1

        if not dry_run:
            await conn.execute(
                """UPDATE research_deals
                   SET enrichment_status = $2,
                       enrichment_failure_reason = $3,
                       updated_at = NOW()
                   WHERE deal_id = $1""",
                deal["deal_id"], status, reason,
            )

    # Also mark enriched deals
    if not dry_run:
        enriched_count = await conn.execute(
            """UPDATE research_deals
               SET enrichment_status = 'enriched',
                   enrichment_failure_reason = NULL
               WHERE acquirer_name IS NOT NULL AND acquirer_name != 'Unknown'
                 AND enrichment_status != 'enriched'"""
        )
        results["enriched_marked"] = int(enriched_count.split()[-1]) if enriched_count else 0

    # Print report
    print(f"\n{'='*70}")
    print(f"Enrichment Failure Classification {'(DRY RUN)' if dry_run else '(APPLIED)'}")
    print(f"{'='*70}")
    print(f"Total non-enriched deals: {results['total']}")
    print()
    print(f"  {'not_ma':25s}  {results['not_ma']:5d}  — False positives, not real acquisitions")
    print(f"  {'extraction_failed':25s}  {results['extraction_failed']:5d}  — Had good filings, Claude couldn't extract")
    print(f"  {'sec_failed':25s}  {results['sec_failed']:5d}  — SEC fetch failed, retriable")
    print(f"  {'no_filings':25s}  {results['no_filings']:5d}  — No filing records at all")
    print(f"  {'pending':25s}  {results['pending']:5d}  — Other/unclassified")
    print()
    print(f"Extraction failure sub-categories:")
    for k, v in sorted(extraction_sub.items(), key=lambda x: -x[1]):
        if v > 0:
            print(f"  {k:30s}  {v:5d}")
    print()

    # Actionable summary
    retriable = results["sec_failed"] + results["extraction_failed"]
    print(f"ACTIONABLE: {retriable} deals are worth retrying")
    print(f"  - {results['sec_failed']} SEC failures → re-fetch filing text")
    print(f"  - {results['extraction_failed']} extraction failures → try different filing or larger context")
    print(f"NOT ACTIONABLE: {results['not_ma']} false positives (not real M&A)")

    return results


async def run():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    await classify_enrichment_failures(conn, dry_run=not args.apply)
    await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
