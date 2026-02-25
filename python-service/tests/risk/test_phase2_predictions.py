"""Tests for Phase 2 prediction registry: calibration, date parsing, prompt rendering."""

import os
from datetime import date, datetime

import pytest

from app.risk.predictions import _get_calibration_bucket, _parse_date
from app.risk.prompts import build_deal_assessment_prompt, RISK_ASSESSMENT_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# _get_calibration_bucket
# ---------------------------------------------------------------------------


def test_calibration_bucket_90_100():
    assert _get_calibration_bucket(0.95) == "90-100"
    assert _get_calibration_bucket(0.90) == "90-100"


def test_calibration_bucket_80_90():
    assert _get_calibration_bucket(0.85) == "80-90"
    assert _get_calibration_bucket(0.80) == "80-90"


def test_calibration_bucket_70_80():
    assert _get_calibration_bucket(0.75) == "70-80"
    assert _get_calibration_bucket(0.70) == "70-80"


def test_calibration_bucket_60_70():
    assert _get_calibration_bucket(0.65) == "60-70"
    assert _get_calibration_bucket(0.60) == "60-70"


def test_calibration_bucket_50_60():
    assert _get_calibration_bucket(0.55) == "50-60"
    assert _get_calibration_bucket(0.50) == "50-60"


def test_calibration_bucket_below_50():
    assert _get_calibration_bucket(0.30) == "0-50"
    assert _get_calibration_bucket(0.10) == "0-50"
    assert _get_calibration_bucket(0.0) == "0-50"


def test_calibration_bucket_edge_100():
    assert _get_calibration_bucket(1.0) == "90-100"


# ---------------------------------------------------------------------------
# _parse_date
# ---------------------------------------------------------------------------


def test_parse_date_string():
    result = _parse_date("2026-03-15")
    assert result == date(2026, 3, 15)


def test_parse_date_datetime():
    result = _parse_date(datetime(2026, 3, 15, 10, 30))
    assert result == date(2026, 3, 15)


def test_parse_date_date_object():
    d = date(2026, 3, 15)
    result = _parse_date(d)
    assert result == d


def test_parse_date_none():
    assert _parse_date(None) is None


def test_parse_date_invalid():
    assert _parse_date("not-a-date") is None
    assert _parse_date("2026-13-01") is None


def test_parse_date_truncates_timestamp():
    result = _parse_date("2026-03-15T10:30:00Z")
    assert result == date(2026, 3, 15)


# ---------------------------------------------------------------------------
# System prompt includes predictions
# ---------------------------------------------------------------------------


def test_system_prompt_has_predictions_section():
    """System prompt should include prediction instructions."""
    assert "## Predictions" in RISK_ASSESSMENT_SYSTEM_PROMPT
    assert "deal_closes" in RISK_ASSESSMENT_SYSTEM_PROMPT
    assert "milestone_completion" in RISK_ASSESSMENT_SYSTEM_PROMPT
    assert "by_date" in RISK_ASSESSMENT_SYSTEM_PROMPT


def test_system_prompt_has_predictions_json_schema():
    """System prompt should include predictions in the JSON schema example."""
    assert '"predictions"' in RISK_ASSESSMENT_SYSTEM_PROMPT
    assert '"type": "deal_closes"' in RISK_ASSESSMENT_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Prompt rendering — open predictions
# ---------------------------------------------------------------------------


def test_prompt_includes_open_predictions_when_enabled(monkeypatch):
    """When RISK_PREDICTIONS=true and open_predictions in context, show section."""
    monkeypatch.setenv("RISK_PREDICTIONS", "true")
    ctx = {
        "open_predictions": [
            {
                "prediction_type": "deal_closes",
                "claim": "Deal will close at $25",
                "probability": 0.92,
                "by_date": "2026-06-30",
                "assessment_date": "2026-02-24",
            },
            {
                "prediction_type": "milestone_completion",
                "claim": "HSR clearance will be received",
                "probability": 0.88,
                "by_date": "2026-04-15",
                "assessment_date": "2026-02-24",
            },
        ],
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "YOUR OPEN PREDICTIONS" in prompt
    assert "Deal will close at $25" in prompt
    assert "HSR clearance will be received" in prompt
    assert "P=0.92" in prompt
    assert "by 2026-06-30" in prompt


def test_prompt_omits_predictions_when_disabled(monkeypatch):
    """When RISK_PREDICTIONS=false, open predictions section should not appear."""
    monkeypatch.setenv("RISK_PREDICTIONS", "false")
    ctx = {
        "open_predictions": [
            {
                "prediction_type": "deal_closes",
                "claim": "Deal will close at $25",
                "probability": 0.92,
                "by_date": "2026-06-30",
                "assessment_date": "2026-02-24",
            },
        ],
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "YOUR OPEN PREDICTIONS" not in prompt


def test_prompt_omits_predictions_when_none_open(monkeypatch):
    """When RISK_PREDICTIONS=true but no open predictions, section absent."""
    monkeypatch.setenv("RISK_PREDICTIONS", "true")
    ctx = {"sheet_row": {"ticker": "TEST"}}
    prompt = build_deal_assessment_prompt(ctx)
    assert "YOUR OPEN PREDICTIONS" not in prompt


def test_prompt_prediction_format(monkeypatch):
    """Verify the exact format of prediction lines."""
    monkeypatch.setenv("RISK_PREDICTIONS", "true")
    ctx = {
        "open_predictions": [
            {
                "prediction_type": "spread_direction",
                "claim": "Spread will narrow by 50bps",
                "probability": 0.70,
                "by_date": "2026-03-01",
                "assessment_date": "2026-02-25",
            },
        ],
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "[spread_direction] Spread will narrow by 50bps" in prompt
    assert "P=0.7" in prompt
    assert "made 2026-02-25" in prompt
