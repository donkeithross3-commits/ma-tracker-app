"""Model configuration and pricing registry for the risk assessment engine.

Centralizes model selection (with env-var overrides) and per-model token pricing
so the engine can swap models without code changes.
"""

import os

# Task -> model mapping with environment variable overrides
MODEL_REGISTRY = {
    "full_assessment": os.environ.get("RISK_MODEL_FULL", "claude-sonnet-4-20250514"),
    "delta_assessment": os.environ.get("RISK_MODEL_DELTA", "claude-sonnet-4-20250514"),
    "run_summary": os.environ.get("RISK_MODEL_SUMMARY", "claude-sonnet-4-20250514"),
}

# Per-million token pricing: (input_cost, output_cost)
MODEL_PRICING = {
    "claude-sonnet-4-20250514": (3.0, 15.0),
    "claude-sonnet-4-6-20250514": (3.0, 15.0),
    "claude-opus-4-20250514": (15.0, 75.0),
    "claude-opus-4-6-20250514": (15.0, 75.0),
    "claude-haiku-3-5-20241022": (0.80, 4.0),
}

# Prompt caching multipliers (Anthropic pricing)
CACHE_CREATION_MULTIPLIER = 1.25  # 25% surcharge to write to cache
CACHE_READ_MULTIPLIER = 0.10      # 90% discount to read from cache


def get_model(task: str) -> str:
    """Get the model ID for a given task."""
    return MODEL_REGISTRY.get(task, MODEL_REGISTRY["full_assessment"])


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
