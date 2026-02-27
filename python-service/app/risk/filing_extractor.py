"""Filing content extractor — extracts key sections from SEC filing HTML.

Used by filing_impact.py and research_refresher.py to pull relevant
sections from merger-related filings for AI analysis.
"""

import logging
import re
from typing import Dict, Optional

logger = logging.getLogger(__name__)


def extract_key_sections(html_content: str, filing_type: str) -> Dict[str, str]:
    """Extract relevant sections from filing HTML based on filing type.

    Returns a dict of section_name -> extracted_text.
    Each section is truncated to 5000 chars.
    """
    if not html_content:
        return {}

    # Strip HTML tags for text extraction
    text = _strip_html(html_content)

    sections = {}

    if filing_type in ("8-K", "8-K/A"):
        sections.update(_extract_8k_sections(text))
    elif filing_type in ("DEFM14A", "PREM14A", "DEFA14A"):
        sections.update(_extract_proxy_sections(text))
    elif filing_type in ("SC TO", "SC TO-T", "SC TO-C", "SC TO-T/A"):
        sections.update(_extract_tender_sections(text))
    elif filing_type in ("SC 14D-9", "SC 14D9"):
        sections.update(_extract_14d9_sections(text))
    elif filing_type in ("S-4", "S-4/A"):
        sections.update(_extract_s4_sections(text))
    elif filing_type in ("SC 13D", "SC 13D/A"):
        sections.update(_extract_13d_sections(text))

    # Truncate all sections
    return {k: v[:5000] for k, v in sections.items() if v and len(v.strip()) > 50}


def _strip_html(html: str) -> str:
    """Remove HTML tags and normalize whitespace."""
    text = re.sub(
        r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
    )
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_section(
    text: str,
    start_patterns: list[str],
    end_patterns: list[str],
    max_chars: int = 5000,
) -> Optional[str]:
    """Extract text between a start pattern and the next section header."""
    for pattern in start_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            start = match.start()
            remaining = text[start : start + max_chars * 2]
            for end_pat in end_patterns:
                end_match = re.search(end_pat, remaining[200:], re.IGNORECASE)
                if end_match:
                    return remaining[: 200 + end_match.start()].strip()[:max_chars]
            return remaining[:max_chars].strip()
    return None


def _extract_8k_sections(text: str) -> Dict[str, str]:
    """Extract key items from 8-K filings."""
    sections = {}

    # Item 1.01 — Material Definitive Agreement
    item_101 = _extract_section(
        text,
        [r"Item\s*1\.01[.\s]*(?:Entry into|Material Definitive)", r"Item 1\.01"],
        [r"Item\s*\d+\.\d+", r"SIGNATURE"],
    )
    if item_101:
        sections["item_1_01_material_agreement"] = item_101

    # Item 2.01 — Completion of Acquisition
    item_201 = _extract_section(
        text,
        [r"Item\s*2\.01[.\s]*(?:Completion|Acquisition)", r"Item 2\.01"],
        [r"Item\s*\d+\.\d+", r"SIGNATURE"],
    )
    if item_201:
        sections["item_2_01_completion"] = item_201

    # Item 8.01 — Other Events
    item_801 = _extract_section(
        text,
        [r"Item\s*8\.01[.\s]*(?:Other Events)", r"Item 8\.01"],
        [r"Item\s*\d+\.\d+", r"SIGNATURE"],
    )
    if item_801:
        sections["item_8_01_other_events"] = item_801

    return sections


def _extract_proxy_sections(text: str) -> Dict[str, str]:
    """Extract key sections from proxy statements (DEFM14A, PREM14A)."""
    sections = {}

    risk_factors = _extract_section(
        text,
        [r"RISK FACTORS", r"Risk Factors"],
        [r"(?:BACKGROUND|SPECIAL FACTORS|THE MERGER|PROPOSAL)", r"TABLE OF CONTENTS"],
    )
    if risk_factors:
        sections["risk_factors"] = risk_factors

    background = _extract_section(
        text,
        [
            r"BACKGROUND OF THE (?:MERGER|TRANSACTION|OFFER)",
            r"Background of the (?:Merger|Transaction|Offer)",
        ],
        [r"(?:REASONS FOR|OPINION OF|RECOMMENDATION|CERTAIN EFFECTS)"],
    )
    if background:
        sections["background_of_merger"] = background

    opinion = _extract_section(
        text,
        [
            r"OPINION OF (?:FINANCIAL ADVISOR|.*BANK)",
            r"Opinion of (?:Financial Advisor|.*Bank)",
        ],
        [r"(?:CERTAIN EFFECTS|MATERIAL.*TAX|INTERESTS OF|REGULATORY)"],
    )
    if opinion:
        sections["fairness_opinion"] = opinion

    return sections


def _extract_tender_sections(text: str) -> Dict[str, str]:
    """Extract key sections from tender offer statements."""
    sections = {}

    purpose = _extract_section(
        text,
        [r"PURPOSE OF THE (?:TENDER )?OFFER", r"Purpose of the (?:Tender )?Offer"],
        [r"(?:CONDITIONS|TERMS|SOURCE|BACKGROUND)"],
    )
    if purpose:
        sections["purpose_of_offer"] = purpose

    conditions = _extract_section(
        text,
        [
            r"CONDITIONS (?:OF|TO) THE (?:TENDER )?OFFER",
            r"Conditions (?:of|to) the (?:Tender )?Offer",
        ],
        [r"(?:CERTAIN|EFFECTS|MATERIAL|SOURCE|INTEREST)"],
    )
    if conditions:
        sections["conditions_of_offer"] = conditions

    return sections


def _extract_14d9_sections(text: str) -> Dict[str, str]:
    """Extract key sections from SC 14D-9 (target's response to tender)."""
    sections = {}

    recommendation = _extract_section(
        text,
        [
            r"(?:RECOMMENDATION|POSITION) OF (?:THE )?BOARD",
            r"(?:Recommendation|Position) of (?:the )?Board",
        ],
        [r"(?:BACKGROUND|REASONS|INTENT|PAST CONTACTS)"],
    )
    if recommendation:
        sections["board_recommendation"] = recommendation

    reasons = _extract_section(
        text,
        [
            r"REASONS FOR (?:THE )?(?:RECOMMENDATION|BOARD)",
            r"Reasons for (?:the )?(?:Recommendation|Board)",
        ],
        [r"(?:INTENT|PAST CONTACTS|CERTAIN|FINANCIAL)"],
    )
    if reasons:
        sections["reasons_for_recommendation"] = reasons

    return sections


def _extract_s4_sections(text: str) -> Dict[str, str]:
    """Extract key sections from S-4 registration statements."""
    sections = {}

    risk_factors = _extract_section(
        text,
        [r"RISK FACTORS", r"Risk Factors"],
        [r"(?:FORWARD|SELECTED|COMPARATIVE|THE MERGER)"],
    )
    if risk_factors:
        sections["risk_factors"] = risk_factors

    return sections


def _extract_13d_sections(text: str) -> Dict[str, str]:
    """Extract key sections from SC 13D (beneficial ownership)."""
    sections = {}

    purpose = _extract_section(
        text,
        [
            r"(?:Item 4|PURPOSE OF (?:THE )?TRANSACTION)",
            r"(?:Purpose of (?:the )?Transaction)",
        ],
        [r"(?:Item 5|Item 6|INTEREST|SOURCE)"],
    )
    if purpose:
        sections["purpose_of_transaction"] = purpose

    return sections
