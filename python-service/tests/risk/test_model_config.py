"""Tests for model_config: routing, pricing, cost computation."""

import pytest

from app.risk.model_config import (
    MODEL_PRICING,
    MODEL_REGISTRY,
    CACHE_CREATION_MULTIPLIER,
    CACHE_READ_MULTIPLIER,
    compute_cost,
    get_model,
    get_model_for_significance,
    get_pricing,
)


# ---------------------------------------------------------------------------
# get_model_for_significance
# ---------------------------------------------------------------------------


def test_significance_no_change_returns_reuse():
    assert get_model_for_significance("no_change") == "reuse"


def test_significance_minor_returns_haiku():
    model = get_model_for_significance("minor")
    assert "haiku" in model


def test_significance_moderate_returns_sonnet():
    model = get_model_for_significance("moderate")
    assert "sonnet" in model


def test_significance_major_returns_opus():
    model = get_model_for_significance("major")
    assert "opus" in model


def test_significance_unknown_returns_full_assessment():
    """Unknown significance defaults to full_assessment model (Opus)."""
    model = get_model_for_significance("unknown_value")
    assert model == get_model("full_assessment")


# ---------------------------------------------------------------------------
# get_model
# ---------------------------------------------------------------------------


def test_get_model_full_assessment():
    model = get_model("full_assessment")
    assert "opus" in model


def test_get_model_delta_assessment():
    model = get_model("delta_assessment")
    assert "sonnet" in model


def test_get_model_delta_minor():
    model = get_model("delta_minor")
    assert "haiku" in model


def test_get_model_run_summary():
    model = get_model("run_summary")
    assert "haiku" in model


def test_get_model_unknown_falls_back():
    """Unknown task falls back to full_assessment."""
    model = get_model("nonexistent_task")
    assert model == MODEL_REGISTRY["full_assessment"]


# ---------------------------------------------------------------------------
# get_pricing
# ---------------------------------------------------------------------------


def test_pricing_opus():
    inp, out = get_pricing("claude-opus-4-6")
    assert inp == 5.0
    assert out == 25.0


def test_pricing_sonnet():
    inp, out = get_pricing("claude-sonnet-4-6")
    assert inp == 3.0
    assert out == 15.0


def test_pricing_haiku():
    inp, out = get_pricing("claude-haiku-4-5-20251001")
    assert inp == 1.0
    assert out == 5.0


def test_pricing_unknown_model_default():
    inp, out = get_pricing("unknown-model-id")
    assert inp == 3.0 and out == 15.0


# ---------------------------------------------------------------------------
# compute_cost
# ---------------------------------------------------------------------------


def test_compute_cost_basic():
    """1000 input + 500 output with Haiku pricing."""
    cost = compute_cost("claude-haiku-4-5-20251001", 1000, 500)
    expected = (1000 * 1.0 + 500 * 5.0) / 1_000_000
    assert abs(cost - expected) < 1e-10


def test_compute_cost_with_cache_creation():
    """Cache creation tokens are charged at 1.25x input rate."""
    model = "claude-sonnet-4-6-20250514"
    cost = compute_cost(model, 2000, 500, cache_creation_tokens=1000)
    inp_rate = 3.0 / 1_000_000
    out_rate = 15.0 / 1_000_000
    expected = (
        1000 * inp_rate  # regular input (2000 - 1000 cache_create)
        + 1000 * inp_rate * CACHE_CREATION_MULTIPLIER
        + 500 * out_rate
    )
    assert abs(cost - expected) < 1e-10


def test_compute_cost_with_cache_read():
    """Cache read tokens are charged at 0.1x input rate."""
    model = "claude-sonnet-4-6-20250514"
    cost = compute_cost(model, 3000, 500, cache_read_tokens=2000)
    inp_rate = 3.0 / 1_000_000
    out_rate = 15.0 / 1_000_000
    expected = (
        1000 * inp_rate  # regular input (3000 - 2000 cache_read)
        + 2000 * inp_rate * CACHE_READ_MULTIPLIER
        + 500 * out_rate
    )
    assert abs(cost - expected) < 1e-10


def test_compute_cost_all_cached():
    """All input tokens from cache read — near-zero input cost."""
    model = "claude-haiku-4-5-20251001"
    cost = compute_cost(model, 5000, 200, cache_read_tokens=5000)
    inp_rate = 1.0 / 1_000_000
    out_rate = 5.0 / 1_000_000
    expected = (
        0 * inp_rate  # no regular input
        + 5000 * inp_rate * CACHE_READ_MULTIPLIER
        + 200 * out_rate
    )
    assert abs(cost - expected) < 1e-10


def test_compute_cost_zero_tokens():
    """Zero tokens = zero cost."""
    assert compute_cost("claude-opus-4-6-20250514", 0, 0) == 0.0


def test_compute_cost_opus_realistic():
    """Realistic Opus call: ~5K input, ~2.5K output."""
    cost = compute_cost("claude-opus-4-6-20250514", 5000, 2500)
    inp_rate = 5.0 / 1_000_000
    out_rate = 25.0 / 1_000_000
    expected = 5000 * inp_rate + 2500 * out_rate
    assert abs(cost - expected) < 1e-10
    # Sanity: should be around $0.0875
    assert 0.08 < cost < 0.10


# ---------------------------------------------------------------------------
# Routing hierarchy consistency
# ---------------------------------------------------------------------------


def test_routing_cost_hierarchy():
    """major model should be most expensive, minor cheapest."""
    major_model = get_model_for_significance("major")
    moderate_model = get_model_for_significance("moderate")
    minor_model = get_model_for_significance("minor")

    major_inp, major_out = get_pricing(major_model)
    moderate_inp, moderate_out = get_pricing(moderate_model)
    minor_inp, minor_out = get_pricing(minor_model)

    assert major_inp >= moderate_inp >= minor_inp
    assert major_out >= moderate_out >= minor_out
