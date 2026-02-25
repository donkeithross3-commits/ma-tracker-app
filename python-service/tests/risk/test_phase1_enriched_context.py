"""Tests for Phase 1 enriched context: signals, context_hash, prompts."""

import pytest

from app.risk.signals import compute_options_implied_probability, build_signal_comparison
from app.risk.context_hash import compute_context_hash, classify_changes, ChangeSignificance
from app.risk.prompts import build_deal_assessment_prompt, build_delta_assessment_prompt


# ---------------------------------------------------------------------------
# compute_options_implied_probability
# ---------------------------------------------------------------------------


def test_compute_options_implied_probability_normal():
    """current_price=24, deal_price=25 -> ~0.96"""
    result = compute_options_implied_probability(24.0, 25.0)
    assert result is not None
    assert abs(result - 0.96) < 0.001


def test_compute_options_implied_probability_above_deal():
    """current_price=26, deal_price=25 -> 1.0 (trading above deal)"""
    result = compute_options_implied_probability(26.0, 25.0)
    assert result == 1.0


def test_compute_options_implied_probability_none_inputs():
    """None inputs -> None"""
    assert compute_options_implied_probability(None, 25.0) is None
    assert compute_options_implied_probability(24.0, None) is None
    assert compute_options_implied_probability(None, None) is None


def test_compute_options_implied_probability_zero_deal():
    """deal_price=0 -> None"""
    assert compute_options_implied_probability(24.0, 0) is None


# ---------------------------------------------------------------------------
# build_signal_comparison
# ---------------------------------------------------------------------------


def test_build_signal_comparison_three_signals():
    """All three present, verify structure."""
    result = build_signal_comparison(0.96, 0.85, 0.92)
    assert result is not None
    assert "signals" in result
    assert "consensus" in result
    assert "divergences" in result
    assert len(result["signals"]) == 3
    assert "options" in result["signals"]
    assert "sheet" in result["signals"]
    assert "ai_previous" in result["signals"]


def test_build_signal_comparison_two_signals():
    """Only two present, works correctly."""
    result = build_signal_comparison(0.96, 0.90, None)
    assert result is not None
    assert len(result["signals"]) == 2
    assert "ai_previous" not in result["signals"]


def test_build_signal_comparison_one_signal():
    """Only one signal -> returns None."""
    assert build_signal_comparison(0.96, None, None) is None
    assert build_signal_comparison(None, 0.85, None) is None
    assert build_signal_comparison(None, None, 0.92) is None


def test_build_signal_comparison_divergence():
    """Two signals 10pp apart, divergence detected."""
    result = build_signal_comparison(0.96, 0.86, None)
    assert result is not None
    assert len(result["divergences"]) == 1
    div = result["divergences"][0]
    assert div["higher"] == "options"
    assert div["lower"] == "sheet"
    assert div["gap_pp"] == 10.0


def test_build_signal_comparison_no_divergence():
    """Two signals 3pp apart, no divergence."""
    result = build_signal_comparison(0.96, 0.93, None)
    assert result is not None
    assert len(result["divergences"]) == 0


# ---------------------------------------------------------------------------
# context_hash — options and milestone fields
# ---------------------------------------------------------------------------


def _base_context(**overrides):
    """Build a minimal context dict for hashing tests."""
    ctx = {
        "sheet_row": {"deal_price": 25.0, "current_price": 24.0},
        "sheet_comparison": {},
        "deal_details": {},
        "recent_filings": [],
        "recent_halts": [],
        "sheet_diffs": [],
        "deal_attributes": {},
    }
    ctx.update(overrides)
    return ctx


def test_context_hash_includes_options():
    """Hash changes when options_implied_probability changes by >2pp."""
    ctx1 = _base_context(options_implied_probability=0.90)
    ctx2 = _base_context(options_implied_probability=0.95)
    hash1 = compute_context_hash(ctx1)
    hash2 = compute_context_hash(ctx2)
    assert hash1 != hash2


def test_context_hash_ignores_small_options_change():
    """Hash unchanged for <2pp shift (bucketed to 2pp)."""
    ctx1 = _base_context(options_implied_probability=0.90)
    ctx2 = _base_context(options_implied_probability=0.909)
    hash1 = compute_context_hash(ctx1)
    hash2 = compute_context_hash(ctx2)
    assert hash1 == hash2


def test_context_hash_includes_milestones():
    """Hash changes when milestone count changes."""
    ctx1 = _base_context(milestones=[])
    ctx2 = _base_context(milestones=[{"status": "pending", "milestone_type": "hsr_filing"}])
    hash1 = compute_context_hash(ctx1)
    hash2 = compute_context_hash(ctx2)
    assert hash1 != hash2


# ---------------------------------------------------------------------------
# classify_changes — milestone + options triggers
# ---------------------------------------------------------------------------


def test_classify_changes_milestone_completion():
    """Completed milestone triggers MODERATE."""
    ctx = _base_context(
        milestones=[
            {"status": "completed", "milestone_type": "hsr_filing"},
        ],
    )
    prev_summary = {
        "deal_price": 25.0,
        "current_price": 24.0,
        "filing_count": 0,
        "halt_count": 0,
        "diff_count": 0,
        "milestones_completed": 0,
        "milestones_pending": 1,
    }
    significance, changes = classify_changes(ctx, prev_summary)
    assert significance == ChangeSignificance.MODERATE
    assert any("milestone" in c for c in changes)


