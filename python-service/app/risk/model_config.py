"""Model configuration and pricing registry for the risk assessment engine.

Centralizes model selection (with env-var overrides) and per-model token pricing
so the engine can swap models without code changes.

Smart routing: ChangeSignificance -> model selection
  MAJOR  / first assessment -> Opus 4.6  (highest quality)
  MODERATE                  -> Sonnet 4.6 (balanced)
  MINOR                     -> Haiku 4.5  (fast, cheap)
  NO_CHANGE                 -> reuse      (no API call)
"""

import os

# Task -> model mapping with environment variable overrides
MODEL_REGISTRY = {
    "full_assessment": os.environ.get("RISK_MODEL_FULL", "claude-opus-4-6-20250514"),
    "delta_assessment": os.environ.get("RISK_MODEL_DELTA", "claude-sonnet-4-6-20250514"),
    "delta_minor": os.environ.get("RISK_MODEL_MINOR", "claude-haiku-4-5-20251001"),
    "run_summary": os.environ.get("RISK_MODEL_SUMMARY", "claude-haiku-4-5-20251001"),
}

# Per-million token pricing: (input_cost, output_cost)
MODEL_PRICING = {
    "claude-opus-4-6-20250514": (5.0, 25.0),
    "claude-sonnet-4-6-20250514": (3.0, 15.0),
    "claude-sonnet-4-20250514": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    # Legacy entries for backward compatibility
    "claude-opus-4-20250514": (15.0, 75.0),
    "claude-haiku-3-5-20241022": (0.80, 4.0),
}

# Prompt caching multipliers (Anthropic pricing)
CACHE_CREATION_MULTIPLIER = 1.25  # 25% surcharge to write to cache (5-min TTL)
CACHE_CREATION_MULTIPLIER_1H = 2.0  # 100% surcharge to write to cache (1-hour TTL)
CACHE_READ_MULTIPLIER = 0.10      # 90% discount to read from cache

# Minimum cached token thresholds per model family
# Content below this threshold won't be cached by the API
CACHE_MIN_TOKENS = {
    "claude-opus-4-6-20250514": 4096,
    "claude-sonnet-4-6-20250514": 1024,
    "claude-sonnet-4-20250514": 1024,
    "claude-haiku-4-5-20251001": 4096,
}


def get_model(task: str) -> str:
    """Get the model ID for a given task."""
    return MODEL_REGISTRY.get(task, MODEL_REGISTRY["full_assessment"])


def get_model_for_significance(significance: str) -> str:
    """Select model based on change significance.

    Args:
        significance: One of 'major', 'moderate', 'minor', 'no_change'.

    Returns:
        Model ID string, or 'reuse' for no_change.
    """
    if significance == "no_change":
        return "reuse"
    if significance == "minor":
        return get_model("delta_minor")
    if significance == "moderate":
        return get_model("delta_assessment")
    # major or first assessment
    return get_model("full_assessment")


def get_pricing(model: str) -> tuple[float, float]:
    """Get (input_cost_per_M, output_cost_per_M) for a model."""
    return MODEL_PRICING.get(model, (3.0, 15.0))


def compute_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Compute USD cost for a single API call with optional cache pricing.

    Regular input tokens are charged at standard rate.
    Cache creation tokens are charged at 1.25x input rate.
    Cache read tokens are charged at 0.1x input rate.
    """
    input_per_token, output_per_token = get_pricing(model)
    input_per_token /= 1_000_000
    output_per_token /= 1_000_000

    # Standard input tokens (subtract cached tokens from total)
    regular_input = max(0, input_tokens - cache_creation_tokens - cache_read_tokens)

    cost = (
        regular_input * input_per_token
        + cache_creation_tokens * input_per_token * CACHE_CREATION_MULTIPLIER
        + cache_read_tokens * input_per_token * CACHE_READ_MULTIPLIER
        + output_tokens * output_per_token
    )
    return cost
