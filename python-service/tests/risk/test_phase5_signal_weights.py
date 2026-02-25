"""Tests for Phase 5 signal weighting: format_signal_weights_for_prompt and prompt integration."""

import pytest

from app.risk.signal_weights import format_signal_weights_for_prompt
from app.risk.prompts import build_deal_assessment_prompt


# ---------------------------------------------------------------------------
# format_signal_weights_for_prompt
# ---------------------------------------------------------------------------


def test_format_weights_none():
    assert format_signal_weights_for_prompt(None) is None


def test_format_weights_basic():
    weights = {
        "options_weight": 0.35,
        "sheet_weight": 0.30,
        "ai_weight": 0.35,
        "options_brier": 0.082,
        "sheet_brier": 0.095,
        "ai_brier": 0.082,
        "n_deals": 25,
        "n_with_options": 20,
    }
    result = format_signal_weights_for_prompt(weights)
    assert result is not None
    assert "SIGNAL TRACK RECORD" in result
    assert "25 completed deals" in result
    assert "Options market" in result
    assert "Sheet analyst" in result
    assert "Your AI" in result


def test_format_weights_shows_brier_scores():
    weights = {
        "options_weight": 0.40,
        "sheet_weight": 0.25,
        "ai_weight": 0.35,
        "options_brier": 0.060,
        "sheet_brier": 0.120,
        "ai_brier": 0.085,
        "n_deals": 15,
        "n_with_options": 12,
    }
    result = format_signal_weights_for_prompt(weights)
    assert "0.060" in result  # options brier
    assert "0.120" in result  # sheet brier
    assert "0.085" in result  # AI brier


def test_format_weights_shows_percentages():
    weights = {
        "options_weight": 0.50,
        "sheet_weight": 0.20,
        "ai_weight": 0.30,
        "options_brier": 0.050,
        "sheet_brier": 0.150,
        "ai_brier": 0.100,
        "n_deals": 30,
        "n_with_options": 25,
    }
    result = format_signal_weights_for_prompt(weights)
    assert "50%" in result
    assert "20%" in result
    assert "30%" in result


def test_format_weights_includes_guidance():
    weights = {
        "options_weight": 0.33,
        "sheet_weight": 0.33,
        "ai_weight": 0.34,
        "options_brier": 0.100,
        "sheet_brier": 0.100,
        "ai_brier": 0.100,
        "n_deals": 10,
        "n_with_options": 8,
    }
    result = format_signal_weights_for_prompt(weights)
    assert "weight" in result.lower()
    assert "accuracy" in result.lower()


# ---------------------------------------------------------------------------
# Prompt integration
# ---------------------------------------------------------------------------


def test_prompt_includes_signal_weights():
    ctx = {
        "signal_weights_text": "## SIGNAL TRACK RECORD\nBased on 20 deals:\n",
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "SIGNAL TRACK RECORD" in prompt
    assert "20 deals" in prompt


def test_prompt_omits_signal_weights_when_absent():
    ctx = {"sheet_row": {"ticker": "TEST"}}
    prompt = build_deal_assessment_prompt(ctx)
    assert "SIGNAL TRACK RECORD" not in prompt
