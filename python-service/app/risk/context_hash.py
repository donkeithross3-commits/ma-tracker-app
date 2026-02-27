"""Context hashing and change classification for risk assessment reuse.

Computes a deterministic hash of material deal context so unchanged deals
can skip the AI call entirely, and changed deals can be routed to delta
prompts when the change is minor/moderate.
"""

import hashlib
import json
import math
from enum import Enum


class ChangeSignificance(str, Enum):
    NO_CHANGE = "no_change"
    MINOR = "minor"
    MODERATE = "moderate"
    MAJOR = "major"


# Fields that trigger MAJOR re-assessment if changed
_MAJOR_FIELDS = {
    "vote_risk", "finance_risk", "legal_risk",
    "investable", "deal_price", "probability_of_success",
    "mac_clauses", "regulatory_approvals",
}


def _bucket_price(price) -> str:
    """Round price to $0.50 buckets to filter noise."""
    if price is None:
        return "None"
    try:
        return str(round(float(price) * 2) / 2)
    except (ValueError, TypeError):
        return str(price)


def _safe_str(val) -> str:
    """Normalize a value to a stable string for hashing."""
    if val is None:
        return "None"
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return "None"
        return f"{val:.4f}"
    return str(val)


def compute_context_hash(context: dict) -> str:
    """Compute a 16-char hex SHA-256 digest of material context fields.

    Noise filtering:
    - Prices rounded to $0.50 buckets
    - Filing/halt counts rather than full content
    - Ignores live_price (too noisy)
    """
    parts = []

    # Sheet row material fields (bucketed prices)
    row = context.get("sheet_row") or {}
    parts.append(f"deal_price:{_bucket_price(row.get('deal_price'))}")
    parts.append(f"current_price:{_bucket_price(row.get('current_price'))}")
    parts.append(f"category:{_safe_str(row.get('category'))}")
    parts.append(f"acquiror:{_safe_str(row.get('acquiror'))}")
    parts.append(f"countdown:{_safe_str(row.get('countdown_days'))}")
    parts.append(f"cvr:{_safe_str(row.get('cvr_flag'))}")

    # Sheet comparison grades
    comp = context.get("sheet_comparison") or {}
    for key in sorted(_MAJOR_FIELDS & set(comp.keys())):
        parts.append(f"sheet:{key}:{_safe_str(comp.get(key))}")

    # Deal details material fields
    details = context.get("deal_details") or {}
    for key in ("regulatory_approvals", "mac_clauses", "expected_close_date",
                "outside_date", "probability_of_success", "termination_fee",
                "shareholder_vote", "financing_details"):
        parts.append(f"detail:{key}:{_safe_str(details.get(key))}")

    # Count-based: filings and halts (not full content)
    filings = context.get("recent_filings") or []
    parts.append(f"filing_count:{len(filings)}")
    # Include filing types for moderate-level detection
    filing_types = sorted(set(f.get("filing_type", "") for f in filings))
    parts.append(f"filing_types:{','.join(filing_types)}")

    halts = context.get("recent_halts") or []
    parts.append(f"halt_count:{len(halts)}")

    # Sheet diffs count
    diffs = context.get("sheet_diffs") or []
    parts.append(f"diff_count:{len(diffs)}")

    # Deal attributes
    attrs = context.get("deal_attributes") or {}
    if isinstance(attrs, dict):
        for key in sorted(attrs.keys()):
            if key not in ("id", "ticker", "created_at", "updated_at"):
                parts.append(f"attr:{key}:{_safe_str(attrs.get(key))}")

    # Spread-implied probability (bucketed to 2pp to avoid noise)
    spread_prob = context.get("spread_implied_probability") or context.get("options_implied_probability")
    if spread_prob is not None:
        try:
            bucketed = round(float(spread_prob) * 50) / 50  # 2pp buckets
            parts.append(f"spread_prob:{bucketed:.2f}")
        except (ValueError, TypeError):
            pass

    # Milestone count and statuses
    milestones = context.get("milestones") or []
    parts.append(f"milestone_count:{len(milestones)}")
    pending = sum(1 for m in milestones if m.get("status") == "pending")
    completed = sum(1 for m in milestones if m.get("status") == "completed")
    parts.append(f"milestones_pending:{pending}")
    parts.append(f"milestones_completed:{completed}")

    # Filing impact assessments (count + most severe level)
    filing_impacts = context.get("filing_impacts") or []
    parts.append(f"impact_count:{len(filing_impacts)}")
    if filing_impacts:
        severity_order = {"none": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
        max_impact = max(
            filing_impacts,
            key=lambda x: severity_order.get(x.get("impact_level", "none"), 0),
        )
        parts.append(f"max_impact:{max_impact.get('impact_level', 'none')}")

    # News article count
    news = context.get("news_articles") or []
    parts.append(f"news_count:{len(news)}")

    blob = "|".join(parts)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def build_context_summary(context: dict) -> dict:
    """Build a compact summary of material context fields for storage.

    This summary is stored in input_data JSONB and compared by tomorrow's
    run to classify changes.
    """
    row = context.get("sheet_row") or {}
    comp = context.get("sheet_comparison") or {}
    details = context.get("deal_details") or {}
    filings = context.get("recent_filings") or []
    halts = context.get("recent_halts") or []
    diffs = context.get("sheet_diffs") or []

    filing_impacts = context.get("filing_impacts") or []
    news = context.get("news_articles") or []

    return {
        "deal_price": row.get("deal_price"),
        "current_price": row.get("current_price"),
        "vote_risk": comp.get("vote_risk"),
        "finance_risk": comp.get("finance_risk"),
        "legal_risk": comp.get("legal_risk"),
        "investable": comp.get("investable"),
        "prob_success": comp.get("prob_success"),
        "regulatory_approvals": details.get("regulatory_approvals"),
        "mac_clauses": details.get("mac_clauses"),
        "expected_close_date": str(details.get("expected_close_date")) if details.get("expected_close_date") else None,
        "filing_count": len(filings),
        "filing_types": sorted(set(f.get("filing_type", "") for f in filings)),
        "halt_count": len(halts),
        "diff_count": len(diffs),
        "spread_implied_prob": context.get("spread_implied_probability") or context.get("options_implied_probability"),
        "milestones_pending": sum(1 for m in (context.get("milestones") or [])
                                  if m.get("status") == "pending"),
        "milestones_completed": sum(1 for m in (context.get("milestones") or [])
                                    if m.get("status") == "completed"),
        "impact_count": len(filing_impacts),
        "news_count": len(news),
    }


def classify_changes(context: dict, prev_summary: dict | None) -> tuple[ChangeSignificance, list[str]]:
    """Compare current context against previous summary and classify significance.

    Returns (significance, list_of_change_descriptions).
    """
    if prev_summary is None:
        # Check if a previous assessment exists but lacks context_summary
        # (infra migration: context_summary wasn't stored yet).
        # Use MODERATE to preserve model continuity (Sonnet delta, not Opus full).
        prev_assessment = context.get("previous_assessment")
        if prev_assessment:
            return ChangeSignificance.MODERATE, [
                "previous assessment exists but lacks context summary (backfill)"
            ]
        return ChangeSignificance.MAJOR, ["first assessment (no previous data)"]

    current = build_context_summary(context)
    changes = []
    max_significance = ChangeSignificance.NO_CHANGE

    def _upgrade(level: ChangeSignificance):
        nonlocal max_significance
        order = {
            ChangeSignificance.NO_CHANGE: 0,
            ChangeSignificance.MINOR: 1,
            ChangeSignificance.MODERATE: 2,
            ChangeSignificance.MAJOR: 3,
        }
        if order[level] > order[max_significance]:
            max_significance = level

    # Check MAJOR fields
    for field in ("vote_risk", "finance_risk", "legal_risk", "investable",
                  "deal_price", "prob_success", "regulatory_approvals", "mac_clauses"):
        old_val = _safe_str(prev_summary.get(field))
        new_val = _safe_str(current.get(field))
        if old_val != new_val:
            changes.append(f"{field}: {old_val} -> {new_val}")
            _upgrade(ChangeSignificance.MAJOR)

    # Check MODERATE triggers: new filings, new halts, new diffs
    old_filings = prev_summary.get("filing_count", 0) or 0
    new_filings = current.get("filing_count", 0) or 0
    if new_filings > old_filings:
        changes.append(f"new filings: {old_filings} -> {new_filings}")
        _upgrade(ChangeSignificance.MODERATE)

    old_halts = prev_summary.get("halt_count", 0) or 0
    new_halts = current.get("halt_count", 0) or 0
    if new_halts > old_halts:
        changes.append(f"new halts: {old_halts} -> {new_halts}")
        _upgrade(ChangeSignificance.MODERATE)

    old_diffs = prev_summary.get("diff_count", 0) or 0
    new_diffs = current.get("diff_count", 0) or 0
    if new_diffs > old_diffs:
        changes.append(f"new sheet diffs: {old_diffs} -> {new_diffs}")
        _upgrade(ChangeSignificance.MODERATE)

    old_types = set(prev_summary.get("filing_types") or [])
    new_types = set(current.get("filing_types") or [])
    if new_types - old_types:
        changes.append(f"new filing types: {new_types - old_types}")
        _upgrade(ChangeSignificance.MODERATE)

    # Check expected_close_date change
    old_close = prev_summary.get("expected_close_date")
    new_close = current.get("expected_close_date")
    if old_close != new_close and new_close is not None:
        changes.append(f"expected_close_date: {old_close} -> {new_close}")
        _upgrade(ChangeSignificance.MODERATE)

    # Check milestone status changes
    old_milestones_completed = prev_summary.get("milestones_completed", 0) or 0
    new_milestones_completed = current.get("milestones_completed", 0) or 0
    if new_milestones_completed > old_milestones_completed:
        changes.append(f"milestone completed: {old_milestones_completed} -> {new_milestones_completed}")
        _upgrade(ChangeSignificance.MODERATE)

    # Check new filing impacts
    old_impacts = prev_summary.get("impact_count", 0) or 0
    new_impacts = current.get("impact_count", 0) or 0
    if new_impacts > old_impacts:
        changes.append(f"new filing impacts: {old_impacts} -> {new_impacts}")
        _upgrade(ChangeSignificance.MODERATE)

    # Check new news articles
    old_news = prev_summary.get("news_count", 0) or 0
    new_news = current.get("news_count", 0) or 0
    if new_news > old_news:
        changes.append(f"new news articles: {old_news} -> {new_news}")
        _upgrade(ChangeSignificance.MODERATE)

    # Check spread-implied probability shift (>5pp)
    # Backward compat: check both old key (options_prob) and new key (spread_implied_prob)
    try:
        old_options = float(prev_summary.get("spread_implied_prob") or prev_summary.get("options_prob") or 0)
        new_options = float(current.get("spread_implied_prob") or 0)
        if old_options > 0 and new_options > 0:
            options_shift = abs(new_options - old_options)
            if options_shift >= 0.05:
                changes.append(f"spread-implied shift: {old_options:.0%} -> {new_options:.0%}")
                _upgrade(ChangeSignificance.MODERATE)
    except (ValueError, TypeError):
        pass

    # Check MINOR triggers: price drift >0.1%
    try:
        old_price = float(prev_summary.get("current_price") or 0)
        new_price = float(current.get("current_price") or 0)
        if old_price > 0 and new_price > 0:
            pct_change = abs(new_price - old_price) / old_price
            if pct_change > 0.001:  # >0.1%
                changes.append(f"price drift: {old_price:.2f} -> {new_price:.2f} ({pct_change:.2%})")
                _upgrade(ChangeSignificance.MINOR)
    except (ValueError, TypeError):
        pass

    return max_significance, changes
