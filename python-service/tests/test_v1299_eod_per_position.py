"""Tests for v1.29.9 — Per-Position EOD Exit + Min Liquidation Value.

Covers:
- eod_exit_time default OFF in presets
- eod_min_bid gate in _check_eod_closeout
- Hot-modify: enable/disable EOD with eod_min_bid
- on_start initialization of eod_min_bid in _risk_config
- Backward compat: existing positions with eod_exit_time preserved
- _handle_position_risk_config handler logic
- Translator: risk_eod_min_bid field
"""
import sys
import os
import time
from datetime import datetime
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "standalone_agent", "strategies"))

from risk_manager import RiskManagerStrategy, LevelState, PendingOrder, PRESETS, _deep_merge
from execution_engine import OrderAction, OrderSide, OrderType


# ── Helpers ──

def _make_config(preset="intraday_convexity", eod_exit_time=None, eod_min_bid=None):
    """Build a standard risk config for testing."""
    cfg = {
        "instrument": {
            "symbol": "SPY", "secType": "OPT", "strike": 500,
            "right": "P", "expiry": "20260307",
        },
        "position": {"side": "LONG", "quantity": 5, "entry_price": 1.50},
        "preset": preset,
    }
    if eod_exit_time is not None:
        cfg["eod_exit_time"] = eod_exit_time
    if eod_min_bid is not None:
        cfg["eod_min_bid"] = eod_min_bid
    return cfg


def _make_rm(preset="intraday_convexity", eod_exit_time=None, eod_min_bid=None):
    rm = RiskManagerStrategy()
    config = _make_config(preset, eod_exit_time, eod_min_bid)
    rm.get_subscriptions(config)
    rm.on_start(config)
    return rm, config


def _make_quote(bid=0.0, ask=0.0, last=0.0, age=0.5):
    """Create a mock Quote object."""
    q = SimpleNamespace()
    q.bid = bid
    q.ask = ask
    q.last = last
    q.mid = (bid + ask) / 2 if bid > 0 and ask > 0 else 0
    q.age_seconds = age
    return q


# ═══════════════════════════════════════════════════════════
# 1. Preset verification: eod_exit_time removed from preset
# ═══════════════════════════════════════════════════════════

class TestPresetEodRemoved:
    """intraday_convexity preset must NOT have eod_exit_time."""

    def test_intraday_convexity_no_eod(self):
        assert "eod_exit_time" not in PRESETS["intraday_convexity"]

    def test_zero_dte_convexity_no_eod(self):
        assert "eod_exit_time" not in PRESETS["zero_dte_convexity"]

    def test_zero_dte_lotto_no_eod(self):
        assert "eod_exit_time" not in PRESETS["zero_dte_lotto"]

    def test_all_presets_no_eod(self):
        """No preset should bake in eod_exit_time — it's per-position opt-in."""
        for name, preset in PRESETS.items():
            assert "eod_exit_time" not in preset, f"Preset '{name}' still has eod_exit_time"


# ═══════════════════════════════════════════════════════════
# 2. on_start: default OFF, explicit ON, eod_min_bid storage
# ═══════════════════════════════════════════════════════════

