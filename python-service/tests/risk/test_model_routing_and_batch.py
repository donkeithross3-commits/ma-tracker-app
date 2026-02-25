"""Tests for smart model routing, batch assessor, and cost computation.

Covers:
- get_model_for_significance() routing map
- MODEL_PRICING correctness
- CACHE_MIN_TOKENS thresholds
- compute_cost with various cache scenarios
- Batch request building
- Batch result parsing (mocked client)
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.risk.model_config import (
    CACHE_CREATION_MULTIPLIER,
    CACHE_MIN_TOKENS,
    CACHE_READ_MULTIPLIER,
    MODEL_PRICING,
    MODEL_REGISTRY,
    compute_cost,
    get_model,
    get_model_for_significance,
    get_pricing,
)
from app.risk.batch_assessor import (
    _build_system_blocks,
    build_batch_requests,
)


# ---------------------------------------------------------------------------
# Model routing tests
# ---------------------------------------------------------------------------
class TestModelRouting:
    """Tests for get_model_for_significance and MODEL_REGISTRY."""

    def test_no_change_returns_reuse(self):
        assert get_model_for_significance("no_change") == "reuse"

    def test_minor_returns_haiku(self):
        model = get_model_for_significance("minor")
        assert "haiku" in model

    def test_moderate_returns_sonnet(self):
        model = get_model_for_significance("moderate")
        assert "sonnet" in model

    def test_major_returns_opus(self):
        model = get_model_for_significance("major")
        assert "opus" in model

    def test_registry_has_required_tasks(self):
        assert "full_assessment" in MODEL_REGISTRY
        assert "delta_assessment" in MODEL_REGISTRY
        assert "delta_minor" in MODEL_REGISTRY
        assert "run_summary" in MODEL_REGISTRY

    def test_full_assessment_is_opus(self):
        assert "opus" in get_model("full_assessment")

    def test_delta_assessment_is_sonnet(self):
        assert "sonnet" in get_model("delta_assessment")

    def test_delta_minor_is_haiku(self):
        assert "haiku" in get_model("delta_minor")

    def test_run_summary_is_haiku(self):
        assert "haiku" in get_model("run_summary")

    def test_unknown_task_falls_back_to_full(self):
        result = get_model("nonexistent_task")
        assert result == MODEL_REGISTRY["full_assessment"]


# ---------------------------------------------------------------------------
# Pricing tests
# ---------------------------------------------------------------------------
class TestPricing:
    """Tests for MODEL_PRICING and compute_cost."""

    def test_opus_pricing_is_5_25(self):
        pricing = get_pricing("claude-opus-4-6-20250514")
        assert pricing == (5.0, 25.0)

    def test_sonnet_pricing_is_3_15(self):
        pricing = get_pricing("claude-sonnet-4-6-20250514")
        assert pricing == (3.0, 15.0)

    def test_haiku_pricing_is_1_5(self):
        pricing = get_pricing("claude-haiku-4-5-20251001")
        assert pricing == (1.0, 5.0)

    def test_unknown_model_falls_back(self):
        pricing = get_pricing("unknown-model-123")
        assert pricing == (3.0, 15.0)  # default fallback

    def test_all_registered_models_have_pricing(self):
        """Every model in the registry must have a pricing entry."""
        for task, model in MODEL_REGISTRY.items():
            assert model in MODEL_PRICING, f"Model {model} (task={task}) missing from MODEL_PRICING"

    def test_compute_cost_basic(self):
        """Standard cost with no caching."""
        cost = compute_cost("claude-sonnet-4-6-20250514", 1_000_000, 1_000_000)
        assert cost == pytest.approx(3.0 + 15.0)  # $3 input + $15 output

    def test_compute_cost_with_cache_read(self):
        """Cache reads get 90% discount."""
        # 1M input, 500K from cache read, 500K regular
        cost = compute_cost(
            "claude-sonnet-4-6-20250514",
            input_tokens=1_000_000,
            output_tokens=0,
            cache_creation_tokens=0,
            cache_read_tokens=500_000,
        )
        # 500K regular: 500K * $3/M = $1.50
        # 500K cache read: 500K * $3/M * 0.10 = $0.15
        expected = 1.50 + 0.15
        assert cost == pytest.approx(expected)

    def test_compute_cost_with_cache_creation(self):
        """Cache creation has 25% surcharge."""
        cost = compute_cost(
            "claude-sonnet-4-6-20250514",
            input_tokens=1_000_000,
            output_tokens=0,
            cache_creation_tokens=500_000,
            cache_read_tokens=0,
        )
        # 500K regular: 500K * $3/M = $1.50
        # 500K cache creation: 500K * $3/M * 1.25 = $1.875
        expected = 1.50 + 1.875
        assert cost == pytest.approx(expected)

    def test_compute_cost_zero_tokens(self):
        """Zero tokens should cost zero (reuse scenario)."""
        cost = compute_cost("claude-opus-4-6-20250514", 0, 0, 0, 0)
        assert cost == 0.0

    def test_compute_cost_typical_opus_call(self):
        """Realistic Opus call: 8K in, 2.5K out."""
        cost = compute_cost("claude-opus-4-6-20250514", 8000, 2500)
        # 8K * $5/M = $0.04
        # 2.5K * $25/M = $0.0625
        expected = 0.04 + 0.0625
        assert cost == pytest.approx(expected)

    def test_compute_cost_typical_haiku_call(self):
        """Realistic Haiku call: 5K in, 2K out."""
        cost = compute_cost("claude-haiku-4-5-20251001", 5000, 2000)
        # 5K * $1/M = $0.005
        # 2K * $5/M = $0.01
        expected = 0.005 + 0.01
        assert cost == pytest.approx(expected)

    def test_batch_discount_halves_cost(self):
        """Batch API gives 50% off standard pricing."""
        standard = compute_cost("claude-opus-4-6-20250514", 8000, 2500)
        batch = standard * 0.5
        assert batch == pytest.approx(standard / 2)
        assert batch < 0.06  # sanity check

    def test_projected_run_cost(self):
        """Projected batch run: 5 reuse + 8 minor + 4 moderate + 3 major."""
        haiku_cost = compute_cost("claude-haiku-4-5-20251001", 5000, 2000) * 0.5
        sonnet_cost = compute_cost("claude-sonnet-4-6-20250514", 5000, 2000) * 0.5
        opus_cost = compute_cost("claude-opus-4-6-20250514", 8000, 2500) * 0.5

        total = 0 + 8 * haiku_cost + 4 * sonnet_cost + 3 * opus_cost
        assert total < 0.50  # must be well under $0.50
        assert total > 0.10  # must be non-trivial


# ---------------------------------------------------------------------------
# Cache threshold tests
# ---------------------------------------------------------------------------
class TestCacheThresholds:
    """Tests for CACHE_MIN_TOKENS."""

    def test_opus_needs_4096(self):
        assert CACHE_MIN_TOKENS["claude-opus-4-6-20250514"] == 4096

    def test_sonnet_needs_1024(self):
        assert CACHE_MIN_TOKENS["claude-sonnet-4-6-20250514"] == 1024

    def test_haiku_needs_4096(self):
        assert CACHE_MIN_TOKENS["claude-haiku-4-5-20251001"] == 4096

    def test_cache_multipliers(self):
        assert CACHE_CREATION_MULTIPLIER == 1.25
        assert CACHE_READ_MULTIPLIER == 0.10


# ---------------------------------------------------------------------------
# Batch request building tests
# ---------------------------------------------------------------------------
class TestBatchRequestBuilding:
    """Tests for build_batch_requests and _build_system_blocks."""

    def test_build_system_blocks_with_large_prompt(self):
        """System prompt above threshold should get cache_control."""
        # ~5K tokens (~20K chars)
        large_text = "x" * 20_000
        blocks = _build_system_blocks(large_text, "claude-sonnet-4-6-20250514")
        assert len(blocks) == 1
        assert "cache_control" in blocks[0]
        assert blocks[0]["cache_control"]["type"] == "ephemeral"

    def test_build_system_blocks_with_small_prompt(self):
        """Very small prompt below all thresholds gets no cache_control."""
        tiny_text = "hello"
        blocks = _build_system_blocks(tiny_text, "claude-opus-4-6-20250514")
        assert len(blocks) == 1
        # Tiny prompt is below 1024 token minimum
        assert "cache_control" not in blocks[0]

    def test_build_batch_requests_structure(self):
        """Build batch requests from deal request dicts."""
        deal_requests = [
            {
                "ticker": "ACME",
                "model": "claude-opus-4-6-20250514",
                "system_prompt": "You are a risk analyst." * 100,
                "user_prompt": "Assess ACME deal risk.",
            },
            {
                "ticker": "WIDG",
                "model": "claude-haiku-4-5-20251001",
                "system_prompt": "You are a risk analyst." * 100,
                "user_prompt": "Assess WIDG deal risk.",
            },
        ]
        requests = build_batch_requests(deal_requests)
        assert len(requests) == 2
        # Request is a TypedDict, access via dict keys
        assert requests[0]["custom_id"] == "risk-ACME"
        assert requests[1]["custom_id"] == "risk-WIDG"
        assert requests[0]["params"]["model"] == "claude-opus-4-6-20250514"
        assert requests[1]["params"]["model"] == "claude-haiku-4-5-20251001"

    def test_build_batch_requests_default_max_tokens(self):
        """Default max_tokens should be 2800."""
        deal_requests = [{
            "ticker": "TEST",
            "model": "claude-sonnet-4-6-20250514",
            "system_prompt": "System.",
            "user_prompt": "User.",
        }]
        requests = build_batch_requests(deal_requests)
        assert requests[0]["params"]["max_tokens"] == 2800

    def test_build_batch_requests_custom_max_tokens(self):
        """Custom max_tokens should be respected."""
        deal_requests = [{
            "ticker": "TEST",
            "model": "claude-sonnet-4-6-20250514",
            "system_prompt": "System.",
            "user_prompt": "User.",
            "max_tokens": 4000,
        }]
        requests = build_batch_requests(deal_requests)
        assert requests[0]["params"]["max_tokens"] == 4000

    def test_build_batch_requests_empty_list(self):
        """Empty list should return empty list."""
        assert build_batch_requests([]) == []


# ---------------------------------------------------------------------------
# Batch result processing tests
# ---------------------------------------------------------------------------
class TestBatchResultProcessing:
    """Tests for run_batch_assessment with mocked Anthropic client."""

    def test_run_batch_empty_list(self):
        """Empty deal list returns empty dict immediately."""
        import asyncio
        from app.risk.batch_assessor import run_batch_assessment

        result = asyncio.run(run_batch_assessment(MagicMock(), []))
        assert result == {}

    def test_run_batch_creates_batch(self):
        """Verify batch is created with correct number of requests."""
        import asyncio
        from app.risk.batch_assessor import run_batch_assessment

        # Mock the Anthropic client
        mock_client = MagicMock()

        # Mock batch creation
        mock_batch = MagicMock()
        mock_batch.id = "batch_123"
        mock_batch.processing_status = "ended"
        mock_batch.request_counts = MagicMock(
            succeeded=1, processing=0, errored=0, expired=0
        )
        mock_client.messages.batches.create.return_value = mock_batch
        mock_client.messages.batches.retrieve.return_value = mock_batch

        # Mock successful result
        mock_result = MagicMock()
        mock_result.custom_id = "risk-ACME"
        mock_result.result.type = "succeeded"
        mock_msg = MagicMock()
        mock_msg.content = [MagicMock(text='{"grades": {}, "investable_assessment": "Yes"}')]
        mock_msg.usage = MagicMock(
            input_tokens=5000,
            output_tokens=2000,
            cache_creation_input_tokens=0,
            cache_read_input_tokens=0,
        )
        mock_result.result.message = mock_msg
        mock_client.messages.batches.results.return_value = [mock_result]

        deal_requests = [{
            "ticker": "ACME",
            "model": "claude-opus-4-6-20250514",
            "system_prompt": "System.",
            "user_prompt": "User.",
        }]

        # Patch sleep to avoid waiting
        async def _run():
            with patch("app.risk.batch_assessor.asyncio.sleep", return_value=None):
                return await run_batch_assessment(mock_client, deal_requests)

        results = asyncio.run(_run())

        assert "ACME" in results
        assert results["ACME"]["investable_assessment"] == "Yes"
        assert "_meta" in results["ACME"]
        assert results["ACME"]["_meta"]["model"] == "claude-opus-4-6-20250514"
        assert results["ACME"]["_meta"]["batch_id"] == "batch_123"
        # Batch discount: cost should be halved
        assert results["ACME"]["_meta"]["cost_usd"] > 0
