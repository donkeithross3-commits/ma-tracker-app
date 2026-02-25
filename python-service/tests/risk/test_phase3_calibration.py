"""Tests for Phase 3 calibration loop: compute_calibration_summary, format_calibration_for_prompt, prompt integration."""

import os

import pytest

from app.risk.calibration import compute_calibration_summary, format_calibration_for_prompt
from app.risk.prompts import build_deal_assessment_prompt


# ---------------------------------------------------------------------------
# format_calibration_for_prompt — no data
# ---------------------------------------------------------------------------


def test_format_returns_none_when_no_data():
    cal = {"available": False, "total_resolved": 0}
    assert format_calibration_for_prompt(cal) is None


def test_format_returns_early_disclaimer_when_insufficient():
    cal = {"available": False, "total_resolved": 3}
    result = format_calibration_for_prompt(cal)
    assert result is not None
    assert "early data" in result.lower()
    assert "3 resolved predictions" in result


# ---------------------------------------------------------------------------
# format_calibration_for_prompt — with data
# ---------------------------------------------------------------------------


def _make_calibration(by_bucket=None, by_factor=None, total=20):
    """Helper to build a calibration dict."""
    return {
        "available": True,
        "total_resolved": total,
        "by_bucket": by_bucket or [],
        "by_factor": by_factor or [],
    }


def test_format_shows_header_and_count():
    cal = _make_calibration(total=42)
    result = format_calibration_for_prompt(cal)
    assert "YOUR CALIBRATION HISTORY" in result
    assert "42 resolved predictions" in result


def test_format_shows_overconfident_bucket():
    cal = _make_calibration(by_bucket=[
        {
            "calibration_bucket": "90-100",
            "n": 10,
            "avg_predicted": 0.93,
            "avg_actual": 0.78,
            "avg_brier": 0.05,
        },
    ])
    result = format_calibration_for_prompt(cal)
    assert "90-100%" in result
    assert "overconfident" in result.lower()
    assert "n=10" in result


def test_format_shows_underconfident_bucket():
    cal = _make_calibration(by_bucket=[
        {
            "calibration_bucket": "50-60",
            "n": 8,
            "avg_predicted": 0.55,
            "avg_actual": 0.72,
            "avg_brier": 0.08,
        },
    ])
    result = format_calibration_for_prompt(cal)
    assert "underconfident" in result.lower()


def test_format_shows_well_calibrated_bucket():
    cal = _make_calibration(by_bucket=[
        {
            "calibration_bucket": "70-80",
            "n": 12,
            "avg_predicted": 0.74,
            "avg_actual": 0.75,
            "avg_brier": 0.04,
        },
    ])
    result = format_calibration_for_prompt(cal)
    assert "well calibrated" in result.lower()


def test_format_shows_factor_insights():
    cal = _make_calibration(by_factor=[
        {
            "factor": "regulatory",
            "n": 8,
            "avg_predicted": 0.90,
            "avg_actual": 0.75,
            "avg_brier": 0.08,
        },
        {
            "factor": "vote",
            "n": 6,
            "avg_predicted": 0.70,
            "avg_actual": 0.82,
            "avg_brier": 0.06,
        },
    ])
    result = format_calibration_for_prompt(cal)
    assert "Per-factor accuracy" in result
    assert "Regulatory" in result
    assert "overconfident" in result.lower()
    assert "Vote" in result
    assert "underconfident" in result.lower()


def test_format_omits_small_factor_deviation():
    """Factors with <5pp deviation and <5 predictions are omitted."""
    cal = _make_calibration(by_factor=[
        {
            "factor": "financing",
            "n": 3,
            "avg_predicted": 0.80,
            "avg_actual": 0.82,
            "avg_brier": 0.03,
        },
    ])
    result = format_calibration_for_prompt(cal)
    # Small deviation + small n -> no factor insights
    assert "Per-factor accuracy" not in result


def test_format_shows_well_calibrated_factor_with_enough_data():
    """Factors with <5pp deviation but >=5 predictions show as well calibrated."""
    cal = _make_calibration(by_factor=[
        {
            "factor": "financing",
            "n": 7,
            "avg_predicted": 0.80,
            "avg_actual": 0.82,
            "avg_brier": 0.03,
        },
    ])
    result = format_calibration_for_prompt(cal)
    assert "Financing" in result
    assert "well calibrated" in result.lower()


def test_format_includes_adjustment_guidance():
    cal = _make_calibration()
    result = format_calibration_for_prompt(cal)
    assert "adjust" in result.lower()


# ---------------------------------------------------------------------------
# Prompt integration — calibration_text in context
# ---------------------------------------------------------------------------


def test_prompt_includes_calibration_when_present():
    ctx = {
        "calibration_text": "## YOUR CALIBRATION HISTORY\nBased on 50 resolved predictions:\n",
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "YOUR CALIBRATION HISTORY" in prompt
    assert "50 resolved predictions" in prompt


def test_prompt_omits_calibration_when_absent():
    ctx = {"sheet_row": {"ticker": "TEST"}}
    prompt = build_deal_assessment_prompt(ctx)
    assert "CALIBRATION" not in prompt


def test_prompt_calibration_after_predictions(monkeypatch):
    """Calibration section should appear after predictions section."""
    monkeypatch.setenv("RISK_PREDICTIONS", "true")
    ctx = {
        "open_predictions": [
            {
                "prediction_type": "deal_closes",
                "claim": "Deal will close",
                "probability": 0.90,
                "by_date": "2026-06-30",
                "assessment_date": "2026-02-25",
            },
        ],
        "calibration_text": "## YOUR CALIBRATION HISTORY\nTest calibration data.\n",
    }
    prompt = build_deal_assessment_prompt(ctx)
    pred_pos = prompt.index("YOUR OPEN PREDICTIONS")
    cal_pos = prompt.index("YOUR CALIBRATION HISTORY")
    assert cal_pos > pred_pos


# ---------------------------------------------------------------------------
# System prompt — calibration guidance
# ---------------------------------------------------------------------------


def test_system_prompt_has_calibration_guidance():
    """System prompt mentions calibration so AI knows to use the feedback."""
    from app.risk.prompts import RISK_ASSESSMENT_SYSTEM_PROMPT
    # The system prompt should mention adjusting confidence
    assert "confidence" in RISK_ASSESSMENT_SYSTEM_PROMPT.lower()