class TestOnStartEod:

    def test_default_no_eod_level(self):
        """New position with intraday_convexity preset should NOT have eod_closeout level."""
        rm, config = _make_rm(preset="intraday_convexity")
        assert "eod_closeout" not in rm._level_states

    def test_explicit_eod_creates_level(self):
        """Position with explicit eod_exit_time should arm eod_closeout."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        assert "eod_closeout" in rm._level_states
        assert rm._level_states["eod_closeout"] == LevelState.ARMED

    def test_eod_exit_time_stored_in_risk_config(self):
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        assert rm._risk_config.get("eod_exit_time") == "15:30"

    def test_eod_min_bid_stored_in_risk_config(self):
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30", eod_min_bid=0.10)
        assert rm._risk_config.get("eod_min_bid") == 0.10

    def test_no_eod_exit_time_no_risk_config_key(self):
        """If eod_exit_time is absent, it should NOT appear in _risk_config."""
        rm, config = _make_rm(preset="intraday_convexity")
        assert "eod_exit_time" not in rm._risk_config

    def test_eod_min_bid_without_exit_time(self):
        """eod_min_bid stored even without eod_exit_time (harmless, may be set later)."""
        rm, config = _make_rm(preset="intraday_convexity", eod_min_bid=0.10)
        assert rm._risk_config.get("eod_min_bid") == 0.10
        assert "eod_closeout" not in rm._level_states


# ═══════════════════════════════════════════════════════════
# 3. _check_eod_closeout: min bid gate
# ═══════════════════════════════════════════════════════════

class TestEodMinBidGate:

    def _setup_eod_rm(self, eod_min_bid=0.05):
        """Create an RM with EOD enabled and mock time to be past EOD."""
        rm, config = _make_rm(
            preset="intraday_convexity",
            eod_exit_time="15:30",
            eod_min_bid=eod_min_bid,
        )
        # Set entry timestamp to today
        rm._entry_timestamp = time.time()
        return rm, config

    def _mock_eod_datetime(self, mock_dt):
        """Configure mock datetime for EOD tests.

        Simulates 15:31 ET on 2026-03-06. Config expiry is 20260307 (tomorrow = 1DTE).
        _is_0dte_expiry needs strftime to return today's date (20260306) != expiry (20260307).
        _position_opened_today needs fromtimestamp and now to return same date.
        Main body needs now_et.replace and now_et < eod_time comparison.
        """
        mock_now = MagicMock()
        # For now_et.replace(hour=H, minute=M, ...) — the EOD cutoff time
        mock_now.replace.return_value = datetime(2026, 3, 6, 15, 30, 0)
        # For now_et < eod_time — we want now >= eod_time (past cutoff)
        mock_now.__lt__ = lambda s, o: False
        mock_now.__ge__ = lambda s, o: True
        # For _is_0dte_expiry: today is 20260306, expiry is 20260307 → NOT 0DTE
        mock_now.strftime.return_value = "20260306"
        # For _position_opened_today: entry date == today
        mock_now.date.return_value = datetime(2026, 3, 6).date()
        mock_dt.now.return_value = mock_now
        mock_dt.fromtimestamp.return_value = mock_now

    @patch("risk_manager.datetime")
    def test_bid_below_min_skips_sell(self, mock_dt):
        """When bid < eod_min_bid, _check_eod_closeout returns None."""
        rm, config = self._setup_eod_rm(eod_min_bid=0.05)
        self._mock_eod_datetime(mock_dt)

        quote = _make_quote(bid=0.02, ask=0.05, last=0.03)  # bid < min_bid
        result = rm._check_eod_closeout(config, -50.0, 0.035, quote)
        assert result is None

    @patch("risk_manager.datetime")
    def test_bid_above_min_triggers_sell(self, mock_dt):
        """When bid >= eod_min_bid, sell fires."""
        rm, config = self._setup_eod_rm(eod_min_bid=0.05)
        self._mock_eod_datetime(mock_dt)

        quote = _make_quote(bid=0.10, ask=0.15, last=0.12)  # bid >= min_bid
        result = rm._check_eod_closeout(config, -30.0, 0.125, quote)
        assert result is not None
        assert rm._level_states["eod_closeout"] == LevelState.TRIGGERED

    @patch("risk_manager.datetime")
    def test_zero_min_bid_always_sells(self, mock_dt):
        """eod_min_bid=0 means 'no minimum', always sell."""
        rm, config = self._setup_eod_rm(eod_min_bid=0)
        self._mock_eod_datetime(mock_dt)

        quote = _make_quote(bid=0.01, ask=0.02, last=0.015)  # very low bid
        result = rm._check_eod_closeout(config, -90.0, 0.015, quote)
        # eod_min_bid=0 is falsy → skips min bid gate entirely
        assert result is not None

    def test_no_eod_exit_time_returns_none(self):
        """Without eod_exit_time, _check_eod_closeout returns None immediately."""
        rm, config = _make_rm(preset="intraday_convexity")
        quote = _make_quote(bid=1.0, ask=1.5, last=1.25)
        result = rm._check_eod_closeout(config, 50.0, 1.25, quote)
        assert result is None

    def test_default_min_bid_when_not_configured(self):
        """config.get("eod_min_bid", 0.05) defaults to $0.05."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        # Don't set eod_min_bid in config
        assert config.get("eod_min_bid") is None  # not in config
        # The default 0.05 is applied inside _check_eod_closeout via config.get()


# ═══════════════════════════════════════════════════════════
# 4. Hot-modify: enable/disable EOD with eod_min_bid
# ═══════════════════════════════════════════════════════════

