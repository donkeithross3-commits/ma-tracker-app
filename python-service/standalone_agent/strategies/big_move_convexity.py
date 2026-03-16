"""BigMoveConvexityStrategy — OTM 1DTE options signal agent (multi-ticker).

Implements ExecutionStrategy to plug into the existing 100ms eval loop.
Wraps the big_move_convexity ML pipeline:

    Polygon WS → BarAccumulator → LiveDataStore
                                       │
                    [every decision_interval] assemble features → predict → signal
                                       │
                    [signal fires] → select OTM option → OrderAction(BUY)
                                       │
                    [on_fill] → spawn RiskManagerStrategy (intraday_convexity preset)

Configurable parameters are hot-reloadable via execution_config.

Multi-ticker: Each strategy instance is parameterized by config["ticker"].
Run one instance per ticker (e.g. strategy_id="bmc_spy", "bmc_slv").
The execution engine evaluates all instances independently.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import sys
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from quote_cache import Quote

# Resolve big_move_convexity import path
_BMC_PATH = os.environ.get("BMC_PATH", "")
if not _BMC_PATH:
    # strategies/big_move_convexity.py -> parent x5 -> dev/ (sibling of py_proj)
    _BMC_PATH = str(Path(__file__).resolve().parent.parent.parent.parent.parent / "py_proj")
if _BMC_PATH not in sys.path:
    sys.path.insert(0, _BMC_PATH)

from execution_engine import ExecutionStrategy, OrderAction, OrderSide, OrderType


def _run_async_in_thread(coro):
    """Run an async coroutine from a sync context that may already have a running loop.

    Spawns a short-lived thread with its own event loop to avoid the
    'Cannot run the event loop while another loop is running' error
    in Python 3.12+.
    """
    result = [None]
    exception = [None]

    def _target():
        loop = asyncio.new_event_loop()
        try:
            result[0] = loop.run_until_complete(coro)
        except Exception as exc:
            exception[0] = exc
        finally:
            loop.close()

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    t.join(timeout=30)
    if exception[0] is not None:
        raise exception[0]
    return result[0]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

_DEFAULTS: dict[str, Any] = {
    "ticker": "SPY",                  # underlying ticker for this instance
    "signal_threshold": 0.5,
    "signal_threshold_auto": True,    # True = use model's optimal_threshold from training metadata
    "min_signal_strength": 0.3,
    "direction_mode": None,             # None=auto from model | "long_only" | "short_only" | "both"
    "cooldown_minutes": 15,
    "decision_interval_seconds": 60,   # 1 minute
    "max_contracts": 5,
    "contract_budget_usd": 150.0,
    "scan_start": "09:45",            # HH:MM ET — 15 min after open (avoids auction noise)
    "scan_end": "15:45",              # last entry time; EOD exit at 15:57 (1DTE retains time value)
    "otm_target_pct": 1.0,            # 1.0% OTM (targets $0.30-$0.60 premiums on 1DTE)
    "auto_entry": False,              # paper trading safety
    "model_registry_path": "",        # auto-resolved if empty
    "use_delayed_data": False,        # paid Polygon tier — real-time
    "polygon_channels": [],           # auto-derived from ticker if empty
    "strike_increment": 0.0,          # 0 = auto-detect from ticker
    # DTE / option selection
    "preferred_dte": [1, 2],          # 1DTE preferred, 2DTE fallback (avoids IB post-expiry margin blocks)
    "max_spread": 0.05,               # max bid-ask spread in $ to accept
    "premium_min": 0.10,              # min option premium ($) to consider
    "premium_max": 3.00,              # max option premium ($) to consider
    # Signal gating — straddle richness thresholds (passed to SignalConfig)
    # Research (2026-03-09): high richness = market expects vol = GOOD for buyers.
    # richness >= 1.5 → PF=6.36 (best regime).  Use richness_min as primary gate.
    "straddle_richness_min": None,    # require richness above this to trade (None = disabled)
    "straddle_richness_max": None,    # suppress signal above this richness (None = disabled)
    "options_gate_enabled": False,    # enable straddle richness gate
    # Richness source: "feature_vector" (extract e_straddle_richness from model features)
    # or "strangle_pct" (use daily bootstrap strangle_pct:{ticker} from Polygon options).
    "richness_source": "feature_vector",
}

# Cross-asset tickers for correlation features (Group C) and backfill.
# Must include every ticker referenced by any TickerFeatureConfig.reference_tickers
# in py_proj ticker_features.py (currently: UUP, SPY, TLT, DBB for metals).
_CROSS_ASSET_TICKERS = ["QQQ", "IWM", "TLT", "GLD", "HYG", "UUP", "USO", "DBB"]

# Ticker-specific defaults for option selection, spreads, and Polygon channels.
# These override _DEFAULTS when a ticker profile is applied in on_start().
_TICKER_PROFILES: dict[str, dict[str, Any]] = {
    "SPY": {
        "strike_increment": 1.00,         # IB lists $1 increments near ATM for daily opts
        "polygon_channels": ["T.SPY", "Q.SPY"],
        "preferred_dte": [1, 2],          # 1DTE preferred (avoids IB post-expiry margin blocks)
        "max_spread": 0.05,               # tight bid-ask ($0.01-$0.03 typical)
        "premium_min": 0.10,
        "premium_max": 3.00,
        "scan_start": "09:45",            # standardized: 15 min after open
        "scan_end": "15:45",              # standardized: last entry time
        "signal_threshold": 0.40,         # model optimal (UP=0.40, DOWN=0.35)
        "contract_budget_usd": 150.0,
        "otm_target_pct": 1.5,            # ~$10 OTM on ~$680 → $0.30-$0.80 premium (1DTE)
        # Richness gate: require richness >= 1.5 (research: PF=6.36, all folds profitable)
        "straddle_richness_min": 1.5,
        # VIX band: 12-25 (2026-03-16: lowered from 14 to 12 — gate sweep on v5i
        # shows vix_min=12 gives ALL 5 folds profitable including fold 0 at PF=1.25,
        # +28% more signals (1575 vs 1230). vix_min=14 was killing profitable low-vol signals.)
        "vix_gate_min": 12,
        "vix_gate_max": 25,
        "options_gate_enabled": True,     # enable for SPY (validated 2026-03-09)
    },
    "SLV": {
        "strike_increment": 1.00,         # IB lists $1 increments for SLV options
        "polygon_channels": ["T.SLV", "Q.SLV"],
        "preferred_dte": [1, 2, 3, 4, 5],  # 1DTE+ preferred (avoids IB post-expiry margin blocks)
        "max_spread": 0.20,               # wider bid-ask ($0.05-$0.15 typical)
        "premium_min": 0.05,              # lower premiums (~$30 underlying)
        "premium_max": 1.50,
        "scan_start": "09:45",            # standardized: 15 min after open
        "scan_end": "15:45",              # standardized: last entry time
        "direction_mode": "long_only",    # symmetric model (is_big_move) — no edge on puts
        "contract_budget_usd": 50.0,
        "otm_target_pct": 3.0,            # ~$1 OTM on ~$33 → $0.30-$0.60 premium (1DTE)
        # SLV richness gate not yet validated — keep disabled (no options_gate_enabled override)
        "straddle_richness_min": None,
    },
    "QQQ": {
        "strike_increment": 1.00,         # IB lists $1 increments near ATM for daily opts
        "polygon_channels": ["T.QQQ", "Q.QQQ"],
        "preferred_dte": [1, 2],          # 1DTE preferred (avoids IB post-expiry margin blocks)
        "max_spread": 0.05,
        "premium_min": 0.10,
        "premium_max": 3.00,
        "scan_start": "09:45",            # standardized: 15 min after open
        "scan_end": "15:45",              # standardized: last entry time
        "signal_threshold": 0.40,         # model optimal (DOWN=0.40)
        "otm_target_pct": 1.2,            # ~$6 OTM on ~$510 → $0.30-$0.60 premium (1DTE)
    },
    "IWM": {
        "strike_increment": 1.00,         # IB lists $1 increments for IWM options
        "polygon_channels": ["T.IWM", "Q.IWM"],
        "preferred_dte": [1, 2],          # 1DTE preferred (avoids IB post-expiry margin blocks)
        "max_spread": 0.10,
        "premium_min": 0.05,
        "premium_max": 2.00,
        "otm_target_pct": 1.5,            # ~$3 OTM on ~$200 → $0.30-$0.60 premium (1DTE)
    },
    "GLD": {
        "strike_increment": 1.00,         # IB lists $1 increments for GLD options
        "polygon_channels": ["T.GLD", "Q.GLD"],
        "preferred_dte": [1, 2, 3, 4, 5],  # 1DTE+ preferred (avoids IB post-expiry margin blocks)
        "max_spread": 0.15,
        "premium_min": 0.05,
        "premium_max": 2.00,
        "scan_start": "09:35",            # COMEX session start (GLD active early)
        "scan_end": "13:30",              # COMEX session close (zero overlap with SPY 13:30-15:55)
        "signal_threshold": 0.30,         # low threshold — gate does the work, not model
        "direction_mode": "long_only",    # calls only (puts dead for GLD)
        "otm_target_pct": 1.0,            # ~$2.60 OTM on ~$263 → $0.30-$0.60 premium (1DTE)
        "contract_budget_usd": 100.0,
        # Richness gate: strangle_pct >= 0.004 (research 2026-03-10: ALL 5 folds profitable)
        # Uses strangle_pct from daily bootstrap (NOT e_straddle_richness from feature vector).
        "options_gate_enabled": True,
        "straddle_richness_min": 0.004,   # strangle_pct threshold (1% OTM strangle / underlying)
        "richness_source": "strangle_pct",  # use daily bootstrap strangle_pct instead of fv
    },
}

def _get_ticker_profile(ticker: str) -> dict[str, Any]:
    """Return ticker-specific defaults, falling back to generic ETF profile."""
    if ticker in _TICKER_PROFILES:
        return _TICKER_PROFILES[ticker]
    # Generic fallback for unknown tickers
    return {
        "strike_increment": 1.00,
        "polygon_channels": [f"T.{ticker}", f"Q.{ticker}"],
        "preferred_dte": [1, 2, 3, 4, 5],
        "max_spread": 0.15,
        "premium_min": 0.05,
        "premium_max": 2.00,
    }


# IB trading class disambiguation (DEPRECATED as of 2026-03 — IB uses standard
# ticker symbol as tradingClass for all equity options including dailies).
# Previously SPY used "SPYW", QQQ used "QQQW", IWM used "IWMW" for non-3rd-Friday
# expirations.  IB now returns these under the standard class (e.g., "SPY").
# We no longer set tradingClass — IB auto-resolves when there's only one series
# for a given date, and uses the standard class name for daily expirations.

def _get_option_trading_class(ticker: str, expiry_date) -> str:
    """Return the IB tradingClass for an option expiry.

    As of 2026-03, IB lists all equity options (daily, weekly, monthly) under the
    standard trading class (e.g., "SPY").  The old SPYW/QQQW/IWMW classes are
    deprecated and cause Error 200.  We return empty string to let IB auto-resolve.
    """
    return ""


class BigMoveConvexityStrategy(ExecutionStrategy):
    """Entry strategy for OTM 0DTE options on a configurable ticker.

    Runs the big_move_convexity ML pipeline on the execution engine's 100ms
    eval loop. Most ticks return [] immediately; the heavy feature-compute +
    predict cycle runs only every ``decision_interval_seconds`` during the
    configured scan window.

    Multi-ticker: set config["ticker"] = "SPY" or "SLV" etc.
    Each instance manages one ticker independently.
    """

    def __init__(self) -> None:
        # Ticker for this instance (set in on_start from config)
        self._ticker: str = "SPY"

        # BMC components — initialised in on_start()
        self._data_store = None
        self._bar_accumulator = None
        self._model = None
        self._decision_engine_cfg = None
        self._polygon_provider = None
        self._polygon_client = None

        # Signal state
        self._last_signal = None
        self._last_decision_time: float = 0.0
        self._signal_history: list[dict] = []
        self._signals_generated: int = 0
        self._decisions_run: int = 0

        # Polygon WS background thread
        self._ws_thread: Optional[threading.Thread] = None
        self._ws_loop: Optional[asyncio.AbstractEventLoop] = None

        # Position tracking
        self._active_positions: list[dict] = []
        self._positions_spawned: int = 0

        # Cooldown tracker: ticker -> last signal time
        self._cooldown_tracker: dict[str, float] = {}

        # Callbacks wired by IBDataAgent
        self._spawn_risk_manager: Optional[Callable] = None
        self._fetch_option_quote: Optional[Callable] = None

        # Start time for uptime tracking
        self._start_time: float = 0.0
        self._started = False
        self._startup_error: str = ""

        # Model metadata (populated in on_start)
        self._model_version: str = ""
        self._model_ticker: str = ""
        self._model_type: str = ""
        self._model_metrics: dict = {}
        self._top_feature_names: list = []
        self._model_optimal_threshold: Optional[float] = None  # from training metadata

        # Pending lineage snapshot (built on signal fire, consumed by on_fill)
        self._pending_lineage: Optional[dict] = None

        # Taxonomy identity (populated from ModelVersion in _init_bmc_pipeline)
        self._family_id: str = ""
        self._recipe_id: str = ""
        self._recipe_label: str = ""
        self._checkpoint_status: str = ""
        self._target_column: str = ""
        self._dataset_version: str = ""
        self._bar_type: str = ""

        # Signal inversion: auto-derived from target_column (DOWN models flip direction)
        self._invert_signal: bool = False

        # Parent strategy ID for risk manager lineage pass-through
        self._parent_strategy_id: Optional[str] = None

        # Session tracking
        self._session_id: str = ""
        self._segment_idx: int = 0
        self._signal_counter: int = 0  # per-session signal counter for signal_id
        self._current_profile_id: str = ""  # tracks current execution profile
        self._current_profile_label: str = ""

        # Model registry path (stored for hot-swap)
        self._registry_path: str = ""
        self._swap_in_progress: bool = False

        # Polygon WS resilience
        self._shutdown_requested: bool = False
        self._polygon_feed_dead: bool = False
        self._last_bar_update_ts: float = 0.0

    # ------------------------------------------------------------------
    # ExecutionStrategy interface
    # ------------------------------------------------------------------

    def get_subscriptions(self, config: dict) -> List[dict]:
        """Subscribe to the configured ticker via IB for price reference (1 market data line)."""
        ticker = config.get("ticker", "SPY")
        return [{
            "cache_key": ticker,
            "contract": {
                "symbol": ticker,
                "secType": "STK",
                "exchange": "SMART",
                "currency": "USD",
            },
            "generic_ticks": "100,101,104,106",
        }]

    def on_start(self, config: dict) -> None:
        """Load model, init data pipeline, start Polygon WS background thread."""
        self._start_time = time.time()
        self._session_id = f"sess:{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        # Merge: _DEFAULTS < ticker profile < user config.
        # This ensures ticker-specific defaults (DTE range, spread limits, etc.)
        # are applied but can be overridden by explicit user config.
        ticker = config.get("ticker", _DEFAULTS["ticker"])
        profile = _get_ticker_profile(ticker)
        cfg = {**_DEFAULTS, **profile, **config}

        # Store ticker for this instance
        self._ticker = cfg["ticker"]

        # Parse risk config from frontend (flows through BMCConfig)
        self._risk_config = {
            "preset": config.get("risk_preset", "intraday_convexity"),
            "stop_loss_enabled": config.get("risk_stop_loss_enabled", False),
            "stop_loss_type": config.get("risk_stop_loss_type", "none"),
            "stop_loss_trigger_pct": config.get("risk_stop_loss_trigger_pct", -5.0),
            "trailing_enabled": config.get("risk_trailing_enabled", True),
            "trailing_activation_pct": config.get("risk_trailing_activation_pct", 25),
            "trailing_trail_pct": config.get("risk_trailing_trail_pct", 15),
            "profit_targets_enabled": config.get("risk_profit_targets_enabled", True),
            "profit_targets": config.get("risk_profit_targets", []),
        }

        try:
            self._init_bmc_pipeline(cfg)
            self._start_polygon_ws(cfg)
            self._started = True

            # Compute initial execution profile
            self._current_profile_id, self._current_profile_label = self._compute_execution_profile(cfg)

            # Log effective threshold (model-auto vs config)
            _eff_thresh = self._model_optimal_threshold if (
                cfg.get("signal_threshold_auto", True) and self._model_optimal_threshold is not None
            ) else cfg["signal_threshold"]
            _thresh_src = "model-auto" if _eff_thresh != cfg["signal_threshold"] else "config"

            logger.info(
                "BigMoveConvexityStrategy[%s] started: auto_entry=%s, threshold=%.4f (%s), "
                "interval=%ds, scan=%s-%s, delayed=%s, session=%s, profile=%s",
                self._ticker,
                cfg["auto_entry"], _eff_thresh, _thresh_src,
                cfg["decision_interval_seconds"],
                cfg["scan_start"], cfg["scan_end"],
                cfg["use_delayed_data"],
                self._session_id,
                self._current_profile_label,
            )
        except Exception as e:
            self._startup_error = str(e)
            logger.exception("BigMoveConvexityStrategy[%s] startup failed: %s", self._ticker, e)

    def evaluate(self, quotes: Dict[str, "Quote"], config: dict) -> List[OrderAction]:
        """Called every 100ms by ExecutionEngine.

        Returns [] on 99.7% of ticks. Only runs the decision cycle every
        ``decision_interval_seconds`` during the scan window.
        """
        if not self._started or self._model is None:
            return []

        profile = _get_ticker_profile(self._ticker)
        cfg = {**_DEFAULTS, **profile, **config}
        now = time.time()

        # Detect execution profile changes (segment tracking)
        # Runs before scan window check so config changes are detected even outside trading window
        new_profile_id, new_profile_label = self._compute_execution_profile(cfg)
        if self._current_profile_id and new_profile_id != self._current_profile_id:
            old_label = self._current_profile_label
            self._segment_idx += 1
            self._current_profile_id = new_profile_id
            self._current_profile_label = new_profile_label
            self._on_segment_change(old_label, new_profile_label, cfg)
        elif not self._current_profile_id:
            self._current_profile_id = new_profile_id
            self._current_profile_label = new_profile_label

        # Check scan window
        if not self._is_in_scan_window(cfg):
            return []

        # Check decision interval
        interval = cfg.get("decision_interval_seconds", 300)
        if (now - self._last_decision_time) < interval:
            return []

        # Run decision cycle
        self._last_decision_time = now
        self._decisions_run += 1

        try:
            return self._run_decision_cycle(quotes, cfg)
        except Exception:
            logger.exception("Decision cycle error")
            return []

    def on_fill(self, order_id: int, fill_data: dict, config: dict) -> None:
        """On entry fill, spawn a RiskManagerStrategy to manage the position."""
        profile = _get_ticker_profile(self._ticker)
        cfg = {**_DEFAULTS, **profile, **config}
        fill_status = fill_data.get("status", "")

        if fill_status != "Filled":
            return

        avg_price = fill_data.get("avgFillPrice", 0.0)
        filled_qty = fill_data.get("filled", 0)
        perm_id = fill_data.get("permId", 0)

        logger.info(
            "BMC entry fill: order_id=%d, avg_price=%.2f, qty=%s, permId=%d",
            order_id, avg_price, filled_qty, perm_id,
        )

        # Activate cooldown only after a confirmed fill
        self._cooldown_tracker[self._ticker] = time.time()

        # Record position
        position_info = {
            "order_id": order_id,
            "entry_price": avg_price,
            "quantity": int(filled_qty),
            "fill_time": time.time(),
            "perm_id": perm_id,
            "signal": self._last_signal,
        }
        self._active_positions.append(position_info)
        self._positions_spawned += 1

        # Update risk config from latest config (hot-reload support)
        self._risk_config = {
            "preset": config.get("risk_preset", self._risk_config.get("preset", "intraday_convexity")),
            "stop_loss_enabled": config.get("risk_stop_loss_enabled", self._risk_config.get("stop_loss_enabled", False)),
            "stop_loss_type": config.get("risk_stop_loss_type", self._risk_config.get("stop_loss_type", "none")),
            "stop_loss_trigger_pct": config.get("risk_stop_loss_trigger_pct", self._risk_config.get("stop_loss_trigger_pct", -5.0)),
            "trailing_enabled": config.get("risk_trailing_enabled", self._risk_config.get("trailing_enabled", True)),
            "trailing_activation_pct": config.get("risk_trailing_activation_pct", self._risk_config.get("trailing_activation_pct", 25)),
            "trailing_trail_pct": config.get("risk_trailing_trail_pct", self._risk_config.get("trailing_trail_pct", 15)),
            "profit_targets_enabled": config.get("risk_profit_targets_enabled", self._risk_config.get("profit_targets_enabled", True)),
            "profit_targets": config.get("risk_profit_targets", self._risk_config.get("profit_targets", [])),
        }

        # Spawn risk manager if callback is wired
        if self._spawn_risk_manager is not None and self._last_signal:
            try:
                contract_info = self._last_signal.get("option_contract", {})

                # Build risk config from strategy settings
                if self._risk_config.get("preset") != "custom":
                    # Use preset name — RiskManagerStrategy resolves it
                    risk_section = {"preset": self._risk_config["preset"]}
                else:
                    # Custom: build full config from individual fields
                    risk_section = {
                        "stop_loss": {
                            "enabled": self._risk_config["stop_loss_enabled"],
                            "type": self._risk_config["stop_loss_type"],
                            "trigger_pct": self._risk_config["stop_loss_trigger_pct"],
                        },
                        "profit_taking": {
                            "enabled": self._risk_config["profit_targets_enabled"],
                            "targets": self._risk_config["profit_targets"],
                            "trailing_stop": {
                                "enabled": self._risk_config["trailing_enabled"],
                                "activation_pct": self._risk_config["trailing_activation_pct"],
                                "trail_pct": self._risk_config["trailing_trail_pct"],
                            },
                        },
                        "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
                    }

                risk_config = {
                    **risk_section,
                    "instrument": {
                        "symbol": contract_info.get("symbol", self._ticker),
                        "secType": "OPT",
                        "exchange": "SMART",
                        "currency": "USD",
                        "strike": contract_info.get("strike", 0),
                        "expiry": contract_info.get("expiry", ""),
                        "right": contract_info.get("right", "C"),
                    },
                    "position": {
                        "side": "LONG",
                        "quantity": int(filled_qty),
                        "entry_price": avg_price,
                    },
                }
                # Attach lineage for position store persistence (WS2)
                if self._pending_lineage:
                    risk_config["lineage"] = self._pending_lineage
                    self._pending_lineage = None  # consumed — prevent stale lineage on next fill
                # Pass parent strategy ID for risk manager lineage tracking
                risk_config["_parent_strategy_id"] = getattr(self, "_parent_strategy_id", None) or f"bmc_{self._ticker.lower()}"
                spawn_ok = self._spawn_risk_manager(risk_config)
                if spawn_ok is False:
                    # Spawn failed — position is UNMANAGED. Log critical alert.
                    # The agent's reconciliation loop will catch this on the next
                    # 60s cycle and retry via _spawn_missing_risk_managers.
                    logger.error(
                        "CRITICAL: RM spawn FAILED for %s strike=%.2f qty=%d — "
                        "position UNMANAGED until reconciliation recovery",
                        self._ticker, contract_info.get("strike", 0), int(filled_qty),
                    )
                else:
                    logger.info(
                        "Spawned RiskManagerStrategy for BMC position: strike=%.2f, qty=%d",
                        contract_info.get("strike", 0), int(filled_qty),
                    )
            except Exception:
                logger.exception(
                    "CRITICAL: Failed to spawn RiskManagerStrategy — position UNMANAGED"
                )

    def on_order_placed(self, order_id: int, result: dict, config: dict) -> None:
        logger.info("BMC order placed: order_id=%d, result=%s", order_id, result)

    def on_order_dead(self, order_id: int, reason: str, config: dict) -> None:
        logger.warning("BMC order dead: order_id=%d, reason=%s", order_id, reason)

    def on_stop(self, config: dict) -> None:
        """Stop Polygon WS, cleanup."""
        logger.info("BigMoveConvexityStrategy[%s] stopping", self._ticker)
        self._shutdown_requested = True

        # Stop Polygon WS
        if self._polygon_client is not None:
            try:
                if self._ws_loop is not None and self._ws_loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._polygon_client.stop(), self._ws_loop
                    )
            except Exception:
                logger.debug("Error stopping Polygon WS", exc_info=True)

        # Flush partial bars
        if self._bar_accumulator is not None:
            try:
                self._bar_accumulator.flush_all()
            except Exception:
                logger.debug("Error flushing bars", exc_info=True)

        self._started = False
        logger.info(
            "BigMoveConvexityStrategy[%s] stopped: decisions=%d, signals=%d, positions=%d",
            self._ticker, self._decisions_run, self._signals_generated, self._positions_spawned,
        )

    def get_strategy_state(self) -> dict:
        """Rich telemetry for dashboard Signals tab."""
        state: dict[str, Any] = {
            "type": "big_move_convexity",
            "ticker": self._ticker,
            "started": self._started,
            "startup_error": self._startup_error,
            "uptime_s": (time.time() - self._start_time) if self._started else 0,
            "decisions_run": self._decisions_run,
            "signals_generated": self._signals_generated,
            "positions_spawned": self._positions_spawned,
            "last_decision_time": self._last_decision_time,
            "model_version": self._model_version,
            "model_ticker": self._model_ticker,
            "model_type": self._model_type,
            # Taxonomy telemetry
            "family_id": self._family_id,
            "recipe_label": self._recipe_label,
            "session_id": self._session_id,
            "segment_idx": self._segment_idx,
            "execution_profile": self._current_profile_label,
            # Signal inversion / directional model telemetry
            "model_direction": "DOWN" if self._invert_signal else "UP" if self._target_column and "UP" in self._target_column else "symmetric",
            "signal_inverted": self._invert_signal,
            "target_column": self._target_column,
            # Model's trained optimal threshold (None if v1 model without threshold metadata)
            "model_optimal_threshold": self._model_optimal_threshold,
        }

        # Current signal
        if self._last_signal:
            state["current_signal"] = self._last_signal
        else:
            state["current_signal"] = None

        # Signal history (last 20)
        state["signal_history"] = self._signal_history[-20:]

        # Polygon WS status
        if self._polygon_client is not None:
            state["polygon_ws"] = self._polygon_client.get_status()
        else:
            state["polygon_ws"] = {"connected": False}

        # Bar accumulator status
        if self._bar_accumulator is not None:
            state["bar_accumulator"] = self._bar_accumulator.get_status()
        else:
            state["bar_accumulator"] = {}

        # Data store status
        if self._data_store is not None:
            state["data_store"] = self._data_store.get_status()
        else:
            state["data_store"] = {}

        # Active positions
        state["active_positions"] = self._active_positions

        # Polygon WS health (WS5)
        state["polygon_feed_dead"] = self._polygon_feed_dead
        state["polygon_data_age_s"] = round(time.time() - self._last_bar_update_ts, 1) if self._last_bar_update_ts > 0 else None
        state["ws_thread_alive"] = self._ws_thread.is_alive() if self._ws_thread else False

        return state

    # ------------------------------------------------------------------
    # Hot-swap model management
    # ------------------------------------------------------------------

    def list_available_models(self, ticker: str = "") -> list[dict]:
        """List all models in the registry, optionally filtered by ticker.

        Called from agent handler via thread pool (disk I/O for registry read).
        """
        if not self._registry_path:
            return []

        if not os.path.isdir(self._registry_path):
            logger.warning("Model registry path not found: %s", self._registry_path)
            return []

        from big_move_convexity.ml.model_registry import ModelRegistry

        try:
            registry = ModelRegistry(self._registry_path)
            all_versions = registry.list_versions()
        except Exception as e:
            logger.error("Failed to read model registry at %s: %s", self._registry_path, e)
            return []

        result = []
        for v in all_versions:
            # Filter by ticker if specified
            if ticker and v.ticker and v.ticker.upper() != ticker.upper():
                continue

            entry = {
                "version_id": v.version_id,
                "model_type": v.model_type,
                "created_at": v.created_at,
                "status": v.status,
                "ticker": v.ticker,
                "recipe_label": v.recipe_label,
                "target_column": v.target_column,
                "dataset_version": v.dataset_version,
                "n_features": v.n_features,
                "n_samples": v.n_samples,
                "tags": v.tags,
                "metrics": v.metrics or {},
                "is_current": v.version_id == self._model_version,
            }
            result.append(entry)

        # Sort: current first, then by created_at descending
        result.sort(key=lambda x: (not x["is_current"], x.get("created_at", "")), reverse=False)
        result.sort(key=lambda x: x["is_current"], reverse=True)

        return result

    def swap_model(self, version_id: str) -> dict:
        """Hot-swap the model to a different registry version.

        Atomically replaces self._model under the GIL (single STORE_ATTR op).
        Called from agent handler via thread pool (disk I/O for model load).

        Thread safety: Model is swapped FIRST, then metadata is updated.
        This means the eval loop always sees a coherent (model, metadata) pair:
        either (old model, old metadata) or (new model, new metadata). The brief
        window of (new model, old metadata) is safe because metadata is only used
        for informational purposes (telemetry, lineage), and _run_decision_cycle
        snapshots model+metadata into locals before using them.

        Returns dict with previous/new version info and swap timing.
        """
        if not self._registry_path:
            return {"error": "No registry path configured"}

        # Serialize swap operations — prevent concurrent double-swaps
        if self._swap_in_progress:
            return {"error": "A model swap is already in progress"}
        self._swap_in_progress = True

        try:
            return self._swap_model_inner(version_id)
        finally:
            self._swap_in_progress = False

    def _swap_model_inner(self, version_id: str) -> dict:
        """Inner swap logic, called under _swap_in_progress guard."""
        from big_move_convexity.ml.model_registry import ModelRegistry

        t0 = time.time()
        previous_version = self._model_version

        if version_id == previous_version:
            return {"error": f"Model {version_id} is already loaded"}

        if not os.path.isdir(self._registry_path):
            return {"error": f"Registry path not found: {self._registry_path}"}

        try:
            registry = ModelRegistry(self._registry_path)
        except Exception as e:
            return {"error": f"Failed to open registry: {e}"}

        # Validate version exists
        try:
            version_meta = registry.get(version_id)
        except KeyError:
            return {"error": f"Version {version_id!r} not found in registry"}

        # Validate ticker match (if model has a ticker set)
        if version_meta.ticker and version_meta.ticker.upper() != self._ticker.upper():
            return {
                "error": f"Model ticker mismatch: model is for {version_meta.ticker!r}, "
                         f"strategy is running {self._ticker!r}"
            }

        # Load the new model (disk I/O — this is why we run in thread pool)
        try:
            new_model = registry.load(version_id)
        except Exception as e:
            return {"error": f"Failed to load model {version_id}: {e}"}

        # Validate loaded model has expected interface
        if not hasattr(new_model, 'model_type') or not hasattr(new_model, 'feature_names'):
            return {"error": f"Loaded model {version_id} is missing required attributes (model_type, feature_names)"}

        # GIL-atomic swap FIRST — eval loop sees new model immediately.
        # Metadata update follows; the brief (new model, old metadata) window is safe
        # because _run_decision_cycle snapshots both into locals.
        self._model = new_model

        # Now update metadata (informational — telemetry, lineage)
        self._model_version = version_meta.version_id
        self._model_ticker = version_meta.ticker
        self._model_type = new_model.model_type
        self._family_id = getattr(version_meta, 'family_id', '') or 'bmc-v1'
        self._recipe_id = getattr(version_meta, 'recipe_id', '')
        self._recipe_label = getattr(version_meta, 'recipe_label', '')
        self._checkpoint_status = getattr(version_meta, 'status', '')
        self._target_column = getattr(version_meta, 'target_column', '')
        self._dataset_version = getattr(version_meta, 'dataset_version', '')
        self._bar_type = getattr(version_meta, 'bar_type', '')

        # Auto-derive signal inversion from target_column (DOWN models flip direction)
        self._invert_signal = bool(self._target_column and "DOWN" in self._target_column)

        # Extract model's optimal threshold from training metadata (v2+ models)
        _md = new_model.metadata if hasattr(new_model, 'metadata') else {}
        _raw_thresh = _md.get("optimal_threshold")
        if _raw_thresh is not None:
            self._model_optimal_threshold = round(float(_raw_thresh), 4)
            logger.info(
                "Hot-swapped model %s has optimal_threshold=%.4f",
                version_id, self._model_optimal_threshold,
            )
        else:
            self._model_optimal_threshold = None

        # Cache model metrics
        self._model_metrics = {}
        if hasattr(version_meta, 'metrics') and version_meta.metrics:
            self._model_metrics = {
                "auc_roc": version_meta.metrics.get("auc_roc"),
                "profit_factor": version_meta.metrics.get("profit_factor"),
            }

        # Pre-compute top 20 feature names
        if hasattr(new_model.model, 'feature_importances_'):
            importances = new_model.model.feature_importances_
            sorted_idx = sorted(range(len(importances)), key=lambda i: importances[i], reverse=True)[:20]
            self._top_feature_names = [new_model.feature_names[i] for i in sorted_idx]
        else:
            self._top_feature_names = new_model.feature_names[:20]

        swap_ms = (time.time() - t0) * 1000
        logger.info(
            "Model hot-swapped: %s → %s (type=%s, features=%d, %.1fms)",
            previous_version, version_id, new_model.model_type,
            len(new_model.feature_names), swap_ms,
        )

        # Build default config from ticker profile so the agent handler
        # can apply it to state.config (ensures scan window, threshold, etc.
        # match the ticker's tuned defaults after a model swap).
        profile = _get_ticker_profile(self._ticker)
        default_config = {**_DEFAULTS, **profile}
        # Only include user-facing config keys (exclude internal plumbing)
        config_defaults = {
            k: default_config[k] for k in (
                "signal_threshold", "signal_threshold_auto", "direction_mode",
                "scan_start", "scan_end", "contract_budget_usd", "max_contracts",
                "cooldown_minutes", "decision_interval_seconds",
                "otm_target_pct", "max_spread", "premium_min", "premium_max",
                "preferred_dte", "options_gate_enabled",
                "straddle_richness_min", "straddle_richness_max",
                "richness_source",
            ) if k in default_config
        }

        return {
            "success": True,
            "previous_version": previous_version,
            "new_version": version_id,
            "model_type": new_model.model_type,
            "n_features": len(new_model.feature_names),
            "swap_time_ms": round(swap_ms, 1),
            "config_defaults": config_defaults,
        }

    # ------------------------------------------------------------------
    # Internal — BMC pipeline setup
    # ------------------------------------------------------------------

    def _init_bmc_pipeline(self, cfg: dict) -> None:
        """Import BMC modules and initialise the data pipeline."""
        # Import BMC modules (fail loudly if not available)
        from big_move_convexity.live.data_store import LiveDataStore
        from big_move_convexity.bars.bar_accumulator import BarAccumulator
        from big_move_convexity.ml.model_registry import ModelRegistry
        from big_move_convexity.live.daily_bootstrap import DailyBootstrap

        # Init data store
        self._data_store = LiveDataStore(max_bars_per_type=10000)

        # Init bar accumulator
        self._bar_accumulator = BarAccumulator(
            self._data_store,
            resolutions=["time_5s", "time_15s", "time_1m"],
        )

        # Load model from registry
        registry_path = cfg.get("model_registry_path", "")
        if not registry_path:
            registry_path = os.path.join(_BMC_PATH, "big_move_convexity", "models", "registry")

        self._registry_path = registry_path
        registry = ModelRegistry(registry_path)

        # Support pinning a specific model version via config (for directional pair expansion)
        model_version_pin = cfg.get("model_version")
        if model_version_pin:
            try:
                prod_version = registry.get(model_version_pin)
            except KeyError:
                raise RuntimeError(f"Model version '{model_version_pin}' not found in registry")
        else:
            prod_version = registry.get_production(ticker=self._ticker)
        if prod_version is None:
            raise RuntimeError(
                f"No production model for ticker '{self._ticker}' in {registry_path}. "
                "Run scripts/train_production_model.py first."
            )

        self._model = registry.load(prod_version.version_id)
        self._model_version = prod_version.version_id
        self._model_ticker = prod_version.ticker
        self._model_type = self._model.model_type
        logger.info(
            "Loaded production model: %s (ticker=%s, type=%s, features=%d)",
            prod_version.version_id,
            prod_version.ticker,
            self._model.model_type,
            len(self._model.feature_names),
        )

        # Read taxonomy identity from model version (populated by py_proj training pipeline)
        self._family_id = getattr(prod_version, 'family_id', '') or 'bmc-v1'
        self._recipe_id = getattr(prod_version, 'recipe_id', '')
        self._recipe_label = getattr(prod_version, 'recipe_label', '')
        self._checkpoint_status = getattr(prod_version, 'status', '')
        self._target_column = getattr(prod_version, 'target_column', '')
        self._dataset_version = getattr(prod_version, 'dataset_version', '')
        self._bar_type = getattr(prod_version, 'bar_type', '')

        # Auto-derive signal inversion from target_column (DOWN models flip direction)
        self._invert_signal = bool(self._target_column and "DOWN" in self._target_column)

        # Cache model metrics for lineage snapshots
        self._model_metrics = {}
        if hasattr(prod_version, 'metrics') and prod_version.metrics:
            self._model_metrics = {
                "auc_roc": prod_version.metrics.get("auc_roc"),
                "profit_factor": prod_version.metrics.get("profit_factor"),
            }
        # Extract model's optimal threshold from training metadata (v2+ models)
        _md = self._model.metadata if hasattr(self._model, 'metadata') else {}
        _raw_thresh = _md.get("optimal_threshold")
        if _raw_thresh is not None:
            self._model_optimal_threshold = round(float(_raw_thresh), 4)
            logger.info(
                "Model %s has optimal_threshold=%.4f (will auto-apply when signal_threshold_auto=True)",
                prod_version.version_id, self._model_optimal_threshold,
            )
        else:
            self._model_optimal_threshold = None

        # Pre-compute top 20 feature names by importance for lineage fingerprint
        if hasattr(self._model.model, 'feature_importances_'):
            importances = self._model.model.feature_importances_
            sorted_idx = sorted(range(len(importances)), key=lambda i: importances[i], reverse=True)[:20]
            self._top_feature_names = [self._model.feature_names[i] for i in sorted_idx]
        else:
            self._top_feature_names = self._model.feature_names[:20]

        # -- Daily bootstrap + intraday backfill --
        # If the agent pre-bootstrapped all tickers (parallel loading mode),
        # inject the cached data directly. Otherwise fall back to per-strategy
        # Polygon REST calls (sequential mode / add_ticker at runtime).
        shared = cfg.get("_shared_bootstrap")
        if shared:
            from datetime import date as _date_mod
            today_str = _date_mod.today().isoformat()
            self._data_store.set_daily_features(today_str, shared["daily_features"])
            self._data_store.set_regime(shared["regime"])
            # Inject pre-fetched intraday bars
            for store_key, bars in shared.get("intraday_bars", {}).items():
                self._data_store.inject_bars(store_key, bars)
            logger.info("BigMoveConvexityStrategy[%s] using shared bootstrap data", self._ticker)
        else:
            # Fallback: per-strategy bootstrap (used for add_ticker at runtime)
            bootstrap = DailyBootstrap()
            bootstrap_tickers = list(dict.fromkeys(
                [self._ticker, "SPY"] + _CROSS_ASSET_TICKERS + ["TIP"]
            ))
            try:
                bootstrap_result = _run_async_in_thread(
                    bootstrap.bootstrap(self._data_store, tickers=bootstrap_tickers)
                )
                logger.info("Daily bootstrap complete: %s", bootstrap_result)
            except Exception:
                logger.warning("Daily bootstrap failed — features may be incomplete", exc_info=True)

            backfill_tickers = list(dict.fromkeys(
                [self._ticker] + [t for t in _CROSS_ASSET_TICKERS if t != self._ticker] + ["SPY"]
            ))
            try:
                backfill_result = _run_async_in_thread(
                    bootstrap.backfill_intraday_bars(self._data_store, backfill_tickers)
                )
                logger.info("Intraday backfill complete: %s", backfill_result)
            except Exception:
                logger.warning("Intraday backfill failed — will rely on WS bars only", exc_info=True)

    def _start_polygon_ws(self, cfg: dict) -> None:
        """Start Polygon WS in a background thread."""
        from big_move_convexity.dpal.polygon_ws import PolygonWebSocketProvider
        from big_move_convexity.dpal.polygon_ws_client import PolygonWSClient

        polygon_api_key = os.environ.get("POLYGON_API_KEY", "")
        if not polygon_api_key:
            logger.error("POLYGON_API_KEY not set — Polygon WS will not connect")
        self._polygon_provider = PolygonWebSocketProvider(api_key=polygon_api_key)

        # Wire trade/quote callbacks to bar accumulator (sync — called from dispatch_message)
        def _on_equity_quote(quote):
            """Route equity quotes to bar accumulator and data store."""
            try:
                if self._bar_accumulator is not None:
                    ts_ns = int(quote.provenance.source_timestamp * 1_000_000_000) if quote.provenance else int(time.time() * 1_000_000_000)
                    # Quotes carry bid/ask; feed as quote tick
                    self._bar_accumulator.on_quote(
                        quote.ticker, quote.bid, quote.ask,
                        quote.bid_size, quote.ask_size, ts_ns,
                    )
                    # Also feed mid as trade tick for OHLCV (Polygon equity WS
                    # dispatches both T and Q events through the same equity
                    # callback; when the event is a trade the last_trade field
                    # is populated)
                    if quote.last_trade and quote.last_trade > 0:
                        self._bar_accumulator.on_trade(
                            quote.ticker, quote.last_trade,
                            quote.last_size or 1, ts_ns,
                        )
                    # Track last bar update for data freshness monitoring
                    self._last_bar_update_ts = time.time()
                if self._data_store is not None:
                    self._data_store.update_equity_quote(quote.ticker, quote)
            except Exception:
                logger.debug("Error in equity quote callback", exc_info=True)

        # Subscribe primary ticker + all cross-asset tickers to the same
        # callback. BarAccumulator handles multi-ticker natively via lazy
        # per-(resolution, ticker) state.
        all_ws_tickers = list(dict.fromkeys([self._ticker] + _CROSS_ASSET_TICKERS))
        for ws_ticker in all_ws_tickers:
            _run_async_in_thread(
                self._polygon_provider.subscribe_equity(ws_ticker, _on_equity_quote)
            )

        # Build channel list: T (trades) + Q (quotes) for every subscribed ticker
        all_channels = []
        for ws_ticker in all_ws_tickers:
            all_channels.extend([f"T.{ws_ticker}", f"Q.{ws_ticker}"])
        # Also include SPY if not already present
        if "SPY" not in all_ws_tickers:
            all_channels.extend(["T.SPY", "Q.SPY"])
            _run_async_in_thread(
                self._polygon_provider.subscribe_equity("SPY", _on_equity_quote)
            )

        # Create client
        self._polygon_client = PolygonWSClient(
            self._polygon_provider,
            use_delayed=cfg.get("use_delayed_data", False),
        )

        # Start background thread with restart loop for resilience
        def _ws_thread_main():
            MAX_RESTARTS = 10
            restart_count = 0
            while not self._shutdown_requested and restart_count < MAX_RESTARTS:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                self._ws_loop = loop
                try:
                    channels = all_channels
                    loop.run_until_complete(self._polygon_client.subscribe(channels))
                    loop.run_until_complete(self._polygon_client.connect_and_run())
                except Exception:
                    restart_count += 1
                    logger.exception("Polygon WS thread crashed (restart %d/%d)", restart_count, MAX_RESTARTS)
                    time.sleep(min(5.0 * restart_count, 30.0))
                finally:
                    loop.close()
            if restart_count >= MAX_RESTARTS:
                logger.error("Polygon WS thread exhausted %d restarts — feed is DOWN", MAX_RESTARTS)
                self._polygon_feed_dead = True

        self._ws_thread = threading.Thread(
            target=_ws_thread_main,
            name=f"bmc-polygon-ws-{self._ticker.lower()}",
            daemon=True,
        )
        self._ws_thread.start()
        logger.info("Polygon WS background thread started")

    # ------------------------------------------------------------------
    # Internal — decision cycle
    # ------------------------------------------------------------------

    def _run_decision_cycle(
        self,
        quotes: Dict[str, "Quote"],
        cfg: dict,
    ) -> List[OrderAction]:
        """Assemble features → predict → generate signal → maybe order."""
        # ── Data freshness gates (WS5) ──
        if self._polygon_feed_dead:
            logger.warning("Polygon feed is dead — skipping decision cycle")
            return []
        bar_age = time.time() - (self._last_bar_update_ts or 0)
        if self._last_bar_update_ts > 0 and bar_age > 120:
            logger.warning("Polygon data stale (%.0fs) — skipping decision cycle", bar_age)
            return []

        # ── Snapshot model + metadata (thread safety against hot-swap) ──
        # A concurrent swap_model() can update self._model and self._model_version
        # between reads.  By snapshotting everything into locals at the top, we
        # guarantee that the model used for predict_single() matches the metadata
        # recorded in lineage and signal logs.  This eliminates the race where a
        # swap fires mid-cycle and contaminates the lineage with wrong model info.
        _snap_model = self._model
        _snap_model_version = self._model_version
        _snap_model_type = self._model_type
        _snap_model_ticker = self._model_ticker
        _snap_family_id = self._family_id
        _snap_recipe_id = self._recipe_id
        _snap_recipe_label = self._recipe_label
        _snap_checkpoint_status = self._checkpoint_status
        _snap_target_column = self._target_column
        _snap_dataset_version = self._dataset_version
        _snap_bar_type = self._bar_type
        _snap_model_metrics = self._model_metrics
        _snap_top_feature_names = self._top_feature_names
        _snap_invert_signal = self._invert_signal
        _snap_optimal_threshold = self._model_optimal_threshold

        import pandas as pd
        from big_move_convexity.features.feature_stack import assemble_feature_vector
        from big_move_convexity.ml.inference import predict_single
        from big_move_convexity.signal.signal_generator import Signal, SignalConfig, generate_signal

        t = pd.Timestamp.now(tz="America/New_York")

        # Build bars by resolution from data store.
        # Bars are stored under "{bar_type}:{ticker}" keys by BarAccumulator.
        bars_by_res = {}
        for bar_type in ["time_5s", "time_15s", "time_1m"]:
            store_key = f"{bar_type}:{self._ticker}"
            bars = self._data_store.get_completed_bars(store_key, before=t)
            if not bars.empty:
                bars_by_res[bar_type] = bars

        if not bars_by_res:
            logger.debug("Decision cycle: no bars available yet")
            return []

        # Get daily features and regime
        daily_features = self._data_store.get_daily_features(t)
        regime = self._data_store.get_regime_asof(t)

        # Prior close — prefer ticker-specific key (bootstrap stores per-ticker
        # values as "prior_close:{TICKER}"); fall back to top-level which is from
        # the first bootstrapped ticker (SPY).  Without this, non-SPY tickers
        # (e.g. SLV at ~$30) would use SPY's prior close (~$580), producing
        # wildly wrong gap_magnitude and premarket_return in Group B features.
        prior_close = None
        if daily_features:
            prior_close = daily_features.get(
                f"prior_close:{self._ticker}",
                daily_features.get("prior_close"),
            )

        # SPY bars for cross-ticker features
        spy_bars = self._data_store.get_completed_bars("time_1m:SPY", before=t)

        # QQQ bars for cross-ticker features (Group C)
        qqq_bars = self._data_store.get_completed_bars("time_1m:QQQ", before=t)

        # Extra cross-asset ticker bars for Group C.
        # Pulls from _CROSS_ASSET_TICKERS + SPY (when not the primary ticker)
        # so compute_cross_asset_displacement() can find every reference ticker
        # defined in ticker_features.py (e.g. SLV references UUP, SPY, TLT, DBB).
        extra_ticker_bars = {}
        _ref_set = set(_CROSS_ASSET_TICKERS)
        if self._ticker != "SPY":
            _ref_set.add("SPY")
        _ref_set.discard(self._ticker)  # primary ticker uses bars_by_res, not extra
        for ref_ticker in sorted(_ref_set):
            ref_bars = self._data_store.get_completed_bars(f"time_1m:{ref_ticker}", before=t)
            if not ref_bars.empty:
                extra_ticker_bars[ref_ticker] = ref_bars

        # Compute session realized vol from accumulated 1m bars
        session_realized_vol = None
        primary_1m = bars_by_res.get("time_1m")
        if primary_1m is not None and len(primary_1m) >= 5:
            rets = primary_1m["close"].pct_change().dropna()
            if len(rets) >= 4:
                session_realized_vol = float(rets.std() * (390 * 252) ** 0.5)

        # Underlying price from IB quote cache
        underlying_price = None
        ticker_quote = quotes.get(self._ticker)
        if ticker_quote is not None:
            mid = getattr(ticker_quote, 'mid', None)
            if mid and mid > 0:
                underlying_price = mid
            elif hasattr(ticker_quote, 'last') and ticker_quote.last > 0:
                underlying_price = ticker_quote.last

        # Assemble feature vector
        fv = assemble_feature_vector(
            self._ticker,
            t,
            bars_by_resolution=bars_by_res,
            spy_bars=spy_bars if spy_bars is not None and not spy_bars.empty else None,
            qqq_bars=qqq_bars if qqq_bars is not None and not qqq_bars.empty else None,
            daily_features=daily_features or None,
            regime_override=regime or None,
            prior_close=prior_close,
            underlying_price=underlying_price,
            extra_ticker_bars=extra_ticker_bars or None,
            session_realized_vol=session_realized_vol,
        )

        # Inject strangle_pct as e_strangle_richness for GLD model compatibility.
        # The GLD model was trained with e_strangle_richness (from enriched dataset),
        # but the live feature stack only produces e_straddle_richness (ATM 0DTE metric).
        # Inject the daily bootstrap strangle_pct so the model has the feature.
        if cfg.get("richness_source") == "strangle_pct" and daily_features:
            _spct = daily_features.get(f"strangle_pct:{self._ticker}")
            if _spct is not None:
                fv.features["e_strangle_richness"] = float(_spct)

        # Predict — use snapshot model, not self._model (hot-swap safe)
        prediction = predict_single(_snap_model, fv.features)
        probability = prediction["probability"]

        # Auto-determine direction_mode from model when not explicitly configured
        # "auto" or None → derive from model target column.
        # Directional models (UP/DOWN) always use "long_only" — even when "both" is
        # explicitly configured — because trading the inverted low-P direction is
        # statistically unsound (e.g. DOWN model low P ≠ a reliable UP signal).
        effective_direction = cfg.get("direction_mode", None)
        _is_directional = _snap_invert_signal or ("UP" in (_snap_target_column or ""))
        if effective_direction is None or effective_direction == "auto":
            effective_direction = "long_only" if _is_directional else "both"
        elif effective_direction == "both" and _is_directional:
            # "both" on a directional model causes it to trade its "wrong" direction
            # via inversion. Force long_only to prevent cross-direction duplicate orders.
            effective_direction = "long_only"

        # Resolve effective threshold: model's optimal > ticker profile > default 0.5
        # signal_threshold_auto=True (default) uses model's validated optimal_threshold
        _cfg_threshold = cfg.get("signal_threshold", 0.5)
        if cfg.get("signal_threshold_auto", True) and _snap_optimal_threshold is not None:
            _effective_threshold = _snap_optimal_threshold
        else:
            _effective_threshold = _cfg_threshold

        # Extract current VIX level for regime gating.
        # Available from daily bootstrap via daily_features["vix_close"].
        _vix_level: float | None = None
        if daily_features:
            _vix_raw = daily_features.get("vix_close")
            if _vix_raw is not None:
                try:
                    _vix_level = float(_vix_raw)
                except (TypeError, ValueError):
                    pass

        # Extract richness metric for options gate.
        # Two sources depending on ticker config:
        # - "feature_vector" (default, SPY): e_straddle_richness from feature vector
        #   (ATM 0DTE straddle / S*σ*√T). Threshold ~1.5 for SPY.
        # - "strangle_pct" (GLD): from daily bootstrap (1% OTM strangle / underlying).
        #   Threshold ~0.004 for GLD. Computed once at session start.
        _straddle_richness: float | None = None
        _richness_source = cfg.get("richness_source", "feature_vector")
        if _richness_source == "strangle_pct":
            # Use strangle_pct from daily bootstrap (computed from Polygon options snapshot)
            if daily_features:
                _richness_raw = daily_features.get(f"strangle_pct:{self._ticker}")
                if _richness_raw is not None:
                    try:
                        _straddle_richness = float(_richness_raw)
                    except (TypeError, ValueError):
                        pass
        else:
            # Default: use e_straddle_richness from feature vector
            _richness_raw = fv.features.get("e_straddle_richness")
            if _richness_raw is not None:
                try:
                    _straddle_richness = float(_richness_raw)
                except (TypeError, ValueError):
                    pass

        # Generate signal (with straddle richness + regime gating if configured)
        signal_config = SignalConfig(
            probability_threshold=_effective_threshold,
            min_strength=cfg.get("min_signal_strength", 0.3),
            direction_mode=effective_direction,
            cooldown_minutes=cfg.get("cooldown_minutes", 15),
            straddle_richness_min=cfg.get("straddle_richness_min"),
            straddle_richness_max=cfg.get("straddle_richness_max"),
            options_gate_enabled=cfg.get("options_gate_enabled", False),
            vix_gate_min=cfg.get("vix_gate_min"),
            vix_gate_max=cfg.get("vix_gate_max"),
        )
        signal = generate_signal(prediction, self._ticker, t, signal_config,
                                 straddle_richness=_straddle_richness,
                                 vix_level=_vix_level)

        # Invert signal direction for DOWN models (flip long<->short)
        if _snap_invert_signal and signal.direction != "none":
            signal = Signal(
                timestamp=signal.timestamp,
                ticker=signal.ticker,
                direction="short" if signal.direction == "long" else "long",
                strength=signal.strength,
                probability=signal.probability,
                threshold_used=signal.threshold_used,
                metadata={**signal.metadata, "signal_inverted": True, "target_column": _snap_target_column},
            )

        # Build NaN breakdown for debugging feature health in live telemetry.
        nan_features = [
            k for k, v in fv.features.items()
            if v is None or (isinstance(v, float) and math.isnan(v))
        ]
        nan_group_counts: dict[str, int] = {}
        for feature_name in nan_features:
            if "__" in feature_name:
                group = feature_name.split("__", 1)[0]
            else:
                group = feature_name.split("_", 1)[0]
            nan_group_counts[group] = nan_group_counts.get(group, 0) + 1

        # Record signal state for telemetry
        signal_record = {
            "timestamp": str(t),
            "probability": probability,
            "direction": signal.direction,
            "strength": signal.strength,
            "n_features": fv.n_features,
            "n_nan": fv.n_nan,
            "nan_group_counts": nan_group_counts,
            "nan_feature_sample": nan_features[:20],
            "computation_ms": fv.computation_time_ms,
            "bars_available": {k: len(v) for k, v in bars_by_res.items()},
            "underlying_price": underlying_price,
            "n_cross_asset_tickers": len(extra_ticker_bars),
            "session_realized_vol": session_realized_vol,
            "vix_level": _vix_level,
            "regime_gate": signal.metadata.get("regime_gate"),
        }
        self._last_signal = signal_record

        # Record regime gate suppression in signal record for dashboard display
        if signal.metadata.get("regime_gate") == "suppressed":
            signal_record["suppressed"] = (
                f"regime_gate (VIX {_vix_level:.1f} < {cfg.get('vix_gate_min'):.0f})"
            )

        # Log every decision cycle to JSONL for offline analysis (WS1)
        # Pass snapshot metadata to ensure log entry matches the model used for prediction
        _snap_meta = {
            "family_id": _snap_family_id,
            "recipe_id": _snap_recipe_id,
            "recipe_label": _snap_recipe_label,
            "model_version": _snap_model_version,
            "model_ticker": _snap_model_ticker,
            "model_type": _snap_model_type,
        }
        self._write_signal_log(signal_record, fv, cfg, _snap_meta)

        if signal.direction == "none":
            logger.debug(
                "Decision cycle: no signal (prob=%.4f, threshold=%.4f%s%s)",
                probability, _effective_threshold,
                " [model-auto]" if _effective_threshold != _cfg_threshold else "",
                f" [regime-gated VIX={_vix_level:.1f}]" if signal.metadata.get("regime_gate") == "suppressed" else "",
            )
            return []

        # Signal fired!
        self._signals_generated += 1
        self._signal_counter += 1
        signal_id = f"sig:{datetime.now().strftime('%Y%m%d-%H%M%S')}-{self._signal_counter:03d}"
        signal_record["signal_id"] = signal_id
        logger.info(
            "SIGNAL [%s]: direction=%s, probability=%.4f, strength=%.4f",
            signal_id, signal.direction, probability, signal.strength,
        )

        # Build lineage snapshot on signal fire (WS2) — consumed by on_fill
        # Pass snapshot metadata for thread-safe lineage attribution
        _snap_lineage_meta = {
            "family_id": _snap_family_id,
            "recipe_id": _snap_recipe_id,
            "recipe_label": _snap_recipe_label,
            "checkpoint_status": _snap_checkpoint_status,
            "model_version": _snap_model_version,
            "model_type": _snap_model_type,
            "model_ticker": _snap_model_ticker,
            "model_n_features": len(_snap_model.feature_names) if _snap_model else 0,
            "model_metrics": _snap_model_metrics,
            "top_feature_names": _snap_top_feature_names,
            "target_column": _snap_target_column,
            "signal_inverted": _snap_invert_signal,
        }
        self._pending_lineage = self._build_lineage_snapshot(
            signal, signal_record, fv, cfg, underlying_price, bars_by_res,
            model_snapshot=_snap_lineage_meta,
        )

        # Check cooldown
        cooldown_s = cfg.get("cooldown_minutes", 15) * 60
        last_fill_time = self._cooldown_tracker.get(self._ticker, 0)
        if (time.time() - last_fill_time) < cooldown_s:
            logger.info("Signal suppressed by cooldown (last fill %.0fs ago)",
                        time.time() - last_fill_time)
            signal_record["suppressed"] = "cooldown"
            self._signal_history.append(signal_record)
            return []

        self._signal_history.append(signal_record)

        # Check auto_entry
        if not cfg.get("auto_entry", False):
            logger.info("Signal recorded but auto_entry=False; no order placed")
            signal_record["suppressed"] = "auto_entry_disabled"
            return []

        # Select option contract and build order
        return self._build_entry_order(signal, cfg, underlying_price)

    def _build_entry_order(
        self,
        signal,
        cfg: dict,
        underlying_price: Optional[float],
    ) -> List[OrderAction]:
        """Select an OTM option contract and return an OrderAction."""
        if underlying_price is None or underlying_price <= 0:
            logger.warning("Cannot build entry order: no underlying price")
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "no_underlying_price"
            return []

        # Hard direction gate (post-signal): never allow an order side that
        # conflicts with the configured direction_mode. This is a final safety
        # check that protects against any upstream signal-direction transforms.
        direction_mode = (cfg.get("direction_mode") or "auto").lower()
        if direction_mode == "auto":
            # "auto" follows model semantics:
            # directional models default to long_only; symmetric models allow both.
            direction_mode = "long_only" if self._target_column and ("UP" in self._target_column or "DOWN" in self._target_column) else "both"

        if direction_mode == "long_only" and signal.direction != "long":
            logger.warning(
                "Direction gate blocked entry: mode=long_only signal=%s ticker=%s target=%s",
                signal.direction,
                self._ticker,
                self._target_column or "unknown",
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "direction_mode_long_only"
            return []
        if direction_mode == "short_only" and signal.direction != "short":
            logger.warning(
                "Direction gate blocked entry: mode=short_only signal=%s ticker=%s target=%s",
                signal.direction,
                self._ticker,
                self._target_column or "unknown",
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "direction_mode_short_only"
            return []

        # Determine option type from signal direction.
        # long signal → CALL (bullish bet), short signal → PUT (bearish bet).
        right = "C" if signal.direction == "long" else "P"

        # ─── DEFINITIVE OPTION-TYPE GATE ───────────────────────────────
        # This is the LAST LINE OF DEFENSE ensuring direction_mode is
        # honored at the option-type level, not just the signal-direction
        # level.  The signal-direction gate above (lines ~1381-1400)
        # should already block mismatches, but edge cases can slip
        # through:
        #   • DOWN-model inversion producing "short" that somehow
        #     bypasses the direction gate
        #   • Symmetric model running with direction_mode resolved to
        #     "both" instead of the user's intended "long_only"
        #   • Config propagation lag across directional strategy pairs
        #
        # Semantic contract:
        #   long_only  → CALLS ONLY  (bullish positions only)
        #   short_only → PUTS ONLY   (bearish positions only)
        #   both       → either
        #
        # If this gate ever fires, it means there's a bug upstream.
        # The warning log makes it easy to trace.
        if direction_mode == "long_only" and right == "P":
            logger.warning(
                "OPTION-TYPE GATE blocked PUT in long_only mode: "
                "signal.direction=%s ticker=%s target=%s model=%s "
                "(this indicates an upstream signal-direction bug)",
                signal.direction, self._ticker,
                self._target_column or "?",
                self._model_version or "?",
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "option_type_gate_long_only"
            return []
        if direction_mode == "short_only" and right == "C":
            logger.warning(
                "OPTION-TYPE GATE blocked CALL in short_only mode: "
                "signal.direction=%s ticker=%s target=%s model=%s "
                "(this indicates an upstream signal-direction bug)",
                signal.direction, self._ticker,
                self._target_column or "?",
                self._model_version or "?",
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "option_type_gate_short_only"
            return []

        # Calculate OTM strike
        otm_pct = cfg.get("otm_target_pct", 1.0) / 100.0  # 1.0% = 0.010
        if right == "C":
            target_strike = underlying_price * (1 + otm_pct)
        else:
            target_strike = underlying_price * (1 - otm_pct)

        # Round to nearest strike increment (ticker-specific)
        increment = cfg.get("strike_increment", 0)
        if not increment:
            profile = _get_ticker_profile(self._ticker)
            increment = profile["strike_increment"]
        strike = round(target_strike / increment) * increment

        # Expiry selection: iterate through preferred DTEs, skipping weekends.
        # SPY/QQQ/IWM have daily expirations; SLV/GLD have weekly (Fri) only.
        # The quote fetch below will validate whether the contract actually exists.
        preferred_dte = cfg.get("preferred_dte", [1, 2])
        from datetime import timedelta
        now_et = datetime.now(ZoneInfo("America/New_York"))

        # Build candidate expiry dates from preferred DTEs.
        # For each DTE, advance past weekends (Sat→Mon, Sun→Mon).
        # Then fill in any remaining weekdays up to max_dte+2 business days
        # so that weekly-only tickers (SLV, GLD) can reach the next Friday
        # even when preferred_dte doesn't span a full week.
        _candidate_expiries = []
        _seen = set()
        max_dte = max(preferred_dte) if preferred_dte else 5
        # Start with the preferred DTEs
        for dte in sorted(preferred_dte):
            candidate = now_et + timedelta(days=dte)
            if candidate.weekday() >= 5:  # weekend → next Monday
                candidate += timedelta(days=(7 - candidate.weekday()))
            expiry_s = candidate.strftime("%Y%m%d")
            if expiry_s not in _seen:
                _seen.add(expiry_s)
                _candidate_expiries.append((expiry_s, candidate))
        # Extend: add each weekday from tomorrow through max_dte+4 calendar days
        # to cover gaps (e.g. Friday→next Friday for weekly-only tickers)
        for extra_day in range(1, max_dte + 5):
            candidate = now_et + timedelta(days=extra_day)
            if candidate.weekday() >= 5:
                continue  # skip weekends
            expiry_s = candidate.strftime("%Y%m%d")
            if expiry_s not in _seen:
                _seen.add(expiry_s)
                _candidate_expiries.append((expiry_s, candidate))
        # Sort by date
        _candidate_expiries.sort(key=lambda x: x[0])

        if not _candidate_expiries:
            logger.warning("No valid expiry candidates for %s — skipping entry", self._ticker)
            if self._last_signal is not None:
                self._last_signal["suppressed"] = "no_valid_expiry"
            return []

        # Default to first candidate; the quote-fetch loop below may advance it
        expiry_str = _candidate_expiries[0][0]
        expiry_date = _candidate_expiries[0][1]

        # Premium / spread constraints
        max_spread = cfg.get("max_spread", 0.05)
        premium_min = cfg.get("premium_min", 0.10)
        premium_max = cfg.get("premium_max", 3.00)

        # Determine quantity based on budget
        # Budget is the hard cap — never spend more than this per entry.
        budget = cfg.get("contract_budget_usd", 150.0)
        max_contracts = cfg.get("max_contracts", 5)

        # Cap effective premium at what the budget can afford (1 contract = 100 shares)
        max_affordable_premium = budget / 100.0
        effective_premium_max = min(premium_max, max_affordable_premium)

        if effective_premium_max < premium_min:
            logger.info(
                "Budget gate: $%.0f budget (max $%.2f/share) below premium_min $%.2f — skipping %s entry",
                budget, max_affordable_premium, premium_min, self._ticker,
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = f"budget_too_low (${budget:.0f} max ${max_affordable_premium:.2f}/sh < min ${premium_min:.2f})"
            return []

        estimated_premium = (premium_min + effective_premium_max) / 2.0
        qty = min(max_contracts, max(1, int(budget / (estimated_premium * 100))))

        # ── Try each candidate expiry until we get a valid quote ──
        # Tickers like SLV/GLD only have weekly (Fri) expirations, so the
        # nearest DTE may not have a listed contract.  We iterate through
        # candidates and use the first one that returns quote data.
        limit_price = round(max_affordable_premium, 2)  # budget cap fallback
        opt_bid = None
        opt_ask = None
        contract_dict = None

        for expiry_str, expiry_date in _candidate_expiries:
            trading_class = _get_option_trading_class(self._ticker, expiry_date)
            candidate_contract = {
                "symbol": self._ticker,
                "secType": "OPT",
                "exchange": "SMART",
                "currency": "USD",
                "strike": strike,
                "lastTradeDateOrContractMonth": expiry_str,
                "right": right,
                "multiplier": "100",
                "tradingClass": trading_class,
            }

            if self._fetch_option_quote is not None:
                try:
                    quote = self._fetch_option_quote(candidate_contract)
                    q_bid = quote.get("bid")
                    q_ask = quote.get("ask")
                    if (q_ask is not None and q_ask > 0) or (q_bid is not None and q_bid > 0):
                        # Valid quote — use this expiry
                        opt_bid = q_bid
                        opt_ask = q_ask
                        contract_dict = candidate_contract
                        break
                    else:
                        logger.info(
                            "No quote data for %s %.1f%s %s — trying next expiry",
                            self._ticker, strike, right, expiry_str,
                        )
                        continue
                except Exception:
                    logger.info(
                        "Quote fetch failed for %s %.1f%s %s — trying next expiry",
                        self._ticker, strike, right, expiry_str,
                    )
                    continue
            else:
                # No quote fetcher — use first candidate
                contract_dict = candidate_contract
                break

        if contract_dict is None:
            logger.warning(
                "No valid contract found for %s %.1f%s across %d expiry candidates — skipping entry",
                self._ticker, strike, right, len(_candidate_expiries),
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = f"no_contract ({self._ticker} {strike:.0f}{right}, {len(_candidate_expiries)} expiries tried)"
            return []

        # Finalize expiry_str from the winning contract
        expiry_str = contract_dict["lastTradeDateOrContractMonth"]
        actual_dte = (datetime.strptime(expiry_str, "%Y%m%d").date() - now_et.date()).days
        dte_label = "0DTE" if actual_dte == 0 else f"{actual_dte}d"

        # Store contract info in signal record for risk manager spawn
        self._last_signal["option_contract"] = {
            "symbol": self._ticker,
            "strike": strike,
            "expiry": expiry_str,
            "right": right,
            "preferred_dte": preferred_dte,
            "max_spread": max_spread,
            "premium_range": [premium_min, premium_max],
        }

        # Compute limit price: ask + spread (adaptive to current market),
        # capped at the budget maximum. This avoids paying dumb prices in
        # fast markets while still filling in normal conditions.
        if opt_ask is not None and opt_ask > 0 and opt_bid is not None and opt_bid > 0:
            spread_val = opt_ask - opt_bid
            adaptive_limit = opt_ask + spread_val
            limit_price = round(min(adaptive_limit, max_affordable_premium), 2)
            logger.info(
                "Option quote: bid=$%.2f ask=$%.2f spread=$%.2f → adaptive limit=$%.2f (budget cap=$%.2f)",
                opt_bid, opt_ask, spread_val, adaptive_limit, max_affordable_premium,
            )
        elif opt_ask is not None and opt_ask > 0:
            # Have ask but no bid — use ask + 20% as limit
            adaptive_limit = opt_ask * 1.20
            limit_price = round(min(adaptive_limit, max_affordable_premium), 2)
            logger.info(
                "Option quote: bid=none ask=$%.2f → adaptive limit=$%.2f (budget cap=$%.2f)",
                opt_ask, adaptive_limit, max_affordable_premium,
            )

        # Budget gate on actual ask: if the current ask exceeds our budget, skip
        if opt_ask is not None and opt_ask > max_affordable_premium:
            logger.info(
                "Ask $%.2f exceeds budget cap $%.2f — skipping %s entry",
                opt_ask, max_affordable_premium, self._ticker,
            )
            if self._last_signal is not None:
                self._last_signal["suppressed"] = f"ask_exceeds_budget (ask ${opt_ask:.2f} > cap ${max_affordable_premium:.2f})"
            return []

        # Attach option selection details to pending lineage (WS2)
        if self._pending_lineage is not None:
            self._pending_lineage["option_selection"] = {
                "strike": strike,
                "right": right,
                "expiry": expiry_str,
                "dte": actual_dte,
                "opt_bid": opt_bid,
                "opt_ask": opt_ask,
                "spread": (opt_ask - opt_bid) if opt_bid and opt_ask else None,
                "limit_price": limit_price,
                "budget": budget,
                "max_affordable_premium": max_affordable_premium,
            }

        multiplier = float(contract_dict.get("multiplier", 100))
        order = OrderAction(
            strategy_id="",  # filled by engine
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=qty,
            contract_dict=contract_dict,
            limit_price=limit_price,
            estimated_notional=limit_price * qty * multiplier,
            reason=f"BMC[{self._ticker}] signal: {signal.direction} p={signal.probability:.3f} "
                   f"strike={strike} {right} {dte_label} limit=${limit_price:.2f}",
        )

        logger.info(
            "Entry order: BUY %d %s %s %.2f %s @ LMT $%.2f (bid=$%s ask=$%s budget=$%.0f)",
            qty, right, self._ticker, strike, dte_label, limit_price,
            f"{opt_bid:.2f}" if opt_bid else "?",
            f"{opt_ask:.2f}" if opt_ask else "?",
            budget,
        )
        return [order]

    # ------------------------------------------------------------------
    # Internal — scan window check
    # ------------------------------------------------------------------

    def _is_in_scan_window(self, cfg: dict) -> bool:
        """Check if current time (ET) is within the configured scan window."""
        try:
            now = datetime.now(ZoneInfo("America/New_York"))
            hour, minute = now.hour, now.minute
            current_minutes = hour * 60 + minute

            start_parts = cfg.get("scan_start", "09:45").split(":")
            end_parts = cfg.get("scan_end", "15:45").split(":")
            start_minutes = int(start_parts[0]) * 60 + int(start_parts[1])
            end_minutes = int(end_parts[0]) * 60 + int(end_parts[1])

            return start_minutes <= current_minutes <= end_minutes
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Execution profile & segment tracking
    # ------------------------------------------------------------------

    def _compute_execution_profile(self, cfg: dict) -> tuple[str, str]:
        """Compute execution profile ID and label from merged config.

        Returns (profile_id_hash, profile_label).
        """
        # Keys that define the execution profile
        profile_keys = {
            "signal_threshold": cfg.get("signal_threshold", 0.5),
            "min_signal_strength": cfg.get("min_signal_strength", 0.3),
            "direction_mode": cfg.get("direction_mode") or "auto",
            "cooldown_minutes": cfg.get("cooldown_minutes", 15),
            "decision_interval_seconds": cfg.get("decision_interval_seconds", 60),
            "otm_target_pct": cfg.get("otm_target_pct", 1.0),
            "contract_budget_usd": cfg.get("contract_budget_usd", 150.0),
            "max_contracts": cfg.get("max_contracts", 5),
            "auto_entry": cfg.get("auto_entry", False),
            "premium_min": cfg.get("premium_min", 0.10),
            "premium_max": cfg.get("premium_max", 3.00),
        }
        # Include risk preset
        risk_preset = cfg.get("risk_preset", "intraday_convexity")
        profile_keys["risk_preset"] = risk_preset

        # Machine ID: content hash
        canon = json.dumps(profile_keys, sort_keys=True, default=str)
        profile_hash = f"ep:{hashlib.sha256(canon.encode()).hexdigest()[:12]}"

        # Human label
        preset_short = {"zero_dte_convexity": "z0c", "intraday_convexity": "i1c", "intraday_premium": "inp", "conservative": "con", "custom": "cst"}.get(risk_preset, risk_preset[:3])
        threshold = int(profile_keys["signal_threshold"] * 100)
        budget = int(profile_keys["contract_budget_usd"])
        profile_label = f"ep:{preset_short}-t{threshold}-b{budget}"

        return profile_hash, profile_label

    def _on_segment_change(self, old_profile: str, new_profile: str, cfg: dict) -> None:
        """Handle execution profile change: log segment_change event."""
        logger.info(
            "Segment change: segment=%d, old_profile=%s, new_profile=%s",
            self._segment_idx, old_profile, new_profile,
        )
        # Write segment_change event to signal log
        try:
            log_dir = Path(__file__).parent.parent / "signal_logs"
            log_dir.mkdir(exist_ok=True)
            log_file = log_dir / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"
            event = {
                "event": "segment_change",
                "session_id": self._session_id,
                "segment_idx": self._segment_idx,
                "old_profile": old_profile,
                "new_profile": new_profile,
                "timestamp": datetime.now().isoformat(),
                "family_id": self._family_id,
                "model_version": self._model_version,
            }
            with open(log_file, "a") as f:
                f.write(json.dumps(event, default=str) + "\n")
        except Exception:
            logger.debug("Failed to write segment_change event", exc_info=True)

    # ------------------------------------------------------------------
    # Signal logging & lineage (WS1, WS2)
    # ------------------------------------------------------------------

    def _write_signal_log(self, signal_record: dict, fv, cfg: dict,
                          model_snapshot: Optional[dict] = None) -> None:
        """Append decision cycle to daily JSONL for offline analysis.

        Args:
            model_snapshot: Pre-captured model metadata from _run_decision_cycle.
                Ensures log entries match the exact model used for prediction,
                even if a hot-swap occurs mid-cycle.  Falls back to self._ fields
                for callers that don't pass it (backward compat).
        """
        ms = model_snapshot or {}
        try:
            log_dir = Path(__file__).parent.parent / "signal_logs"
            log_dir.mkdir(exist_ok=True)
            log_file = log_dir / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"

            entry = {
                **signal_record,
                # Taxonomy fields (prefer snapshot, fall back to self._)
                "strategy": "bmc",
                "family_id": ms.get("family_id") or self._family_id,
                "recipe_id": ms.get("recipe_id") or self._recipe_id,
                "recipe_label": ms.get("recipe_label") or self._recipe_label,
                "session_id": self._session_id,
                "segment_idx": self._segment_idx,
                "execution_profile_id": self._current_profile_id,
                "execution_profile_label": self._current_profile_label,
                # Model identity (prefer snapshot)
                "model_version": ms.get("model_version") or self._model_version,
                "model_ticker": ms.get("model_ticker") or self._model_ticker,
                "model_type": ms.get("model_type") or self._model_type,
                "features": fv.features if fv else {},
                "nan_features": [
                    k for k, v in (fv.features if fv else {}).items()
                    if v is None or (isinstance(v, float) and math.isnan(v))
                ],
                "config_snapshot": {
                    k: cfg.get(k) for k in (
                        "signal_threshold", "min_signal_strength", "direction_mode",
                        "cooldown_minutes", "decision_interval_seconds", "otm_target_pct",
                        "contract_budget_usd", "max_contracts", "auto_entry",
                        "options_gate_enabled", "straddle_richness_min",
                        "straddle_richness_max", "vix_gate_min", "vix_gate_max",
                    )
                },
            }
            with open(log_file, "a") as f:
                f.write(json.dumps(entry, default=str) + "\n")
        except Exception:
            logger.debug("Failed to write signal log", exc_info=True)

    def _build_lineage_snapshot(self, signal, signal_record, fv, cfg,
                                underlying_price, bars_by_res,
                                model_snapshot: Optional[dict] = None):
        """Build a lineage dict capturing the full decision context for a fired signal.

        Args:
            model_snapshot: Pre-captured model metadata from _run_decision_cycle.
                Ensures lineage matches the exact model used for prediction,
                even if a hot-swap occurs mid-cycle.
        """
        ms = model_snapshot or {}
        feature_hash = ""
        if fv and fv.features:
            try:
                feature_hash = hashlib.sha256(
                    json.dumps(sorted(fv.features.items()), default=str).encode()
                ).hexdigest()[:16]
            except Exception:
                pass

        return {
            # Taxonomy identity (6-level hierarchy)
            "strategy": "bmc",
            "family_id": ms.get("family_id") or self._family_id,
            "recipe_id": ms.get("recipe_id") or self._recipe_id,
            "recipe_label": ms.get("recipe_label") or self._recipe_label,
            "checkpoint_status": ms.get("checkpoint_status") or self._checkpoint_status,
            "session_id": self._session_id,
            "segment_idx": self._segment_idx,
            "execution_profile_id": self._current_profile_id,
            "execution_profile_label": self._current_profile_label,
            "signal_id": signal_record.get("signal_id", ""),
            # Model identity (prefer snapshot for correctness)
            "model_version": ms.get("model_version") or self._model_version,
            "model_type": ms.get("model_type") or self._model_type,
            "model_ticker": ms.get("model_ticker") or self._model_ticker,
            "model_n_features": ms.get("model_n_features", len(self._model.feature_names) if self._model else 0),
            "model_metrics": ms.get("model_metrics") or self._model_metrics,
            "target_column": ms.get("target_column") or self._target_column,
            "signal_inverted": ms.get("signal_inverted", self._invert_signal),
            "signal": {
                "timestamp": signal_record.get("timestamp"),
                "direction": signal.direction,
                "probability": signal.probability,
                "strength": signal.strength,
                "threshold_used": signal.threshold_used if hasattr(signal, 'threshold_used') else None,
                "n_features": signal_record.get("n_features"),
                "n_nan": signal_record.get("n_nan"),
                "computation_ms": signal_record.get("computation_ms"),
            },
            "config_snapshot": {
                k: cfg.get(k) for k in (
                    "signal_threshold", "min_signal_strength", "direction_mode",
                    "cooldown_minutes", "decision_interval_seconds", "otm_target_pct",
                    "contract_budget_usd", "max_contracts", "auto_entry",
                    "options_gate_enabled", "premium_min", "premium_max", "max_spread",
                )
            },
            "feature_fingerprint": {
                "top_features": {name: fv.features.get(name) for name in (ms.get("top_feature_names") or self._top_feature_names)} if fv else {},
                "n_total": fv.n_features if fv else 0,
                "n_nan": fv.n_nan if fv else 0,
                "feature_hash": feature_hash,
            },
            "market_context": {
                "underlying_price": underlying_price,
                "bars_available": {res: len(df) for res, df in (bars_by_res or {}).items()},
            },
        }
