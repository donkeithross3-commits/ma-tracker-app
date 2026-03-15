#!/usr/bin/env python3
"""
Parkinson's / PSP Research Updater

Autonomous daily research loop that:
1. Searches ClinicalTrials.gov for status changes on tracked trials
2. Searches PubMed for new publications matching key terms
3. Checks CurePSP.org for news
4. Evaluates findings against evidence tier system
5. Appends new entries to research-updates.json

Usage:
    python parkinsons_research_updater.py              # Run all checks
    python parkinsons_research_updater.py --trials     # ClinicalTrials.gov only
    python parkinsons_research_updater.py --pubmed     # PubMed only
    python parkinsons_research_updater.py --dry-run    # Show what would change without writing
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

# ClinicalTrials.gov v2 API
import urllib.request
import urllib.error

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Paths ──────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DATA_PATH = REPO_ROOT / "data" / "parkinsons" / "research-updates.json"

# ─── Tracked Trial IDs ─────────────────────────────────────────────────
# Map of ClinicalTrials.gov NCT IDs to our therapy IDs

TRACKED_TRIALS: dict[str, dict[str, str]] = {
    "NCT04777331": {
        "therapy_id": "therapy-007",
        "name": "Prasinezumab (PADOVA)",
        "target": "alpha-synuclein",
    },
    "NCT04075318": {
        "therapy_id": "therapy-002",
        "name": "UB-312",
        "target": "alpha-synuclein",
    },
    # Add more NCT IDs as they become known
}

# ─── PubMed Search Terms ───────────────────────────────────────────────

PUBMED_SEARCHES = [
    {
        "query": "PSP progressive supranuclear palsy immunotherapy",
        "domain": "tau_immunotherapy",
    },
    {
        "query": "alpha-synuclein vaccine clinical trial",
        "domain": "alpha_syn_immunotherapy",
    },
    {
        "query": "prasinezumab Parkinson",
        "domain": "alpha_syn_immunotherapy",
    },
    {
        "query": "AADvac1 PSP tau",
        "domain": "tau_immunotherapy",
    },
    {
        "query": "alpha-synuclein tau cross-seeding",
        "domain": "cross_seeding",
    },
    {
        "query": "GLP-1 agonist neuroprotection Parkinson",
        "domain": "neuroprotection",
    },
    {
        "query": "focused ultrasound blood-brain barrier Parkinson",
        "domain": "delivery_technology",
    },
    {
        "query": "SNCA antisense oligonucleotide",
        "domain": "gene_therapy",
    },
    {
        "query": "alpha-synuclein seed amplification assay biomarker",
        "domain": "biomarkers",
    },
    {
        "query": "PSP rating scale natural history",
        "domain": "psp_specific",
    },
]

# ─── Evidence Tiers ─────────────────────────────────────────────────────

EVIDENCE_TIERS = {
    1: "Published Phase 2/3",
    2: "Active Clinical Trial",
    3: "Peer-Reviewed Preclinical",
    4: "Conference / Preprint",
    5: "Theoretical / Emerging",
}


# ─── Utilities ──────────────────────────────────────────────────────────


def load_data() -> dict[str, Any]:
    """Load the research data JSON file."""
    if not DATA_PATH.exists():
        logger.error(f"Data file not found: {DATA_PATH}")
        sys.exit(1)
    with open(DATA_PATH, "r") as f:
        return json.load(f)


def save_data(data: dict[str, Any]) -> None:
    """Save the research data JSON file."""
    data["last_updated"] = datetime.now(timezone.utc).isoformat()
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info(f"Data saved to {DATA_PATH}")


def fetch_json(url: str, retries: int = 3) -> dict | list | None:
    """Fetch JSON from a URL with retries."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "DR3-ParkinsonsResearchUpdater/1.0 (research dashboard)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            logger.warning(f"HTTP {e.code} for {url} (attempt {attempt + 1})")
            if e.code == 429:  # Rate limited
                time.sleep(2 ** attempt)
            elif e.code >= 500:
                time.sleep(1)
            else:
                return None
        except Exception as e:
            logger.warning(f"Error fetching {url}: {e} (attempt {attempt + 1})")
            time.sleep(1)
    return None