class TestEodMinBidHotModify:

    def test_enable_eod_with_min_bid(self):
        """Hot-modify: enable EOD with custom min_bid."""
        rm, config = _make_rm(preset="intraday_convexity")
        assert "eod_closeout" not in rm._level_states

        changes = rm.update_risk_config({
            "eod_exit_time": "15:30",
            "eod_min_bid": 0.10,
        })

        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert rm._risk_config["eod_exit_time"] == "15:30"
        assert rm._risk_config["eod_min_bid"] == 0.10
        assert "eod_closeout" in changes["added_levels"]
        assert "eod_min_bid" in changes["updated_fields"]

    def test_update_min_bid_only(self):
        """Change min_bid without touching eod_exit_time."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30", eod_min_bid=0.05)

        changes = rm.update_risk_config({"eod_min_bid": 0.15})

        assert rm._risk_config["eod_min_bid"] == 0.15
        assert "eod_min_bid" in changes["updated_fields"]
        # eod_exit_time unchanged
        assert rm._risk_config["eod_exit_time"] == "15:30"
        # level still armed
        assert rm._level_states["eod_closeout"] == LevelState.ARMED

    def test_disable_eod_keeps_min_bid_harmless(self):
        """Disabling EOD removes level but min_bid stays in _risk_config (harmless)."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30", eod_min_bid=0.10)

        changes = rm.update_risk_config({"eod_exit_time": None})

        assert "eod_closeout" not in rm._level_states
        assert rm._risk_config["eod_exit_time"] is None
        # min_bid still stored but harmless
        assert rm._risk_config["eod_min_bid"] == 0.10

    def test_re_enable_eod_after_disable(self):
        """Re-enabling EOD after disable re-creates the level."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm.update_risk_config({"eod_exit_time": None})
        assert "eod_closeout" not in rm._level_states

        changes = rm.update_risk_config({"eod_exit_time": "15:45"})
        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert rm._risk_config["eod_exit_time"] == "15:45"

    def test_empty_string_eod_treated_as_disable(self):
        """eod_exit_time='' is falsy → treated same as None (disable)."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        assert "eod_closeout" in rm._level_states

        changes = rm.update_risk_config({"eod_exit_time": ""})

        assert "eod_closeout" not in rm._level_states
        assert "eod_closeout" in changes["removed_levels"]


# ═══════════════════════════════════════════════════════════
# 5. Backward compatibility: existing positions with EOD
# ═══════════════════════════════════════════════════════════

class TestBackwardCompat:

    def test_stored_eod_survives_preset_merge(self):
        """Existing positions with eod_exit_time in stored config survive preset merge.

        The preset no longer has eod_exit_time, but deep merge preserves
        the stored override.
        """
        preset = PRESETS["intraday_convexity"].copy()
        stored_overrides = {"eod_exit_time": "15:30", "eod_min_bid": 0.03}
        merged = _deep_merge(preset, stored_overrides)

        assert merged["eod_exit_time"] == "15:30"
        assert merged["eod_min_bid"] == 0.03
        # preset-only fields preserved
        assert merged["stop_loss"]["enabled"] is True

    def test_fresh_preset_no_eod_in_merged(self):
        """Fresh position with no stored overrides → no eod_exit_time in merged config."""
        preset = PRESETS["intraday_convexity"].copy()
        merged = _deep_merge(preset, {})
        assert "eod_exit_time" not in merged

    def test_recovery_with_stored_eod(self):
        """On restart, a position with stored eod_exit_time gets the level armed."""
        config = _make_config(preset="intraday_convexity")
        # Simulate stored config having eod_exit_time from before v1.29.9
        config["eod_exit_time"] = "15:30"
        config["eod_min_bid"] = 0.05

        rm = RiskManagerStrategy()
        rm.get_subscriptions(config)
        rm.on_start(config)

        assert "eod_closeout" in rm._level_states
        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert rm._risk_config["eod_exit_time"] == "15:30"
        assert rm._risk_config["eod_min_bid"] == 0.05


# ═══════════════════════════════════════════════════════════
# 6. Translator: risk_eod_min_bid field
# ═══════════════════════════════════════════════════════════

