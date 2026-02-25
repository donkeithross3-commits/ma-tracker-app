"""Tests for Phase 4 human review queue: scoring, context building, corrections formatting, prompt integration."""

import pytest

from app.risk.review_queue import (
    _score_significant_change,
    _build_context_snapshot,
    format_corrections_for_prompt,
)
from app.risk.prompts import build_deal_assessment_prompt


# ---------------------------------------------------------------------------
# _score_significant_change
# ---------------------------------------------------------------------------


def test_significant_change_no_changes():
    assert _score_significant_change({}) == 0.0
    assert _score_significant_change({"assessment_changes": []}) == 0.0


def test_significant_change_worsened():
    ai_resp = {
        "assessment_changes": [
            {"factor": "regulatory", "direction": "worsened"},
        ],
    }
    score = _score_significant_change(ai_resp)
    assert score > 0
    # worsened (20) + graded factor (15) = 35
    assert score == 35


def test_significant_change_improved():
    ai_resp = {
        "assessment_changes": [
            {"factor": "vote", "direction": "improved"},
        ],
    }
    score = _score_significant_change(ai_resp)
    # improved (10) + graded factor (15) = 25
    assert score == 25


def test_significant_change_caps_at_80():
    ai_resp = {
        "assessment_changes": [
            {"factor": "vote", "direction": "worsened"},
            {"factor": "legal", "direction": "worsened"},
            {"factor": "regulatory", "direction": "worsened"},
            {"factor": "financing", "direction": "worsened"},
        ],
    }
    score = _score_significant_change(ai_resp)
    assert score == 80  # Capped


def test_significant_change_non_graded_factor():
    ai_resp = {
        "assessment_changes": [
            {"factor": "market", "direction": "worsened"},
        ],
    }
    score = _score_significant_change(ai_resp)
    # worsened (20) + not graded (0) = 20
    assert score == 20


# ---------------------------------------------------------------------------
# _build_context_snapshot
# ---------------------------------------------------------------------------


def test_context_snapshot_basic():
    assessment = {
        "our_prob_success": 85.5,
        "vote_grade": "Low",
        "regulatory_grade": "High",
    }
    ai_resp = {"deal_summary": "Deal is proceeding normally."}
    ctx = _build_context_snapshot(assessment, ai_resp, "three_way_disagreement")
    assert ctx["ai_prob"] == 85.5
    assert ctx["deal_summary"] == "Deal is proceeding normally."
    assert ctx["ai_vote"] == "Low"
    assert ctx["ai_regulatory"] == "High"


def test_context_snapshot_significant_change():
    assessment = {"our_prob_success": 70.0}
    changes = [{"factor": "legal", "direction": "worsened"}]
    ai_resp = {"deal_summary": "Test", "assessment_changes": changes}
    ctx = _build_context_snapshot(assessment, ai_resp, "significant_ai_change")
    assert ctx["changes"] == changes


def test_context_snapshot_no_prob():
    assessment = {}
    ai_resp = {}
    ctx = _build_context_snapshot(assessment, ai_resp, "new_milestone")
    assert ctx["ai_prob"] is None


# ---------------------------------------------------------------------------
# format_corrections_for_prompt
# ---------------------------------------------------------------------------


def test_format_corrections_none():
    assert format_corrections_for_prompt([]) is None
    assert format_corrections_for_prompt(None) is None


def test_format_corrections_basic():
    corrections = [
        {
            "annotation_date": "2026-02-20",
            "correct_signal": "options",
            "corrected_grades": None,
            "missed_reasoning": "AI missed the filing deadline extension",
            "error_type": "stale_data",
        },
    ]
    result = format_corrections_for_prompt(corrections)
    assert result is not None
    assert "HUMAN CORRECTIONS" in result
    assert "2026-02-20" in result
    assert "options" in result
    assert "filing deadline extension" in result
    assert "stale_data" in result


def test_format_corrections_with_grades():
    corrections = [
        {
            "annotation_date": "2026-02-22",
            "correct_signal": "sheet",
            "corrected_grades": '{"regulatory": {"corrected_grade": "High", "reasoning": "EU Phase II opened"}}',
            "missed_reasoning": None,
            "error_type": "wrong_factor",
        },
    ]
    result = format_corrections_for_prompt(corrections)
    assert "regulatory corrected to High" in result
    assert "EU Phase II opened" in result


def test_format_corrections_limits_to_three():
    corrections = [
        {"annotation_date": f"2026-02-{20+i}", "correct_signal": "ai"}
        for i in range(5)
    ]
    result = format_corrections_for_prompt(corrections)
    assert result is not None
    # Should include adjustment guidance
    assert "Incorporate" in result


def test_format_corrections_includes_guidance():
    corrections = [
        {"annotation_date": "2026-02-20", "correct_signal": "ai"},
    ]
    result = format_corrections_for_prompt(corrections)
    assert "Avoid repeating" in result


# ---------------------------------------------------------------------------
# Prompt integration — corrections_text and signal_weights_text
# ---------------------------------------------------------------------------


def test_prompt_includes_corrections_when_present():
    ctx = {
        "corrections_text": "## HUMAN CORRECTIONS (from portfolio manager review)\n- Test correction\n",
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "HUMAN CORRECTIONS" in prompt


def test_prompt_omits_corrections_when_absent():
    ctx = {"sheet_row": {"ticker": "TEST"}}
    prompt = build_deal_assessment_prompt(ctx)
    assert "HUMAN CORRECTIONS" not in prompt


def test_prompt_section_ordering():
    """Calibration, corrections, and signal weights appear in correct order."""
    ctx = {
        "calibration_text": "## YOUR CALIBRATION HISTORY\nTest cal.\n",
        "corrections_text": "## HUMAN CORRECTIONS\nTest corrections.\n",
        "signal_weights_text": "## SIGNAL TRACK RECORD\nTest weights.\n",
    }
    prompt = build_deal_assessment_prompt(ctx)
    cal_pos = prompt.index("CALIBRATION HISTORY")
    corr_pos = prompt.index("HUMAN CORRECTIONS")
    weights_pos = prompt.index("SIGNAL TRACK RECORD")
    assert cal_pos < corr_pos < weights_pos
