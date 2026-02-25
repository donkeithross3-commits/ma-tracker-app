"""Tests for batch_assessor: batch request building, result processing."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.risk.batch_assessor import (
    _build_system_blocks,
    build_batch_requests,
    run_batch_assessment,
)
from app.risk.model_config import CACHE_MIN_TOKENS


# ---------------------------------------------------------------------------
# _build_system_blocks
# ---------------------------------------------------------------------------


def test_build_system_blocks_adds_cache_control():
    """System text large enough gets ephemeral cache_control."""
    big_text = "x" * 10000  # ~2500 tokens, above all minimums
    blocks = _build_system_blocks(big_text, "claude-sonnet-4-6-20250514")
    assert len(blocks) == 1
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"] == big_text
    assert "cache_control" in blocks[0]
    assert blocks[0]["cache_control"]["type"] == "ephemeral"


def test_build_system_blocks_small_text_no_cache():
    """Very small system text below 1024 tokens gets no cache_control."""
    small_text = "Hello"  # ~1 token
    blocks = _build_system_blocks(small_text, "claude-sonnet-4-6-20250514")
    assert len(blocks) == 1
    assert "cache_control" not in blocks[0]


def test_build_system_blocks_medium_text_gets_cache():
    """Text above 1024 token estimate but below 4096 still gets cache for Sonnet."""
    # ~1500 tokens, above Sonnet's 1024 minimum
    medium_text = "x" * 6000
    blocks = _build_system_blocks(medium_text, "claude-sonnet-4-6-20250514")
    assert "cache_control" in blocks[0]


def test_build_system_blocks_no_cache_flag():
    """use_batch_cache=False skips caching entirely."""
    big_text = "x" * 10000
    blocks = _build_system_blocks(big_text, "claude-sonnet-4-6-20250514", use_batch_cache=False)
    assert "cache_control" not in blocks[0]


# ---------------------------------------------------------------------------
# build_batch_requests
# ---------------------------------------------------------------------------


def test_build_batch_requests_structure():
    """Verify batch request objects have correct structure."""
    deal_requests = [
        {
            "ticker": "ATVI",
            "model": "claude-sonnet-4-6-20250514",
            "system_prompt": "You are a risk analyst." * 100,
            "user_prompt": "Assess ATVI deal risk.",
        },
        {
            "ticker": "VMW",
            "model": "claude-haiku-4-5-20251001",
            "system_prompt": "You are a risk analyst." * 100,
            "user_prompt": "Assess VMW deal risk.",
            "max_tokens": 2000,
        },
    ]

    requests = build_batch_requests(deal_requests)
    assert len(requests) == 2

    # First request
    r0 = requests[0]
    assert r0["custom_id"] == "risk-ATVI"
    params0 = r0["params"]
    assert params0["model"] == "claude-sonnet-4-6-20250514"
    assert params0["temperature"] == 0
    assert params0["max_tokens"] == 2800  # default
    assert len(params0["messages"]) == 1
    assert params0["messages"][0]["role"] == "user"
    assert "ATVI" in params0["messages"][0]["content"]

    # Second request with custom max_tokens
    r1 = requests[1]
    assert r1["custom_id"] == "risk-VMW"
    assert r1["params"]["max_tokens"] == 2000


def test_build_batch_requests_empty():
    """Empty input returns empty list."""
    assert build_batch_requests([]) == []


def test_build_batch_requests_custom_id_format():
    """Custom IDs follow risk-TICKER format."""
    requests = build_batch_requests([{
        "ticker": "SAVE",
        "model": "claude-haiku-4-5-20251001",
        "system_prompt": "Assess risk.",
        "user_prompt": "Deal details here.",
    }])
    assert requests[0]["custom_id"] == "risk-SAVE"


# ---------------------------------------------------------------------------
# run_batch_assessment (with mocked client)
# ---------------------------------------------------------------------------


def _make_usage(input_tokens=1000, output_tokens=500):
    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
    )


def _make_succeeded_result(custom_id, response_json, usage=None):
    """Create a mock batch result that succeeded."""
    text = json.dumps(response_json)
    content = [SimpleNamespace(text=text)]
    message = SimpleNamespace(content=content, usage=usage or _make_usage())
    result_obj = SimpleNamespace(type="succeeded", message=message)
    return SimpleNamespace(custom_id=custom_id, result=result_obj)


def _make_errored_result(custom_id):
    """Create a mock batch result that errored."""
    result_obj = SimpleNamespace(type="errored", error="Internal error")
    return SimpleNamespace(custom_id=custom_id, result=result_obj)


def _make_expired_result(custom_id):
    """Create a mock batch result that expired."""
    result_obj = SimpleNamespace(type="expired")
    return SimpleNamespace(custom_id=custom_id, result=result_obj)


def _make_batch(batch_id="batch_123", status="ended", succeeded=1, errored=0, expired=0, processing=0):
    return SimpleNamespace(
        id=batch_id,
        processing_status=status,
        request_counts=SimpleNamespace(
            succeeded=succeeded,
            errored=errored,
            expired=expired,
            processing=processing,
        ),
    )


@pytest.mark.asyncio
async def test_run_batch_empty_input():
    """Empty deal list returns empty dict."""
    result = await run_batch_assessment(None, [])
    assert result == {}


@pytest.mark.asyncio
async def test_run_batch_success():
    """Successful batch returns parsed JSON with _meta."""
    assessment = {
        "grades": {"regulatory": {"grade": "Medium"}},
        "overall_risk_assessment": "Moderate risk",
    }

    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(
        status="ended", succeeded=1,
    )
    mock_client.messages.batches.retrieve.return_value = _make_batch(
        status="ended", succeeded=1,
    )
    mock_client.messages.batches.results.return_value = [
        _make_succeeded_result("risk-ATVI", assessment),
    ]

    deal_requests = [{
        "ticker": "ATVI",
        "model": "claude-sonnet-4-6-20250514",
        "system_prompt": "Assess risk.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert "ATVI" in results
    assert results["ATVI"]["grades"]["regulatory"]["grade"] == "Medium"
    assert "_meta" in results["ATVI"]
    meta = results["ATVI"]["_meta"]
    assert meta["model"] == "claude-sonnet-4-6-20250514"
    assert meta["tokens_used"] == 1500  # 1000 + 500
    assert meta["batch_id"] == "batch_123"
    # Batch cost should be 50% of standard
    assert meta["cost_usd"] > 0


@pytest.mark.asyncio
async def test_run_batch_strips_markdown_fences():
    """JSON wrapped in ```json fences is correctly parsed."""
    assessment = {"risk": "low"}
    raw = f"```json\n{json.dumps(assessment)}\n```"

    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", succeeded=1)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", succeeded=1)

    # Build a succeeded result with markdown-fenced JSON
    content = [SimpleNamespace(text=raw)]
    message = SimpleNamespace(content=content, usage=_make_usage())
    result_obj = SimpleNamespace(type="succeeded", message=message)
    mock_result = SimpleNamespace(custom_id="risk-SAVE", result=result_obj)
    mock_client.messages.batches.results.return_value = [mock_result]

    deal_requests = [{
        "ticker": "SAVE",
        "model": "claude-haiku-4-5-20251001",
        "system_prompt": "Assess.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert "SAVE" in results
    assert results["SAVE"]["risk"] == "low"


@pytest.mark.asyncio
async def test_run_batch_errored_result():
    """Errored batch result includes error in _meta."""
    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", errored=1)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", errored=1)
    mock_client.messages.batches.results.return_value = [
        _make_errored_result("risk-FAIL"),
    ]

    deal_requests = [{
        "ticker": "FAIL",
        "model": "claude-sonnet-4-6-20250514",
        "system_prompt": "Assess.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert "FAIL" in results
    assert results["FAIL"]["_meta"]["error"] == "batch_errored"


@pytest.mark.asyncio
async def test_run_batch_expired_result():
    """Expired batch result includes error in _meta."""
    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", expired=1)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", expired=1)
    mock_client.messages.batches.results.return_value = [
        _make_expired_result("risk-LATE"),
    ]

    deal_requests = [{
        "ticker": "LATE",
        "model": "claude-haiku-4-5-20251001",
        "system_prompt": "Assess.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert "LATE" in results
    assert results["LATE"]["_meta"]["error"] == "batch_expired"


@pytest.mark.asyncio
async def test_run_batch_cost_is_half():
    """Batch cost should be exactly 50% of standard compute_cost."""
    from app.risk.model_config import compute_cost

    model = "claude-sonnet-4-6-20250514"
    inp, out = 2000, 1000
    standard_cost = compute_cost(model, inp, out)

    assessment = {"risk": "moderate"}
    usage = _make_usage(input_tokens=inp, output_tokens=out)

    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", succeeded=1)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", succeeded=1)
    mock_client.messages.batches.results.return_value = [
        _make_succeeded_result("risk-COST", assessment, usage),
    ]

    deal_requests = [{
        "ticker": "COST",
        "model": model,
        "system_prompt": "Assess.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    batch_cost = results["COST"]["_meta"]["cost_usd"]
    assert abs(batch_cost - standard_cost * 0.5) < 1e-10


@pytest.mark.asyncio
async def test_run_batch_multiple_deals():
    """Multiple deals in a single batch all get processed."""
    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", succeeded=3)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", succeeded=3)

    results_list = [
        _make_succeeded_result("risk-AAA", {"risk": "low"}),
        _make_succeeded_result("risk-BBB", {"risk": "medium"}),
        _make_succeeded_result("risk-CCC", {"risk": "high"}),
    ]
    mock_client.messages.batches.results.return_value = results_list

    deal_requests = [
        {"ticker": t, "model": "claude-haiku-4-5-20251001", "system_prompt": "X", "user_prompt": "Y"}
        for t in ["AAA", "BBB", "CCC"]
    ]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert len(results) == 3
    assert results["AAA"]["risk"] == "low"
    assert results["BBB"]["risk"] == "medium"
    assert results["CCC"]["risk"] == "high"


@pytest.mark.asyncio
async def test_run_batch_malformed_json():
    """Malformed JSON in response sets invalid_json error."""
    mock_client = MagicMock()
    mock_client.messages.batches.create.return_value = _make_batch(status="ended", succeeded=1)
    mock_client.messages.batches.retrieve.return_value = _make_batch(status="ended", succeeded=1)

    # Return non-JSON text
    content = [SimpleNamespace(text="This is not JSON at all")]
    message = SimpleNamespace(content=content, usage=_make_usage())
    result_obj = SimpleNamespace(type="succeeded", message=message)
    mock_result = SimpleNamespace(custom_id="risk-BAD", result=result_obj)
    mock_client.messages.batches.results.return_value = [mock_result]

    deal_requests = [{
        "ticker": "BAD",
        "model": "claude-sonnet-4-6-20250514",
        "system_prompt": "Assess.",
        "user_prompt": "Details.",
    }]

    with patch("app.risk.batch_assessor.asyncio.sleep"):
        results = await run_batch_assessment(mock_client, deal_requests)

    assert "BAD" in results
    assert results["BAD"]["_meta"]["error"] == "invalid_json"