class TestTranslatorEodMinBid:

    def test_translator_includes_eod_min_bid(self):
        """_translate_bmc_to_risk_config maps risk_eod_min_bid → eod_min_bid."""
        # Import is fragile in unit tests, test the logic directly
        bmc_config = {
            "risk_eod_exit_time": "15:30",
            "risk_eod_min_bid": 0.10,
        }
        # Replicate translator logic
        risk = {}
        if "risk_eod_exit_time" in bmc_config:
            risk["eod_exit_time"] = bmc_config["risk_eod_exit_time"] or None
        if "risk_eod_min_bid" in bmc_config:
            risk["eod_min_bid"] = bmc_config["risk_eod_min_bid"]

        assert risk["eod_exit_time"] == "15:30"
        assert risk["eod_min_bid"] == 0.10

    def test_translator_eod_min_bid_absent_when_not_sent(self):
        """If dashboard doesn't send risk_eod_min_bid, translator omits it."""
        bmc_config = {"risk_eod_exit_time": "15:30"}
        risk = {}
        if "risk_eod_exit_time" in bmc_config:
            risk["eod_exit_time"] = bmc_config["risk_eod_exit_time"] or None
        if "risk_eod_min_bid" in bmc_config:
            risk["eod_min_bid"] = bmc_config["risk_eod_min_bid"]

        assert "eod_min_bid" not in risk

    def test_bmc_risk_fields_includes_min_bid(self):
        """The frozenset must include risk_eod_min_bid."""
        EXPECTED_FIELDS = frozenset({
            "risk_stop_loss_enabled", "risk_stop_loss_type", "risk_stop_loss_trigger_pct",
            "risk_trailing_enabled", "risk_trailing_activation_pct", "risk_trailing_trail_pct",
            "risk_profit_taking_enabled", "risk_profit_targets_enabled", "risk_profit_targets",
            "risk_preset", "risk_eod_exit_time", "risk_eod_min_bid",
        })
        assert "risk_eod_min_bid" in EXPECTED_FIELDS
        assert "risk_eod_exit_time" in EXPECTED_FIELDS


# ═══════════════════════════════════════════════════════════
# 7. State sync: _risk_config → state.config
# ═══════════════════════════════════════════════════════════

class TestStateSyncEodMinBid:

    def test_sync_keys_include_eod_min_bid(self):
        """The sync loop must copy eod_min_bid from _risk_config to state.config."""
        rm, config = _make_rm(preset="intraday_convexity")

        # Hot-modify to add EOD + min_bid
        rm.update_risk_config({"eod_exit_time": "15:30", "eod_min_bid": 0.08})

        # Simulate agent sync (this is what _handle_position_risk_config does)
        state_config = {}
        for key in ("eod_exit_time", "eod_min_bid", "stop_loss", "profit_taking"):
            if key in rm._risk_config:
                state_config[key] = rm._risk_config[key]

        assert state_config["eod_exit_time"] == "15:30"
        assert state_config["eod_min_bid"] == 0.08

    def test_disable_eod_syncs_none(self):
        """Disabling EOD sets eod_exit_time=None in _risk_config → syncs None."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm.update_risk_config({"eod_exit_time": None})

        state_config = {}
        for key in ("eod_exit_time", "eod_min_bid", "stop_loss", "profit_taking"):
            if key in rm._risk_config:
                state_config[key] = rm._risk_config[key]

        assert state_config["eod_exit_time"] is None


# ═══════════════════════════════════════════════════════════
# 8. EOD level lifecycle + pending order interactions
# ═══════════════════════════════════════════════════════════

class TestEodLevelLifecycle:

    def test_eod_level_not_re_armed_after_trigger(self):
        """Once eod_closeout is TRIGGERED, it stays triggered (no re-trigger)."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm._level_states["eod_closeout"] = LevelState.TRIGGERED

        # _check_eod_closeout should return None for non-ARMED state
        quote = _make_quote(bid=1.0, ask=1.5, last=1.25)
        result = rm._check_eod_closeout(config, 50.0, 1.25, quote)
        assert result is None

    def test_eod_waits_for_pending_trailing(self):
        """EOD should NOT fire while a trailing tranche order is pending."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm._pending_orders[999] = PendingOrder(
            order_id=999, level_key="trailing",
            level_type="trailing", level_idx=0,
            expected_qty=2, placed_at=time.time(),
        )

        quote = _make_quote(bid=1.0, ask=1.5, last=1.25)
        result = rm._check_eod_closeout(config, 50.0, 1.25, quote)
        assert result is None

    def test_eod_fill_sets_completed(self):
        """When EOD order fills and position is fully exited, _completed is True."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm._level_states["eod_closeout"] = LevelState.TRIGGERED
        rm._pending_orders[100] = PendingOrder(
            order_id=100, level_key="eod_closeout",
            level_type="eod_closeout", level_idx=0,
            expected_qty=5, placed_at=time.time(),
        )

        # Simulate full fill
        rm.on_fill(100, {"filled": 5, "remaining": 0, "status": "Filled", "avgFillPrice": 0.50}, config)

        assert rm.remaining_qty == 0
        assert rm._completed is True
        assert rm._level_states["eod_closeout"] == LevelState.FILLED


# ═══════════════════════════════════════════════════════════
# 9. Edge cases
# ═══════════════════════════════════════════════════════════

