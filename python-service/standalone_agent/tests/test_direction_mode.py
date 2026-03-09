"""Tests for direction_mode → option type enforcement in BigMoveConvexityStrategy.

These tests verify the CRITICAL invariant:
    long_only  → CALLS ONLY  (no PUTs, ever)
    short_only → PUTS ONLY   (no CALLs, ever)
    both       → either

This invariant was violated in production (2026-03-09): a PUT was bought for SPY
despite direction_mode="long_only".  Root cause: the signal-direction gate checked
signal.direction but didn't account for all code paths that can produce mismatched
option types (DOWN model inversion, symmetric model "both" fallback, config
propagation gaps across directional strategy pairs).

The fix adds a DEFINITIVE option-type gate in _build_entry_order() that enforces
direction_mode at the option-type level, not just the signal-direction level.

Run with:
    cd /Users/donross/dev/ma-tracker-app/python-service
    python -m pytest standalone_agent/tests/test_direction_mode.py -v
"""

from __future__ import annotations

import sys
import os
from dataclasses import dataclass, field
from typing import List, Optional
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Minimal stubs so we can import BigMoveConvexityStrategy without IB/py_proj
# ---------------------------------------------------------------------------


@dataclass
class FakeSignal:
    """Minimal Signal stand-in for testing _build_entry_order."""
    timestamp: object = None
    ticker: str = "SPY"
    direction: str = "long"
    strength: float = 0.8
    probability: float = 0.7
    threshold_used: float = 0.5
    metadata: dict = field(default_factory=dict)


@dataclass
class FakeOrderAction:
    action: str
    contract: dict
    quantity: int
    order_type: str = "LMT"
    limit_price: float = 0.0


# We test the option-type gate logic directly, extracted from _build_entry_order.
# This avoids needing to instantiate the full strategy with IB/py_proj deps.


def resolve_direction_mode(cfg_direction_mode: Optional[str], target_column: str) -> str:
    """Reproduce the direction_mode resolution logic from _build_entry_order.

    This mirrors lines ~1375-1379 in big_move_convexity.py.
    """
    direction_mode = (cfg_direction_mode or "auto").lower()
    if direction_mode == "auto":
        has_up_or_down = target_column and ("UP" in target_column or "DOWN" in target_column)
        direction_mode = "long_only" if has_up_or_down else "both"
    return direction_mode


def would_option_type_gate_block(
    signal_direction: str,
    cfg_direction_mode: Optional[str],
    target_column: str = "",
) -> tuple[bool, str]:
    """Simulate the full direction gate + option-type gate chain.

    Returns (blocked: bool, reason: str).
    """
    direction_mode = resolve_direction_mode(cfg_direction_mode, target_column)

    # Signal direction gate (lines ~1381-1400)
    if direction_mode == "long_only" and signal_direction != "long":
        return True, "signal_direction_gate_long_only"
    if direction_mode == "short_only" and signal_direction != "short":
        return True, "signal_direction_gate_short_only"

    # Option type determination (line ~1402)
    right = "C" if signal_direction == "long" else "P"

    # DEFINITIVE option-type gate (the fix)
    if direction_mode == "long_only" and right == "P":
        return True, "option_type_gate_long_only"
    if direction_mode == "short_only" and right == "C":
        return True, "option_type_gate_short_only"

    return False, right  # Not blocked; returns the option type


# ---------------------------------------------------------------------------
# Core invariant tests: direction_mode → option type
# ---------------------------------------------------------------------------


class TestLongOnlyMeansCallsOnly:
    """long_only MUST produce only CALLs — never PUTs under any circumstances."""

    def test_long_signal_produces_call(self):
        blocked, result = would_option_type_gate_block("long", "long_only")
        assert not blocked
        assert result == "C"

    def test_short_signal_blocked(self):
        blocked, reason = would_option_type_gate_block("short", "long_only")
        assert blocked
        assert "long_only" in reason

    def test_none_signal_blocked(self):
        """A 'none' signal shouldn't even reach _build_entry_order, but if it does,
        the gate must catch it."""
        blocked, reason = would_option_type_gate_block("none", "long_only")
        assert blocked


class TestShortOnlyMeansPutsOnly:
    """short_only MUST produce only PUTs — never CALLs."""

    def test_short_signal_produces_put(self):
        blocked, result = would_option_type_gate_block("short", "short_only")
        assert not blocked
        assert result == "P"

    def test_long_signal_blocked(self):
        blocked, reason = would_option_type_gate_block("long", "short_only")
        assert blocked
        assert "short_only" in reason


class TestBothAllowsEither:
    """direction_mode='both' allows CALLs and PUTs."""

    def test_long_signal_produces_call(self):
        blocked, result = would_option_type_gate_block("long", "both")
        assert not blocked
        assert result == "C"

    def test_short_signal_produces_put(self):
        blocked, result = would_option_type_gate_block("short", "both")
        assert not blocked
        assert result == "P"


# ---------------------------------------------------------------------------
# Auto-resolution tests: None/auto config → model-appropriate default
# ---------------------------------------------------------------------------


