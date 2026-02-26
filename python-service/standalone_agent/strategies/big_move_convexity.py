"""BigMoveConvexityStrategy — OTM 0DTE options signal agent (multi-ticker).

Implements ExecutionStrategy to plug into the existing 100ms eval loop.
Wraps the big_move_convexity ML pipeline:

    Polygon WS → BarAccumulator → LiveDataStore
                                       │
                    [every decision_interval] assemble features → predict → signal
                                       │
                    [signal fires] → select OTM option → OrderAction(BUY)
                                       │
                    [on_fill] → spawn RiskManagerStrategy (zero_dte_convexity preset)

Configurable parameters are hot-reloadable via execution_config.

Multi-ticker: Each strategy instance is parameterized by config["ticker"].
Run one instance per ticker (e.g. strategy_id="bmc_spy", "bmc_slv").
The execution engine evaluates all instances independently.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from quote_cache import Quote

# Resolve big_move_convexity import path
_BMC_PATH = os.environ.get("BMC_PATH", "")
if not _BMC_PATH:
    # Default: ../../py_proj relative to standalone_agent/
    _BMC_PATH = str(Path(__file__).resolve().parent.parent.parent.parent / "py_proj")
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
    "min_signal_strength": 0.3,
    "direction_mode": "both",          # "long_only" | "short_only" | "both"
    "cooldown_minutes": 15,
    "decision_interval_seconds": 60,   # 1 minute
    "max_contracts": 5,
    "contract_budget_usd": 150.0,
    "scan_start": "13:30",            # HH:MM ET
    "scan_end": "15:55",
    "otm_target_pct": 0.20,           # 20bp OTM
    "auto_entry": False,              # paper trading safety
    "model_registry_path": "",        # auto-resolved if empty
    "use_delayed_data": False,        # paid Polygon tier — real-time
    "polygon_channels": [],           # auto-derived from ticker if empty
    "strike_increment": 0.0,          # 0 = auto-detect from ticker
    # DTE / option selection
    "preferred_dte": [0, 1],          # acceptable days-to-expiry (0DTE first)
    "max_spread": 0.05,               # max bid-ask spread in $ to accept
    "premium_min": 0.10,              # min option premium ($) to consider
    "premium_max": 3.00,              # max option premium ($) to consider
    # Signal gating — straddle richness thresholds (passed to SignalConfig)
    "straddle_richness_max": 1.5,     # suppress signal above this richness
    "straddle_richness_ideal": 0.9,   # ideal richness for full signal strength
    "options_gate_enabled": False,    # enable straddle richness gate
}

# Cross-asset tickers for correlation features (Group C) and backfill
_CROSS_ASSET_TICKERS = ["QQQ", "IWM", "TLT", "GLD", "HYG"]

# Ticker-specific defaults for option selection, spreads, and Polygon channels.
# These override _DEFAULTS when a ticker profile is applied in on_start().
_TICKER_PROFILES: dict[str, dict[str, Any]] = {
    "SPY": {
        "strike_increment": 0.50,
        "polygon_channels": ["T.SPY", "Q.SPY"],
        "preferred_dte": [0, 1],          # daily 0DTE available
        "max_spread": 0.05,               # tight bid-ask ($0.01-$0.03 typical)
        "premium_min": 0.10,
        "premium_max": 3.00,
        "scan_start": "13:30",
        "scan_end": "15:55",
        "contract_budget_usd": 150.0,
        "straddle_richness_max": 1.5,
        "straddle_richness_ideal": 0.9,
    },
    "SLV": {
        "strike_increment": 0.50,
        "polygon_channels": ["T.SLV", "Q.SLV"],
        "preferred_dte": [0, 1, 2, 3, 4, 5],  # weekly expirations only (Fri)
        "max_spread": 0.20,               # wider bid-ask ($0.05-$0.15 typical)
        "premium_min": 0.05,              # lower premiums (~$30 underlying)
        "premium_max": 1.50,
        "scan_start": "08:30",            # morning session for SLV
        "scan_end": "13:30",
        "contract_budget_usd": 50.0,
        "straddle_richness_max": 2.5,     # SLV IV ~2x SPY, higher richness normal
        "straddle_richness_ideal": 1.5,
    },
    "QQQ": {
        "strike_increment": 0.50,
        "polygon_channels": ["T.QQQ", "Q.QQQ"],
        "preferred_dte": [0, 1],
        "max_spread": 0.05,
        "premium_min": 0.10,
        "premium_max": 3.00,
    },
    "IWM": {
        "strike_increment": 0.50,
        "polygon_channels": ["T.IWM", "Q.IWM"],
        "preferred_dte": [0, 1],
        "max_spread": 0.10,
        "premium_min": 0.05,
        "premium_max": 2.00,
    },
    "GLD": {
        "strike_increment": 0.50,
        "polygon_channels": ["T.GLD", "Q.GLD"],
        "preferred_dte": [0, 1, 2, 3, 4, 5],  # weekly expirations
        "max_spread": 0.15,
        "premium_min": 0.05,
        "premium_max": 2.00,
        "straddle_richness_max": 2.0,
        "straddle_richness_ideal": 1.2,
    },
}

def _get_ticker_profile(ticker: str) -> dict[str, Any]:
    """Return ticker-specific defaults, falling back to generic ETF profile."""
    if ticker in _TICKER_PROFILES:
        return _TICKER_PROFILES[ticker]
    # Generic fallback for unknown tickers
    return {
        "strike_increment": 0.50,
        "polygon_channels": [f"T.{ticker}", f"Q.{ticker}"],
        "preferred_dte": [0, 1, 2, 3, 4, 5],
        "max_spread": 0.15,
        "premium_min": 0.05,
        "premium_max": 2.00,
    }


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
            "preset": config.get("risk_preset", "zero_dte_convexity"),
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
            logger.info(
                "BigMoveConvexityStrategy[%s] started: auto_entry=%s, threshold=%.2f, "
                "interval=%ds, scan=%s-%s, delayed=%s",
                self._ticker,
                cfg["auto_entry"], cfg["signal_threshold"],
                cfg["decision_interval_seconds"],
                cfg["scan_start"], cfg["scan_end"],
                cfg["use_delayed_data"],
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
            "preset": config.get("risk_preset", self._risk_config.get("preset", "zero_dte_convexity")),
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
                self._spawn_risk_manager(risk_config)
                logger.info(
                    "Spawned RiskManagerStrategy for BMC position: strike=%.2f, qty=%d",
                    contract_info.get("strike", 0), int(filled_qty),
                )
            except Exception:
                logger.exception("Failed to spawn RiskManagerStrategy")

    def on_order_placed(self, order_id: int, result: dict, config: dict) -> None:
        logger.info("BMC order placed: order_id=%d, result=%s", order_id, result)

    def on_order_dead(self, order_id: int, reason: str, config: dict) -> None:
        logger.warning("BMC order dead: order_id=%d, reason=%s", order_id, reason)

    def on_stop(self, config: dict) -> None:
        """Stop Polygon WS, cleanup."""
        logger.info("BigMoveConvexityStrategy[%s] stopping", self._ticker)

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

        return state

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

        registry = ModelRegistry(registry_path)
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

        # Run daily bootstrap — use a helper thread because on_start is called
        # from within the agent's running asyncio event loop (Python 3.12+
        # forbids nested run_until_complete on the same thread).
        bootstrap = DailyBootstrap()
        # Bootstrap the target ticker + SPY + all cross-asset tickers
        bootstrap_tickers = list(dict.fromkeys(
            [self._ticker, "SPY"] + _CROSS_ASSET_TICKERS
        ))
        try:
            bootstrap_result = _run_async_in_thread(
                bootstrap.bootstrap(self._data_store, tickers=bootstrap_tickers)
            )
            logger.info("Daily bootstrap complete: %s", bootstrap_result)
        except Exception:
            logger.warning("Daily bootstrap failed — features may be incomplete", exc_info=True)

        # Backfill today's intraday 1m bars for all tickers so features have
        # full session data from 09:30, not just from WS connect time.
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

        # Start background thread with its own event loop
        def _ws_thread_main():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._ws_loop = loop
            try:
                # Subscribe to all channels (single WS connection handles all)
                channels = all_channels
                loop.run_until_complete(self._polygon_client.subscribe(channels))
                loop.run_until_complete(self._polygon_client.connect_and_run())
            except Exception:
                logger.exception("Polygon WS thread exited with error")
            finally:
                loop.close()

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

        # Prior close
        prior_close = None
        if daily_features:
            prior_close = daily_features.get("prior_close")

        # SPY bars for cross-ticker features
        spy_bars = self._data_store.get_completed_bars("time_1m:SPY", before=t)

        # QQQ bars for cross-ticker features (Group C)
        qqq_bars = self._data_store.get_completed_bars("time_1m:QQQ", before=t)

        # Extra cross-asset ticker bars (IWM, TLT, GLD, HYG) for Group C
        extra_ticker_bars = {}
        for ref_ticker in ["IWM", "TLT", "GLD", "HYG"]:
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

        # Predict
        prediction = predict_single(self._model, fv.features)
        probability = prediction["probability"]

        # Generate signal (with straddle richness gating if configured)
        signal_config = SignalConfig(
            probability_threshold=cfg.get("signal_threshold", 0.5),
            min_strength=cfg.get("min_signal_strength", 0.3),
            direction_mode=cfg.get("direction_mode", "both"),
            cooldown_minutes=cfg.get("cooldown_minutes", 15),
            straddle_richness_max=cfg.get("straddle_richness_max", 1.5),
            straddle_richness_ideal=cfg.get("straddle_richness_ideal", 0.9),
            options_gate_enabled=cfg.get("options_gate_enabled", False),
        )
        signal = generate_signal(prediction, self._ticker, t, signal_config)

        # Record signal state for telemetry
        signal_record = {
            "timestamp": str(t),
            "probability": probability,
            "direction": signal.direction,
            "strength": signal.strength,
            "n_features": fv.n_features,
            "n_nan": fv.n_nan,
            "computation_ms": fv.computation_time_ms,
            "bars_available": {k: len(v) for k, v in bars_by_res.items()},
            "underlying_price": underlying_price,
            "n_cross_asset_tickers": len(extra_ticker_bars),
            "session_realized_vol": session_realized_vol,
        }
        self._last_signal = signal_record

        if signal.direction == "none":
            logger.debug(
                "Decision cycle: no signal (prob=%.4f, threshold=%.2f)",
                probability, cfg.get("signal_threshold", 0.5),
            )
            return []

        # Signal fired!
        self._signals_generated += 1
        logger.info(
            "SIGNAL: direction=%s, probability=%.4f, strength=%.4f",
            signal.direction, probability, signal.strength,
        )

        # Check cooldown
        cooldown_s = cfg.get("cooldown_minutes", 15) * 60
        last_signal_time = self._cooldown_tracker.get(self._ticker, 0)
        if (time.time() - last_signal_time) < cooldown_s:
            logger.info("Signal suppressed by cooldown (last signal %.0fs ago)",
                        time.time() - last_signal_time)
            signal_record["suppressed"] = "cooldown"
            self._signal_history.append(signal_record)
            return []

        self._cooldown_tracker[self._ticker] = time.time()
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
            return []

        # Determine direction
        right = "C" if signal.direction == "long" else "P"

        # Calculate OTM strike
        otm_pct = cfg.get("otm_target_pct", 0.20) / 100.0  # 0.20% = 0.0020
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

        # Expiry selection: pick the nearest acceptable DTE.
        # SPY has daily 0DTE; SLV only has weekly (Fri) expirations.
        preferred_dte = cfg.get("preferred_dte", [0, 1])
        from datetime import timedelta
        min_dte = min(preferred_dte) if preferred_dte else 0
        expiry_date = datetime.now() + timedelta(days=min_dte)
        expiry_str = expiry_date.strftime("%Y%m%d")

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
            return []

        estimated_premium = (premium_min + effective_premium_max) / 2.0
        qty = min(max_contracts, max(1, int(budget / (estimated_premium * 100))))

        contract_dict = {
            "symbol": self._ticker,
            "secType": "OPT",
            "exchange": "SMART",
            "currency": "USD",
            "strike": strike,
            "lastTradeDateOrContractMonth": expiry_str,
            "right": right,
            "multiplier": "100",
        }

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

        dte_label = "0DTE" if min_dte == 0 else f"{min_dte}d"

        # Compute limit price: ask + spread (adaptive to current market),
        # capped at the budget maximum. This avoids paying dumb prices in
        # fast markets while still filling in normal conditions.
        limit_price = round(max_affordable_premium, 2)  # budget cap fallback
        opt_bid = None
        opt_ask = None

        if self._fetch_option_quote is not None:
            try:
                quote = self._fetch_option_quote(contract_dict)
                opt_bid = quote.get("bid")
                opt_ask = quote.get("ask")
                if opt_ask is not None and opt_ask > 0 and opt_bid is not None and opt_bid > 0:
                    spread = opt_ask - opt_bid
                    adaptive_limit = opt_ask + spread
                    limit_price = round(min(adaptive_limit, max_affordable_premium), 2)
                    logger.info(
                        "Option quote: bid=$%.2f ask=$%.2f spread=$%.2f → adaptive limit=$%.2f (budget cap=$%.2f)",
                        opt_bid, opt_ask, spread, adaptive_limit, max_affordable_premium,
                    )
                elif opt_ask is not None and opt_ask > 0:
                    # Have ask but no bid — use ask + 20% as limit
                    adaptive_limit = opt_ask * 1.20
                    limit_price = round(min(adaptive_limit, max_affordable_premium), 2)
                    logger.info(
                        "Option quote: bid=none ask=$%.2f → adaptive limit=$%.2f (budget cap=$%.2f)",
                        opt_ask, adaptive_limit, max_affordable_premium,
                    )
                else:
                    logger.info("Option quote returned no usable bid/ask — using budget cap $%.2f", max_affordable_premium)
            except Exception:
                logger.warning("Failed to fetch option quote — using budget cap $%.2f", max_affordable_premium, exc_info=True)

        # Budget gate on actual ask: if the current ask exceeds our budget, skip
        if opt_ask is not None and opt_ask > max_affordable_premium:
            logger.info(
                "Ask $%.2f exceeds budget cap $%.2f — skipping %s entry",
                opt_ask, max_affordable_premium, self._ticker,
            )
            return []

        order = OrderAction(
            strategy_id="",  # filled by engine
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=qty,
            contract_dict=contract_dict,
            limit_price=limit_price,
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
            now = datetime.now()
            # Simple ET approximation for US East (handles most cases)
            # The execution engine runs on the local machine which is typically ET
            hour, minute = now.hour, now.minute
            current_minutes = hour * 60 + minute

            start_parts = cfg.get("scan_start", "13:30").split(":")
            end_parts = cfg.get("scan_end", "15:55").split(":")
            start_minutes = int(start_parts[0]) * 60 + int(start_parts[1])
            end_minutes = int(end_parts[0]) * 60 + int(end_parts[1])

            return start_minutes <= current_minutes <= end_minutes
        except Exception:
            return False