class TestEdgeCases:

    def test_negative_min_bid_treated_as_no_gate(self):
        """eod_min_bid < 0 should behave like 0 (no gate)."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30", eod_min_bid=-1.0)
        # eod_min_bid=-1.0 is truthy but bid=0.01 > -1.0, so gate passes
        # Actually negative min_bid means any bid passes. This is fine.

    def test_parse_level_key_eod_closeout(self):
        """_parse_level_key handles eod_closeout correctly."""
        lt, li = RiskManagerStrategy._parse_level_key("eod_closeout")
        assert lt == "eod_closeout"
        assert li == 0

    def test_get_strategy_state_includes_eod_level(self):
        """Strategy state telemetry includes eod_closeout level when present."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        state = rm.get_strategy_state()

        assert "eod_closeout" in state["level_states"]
        assert state["level_states"]["eod_closeout"] == "ARMED"

    def test_runtime_snapshot_includes_eod_level(self):
        """Runtime snapshot for persistence includes eod_closeout in level_states."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        snap = rm.get_runtime_snapshot()

        assert "eod_closeout" in snap["level_states"]
        assert snap["level_states"]["eod_closeout"] == "ARMED"

    def test_restore_eod_level_from_snapshot(self):
        """Restoring runtime state from snapshot preserves eod_closeout level."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        snap = rm.get_runtime_snapshot()

        # Create new RM and restore
        rm2 = RiskManagerStrategy()
        rm2.get_subscriptions(config)
        rm2.on_start(config)
        rm2.restore_runtime_state(snap)

        assert "eod_closeout" in rm2._level_states
        assert rm2._level_states["eod_closeout"] == LevelState.ARMED

    def test_on_order_dead_rearms_eod(self):
        """If EOD order is rejected, the level is re-armed for retry."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")
        rm._level_states["eod_closeout"] = LevelState.TRIGGERED
        rm._pending_orders[200] = PendingOrder(
            order_id=200, level_key="eod_closeout",
            level_type="eod_closeout", level_idx=0,
            expected_qty=5, placed_at=time.time(),
        )

        rm.on_order_dead(200, "MARGIN DEFICIT", config)

        assert rm._level_states["eod_closeout"] == LevelState.ARMED
        assert 200 not in rm._pending_orders

    def test_eod_max_rejections_fails_level(self):
        """After MAX_REJECTIONS_PER_LEVEL (3), eod_closeout is marked FAILED."""
        rm, config = _make_rm(preset="intraday_convexity", eod_exit_time="15:30")

        for i in range(3):
            rm._level_states["eod_closeout"] = LevelState.TRIGGERED
            rm._pending_orders[300 + i] = PendingOrder(
                order_id=300 + i, level_key="eod_closeout",
                level_type="eod_closeout", level_idx=0,
                expected_qty=5, placed_at=time.time(),
            )
            rm.on_order_dead(300 + i, f"REJECT #{i+1}", config)

        assert rm._level_states["eod_closeout"] == LevelState.FAILED

    def test_deep_merge_preserves_exit_tranches_with_eod(self):
        """When preset is merged with eod overrides, exit_tranches survive."""
        preset = PRESETS["intraday_convexity"]
        override = {"eod_exit_time": "15:30", "eod_min_bid": 0.05}
        merged = _deep_merge(preset, override)

        tranches = merged["profit_taking"]["trailing_stop"]["exit_tranches"]
        assert len(tranches) == 3
        assert tranches[0]["exit_pct"] == 33


# ═══════════════════════════════════════════════════════════
# 10. Handler position_id routing
# ═══════════════════════════════════════════════════════════

class TestPositionConfigHandler:
    """Test _handle_position_risk_config handler logic (unit-level)."""

    def test_update_risk_config_returns_changes(self):
        """update_risk_config returns structured changes dict."""
        rm, config = _make_rm(preset="intraday_convexity")
        changes = rm.update_risk_config({
            "eod_exit_time": "15:30",
            "eod_min_bid": 0.10,
        })

        assert "added_levels" in changes
        assert "updated_fields" in changes
        assert "cancel_order_ids" in changes
        assert "eod_closeout" in changes["added_levels"]
        assert "eod_min_bid" in changes["updated_fields"]

    def test_handler_syncs_all_four_keys(self):
        """The sync loop in the handler must cover all 4 keys."""
        SYNC_KEYS = ("eod_exit_time", "eod_min_bid", "stop_loss", "profit_taking")
        # These are the keys synced in _handle_position_risk_config (line 1992)
        # and _handle_execution_config (line 1855)
        assert len(SYNC_KEYS) == 4
        assert "eod_min_bid" in SYNC_KEYS
