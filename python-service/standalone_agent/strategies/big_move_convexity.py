"""BigMoveConvexityStrategy — 20bp OTM 0DTE SPY options signal agent.

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

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

_DEFAULTS: dict[str, Any] = {
    "signal_threshold": 0.5,
    "min_signal_strength": 0.3,
    "direction_mode": "both",          # "long_only" | "both"
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
    "polygon_channels": ["T.SPY", "Q.SPY"],
}


class BigMoveConvexityStrategy(ExecutionStrategy):
    """Entry strategy for 20bp OTM 0DTE SPY options.

    Runs the big_move_convexity ML pipeline on the execution engine's 100ms
    eval loop. Most ticks return [] immediately; the heavy feature-compute +
    predict cycle runs only every ``decision_interval_seconds`` during the
    configured scan window.
    """

    def __init__(self) -> None:
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

        # Callback for spawning risk manager (wired by IBDataAgent)
        self._spawn_risk_manager: Optional[Callable] = None

        # Start time for uptime tracking
        self._start_time: float = 0.0
        self._started = False
        self._startup_error: str = ""

    # ------------------------------------------------------------------
    # ExecutionStrategy interface
    # ------------------------------------------------------------------

    def get_subscriptions(self, config: dict) -> List[dict]:
        """Subscribe to SPY equity via IB for price reference (1 market data line)."""
        return [{
            "cache_key": "SPY",
            "contract": {
                "symbol": "SPY",
                "secType": "STK",
                "exchange": "SMART",
                "currency": "USD",
            },
            "generic_ticks": "100,101,104,106",
        }]

    def on_start(self, config: dict) -> None:
        """Load model, init data pipeline, start Polygon WS background thread."""
        self._start_time = time.time()
        cfg = {**_DEFAULTS, **config}

        try:
            self._init_bmc_pipeline(cfg)
            self._start_polygon_ws(cfg)
            self._started = True
            logger.info(
                "BigMoveConvexityStrategy started: auto_entry=%s, threshold=%.2f, "
                "interval=%ds, scan=%s-%s, delayed=%s",
                cfg["auto_entry"], cfg["signal_threshold"],
                cfg["decision_interval_seconds"],
                cfg["scan_start"], cfg["scan_end"],
                cfg["use_delayed_data"],
            )
        except Exception as e:
            self._startup_error = str(e)
            logger.exception("BigMoveConvexityStrategy startup failed: %s", e)

    def evaluate(self, quotes: Dict[str, "Quote"], config: dict) -> List[OrderAction]:
        """Called every 100ms by ExecutionEngine.

        Returns [] on 99.7% of ticks. Only runs the decision cycle every
        ``decision_interval_seconds`` during the scan window.
        """
        if not self._started or self._model is None:
            return []

        cfg = {**_DEFAULTS, **config}
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
        cfg = {**_DEFAULTS, **config}
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

        # Spawn risk manager if callback is wired
        if self._spawn_risk_manager is not None and self._last_signal:
            try:
                contract_info = self._last_signal.get("option_contract", {})
                risk_config = {
                    "preset": "zero_dte_convexity",
                    "instrument": {
                        "symbol": contract_info.get("symbol", "SPY"),
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
        logger.info("BigMoveConvexityStrategy stopping")

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
            "BigMoveConvexityStrategy stopped: decisions=%d, signals=%d, positions=%d",
            self._decisions_run, self._signals_generated, self._positions_spawned,
        )

    def get_strategy_state(self) -> dict:
        """Rich telemetry for dashboard Signals tab."""
        state: dict[str, Any] = {
            "type": "big_move_convexity",
            "started": self._started,
            "startup_error": self._startup_error,
            "uptime_s": (time.time() - self._start_time) if self._started else 0,
            "decisions_run": self._decisions_run,
            "signals_generated": self._signals_generated,
            "positions_spawned": self._positions_spawned,
            "last_decision_time": self._last_decision_time,
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
        prod_version = registry.get_production()
        if prod_version is None:
            raise RuntimeError(
                f"No production model registered in {registry_path}. "
                "Run scripts/train_production_model.py first."
            )

        self._model = registry.load(prod_version.version_id)
        logger.info(
            "Loaded production model: %s (type=%s, features=%d)",
            prod_version.version_id,
            self._model.model_type,
            len(self._model.feature_names),
        )

        # Run daily bootstrap (synchronously — we're in on_start)
        bootstrap = DailyBootstrap()
        try:
            loop = asyncio.new_event_loop()
            bootstrap_result = loop.run_until_complete(bootstrap.bootstrap(self._data_store))
            loop.close()
            logger.info("Daily bootstrap complete: %s", bootstrap_result)
        except Exception:
            logger.warning("Daily bootstrap failed — features may be incomplete", exc_info=True)

    def _start_polygon_ws(self, cfg: dict) -> None:
        """Start Polygon WS in a background thread."""
        from big_move_convexity.dpal.polygon_ws import PolygonWebSocketProvider
        from big_move_convexity.dpal.polygon_ws_client import PolygonWSClient

        self._polygon_provider = PolygonWebSocketProvider()

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

        # Subscribe to SPY equity via the provider
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            self._polygon_provider.subscribe_equity("SPY", _on_equity_quote)
        )
        loop.close()

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
                # Subscribe to channels
                channels = cfg.get("polygon_channels", ["T.SPY", "Q.SPY"])
                loop.run_until_complete(self._polygon_client.subscribe(channels))
                loop.run_until_complete(self._polygon_client.connect_and_run())
            except Exception:
                logger.exception("Polygon WS thread exited with error")
            finally:
                loop.close()

        self._ws_thread = threading.Thread(
            target=_ws_thread_main,
            name="bmc-polygon-ws",
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

        # Build bars by resolution from data store
        bars_by_res = {}
        for bar_type in ["time_5s", "time_15s", "time_1m"]:
            bars = self._data_store.get_completed_bars(bar_type, before=t)
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

        # SPY bars for cross-ticker (same as main ticker for SPY)
        spy_bars = self._data_store.get_completed_bars("time_1m", before=t)

        # Underlying price from IB quote cache
        underlying_price = None
        spy_quote = quotes.get("SPY")
        if spy_quote is not None:
            mid = getattr(spy_quote, 'mid', None)
            if mid and mid > 0:
                underlying_price = mid
            elif hasattr(spy_quote, 'last') and spy_quote.last > 0:
                underlying_price = spy_quote.last

        # Assemble feature vector
        fv = assemble_feature_vector(
            "SPY",
            t,
            bars_by_resolution=bars_by_res,
            spy_bars=spy_bars if spy_bars is not None and not spy_bars.empty else None,
            daily_features=daily_features or None,
            regime_override=regime or None,
            prior_close=prior_close,
            underlying_price=underlying_price,
        )

        # Predict
        prediction = predict_single(self._model, fv.features)
        probability = prediction["probability"]

        # Generate signal
        signal_config = SignalConfig(
            probability_threshold=cfg.get("signal_threshold", 0.5),
            min_strength=cfg.get("min_signal_strength", 0.3),
            direction_mode=cfg.get("direction_mode", "both"),
            cooldown_minutes=cfg.get("cooldown_minutes", 15),
        )
        signal = generate_signal(prediction, "SPY", t, signal_config)

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
        last_signal_time = self._cooldown_tracker.get("SPY", 0)
        if (time.time() - last_signal_time) < cooldown_s:
            logger.info("Signal suppressed by cooldown (last signal %.0fs ago)",
                        time.time() - last_signal_time)
            signal_record["suppressed"] = "cooldown"
            self._signal_history.append(signal_record)
            return []

        self._cooldown_tracker["SPY"] = time.time()
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

        # Round to nearest 0.50 (SPY option strikes)
        strike = round(target_strike * 2) / 2

        # Expiry = today (0DTE)
        today = datetime.now().strftime("%Y%m%d")

        # Determine quantity based on budget
        budget = cfg.get("contract_budget_usd", 150.0)
        max_contracts = cfg.get("max_contracts", 5)
        # Estimate: 0DTE 20bp OTM typically $0.10-$2.00 per contract
        # Use $1.00 estimate; actual pricing would come from live quotes
        estimated_premium = 1.00
        qty = min(max_contracts, max(1, int(budget / (estimated_premium * 100))))

        contract_dict = {
            "symbol": "SPY",
            "secType": "OPT",
            "exchange": "SMART",
            "currency": "USD",
            "strike": strike,
            "lastTradeDateOrContractMonth": today,
            "right": right,
            "multiplier": "100",
        }

        # Store contract info in signal record for risk manager spawn
        self._last_signal["option_contract"] = {
            "symbol": "SPY",
            "strike": strike,
            "expiry": today,
            "right": right,
        }

        order = OrderAction(
            strategy_id="",  # filled by engine
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=qty,
            contract_dict=contract_dict,
            reason=f"BMC signal: {signal.direction} p={signal.probability:.3f} "
                   f"strike={strike} {right} 0DTE",
        )

        logger.info(
            "Entry order: BUY %d %s %s %.2f 0DTE @ MKT",
            qty, right, "SPY", strike,
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
