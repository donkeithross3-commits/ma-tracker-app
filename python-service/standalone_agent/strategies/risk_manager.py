#!/usr/bin/env python3
"""
Risk Manager Strategy
=====================
A position guardian that monitors a live position and automatically
exits portions of it when stop-loss or profit-taking thresholds are hit.

Works with stocks, options, and futures. Supports:
- Simple stop loss (close all at threshold)
- Laddered stop loss (exit percentages at stepped thresholds)
- Profit targets (bank percentages at stepped thresholds)
- Trailing stop (trail remaining position from high water mark)
- Zero-day options mode (no stop, aggressive profit taking)

Config schema:
    See PRESETS dict and the RiskManagerStrategy docstring for full details.
"""

import logging
import time
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from execution_engine import ExecutionStrategy, OrderAction, OrderSide, OrderType

logger = logging.getLogger(__name__)


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base*.

    - Dict values are merged recursively (preserving keys only in base).
    - Non-dict values in *override* replace those in *base*.
    - Neither input is mutated; returns a new dict.

    Used so that preset resolution keeps nested fields like
    ``exit_tranches`` even when the override only sets ``trail_pct``.
    """
    result = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


# ── Tick sizes for common futures (used for limit order price rounding) ──
# Stocks/options default to 0.01 if not found.
TICK_SIZES: Dict[str, float] = {
    # Metals (COMEX)
    "SI": 0.005, "SIL": 0.005,
    "GC": 0.10,  "MGC": 0.10,
    "HG": 0.0005,
    "PL": 0.10,  "PA": 0.10,
    # Indices (CME)
    "ES": 0.25,  "MES": 0.25,
    "NQ": 0.25,  "MNQ": 0.25,
    "YM": 1.0,   "MYM": 1.0,
    "RTY": 0.10, "M2K": 0.10,
    # Energy (NYMEX)
    "CL": 0.01,  "MCL": 0.01,
    "NG": 0.001,
    "RB": 0.0001, "HO": 0.0001,
    # Treasuries (CBOT)
    "ZB": 1 / 32, "ZN": 1 / 64, "ZF": 1 / 128, "ZT": 1 / 128,
    # Grains (CBOT)
    "ZC": 0.25, "ZS": 0.25, "ZW": 0.25,
    # FX (CME)
    "6E": 0.00005, "6J": 0.0000005, "6B": 0.0001, "6A": 0.0001,
}


def _round_to_tick(price: float, tick_size: float) -> float:
    """Round a price to the nearest valid tick increment."""
    if tick_size <= 0:
        return round(price, 2)
    return round(round(price / tick_size) * tick_size, 10)


# ── Level state machine ──

class LevelState(Enum):
    ARMED = "ARMED"           # Waiting for trigger condition
    TRIGGERED = "TRIGGERED"   # Order submitted, waiting for fill
    PARTIAL = "PARTIAL"       # Partially filled, still waiting
    FILLED = "FILLED"         # Fully filled, done
    FAILED = "FAILED"         # Permanently failed (e.g. repeated rejections)


class LevelType(Enum):
    STOP = "stop"
    PROFIT = "profit"
    TRAILING = "trailing"


class PendingOrder:
    """Tracks a pending order for a specific level.

    ``level_key`` stores the canonical key used in ``_level_states``
    (e.g. ``"stop_simple"``, ``"stop_0"``, ``"trailing"``, ``"eod_closeout"``).
    This eliminates the parse/reconstruct round-trip that previously caused
    ``"stop_simple"`` -> ``("stop_simple", 0)`` -> ``"stop_simple_0"`` mismatch.
    """
    __slots__ = ("order_id", "level_key", "level_type", "level_idx",
                 "expected_qty", "filled_so_far", "placed_at")

    def __init__(self, order_id: int, level_key: str, level_type: str,
                 level_idx: int, expected_qty: int, placed_at: float):
        self.order_id = order_id
        self.level_key = level_key
        self.level_type = level_type
        self.level_idx = level_idx
        self.expected_qty = expected_qty
        self.filled_so_far = 0.0
        self.placed_at = placed_at


class LotTrailingState:
    """Per-lot trailing stop state."""
    __slots__ = ("lot_idx", "entry_price", "remaining_qty",
                 "high_water_mark", "trailing_stop_price",
                 "trailing_active", "trailing_tranche_idx",
                 "trailing_tranche_pending", "trail_pct", "activation_pct")

    def __init__(self, lot_idx: int, entry_price: float, quantity: int,
                 trail_pct: float = 0.0, activation_pct: float = 0.0):
        self.lot_idx = lot_idx
        self.entry_price = entry_price
        self.remaining_qty = quantity
        self.high_water_mark = entry_price
        self.trailing_stop_price = 0.0
        self.trailing_active = False
        self.trailing_tranche_idx = 0
        self.trailing_tranche_pending = False
        # Per-lot overrides (0 = use base config)
        self.trail_pct = trail_pct
        self.activation_pct = activation_pct

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}

    @classmethod
    def from_dict(cls, d: dict) -> "LotTrailingState":
        obj = cls(d["lot_idx"], d["entry_price"], d["remaining_qty"],
                  d.get("trail_pct", 0.0), d.get("activation_pct", 0.0))
        obj.high_water_mark = d.get("high_water_mark", obj.entry_price)
        obj.trailing_stop_price = d.get("trailing_stop_price", 0.0)
        obj.trailing_active = d.get("trailing_active", False)
        obj.trailing_tranche_idx = d.get("trailing_tranche_idx", 0)
        obj.trailing_tranche_pending = d.get("trailing_tranche_pending", False)
        return obj


# ── Presets ──

PRESETS = {
    "zero_dte_lotto": {
        "stop_loss": {"enabled": False, "type": "none"},
        "profit_taking": {
            "enabled": True,
            "targets": [
                {"trigger_pct": 100, "exit_pct": 20},
                {"trigger_pct": 300, "exit_pct": 25},
                {"trigger_pct": 500, "exit_pct": 25},
                {"trigger_pct": 1000, "exit_pct": 50},
            ],
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 50,
                "trail_pct": 25,
                "exit_tranches": [
                    {"exit_pct": 50, "trail_pct": 20},
                    {"exit_pct": 100},
                ],
            },
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
    },
    "zero_dte_convexity": {
        "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -80.0},  # sweep v1.17.2: 80% SL beats hold-to-expiry (PF 1.86 vs 1.09)
        "profit_taking": {
            "enabled": True,
            "targets": [],  # exit sweep: ladders hurt P&L by cutting fat-tail winners
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 50,   # sweep v1.17.2: PF 1.86 @ 50% vs 1.09 @ 25%
                "trail_pct": 30,        # 30% below peak (sweep: wider initial trail + tight tranches)
                "exit_tranches": [
                    {"exit_pct": 33, "trail_pct": 8},    # 1st trigger: sell 33%, tighten to 8% (was 12%)
                    {"exit_pct": 50, "trail_pct": 5},     # 2nd trigger: sell 50% of remaining, tighten to 5% (was 10%)
                    {"exit_pct": 100},                     # 3rd trigger: sell everything left
                ],
            },
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
    },
    "intraday_convexity": {
        # For 1DTE options: exit same-day before close. Tighter stop than 0DTE
        # (higher capital at risk from time value), lower trailing activation
        # (1DTE moves less explosively than 0DTE gamma), mandatory EOD close-out.
        "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -60.0},
        "profit_taking": {
            "enabled": True,
            "targets": [],  # no ladders — trailing tranches handle scale-out
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 40,   # lower than 0DTE (1DTE moves less explosively)
                "trail_pct": 25,        # tighter trail (less gamma = smaller swings)
                "exit_tranches": [
                    {"exit_pct": 33, "trail_pct": 8},
                    {"exit_pct": 50, "trail_pct": 5},
                    {"exit_pct": 100},
                ],
            },
        },
        # eod_exit_time: OFF by default — user opts in per-position via dashboard
        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
    },
    "intraday_premium": {
        # For higher-priced intraday options ($1-$10) where capital at risk matters.
        # Tighter stop than zero_dte_convexity, earlier trailing activation,
        # and a profit ladder to bank gains progressively.
        "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -40.0},
        "profit_taking": {
            "enabled": True,
            "targets": [
                {"trigger_pct": 50, "exit_pct": 25},     # bank 25% at +50%
                {"trigger_pct": 150, "exit_pct": 25},    # bank 25% more at +150%
            ],
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 20,   # trailing engages at +20% (vs 50% for lotto)
                "trail_pct": 20,        # 20% below peak initially
                "exit_tranches": [
                    {"exit_pct": 33, "trail_pct": 10},   # 1st trigger: sell 33%, tighten to 10%
                    {"exit_pct": 50, "trail_pct": 6},    # 2nd trigger: sell 50%, tighten to 6%
                    {"exit_pct": 100},                     # 3rd trigger: sell everything
                ],
            },
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
    },
    "stock_swing": {
        "stop_loss": {"enabled": True, "type": "simple", "trigger_pct": -5.0},
        "profit_taking": {
            "enabled": True,
            "targets": [{"trigger_pct": 10, "exit_pct": 50}],
            "trailing_stop": {"enabled": True, "activation_pct": 5, "trail_pct": 3},
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "LMT", "limit_offset_ticks": 1},
    },
    "conservative": {
        "stop_loss": {
            "enabled": True, "type": "laddered",
            "ladders": [
                {"trigger_pct": -2, "exit_pct": 33},
                {"trigger_pct": -4, "exit_pct": 50},
                {"trigger_pct": -6, "exit_pct": 100},
            ],
        },
        "profit_taking": {
            "enabled": True,
            "targets": [
                {"trigger_pct": 5, "exit_pct": 50},
                {"trigger_pct": 10, "exit_pct": 100},
            ],
            "trailing_stop": {"enabled": False},
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "LMT", "limit_offset_ticks": 1},
    },
}


class RiskManagerStrategy(ExecutionStrategy):
    """Position guardian strategy.

    Monitors a position (single or aggregated multi-lot) and exits portions
    when stop-loss or profit-taking thresholds are hit.

    Supports lot aggregation: when BMC buys multiple 1-lot positions in the
    same contract, they are aggregated into a single risk manager via add_lot()
    rather than spawning independent managers. This ensures:
    - One trailing stop for the aggregate position (not 10 competing ones)
    - Single sell order of N lots instead of N separate 1-lot sells
    - Correct weighted average entry price

    Config keys:
        instrument: dict with IB contract fields (symbol, secType, etc.)
        position: {side: LONG|SHORT, quantity: int, entry_price: float}
        stop_loss: {enabled, type: simple|laddered|none, trigger_pct, ladders: [...]}
        profit_taking: {enabled, targets: [...], trailing_stop: {enabled, activation_pct, trail_pct}}
        execution: {stop_order_type, profit_order_type, limit_offset_ticks}
    """

    # Freshness threshold -- skip eval if quote is older than this
    STALE_QUOTE_SEC = 5.0
    # How long before we warn about a TRIGGERED order with no update
    PENDING_ORDER_WARN_SEC = 30.0
    # Max consecutive rejections before marking level as FAILED
    MAX_REJECTIONS_PER_LEVEL = 3

    def __init__(self):
        # ── State (initialized in on_start) ──
        self.remaining_qty: int = 0
        self.initial_qty: int = 0       # peak remaining (backward-compat for P&L% display)
        self.lifetime_opened_qty: int = 0  # monotonic total contracts ever added (audit only)
        self.entry_price: float = 0.0
        self.is_long: bool = True
        self.cache_key: str = ""
        self.contract_dict: dict = {}

        # High water mark for trailing stop
        self.high_water_mark: float = 0.0

        # Level states: "stop_0", "stop_1", "profit_0", "trailing" -> LevelState
        self._level_states: Dict[str, LevelState] = {}

        # Pending orders: order_id -> PendingOrder
        self._pending_orders: Dict[int, PendingOrder] = {}

        # Fill log for audit/telemetry
        self._fill_log: List[dict] = []

        # Trailing stop state
        self._trailing_stop_price: float = 0.0
        self._trailing_active: bool = False

        # Strategy completion flag
        self._completed: bool = False

        # Rejection counter: level_key -> consecutive rejection count
        self._rejection_counts: Dict[str, int] = {}

        # Lot tracking for aggregate positions (multiple fills same contract)
        self._lot_entries: List[dict] = []

        # Trailing stop tranche state (for multi-step scale-out)
        self._trailing_tranche_idx: int = 0         # which tranche we're on
        self._trailing_tranche_pending: bool = False  # True while waiting for tranche fill

        # Per-lot trailing stop mode ("uniform" or "per_lot")
        self._trailing_mode: str = "uniform"
        # Per-lot trailing state: lot_idx -> LotTrailingState
        self._per_lot_trailing: Dict[int, LotTrailingState] = {}

        # Snapshot of risk-related config for hot-modify comparison
        self._risk_config: dict = {}

        # EOD close-out: timestamp when position was opened (for same-day detection)
        self._entry_timestamp: float = 0.0

    # ── ExecutionStrategy interface ──

    def get_subscriptions(self, config: dict) -> List[dict]:
        """Subscribe to the instrument being managed."""
        instrument = config.get("instrument", {})
        symbol = instrument.get("symbol", "")
        sec_type = instrument.get("secType", "STK")

        # Build cache key
        if sec_type == "OPT":
            self.cache_key = (
                f"{symbol}:{instrument.get('strike', 0)}:"
                f"{instrument.get('expiry', '')}:{instrument.get('right', '')}"
            )
        elif sec_type == "FUT":
            self.cache_key = f"{symbol}:{instrument.get('expiry', '')}:FUT"
        else:
            self.cache_key = symbol

        # Build contract dict for IB
        self.contract_dict = {
            "symbol": symbol,
            "secType": sec_type,
            "exchange": instrument.get("exchange", "SMART"),
            "currency": instrument.get("currency", "USD"),
        }
        if instrument.get("expiry"):
            self.contract_dict["lastTradeDateOrContractMonth"] = instrument["expiry"]
        if instrument.get("strike"):
            self.contract_dict["strike"] = float(instrument["strike"])
        if instrument.get("right"):
            self.contract_dict["right"] = instrument["right"]
        if instrument.get("multiplier"):
            self.contract_dict["multiplier"] = instrument["multiplier"]

        # Generic ticks: 100=optionVolume, 101=optionOI, 104=historicalVol, 106=optionImpliedVol
        generic_ticks = "100,101,104,106" if sec_type == "OPT" else "100,101"

        return [{
            "cache_key": self.cache_key,
            "contract": self.contract_dict,
            "generic_ticks": generic_ticks,
        }]

    def on_start(self, config: dict):
        """Initialize state from config."""
        # Resolve named presets (e.g. "zero_dte_convexity") into full config.
        # Deep merge so nested fields like exit_tranches survive partial overrides.
        preset_name = config.get("preset")
        if preset_name and preset_name in PRESETS:
            merged = _deep_merge(PRESETS[preset_name], {k: v for k, v in config.items() if k != "preset"})
            merged["preset"] = preset_name  # preserve preset name for hot-modify
            config.clear()
            config.update(merged)

        # ── Repair corrupt stored configs (v1.29.3 and earlier) ──
        # Hot-modify used to strip exit_tranches and preset from stored configs.
        # If trailing is enabled but exit_tranches are missing, repair from the
        # default preset (intraday_convexity). This is a one-time migration that
        # fires on restore of corrupt position store data.
        ts = config.get("profit_taking", {}).get("trailing_stop", {})
        if ts.get("enabled") and "exit_tranches" not in ts and not preset_name:
            repair_preset = "intraday_convexity"
            logger.warning(
                "RiskManager: trailing_stop missing exit_tranches and no preset — "
                "repairing from '%s' preset", repair_preset,
            )
            merged = _deep_merge(PRESETS[repair_preset], config)
            merged["preset"] = repair_preset
            config.clear()
            config.update(merged)

        pos = config.get("position", {})
        self.initial_qty = int(pos.get("quantity", 0))
        self.remaining_qty = self.initial_qty
        self.lifetime_opened_qty = self.initial_qty
        self.entry_price = float(pos.get("entry_price", 0))
        self.is_long = pos.get("side", "LONG").upper() == "LONG"

        # Initialize first lot entry (overwritten by restore_runtime_state if recovering)
        self._lot_entries = [{
            "order_id": pos.get("order_id", 0),
            "entry_price": self.entry_price,
            "quantity": self.initial_qty,
            "fill_time": pos.get("fill_time", time.time()),
            "perm_id": pos.get("perm_id", 0),
        }]

        # Initialize level states
        self._level_states.clear()
        self._pending_orders.clear()
        self._fill_log.clear()
        self._rejection_counts.clear()
        self._completed = False
        self.high_water_mark = self.entry_price
        self._trailing_stop_price = 0.0
        self._trailing_active = False
        self._trailing_tranche_idx = 0
        self._trailing_tranche_pending = False
        self._entry_timestamp = pos.get("fill_time", time.time())

        stop_cfg = config.get("stop_loss", {})
        if stop_cfg.get("enabled") and stop_cfg.get("type") == "laddered":
            for i, _ in enumerate(stop_cfg.get("ladders", [])):
                self._level_states[f"stop_{i}"] = LevelState.ARMED
        elif stop_cfg.get("enabled") and stop_cfg.get("type") == "simple":
            self._level_states["stop_simple"] = LevelState.ARMED

        profit_cfg = config.get("profit_taking", {})
        if profit_cfg.get("enabled"):
            for i, _ in enumerate(profit_cfg.get("targets", [])):
                self._level_states[f"profit_{i}"] = LevelState.ARMED
            trail = profit_cfg.get("trailing_stop", {})
            if trail.get("enabled"):
                self._level_states["trailing"] = LevelState.ARMED

        # Per-lot trailing mode
        trail_cfg = profit_cfg.get("trailing_stop", {})
        self._trailing_mode = trail_cfg.get("mode", "uniform")
        if self._trailing_mode == "per_lot" and trail_cfg.get("enabled"):
            overrides = trail_cfg.get("per_lot_overrides", {})
            lot_override = overrides.get("0", overrides.get(0, {}))
            self._per_lot_trailing[0] = LotTrailingState(
                0, pos.get("entry_price", 0), pos.get("quantity", 1),
                lot_override.get("trail_pct", 0.0),
                lot_override.get("activation_pct", 0.0),
            )
            self._level_states["trailing_lot_0"] = LevelState.ARMED

        # EOD close-out level (armed from start if eod_exit_time is configured)
        if config.get("eod_exit_time"):
            self._level_states["eod_closeout"] = LevelState.ARMED

        # Snapshot risk config for hot-modify comparison
        self._risk_config = {
            "stop_loss": config.get("stop_loss", {}),
            "profit_taking": config.get("profit_taking", {}),
        }
        # EOD fields live in _risk_config for hot-modify (not in nested stop/profit dicts)
        if config.get("eod_exit_time"):
            self._risk_config["eod_exit_time"] = config["eod_exit_time"]
        if "eod_min_bid" in config:
            self._risk_config["eod_min_bid"] = config["eod_min_bid"]

        logger.info(
            "RiskManager started: %s %s %d @ %.4f, levels=%s",
            "LONG" if self.is_long else "SHORT",
            self.cache_key, self.initial_qty, self.entry_price,
            list(self._level_states.keys()),
        )

    def on_stop(self, config: dict):
        """Clean up on strategy unload."""
        logger.info("RiskManager stopped for %s (remaining_qty=%d, fills=%d)",
                     self.cache_key, self.remaining_qty, len(self._fill_log))

    # ── Lot aggregation ──

    def add_lot(self, entry_price: float, quantity: int, order_id: int = 0,
                fill_time: float = 0.0, perm_id: int = 0) -> None:
        """Aggregate a new lot into this risk manager.

        Called when BMC buys another lot of the same contract that this
        manager is already guarding. Recomputes weighted average entry
        against REMAINING (open) contracts, not lifetime total.

        Trailing activation state is preserved (sticky). The HWM and
        trail price are price-based, not P&L-based, so adding a lot
        only affects the P&L% display — not the actual stop behavior.

        Position Semantics V2 (risk hardening):
        - Cost basis averaged against remaining_qty (open inventory only)
        - lifetime_opened_qty tracks monotonic total (audit only)
        - initial_qty tracks peak remaining for backward compat

        Args:
            entry_price: Fill price of the new lot.
            quantity: Number of contracts in the new lot.
            order_id: IB order ID for the new lot.
            fill_time: Timestamp of the fill (defaults to now).
            perm_id: IB permanent order ID.
        """
        old_remaining = self.remaining_qty
        old_avg = self.entry_price

        # Cost basis: weighted average against REMAINING (open) contracts
        new_remaining = old_remaining + quantity
        if new_remaining > 0:
            self.entry_price = (old_avg * old_remaining + entry_price * quantity) / new_remaining

        self.remaining_qty = new_remaining
        self.lifetime_opened_qty += quantity
        # initial_qty tracks peak remaining for backward compat (P&L% display)
        self.initial_qty = max(self.initial_qty, self.remaining_qty)

        # Track individual lot for audit/dashboard
        self._lot_entries.append({
            "order_id": order_id,
            "entry_price": entry_price,
            "quantity": quantity,
            "fill_time": fill_time or time.time(),
            "perm_id": perm_id,
        })

        # Per-lot trailing: create state for new lot
        if self._trailing_mode == "per_lot":
            lot_idx = len(self._lot_entries) - 1
            self._per_lot_trailing[lot_idx] = LotTrailingState(
                lot_idx, entry_price, quantity,
            )
            level_key = f"trailing_lot_{lot_idx}"
            if level_key not in self._level_states:
                self._level_states[level_key] = LevelState.ARMED
            logger.info("Per-lot trailing: created state for lot %d (entry=%.4f, qty=%d)",
                        lot_idx, entry_price, quantity)

        logger.info(
            "RiskManager add_lot: %s now %d lots (%d qty) @ avg %.4f "
            "(added %d @ %.4f, order=%d)",
            self.cache_key, len(self._lot_entries), self.initial_qty,
            self.entry_price, quantity, entry_price, order_id,
        )

    def evaluate(self, quotes: Dict[str, "Quote"], config: dict) -> List[OrderAction]:
        """Main evaluation: check stops, profits, trailing stop."""
        if self._completed or self.remaining_qty <= 0:
            return []

        # Warn about stale pending orders (engine handles actual cancellation)
        now = time.time()
        for oid, pending in list(self._pending_orders.items()):
            age = now - pending.placed_at
            if age > self.PENDING_ORDER_WARN_SEC:
                logger.warning("RiskManager: pending order %d for level %s is %.0fs old",
                               oid, pending.level_key, age)

        quote = quotes.get(self.cache_key)
        if quote is None:
            return []

        # Freshness gate
        if quote.age_seconds > self.STALE_QUOTE_SEC:
            return []

        # Get current price
        sec_type = config.get("instrument", {}).get("secType", "STK")
        if sec_type == "OPT":
            current_price = quote.mid if (quote.bid > 0 and quote.ask > 0) else quote.last
        else:
            current_price = quote.last

        if current_price <= 0:
            return []

        # Calculate P&L percentage
        if self.entry_price <= 0:
            return []
        if self.is_long:
            pnl_pct = (current_price - self.entry_price) / self.entry_price * 100.0
        else:
            pnl_pct = (self.entry_price - current_price) / self.entry_price * 100.0

        # Update high water mark
        if self.is_long:
            self.high_water_mark = max(self.high_water_mark, current_price)
        else:
            # For shorts, "high water" means lowest price (best for short)
            if self.high_water_mark == 0 or current_price < self.high_water_mark:
                self.high_water_mark = current_price

        actions = []

        # ── Stop loss check ──
        stop_action = self._check_stop_loss(config, pnl_pct, current_price, quote)
        if stop_action:
            actions.append(stop_action)
            return actions  # Only one level per tick

        # ── Profit taking check ──
        profit_action = self._check_profit_targets(config, pnl_pct, current_price, quote)
        if profit_action:
            actions.append(profit_action)
            return actions  # Only one level per tick

        # ── Trailing stop check ──
        trail_action = self._check_trailing_stop(config, pnl_pct, current_price, quote)
        if trail_action:
            actions.append(trail_action)
            return actions

        # ── EOD close-out check (1DTE same-day exit) ──
        eod_action = self._check_eod_closeout(config, pnl_pct, current_price, quote)
        if eod_action:
            actions.append(eod_action)
            return actions

        return actions

    def on_fill(self, order_id: int, fill_data: dict, config: dict):
        """Handle fill notification from execution engine."""
        pending = self._pending_orders.get(order_id)
        if not pending:
            logger.warning("RiskManager on_fill: unknown order_id=%d", order_id)
            return

        new_filled = fill_data.get("filled", 0.0) - pending.filled_so_far
        if new_filled <= 0:
            # Duplicate or no new fill
            return

        pending.filled_so_far = fill_data.get("filled", 0.0)
        filled_delta = int(round(new_filled))
        self.remaining_qty = max(0, self.remaining_qty - filled_delta)

        level_key = pending.level_key

        fill_entry = {
            "time": time.time(),
            "order_id": order_id,
            "level": level_key,
            "qty_filled": filled_delta,
            "avg_price": fill_data.get("avgFillPrice", 0),
            "remaining_qty": self.remaining_qty,
            "pnl_pct": self._calc_pnl_pct(fill_data.get("avgFillPrice", 0)),
        }
        # Tag trailing fills with tranche index for audit
        if pending.level_type == "trailing":
            if self._trailing_mode == "per_lot" and pending.level_key.startswith("trailing_lot_"):
                lot_idx_str = pending.level_key.rsplit("_", 1)[-1]
                lot_st = self._per_lot_trailing.get(int(lot_idx_str) if lot_idx_str.isdigit() else -1)
                fill_entry["tranche_idx"] = lot_st.trailing_tranche_idx if lot_st else 0
                fill_entry["lot_idx"] = int(lot_idx_str) if lot_idx_str.isdigit() else -1
            else:
                fill_entry["tranche_idx"] = self._trailing_tranche_idx
        self._fill_log.append(fill_entry)

        status = fill_data.get("status", "")
        remaining_on_order = fill_data.get("remaining", 1)

        if status == "Filled" or remaining_on_order == 0:
            self._pending_orders.pop(order_id, None)
            self._rejection_counts.pop(level_key, None)  # reset on success

            # ── Trailing tranche advancement ──
            if pending.level_type == "trailing":
                # Determine if this is a per-lot or uniform trailing fill
                is_per_lot_fill = (
                    self._trailing_mode == "per_lot"
                    and pending.level_key.startswith("trailing_lot_")
                )

                if is_per_lot_fill:
                    # Per-lot: route to the specific lot's state
                    lot_idx_str = pending.level_key.rsplit("_", 1)[-1]
                    lot_idx = int(lot_idx_str) if lot_idx_str.isdigit() else -1
                    lot_state = self._per_lot_trailing.get(lot_idx)
                    if lot_state:
                        lot_state.remaining_qty = max(0, lot_state.remaining_qty - filled_delta)
                        lot_state.trailing_tranche_pending = False

                        if lot_state.remaining_qty <= 0:
                            self._level_states[pending.level_key] = LevelState.FILLED
                            logger.info("Per-lot trailing: lot %d fully exited for %s",
                                        lot_idx, self.cache_key)
                        else:
                            config_trail = config.get("profit_taking", {}).get("trailing_stop", {})
                            tranches = config_trail.get("exit_tranches")
                            next_idx = lot_state.trailing_tranche_idx + 1
                            if tranches and next_idx < len(tranches):
                                lot_state.trailing_tranche_idx = next_idx
                                next_tranche = tranches[next_idx]
                                next_trail_pct = next_tranche.get("trail_pct",
                                    lot_state.trail_pct or config_trail.get("trail_pct", 10.0))
                                if self.is_long:
                                    lot_state.trailing_stop_price = lot_state.high_water_mark * (1.0 - next_trail_pct / 100.0)
                                else:
                                    lot_state.trailing_stop_price = lot_state.high_water_mark * (1.0 + next_trail_pct / 100.0)
                                self._level_states[pending.level_key] = LevelState.ARMED
                                logger.info(
                                    "Per-lot trailing: lot %d tranche %d->%d (trail=%.1f%%, stop=%.4f, remaining=%d)",
                                    lot_idx, lot_state.trailing_tranche_idx - 1, lot_state.trailing_tranche_idx,
                                    next_trail_pct, lot_state.trailing_stop_price, lot_state.remaining_qty,
                                )
                            else:
                                self._level_states[pending.level_key] = LevelState.FILLED
                                logger.info("Per-lot trailing: lot %d final tranche filled", lot_idx)
                elif self._trailing_tranche_pending:
                    # Uniform mode: existing tranche handling
                    self._trailing_tranche_pending = False

                    if self.remaining_qty <= 0:
                        # Position fully exited
                        self._level_states[level_key] = LevelState.FILLED
                        self._completed = True
                        logger.info("RiskManager: position fully exited for %s (trailing tranche %d)",
                                    self.cache_key, self._trailing_tranche_idx)
                        return

                    # Check if more tranches remain
                    config_trail = config.get("profit_taking", {}).get("trailing_stop", {})
                    tranches = config_trail.get("exit_tranches")
                    next_idx = self._trailing_tranche_idx + 1

                    if tranches and next_idx < len(tranches):
                        # Advance to next tranche: tighter trail, re-arm
                        self._trailing_tranche_idx = next_idx
                        next_tranche = tranches[next_idx]
                        next_trail_pct = next_tranche.get("trail_pct", config_trail.get("trail_pct", 10.0))

                        # Recompute trail price from HWM with tighter percentage
                        if self.is_long:
                            self._trailing_stop_price = self.high_water_mark * (1.0 - next_trail_pct / 100.0)
                        else:
                            self._trailing_stop_price = self.high_water_mark * (1.0 + next_trail_pct / 100.0)

                        self._level_states[level_key] = LevelState.ARMED
                        logger.info(
                            "RiskManager trailing tranche %d/%d filled, advancing to tranche %d "
                            "(trail_pct=%.1f%%, new trail=%.4f, remaining=%d)",
                            self._trailing_tranche_idx - 1, len(tranches),
                            self._trailing_tranche_idx, next_trail_pct,
                            self._trailing_stop_price, self.remaining_qty,
                        )
                    else:
                        # Last tranche (or no tranches) — done
                        self._level_states[level_key] = LevelState.FILLED
                        logger.info("RiskManager level %s FILLED (final tranche, remaining_qty=%d)",
                                    level_key, self.remaining_qty)
                else:
                    self._level_states[level_key] = LevelState.FILLED
                    logger.info("RiskManager level %s FILLED (remaining_qty=%d)", level_key, self.remaining_qty)
            else:
                self._level_states[level_key] = LevelState.FILLED
                logger.info("RiskManager level %s FILLED (remaining_qty=%d)", level_key, self.remaining_qty)
        else:
            self._level_states[level_key] = LevelState.PARTIAL
            logger.info("RiskManager level %s PARTIAL fill (remaining_qty=%d)", level_key, self.remaining_qty)

        # Check if position is fully exited (covers non-trailing fills too)
        if self.remaining_qty <= 0:
            self._completed = True
            logger.info("RiskManager: position fully exited for %s", self.cache_key)

    def on_order_placed(self, order_id: int, result: dict, config: dict):
        """Map the real order_id to the TRIGGERED level that produced it."""
        # Find the level that is TRIGGERED but has no pending order yet
        for level_key, state in self._level_states.items():
            if state != LevelState.TRIGGERED:
                continue
            # Check if this level already has a pending order
            already_pending = any(
                p.level_key == level_key
                for p in self._pending_orders.values()
            )
            if not already_pending:
                lt, li = self._parse_level_key(level_key)
                # Compute expected qty from the level config
                expected_qty = int(result.get("remaining", 0)) + int(result.get("filled", 0))
                if expected_qty <= 0:
                    expected_qty = self.remaining_qty  # fallback
                self._pending_orders[order_id] = PendingOrder(
                    order_id=order_id,
                    level_key=level_key,
                    level_type=lt,
                    level_idx=li,
                    expected_qty=expected_qty,
                    placed_at=time.time(),
                )
                logger.info("RiskManager mapped order %d to level %s", order_id, level_key)
                return

        logger.warning("RiskManager on_order_placed: no unmapped TRIGGERED level for order %d", order_id)

    @staticmethod
    def _parse_level_key(key: str):
        """Parse 'stop_0' -> ('stop', 0), 'trailing' -> ('trailing', 0),
        'trailing_lot_3' -> ('trailing', 3)."""
        if key == "trailing":
            return ("trailing", 0)
        # Per-lot trailing keys: "trailing_lot_N" -> ("trailing", N)
        if key.startswith("trailing_lot_"):
            lot_str = key.rsplit("_", 1)[-1]
            return ("trailing", int(lot_str) if lot_str.isdigit() else 0)
        parts = key.rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            return (parts[0], int(parts[1]))
        return (key, 0)

    def on_order_dead(self, order_id, reason: str, config: dict):
        """Handle order death (cancelled, rejected, Inactive) -- re-arm the level.

        order_id=None means the engine dropped the order before it reached IB
        (e.g. inflight cap). Find the first orphaned TRIGGERED level and re-arm it.
        """
        if order_id is None:
            # Inflight cap or similar -- find first TRIGGERED level with no pending order
            for lk, ls in self._level_states.items():
                if ls == LevelState.TRIGGERED:
                    has_pending = any(
                        p.level_key == lk
                        for p in self._pending_orders.values()
                    )
                    if not has_pending:
                        self._level_states[lk] = LevelState.ARMED
                        logger.warning("Re-armed orphaned TRIGGERED level %s: %s", lk, reason)
                        return
            return

        pending = self._pending_orders.pop(order_id, None)
        if not pending:
            return

        level_key = pending.level_key

        # Track consecutive rejections per level
        count = self._rejection_counts.get(level_key, 0) + 1
        self._rejection_counts[level_key] = count

        # Clear tranche pending flag on trailing order death (retry same tranche)
        if pending.level_type == "trailing":
            if self._trailing_mode == "per_lot" and pending.level_key.startswith("trailing_lot_"):
                lot_idx_str = pending.level_key.rsplit("_", 1)[-1]
                lot_idx = int(lot_idx_str) if lot_idx_str.isdigit() else -1
                lot_st = self._per_lot_trailing.get(lot_idx)
                if lot_st:
                    lot_st.trailing_tranche_pending = False
            else:
                self._trailing_tranche_pending = False

        if count >= self.MAX_REJECTIONS_PER_LEVEL:
            self._level_states[level_key] = LevelState.FAILED
            logger.error("RiskManager level %s FAILED after %d consecutive rejections: %s",
                         level_key, count, reason)
        else:
            self._level_states[level_key] = LevelState.ARMED
            logger.warning("RiskManager order %d dead for level %s (attempt %d/%d): %s -- re-arming",
                           order_id, level_key, count, self.MAX_REJECTIONS_PER_LEVEL, reason)

    def get_strategy_state(self) -> dict:
        """Return rich state for telemetry/dashboard display."""
        return {
            "remaining_qty": self.remaining_qty,
            "initial_qty": self.initial_qty,
            "lifetime_opened_qty": self.lifetime_opened_qty,
            "entry_price": self.entry_price,
            "high_water_mark": self.high_water_mark,
            "is_long": self.is_long,
            "cache_key": self.cache_key,
            "completed": self._completed,
            "trailing_stop_price": self._trailing_stop_price,
            "trailing_active": self._trailing_active,
            "level_states": {k: v.value for k, v in self._level_states.items()},
            "pending_orders": {
                str(oid): {
                    "level": p.level_key,
                    "expected_qty": p.expected_qty,
                    "filled_so_far": p.filled_so_far,
                    "placed_at": p.placed_at,
                }
                for oid, p in self._pending_orders.items()
            },
            "fill_log": self._fill_log[-20:],  # last 20 fills
            "lot_entries": self._lot_entries,
            "total_lots": len(self._lot_entries),
            "trailing_tranche_idx": self._trailing_tranche_idx,
            "trailing_tranche_pending": self._trailing_tranche_pending,
            "trailing_mode": self._trailing_mode,
            "per_lot_trailing": {
                str(k): v.to_dict() for k, v in self._per_lot_trailing.items()
            } if self._per_lot_trailing else None,
            "entry_timestamp": self._entry_timestamp,
        }

    # ── Persistence helpers ──

    def get_runtime_snapshot(self) -> dict:
        """Serialize mutable runtime state for position store persistence."""
        return {
            "remaining_qty": self.remaining_qty,
            "initial_qty": self.initial_qty,
            "lifetime_opened_qty": self.lifetime_opened_qty,
            "entry_price": self.entry_price,
            "high_water_mark": self.high_water_mark,
            "trailing_active": self._trailing_active,
            "trailing_stop_price": self._trailing_stop_price,
            "level_states": {k: v.value for k, v in self._level_states.items()},
            "completed": self._completed,
            "lot_entries": self._lot_entries,
            "trailing_tranche_idx": self._trailing_tranche_idx,
            "trailing_tranche_pending": self._trailing_tranche_pending,
            "trailing_mode": self._trailing_mode,
            "per_lot_trailing": {
                str(k): v.to_dict() for k, v in self._per_lot_trailing.items()
            } if self._per_lot_trailing else None,
            "entry_timestamp": self._entry_timestamp,
        }

    def restore_runtime_state(self, state: dict) -> None:
        """Hydrate runtime state from persisted snapshot after on_start.

        TRIGGERED levels are reset to ARMED because IB orders from the
        previous session are dead — the risk manager will re-evaluate
        and re-submit on the next tick.
        """
        self.remaining_qty = int(state.get("remaining_qty", self.remaining_qty))
        self.initial_qty = int(state.get("initial_qty", self.initial_qty))
        # Backward compat: pre-V2 snapshots won't have lifetime_opened_qty
        self.lifetime_opened_qty = int(state.get("lifetime_opened_qty", self.initial_qty))
        self.entry_price = float(state.get("entry_price", self.entry_price))
        self.high_water_mark = float(state.get("high_water_mark", self.high_water_mark))
        self._trailing_active = bool(state.get("trailing_active", self._trailing_active))
        self._trailing_stop_price = float(state.get("trailing_stop_price", self._trailing_stop_price))
        self._completed = bool(state.get("completed", self._completed))

        # Restore trailing tranche state
        self._trailing_tranche_idx = int(state.get("trailing_tranche_idx", 0))
        self._trailing_tranche_pending = False  # pending orders are dead after restart

        # Restore per-lot trailing mode
        self._trailing_mode = state.get("trailing_mode", "uniform")
        persisted_per_lot = state.get("per_lot_trailing")
        if persisted_per_lot:
            self._per_lot_trailing = {
                int(k): LotTrailingState.from_dict(v)
                for k, v in persisted_per_lot.items()
            }
            # Re-arm per-lot level states and reset pending on restart
            for lot_idx in self._per_lot_trailing:
                level_key = f"trailing_lot_{lot_idx}"
                if level_key not in self._level_states:
                    self._level_states[level_key] = LevelState.ARMED
                self._per_lot_trailing[lot_idx].trailing_tranche_pending = False

        # Restore entry timestamp (for EOD close-out same-day detection)
        if state.get("entry_timestamp"):
            self._entry_timestamp = float(state["entry_timestamp"])

        # Restore lot entries (overrides the single-entry default from on_start)
        persisted_lots = state.get("lot_entries")
        if persisted_lots:
            self._lot_entries = list(persisted_lots)

        persisted_levels = state.get("level_states", {})
        for key, value in persisted_levels.items():
            if key in self._level_states:
                try:
                    ls = LevelState(value)
                    # TRIGGERED/PARTIAL → ARMED: old orders are dead after restart
                    if ls in (LevelState.TRIGGERED, LevelState.PARTIAL):
                        ls = LevelState.ARMED
                    self._level_states[key] = ls
                except ValueError:
                    pass  # unknown state string, keep the on_start default

        logger.info(
            "RiskManager restored: remaining=%d/%d @ %.4f, hwm=%.4f, "
            "trailing=%s, tranche_idx=%d, lots=%d, levels=%s",
            self.remaining_qty, self.initial_qty, self.entry_price,
            self.high_water_mark, self._trailing_active,
            self._trailing_tranche_idx, len(self._lot_entries),
            {k: v.value for k, v in self._level_states.items()},
        )

    # ── Hot-modify (called from eval thread via execution engine) ──

    def update_risk_config(self, new_config: dict) -> dict:
        """Hot-modify risk parameters on a running risk manager.

        Called from the eval thread context — no lock needed since evaluate()
        and update_risk_config() both run on the eval thread.

        If new_config contains a "preset" key, the named preset is resolved
        first and its fields are used as defaults (explicit fields in
        new_config still override the preset).

        Returns dict with {updated_fields, added_levels, removed_levels,
        skipped_levels, cancel_order_ids}.
        cancel_order_ids contains order IDs for pending orders tied to
        disabled/invalidated levels that should be cancelled immediately.
        """
        # Resolve preset name into concrete config fields.
        # Deep merge so nested fields like exit_tranches survive partial overrides.
        preset_name = new_config.get("preset")
        if preset_name and preset_name in PRESETS:
            override = {k: v for k, v in new_config.items() if k != "preset"}
            new_config = _deep_merge(PRESETS[preset_name], override)
            logger.info("Resolved preset '%s' in hot-modify", preset_name)

        # Initialize changes dict early — eod_exit_time block may populate cancel_order_ids
        changes = {
            "updated_fields": [], "added_levels": [], "removed_levels": [],
            "skipped_levels": [], "cancel_order_ids": [],
        }

        # Apply eod_exit_time if present in new_config
        if "eod_exit_time" in new_config:
            new_eod = new_config["eod_exit_time"]
            old_eod = self._risk_config.get("eod_exit_time")
            self._risk_config["eod_exit_time"] = new_eod
            if new_eod and "eod_closeout" not in self._level_states:
                self._level_states["eod_closeout"] = LevelState.ARMED
                changes["added_levels"].append("eod_closeout")
                logger.info("Hot-modify: enabled eod_closeout level (exit_time=%s)", new_eod)
            elif not new_eod and "eod_closeout" in self._level_states:
                state = self._level_states.get("eod_closeout")
                if state in (LevelState.ARMED, LevelState.TRIGGERED):
                    # Cancel any pending EOD order before removing the level
                    self._collect_cancel_ids("eod_closeout", changes["cancel_order_ids"])
                    del self._level_states["eod_closeout"]
                    changes["removed_levels"].append("eod_closeout")
                    logger.info("Hot-modify: disabled eod_closeout level")

        # Apply eod_min_bid if present in new_config
        if "eod_min_bid" in new_config:
            self._risk_config["eod_min_bid"] = new_config["eod_min_bid"]
            changes["updated_fields"].append("eod_min_bid")

        # --- Stop Loss ---
        old_sl = self._risk_config.get("stop_loss", {})
        new_sl = new_config.get("stop_loss", old_sl)
        if new_sl != old_sl:
            changes["updated_fields"].append("stop_loss")
            if new_sl.get("enabled") and not old_sl.get("enabled"):
                # Enabling stop loss — add level(s)
                if new_sl.get("type") == "laddered":
                    for i, _ in enumerate(new_sl.get("ladders", [])):
                        key = f"stop_{i}"
                        if key not in self._level_states:
                            self._level_states[key] = LevelState.ARMED
                            changes["added_levels"].append(key)
                else:
                    # Simple stop
                    if "stop_simple" not in self._level_states:
                        self._level_states["stop_simple"] = LevelState.ARMED
                        changes["added_levels"].append("stop_simple")
            elif not new_sl.get("enabled") and old_sl.get("enabled"):
                # Disabling stop loss — remove ARMED levels and cancel TRIGGERED orders
                for key in list(self._level_states):
                    if key.startswith("stop_"):
                        if self._level_states[key] in (LevelState.ARMED, LevelState.TRIGGERED):
                            # Cancel any pending order for this level
                            self._collect_cancel_ids(key, changes["cancel_order_ids"])
                            del self._level_states[key]
                            changes["removed_levels"].append(key)
                        else:
                            changes["skipped_levels"].append(key)

        # --- Profit Taking ---
        old_pt = self._risk_config.get("profit_taking", {})
        new_pt = new_config.get("profit_taking", old_pt)
        if new_pt != old_pt:
            changes["updated_fields"].append("profit_taking")
            if new_pt.get("enabled") and not old_pt.get("enabled"):
                for i, _ in enumerate(new_pt.get("targets", [])):
                    key = f"profit_{i}"
                    if key not in self._level_states:
                        self._level_states[key] = LevelState.ARMED
                        changes["added_levels"].append(key)
            elif not new_pt.get("enabled") and old_pt.get("enabled"):
                for key in list(self._level_states):
                    if key.startswith("profit_"):
                        if self._level_states[key] in (LevelState.ARMED, LevelState.TRIGGERED):
                            self._collect_cancel_ids(key, changes["cancel_order_ids"])
                            del self._level_states[key]
                            changes["removed_levels"].append(key)
                        else:
                            changes["skipped_levels"].append(key)

        # --- Trailing Stop (activation_pct, trail_pct, exit_tranches) ---
        old_ts = old_pt.get("trailing_stop", {})
        new_ts = new_pt.get("trailing_stop", old_ts)
        if new_ts != old_ts:
            changes["updated_fields"].append("trailing_stop")
            if new_ts.get("enabled") and not old_ts.get("enabled"):
                if "trailing" not in self._level_states:
                    self._level_states["trailing"] = LevelState.ARMED
                    changes["added_levels"].append("trailing")
            elif not new_ts.get("enabled") and old_ts.get("enabled"):
                trail_state = self._level_states.get("trailing")
                if trail_state in (LevelState.ARMED, LevelState.TRIGGERED):
                    self._collect_cancel_ids("trailing", changes["cancel_order_ids"])
                    del self._level_states["trailing"]
                    changes["removed_levels"].append("trailing")
                    self._trailing_active = False
                    self._trailing_stop_price = 0.0
                elif "trailing" in self._level_states:
                    changes["skipped_levels"].append("trailing")
            # If trail_pct changed and trailing IS active, recalculate trail price from HWM
            if self._trailing_active and new_ts.get("trail_pct") != old_ts.get("trail_pct"):
                new_trail_pct = new_ts["trail_pct"]
                # Determine effective trail_pct (may be tightened by current tranche)
                tranches = new_ts.get("exit_tranches", [])
                if tranches and self._trailing_tranche_idx < len(tranches):
                    new_trail_pct = tranches[self._trailing_tranche_idx].get("trail_pct", new_trail_pct)
                if self.is_long:
                    self._trailing_stop_price = self.high_water_mark * (1 - new_trail_pct / 100)
                else:
                    self._trailing_stop_price = self.high_water_mark * (1 + new_trail_pct / 100)
                changes["updated_fields"].append("trailing_stop_price_recalc")

            # Mode switching: uniform <-> per_lot
            new_mode = new_ts.get("mode", old_ts.get("mode", "uniform"))
            old_mode = self._trailing_mode
            if new_mode != old_mode:
                self._trailing_mode = new_mode
                changes["updated_fields"].append(f"trailing_mode_{old_mode}_to_{new_mode}")
                if new_mode == "per_lot" and not self._per_lot_trailing:
                    # Initialize per-lot state from existing lots
                    overrides = new_ts.get("per_lot_overrides", {})
                    for i, lot in enumerate(self._lot_entries):
                        lot_override = overrides.get(str(i), overrides.get(i, {}))
                        self._per_lot_trailing[i] = LotTrailingState(
                            i, lot["entry_price"], lot["quantity"],
                            lot_override.get("trail_pct", 0.0),
                            lot_override.get("activation_pct", 0.0),
                        )
                        # Seed HWM from current aggregate HWM
                        self._per_lot_trailing[i].high_water_mark = self.high_water_mark
                        level_key = f"trailing_lot_{i}"
                        if level_key not in self._level_states:
                            self._level_states[level_key] = LevelState.ARMED
                    # Remove uniform trailing level
                    if "trailing" in self._level_states and self._level_states["trailing"] == LevelState.ARMED:
                        del self._level_states["trailing"]
                    logger.info("Switched to per-lot trailing: %d lots initialized", len(self._per_lot_trailing))
                elif new_mode == "uniform" and self._per_lot_trailing:
                    # Collapse back: use max HWM from all lots
                    if self._per_lot_trailing:
                        self.high_water_mark = max(s.high_water_mark for s in self._per_lot_trailing.values())
                        # Check if any lot was activated
                        self._trailing_active = any(s.trailing_active for s in self._per_lot_trailing.values())
                    # Remove per-lot level states
                    for lot_idx in list(self._per_lot_trailing.keys()):
                        level_key = f"trailing_lot_{lot_idx}"
                        self._level_states.pop(level_key, None)
                    self._per_lot_trailing.clear()
                    # Ensure uniform trailing level exists
                    if "trailing" not in self._level_states:
                        self._level_states["trailing"] = LevelState.ARMED
                    logger.info("Switched to uniform trailing: hwm=%.4f, active=%s",
                                self.high_water_mark, self._trailing_active)

            # Per-lot override updates (when already in per_lot mode)
            if self._trailing_mode == "per_lot":
                base_trail_pct = new_ts.get("trail_pct", 10.0)
                new_overrides = new_ts.get("per_lot_overrides", {})
                for lot_key, override in new_overrides.items():
                    lot_idx = int(lot_key) if str(lot_key).isdigit() else -1
                    lot_state = self._per_lot_trailing.get(lot_idx)
                    if lot_state:
                        if "trail_pct" in override:
                            old_trail = lot_state.trail_pct
                            lot_state.trail_pct = override["trail_pct"]
                            # Recalc trail price if active
                            if lot_state.trailing_active and old_trail != lot_state.trail_pct:
                                effective_pct = lot_state.trail_pct or base_trail_pct
                                if self.is_long:
                                    lot_state.trailing_stop_price = lot_state.high_water_mark * (1 - effective_pct / 100)
                                else:
                                    lot_state.trailing_stop_price = lot_state.high_water_mark * (1 + effective_pct / 100)
                        if "activation_pct" in override:
                            lot_state.activation_pct = override["activation_pct"]
                        changes["updated_fields"].append(f"per_lot_override_{lot_idx}")

        # --- Merge new config into _risk_config ---
        for key in ("stop_loss", "profit_taking"):
            if key in new_config:
                self._risk_config[key] = new_config[key]

        return changes

    def _collect_cancel_ids(self, level_key: str, cancel_list: list) -> None:
        """Find pending order IDs associated with a level and add to cancel list."""
        for oid, po in list(self._pending_orders.items()):
            if po.level_key == level_key:
                cancel_list.append(oid)
                # Remove from pending orders — the cancel callback will handle cleanup
                del self._pending_orders[oid]
                logger.info("Queued cancel for order %d (level %s disabled)", oid, level_key)

    # ── Internal helpers ──

    def _calc_pnl_pct(self, price: float) -> float:
        if self.entry_price <= 0 or price <= 0:
            return 0.0
        if self.is_long:
            return (price - self.entry_price) / self.entry_price * 100.0
        return (self.entry_price - price) / self.entry_price * 100.0

    def _exit_side(self) -> OrderSide:
        """Return the order side to close the position."""
        return OrderSide.SELL if self.is_long else OrderSide.BUY

    def _compute_exit_qty(self, exit_pct: float, is_last_level: bool = False) -> int:
        """Compute quantity to exit based on exit_pct of remaining_qty."""
        if is_last_level or exit_pct >= 100:
            return self.remaining_qty
        qty = max(1, round(self.remaining_qty * exit_pct / 100.0))
        # If computed qty equals remaining, close everything (no dust)
        if qty >= self.remaining_qty:
            return self.remaining_qty
        return qty

    # Hard floor: never algorithmically sell options at or below this price.
    # At $0.01-$0.05 premiums, commissions exceed or match proceeds — you're
    # literally paying to give away free optionality.  Let them expire worthless.
    MIN_SELL_PREMIUM = 0.06

    def _make_order_action(self, qty: int, order_type_str: str, current_price: float,
                           quote, config: dict, reason: str) -> Optional[OrderAction]:
        """Build an OrderAction with the right order type and limit offset.

        Returns None if the exit would sell premium at or below MIN_SELL_PREMIUM
        (commissions would exceed proceeds — better to let expire).
        """
        # ── Minimum premium gate (all exit types) ──
        if self.is_long and quote:
            bid = getattr(quote, "bid", 0) or 0
            if 0 < bid <= self.MIN_SELL_PREMIUM:
                now_ts = time.time()
                if now_ts - getattr(self, "_min_premium_log_ts", 0) >= 60:
                    logger.info(
                        "Exit blocked: bid $%.2f <= min sell premium $%.2f — "
                        "letting expire. reason=%s, remaining=%d",
                        bid, self.MIN_SELL_PREMIUM, reason, self.remaining_qty,
                    )
                    self._min_premium_log_ts = now_ts
                return None

        exec_cfg = config.get("execution", {})
        symbol = config.get("instrument", {}).get("symbol", "")
        tick_size = TICK_SIZES.get(symbol, 0.01)

        if order_type_str == "LMT":
            ot = OrderType.LIMIT
            # Place limit slightly aggressive (near-side of spread)
            offset_ticks = exec_cfg.get("limit_offset_ticks", 1)
            if self.is_long:
                # Selling: limit at bid + offset (slightly above bid)
                raw = (quote.bid + offset_ticks * tick_size) if quote.bid > 0 else current_price
                limit_price = max(tick_size, _round_to_tick(raw, tick_size))
            else:
                # Buying to cover: limit at ask - offset
                raw = (quote.ask - offset_ticks * tick_size) if quote.ask > 0 else current_price
                limit_price = max(tick_size, _round_to_tick(raw, tick_size))
        else:
            ot = OrderType.MARKET
            limit_price = None

        return OrderAction(
            strategy_id="",  # filled by engine
            side=self._exit_side(),
            order_type=ot,
            quantity=qty,
            contract_dict=self.contract_dict,
            limit_price=limit_price,
            tif="DAY",
            outside_rth=bool(exec_cfg.get("outside_rth", False)),
            reason=reason,
            is_exit=True,  # EXIT orders bypass entry budget
        )


    def _check_stop_loss(self, config: dict, pnl_pct: float,
                         current_price: float, quote) -> Optional[OrderAction]:
        """Check stop loss conditions. Returns an OrderAction or None."""
        stop_cfg = config.get("stop_loss", {})
        if not stop_cfg.get("enabled"):
            return None

        exec_cfg = config.get("execution", {})
        stop_order_type = exec_cfg.get("stop_order_type", "MKT")
        stop_type = stop_cfg.get("type", "none")

        if stop_type == "simple":
            key = "stop_simple"
            if self._level_states.get(key) != LevelState.ARMED:
                return None
            trigger = stop_cfg.get("trigger_pct", -10.0)
            if pnl_pct <= trigger:
                qty = self.remaining_qty
                action = self._make_order_action(
                    qty, stop_order_type, current_price, quote, config,
                    f"Simple stop: pnl={pnl_pct:.1f}% <= {trigger}%"
                )
                if action is None:
                    return None  # min premium gate — don't mark triggered, retry next tick
                self._level_states[key] = LevelState.TRIGGERED
                logger.info("RiskManager STOP SIMPLE triggered: pnl=%.1f%% qty=%d", pnl_pct, qty)
                return action

        elif stop_type == "laddered":
            ladders = stop_cfg.get("ladders", [])
            for i, ladder in enumerate(ladders):
                key = f"stop_{i}"
                if self._level_states.get(key) != LevelState.ARMED:
                    continue
                trigger = ladder.get("trigger_pct", -10.0)
                if pnl_pct <= trigger:
                    is_last = (i == len(ladders) - 1) or ladder.get("exit_pct", 0) >= 100
                    qty = self._compute_exit_qty(ladder.get("exit_pct", 100), is_last)
                    action = self._make_order_action(
                        qty, stop_order_type, current_price, quote, config,
                        f"Ladder stop #{i}: pnl={pnl_pct:.1f}% <= {trigger}%, exit {ladder.get('exit_pct')}%"
                    )
                    if action is None:
                        return None  # min premium gate — retry next tick
                    self._level_states[key] = LevelState.TRIGGERED
                    logger.info("RiskManager STOP LADDER %d triggered: pnl=%.1f%% qty=%d", i, pnl_pct, qty)
                    return action  # Only one level per tick

        return None

    def _check_profit_targets(self, config: dict, pnl_pct: float,
                              current_price: float, quote) -> Optional[OrderAction]:
        """Check profit taking targets. Returns an OrderAction or None."""
        profit_cfg = config.get("profit_taking", {})
        if not profit_cfg.get("enabled"):
            return None

        exec_cfg = config.get("execution", {})
        profit_order_type = exec_cfg.get("profit_order_type", "LMT")
        targets = profit_cfg.get("targets", [])

        for i, target in enumerate(targets):
            key = f"profit_{i}"
            if self._level_states.get(key) != LevelState.ARMED:
                continue
            trigger = target.get("trigger_pct", 10.0)
            if pnl_pct >= trigger:
                is_last = (i == len(targets) - 1) or target.get("exit_pct", 0) >= 100
                qty = self._compute_exit_qty(target.get("exit_pct", 25), is_last)
                action = self._make_order_action(
                    qty, profit_order_type, current_price, quote, config,
                    f"Profit target #{i}: pnl={pnl_pct:.1f}% >= {trigger}%, exit {target.get('exit_pct')}%"
                )
                if action is None:
                    return None  # min premium gate — retry next tick
                self._level_states[key] = LevelState.TRIGGERED
                logger.info("RiskManager PROFIT %d triggered: pnl=%.1f%% qty=%d", i, pnl_pct, qty)
                return action  # Only one level per tick

        return None

    def _check_trailing_stop(self, config: dict, pnl_pct: float,
                             current_price: float, quote) -> Optional[OrderAction]:
        """Check trailing stop. Returns an OrderAction or None.

        Supports optional exit_tranches for progressive scale-out:
        each trigger exits a percentage and tightens the trail for the
        next tranche. Without tranches, exits 100% (backward compatible).
        """
        profit_cfg = config.get("profit_taking", {})
        trail_cfg = profit_cfg.get("trailing_stop", {})
        if not trail_cfg.get("enabled"):
            return None

        # Per-lot mode delegates to separate method
        if self._trailing_mode == "per_lot":
            return self._check_trailing_stop_per_lot(config, current_price, quote)

        key = "trailing"
        if self._level_states.get(key) != LevelState.ARMED:
            return None

        activation_pct = trail_cfg.get("activation_pct", 0)
        base_trail_pct = trail_cfg.get("trail_pct", 10.0)

        # Resolve effective trail_pct from current tranche (or base for backward compat)
        tranches = trail_cfg.get("exit_tranches")
        if tranches and self._trailing_tranche_idx < len(tranches):
            tranche = tranches[self._trailing_tranche_idx]
            trail_pct = tranche.get("trail_pct", base_trail_pct)
        else:
            trail_pct = base_trail_pct
            tranche = None

        # Check activation
        if not self._trailing_active:
            if pnl_pct >= activation_pct:
                self._trailing_active = True
                logger.info("RiskManager trailing stop ACTIVATED at pnl=%.1f%%", pnl_pct)
            else:
                return None

        # Update trailing stop price
        if self.is_long:
            new_trail = self.high_water_mark * (1.0 - trail_pct / 100.0)
            if new_trail > self._trailing_stop_price:
                self._trailing_stop_price = new_trail
            # Check trigger
            if current_price <= self._trailing_stop_price:
                # Determine exit qty from tranche config
                if tranche is not None:
                    exit_pct = tranche.get("exit_pct", 100)
                    is_last = (self._trailing_tranche_idx >= len(tranches) - 1)
                    qty = self._compute_exit_qty(exit_pct, is_last)
                    total_tranches = len(tranches)
                else:
                    qty = self.remaining_qty
                    total_tranches = 0

                exec_cfg = config.get("execution", {})
                if total_tranches > 0:
                    reason = (
                        f"Trailing stop tranche {self._trailing_tranche_idx}/{total_tranches}: "
                        f"exit {tranche.get('exit_pct', 100)}%, trail={trail_pct}%, "
                        f"price={current_price:.4f} <= trail={self._trailing_stop_price:.4f} "
                        f"(hwm={self.high_water_mark:.4f})"
                    )
                else:
                    reason = (
                        f"Trailing stop: price={current_price:.4f} <= trail={self._trailing_stop_price:.4f} "
                        f"(hwm={self.high_water_mark:.4f}, trail_pct={trail_pct}%)"
                    )

                action = self._make_order_action(
                    qty, exec_cfg.get("stop_order_type", "MKT"),
                    current_price, quote, config, reason,
                )
                if action is None:
                    return None  # min premium gate — retry next tick
                self._level_states[key] = LevelState.TRIGGERED
                self._trailing_tranche_pending = True
                logger.info("RiskManager TRAILING STOP triggered (tranche %d): price=%.4f trail=%.4f qty=%d",
                            self._trailing_tranche_idx, current_price, self._trailing_stop_price, qty)
                return action
        else:
            # Short: trailing stop goes up from low water mark
            new_trail = self.high_water_mark * (1.0 + trail_pct / 100.0)
            if self._trailing_stop_price == 0 or new_trail < self._trailing_stop_price:
                self._trailing_stop_price = new_trail
            if current_price >= self._trailing_stop_price:
                # Determine exit qty from tranche config
                if tranche is not None:
                    exit_pct = tranche.get("exit_pct", 100)
                    is_last = (self._trailing_tranche_idx >= len(tranches) - 1)
                    qty = self._compute_exit_qty(exit_pct, is_last)
                    total_tranches = len(tranches)
                else:
                    qty = self.remaining_qty
                    total_tranches = 0

                exec_cfg = config.get("execution", {})
                if total_tranches > 0:
                    reason = (
                        f"Trailing stop tranche {self._trailing_tranche_idx}/{total_tranches} (short): "
                        f"exit {tranche.get('exit_pct', 100)}%, trail={trail_pct}%, "
                        f"price={current_price:.4f} >= trail={self._trailing_stop_price:.4f} "
                        f"(hwm={self.high_water_mark:.4f})"
                    )
                else:
                    reason = (
                        f"Trailing stop (short): price={current_price:.4f} >= trail={self._trailing_stop_price:.4f}"
                    )

                action = self._make_order_action(
                    qty, exec_cfg.get("stop_order_type", "MKT"),
                    current_price, quote, config, reason,
                )
                if action is None:
                    return None  # min premium gate — retry next tick
                self._level_states[key] = LevelState.TRIGGERED
                self._trailing_tranche_pending = True
                logger.info("RiskManager TRAILING STOP (short) triggered (tranche %d): price=%.4f trail=%.4f qty=%d",
                            self._trailing_tranche_idx, current_price, self._trailing_stop_price, qty)
                return action

        return None

    def _check_trailing_stop_per_lot(self, config: dict,
                                      current_price: float, quote) -> Optional[OrderAction]:
        """Per-lot trailing stop evaluation. Each lot tracked independently."""
        profit_cfg = config.get("profit_taking", {})
        trail_cfg = profit_cfg.get("trailing_stop", {})
        if not trail_cfg.get("enabled"):
            return None

        base_activation_pct = trail_cfg.get("activation_pct", 0)
        base_trail_pct = trail_cfg.get("trail_pct", 10.0)
        base_tranches = trail_cfg.get("exit_tranches")

        for lot_idx, lot_state in sorted(self._per_lot_trailing.items()):
            if lot_state.remaining_qty <= 0:
                continue
            if lot_state.trailing_tranche_pending:
                continue

            level_key = f"trailing_lot_{lot_idx}"
            if self._level_states.get(level_key) != LevelState.ARMED:
                continue

            # Per-lot overrides or base config
            activation_pct = lot_state.activation_pct or base_activation_pct
            trail_pct = lot_state.trail_pct or base_trail_pct

            # Resolve effective trail_pct from current tranche
            if base_tranches and lot_state.trailing_tranche_idx < len(base_tranches):
                tranche = base_tranches[lot_state.trailing_tranche_idx]
                trail_pct = tranche.get("trail_pct", trail_pct)
            else:
                tranche = None

            # Per-lot P&L%
            if lot_state.entry_price <= 0:
                continue
            if self.is_long:
                lot_pnl_pct = (current_price - lot_state.entry_price) / lot_state.entry_price * 100.0
            else:
                lot_pnl_pct = (lot_state.entry_price - current_price) / lot_state.entry_price * 100.0

            # Update per-lot HWM
            if self.is_long:
                lot_state.high_water_mark = max(lot_state.high_water_mark, current_price)
            else:
                if lot_state.high_water_mark == 0 or current_price < lot_state.high_water_mark:
                    lot_state.high_water_mark = current_price

            # Check activation
            if not lot_state.trailing_active:
                if lot_pnl_pct >= activation_pct:
                    lot_state.trailing_active = True
                    logger.info("Per-lot trailing ACTIVATED: lot %d at pnl=%.1f%% (entry=%.4f)",
                                lot_idx, lot_pnl_pct, lot_state.entry_price)
                else:
                    continue

            # Update trailing stop price
            if self.is_long:
                new_trail = lot_state.high_water_mark * (1.0 - trail_pct / 100.0)
                if new_trail > lot_state.trailing_stop_price:
                    lot_state.trailing_stop_price = new_trail
                triggered = current_price <= lot_state.trailing_stop_price
            else:
                new_trail = lot_state.high_water_mark * (1.0 + trail_pct / 100.0)
                if lot_state.trailing_stop_price == 0 or new_trail < lot_state.trailing_stop_price:
                    lot_state.trailing_stop_price = new_trail
                triggered = current_price >= lot_state.trailing_stop_price

            if triggered:
                # Determine qty from tranche or full lot
                if tranche is not None:
                    exit_pct = tranche.get("exit_pct", 100)
                    is_last = (lot_state.trailing_tranche_idx >= len(base_tranches) - 1)
                    if is_last or exit_pct >= 100:
                        qty = lot_state.remaining_qty
                    else:
                        qty = max(1, round(lot_state.remaining_qty * exit_pct / 100.0))
                        if qty >= lot_state.remaining_qty:
                            qty = lot_state.remaining_qty
                    total_tranches = len(base_tranches)
                else:
                    qty = lot_state.remaining_qty
                    total_tranches = 0

                exec_cfg = config.get("execution", {})
                direction = "below" if self.is_long else "above"
                reason = (
                    f"Per-lot trailing stop (lot {lot_idx}): "
                    f"price={current_price:.4f} {direction} trail={lot_state.trailing_stop_price:.4f} "
                    f"(hwm={lot_state.high_water_mark:.4f}, entry={lot_state.entry_price:.4f}, "
                    f"trail_pct={trail_pct}%)"
                )

                action = self._make_order_action(
                    qty, exec_cfg.get("stop_order_type", "MKT"),
                    current_price, quote, config, reason,
                )
                if action is None:
                    continue  # min premium gate — try next lot or retry next tick
                self._level_states[level_key] = LevelState.TRIGGERED
                lot_state.trailing_tranche_pending = True
                logger.info("Per-lot TRAILING STOP triggered: lot %d, price=%.4f trail=%.4f qty=%d",
                            lot_idx, current_price, lot_state.trailing_stop_price, qty)
                return action  # One lot per tick

        return None

    def _check_eod_closeout(self, config: dict, pnl_pct: float,
                            current_price: float, quote) -> Optional[OrderAction]:
        """Check if position should be force-closed before end of day.

        Only applies to non-0DTE positions that were opened today.
        0DTE positions expire naturally — no EOD exit needed.

        Returns an OrderAction to exit the full remaining position, or None.
        """
        eod_exit_time = config.get("eod_exit_time")
        if not eod_exit_time:
            return None

        # Only apply to non-0DTE (positions that don't expire today)
        if self._is_0dte_expiry(config):
            return None

        # Only close positions opened today (don't force-close recovered overnight positions)
        if not self._position_opened_today():
            return None

        # Wait for in-flight exits (trailing/stop) to complete before EOD fires
        # Prevents over-sell when trailing tranche is pending at EOD boundary
        if self._pending_orders:
            return None

        # Check if we've already triggered an EOD level
        key = "eod_closeout"
        if key in self._level_states and self._level_states[key] != LevelState.ARMED:
            return None

        # Parse eod_exit_time (HH:MM ET)
        now_et = datetime.now(ZoneInfo("America/New_York"))
        try:
            parts = eod_exit_time.split(":")
            eod_hour, eod_minute = int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            return None

        eod_time = now_et.replace(hour=eod_hour, minute=eod_minute, second=0, microsecond=0)
        if now_et < eod_time:
            return None

        # Arm the level if not present (first time we reach EOD window)
        if key not in self._level_states:
            self._level_states[key] = LevelState.ARMED

        # Min bid gate: don't sell worthless options where transaction costs exceed proceeds
        eod_min_bid = config.get("eod_min_bid", 0.05)
        if eod_min_bid and quote:
            bid = getattr(quote, "bid", 0) or 0
            if bid < eod_min_bid:
                # Log once per minute (eval runs every 100ms — avoid 18k lines)
                now_ts = time.time()
                if now_ts - getattr(self, "_eod_skip_log_ts", 0) >= 60:
                    logger.info(
                        "EOD closeout skipped: bid %.4f < min_bid %.4f — letting expire",
                        bid, eod_min_bid,
                    )
                    self._eod_skip_log_ts = now_ts
                return None  # Don't sell — lotto value, let expire

        # Exit 100% at market
        qty = self.remaining_qty
        exec_cfg = config.get("execution", {})
        reason = (
            f"EOD close-out: {eod_exit_time} ET, pnl={pnl_pct:.1f}%, "
            f"price={current_price:.4f}, remaining={qty}"
        )
        action = self._make_order_action(
            qty, exec_cfg.get("stop_order_type", "MKT"),
            current_price, quote, config, reason,
        )
        if action is None:
            return None  # min premium gate — letting expire
        self._level_states[key] = LevelState.TRIGGERED
        logger.info("RiskManager EOD CLOSEOUT triggered: %s", reason)
        return action

    def _is_0dte_expiry(self, config: dict) -> bool:
        """Check if the managed contract expires today (0DTE)."""
        expiry_str = config.get("instrument", {}).get("expiry", "")
        if not expiry_str:
            return False
        try:
            today_et = datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")
            return expiry_str == today_et
        except (ValueError, TypeError):
            return False

    def _position_opened_today(self) -> bool:
        """Check if the position was opened today (ET)."""
        if self._entry_timestamp <= 0:
            return False
        entry_date = datetime.fromtimestamp(
            self._entry_timestamp, tz=ZoneInfo("America/New_York")
        ).date()
        today = datetime.now(ZoneInfo("America/New_York")).date()
        return entry_date == today