# ─── ClinicalTrials.gov Integration ────────────────────────────────────


def check_clinical_trials(data: dict[str, Any], dry_run: bool = False) -> int:
    """
    Check ClinicalTrials.gov v2 API for status changes on tracked trials.
    Returns count of updates found.
    """
    logger.info("Checking ClinicalTrials.gov for trial status changes...")
    updates_found = 0

    for nct_id, trial_info in TRACKED_TRIALS.items():
        logger.info(f"  Checking {nct_id} ({trial_info['name']})...")

        # ClinicalTrials.gov v2 API
        url = f"https://clinicaltrials.gov/api/v2/studies/{nct_id}"
        result = fetch_json(url)

        if not result:
            logger.warning(f"  Could not fetch data for {nct_id}")
            continue

        # Extract key fields from the API response
        try:
            protocol = result.get("protocolSection", {})
            status_module = protocol.get("statusModule", {})
            id_module = protocol.get("identificationModule", {})
            design_module = protocol.get("designModule", {})

            overall_status = status_module.get("overallStatus", "Unknown")
            last_update = status_module.get("lastUpdatePostDateStruct", {}).get(
                "date", ""
            )
            brief_title = id_module.get("briefTitle", "")
            enrollment_info = design_module.get("enrollmentInfo", {})
            enrollment_count = enrollment_info.get("count", "")
            enrollment_type = enrollment_info.get("type", "")

            logger.info(
                f"  Status: {overall_status} | "
                f"Enrollment: {enrollment_count} ({enrollment_type}) | "
                f"Last updated: {last_update}"
            )

            # Check if status changed from what we have stored
            therapy_id = trial_info["therapy_id"]
            current_therapy = next(
                (t for t in data["tracked_therapies"] if t["id"] == therapy_id),
                None,
            )

            if current_therapy:
                # Update the therapy entry with fresh data
                new_status = f"{overall_status}"
                if enrollment_count:
                    new_status += f" ({enrollment_count} {enrollment_type.lower()})"

                if not dry_run:
                    current_therapy["last_checked"] = datetime.now(
                        timezone.utc
                    ).strftime("%Y-%m-%d")

                # Create an update entry if status seems different
                if overall_status.lower() not in current_therapy[
                    "status"
                ].lower():
                    updates_found += 1
                    logger.info(
                        f"  STATUS CHANGE DETECTED: "
                        f"'{current_therapy['status']}' -> '{new_status}'"
                    )

                    if not dry_run:
                        update_id = f"update-ct-{nct_id}-{datetime.now().strftime('%Y%m%d')}"
                        new_update = {
                            "id": update_id,
                            "date": datetime.now().strftime("%Y-%m-%d"),
                            "title": f"Trial Status Update: {trial_info['name']}",
                            "summary": (
                                f"ClinicalTrials.gov status for {nct_id} "
                                f"({trial_info['name']}): {overall_status}. "
                                f"Enrollment: {enrollment_count} {enrollment_type.lower()}. "
                                f"Brief title: {brief_title}"
                            ),
                            "evidence_tier": 2,
                            "category": "trial_status_change",
                            "source_urls": [
                                f"https://clinicaltrials.gov/study/{nct_id}"
                            ],
                            "implications_for_patient": (
                                f"The {trial_info['name']} trial targeting "
                                f"{trial_info['target']} has been updated on "
                                f"ClinicalTrials.gov. Review the new status to "
                                f"assess enrollment opportunities."
                            ),
                        }
                        data["research_updates"].append(new_update)
            else:
                logger.warning(
                    f"  Therapy {therapy_id} not found in data file"
                )

        except Exception as e:
            logger.error(f"  Error parsing {nct_id} response: {e}")

        # Rate limit: be respectful to the API
        time.sleep(0.5)

    logger.info(f"ClinicalTrials.gov check complete. {updates_found} updates found.")
    return updates_found


