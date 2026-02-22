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
from enum import Enum
from typing import Dict, List, Optional

from execution_engine import ExecutionStrategy, OrderAction, OrderSide, OrderType

logger = logging.getLogger(__name__)


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


class LevelType(Enum):
    STOP = "stop"
    PROFIT = "profit"
    TRAILING = "trailing"


class PendingOrder:
    """Tracks a pending order for a specific level."""
    __slots__ = ("order_id", "level_type", "level_idx", "expected_qty",
                 "filled_so_far", "placed_at")

    def __init__(self, order_id: int, level_type: str, level_idx: int,
                 expected_qty: int, placed_at: float):
        self.order_id = order_id
        self.level_type = level_type
        self.level_idx = level_idx
        self.expected_qty = expected_qty
        self.filled_so_far = 0.0
        self.placed_at = placed_at


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
            "trailing_stop": {"enabled": True, "activation_pct": 50, "trail_pct": 25},
        },
        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
    },
    "zero_dte_convexity": {
        "stop_loss": {"enabled": False, "type": "none"},  # hold losers to expiry
        "profit_taking": {
            "enabled": True,
            "targets": [],  # exit sweep: ladders hurt P&L by cutting fat-tail winners
            "trailing_stop": {
                "enabled": True,
                "activation_pct": 25,   # arm early (sweep: minimal downside vs 50%)
                "trail_pct": 15,        # 15% below peak (sweep: PF 9.59 vs 3.78 at 25%)
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

    Monitors a single position and exits portions when stop-loss or
    profit-taking thresholds are hit. One instance per managed position.

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

    def __init__(self):
        # ── State (initialized in on_start) ──
        self.remaining_qty: int = 0
        self.initial_qty: int = 0
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
        pos = config.get("position", {})
        self.initial_qty = int(pos.get("quantity", 0))
        self.remaining_qty = self.initial_qty
        self.entry_price = float(pos.get("entry_price", 0))
        self.is_long = pos.get("side", "LONG").upper() == "LONG"

        # Initialize level states
        self._level_states.clear()
        self._pending_orders.clear()
        self._fill_log.clear()
        self._completed = False
        self.high_water_mark = self.entry_price
        self._trailing_stop_price = 0.0
        self._trailing_active = False

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

    def evaluate(self, quotes: Dict[str, "Quote"], config: dict) -> List[OrderAction]:
        """Main evaluation: check stops, profits, trailing stop."""
        if self._completed or self.remaining_qty <= 0:
            return []

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
        self.remaining_qty = max(0, self.remaining_qty - int(new_filled))

        level_key = f"{pending.level_type}_{pending.level_idx}"
        if pending.level_type == "trailing":
            level_key = "trailing"

        self._fill_log.append({
            "time": time.time(),
            "order_id": order_id,
            "level": level_key,
            "qty_filled": int(new_filled),
            "avg_price": fill_data.get("avgFillPrice", 0),
            "remaining_qty": self.remaining_qty,
            "pnl_pct": self._calc_pnl_pct(fill_data.get("avgFillPrice", 0)),
        })

        status = fill_data.get("status", "")
        remaining_on_order = fill_data.get("remaining", 1)

        if status == "Filled" or remaining_on_order == 0:
            self._level_states[level_key] = LevelState.FILLED
            self._pending_orders.pop(order_id, None)
            logger.info("RiskManager level %s FILLED (remaining_qty=%d)", level_key, self.remaining_qty)
        else:
            self._level_states[level_key] = LevelState.PARTIAL
            logger.info("RiskManager level %s PARTIAL fill (remaining_qty=%d)", level_key, self.remaining_qty)

        # Check if position is fully exited
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
                p.level_type == self._parse_level_key(level_key)[0]
                and p.level_idx == self._parse_level_key(level_key)[1]
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
        """Parse 'stop_0' -> ('stop', 0), 'trailing' -> ('trailing', 0)."""
        if key == "trailing":
            return ("trailing", 0)
        parts = key.rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            return (parts[0], int(parts[1]))
        return (key, 0)

    def on_order_dead(self, order_id: int, reason: str, config: dict):
        """Handle order death (cancelled, rejected, Inactive) -- re-arm the level."""
        pending = self._pending_orders.pop(order_id, None)
        if not pending:
            return

        level_key = f"{pending.level_type}_{pending.level_idx}"
        if pending.level_type == "trailing":
            level_key = "trailing"

        logger.warning("RiskManager order %d dead for level %s: %s -- re-arming",
                        order_id, level_key, reason)
        self._level_states[level_key] = LevelState.ARMED

    def get_strategy_state(self) -> dict:
        """Return rich state for telemetry/dashboard display."""
        return {
            "remaining_qty": self.remaining_qty,
            "initial_qty": self.initial_qty,
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
                    "level": f"{p.level_type}_{p.level_idx}" if p.level_type != "trailing" else "trailing",
                    "expected_qty": p.expected_qty,
                    "filled_so_far": p.filled_so_far,
                    "placed_at": p.placed_at,
                }
                for oid, p in self._pending_orders.items()
            },
            "fill_log": self._fill_log[-20:],  # last 20 fills
        }

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

    def _make_order_action(self, qty: int, order_type_str: str, current_price: float,
                           quote, config: dict, reason: str) -> OrderAction:
        """Build an OrderAction with the right order type and limit offset."""
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
        )

    def _register_pending(self, action: OrderAction, level_type: str,
                          level_idx: int, level_key: str) -> OrderAction:
        """Mark a level as TRIGGERED and prepare pending order tracking.

        The actual order_id will be assigned by the engine after placement.
        We use a sentinel order_id of -1 until on_fill maps it.
        """
        self._level_states[level_key] = LevelState.TRIGGERED
        # We can't know the order_id yet -- the engine will call on_fill
        # with the real order_id. We store a "pre-pending" record that
        # we'll match in on_fill by checking if the level is TRIGGERED.
        return action

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
                self._level_states[key] = LevelState.TRIGGERED
                logger.info("RiskManager PROFIT %d triggered: pnl=%.1f%% qty=%d", i, pnl_pct, qty)
                return action  # Only one level per tick

        return None

    def _check_trailing_stop(self, config: dict, pnl_pct: float,
                             current_price: float, quote) -> Optional[OrderAction]:
        """Check trailing stop. Returns an OrderAction or None."""
        profit_cfg = config.get("profit_taking", {})
        trail_cfg = profit_cfg.get("trailing_stop", {})
        if not trail_cfg.get("enabled"):
            return None

        key = "trailing"
        if self._level_states.get(key) != LevelState.ARMED:
            return None

        activation_pct = trail_cfg.get("activation_pct", 0)
        trail_pct = trail_cfg.get("trail_pct", 10.0)

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
                qty = self.remaining_qty
                exec_cfg = config.get("execution", {})
                action = self._make_order_action(
                    qty, exec_cfg.get("stop_order_type", "MKT"),
                    current_price, quote, config,
                    f"Trailing stop: price={current_price:.4f} <= trail={self._trailing_stop_price:.4f} "
                    f"(hwm={self.high_water_mark:.4f}, trail_pct={trail_pct}%)"
                )
                self._level_states[key] = LevelState.TRIGGERED
                logger.info("RiskManager TRAILING STOP triggered: price=%.4f trail=%.4f",
                            current_price, self._trailing_stop_price)
                return action
        else:
            # Short: trailing stop goes up from low water mark
            new_trail = self.high_water_mark * (1.0 + trail_pct / 100.0)
            if self._trailing_stop_price == 0 or new_trail < self._trailing_stop_price:
                self._trailing_stop_price = new_trail
            if current_price >= self._trailing_stop_price:
                qty = self.remaining_qty
                exec_cfg = config.get("execution", {})
                action = self._make_order_action(
                    qty, exec_cfg.get("stop_order_type", "MKT"),
                    current_price, quote, config,
                    f"Trailing stop (short): price={current_price:.4f} >= trail={self._trailing_stop_price:.4f}"
                )
                self._level_states[key] = LevelState.TRIGGERED
                logger.info("RiskManager TRAILING STOP (short) triggered: price=%.4f trail=%.4f",
                            current_price, self._trailing_stop_price)
                return action

        return None