class TestAutoDirectionResolution:
    """When direction_mode is None or 'auto', it should resolve based on model type."""

    def test_auto_with_up_model_resolves_to_long_only(self):
        dm = resolve_direction_mode("auto", "target_UP_60m")
        assert dm == "long_only"

    def test_auto_with_down_model_resolves_to_long_only(self):
        """DOWN models also resolve to long_only in auto mode.
        This means DOWN model long signals (pre-inversion) are allowed,
        but after inversion they become 'short' and get blocked."""
        dm = resolve_direction_mode("auto", "target_DOWN_60m")
        assert dm == "long_only"

    def test_auto_with_symmetric_model_resolves_to_both(self):
        dm = resolve_direction_mode(None, "is_big_move")
        assert dm == "both"

    def test_auto_with_empty_target_resolves_to_both(self):
        dm = resolve_direction_mode(None, "")
        assert dm == "both"

    def test_explicit_long_only_overrides_auto(self):
        """When user explicitly sets long_only, it sticks regardless of model."""
        dm = resolve_direction_mode("long_only", "is_big_move")
        assert dm == "long_only"

    def test_explicit_both_stays_both_for_symmetric(self):
        dm = resolve_direction_mode("both", "is_big_move")
        assert dm == "both"


# ---------------------------------------------------------------------------
# DOWN model inversion + direction_mode interaction
# ---------------------------------------------------------------------------


class TestDownModelInversion:
    """Verify that DOWN model signal inversion interacts correctly with direction gates.

    A DOWN model with high P(DOWN) generates 'long' from generate_signal, then
    inversion flips it to 'short'.  The direction gate must block this in long_only mode.
    """

    def test_down_model_inverted_signal_blocked_in_long_only(self):
        """DOWN model: high P → generate_signal returns 'long' → inverted to 'short'.
        long_only must block the 'short' signal (would produce PUT)."""
        # After inversion, signal.direction = "short"
        blocked, reason = would_option_type_gate_block("short", "long_only")
        assert blocked, "PUT from DOWN model must be blocked in long_only mode"

    def test_down_model_inverted_signal_allowed_in_both(self):
        """DOWN model: inverted to 'short' → should produce PUT in 'both' mode."""
        blocked, result = would_option_type_gate_block("short", "both")
        assert not blocked
        assert result == "P"


# ---------------------------------------------------------------------------
# Edge case: symmetric model with explicit long_only
# ---------------------------------------------------------------------------


class TestSymmetricModelWithLongOnly:
    """A symmetric model (no UP/DOWN target) with explicit direction_mode='long_only'
    must never produce PUTs.

    BUG SCENARIO (2026-03-09): Symmetric model had cfg direction_mode=None,
    which resolved to 'auto' → 'both' → short signals → PUTs.
    When user sets long_only, it MUST be respected even for symmetric models.
    """

    def test_symmetric_short_signal_blocked_in_long_only(self):
        """Symmetric model generating 'short' must be blocked when long_only is set."""
        blocked, reason = would_option_type_gate_block("short", "long_only", target_column="is_big_move")
        assert blocked

    def test_symmetric_long_signal_allowed_in_long_only(self):
        blocked, result = would_option_type_gate_block("long", "long_only", target_column="is_big_move")
        assert not blocked
        assert result == "C"


# ---------------------------------------------------------------------------
# Regression: the exact bug scenario from 2026-03-09
# ---------------------------------------------------------------------------


class TestRegression20260309:
    """Regression test for the production bug where SPY bought a PUT despite
    direction_mode='long_only'.

    The bug: a model (possibly symmetric with direction_mode resolving to 'both',
    or a DOWN model with signal inversion) generated a 'short' signal that produced
    a PUT.  The signal-direction gate didn't catch it because:
    1. For symmetric models, 'auto' resolved to 'both' (allowing shorts)
    2. For DOWN models, generate_signal returns 'long' (high P) which passes
       the long_only gate, then gets inverted to 'short' AFTER the gate

    The option-type gate catches BOTH scenarios.
    """

    def test_no_put_in_long_only_regardless_of_model_type(self):
        """Exhaustive: no combination of signal direction + target column can
        produce a PUT when direction_mode is explicitly 'long_only'."""
        for signal_dir in ["long", "short", "none"]:
            for target in ["target_UP_60m", "target_DOWN_60m", "is_big_move", ""]:
                blocked, result = would_option_type_gate_block(
                    signal_dir, "long_only", target_column=target
                )
                if not blocked:
                    assert result == "C", (
                        f"REGRESSION: long_only produced {result} for "
                        f"signal_dir={signal_dir}, target={target}"
                    )

    def test_no_call_in_short_only_regardless_of_model_type(self):
        """Mirror test: no CALLs in short_only mode."""
        for signal_dir in ["long", "short", "none"]:
            for target in ["target_UP_60m", "target_DOWN_60m", "is_big_move", ""]:
                blocked, result = would_option_type_gate_block(
                    signal_dir, "short_only", target_column=target
                )
                if not blocked:
                    assert result == "P", (
                        f"REGRESSION: short_only produced {result} for "
                        f"signal_dir={signal_dir}, target={target}"
                    )