def test_classify_changes_options_shift():
    """>5pp options shift triggers MODERATE."""
    ctx = _base_context(options_implied_probability=0.90)
    prev_summary = {
        "deal_price": 25.0,
        "current_price": 24.0,
        "filing_count": 0,
        "halt_count": 0,
        "diff_count": 0,
        "milestones_completed": 0,
        "milestones_pending": 0,
        "options_prob": 0.80,
    }
    significance, changes = classify_changes(ctx, prev_summary)
    assert significance == ChangeSignificance.MODERATE
    assert any("options" in c for c in changes)


def test_classify_changes_small_options_shift():
    """<5pp shift does NOT trigger MODERATE."""
    ctx = _base_context(options_implied_probability=0.90)
    prev_summary = {
        "deal_price": 25.0,
        "current_price": 24.0,
        "filing_count": 0,
        "halt_count": 0,
        "diff_count": 0,
        "milestones_completed": 0,
        "milestones_pending": 0,
        "options_prob": 0.87,
    }
    significance, changes = classify_changes(ctx, prev_summary)
    # Should be NO_CHANGE or MINOR at most, not MODERATE
    assert significance != ChangeSignificance.MODERATE
    assert significance != ChangeSignificance.MAJOR


# ---------------------------------------------------------------------------
# Prompt generation — section inclusion/exclusion
# ---------------------------------------------------------------------------


def test_prompt_includes_options_section():
    """Mock context with options data, verify prompt has Options section."""
    ctx = {
        "options_implied_probability": 0.96,
        "options_snapshot": {
            "atm_iv": 0.35,
            "put_call_ratio": 0.8,
            "unusual_volume": True,
        },
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "Options-Implied Probability" in prompt
    assert "96.0%" in prompt
    assert "ATM IV" in prompt
    assert "Put/Call Ratio" in prompt
    assert "Unusual Volume" in prompt


def test_prompt_omits_options_when_missing():
    """Mock context without options, verify section absent."""
    ctx = {"sheet_row": {"ticker": "TEST"}}
    prompt = build_deal_assessment_prompt(ctx)
    assert "Options-Implied Probability" not in prompt


def test_prompt_includes_milestones():
    """Mock context with milestones, verify Milestone Timeline section."""
    ctx = {
        "milestones": [
            {
                "status": "completed",
                "milestone_type": "hsr_filing",
                "milestone_date": "2026-01-15",
                "risk_factor_affected": "regulatory",
            },
            {
                "status": "pending",
                "milestone_type": "shareholder_vote",
                "expected_date": "2026-03-10",
                "risk_factor_affected": "vote",
            },
        ],
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "Milestone Timeline" in prompt
    assert "[COMPLETED] Hsr Filing: 2026-01-15 (affects: regulatory)" in prompt
    assert "[PENDING] Shareholder Vote: 2026-03-10 (affects: vote)" in prompt


def test_prompt_includes_signal_comparison():
    """Mock context with signal_comparison, verify SIGNAL COMPARISON section."""
    ctx = {
        "signal_comparison": {
            "signals": {"options": 0.96, "sheet": 0.85, "ai_previous": 0.92},
            "consensus": 0.91,
            "divergences": [
                {"higher": "options", "lower": "sheet", "gap_pp": 11.0},
            ],
        },
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "SIGNAL COMPARISON" in prompt
    assert "- options: 96.0%" in prompt
    assert "- sheet: 85.0%" in prompt
    assert "Divergences" in prompt
    assert "options is 11.0pp more optimistic than sheet" in prompt


def test_prompt_divergence_formatting():
    """Divergences should be formatted as readable text, not raw dicts."""
    ctx = {
        "signal_comparison": {
            "signals": {"options": 0.96, "sheet": 0.85},
            "consensus": 0.905,
            "divergences": [
                {"higher": "options", "lower": "sheet", "gap_pp": 11.0},
            ],
        },
    }
    prompt = build_deal_assessment_prompt(ctx)
    # Must NOT contain raw dict repr
    assert "{'higher':" not in prompt
    assert "options is 11.0pp more optimistic than sheet" in prompt


def test_delta_prompt_divergence_formatting():
    """Delta prompt divergences should also be formatted as readable text."""
    ctx = {
        "ticker": "TEST",
        "signal_comparison": {
            "signals": {"options": 0.96, "sheet": 0.85},
            "consensus": 0.905,
            "divergences": [
                {"higher": "options", "lower": "sheet", "gap_pp": 11.0},
            ],
        },
    }
    prev = {"deal_summary": "Test deal"}
    prompt = build_delta_assessment_prompt(ctx, prev, ["price drift"], "minor")
    assert "SIGNAL DIVERGENCES" in prompt
    assert "options is 11.0pp more optimistic than sheet" in prompt
    assert "{'higher':" not in prompt


def test_prompt_milestone_uses_correct_fields():
    """Milestones use expected_date/milestone_date and risk_factor_affected columns."""
    ctx = {
        "milestones": [
            {
                "status": "pending",
                "milestone_type": "cfius_filing",
                "expected_date": "2026-04-01",
                "risk_factor_affected": "regulatory",
            },
        ],
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "2026-04-01" in prompt
    assert "regulatory" in prompt
    # Old field names should NOT be used
    assert "(affects: N/A)" not in prompt