# ─── PubMed Integration (Stub) ─────────────────────────────────────────


def check_pubmed(data: dict[str, Any], dry_run: bool = False) -> int:
    """
    Search PubMed for new publications matching tracked research domains.
    Returns count of new publications found.

    TODO: Implement full PubMed E-utilities integration:
    - Use esearch.fcgi to find new PMIDs
    - Use efetch.fcgi to get abstracts
    - Compare against already-known source URLs
    - Classify evidence tier based on publication type
    """
    logger.info("Checking PubMed for new publications...")

    updates_found = 0

    for search in PUBMED_SEARCHES:
        query_encoded = quote(search["query"])
        # PubMed E-utilities: search for recent articles (last 7 days)
        url = (
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"
            f"db=pubmed&term={query_encoded}&retmode=json&retmax=5"
            f"&datetype=edat&reldate=7&sort=date"
        )

        result = fetch_json(url)
        if not result:
            logger.warning(f"  Could not search PubMed for: {search['query']}")
            continue

        try:
            esearch_result = result.get("esearchresult", {})
            count = int(esearch_result.get("count", 0))
            id_list = esearch_result.get("idlist", [])

            if count > 0:
                logger.info(
                    f"  '{search['query']}': {count} new article(s) "
                    f"in last 7 days (domain: {search['domain']})"
                )
                updates_found += len(id_list)

                # TODO: Fetch abstracts and create detailed research updates
                # For now, log the PMIDs for manual review
                for pmid in id_list:
                    logger.info(
                        f"    PMID: {pmid} — "
                        f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
                    )
            else:
                logger.info(
                    f"  '{search['query']}': no new articles in last 7 days"
                )

        except Exception as e:
            logger.error(
                f"  Error processing PubMed results for '{search['query']}': {e}"
            )

        # Rate limit: NCBI requires max 3 requests/second without API key
        time.sleep(0.4)

    logger.info(f"PubMed check complete. {updates_found} new articles found.")
    return updates_found


# ─── CurePSP Check (Stub) ──────────────────────────────────────────────


def check_curepsp(data: dict[str, Any], dry_run: bool = False) -> int:
    """
    Check CurePSP.org for PSP-specific news and updates.

    TODO: Implement web scraping of CurePSP news page:
    - Fetch https://www.psp.org/news/
    - Parse news articles for relevance
    - Check against already-known URLs
    - Create research updates for new findings
    """
    logger.info("Checking CurePSP.org for news... (stub — not yet implemented)")
    return 0


# ─── Main ───────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Parkinson's / PSP Research Updater"
    )
    parser.add_argument(
        "--trials",
        action="store_true",
        help="Only check ClinicalTrials.gov",
    )
    parser.add_argument(
        "--pubmed",
        action="store_true",
        help="Only check PubMed",
    )
    parser.add_argument(
        "--curepsp",
        action="store_true",
        help="Only check CurePSP.org",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing",
    )
    args = parser.parse_args()

    # If no specific source selected, check all
    check_all = not (args.trials or args.pubmed or args.curepsp)

    logger.info("=" * 60)
    logger.info("Parkinson's / PSP Research Updater")
    logger.info(f"Data file: {DATA_PATH}")
    if args.dry_run:
        logger.info("DRY RUN — no changes will be written")
    logger.info("=" * 60)

    data = load_data()
    total_updates = 0

    if check_all or args.trials:
        total_updates += check_clinical_trials(data, dry_run=args.dry_run)

    if check_all or args.pubmed:
        total_updates += check_pubmed(data, dry_run=args.dry_run)

    if check_all or args.curepsp:
        total_updates += check_curepsp(data, dry_run=args.dry_run)

    logger.info("=" * 60)
    logger.info(f"Total updates found: {total_updates}")

    if total_updates > 0 and not args.dry_run:
        save_data(data)
        logger.info("Data file updated successfully.")
    elif args.dry_run:
        logger.info("Dry run complete — no changes written.")
    else:
        logger.info("No updates found — data file unchanged.")

    logger.info("=" * 60)


if __name__ == "__main__":
    main()
