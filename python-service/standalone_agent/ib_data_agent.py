#!/usr/bin/env python3
"""
IB Data Agent - Standalone version
===================================
Local agent that connects to IB TWS and relays market data to the cloud service.

This script runs on your local machine where TWS is running. It:
1. Connects to IB TWS locally
2. Establishes a WebSocket connection to the cloud server
3. Listens for data requests and fetches data from IB
4. Sends responses back through the WebSocket

Usage:
    python ib_data_agent.py

Environment variables:
    IB_HOST         - IB TWS host (default: 127.0.0.1)
    IB_PORT         - IB TWS port (optional; overrides IB_MODE)
    IB_MODE         - "paper" (7497) or "live" (7496) when IB_PORT not set; TWS default ports
    IB_CLIENT_ID    - IB API client ID (default: 0). Use a unique value per agent when
                      running multiple agents against the same TWS. Note: only client_id=0
                      receives TWS-owned orders via reqAutoOpenOrders(True).
    RELAY_URL       - WebSocket relay URL (default: wss://dr3-dashboard.com/ws/data-provider)
    IB_PROVIDER_KEY - API key for authentication (required)
"""

import asyncio
import copy
import json
import logging
import math
import os
import signal
import sys
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import List, Optional

import websockets
from websockets.exceptions import ConnectionClosed

# Import from local modules (bundled in same directory)
from ib_scanner import IBMergerArbScanner, DealInput
from resource_manager import ResourceManager
from quote_cache import StreamingQuoteCache
from execution_engine import ExecutionEngine, ExecutionStrategy
from position_store import PositionStore
from engine_config_store import EngineConfigStore

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Quiet down chatty loggers
logging.getLogger("ibapi.wrapper").setLevel(logging.WARNING)
logging.getLogger("ibapi.client").setLevel(logging.WARNING)

# Configuration from environment (trim whitespace; config.env may have spaces)
def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key) or default
    return v.strip() if isinstance(v, str) else str(v)

IB_HOST = _env("IB_HOST") or "127.0.0.1"
# Port: use IB_PORT if set; else IB_MODE. Official TWS: 7496=live, 7497=paper.
_raw_port = _env("IB_PORT")
if _raw_port and _raw_port.isdigit():
    IB_PORT = int(_raw_port)
else:
    _mode = (_env("IB_MODE") or "paper").lower()
    IB_PORT = 7497 if _mode == "paper" else 7496  # TWS default: paper=7497, live=7496
_raw_client_id = _env("IB_CLIENT_ID")
IB_CLIENT_ID = int(_raw_client_id) if _raw_client_id and _raw_client_id.isdigit() else 0
RELAY_URL = _env("RELAY_URL") or "wss://dr3-dashboard.com/ws/data-provider"
IB_PROVIDER_KEY = _env("IB_PROVIDER_KEY")
# Comma-separated IB account codes to exclude from positions/orders (e.g. managed accounts)
_raw_exclude = _env("IB_EXCLUDE_ACCOUNTS")
IB_EXCLUDE_ACCOUNTS: set = set(a.strip() for a in _raw_exclude.split(",") if a.strip()) if _raw_exclude else set()
if IB_EXCLUDE_ACCOUNTS:
    logger.info("IB_EXCLUDE_ACCOUNTS: %s", IB_EXCLUDE_ACCOUNTS)
HEARTBEAT_INTERVAL = 10  # seconds
RECONNECT_DELAY = 5  # seconds
CACHE_TTL_SECONDS = 60  # How long to cache option chain data

# ── Risk config hot-modify: BMC flat fields → nested risk manager format ──
_BMC_RISK_FIELDS = frozenset({
    "risk_stop_loss_enabled", "risk_stop_loss_type", "risk_stop_loss_trigger_pct",
    "risk_trailing_enabled", "risk_trailing_activation_pct", "risk_trailing_trail_pct",
    "risk_profit_taking_enabled", "risk_profit_targets_enabled", "risk_profit_targets",
    "risk_preset", "risk_eod_exit_time", "risk_eod_min_bid",
})


def _sanitize_for_json(obj):
    """Recursively coerce websocket payloads into JSON-safe primitives."""
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if hasattr(obj, "item") and callable(obj.item):
        try:
            return _sanitize_for_json(obj.item())
        except Exception:
            pass
    return obj


def _translate_bmc_to_risk_config(bmc_config: dict) -> dict:
    """Translate BMC flat config fields to nested risk manager config format.

    The dashboard sends flat keys like risk_stop_loss_enabled=true. Risk managers
    expect nested dicts like {"stop_loss": {"enabled": true, ...}}.
    Only includes sections where at least one field is present in bmc_config.

    IMPORTANT: The dashboard has no UI for exit_tranches — those are defined
    in presets. When a preset is specified, we pull exit_tranches from the
    preset so that downstream merge operations don't lose them.
    EOD exit is per-position opt-in (not inherited from preset).
    """
    from strategies.risk_manager import PRESETS

    risk = {}

    # Resolve preset early so we can pull preset-only fields
    preset_name = bmc_config.get("risk_preset")
    preset = PRESETS.get(preset_name, {}) if preset_name else {}

    # Stop loss
    if any(k.startswith("risk_stop_loss_") for k in bmc_config):
        risk["stop_loss"] = {
            "enabled": bmc_config.get("risk_stop_loss_enabled", False),
            "type": bmc_config.get("risk_stop_loss_type", "simple"),
            "trigger_pct": bmc_config.get("risk_stop_loss_trigger_pct", -80.0),
        }
    # Profit taking + trailing
    if any(k.startswith("risk_trailing_") or k.startswith("risk_profit_") for k in bmc_config):
        pt = {}
        if any(k.startswith("risk_profit_") for k in bmc_config):
            pt["enabled"] = bmc_config.get("risk_profit_targets_enabled",
                                          bmc_config.get("risk_profit_taking_enabled", False))
            pt["targets"] = bmc_config.get("risk_profit_targets", [])
        if any(k.startswith("risk_trailing_") for k in bmc_config):
            trailing = {
                "enabled": bmc_config.get("risk_trailing_enabled", False),
                "activation_pct": bmc_config.get("risk_trailing_activation_pct", 25.0),
                "trail_pct": bmc_config.get("risk_trailing_trail_pct", 15.0),
            }
            # Preserve exit_tranches from preset (no dashboard UI for these)
            preset_tranches = (
                preset.get("profit_taking", {})
                .get("trailing_stop", {})
                .get("exit_tranches")
            )
            if preset_tranches:
                trailing["exit_tranches"] = preset_tranches
            pt["trailing_stop"] = trailing
        risk["profit_taking"] = pt
    # Preset override
    if preset_name:
        risk["preset"] = preset_name
    # EOD exit time: per-position opt-in only (no preset fallback)
    if "risk_eod_exit_time" in bmc_config:
        risk["eod_exit_time"] = bmc_config["risk_eod_exit_time"] or None
    # EOD min bid: minimum bid to actually sell at EOD (default $0.05 when EOD enabled)
    if "risk_eod_min_bid" in bmc_config:
        risk["eod_min_bid"] = bmc_config["risk_eod_min_bid"]
    return risk


class OptionChainCache:
    """In-memory cache for option chain data with TTL expiration"""
    
    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS):
        self.cache = {}
        self.ttl = ttl_seconds
    
    def _make_key(self, ticker: str, deal_price: float, close_date: str, days_before_close: int) -> str:
        return f"{ticker}_{deal_price}_{close_date}_{days_before_close}"
    
    def get(self, ticker: str, deal_price: float, close_date: str, days_before_close: int):
        key = self._make_key(ticker, deal_price, close_date, days_before_close)
        if key in self.cache:
            data, timestamp = self.cache[key]
            age = time.time() - timestamp
            if age < self.ttl:
                logger.debug(f"Cache HIT for {ticker} (age: {age:.1f}s)")
                return data
            else:
                logger.debug(f"Cache EXPIRED for {ticker} (age: {age:.1f}s)")
                del self.cache[key]
        return None
    
    def set(self, ticker: str, deal_price: float, close_date: str, days_before_close: int, data: dict):
        key = self._make_key(ticker, deal_price, close_date, days_before_close)
        self.cache[key] = (data, time.time())
        logger.debug(f"Cache SET for {ticker} ({len(data.get('contracts', []))} contracts)")
    
    def clear(self):
        self.cache.clear()
        logger.info("Cache cleared")


def resolve_rm_ticker(instrument: dict, parent_strategy_id: str = "") -> str:
    """Resolve the underlying ticker for a risk manager.

    Used by both the spawn path (_spawn_risk_manager_for_bmc) and the
    recovery path (_handle_execution_start) to set state.ticker on risk
    manager StrategyStates. Centralised here so both paths use identical
    logic and the function is independently testable.

    Resolution order:
    1. instrument["symbol"] (the option's underlying)
    2. Parsed from parent_strategy_id (e.g. "bmc_spy_up" → "SPY")
    3. Empty string (no ticker info available)
    """
    ticker = instrument.get("symbol", "").upper()
    if not ticker and parent_strategy_id:
        ticker = parent_strategy_id.replace("bmc_", "").split("_")[0].upper()
    return ticker


class IBDataAgent:
    """Local agent that bridges IB TWS to the remote WebSocket relay"""
    
    def __init__(self):
        self.scanner: IBMergerArbScanner = None
        self.websocket = None
        self.running = False
        self.provider_id = None
        self.option_chain_cache = OptionChainCache(ttl_seconds=CACHE_TTL_SECONDS)
        self.resource_manager = ResourceManager()
        self.quote_cache: Optional[StreamingQuoteCache] = None  # created after scanner is ready
        self.execution_engine: Optional[ExecutionEngine] = None  # created after scanner is ready
        self.position_store = PositionStore()  # persistent position ledger
        self.engine_config_store = EngineConfigStore()  # engine config persistence
        # Auto-restart state
        self._auto_restart_attempted = False  # prevent re-attempt within same lifecycle
        self._saved_entry_cap_before_pause: int = 0
        self._saved_ticker_budgets: dict = {}  # strategy_id -> budget
        # TWS reconnection state
        self._tws_reconnecting = False
        self._tws_last_connected: Optional[float] = None
        # User-initiated disconnect: suppresses auto-reconnect in health loop.
        # Set by ib_disconnect request (e.g. "Stop Gateway" button).
        # Cleared by ib_reconnect request or gateway start.
        self._user_disconnect = False
        # Zombie gateway detection: connected but all data farms DOWN
        self._farms_down_since: Optional[float] = None
        # Shared Polygon WS infrastructure for BMC strategies
        self._shared_polygon_infra = None
        
    def connect_to_ib(self) -> bool:
        """Connect to IB TWS. Tries configured port first; on failure tries the other (7496/7497)
        so the agent works with either paper or live TWS without config change."""
        # clientId=0 is the "default client" that gets TWS-owned orders via
        # reqAutoOpenOrders(True). Use IB_CLIENT_ID env var to override when
        # running multiple agents against the same TWS instance.
        client_id = IB_CLIENT_ID
        # Try configured port first; then the other TWS port (7496=live, 7497=paper)
        other_port = 7497 if IB_PORT == 7496 else 7496
        ports_to_try = [IB_PORT, other_port]

        for port in ports_to_try:
            logger.info(f"Connecting to IB TWS at {IB_HOST}:{port}...")
            self.scanner = IBMergerArbScanner()
            self.scanner.resource_manager = self.resource_manager
            connected = self.scanner.connect_to_ib(
                host=IB_HOST,
                port=port,
                client_id=client_id,
            )
            if connected:
                logger.info("Successfully connected to IB TWS")
                self._tws_last_connected = time.time()
                self._tws_reconnecting = False
                # Initialize execution infrastructure (quote cache + engine)
                if self.quote_cache is None:
                    self.quote_cache = StreamingQuoteCache(self.resource_manager)
                self.scanner.streaming_cache = self.quote_cache
                if self.execution_engine is None:
                    self.execution_engine = ExecutionEngine(
                        self.scanner, self.quote_cache, self.resource_manager,
                        self.position_store,
                    )
                else:
                    self.execution_engine._scanner = self.scanner
                logger.info("Execution infrastructure initialized (quote cache + engine ready)")
                return True
            if port == ports_to_try[0]:
                logger.warning(f"Connection to {IB_HOST}:{port} failed; trying {other_port}...")

        logger.error("Failed to connect to IB TWS on either port (7496 or 7497)")
        return False

    async def _connect_to_ib_with_retry(self, max_attempts: int = 0) -> bool:
        """Connect to IB TWS with exponential backoff.
        
        max_attempts=0 means retry forever (for startup when TWS may not be running yet).
        """
        attempt = 0
        delay = 2.0
        MAX_DELAY = 60.0
        while self.running:
            attempt += 1
            if self.connect_to_ib():
                return True
            if max_attempts > 0 and attempt >= max_attempts:
                return False
            logger.warning(
                "TWS not available (attempt %d). Retrying in %.0fs... "
                "(Start TWS/Gateway if not running)",
                attempt, delay,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_DELAY)
        return False

    async def _tws_health_loop(self):
        """Background task: detect TWS disconnection and auto-reconnect.

        Checks every 5s when connected. When disconnected, attempts reconnect
        with exponential backoff (5s → 60s). Quiet logging after first attempt
        to avoid spamming the console when TWS isn't running.

        Also detects zombie gateway state: socket connected but all data farms
        DOWN for >90s (e.g., gateway stuck on "Existing session detected" dialog).
        """
        CHECK_INTERVAL = 5.0
        FARMS_DOWN_TIMEOUT = 90.0  # seconds before force-reconnecting zombie gateway
        while self.running:
            await asyncio.sleep(CHECK_INTERVAL)
            try:
                if not self.scanner:
                    continue
                # Check if TWS connection is healthy
                if self.scanner.isConnected() and not self.scanner.connection_lost:
                    # Active liveness probe — detect half-dead sockets where
                    # connectionClosed() never fires (TCP socket stuck)
                    stale_sec = time.time() - getattr(self.scanner, '_last_ib_callback', time.time())
                    if stale_sec > 30:
                        logger.warning("IB connection stale (%.0fs no callbacks) — probing...", stale_sec)
                        try:
                            self.scanner.reqCurrentTime()
                        except Exception:
                            pass
                        await asyncio.sleep(5.0)
                        still_stale = time.time() - getattr(self.scanner, '_last_ib_callback', time.time()) > 35
                        if still_stale:
                            logger.warning("IB liveness probe failed — marking connection as lost")
                            self.scanner.connection_lost = True
                            # Fall through to reconnect logic below
                        else:
                            continue  # Probe succeeded, connection is alive
                    else:
                        # Connection alive (getting callbacks) — check for zombie gateway
                        # Zombie = socket connected to gateway, but gateway has no IB server
                        # connectivity (e.g. stuck on "Existing session detected" dialog).
                        # All data farms report DOWN but isConnected() is True.
                        farm_status = self.scanner._farm_status
                        if farm_status and not self.scanner.is_data_available():
                            if self._farms_down_since is None:
                                self._farms_down_since = time.time()
                                logger.warning(
                                    "All data farms DOWN (zombie gateway?) — "
                                    "will force reconnect after %.0fs. Farms: %s",
                                    FARMS_DOWN_TIMEOUT, farm_status,
                                )
                            elif time.time() - self._farms_down_since > FARMS_DOWN_TIMEOUT:
                                logger.warning(
                                    "All data farms DOWN for >%.0fs — forcing reconnect. Farms: %s",
                                    FARMS_DOWN_TIMEOUT, farm_status,
                                )
                                self._farms_down_since = None
                                self.scanner.connection_lost = True
                                # Fall through to reconnect logic below
                            else:
                                continue  # Still within grace period
                        else:
                            # Farms are OK (or no status yet) — reset timer
                            if self._farms_down_since is not None:
                                logger.info("Data farms recovered — cancelling zombie detection timer")
                                self._farms_down_since = None
                            continue
                # --- TWS is down ---
                # If user explicitly disconnected (e.g. "Stop Gateway"), don't auto-reconnect.
                # Just wait quietly until they click "Start Gateway" or "Reconnect IB".
                # (_handle_ib_disconnect already logged the suppression message.)
                if self._user_disconnect:
                    self._tws_reconnecting = False  # ensure clean state
                    continue
                was_previously_connected = self._tws_last_connected is not None
                if not self._tws_reconnecting:
                    if was_previously_connected:
                        logger.warning("TWS connection lost — starting auto-reconnect...")
                    else:
                        logger.info("TWS not yet available — will retry in background (60s intervals)")
                    self._tws_reconnecting = True
                # Clean up dead socket
                try:
                    self.scanner.disconnect()
                except Exception:
                    pass
                # Attempt reconnect with backoff
                # Start at 5s if TWS was previously connected (likely brief outage),
                # 60s if never connected (TWS not running on this machine)
                delay = 5.0 if was_previously_connected else 60.0
                MAX_DELAY = 60.0
                # Engage reconnect hold BEFORE reconnecting — prevents the eval loop
                # from placing orders with stale position data between the moment IB
                # clears connection_lost (in nextValidId callback) and when reconciliation
                # finishes.  Hold is released in the finally block below.
                if self.execution_engine and self.execution_engine.is_running:
                    self.execution_engine.set_reconnect_hold(True)
                while self.running and self._tws_reconnecting:
                    logger.debug("Attempting TWS reconnect (delay=%.0fs)...", delay)
                    if self.connect_to_ib():
                        logger.info("TWS reconnected successfully!")
                        # Re-register account event callback
                        try:
                            loop = asyncio.get_running_loop()
                            self.scanner.set_account_event_callback(
                                self._make_account_event_callback(loop)
                            )
                        except Exception as e:
                            logger.error("Failed to re-register account event callback: %s", e)
                        # Re-establish streaming subscriptions (execution engine quotes)
                        try:
                            if self.quote_cache:
                                self.quote_cache.resubscribe_all(self.scanner)
                                logger.info("Re-established streaming quote subscriptions")
                        except Exception as e:
                            logger.error("Failed to re-establish streaming subscriptions: %s", e)
                        # IB Reconciliation on reconnect (WS4) — MUST complete before hold is released
                        try:
                            if self.execution_engine and self.execution_engine.is_running:
                                recovery = self._run_broker_recovery_pass(
                                    include_executions=True,
                                    open_orders_force_refresh=True,
                                )
                                recon = recovery["reconciliation"] or {
                                    "matched": [],
                                    "orphaned_ib": [],
                                    "stale_agent": [],
                                    "adjusted": [],
                                }
                                ingest = recovery["execution_ingest"] or {}
                                if ingest.get("ingested"):
                                    logger.info(
                                        "Reconnect broker replay: ingested %d execution(s), %d unresolved",
                                        ingest.get("ingested", 0),
                                        ingest.get("unresolved", 0),
                                    )
                                if recon["orphaned_ib"]:
                                    n_spawned = self._spawn_missing_risk_managers(recon["orphaned_ib"])
                                    logger.warning(
                                        "Post-reconnect reconciliation: %d orphaned IB position(s) — "
                                        "auto-spawned %d risk manager(s)",
                                        len(recon["orphaned_ib"]), n_spawned,
                                    )
                                if recon["stale_agent"] or recon["adjusted"]:
                                    logger.warning(
                                        "Post-reconnect reconciliation: matched=%d, stale=%d, adjusted=%d",
                                        len(recon["matched"]), len(recon["stale_agent"]), len(recon["adjusted"]),
                                    )
                        except Exception as e:
                            logger.error("Post-reconnect reconciliation failed: %s", e)
                        # Release reconnect hold — eval loop can resume with fresh position view
                        if self.execution_engine and self.execution_engine.is_running:
                            self.execution_engine.set_reconnect_hold(False)
                        # Notify frontend to refetch positions and open orders (orders may have filled while disconnected)
                        try:
                            if self.websocket:
                                await self._send_ws_json({
                                    "type": "account_event",
                                    "event": {"event": "tws_reconnected", "ts": time.time()},
                                })
                                logger.info("Pushed tws_reconnected event for UI sync")
                        except Exception as e:
                            logger.error("Failed to push tws_reconnected: %s", e)
                        self._tws_reconnecting = False
                        break
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, MAX_DELAY)
                # Safety: if we exit the reconnect loop without succeeding (e.g. shutdown),
                # release the hold so the engine isn't permanently frozen.
                if self.execution_engine and self._reconnect_hold_needs_release():
                    self.execution_engine.set_reconnect_hold(False)
            except Exception as e:
                # CRITICAL: Health loop must never die silently. Log and continue.
                # Without this, an unexpected exception kills the only mechanism
                # that detects IB disconnects and triggers reconnection.
                logger.error("Health loop iteration error (continuing): %s", e, exc_info=True)

    def _reconnect_hold_needs_release(self) -> bool:
        """Check if reconnect hold is still engaged (needs cleanup)."""
        return (self.execution_engine
                and self.execution_engine.is_running
                and self.execution_engine._reconnect_hold)

    def disconnect_from_ib(self):
        """Disconnect from IB TWS, stopping execution engine first."""
        if self.execution_engine and self.execution_engine.is_running:
            logger.info("Stopping execution engine before IB disconnect...")
            self.execution_engine.stop()
        if self.scanner and self.scanner.isConnected():
            logger.info("Disconnecting from IB TWS...")
            self.scanner.disconnect()

    def _run_broker_recovery_pass(
        self,
        *,
        include_executions: bool,
        open_orders_force_refresh: bool = True,
    ) -> dict:
        """Replay broker truth into the local ledgers before automation resumes."""
        if not self.execution_engine:
            return {
                "reconciliation": None,
                "execution_ingest": {"ingested": 0, "unresolved": 0},
                "ib_open_orders": [],
            }
        if not self.scanner or not self.scanner.isConnected():
            return {
                "reconciliation": None,
                "execution_ingest": {"ingested": 0, "unresolved": 0},
                "ib_open_orders": [],
            }

        ib_positions = [
            p for p in self.scanner.get_positions_snapshot()
            if p.get("account") == self.IB_ACCT_CODE
        ]
        ib_open_orders = self.scanner.get_open_orders_snapshot(
            timeout_sec=10.0,
            force_refresh=open_orders_force_refresh,
        )
        execution_ingest = {"ingested": 0, "unresolved": 0}
        if include_executions and hasattr(self.position_store, "ingest_ib_execution_batch"):
            raw_execs = self.scanner.fetch_executions_sync(
                timeout_sec=10.0,
                acct_code=self.IB_ACCT_CODE,
            )
            execution_ingest = self.position_store.ingest_ib_execution_batch(raw_execs)

        recon = self.execution_engine.reconcile_with_ib(
            ib_positions,
            ib_open_orders=ib_open_orders,
        )
        self.position_store.purge_phantom_entry_fills()
        return {
            "reconciliation": recon,
            "execution_ingest": execution_ingest,
            "ib_open_orders": ib_open_orders,
        }
    
    async def handle_request(self, request: dict) -> dict:
        """Handle a data request from the relay"""
        request_type = request.get("request_type")
        payload = request.get("payload", {})
        
        logger.debug(f"Handling request: {request_type}")
        
        try:
            if request_type == "ib_status":
                return await self._handle_ib_status()
            elif request_type == "fetch_chain":
                return await self._run_in_thread(self._handle_fetch_chain_sync, payload)
            elif request_type == "check_availability":
                return await self._handle_check_availability(payload)
            elif request_type == "fetch_underlying":
                return await self._run_in_thread(self._handle_fetch_underlying_sync, payload)
            elif request_type == "test_futures":
                return await self._handle_test_futures(payload)
            elif request_type == "get_positions":
                return await self._run_in_thread(self._handle_get_positions_sync, payload)
            elif request_type == "get_ma_positions":
                return await self._run_in_thread(self._handle_get_ma_positions_sync, payload)
            elif request_type == "get_open_orders":
                return await self._run_in_thread(self._handle_get_open_orders_sync, payload)
            elif request_type == "place_order":
                return await self._run_in_thread(self._handle_place_order_sync, payload)
            elif request_type == "modify_order":
                return await self._run_in_thread(self._handle_modify_order_sync, payload)
            elif request_type == "cancel_order":
                return await self._handle_cancel_order(payload)
            elif request_type == "fetch_prices":
                return await self._run_in_thread(self._handle_fetch_prices_sync, payload)
            elif request_type == "sell_scan":
                return await self._run_in_thread(self._handle_sell_scan_sync, payload)
            # Execution engine control
            elif request_type == "execution_start":
                return await self._handle_execution_start(payload)
            elif request_type == "execution_stop":
                return await self._handle_execution_stop(payload)
            elif request_type == "execution_status":
                return await self._handle_execution_status(payload)
            elif request_type == "execution_config":
                return await self._handle_execution_config(payload)
            elif request_type == "execution_budget":
                return await self._handle_execution_budget(payload)
            elif request_type == "execution_add_ticker":
                return await self._handle_execution_add_ticker(payload)
            elif request_type == "execution_remove_ticker":
                return await self._handle_execution_remove_ticker(payload)
            elif request_type == "execution_close_position":
                return await self._handle_close_position(payload)
            elif request_type == "execution_list_models":
                return await self._handle_execution_list_models(payload)
            elif request_type == "execution_swap_model":
                return await self._handle_execution_swap_model(payload)
            elif request_type == "execution_resume":
                return await self._handle_execution_resume(payload)
            elif request_type == "execution_ticker_mode":
                return await self._handle_execution_ticker_mode(payload)
            elif request_type == "execution_position_config":
                return await self._handle_position_risk_config(payload)
            elif request_type == "ib_reconnect":
                return await self._handle_ib_reconnect(payload)
            elif request_type == "ib_disconnect":
                return await self._handle_ib_disconnect(payload)
            elif request_type == "get_ib_executions":
                return await self._run_in_thread(self._handle_get_ib_executions_sync, payload)
            elif request_type == "fetch_historical_bars":
                return await self._run_in_thread(self._handle_fetch_historical_bars_sync, payload)
            elif request_type == "agent_restart":
                return await self._handle_agent_restart(payload)
            else:
                return {"error": f"Unknown request type: {request_type}"}
        except Exception as e:
            logger.error(f"Error handling request {request_type}: {e}")
            return {"error": str(e)}
    
    async def _run_in_thread(self, func, *args):
        """Run a blocking function in a thread pool"""
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return await loop.run_in_executor(pool, func, *args)

    async def _send_ws_json(self, payload: dict) -> None:
        """Serialize and send a websocket payload after JSON sanitization."""
        if not self.websocket:
            return
        await self.websocket.send(json.dumps(_sanitize_for_json(payload)))
    
    async def _handle_ib_status(self) -> dict:
        """Check IB connection status, including reconnection and farm health."""
        connected = self.scanner and self.scanner.isConnected()
        farm_status = {}
        data_available = True
        read_only = False
        if self.scanner:
            farm_status = self.scanner.get_farm_status()
            data_available = self.scanner.is_data_available()
            read_only = getattr(self.scanner, "read_only_session", False)
        if self._user_disconnect:
            message = "IB disconnected by user — click Reconnect to resume"
        elif self._tws_reconnecting:
            message = "IB TWS reconnecting..."
        elif connected and not data_available:
            message = "IB TWS connected but data farms are down"
        elif connected and read_only:
            message = "IB TWS connected (Read-Only — quotes only, no positions/orders)"
        elif connected:
            message = "IB TWS connected"
        else:
            message = "IB TWS not connected"
        return {
            "connected": connected,
            "reconnecting": self._tws_reconnecting,
            "user_disconnect": self._user_disconnect,
            "message": message,
            "farm_status": farm_status,
            "data_available": data_available,
            "read_only_session": read_only,
            "last_connected": self._tws_last_connected,
        }
    
    async def _handle_ib_reconnect(self, payload: dict = None) -> dict:
        """Handle dashboard-triggered IB reconnect request.

        Reuses the same post-reconnect logic as _tws_health_loop:
        engage hold → disconnect stale socket → connect → re-register callbacks →
        resubscribe quotes → reconcile → release hold.

        When force=True (from payload), skips the "already connected" early return
        and tears down the existing connection before reconnecting.
        """
        payload = payload or {}
        force = payload.get("force", False)

        # Already connected — skip unless force
        if not force and self.scanner and self.scanner.isConnected() and not self.scanner.connection_lost:
            return {"success": True, "connected": True, "message": "Already connected to IB"}

        # Already reconnecting via health loop — don't double-trigger
        if self._tws_reconnecting:
            return {"success": False, "connected": False, "message": "IB reconnect already in progress"}

        # Clear user-disconnect flag — user wants to reconnect
        if self._user_disconnect:
            logger.info("Clearing user-disconnect flag — auto-reconnect re-enabled")
            self._user_disconnect = False

        if force:
            logger.info("Force reconnect triggered from dashboard — tearing down existing connection")
        else:
            logger.info("Manual IB reconnect triggered from dashboard")

        # Engage reconnect hold if engine is running
        if self.execution_engine and self.execution_engine.is_running:
            self.execution_engine.set_reconnect_hold(True)

        try:
            # Clean up dead socket
            if self.scanner:
                try:
                    self.scanner.disconnect()
                except Exception:
                    pass

            # Attempt connection (tries configured port, then alternate)
            if not self.connect_to_ib():
                # Release hold on failure
                if self.execution_engine and self._reconnect_hold_needs_release():
                    self.execution_engine.set_reconnect_hold(False)
                return {
                    "success": False,
                    "connected": False,
                    "message": "Failed to connect to IB TWS/Gateway. Ensure it is running."
                }

            # Re-register account event callback
            try:
                loop = asyncio.get_running_loop()
                self.scanner.set_account_event_callback(
                    self._make_account_event_callback(loop)
                )
            except Exception as e:
                logger.error("Failed to re-register account event callback: %s", e)

            # Re-establish streaming subscriptions
            try:
                if self.quote_cache:
                    self.quote_cache.resubscribe_all(self.scanner)
                    logger.info("Re-established streaming quote subscriptions")
            except Exception as e:
                logger.error("Failed to re-establish streaming subscriptions: %s", e)

            # IB Reconciliation — MUST complete before hold is released
            try:
                if self.execution_engine and self.execution_engine.is_running:
                    recovery = self._run_broker_recovery_pass(
                        include_executions=True,
                        open_orders_force_refresh=True,
                    )
                    recon = recovery["reconciliation"] or {
                        "matched": [],
                        "orphaned_ib": [],
                        "stale_agent": [],
                        "adjusted": [],
                    }
                    ingest = recovery["execution_ingest"] or {}
                    if ingest.get("ingested"):
                        logger.info(
                            "Manual reconnect broker replay: ingested %d execution(s), %d unresolved",
                            ingest.get("ingested", 0),
                            ingest.get("unresolved", 0),
                        )
                    if recon["orphaned_ib"]:
                        n_spawned = self._spawn_missing_risk_managers(recon["orphaned_ib"])
                        logger.warning(
                            "Post-reconnect reconciliation: %d orphaned IB position(s) — "
                            "auto-spawned %d risk manager(s)",
                            len(recon["orphaned_ib"]), n_spawned,
                        )
                    if recon["stale_agent"] or recon["adjusted"]:
                        logger.warning(
                            "Post-reconnect reconciliation: matched=%d, stale=%d, adjusted=%d",
                            len(recon["matched"]), len(recon["stale_agent"]), len(recon["adjusted"]),
                        )
            except Exception as e:
                logger.error("Post-reconnect reconciliation failed: %s", e)

            # Release reconnect hold
            if self.execution_engine and self.execution_engine.is_running:
                self.execution_engine.set_reconnect_hold(False)

            # Notify frontend
            try:
                if self.websocket:
                    await self._send_ws_json({
                        "type": "account_event",
                        "event": {"event": "tws_reconnected", "ts": time.time()},
                    })
            except Exception as e:
                logger.error("Failed to push tws_reconnected: %s", e)

            logger.info("Manual IB reconnect completed successfully")
            return {"success": True, "connected": True, "message": "Reconnected to IB TWS"}

        except Exception as e:
            logger.error("Manual IB reconnect failed: %s", e)
            # Safety: release hold on failure
            if self.execution_engine and self._reconnect_hold_needs_release():
                self.execution_engine.set_reconnect_hold(False)
            return {
                "success": False,
                "connected": False,
                "message": f"Reconnect failed: {str(e)}"
            }

    async def _handle_ib_disconnect(self, payload: dict = None) -> dict:
        """Handle user-initiated IB disconnect (e.g. 'Stop Gateway' button).

        Sets the _user_disconnect flag so the health loop does NOT auto-reconnect.
        The flag is cleared when the user clicks 'Start Gateway' or 'Reconnect IB'.
        """
        self._user_disconnect = True
        logger.info("User-initiated IB disconnect — auto-reconnect SUPPRESSED")

        # Actually disconnect the socket if connected
        if self.scanner and self.scanner.isConnected():
            try:
                self.scanner.disconnect()
                logger.info("IB socket disconnected")
            except Exception as e:
                logger.error("Error disconnecting IB socket: %s", e)

        # Stop any in-progress reconnect attempt
        self._tws_reconnecting = False

        return {
            "success": True,
            "connected": False,
            "message": "IB disconnected. Auto-reconnect suppressed until you reconnect manually.",
        }

    def _ib_not_connected_error(self) -> str:
        """Return appropriate error string based on connection state."""
        if self._user_disconnect:
            return "IB disconnected by user -- click Reconnect IB to resume"
        if self._tws_reconnecting:
            return "IB reconnecting -- please wait..."
        return "IB not connected"

    async def _handle_check_availability(self, payload: dict) -> dict:
        """Check if options are available for a ticker"""
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"available": False, "expirationCount": 0, "error": self._ib_not_connected_error()}
        
        contract_id = self.scanner.resolve_contract(ticker)
        if not contract_id:
            return {"available": False, "expirationCount": 0, "error": f"Could not resolve {ticker}"}
        
        expirations = self.scanner.get_available_expirations(ticker, contract_id)
        
        return {
            "available": len(expirations) > 0,
            "expirationCount": len(expirations)
        }
    
    def _handle_fetch_underlying_sync(self, payload: dict) -> dict:
        """Fetch underlying stock/futures data (runs in thread pool, not on event loop).

        For futures, pass secType="FUT" plus exchange, lastTradeDateOrContractMonth,
        and optionally multiplier in the payload.

        Bare futures root symbols (e.g. "ES" with no contract month) auto-resolve
        to the front-month contract. CONTFUT doesn't work with reqMktData — only
        reqHistoricalData — so we derive YYYYMM for the nearest valid contract.
        """
        ticker = payload.get("ticker", "").upper()

        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}

        # Futures exchange lookup — IB requires exchange even with conId
        _FUTURES_EXCHANGE = {
            # Metals — COMEX (IB uses "COMEX" exchange, not "NYMEX")
            "SI": "COMEX", "GC": "COMEX", "HG": "COMEX",
            "SIL": "COMEX", "MGC": "COMEX",
            # Metals — NYMEX (platinum, palladium)
            "PL": "NYMEX", "PA": "NYMEX",
            # Energy
            "CL": "NYMEX", "NG": "NYMEX", "RB": "NYMEX", "HO": "NYMEX",
            "MCL": "NYMEX",
            # Equity indices
            "ES": "CME", "NQ": "CME", "RTY": "CME", "MES": "CME", "MNQ": "CME",
            "M2K": "CME", "EMD": "CME",
            "YM": "CBOT", "MYM": "CBOT",
            # Treasuries
            "ZB": "CBOT", "ZN": "CBOT", "ZF": "CBOT", "ZT": "CBOT",
            # FX
            "6E": "CME", "6J": "CME", "6A": "CME", "6B": "CME", "6C": "CME",
            # Grains
            "ZC": "CBOT", "ZS": "CBOT", "ZW": "CBOT", "ZM": "CBOT", "ZL": "CBOT",
        }

        # IB month codes for parsing contract tickers like "ESH6"
        _MONTH_CODES = {
            "F": "01", "G": "02", "H": "03", "J": "04", "K": "05", "M": "06",
            "N": "07", "Q": "08", "U": "09", "V": "10", "X": "11", "Z": "12",
        }

        # Quarterly futures symbols (equity indices) — only trade H/M/U/Z months
        _QUARTERLY_SYMBOLS = {
            "ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM", "EMD",
        }

        def _get_front_month(symbol: str) -> str:
            """Derive front-month YYYYMM for a futures symbol.
            Quarterly symbols → nearest H(03)/M(06)/U(09)/Z(12).
            Monthly symbols → always next month. Commodity contracts (CL, NG,
            GC, SI, etc.) expire weeks before the delivery month (e.g. CL March
            expires ~Feb 20). Using next-month guarantees a valid, liquid contract."""
            from datetime import datetime as _dt
            now = _dt.utcnow()
            if symbol in _QUARTERLY_SYMBOLS:
                quarters = [3, 6, 9, 12]
                for q in quarters:
                    if q >= now.month:
                        return f"{now.year}{q:02d}"
                return f"{now.year + 1}03"  # past Dec → next year Mar
            else:
                # Monthly: always use next month — current month's contract is
                # usually expired or illiquid by the time you'd look at it.
                if now.month == 12:
                    return f"{now.year + 1}01"
                return f"{now.year}{now.month + 1:02d}"

        # Build a resolved contract if the caller provided contract metadata
        resolved = None
        sec_type = payload.get("secType", "STK")
        con_id = int(payload.get("conId", 0) or 0)
        if con_id or (sec_type and sec_type != "STK"):
            from ibapi.contract import Contract
            import re
            resolved = Contract()
            # Determine exchange: use provided, then lookup table, then CME default
            exch = payload.get("exchange") or ""

            if con_id:
                # When conId is available, use ONLY conId + exchange.
                if not exch and sec_type == "FUT":
                    exch = _FUTURES_EXCHANGE.get(ticker, "CME")
                resolved.conId = con_id
                resolved.exchange = exch or "SMART"
                logger.info(f"fetch_underlying: using conId={con_id} exchange={resolved.exchange} "
                            f"for {ticker} ({sec_type})")
            elif sec_type == "FUT":
                # Futures contract — parse full tickers (ESH6) or auto-resolve front-month
                contract_month = payload.get("lastTradeDateOrContractMonth", "")

                # Try to parse full contract ticker: ESH6 → base="ES", month="03", year="2026"
                fut_match = re.match(r'^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$', ticker)
                if fut_match and fut_match.group(1) in _FUTURES_EXCHANGE:
                    base_symbol = fut_match.group(1)
                    month_code = fut_match.group(2)
                    year_digits = fut_match.group(3)
                    if not contract_month:
                        month = _MONTH_CODES[month_code]
                        year = f"202{year_digits}" if len(year_digits) == 1 else f"20{year_digits}"
                        contract_month = f"{year}{month}"
                    resolved.symbol = base_symbol
                else:
                    resolved.symbol = ticker

                # Auto-derive front-month if no contract month specified
                if not contract_month:
                    contract_month = _get_front_month(resolved.symbol)

                if not exch:
                    exch = _FUTURES_EXCHANGE.get(resolved.symbol, "CME")

                resolved.secType = "FUT"
                resolved.currency = "USD"
                resolved.exchange = exch
                resolved.lastTradeDateOrContractMonth = contract_month

                # Disambiguate contracts that have multiple variants.
                # SI (Silver) has 1000oz and 5000oz — specify 5000 (standard).
                _MULTIPLIER_OVERRIDES = {"SI": "5000"}
                if payload.get("multiplier"):
                    resolved.multiplier = payload["multiplier"]
                elif resolved.symbol in _MULTIPLIER_OVERRIDES:
                    resolved.multiplier = _MULTIPLIER_OVERRIDES[resolved.symbol]
                logger.info(f"fetch_underlying: futures {ticker} → symbol={resolved.symbol} "
                            f"secType=FUT month={contract_month} exchange={resolved.exchange}")
            else:
                # Non-futures, non-conId (e.g. IND)
                resolved.symbol = ticker
                resolved.secType = sec_type or "STK"
                resolved.currency = payload.get("currency", "USD")
                resolved.exchange = exch or "SMART"
                if payload.get("lastTradeDateOrContractMonth"):
                    resolved.lastTradeDateOrContractMonth = payload["lastTradeDateOrContractMonth"]
                if payload.get("multiplier"):
                    resolved.multiplier = payload["multiplier"]
                logger.info(f"fetch_underlying: using {sec_type} contract for {ticker} "
                            f"expiry={resolved.lastTradeDateOrContractMonth} "
                            f"exchange={resolved.exchange}")

        data = self.scanner.fetch_underlying_data(ticker, resolved_contract=resolved)
        return {
            "ticker": ticker,
            "price": data.get("price"),
            "bid": data.get("bid"),
            "ask": data.get("ask"),
            "close": data.get("close"),
            "volume": data.get("volume")
        }

    def _handle_fetch_historical_bars_sync(self, payload: dict) -> dict:
        """Fetch historical OHLCV bars from IB for charting.

        Supports three modes for futures:
        1. Specific contract: contractMonth="202603" → secType=FUT, lastTradeDateOrContractMonth
        2. Bare root symbol (e.g. "ES" with no contractMonth) → secType=CONTFUT (continuous)
        3. Full contract ticker (e.g. "ESH6") with contractMonth parsed by frontend
        """
        ticker = payload.get("ticker", "").upper()

        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}

        # Same futures exchange lookup as _handle_fetch_underlying
        _FUTURES_EXCHANGE = {
            "SI": "COMEX", "GC": "COMEX", "HG": "COMEX",
            "SIL": "COMEX", "MGC": "COMEX",
            "PL": "NYMEX", "PA": "NYMEX",
            "CL": "NYMEX", "NG": "NYMEX", "RB": "NYMEX", "HO": "NYMEX",
            "MCL": "NYMEX",
            "ES": "CME", "NQ": "CME", "RTY": "CME", "MES": "CME", "MNQ": "CME",
            "M2K": "CME", "EMD": "CME",
            "YM": "CBOT", "MYM": "CBOT",
            "ZB": "CBOT", "ZN": "CBOT", "ZF": "CBOT", "ZT": "CBOT",
            "6E": "CME", "6J": "CME", "6A": "CME", "6B": "CME", "6C": "CME",
            "ZC": "CBOT", "ZS": "CBOT", "ZW": "CBOT", "ZM": "CBOT", "ZL": "CBOT",
        }

        # IB month codes for parsing contract tickers like "ESH6"
        _MONTH_CODES = {
            "F": "01", "G": "02", "H": "03", "J": "04", "K": "05", "M": "06",
            "N": "07", "Q": "08", "U": "09", "V": "10", "X": "11", "Z": "12",
        }

        from ibapi.contract import Contract
        import re
        contract = Contract()

        sec_type = payload.get("secType", "STK")
        exchange = payload.get("exchange", "")
        contract_month = payload.get("contractMonth")  # e.g. "202603"

        if sec_type == "FUT":
            # Parse ticker — might be full contract like "ESH6" or bare root "ES"
            # Try to extract base symbol from full contract ticker
            fut_match = re.match(r'^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$', ticker)
            if fut_match and fut_match.group(1) in _FUTURES_EXCHANGE:
                base_symbol = fut_match.group(1)
                month_code = fut_match.group(2)
                year_digits = fut_match.group(3)
                # Derive contractMonth if not already provided
                if not contract_month:
                    month = _MONTH_CODES[month_code]
                    year = f"202{year_digits}" if len(year_digits) == 1 else f"20{year_digits}"
                    contract_month = f"{year}{month}"
                contract.symbol = base_symbol
            else:
                contract.symbol = ticker

            contract.currency = "USD"
            contract.exchange = exchange or _FUTURES_EXCHANGE.get(contract.symbol, "CME")

            if contract_month:
                # Specific contract month — use FUT secType
                contract.secType = "FUT"
                contract.lastTradeDateOrContractMonth = contract_month
            else:
                # Bare root symbol (e.g. "ES") — use CONTFUT for continuous front-month
                contract.secType = "CONTFUT"

            if payload.get("lastTradeDateOrContractMonth"):
                contract.lastTradeDateOrContractMonth = payload["lastTradeDateOrContractMonth"]

            # Disambiguate contracts that have multiple variants.
            # SI (Silver) has 1000oz and 5000oz — specify 5000 (standard).
            _MULTIPLIER_OVERRIDES = {"SI": "5000"}
            if payload.get("multiplier"):
                contract.multiplier = payload["multiplier"]
            elif contract.symbol in _MULTIPLIER_OVERRIDES:
                contract.multiplier = _MULTIPLIER_OVERRIDES[contract.symbol]
        elif sec_type == "IND":
            contract.symbol = ticker
            contract.secType = "IND"
            contract.currency = "USD"
            contract.exchange = exchange or "CBOE"
        else:
            contract.symbol = ticker
            contract.secType = "STK"
            contract.currency = "USD"
            contract.exchange = exchange or "SMART"

        duration = payload.get("duration", "5 D")
        bar_size = payload.get("barSize", "5 mins")
        what_to_show = payload.get("whatToShow", "TRADES")
        use_rth = 1 if payload.get("useRTH", False) else 0

        logger.info(f"fetch_historical_bars: {ticker} ({contract.secType}) symbol={contract.symbol} "
                    f"duration={duration} barSize={bar_size} exchange={contract.exchange} "
                    f"contractMonth={getattr(contract, 'lastTradeDateOrContractMonth', 'none')}")

        bars = self.scanner.fetch_historical_bars(
            contract, duration=duration, bar_size=bar_size,
            what_to_show=what_to_show, use_rth=use_rth
        )

        logger.info(f"fetch_historical_bars: got {len(bars)} bars for {ticker}")

        return {
            "ticker": ticker,
            "bars": bars,
            "count": len(bars),
        }

    def _handle_get_positions_sync(self, payload: dict) -> dict:
        """Fetch all positions from IB (reqPositions -> position/positionEnd).
        Returns positions for ALL managed accounts, minus any in IB_EXCLUDE_ACCOUNTS."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        timeout = float(payload.get("timeout_sec", 15.0))
        try:
            all_positions = self.scanner.get_positions_snapshot(timeout_sec=timeout)
            if IB_EXCLUDE_ACCOUNTS:
                all_positions = [p for p in all_positions if p.get("account") not in IB_EXCLUDE_ACCOUNTS]
            accounts = sorted(set(p.get("account", "") for p in all_positions if p.get("account")))
            if not accounts:
                accounts = [a for a in self.scanner._managed_accounts if a not in IB_EXCLUDE_ACCOUNTS]
            return {"positions": all_positions, "accounts": accounts}
        except Exception as e:
            logger.error(f"Error fetching positions: {e}")
            return {"error": str(e)}

    def _handle_get_ma_positions_sync(self, payload: dict) -> dict:
        """Fetch M&A account positions from IB (reqPositions -> position/positionEnd).
        Filters to MA_ACCT_CODE only (U22596909)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        timeout = float(payload.get("timeout_sec", 15.0))
        try:
            all_positions = self.scanner.get_positions_snapshot(timeout_sec=timeout)
            positions = [p for p in all_positions if p.get("account") == self.MA_ACCT_CODE]
            return {"positions": positions, "account": self.MA_ACCT_CODE}
        except Exception as e:
            logger.error(f"Error fetching MA positions: {e}")
            return {"error": str(e)}

    def _handle_get_open_orders_sync(self, payload: dict) -> dict:
        """Fetch all open/working orders.

        By default returns from the in-memory live order book (no TWS round-trip).
        Pass force_refresh=true to re-query TWS and re-bind any manual orders.
        """
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        timeout = float(payload.get("timeout_sec", 10.0))
        force = bool(payload.get("force_refresh", False))
        try:
            # Detect whether the call will hit TWS (force, or first-sync fallback)
            synced = getattr(self.scanner, "_live_orders_synced", True)
            will_refresh = force or (not synced and self.scanner.isConnected())
            orders = self.scanner.get_open_orders_snapshot(
                timeout_sec=timeout, force_refresh=force,
            )
            return {
                "orders": orders,
                "live_order_count": self.scanner.get_live_order_count(),
                "source": "tws_refresh" if will_refresh else "live_book",
            }
        except Exception as e:
            logger.error(f"Error fetching open orders: {e}")
            return {"error": str(e)}

    def _handle_place_order_sync(self, payload: dict) -> dict:
        """Place order via IB (placeOrder -> orderStatus/error)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        contract_d = payload.get("contract") or {}
        order_d = payload.get("order") or {}
        timeout_sec = float(payload.get("timeout_sec", 30.0))
        try:
            return self.scanner.place_order_sync(contract_d, order_d, timeout_sec=timeout_sec)
        except Exception as e:
            logger.error(f"Error placing order: {e}")
            return {"error": str(e)}

    def _handle_modify_order_sync(self, payload: dict) -> dict:
        """Modify existing order via IB (placeOrder with same orderId)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        order_id = payload.get("orderId")
        if order_id is None:
            return {"error": "orderId required"}
        contract_d = payload.get("contract") or {}
        order_d = payload.get("order") or {}
        timeout_sec = float(payload.get("timeout_sec", 30.0))
        try:
            return self.scanner.modify_order_sync(int(order_id), contract_d, order_d, timeout_sec=timeout_sec)
        except Exception as e:
            logger.error(f"Error modifying order: {e}")
            return {"error": str(e)}

    async def _handle_cancel_order(self, payload: dict) -> dict:
        """Cancel order by orderId (sync in thread)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        order_id = payload.get("orderId")
        if order_id is None:
            return {"error": "orderId required"}
        try:
            return await self._run_in_thread(
                lambda: self.scanner.cancel_order_sync(int(order_id))
            )
        except Exception as e:
            logger.error(f"Error canceling order: {e}")
            return {"error": str(e)}

    async def _handle_test_futures(self, payload: dict) -> dict:
        """Fetch ES futures quote as a connectivity test.

        Two-step approach optimised for the IB Snapshot Bundle subscription:
        1. Snapshot (snapshot=True, REALTIME) -- fast, works during market
           hours, costs ~$0.01 per request.  Handles both real-time tick
           types (1/2/4) and delayed tick types (66/67/68) in case IB
           auto-downgrades.
        2. Historical fallback (reqHistoricalData) -- if snapshot returns
           nothing (market closed / weekend), get the most recent daily bar.
           Always works, ~0.3 s.
        """
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}

        contract_month = payload.get("contract_month", "")

        if not contract_month:
            now = datetime.now()
            if now.day > 15:
                month = now.month + 1
                year = now.year
                if month > 12:
                    month = 1
                    year += 1
            else:
                month = now.month
                year = now.year
            quarterly_months = [3, 6, 9, 12]
            for qm in quarterly_months:
                if qm >= month:
                    month = qm
                    break
            else:
                month = 3
                year += 1
            contract_month = f"{year}{month:02d}"

        logger.info(f"Fetching ES futures quote for {contract_month}")

        try:
            from ibapi.contract import Contract
            contract = Contract()
            contract.symbol = "ES"
            contract.secType = "FUT"
            contract.exchange = "CME"
            contract.currency = "USD"
            contract.lastTradeDateOrContractMonth = contract_month

            original_tickPrice = self.scanner.tickPrice

            # ── Step 1: Snapshot request (snapshot=True) ────────────────────
            rid = self.scanner.get_next_req_id()
            self.scanner.last_mkt_data_error = None
            futures_data = {"bid": None, "ask": None, "last": None}
            got_data = [False]
            ticks_seen = []

            def _handle_tick(reqId, tickType, price, attrib):
                if reqId != rid:
                    return
                ticks_seen.append(tickType)
                # Real-time tick types
                if tickType == 1:       # BID
                    futures_data["bid"] = price
                elif tickType == 2:     # ASK
                    futures_data["ask"] = price
                elif tickType == 4:     # LAST
                    futures_data["last"] = price
                    got_data[0] = True
                # Delayed tick types (IB may auto-downgrade)
                elif tickType == 66:    # DELAYED_BID
                    futures_data["bid"] = price
                elif tickType == 67:    # DELAYED_ASK
                    futures_data["ask"] = price
                elif tickType == 68:    # DELAYED_LAST
                    futures_data["last"] = price
                    got_data[0] = True

            self.scanner.tickPrice = _handle_tick
            self.scanner.reqMktData(rid, contract, "", True, False, [])  # snapshot=True

            # Wait up to 3 s for ticks
            for _ in range(30):
                time.sleep(0.1)
                if got_data[0] or futures_data["bid"] or futures_data["ask"] or futures_data["last"]:
                    time.sleep(0.2)  # brief pause to collect remaining ticks
                    break

            self.scanner.cancelMktData(rid)
            self.scanner.tickPrice = original_tickPrice

            has_any = (futures_data["bid"] is not None
                       or futures_data["ask"] is not None
                       or futures_data["last"] is not None)
            use_delayed = any(t >= 66 for t in ticks_seen)
            logger.info(f"test_futures SNAPSHOT: has_any={has_any}, ticks_seen={ticks_seen}, "
                        f"data={futures_data}, err={getattr(self.scanner, 'last_mkt_data_error', None)}")

            # ── Diagnostics: what did IB tell us about this request? ─────────
            mdt = self.scanner._last_market_data_type.get(rid)
            trp = self.scanner._last_tick_req_params.get(rid)
            snap_ended = rid in self.scanner._snapshot_end_events
            logger.info(f"test_futures DIAG: marketDataType={mdt}, tickReqParams={trp}, "
                        f"snapshotEnd={snap_ended}")

            # ── Step 2: Historical fallback (market closed / weekend) ───────
            from_historical = False
            if not has_any:
                logger.info("Snapshot returned no data, falling back to reqHistoricalData")
                hist_rid = self.scanner.get_next_req_id()
                bar_data = [None]
                hist_done = [False]

                orig_hd = getattr(self.scanner, 'historicalData', None)
                orig_hde = getattr(self.scanner, 'historicalDataEnd', None)

                def _on_bar(reqId, bar):
                    if reqId == hist_rid:
                        bar_data[0] = bar

                def _on_end(reqId, start, end):
                    if reqId == hist_rid:
                        hist_done[0] = True

                self.scanner.historicalData = _on_bar
                self.scanner.historicalDataEnd = _on_end

                self.scanner.reqHistoricalData(
                    hist_rid, contract,
                    "",         # endDateTime = now
                    "2 D",      # duration (covers weekend)
                    "1 day",    # bar size
                    "TRADES",   # whatToShow
                    0,          # useRTH = 0 (include extended hours)
                    1,          # formatDate
                    False,      # keepUpToDate
                    []          # chartOptions
                )

                for _ in range(50):  # 5 s timeout
                    time.sleep(0.1)
                    if hist_done[0]:
                        break

                if orig_hd is not None:
                    self.scanner.historicalData = orig_hd
                if orig_hde is not None:
                    self.scanner.historicalDataEnd = orig_hde

                if bar_data[0] is not None:
                    bar = bar_data[0]
                    close = getattr(bar, 'close', None)
                    logger.info(f"test_futures HISTORICAL: close={close}, "
                                f"high={getattr(bar, 'high', None)}, low={getattr(bar, 'low', None)}")
                    if close is not None:
                        futures_data = {"bid": None, "ask": None, "last": close}
                        has_any = True
                        use_delayed = True
                        from_historical = True
                else:
                    logger.info("test_futures HISTORICAL: no bar data received")

            # ── Build response ──────────────────────────────────────────────
            if not has_any:
                err = getattr(self.scanner, "last_mkt_data_error", None)
                if err and len(err) >= 3:
                    err_code = err[1]
                    if err_code in (354, 10090, 10167, 10168):
                        return {"error": f"ES futures market data not subscribed (IB error {err_code}). "
                                         f"In TWS: Account > Settings > Market Data Subscriptions; "
                                         f"add CME if needed."}
                return {"error": "No futures data received. Market may be closed "
                                 "(ES trades Sun 6 pm - Fri 5 pm ET) or check TWS "
                                 "market data permissions for CME futures."}

            month_codes = {3: 'H', 6: 'M', 9: 'U', 12: 'Z'}
            year_digit = contract_month[3]
            month_num = int(contract_month[4:6])
            month_code = month_codes.get(month_num, '?')
            contract_name = f"ES{month_code}{year_digit}"

            bid = futures_data["bid"]
            ask = futures_data["ask"]
            last = futures_data["last"]
            mid = (bid + ask) / 2 if bid is not None and ask is not None else (last if last is not None else None)
            return {
                "success": True,
                "contract": contract_name,
                "contract_month": contract_month,
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
                "delayed": use_delayed,
                "historical": from_historical,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error fetching futures: {e}")
            return {"error": str(e)}

    def _handle_fetch_chain_sync(self, payload: dict) -> dict:
        """Fetch option chain from IB (synchronous)"""
        ticker = payload.get("ticker", "").upper()
        deal_price = payload.get("dealPrice", 0)
        expected_close_date = payload.get("expectedCloseDate", "")
        scan_params = payload.get("scanParams", {})
        
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        
        days_before_close = scan_params.get("daysBeforeClose", 60)
        
        # Check cache
        cached_data = self.option_chain_cache.get(
            ticker, deal_price, expected_close_date, days_before_close
        )
        if cached_data:
            logger.info(f"Returning cached chain for {ticker}")
            return cached_data
        
        try:
            # Resolve stock contract first (conId + primaryExchange) to avoid IB error 200
            # on accounts where symbol+SMART is ambiguous or sec-def is slow.
            _ = self.scanner.resolve_contract(ticker)
            resolved = self.scanner.contract_details.contract if self.scanner.contract_details else None
            underlying_data = self.scanner.fetch_underlying_data(ticker, resolved_contract=resolved)
            if not underlying_data.get("price"):
                return {"error": f"Could not fetch price for {ticker}. Check agent console for [{ticker}] Step 2."}

            spot_price = underlying_data["price"]

            # Parse date
            try:
                close_date = datetime.strptime(expected_close_date, "%Y-%m-%d")
            except ValueError:
                return {"error": "Invalid date format. Use YYYY-MM-DD"}

            logger.info(f"Fetching chain for {ticker}, spot={spot_price}, deal={deal_price}")

            # Fetch options
            options = self.scanner.fetch_option_chain(
                ticker,
                expiry_months=6,
                current_price=spot_price,
                deal_close_date=close_date,
                days_before_close=days_before_close,
                deal_price=deal_price
            )

            # Convert to serializable format
            contracts = []
            expirations = set()

            for opt in options:
                expirations.add(opt.expiry)
                contracts.append({
                    "symbol": opt.symbol,
                    "strike": opt.strike,
                    "expiry": opt.expiry,
                    "right": opt.right,
                    "bid": opt.bid,
                    "ask": opt.ask,
                    "mid": opt.mid_price,
                    "last": opt.last,
                    "volume": opt.volume,
                    "open_interest": opt.open_interest,
                    "implied_vol": opt.implied_vol,
                    "delta": opt.delta,
                    "bid_size": opt.bid_size,
                    "ask_size": opt.ask_size
                })

            if not contracts:
                return {
                    "error": f"No options returned for {ticker}. Check agent console for [{ticker}] Step 1-5 to see where it failed (e.g. no expirations from IB, or no quotes)."
                }

            result = {
                "ticker": ticker,
                "spotPrice": spot_price,
                "expirations": sorted(list(expirations)),
                "contracts": contracts
            }

            # Cache result
            self.option_chain_cache.set(ticker, deal_price, expected_close_date, days_before_close, result)

            return result
        except Exception as e:
            logger.exception(f"Chain fetch failed for {ticker}")
            return {"error": f"Chain fetch failed for {ticker}: {e}. Check agent console for [{ticker}] step messages."}
    
    def _handle_fetch_prices_sync(self, payload: dict) -> dict:
        """Fetch prices for specific contracts using the same batch path as sell_scan and fetch_chain."""
        contracts = payload.get("contracts", [])
        if not contracts:
            return {"error": "No contracts specified"}
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        logger.info(f"Fetching prices for {len(contracts)} contracts (batch)")
        # Normalize and group by ticker to call get_option_data_batch once per ticker (preserves order).
        by_ticker = {}
        for i, c in enumerate(contracts):
            ticker = (c.get("ticker") or "").upper()
            strike = float(c.get("strike", 0))
            expiry = (c.get("expiry") or "").replace("-", "")
            right = (c.get("right") or "C").upper()
            if ticker not in by_ticker:
                by_ticker[ticker] = []
            by_ticker[ticker].append((i, expiry, strike, right))
        results = [None] * len(contracts)
        for ticker, items in by_ticker.items():
            batch = [(expiry, strike, right) for (_, expiry, strike, right) in items]
            batch_results = self.scanner.get_option_data_batch(ticker, batch)
            for (idx, expiry_norm, strike, right), opt in zip(items, batch_results):
                if opt and (opt.bid > 0 or opt.ask > 0):
                    results[idx] = {
                        "ticker": ticker,
                        "strike": strike,
                        "expiry": expiry_norm,
                        "right": right,
                        "bid": opt.bid,
                        "ask": opt.ask,
                        "mid": opt.mid_price,
                        "last": opt.last,
                        "delta": opt.delta if hasattr(opt, 'delta') and opt.delta is not None and opt.delta != 0 else None,
                        "gamma": opt.gamma if hasattr(opt, 'gamma') and opt.gamma is not None and opt.gamma != 0 else None,
                        "theta": opt.theta if hasattr(opt, 'theta') and opt.theta is not None and opt.theta != 0 else None,
                        "vega": opt.vega if hasattr(opt, 'vega') and opt.vega is not None and opt.vega != 0 else None,
                        "implied_vol": opt.implied_vol if hasattr(opt, 'implied_vol') and opt.implied_vol is not None and opt.implied_vol != 0 else None,
                    }
                else:
                    results[idx] = None
        return {"success": True, "contracts": results}

    def _handle_sell_scan_sync(self, payload: dict) -> dict:
        """Fetch near-the-money calls or puts for expirations in the next 0-15 business days (for selling)."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": self._ib_not_connected_error()}
        ticker = (payload.get("ticker") or "").upper()
        right = (payload.get("right") or "C").upper()
        if right not in ("C", "P"):
            return {"error": "right must be C or P"}
        ntm_pct = float(payload.get("ntm_pct", 0.05))
        business_days = int(payload.get("business_days", 15))
        try:
            underlying = self.scanner.fetch_underlying_data(ticker)
            spot = underlying.get("price")
            if not spot:
                return {"error": f"Could not fetch price for {ticker}"}
            contract_id = self.scanner.resolve_contract(ticker) or 0
            all_expirations = self.scanner.get_available_expirations(ticker, contract_id)
            if not all_expirations:
                return {"error": f"No option expirations for {ticker}"}

            def add_business_days(start_date, n):
                d = start_date
                count = 0
                while count < n:
                    d += timedelta(days=1)
                    if d.weekday() < 5:
                        count += 1
                return d

            today = datetime.now().date()
            end_date = add_business_days(today, business_days)
            sorted_expirations = sorted(set(all_expirations))
            in_range = []
            for exp in sorted_expirations:
                try:
                    exp_date = datetime.strptime(exp, "%Y%m%d").date()
                except ValueError:
                    continue
                if today <= exp_date <= end_date:
                    in_range.append(exp)
            if not in_range:
                return {"error": f"No expirations in the next {business_days} business days for {ticker}"}

            lower = spot * (1 - ntm_pct)
            upper = spot * (1 + ntm_pct)
            batch: list = []
            expirations_used = []
            increment = 5.0 if spot > 50 else 2.5
            for expiry in in_range:
                strikes = getattr(self.scanner, "available_strikes", {}).get(expiry, [])
                ntm_strikes = [s for s in strikes if lower <= s <= upper and self.scanner._strike_on_grid(s, increment)]
                if not ntm_strikes and strikes:
                    ntm_strikes = [s for s in strikes if lower <= s <= upper][:15]
                for strike in ntm_strikes:
                    batch.append((expiry, strike, right))
                if ntm_strikes:
                    expirations_used.append(expiry)
            results = self.scanner.get_option_data_batch(ticker, batch)
            contracts = []
            for opt in results:
                if opt:
                    contracts.append({
                        "symbol": opt.symbol,
                        "strike": opt.strike,
                        "expiry": opt.expiry,
                        "right": opt.right,
                        "bid": opt.bid,
                        "ask": opt.ask,
                        "mid": opt.mid_price,
                        "last": opt.last,
                        "volume": opt.volume,
                        "open_interest": opt.open_interest,
                        "implied_vol": opt.implied_vol,
                        "delta": opt.delta,
                    })
            return {
                "ticker": ticker,
                "spotPrice": spot,
                "right": right,
                "expirations": expirations_used,
                "contracts": contracts,
            }
        except Exception as e:
            logger.exception(f"sell_scan failed for {ticker} {right}")
            return {"error": str(e)}

    # ── Execution engine request handlers ──

    async def _shared_bootstrap_all_tickers(self, to_load: list[dict]) -> dict | None:
        """Run ONE Polygon bootstrap + backfill for all unique tickers.

        Returns a dict with daily_features, regime, and intraday_bars that
        each strategy can inject into its own LiveDataStore, skipping
        redundant Polygon REST calls.
        """
        try:
            from big_move_convexity.live.data_store import LiveDataStore
            from big_move_convexity.live.daily_bootstrap import DailyBootstrap
            from strategies.big_move_convexity import _CROSS_ASSET_TICKERS
        except ImportError as e:
            logger.warning("Shared bootstrap: import failed (%s), falling back to per-strategy", e)
            return None

        # Collect all unique tickers across all strategies
        all_tickers: list[str] = []
        for cfg in to_load:
            config = cfg.get("config", {})
            ticker = config.get("ticker", cfg.get("strategy_id", "").replace("bmc_", "").upper())
            # Remove directional suffixes
            for suffix in ("_UP", "_DOWN"):
                if ticker.endswith(suffix):
                    ticker = ticker[:-len(suffix)]
            all_tickers.append(ticker)

        # Build the full ticker list: all strategy tickers + SPY + cross-asset + TIP
        bootstrap_tickers = list(dict.fromkeys(
            all_tickers + ["SPY"] + list(_CROSS_ASSET_TICKERS) + ["TIP"]
        ))
        backfill_tickers = list(dict.fromkeys(
            all_tickers + list(_CROSS_ASSET_TICKERS) + ["SPY"]
        ))

        logger.info(
            "Shared bootstrap: %d strategies, %d bootstrap tickers, %d backfill tickers",
            len(to_load), len(bootstrap_tickers), len(backfill_tickers),
        )
        await self._send_boot_phase(
            "strategy_loading",
            f"Bootstrapping {len(bootstrap_tickers)} tickers...",
            progress=0.3,
        )

        # Run bootstrap into a temporary data store
        shared_store = LiveDataStore(max_bars_per_type=10000)
        bootstrap = DailyBootstrap()

        try:
            bootstrap_result = await self._run_in_thread(
                lambda: asyncio.run(
                    bootstrap.bootstrap(shared_store, tickers=bootstrap_tickers)
                )
            )
            logger.info("Shared bootstrap complete: %s", bootstrap_result)
        except Exception:
            logger.warning("Shared bootstrap failed, falling back to per-strategy", exc_info=True)
            return None

        await self._send_boot_phase(
            "strategy_loading",
            f"Backfilling intraday bars for {len(backfill_tickers)} tickers...",
            progress=0.4,
        )

        try:
            backfill_result = await self._run_in_thread(
                lambda: asyncio.run(
                    bootstrap.backfill_intraday_bars(shared_store, backfill_tickers)
                )
            )
            logger.info("Shared backfill complete: %s", backfill_result)
        except Exception:
            logger.warning("Shared backfill failed — strategies will rely on WS bars", exc_info=True)

        # Extract data from the shared store
        from datetime import date
        today_str = date.today().isoformat()
        daily_features = shared_store._daily_features.get(today_str, {})
        regime = shared_store._regime or {}

        # Extract intraday bars — format: {store_key: [bar_dicts]}
        intraday_bars: dict[str, list] = {}
        for store_key, bar_list in shared_store._bars.items():
            if bar_list:
                intraday_bars[store_key] = list(bar_list)

        logger.info(
            "Shared bootstrap extracted: %d daily features, %d regime keys, %d bar store keys",
            len(daily_features), len(regime), len(intraday_bars),
        )
        return {
            "daily_features": daily_features,
            "regime": regime,
            "intraday_bars": intraday_bars,
        }

    async def _load_single_strategy(self, strat_cfg: dict) -> dict:
        """Create, load, and register a single strategy from config.

        Shared by _handle_execution_start (normal + expanded) and
        _handle_execution_add_ticker. Returns the load_strategy result dict.
        """
        strategy_id = strat_cfg.get("strategy_id", "")
        strategy_type = strat_cfg.get("strategy_type", "")
        config = strat_cfg.get("config", {})
        config["_strategy_type"] = strategy_type
        ticker_budget = strat_cfg.get("ticker_budget", -1)

        if not strategy_id:
            return {"error": "strategy_id is required"}

        if strategy_id in self.execution_engine._strategies:
            return {"strategy_id": strategy_id, "status": "already_loaded"}

        strategy = self._create_strategy(strategy_type)
        if strategy is None:
            return {"error": f"Unknown strategy_type: {strategy_type}"}

        # Set parent strategy ID for risk manager lineage
        # For expanded variants like bmc_spy_up, parent is still this strategy_id
        strategy._parent_strategy_id = strategy_id

        # Report loading progress to relay
        ticker = config.get("ticker", strategy_id.replace("bmc_", "").upper())
        await self._send_boot_phase("strategy_loading", f"Loading {ticker}...")

        # Run load_strategy in a thread pool so strategy.on_start()
        # (which performs blocking REST calls for bootstrap + backfill)
        # doesn't freeze the asyncio event loop and cause relay timeouts.
        result = await self._run_in_thread(
            self.execution_engine.load_strategy, strategy_id, strategy, config
        )

        # Set ticker + per-ticker budget on the StrategyState
        if "error" not in result:
            state = self.execution_engine._strategies.get(strategy_id)
            if state:
                state.ticker = config.get("ticker", strategy_id.replace("bmc_", "").upper())
                if ticker_budget != -1:
                    state.ticker_entry_budget = ticker_budget

        return result

    def _recover_persisted_risk_managers(self) -> int:
        """Recover active risk managers from the persistent position store."""
        if not self.execution_engine:
            return 0

        recovered = 0
        active_positions = self.position_store.get_active_positions()
        if not active_positions:
            return 0

        from strategies.risk_manager import RiskManagerStrategy

        for pos in active_positions:
            pos_id = pos.get("id", "")
            if not pos_id or pos_id in self.execution_engine._strategies:
                continue  # already loaded or invalid
            stored_config = pos.get("risk_config", {})
            if not stored_config:
                logger.warning("Skipping recovery of %s: no risk_config in store", pos_id)
                continue
            try:
                rm = RiskManagerStrategy()
                parent_sid = pos.get("parent_strategy", "")
                rm._parent_strategy_id = parent_sid
                load_result = self.execution_engine.load_strategy(pos_id, rm, stored_config)
                if "error" in load_result:
                    logger.error("Recovery of %s failed: %s", pos_id, load_result["error"])
                    continue

                # Restore fill log before runtime state so per-lot recovery can
                # reconstruct lot ownership from realized exits if needed.
                fill_log = pos.get("fill_log", [])
                if fill_log:
                    rm._fill_log = fill_log

                # Restore runtime state over fresh on_start defaults
                runtime = pos.get("runtime_state", {})
                if runtime:
                    rm.restore_runtime_state(runtime)

                # Set ticker on StrategyState so Gate 0 (ticker mode) applies
                rm_state = self.execution_engine._strategies.get(pos_id)
                if rm_state:
                    rm_state.ticker = resolve_rm_ticker(
                        stored_config.get("instrument", {}),
                        parent_sid,
                    )

                recovered += 1
                logger.info(
                    "Recovered risk manager %s (remaining=%d, ticker=%s)",
                    pos_id,
                    rm.remaining_qty,
                    rm_state.ticker if rm_state else "?",
                )

                # Populate parent BMC strategy's _active_positions list + counter.
                # Aggregate positions have multiple lot_entries -- expand each
                # into its own _active_positions entry so cooldown and spawn
                # counts reflect the actual number of fills.
                parent = pos.get("parent_strategy", "")
                parent_state = self.execution_engine._strategies.get(parent)
                if not parent_state and parent:
                    # Try directional variants (e.g. parent="bmc_spy" -> "bmc_spy_up", "bmc_spy_down")
                    for suffix in ("_up", "_down"):
                        alt_key = parent + suffix
                        alt_state = self.execution_engine._strategies.get(alt_key)
                        if alt_state and hasattr(alt_state.strategy, "_active_positions"):
                            parent_state = alt_state
                            logger.info(
                                "Recovery: matched parent %s to directional variant %s",
                                parent, alt_key,
                            )
                            break
                if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                    instrument = pos.get("instrument", {})
                    option_contract = {
                        "symbol": instrument.get("symbol", ""),
                        "strike": instrument.get("strike", 0),
                        "expiry": instrument.get("expiry", ""),
                        "right": instrument.get("right", ""),
                    }
                    # Use lot_entries from runtime state if available (aggregated),
                    # else fall back to the single entry record (pre-aggregation compat)
                    runtime = pos.get("runtime_state", {})
                    lot_entries = runtime.get("lot_entries", [])
                    if not lot_entries:
                        entry_info = pos.get("entry", {})
                        lot_entries = [{
                            "order_id": entry_info.get("order_id", 0),
                            "entry_price": entry_info.get("price", 0),
                            "quantity": entry_info.get("quantity", 0),
                            "fill_time": entry_info.get("fill_time", 0),
                            "perm_id": entry_info.get("perm_id", 0),
                        }]
                    for lot in lot_entries:
                        parent_state.strategy._active_positions.append({
                            "order_id": lot.get("order_id", 0),
                            "entry_price": lot.get("entry_price", 0),
                            "quantity": lot.get("quantity", 0),
                            "fill_time": lot.get("fill_time", 0),
                            "perm_id": lot.get("perm_id", 0),
                            "signal": {"option_contract": option_contract},
                        })
                        if hasattr(parent_state.strategy, "_positions_spawned"):
                            parent_state.strategy._positions_spawned += 1
                    # Restore cooldown tracker from the most recent fill time
                    ticker = instrument.get("symbol", "").upper()
                    max_fill_time = max(
                        (lot.get("fill_time", 0) for lot in lot_entries), default=0
                    )
                    if (
                        ticker
                        and max_fill_time
                        and hasattr(parent_state.strategy, "_cooldown_tracker")
                        and max_fill_time > parent_state.strategy._cooldown_tracker.get(ticker, 0)
                    ):
                        parent_state.strategy._cooldown_tracker[ticker] = max_fill_time
                        logger.info(
                            "Restored cooldown for %s (last fill %.0fs ago)",
                            ticker, time.time() - max_fill_time,
                        )
            except Exception as e:
                logger.error("Error recovering position %s: %s", pos_id, e)

        if recovered > 0:
            logger.info("Recovered %d risk manager position(s) from store", recovered)
        return recovered

    async def _handle_execution_start(self, payload: dict) -> dict:
        """Start execution engine with strategy configuration.

        If the engine is already running, just load any new strategies from
        the payload (backward-compatible additive behavior).
        """
        if not self.execution_engine:
            return {"error": f"Execution engine not initialized ({self._ib_not_connected_error()})"}

        already_running = self.execution_engine.is_running

        strategies_config = payload.get("strategies", [])
        if not strategies_config and not already_running:
            return {"error": "No strategies specified in payload"}

        # ── Pass 1: expand directional strategies, collect all configs to load ──
        to_load: list[dict] = []  # final strategy configs (after expansion)
        results = []
        for strat_cfg in strategies_config:
            strategy_id = strat_cfg.get("strategy_id", "")
            strategy_type = strat_cfg.get("strategy_type", "")
            config = strat_cfg.get("config", {})
            config["_strategy_type"] = strategy_type
            ticker_budget = strat_cfg.get("ticker_budget", -1)

            if not strategy_id:
                results.append({"error": "strategy_id is required"})
                continue

            resolved = self._resolve_strategy_ids(strategy_id)
            if resolved and resolved[0] in self.execution_engine._strategies:
                results.append({"strategy_id": strategy_id, "status": "already_loaded",
                                "resolved_ids": resolved})
                continue

            if config.get("ticker") and not config.get("model_version"):
                expanded = self._expand_directional_strategies(strat_cfg)
                if expanded:
                    to_load.extend(expanded)
                    continue

            to_load.append(strat_cfg)

        # ── Shared bootstrap: fetch Polygon data ONCE for all tickers ──
        shared_bootstrap = None
        if to_load and len(to_load) > 1:
            shared_bootstrap = await self._shared_bootstrap_all_tickers(to_load)

        # ── Create shared Polygon WS infrastructure for BMC strategies ──
        # One WS connection + data store for all strategies instead of N connections.
        bmc_count = sum(1 for c in to_load if c.get("strategy_type", c.get("config", {}).get("_strategy_type", "")) == "big_move_convexity"
                        or c.get("strategy_id", "").startswith("bmc_"))
        if bmc_count >= 2 and not self._shared_polygon_infra:
            try:
                from strategies.big_move_convexity import SharedPolygonInfra
                use_delayed = any(c.get("config", {}).get("use_delayed_data", False) for c in to_load)
                self._shared_polygon_infra = SharedPolygonInfra(use_delayed=use_delayed)
                self._shared_polygon_infra.start()
                # Inject bootstrap data into shared data store ONCE
                if shared_bootstrap:
                    self._shared_polygon_infra.inject_bootstrap(shared_bootstrap)
                logger.info("Created SharedPolygonInfra for %d BMC strategies", bmc_count)
            except Exception:
                logger.exception("Failed to create SharedPolygonInfra — falling back to per-strategy")
                self._shared_polygon_infra = None

        # ── Pass 2: load strategies in parallel ──
        if to_load:
            # Inject shared bootstrap data and shared Polygon infra into each strategy's config
            if shared_bootstrap:
                for cfg in to_load:
                    cfg.setdefault("config", {})["_shared_bootstrap"] = shared_bootstrap
            if self._shared_polygon_infra:
                for cfg in to_load:
                    if cfg.get("strategy_id", "").startswith("bmc_"):
                        cfg.setdefault("config", {})["_shared_polygon_infra"] = self._shared_polygon_infra

            await self._send_boot_phase(
                "strategies_loading",
                f"Loading {len(to_load)} strategies in parallel...",
                progress=0.5,
            )

            # Load all strategies concurrently
            load_tasks = [self._load_single_strategy(cfg) for cfg in to_load]
            load_results = await asyncio.gather(*load_tasks, return_exceptions=True)
            for i, lr in enumerate(load_results):
                if isinstance(lr, Exception):
                    logger.error("Strategy load failed: %s", lr)
                    results.append({"error": str(lr), "strategy_id": to_load[i].get("strategy_id", "?")})
                else:
                    results.append(lr)

        if not already_running:
            # ── Recover persisted risk manager positions ──
            recovered = self._recover_persisted_risk_managers()

            # ── IB Reconciliation on startup (WS4) ──
            try:
                recovery = self._run_broker_recovery_pass(
                    include_executions=True,
                    open_orders_force_refresh=True,
                )
                recon = recovery["reconciliation"] or {
                    "matched": [],
                    "orphaned_ib": [],
                    "stale_agent": [],
                    "adjusted": [],
                }
                ingest = recovery["execution_ingest"] or {}
                if ingest.get("ingested"):
                    logger.info(
                        "Startup broker replay: ingested %d execution(s), %d unresolved",
                        ingest.get("ingested", 0),
                        ingest.get("unresolved", 0),
                    )
                if recon["orphaned_ib"]:
                    n_spawned = self._spawn_missing_risk_managers(recon["orphaned_ib"])
                    logger.warning(
                        "IB reconciliation: %d orphaned IB option position(s) — "
                        "auto-spawned %d risk manager(s)",
                        len(recon["orphaned_ib"]), n_spawned,
                    )
                if recon["stale_agent"]:
                    logger.warning("IB reconciliation: %d stale positions closed", len(recon["stale_agent"]))
                if recon["adjusted"]:
                    logger.warning("IB reconciliation: %d positions with qty mismatch", len(recon["adjusted"]))
            except Exception as e:
                logger.error("IB reconciliation on startup failed: %s", e)

            # Fresh start clears any stale paused flag from prior auto-restart
            self.execution_engine._auto_restart_paused = False
            # Start the evaluation loop
            self.execution_engine.start()

            # Immediately send execution telemetry so dashboard updates
            # without waiting for the next heartbeat cycle (~20s)
            if self.websocket and self.execution_engine.is_running:
                try:
                    telemetry = self.execution_engine.get_telemetry()
                    await self._send_ws_json({
                        "type": "execution_telemetry",
                        **telemetry
                    })
                except Exception:
                    pass  # best-effort, heartbeat will catch up
        else:
            recovered = 0
            logger.info("Execution engine already running — added %d new strategies", len(results))

        # Persist engine config for auto-restart
        self._persist_engine_config("execution_start")

        return {
            "running": self.execution_engine.is_running,
            "strategies_loaded": results,
            "recovered_positions": recovered,
            "lines_held": self.resource_manager.execution_lines_held,
            "budget_status": self.execution_engine.get_budget_status(),
        }

    async def _handle_execution_stop(self, payload: dict) -> dict:
        """Stop execution engine and free all streaming subscriptions."""
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}

        # Snapshot all risk manager runtime states before shutdown
        for sid, state in self.execution_engine._strategies.items():
            if sid.startswith("bmc_risk_") and hasattr(state.strategy, "get_runtime_snapshot"):
                try:
                    snapshot = state.strategy.get_runtime_snapshot()
                    self.position_store.update_runtime_state(sid, snapshot)
                except Exception as e:
                    logger.error("Error snapshotting %s on stop: %s", sid, e)

        # Clear config BEFORE stop — if crash during stop(), no stale auto-restart
        self.engine_config_store.clear()
        self.execution_engine._auto_restart_paused = False
        self.execution_engine.stop()

        # Force-shutdown shared Polygon WS (safety net — strategies release on stop,
        # but force-shutdown ensures cleanup even if a strategy's on_stop fails)
        if self._shared_polygon_infra is not None:
            try:
                self._shared_polygon_infra.shutdown()
            except Exception:
                logger.debug("Error shutting down SharedPolygonInfra", exc_info=True)
            self._shared_polygon_infra = None

        # Push a final execution_telemetry with running=False so the relay cache
        # is updated immediately.  Without this, the stale cached telemetry
        # (running=True from the last heartbeat) keeps the dashboard showing
        # "running" until the next heartbeat cycle — which never sends telemetry
        # when the engine is stopped.
        try:
            if self.websocket:
                await self._send_ws_json({
                    "type": "execution_telemetry",
                    "running": False,
                    "strategy_count": 0,
                    "strategies": [],
                    "active_orders": [],
                    "inflight_orders_total": 0,
                    "lines_held": self.resource_manager.execution_lines_held,
                    "order_budget": 0,
                    "total_algo_orders": self.execution_engine._total_entries_placed,
                    "budget_status": {},
                    "position_ledger": self.execution_engine._get_position_ledger(),
                    "engine_mode": "running",
                })
        except Exception as e:
            logger.warning("Failed to push final telemetry on stop: %s", e)

        return {
            "running": False,
            "lines_held": self.resource_manager.execution_lines_held,
        }

    async def _handle_execution_status(self, payload: dict) -> dict:
        """Return current execution engine status."""
        if not self.execution_engine:
            return {"running": False, "error": "Execution engine not initialized"}
        return self.execution_engine.get_status()

    async def _handle_execution_config(self, payload: dict) -> dict:
        """Update strategy configuration without restart.

        Also propagates risk-related fields to running risk managers
        (hot-modify). See _BMC_RISK_FIELDS for the set of fields that
        trigger propagation.
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        strategy_id = payload.get("strategy_id", "")
        new_config = payload.get("config", {})
        if not strategy_id:
            return {"error": "strategy_id is required"}
        # Resolve directional variants (e.g. bmc_spy -> bmc_spy_up, bmc_spy_down)
        resolved_ids = self._resolve_strategy_ids(strategy_id)
        result = {}
        for sid in resolved_ids:
            result = self.execution_engine.update_strategy_config(sid, new_config)
            if "error" in result:
                break
        if len(resolved_ids) > 1:
            result["resolved_ids"] = resolved_ids

        # ── Hot-modify running risk managers if risk fields changed ──
        if _BMC_RISK_FIELDS & set(new_config.keys()):
            risk_update = _translate_bmc_to_risk_config(new_config)
            if risk_update:
                rm_updated = 0
                for sid in resolved_ids:
                    rms = self.execution_engine.get_risk_managers_for_parent(sid)
                    for rm_sid, rm_state in rms:
                        try:
                            rm = rm_state.strategy
                            changes = rm.update_risk_config(risk_update)
                            # Sync updated risk config back into state.config
                            # so the eval loop passes current values to evaluate()
                            for rk in ("stop_loss", "profit_taking", "eod_exit_time", "eod_min_bid"):
                                if rk in rm._risk_config:
                                    rm_state.config[rk] = rm._risk_config[rk]
                            # Persist updated config to position store
                            self.position_store.update_risk_config(rm_sid, risk_update)
                            # Persist runtime state (level_states may have changed)
                            if hasattr(rm, "get_runtime_snapshot"):
                                self.position_store.update_runtime_state(
                                    rm_sid, rm.get_runtime_snapshot()
                                )
                            # Execute cancellation intents from disabled levels
                            cancel_ids = changes.get("cancel_order_ids", [])
                            for oid in cancel_ids:
                                try:
                                    self.scanner.cancelOrder(oid)
                                    logger.info("Cancelled order %d (risk config change on %s)", oid, rm_sid)
                                except Exception as ce:
                                    logger.error("Failed to cancel order %d: %s", oid, ce)
                            rm_updated += 1
                            logger.info("Hot-modified risk manager %s: %s", rm_sid, changes)
                        except Exception as e:
                            logger.error("Failed to hot-modify %s: %s", rm_sid, e)
                result["risk_managers_updated"] = rm_updated

        self._persist_engine_config("config_change")

        # Push telemetry immediately so the relay cache has the new config
        # and the next dashboard poll sees updated values (reduces stale window
        # from ~20s to ~2s).
        try:
            if self.execution_engine.is_running and self.websocket:
                telemetry = self.execution_engine.get_telemetry()
                await self._send_ws_json({
                    "type": "execution_telemetry",
                    **telemetry
                })
        except Exception:
            logger.debug("Failed to push immediate telemetry after config change", exc_info=True)

        return result

    async def _handle_execution_budget(self, payload: dict) -> dict:
        """Set entry budget — global cap, per-ticker, or risk budget.

        Payload:
            scope: "global" (default), "ticker", or "risk"
            budget: -1=unlimited, 0=halt/disable, N=exactly N entries (global/ticker)
                    or USD dollar amount (risk scope)
            strategy_id: required when scope="ticker"
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        scope = payload.get("scope", "global")
        budget = int(payload.get("budget", 0))

        if scope == "risk":
            budget_usd = float(payload.get("budget", 0))
            result = self.execution_engine.set_risk_budget(budget_usd)
        elif scope == "ticker":
            strategy_id = payload.get("strategy_id", "")
            if not strategy_id:
                return {"error": "strategy_id is required for scope=ticker"}
            result = self.execution_engine.set_ticker_budget(strategy_id, budget)
        else:
            result = self.execution_engine.set_global_entry_cap(budget)

            # Sync per-ticker budgets with global budget to maintain the
            # single-budget mental model the UI presents.
            if budget == 0:
                # HALT: also halt all per-ticker budgets for fast Gate 1a rejection
                for sid, state in self.execution_engine._strategies.items():
                    if not sid.startswith("bmc_risk_"):
                        state.ticker_entry_budget = 0
            elif budget != 0:
                unblocked = []
                for sid, state in self.execution_engine._strategies.items():
                    if sid.startswith("bmc_risk_"):
                        continue
                    if state.ticker_entry_budget == 0:
                        # Restore from saved paused budgets if available, else unlimited
                        saved = getattr(self, "_saved_ticker_budgets", {}).get(sid, -1)
                        state.ticker_entry_budget = saved if saved != 0 else -1
                        unblocked.append(sid)
                if unblocked:
                    logger.info("Global budget set to %s — unblocked per-ticker budgets for: %s",
                                "UNLIMITED" if budget == -1 else budget, ", ".join(unblocked))

                # Also clear auto-restart paused flag if it was set
                if self.execution_engine._auto_restart_paused:
                    self.execution_engine._auto_restart_paused = False
                    logger.info("Cleared auto-restart PAUSED state (user set budget)")

        self._persist_engine_config("budget_change")
        return result

    async def _handle_execution_ticker_mode(self, payload: dict) -> dict:
        """Set per-ticker trade mode (NORMAL, EXIT_ONLY, NO_ORDERS).

        Payload:
            ticker: str (e.g. "SPY")
            mode: str ("NORMAL", "EXIT_ONLY", "NO_ORDERS")
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        ticker = payload.get("ticker", "").upper()
        mode_str = payload.get("mode", "NORMAL").upper()
        if not ticker:
            return {"error": "ticker is required"}

        from execution_engine import TickerMode
        try:
            mode = TickerMode(mode_str)
        except ValueError:
            return {"error": f"Invalid mode: {mode_str}. Valid: NORMAL, EXIT_ONLY, NO_ORDERS"}

        result = self.execution_engine.set_ticker_mode(ticker, mode)
        self._persist_engine_config("ticker_mode_change")
        return result

    async def _handle_position_risk_config(self, payload: dict) -> dict:
        """Update risk config for a SPECIFIC position (risk manager).

        Unlike execution_config (which targets all RMs under a ticker),
        this targets a single RM by position_id.

        Payload:
            position_id: str (e.g. "bmc_risk_1709742000000")
            config: dict (e.g. {"eod_exit_time": "15:30", "eod_min_bid": 0.05})
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        position_id = payload.get("position_id")
        config_update = payload.get("config", {})

        if not position_id:
            return {"error": "position_id is required"}

        state = self.execution_engine._strategies.get(position_id)
        if not state:
            return {"error": f"Position {position_id} not found"}

        rm = state.strategy
        if not hasattr(rm, "update_risk_config"):
            return {"error": f"{position_id} is not a risk manager"}

        changes = rm.update_risk_config(config_update)

        # Sync back to state.config so eval loop passes current values
        for key in ("eod_exit_time", "eod_min_bid", "stop_loss", "profit_taking"):
            if key in rm._risk_config:
                state.config[key] = rm._risk_config[key]

        # Persist to position store
        if self.position_store:
            self.position_store.update_risk_config(position_id, config_update)
            if hasattr(rm, "get_runtime_snapshot"):
                self.position_store.update_runtime_state(
                    position_id, rm.get_runtime_snapshot()
                )

        # Cancel orders for disabled levels
        for oid in changes.get("cancel_order_ids", []):
            try:
                self.scanner.cancelOrder(oid)
                logger.info("Cancelled order %d (position risk config change on %s)", oid, position_id)
            except Exception as ce:
                logger.error("Failed to cancel order %d: %s", oid, ce)

        self._persist_engine_config("position_risk_config")
        logger.info("Position risk config updated for %s: %s", position_id, changes)
        return {"ok": True, "changes": changes}

    async def _handle_execution_add_ticker(self, payload: dict) -> dict:
        """Add a single ticker/strategy to the running execution engine.

        Payload:
            strategy_id: str (e.g. "bmc_spy")
            strategy_type: str (e.g. "big_move_convexity")
            config: dict (strategy config including "ticker")
            ticker_budget: int (optional, default -1=unlimited)
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running -- call execution_start first"}

        strategy_id = payload.get("strategy_id", "")
        strategy_type = payload.get("strategy_type", "")
        config = payload.get("config", {})
        config["_strategy_type"] = strategy_type  # stash for config persistence
        ticker_budget = int(payload.get("ticker_budget", -1))

        if not strategy_id:
            return {"error": "strategy_id is required"}

        # Check if already loaded (including directional variants)
        resolved = self._resolve_strategy_ids(strategy_id)
        if resolved and resolved[0] in self.execution_engine._strategies:
            return {"error": f"Strategy {strategy_id} is already loaded (resolved: {resolved})"}

        strat_cfg = {
            "strategy_id": strategy_id,
            "strategy_type": strategy_type,
            "config": config,
            "ticker_budget": ticker_budget,
        }

        # Inject shared Polygon infra if available (new ticker joins existing shared WS)
        if self._shared_polygon_infra and strategy_id.startswith("bmc_"):
            config["_shared_polygon_infra"] = self._shared_polygon_infra

        # ── Directional expansion: split into UP/DOWN if both models exist ──
        if config.get("ticker") and not config.get("model_version"):
            expanded = self._expand_directional_strategies(strat_cfg)
            if expanded:
                results = []
                for exp_cfg in expanded:
                    # Propagate shared infra to expanded configs
                    if self._shared_polygon_infra:
                        exp_cfg.setdefault("config", {})["_shared_polygon_infra"] = self._shared_polygon_infra
                    exp_result = await self._load_single_strategy(exp_cfg)
                    results.append(exp_result)
                result = {
                    "expanded": True,
                    "strategies_loaded": results,
                    "budget_status": self.execution_engine.get_budget_status(),
                }
                self._persist_engine_config("ticker_add")
                return result

        # ── Single strategy creation ──
        result = await self._load_single_strategy(strat_cfg)
        result["budget_status"] = self.execution_engine.get_budget_status()
        self._persist_engine_config("ticker_add")
        return result

    async def _handle_execution_remove_ticker(self, payload: dict) -> dict:
        """Remove a single ticker/strategy from the running engine.

        Payload:
            strategy_id: str (e.g. "bmc_spy")

        Note: Risk managers for this ticker's positions keep running
        (they are separate strategy_ids like "bmc_risk_*").
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}

        strategy_id = payload.get("strategy_id", "")
        if not strategy_id:
            return {"error": "strategy_id is required"}

        # Resolve directional variants (e.g. bmc_spy -> bmc_spy_up, bmc_spy_down)
        resolved_ids = self._resolve_strategy_ids(strategy_id)
        if not resolved_ids or (len(resolved_ids) == 1
                                and resolved_ids[0] not in self.execution_engine._strategies):
            return {"error": f"Strategy {strategy_id} not found"}

        result = {}
        for sid in resolved_ids:
            result = self.execution_engine.unload_strategy(sid)
        if len(resolved_ids) > 1:
            result["resolved_ids"] = resolved_ids
        result["budget_status"] = self.execution_engine.get_budget_status()
        self._persist_engine_config("ticker_remove")
        return result

    async def _handle_close_position(self, payload: dict) -> dict:
        """Manually close a position: unload risk manager, mark closed in store."""
        position_id = payload.get("position_id", "")
        if not position_id:
            return {"error": "position_id is required"}

        # Check the position exists in the store
        pos = self.position_store.get_position(position_id)
        if pos is None:
            return {"error": f"Position {position_id} not found in store"}
        if pos.get("status") == "closed":
            return {"error": f"Position {position_id} is already closed"}

        # Cancel any working IB orders and unload the risk manager strategy
        if self.execution_engine and position_id in self.execution_engine._strategies:
            rm_state = self.execution_engine._strategies[position_id]
            if hasattr(rm_state.strategy, "_pending_orders"):
                for oid in list(rm_state.strategy._pending_orders.keys()):
                    logger.info("Cancelling order %d for manual close of %s", oid, position_id)
                    try:
                        self.scanner.cancelOrder(oid)
                    except Exception as e:
                        logger.error("Failed to cancel order %d: %s", oid, e)
            self.execution_engine.unload_strategy(position_id)
            logger.info("Unloaded risk manager %s for manual close", position_id)

        # Remove from parent BMC strategy's _active_positions list.
        # For aggregate positions, remove ALL lot entries that match
        # the instrument (symbol + strike + expiry + right).
        parent = pos.get("parent_strategy", "")
        if parent and self.execution_engine:
            parent_state = self.execution_engine._strategies.get(parent)
            if not parent_state:
                # Fallback: try directional variants
                for suffix in ("_up", "_down"):
                    alt = self.execution_engine._strategies.get(parent + suffix)
                    if alt and hasattr(alt.strategy, "_active_positions"):
                        parent_state = alt
                        break
            if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                instrument = pos.get("instrument", {})
                close_sym = instrument.get("symbol", "")
                close_strike = instrument.get("strike", 0)
                close_expiry = instrument.get("expiry", "")
                close_right = instrument.get("right", "")

                def _keep(p: dict) -> bool:
                    oc = p.get("signal", {}).get("option_contract", {})
                    if not oc:
                        return True
                    return not (
                        oc.get("symbol") == close_sym
                        and oc.get("strike") == close_strike
                        and oc.get("expiry") == close_expiry
                        and oc.get("right") == close_right
                    )

                parent_state.strategy._active_positions = [
                    p for p in parent_state.strategy._active_positions if _keep(p)
                ]

        # Add a manual_close fill entry and mark closed
        self.position_store.add_fill(position_id, {
            "time": time.time(),
            "order_id": 0,
            "level": "manual_close",
            "qty_filled": 0,
            "avg_price": 0,
            "remaining_qty": 0,
            "pnl_pct": 0.0,
        })
        self.position_store.mark_closed(position_id, exit_reason="manual_close")
        return {"success": True, "position_id": position_id, "status": "closed"}

    async def _handle_execution_list_models(self, payload: dict) -> dict:
        """List available models from the registry for a running strategy.

        Payload:
            strategy_id: str (e.g. "bmc_spy")
            ticker: str (optional filter, default="" = all)
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}

        strategy_id = payload.get("strategy_id", "")
        ticker = payload.get("ticker", "")
        if not strategy_id:
            return {"error": "strategy_id is required"}

        state = self.execution_engine._strategies.get(strategy_id)
        if state is None:
            return {"error": f"Strategy {strategy_id} not found"}

        if not hasattr(state.strategy, "list_available_models"):
            return {"error": f"Strategy {strategy_id} does not support model listing"}

        models = await self._run_in_thread(state.strategy.list_available_models, ticker)
        return {"models": models, "strategy_id": strategy_id}

    async def _handle_execution_swap_model(self, payload: dict) -> dict:
        """Hot-swap the model on a running strategy.

        Payload:
            strategy_id: str (e.g. "bmc_spy")
            version_id: str (registry version to load)
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}

        strategy_id = payload.get("strategy_id", "")
        version_id = payload.get("version_id", "")
        if not strategy_id:
            return {"error": "strategy_id is required"}
        if not version_id:
            return {"error": "version_id is required"}

        state = self.execution_engine._strategies.get(strategy_id)
        if state is None:
            return {"error": f"Strategy {strategy_id} not found"}

        if not hasattr(state.strategy, "swap_model"):
            return {"error": f"Strategy {strategy_id} does not support model swapping"}

        result = await self._run_in_thread(state.strategy.swap_model, version_id)

        # Apply ticker profile defaults to engine config so scan window,
        # threshold, budget, etc. match the ticker's tuned settings.
        config_defaults = result.get("config_defaults")
        if result.get("success") and config_defaults:
            self.execution_engine.update_strategy_config(strategy_id, config_defaults)
            logger.info(
                "Applied ticker profile defaults after model swap on %s: %s",
                strategy_id, list(config_defaults.keys()),
            )
            # If this is a directional pair, apply to the sibling too
            resolved = self._resolve_strategy_ids(
                strategy_id.replace("_up", "").replace("_down", "")
            )
            for sid in resolved:
                if sid != strategy_id and sid in self.execution_engine._strategies:
                    self.execution_engine.update_strategy_config(sid, config_defaults)
                    logger.info("Applied ticker profile defaults to sibling %s", sid)

        self._persist_engine_config("model_swap")

        # Push telemetry immediately so dashboard sees new config
        try:
            if self.execution_engine.is_running and self.websocket:
                telemetry = self.execution_engine.get_telemetry()
                await self._send_ws_json({
                    "type": "execution_telemetry",
                    **telemetry
                })
        except Exception:
            logger.debug("Failed to push telemetry after model swap", exc_info=True)

        return result

    async def _handle_execution_resume(self, payload: dict) -> dict:
        """Resume execution engine from auto-restart PAUSED state.

        Restores saved entry budgets (global cap + per-ticker) so new entries
        can flow again.  Optionally accepts overrides in the payload.

        Payload (all optional):
            global_entry_cap: int (override saved cap)
            ticker_budgets: dict (strategy_id -> budget overrides)
        """
        if not self.execution_engine:
            return {"error": "Execution engine not initialized"}
        if not self.execution_engine.is_running:
            return {"error": "Execution engine is not running"}
        if not self.execution_engine._auto_restart_paused:
            return {"error": "Engine is not in PAUSED state"}

        # Determine caps to restore
        global_cap = payload.get("global_entry_cap", self._saved_entry_cap_before_pause)
        ticker_overrides = payload.get("ticker_budgets", {})

        # Restore global cap
        self.execution_engine.set_global_entry_cap(int(global_cap))

        # Restore per-ticker budgets
        for sid, state in self.execution_engine._strategies.items():
            if sid.startswith("bmc_risk_"):
                continue
            if sid in ticker_overrides:
                state.ticker_entry_budget = int(ticker_overrides[sid])
            elif sid in self._saved_ticker_budgets:
                state.ticker_entry_budget = self._saved_ticker_budgets[sid]

        # Clear paused flag
        self.execution_engine._auto_restart_paused = False
        self._persist_engine_config("resume")

        logger.info(
            "Execution engine RESUMED — global_cap=%d, %d ticker budgets restored",
            global_cap, len(self._saved_ticker_budgets),
        )
        return {
            "success": True,
            "engine_mode": "running",
            "budget_status": self.execution_engine.get_budget_status(),
        }

    async def _handle_agent_restart(self, payload: dict) -> dict:
        """Restart the agent process.

        Sends a success response, then schedules sys.exit(0) after a short
        delay so the WebSocket response has time to flush.  systemd
        (Restart=always, RestartSec=10) brings the agent back up.
        """
        logger.info("Agent restart requested via dashboard — exiting in 1s")
        # Schedule exit after 1s so the WS response can flush
        loop = asyncio.get_event_loop()
        loop.call_later(1.0, lambda: os._exit(0))
        return {"success": True, "message": "Agent restarting in 1 second..."}

    # IB account dedicated to automated BMC trading
    IB_ACCT_CODE = "U152133"
    # IB account for M&A merger arbitrage positions
    MA_ACCT_CODE = "U22596909"

    def _handle_get_ib_executions_sync(self, payload: dict) -> dict:
        """Fetch all IB executions for current session, match into round-trip trades, compute P&L."""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}

        IB_IGNORE = {"VGZ", "UNCO", "HOLO"}

        raw_execs = self.scanner.fetch_executions_sync(
            timeout_sec=10.0, acct_code=self.IB_ACCT_CODE,
        )
        if not raw_execs:
            return {"executions": [], "trades": [], "summary": {}}

        # Filter out ignored tickers and non-option trades
        execs = [
            e for e in raw_execs
            if e["contract"].get("symbol") not in IB_IGNORE
        ]

        # Group by contract key: (symbol, strike, expiry, right, secType)
        from collections import defaultdict
        groups = defaultdict(list)
        for e in execs:
            c = e["contract"]
            key = (
                c.get("symbol", ""),
                c.get("strike", 0),
                c.get("lastTradeDateOrContractMonth", ""),
                c.get("right", ""),
                c.get("secType", ""),
            )
            groups[key].append(e)

        # Build round-trip trades from matched buys/sells
        trades = []
        for key, fills in groups.items():
            symbol, strike, expiry, right, sec_type = key

            buys = []
            sells = []
            total_commission = 0.0
            for f in fills:
                ex = f["execution"]
                comm = f.get("commission")
                if comm and comm.get("commission"):
                    c_val = comm["commission"]
                    # IB returns 1e10 for "not yet available"
                    if c_val < 1e9:
                        total_commission += c_val

                entry = {
                    "time": ex.get("time", ""),
                    "price": ex.get("price", 0),
                    "shares": ex.get("shares", 0),
                    "exec_id": ex.get("execId", ""),
                    "exchange": ex.get("exchange", ""),
                    "order_id": ex.get("orderId", 0),
                }
                if ex.get("side") == "BOT":
                    buys.append(entry)
                elif ex.get("side") == "SLD":
                    sells.append(entry)

            # Compute aggregate entry/exit
            buy_qty = sum(b["shares"] for b in buys)
            sell_qty = sum(s["shares"] for s in sells)
            buy_cost = sum(b["price"] * b["shares"] for b in buys)
            sell_revenue = sum(s["price"] * s["shares"] for s in sells)
            avg_buy = buy_cost / buy_qty if buy_qty else 0
            avg_sell = sell_revenue / sell_qty if sell_qty else 0

            # For options, multiply by 100 for dollar P&L
            multiplier = 100 if sec_type == "OPT" else 1
            closed_qty = min(buy_qty, sell_qty)
            gross_pnl = (avg_sell - avg_buy) * closed_qty * multiplier if closed_qty else None
            net_pnl = (gross_pnl - total_commission) if gross_pnl is not None else None
            open_qty = buy_qty - sell_qty

            # Format contract label
            if sec_type == "OPT":
                contract_label = f"{symbol} {strike:.0f}{right[0] if right else '?'}"
                if expiry:
                    contract_label += f" {expiry}"
            else:
                contract_label = symbol

            trades.append({
                "contract_label": contract_label,
                "symbol": symbol,
                "sec_type": sec_type,
                "strike": strike,
                "expiry": expiry,
                "right": right,
                "buy_qty": int(buy_qty),
                "sell_qty": int(sell_qty),
                "open_qty": int(open_qty),
                "avg_buy": round(avg_buy, 4),
                "avg_sell": round(avg_sell, 4) if sell_qty else None,
                "gross_pnl": round(gross_pnl, 2) if gross_pnl is not None else None,
                "total_commission": round(total_commission, 4),
                "net_pnl": round(net_pnl, 2) if net_pnl is not None else None,
                "status": "closed" if open_qty == 0 and sell_qty > 0 else "open",
                "fills": [
                    {
                        "side": f["execution"]["side"],
                        "time": f["execution"]["time"],
                        "price": f["execution"]["price"],
                        "shares": f["execution"]["shares"],
                        "exchange": f["execution"]["exchange"],
                        "commission": f["commission"]["commission"] if f.get("commission") and f["commission"].get("commission", 0) < 1e9 else None,
                    }
                    for f in fills
                ],
            })

        # Summary across all option trades
        total_gross = sum(t["gross_pnl"] for t in trades if t["gross_pnl"] is not None)
        total_comm = sum(t["total_commission"] for t in trades)
        total_net = total_gross - total_comm
        closed_trades = [t for t in trades if t["status"] == "closed"]
        open_trades = [t for t in trades if t["status"] == "open"]
        wins = sum(1 for t in closed_trades if (t["net_pnl"] or 0) > 0)
        losses = sum(1 for t in closed_trades if (t["net_pnl"] or 0) <= 0)

        return {
            "executions_count": len(execs),
            "trades": trades,
            "summary": {
                "total_gross_pnl": round(total_gross, 2),
                "total_commission": round(total_comm, 4),
                "total_net_pnl": round(total_net, 2),
                "closed_count": len(closed_trades),
                "open_count": len(open_trades),
                "wins": wins,
                "losses": losses,
            },
        }

    def _create_strategy(self, strategy_type: str) -> Optional[ExecutionStrategy]:
        """Factory for creating strategy instances by type name."""
        if strategy_type == "risk_manager":
            from strategies.risk_manager import RiskManagerStrategy
            return RiskManagerStrategy()
        if strategy_type == "big_move_convexity":
            from strategies.big_move_convexity import BigMoveConvexityStrategy
            strategy = BigMoveConvexityStrategy()
            strategy._spawn_risk_manager = self._spawn_risk_manager_for_bmc
            strategy._fetch_option_quote = lambda cd: self.scanner.fetch_option_snapshot(cd)
            return strategy
        logger.warning("No strategy implementation for type: %s", strategy_type)
        return None

    def _expand_directional_strategies(self, strat_cfg: dict) -> Optional[List[dict]]:
        """If ticker has both UP and DOWN *active* models, return two configs.

        Returns None if expansion is not applicable:
        - Single active model (symmetric or directional-only)
        - No active models for ticker
        - Active model is symmetric (no UP/DOWN in target_column)
        - model_version already pinned in config
        """
        config = strat_cfg.get("config", {})
        ticker = config.get("ticker", "")
        if not ticker or config.get("model_version"):
            return None  # Already pinned or no ticker -- skip expansion

        try:
            # Resolve BMC_PATH the same way big_move_convexity.py does
            import sys as _sys
            bmc_path = os.environ.get("BMC_PATH", "")
            if not bmc_path:
                # standalone_agent/ib_data_agent.py -> parent x4 -> dev/ (sibling of py_proj)
                bmc_path = str(
                    Path(__file__).resolve().parent.parent.parent.parent / "py_proj"
                )
            if bmc_path not in _sys.path:
                _sys.path.insert(0, bmc_path)

            from big_move_convexity.ml.model_registry import ModelRegistry

            registry_path = os.path.join(
                bmc_path, "big_move_convexity", "models", "registry"
            )
            if not os.path.isdir(registry_path):
                return None  # Registry not available on this machine

            registry = ModelRegistry(registry_path)

            # CRITICAL: filter by BOTH "production" tag AND status == "active".
            # Retired models keep their "production" tag but must not be selected.
            # Previous code only checked tags, causing retired hybrid_film models
            # to be selected over active lightgbm models.
            active_production = [
                v for v in registry._versions
                if "production" in v.tags
                and v.status == "active"
                and v.ticker == ticker
            ]

            up_models = sorted(
                [v for v in active_production if "UP" in (v.target_column or "")],
                key=lambda v: v.promoted_at or v.created_at, reverse=True,
            )
            down_models = sorted(
                [v for v in active_production if "DOWN" in (v.target_column or "")],
                key=lambda v: v.promoted_at or v.created_at, reverse=True,
            )

            if not (up_models and down_models):
                # No directional pair available.  Could be:
                # - Symmetric model (p_otm_itm_30bp) with no UP/DOWN direction
                # - Only one direction has an active model
                # In either case, let the strategy load the single active model
                # via get_production() / get_active() in _init_bmc_pipeline.
                return None

            base_id = strat_cfg.get("strategy_id", f"bmc_{ticker.lower()}")

            up_config = {
                **strat_cfg,
                "strategy_id": f"{base_id}_up",
                "config": {**config, "model_version": up_models[0].version_id},
            }
            down_config = {
                **strat_cfg,
                "strategy_id": f"{base_id}_down",
                "config": {**config, "model_version": down_models[0].version_id},
            }

            logger.info(
                "Expanding %s into directional pair: %s (model=%s) + %s (model=%s)",
                base_id,
                f"{base_id}_up", up_models[0].version_id,
                f"{base_id}_down", down_models[0].version_id,
            )
            return [up_config, down_config]

        except Exception as e:
            logger.warning("Directional expansion failed for %s: %s", ticker, e)
            return None

    def _resolve_strategy_ids(self, strategy_id: str) -> List[str]:
        """Resolve strategy_id to ALL loaded IDs for a ticker.

        E.g., 'bmc_spy' resolves to ['bmc_spy_up', 'bmc_spy_down', 'bmc_spy_sym']
        if all three variants are loaded, or ['bmc_spy'] if loaded as single strategy.

        Uses prefix matching so ANY variant (up, down, sym, or future suffixes)
        is automatically included.  This is critical for config propagation —
        if a variant is missed, config changes like direction_mode won't reach
        it.  That caused the 2026-03-09 bug where bmc_spy_sym ran with
        direction_mode=both while the user had set long_only for SPY.
        """
        if strategy_id in self.execution_engine._strategies:
            return [strategy_id]
        # Prefix match: find ALL strategies whose ID starts with base_id + "_"
        # This catches _up, _down, _sym, and any future variants automatically.
        prefix = strategy_id + "_"
        found = [sid for sid in self.execution_engine._strategies if sid.startswith(prefix)]
        return found if found else [strategy_id]  # return original if no variants found

    def _spawn_risk_manager_for_bmc(self, risk_config: dict, record_fill: bool = True) -> bool:
        """Spawn or aggregate a RiskManagerStrategy for a BMC entry fill.

        Called by BigMoveConvexityStrategy.on_fill() to create a position
        guardian with the zero_dte_convexity preset.

        If an active risk manager already exists for the same contract
        (symbol + strike + expiry + right), the new lot is aggregated into
        it via add_lot() rather than spawning a new independent manager.
        This ensures a single trailing stop for the aggregate position.

        record_fill: if False, skip add_fill() for the entry. Used by
            _spawn_missing_risk_managers (IB reconciliation) so that
            recovery spawns don't create phantom Trade Log entries.

        Returns True if RM was spawned/aggregated successfully, False on failure.
        """
        if not self.execution_engine:
            logger.warning("Cannot spawn risk manager: execution engine not initialized")
            return False

        recovery_entry = risk_config.pop("_recovery_entry", None)
        recovery_runtime_state = risk_config.pop("_recovery_runtime_state", None)
        recovery_fill_log = risk_config.pop("_recovery_fill_log", None)

        # Extract lineage before passing to risk manager (WS2)
        lineage = risk_config.pop("lineage", None)

        # Extract parent strategy ID (set by BMC on_fill); fallback to legacy format
        instrument = risk_config.get("instrument", {})
        symbol = instrument.get("symbol", "").lower()
        parent_sid = risk_config.pop("_parent_strategy_id", f"bmc_{symbol}" if symbol else "bmc")
        pos_info = risk_config.get("position", {})

        # ── Check for existing same-contract risk manager to aggregate into ──
        existing_sid = self._find_risk_manager_for_contract(instrument)
        if existing_sid:
            self._aggregate_lot_into_manager(existing_sid, pos_info, instrument, lineage)
            return True

        # ── No existing manager — create a new one ──
        from strategies.risk_manager import RiskManagerStrategy

        strategy = RiskManagerStrategy()
        strategy._parent_strategy_id = parent_sid
        strategy_id = f"bmc_risk_{int(time.time() * 1000)}"

        result = self.execution_engine.load_strategy(strategy_id, strategy, risk_config)
        if "error" in result:
            logger.error("CRITICAL: Failed to spawn risk manager for BMC — position UNMANAGED: %s", result["error"])
            return False
        else:
            logger.info("Spawned RiskManagerStrategy %s for BMC position", strategy_id)
            # Set ticker on the StrategyState so Gate 0 (ticker mode) applies to
            # risk manager orders — e.g. NO_ORDERS blocks exits too.
            rm_state = self.execution_engine._strategies.get(strategy_id)
            if rm_state:
                rm_state.ticker = resolve_rm_ticker(instrument, parent_sid)
            # Persist the new position in the store
            self.position_store.add_position(
                position_id=strategy_id,
                entry=recovery_entry or {
                    "order_id": pos_info.get("order_id", 0),
                    "price": pos_info.get("entry_price", 0),
                    "quantity": pos_info.get("quantity", 0),
                    "fill_time": time.time(),
                    "perm_id": pos_info.get("perm_id", 0),
                },
                instrument=instrument,
                risk_config=risk_config,
                parent_strategy=parent_sid,
            )
            # Attach lineage to position record (WS2)
            if lineage:
                self.position_store.set_lineage(strategy_id, lineage)
            if recovery_fill_log:
                strategy._fill_log = copy.deepcopy(recovery_fill_log)
                for fill in recovery_fill_log:
                    self.position_store.add_fill(strategy_id, fill)
            if recovery_runtime_state:
                strategy.restore_runtime_state(copy.deepcopy(recovery_runtime_state))
            # Record the entry fill in the ledger.
            # Skipped for reconciliation spawns (record_fill=False) to avoid
            # creating phantom Trade Log rows for non-real entries.
            if record_fill:
                entry_order_id = pos_info.get("order_id", 0)
                entry_fill = self._build_entry_fill_record(pos_info)
                self.position_store.add_fill(strategy_id, entry_fill)
                self._attach_entry_execution_tracking(strategy_id, entry_fill)
            # Persist initial runtime state (ARMED) so it survives restarts
            if hasattr(strategy, "get_runtime_snapshot"):
                self.position_store.update_runtime_state(
                    strategy_id, strategy.get_runtime_snapshot()
                )
            return True

    def _find_risk_manager_for_contract(self, instrument: dict) -> Optional[str]:
        """Find an active risk manager guarding the same contract.

        Returns the strategy_id if found, None otherwise.
        """
        if not self.execution_engine:
            return None

        # Build contract key from instrument (matches risk_manager.py cache_key format)
        sec_type = instrument.get("secType", "STK")
        symbol = instrument.get("symbol", "")
        if sec_type == "OPT":
            target_key = (
                f"{symbol}:{instrument.get('strike', 0)}:"
                f"{instrument.get('expiry', '')}:{instrument.get('right', '')}"
            )
        elif sec_type == "FUT":
            target_key = f"{symbol}:{instrument.get('expiry', '')}:FUT"
        else:
            target_key = symbol

        for sid, state in self.execution_engine._strategies.items():
            if not sid.startswith("bmc_risk_"):
                continue
            rm = state.strategy
            if (
                hasattr(rm, "cache_key")
                and rm.cache_key == target_key
                and not getattr(rm, "_completed", True)
                and getattr(rm, "remaining_qty", 0) > 0
            ):
                return sid
        return None

    @staticmethod
    def _normalize_recovery_contract_key(instrument_or_key) -> tuple:
        """Normalize contract identity for store/template lookups."""
        if isinstance(instrument_or_key, tuple):
            symbol, strike, expiry, right = (list(instrument_or_key) + ["", 0.0, "", ""])[:4]
        else:
            instrument = instrument_or_key or {}
            symbol = instrument.get("symbol")
            strike = instrument.get("strike")
            expiry = instrument.get("expiry") or instrument.get("lastTradeDateOrContractMonth")
            right = instrument.get("right")
        try:
            strike_value = round(float(strike or 0.0), 6)
        except (TypeError, ValueError):
            strike_value = 0.0
        return (
            str(symbol or "").upper(),
            strike_value,
            str(expiry or ""),
            str(right or "").upper(),
        )

    def _select_orphan_recovery_template(self, instrument: dict) -> Optional[dict]:
        """Pick the strongest persisted same-contract template for orphan recovery."""
        if not self.position_store:
            return None

        target_key = self._normalize_recovery_contract_key(instrument)
        best_match = None
        best_score = None

        for position in self.position_store.get_all_positions():
            if self._normalize_recovery_contract_key(position.get("instrument", {})) != target_key:
                continue
            runtime_state = position.get("runtime_state") or {}
            fill_log = position.get("fill_log") or []
            lot_entries = runtime_state.get("lot_entries") or []
            score = (
                1 if position.get("status") == "active" else 0,
                1 if runtime_state else 0,
                len(lot_entries),
                len(fill_log),
                1 if position.get("lineage") else 0,
                float(position.get("closed_at") or position.get("created_at") or 0.0),
            )
            if best_match is None or score > best_score:
                best_match = position
                best_score = score

        return copy.deepcopy(best_match) if best_match else None

    @staticmethod
    def _estimate_template_remaining_qty(template: dict) -> int:
        runtime_state = template.get("runtime_state") or {}
        lot_entries = copy.deepcopy(runtime_state.get("lot_entries") or [])
        fill_log = copy.deepcopy(template.get("fill_log") or [])
        if lot_entries:
            try:
                from strategies.risk_manager import RiskManagerStrategy

                probe = RiskManagerStrategy()
                probe._lot_entries = lot_entries
                probe._fill_log = fill_log
                return sum(probe._reconstruct_lot_remaining_qty().values())
            except Exception:
                logger.debug("Failed to estimate template remaining qty", exc_info=True)
        try:
            return int(
                runtime_state.get("remaining_qty")
                or template.get("entry", {}).get("quantity")
                or template.get("risk_config", {}).get("position", {}).get("quantity")
                or 0
            )
        except (TypeError, ValueError):
            return 0

    def _build_orphan_spawn_payload(
        self,
        *,
        instrument: dict,
        qty: int,
        entry_price: float,
        parent_sid: Optional[str],
        parent_config: dict,
    ) -> dict:
        """Build broker-authoritative recovery payload for an orphaned IB contract."""
        ticker = (instrument.get("symbol") or "").upper()
        fallback_parent_sid = parent_sid or f"bmc_{ticker.lower()}"
        template = self._select_orphan_recovery_template(instrument)

        if template:
            risk_config = copy.deepcopy(template.get("risk_config") or {})
            risk_config.setdefault("position", {})
            risk_config["instrument"] = copy.deepcopy(instrument)
            risk_config["position"].setdefault("side", "LONG")
            if entry_price > 0:
                risk_config["position"]["entry_price"] = entry_price

            recovery_entry = copy.deepcopy(template.get("entry") or {})
            recovery_runtime_state = copy.deepcopy(template.get("runtime_state") or {})
            recovery_fill_log = copy.deepcopy(template.get("fill_log") or [])
            parent_sid = template.get("parent_strategy") or fallback_parent_sid

            if recovery_runtime_state:
                lot_entries = recovery_runtime_state.setdefault("lot_entries", [])
                if not lot_entries and recovery_entry:
                    lot_entries.append({
                        "order_id": recovery_entry.get("order_id", 0),
                        "entry_price": recovery_entry.get("price", entry_price),
                        "quantity": recovery_entry.get("quantity", qty),
                        "fill_time": recovery_entry.get("fill_time", time.time()),
                        "perm_id": recovery_entry.get("perm_id", 0),
                    })

                historical_remaining = self._estimate_template_remaining_qty(template)
                synthetic_fill_time = time.time()
                if qty < historical_remaining:
                    recovery_fill_log.append({
                        "time": synthetic_fill_time,
                        "order_id": 0,
                        "level": "broker_reconcile_exit",
                        "qty_filled": historical_remaining - qty,
                        "avg_price": entry_price if entry_price > 0 else float(recovery_entry.get("price", 0.0) or 0.0),
                        "remaining_qty": qty,
                        "pnl_pct": 0.0,
                        "execution_analytics": {
                            "synthetic": True,
                            "source": "ib_orphan_reconcile",
                            "event": "broker_qty_clamp",
                        },
                    })
                elif qty > historical_remaining:
                    lot_entries.append({
                        "order_id": 0,
                        "entry_price": entry_price if entry_price > 0 else float(recovery_entry.get("price", 0.0) or 0.0),
                        "quantity": qty - historical_remaining,
                        "fill_time": synthetic_fill_time,
                        "perm_id": 0,
                    })

                prior_initial_qty = int(
                    recovery_runtime_state.get("initial_qty")
                    or recovery_entry.get("quantity")
                    or risk_config["position"].get("quantity")
                    or historical_remaining
                    or 0
                )
                recovery_runtime_state["remaining_qty"] = int(qty)
                recovery_runtime_state["initial_qty"] = max(prior_initial_qty, int(qty))
                if entry_price > 0:
                    recovery_runtime_state["entry_price"] = entry_price
                if recovery_runtime_state.get("trailing_mode") == "per_lot":
                    recovery_runtime_state.pop("per_lot_trailing", None)
                risk_config["position"]["quantity"] = int(recovery_runtime_state["initial_qty"])
            else:
                risk_config["position"]["quantity"] = int(
                    risk_config["position"].get("quantity") or qty
                )

            recovery_entry.setdefault("order_id", 0)
            recovery_entry.setdefault("perm_id", 0)
            recovery_entry["price"] = entry_price if entry_price > 0 else float(recovery_entry.get("price", 0.0) or 0.0)
            recovery_entry["quantity"] = int(
                recovery_runtime_state.get("initial_qty")
                if recovery_runtime_state
                else (recovery_entry.get("quantity") or qty)
            )
            recovery_entry["fill_time"] = recovery_entry.get("fill_time", time.time()) or time.time()

            risk_config["_parent_strategy_id"] = parent_sid
            if template.get("lineage"):
                risk_config["lineage"] = copy.deepcopy(template.get("lineage"))
            risk_config["_recovery_entry"] = recovery_entry
            if recovery_runtime_state:
                risk_config["_recovery_runtime_state"] = recovery_runtime_state
            if recovery_fill_log:
                risk_config["_recovery_fill_log"] = recovery_fill_log
            return {
                "risk_config": risk_config,
                "parent_sid": parent_sid,
                "source": "persisted_same_contract_template",
            }

        risk_preset = parent_config.get("risk_preset", "zero_dte_convexity")
        if risk_preset == "custom":
            risk_section: dict = {
                "stop_loss": {
                    "enabled": parent_config.get("risk_stop_loss_enabled", False),
                    "type": parent_config.get("risk_stop_loss_type", "none"),
                    "trigger_pct": parent_config.get("risk_stop_loss_trigger_pct", -80.0),
                },
                "profit_taking": {
                    "enabled": parent_config.get("risk_profit_targets_enabled", True),
                    "targets": parent_config.get("risk_profit_targets", []),
                    "trailing_stop": {
                        "enabled": parent_config.get("risk_trailing_enabled", True),
                        "activation_pct": parent_config.get("risk_trailing_activation_pct", 25),
                        "trail_pct": parent_config.get("risk_trailing_trail_pct", 15),
                    },
                },
                "execution": {"stop_order_type": "MKT", "profit_order_type": "MKT"},
            }
        else:
            risk_section = {"preset": risk_preset}

        return {
            "risk_config": {
                **risk_section,
                "instrument": copy.deepcopy(instrument),
                "position": {
                    "side": "LONG",
                    "quantity": int(qty),
                    "entry_price": entry_price,
                },
                "_parent_strategy_id": fallback_parent_sid,
            },
            "parent_sid": parent_sid,
            "source": "parent_strategy" if parent_sid else "preset_fallback",
        }

    def _spawn_missing_risk_managers(self, orphaned_ib: list) -> int:
        """Auto-spawn risk managers for IB option positions not tracked by the agent.

        Closes the gap where a position exists in IB but has no corresponding
        risk manager — e.g. when the position_store entry was lost before server
        sync (agent crash/restart within 10s of fill) or when the risk manager
        spawn failed silently.

        Only acts on OPT positions (identified by non-empty strike + right).
        Uses IB avgCost as entry_price. Inherits risk preset from the parent
        BMC strategy's active config; falls back to zero_dte_convexity.

        Returns the count of successfully spawned risk managers.
        """
        if not orphaned_ib or not self.execution_engine:
            return 0

        spawned = 0
        for orphan in orphaned_ib:
            instrument_key = orphan.get("instrument")  # tuple: (symbol, strike, expiry, right)
            qty = orphan.get("qty", 0)
            avg_cost = orphan.get("avg_cost") or 0.0

            if not instrument_key or qty <= 0:
                continue

            symbol, strike, expiry, right = instrument_key

            # Only handle option positions (identified by non-empty strike & right)
            if not strike or not right:
                logger.debug("IB reconciliation: skipping non-option orphan %s", instrument_key)
                continue

            # Skip if a risk manager already exists for this contract in memory
            inst_dict = {"symbol": symbol, "secType": "OPT",
                         "strike": strike, "expiry": expiry, "right": right}
            if self._find_risk_manager_for_contract(inst_dict):
                logger.info(
                    "IB reconciliation: risk manager already in engine for %s %s %s %s — skipping",
                    symbol, strike, expiry, right,
                )
                continue

            # IB reports avgCost for options as total per-contract cost (premium × 100 multiplier).
            # Divide by 100 to get the per-share premium that the rest of the system expects.
            entry_price = float(avg_cost) / 100.0

            logger.warning(
                "IB reconciliation: orphaned option position %s %s %s %s "
                "qty=%d avgCost=%.4f (entry_price=%.4f) — auto-spawning risk manager",
                symbol, strike, expiry, right, qty, avg_cost, entry_price,
            )

            # ── Find parent BMC strategy for this ticker ──
            ticker = (symbol or "").upper()
            parent_sid: Optional[str] = None
            parent_config: dict = {}
            for sid_candidate in [
                f"bmc_{ticker.lower()}_up",
                f"bmc_{ticker.lower()}_down",
                f"bmc_{ticker.lower()}",
            ]:
                state = self.execution_engine._strategies.get(sid_candidate)
                if state:
                    parent_sid = sid_candidate
                    parent_config = state.config or {}
                    break

            recovery_payload = self._build_orphan_spawn_payload(
                instrument=inst_dict,
                qty=int(qty),
                entry_price=entry_price,
                parent_sid=parent_sid,
                parent_config=parent_config,
            )
            risk_config = recovery_payload["risk_config"]
            parent_sid = recovery_payload.get("parent_sid") or parent_sid
            recovery_source = recovery_payload.get("source", "unknown")

            try:
                spawn_ok = self._spawn_risk_manager_for_bmc(risk_config, record_fill=False)
                if spawn_ok is False:
                    logger.error(
                        "CRITICAL: IB reconciliation spawn FAILED for %s %s %s %s "
                        "qty=%d — position UNMANAGED",
                        symbol, strike, expiry, right, qty,
                    )
                    continue
                spawned += 1
                logger.info(
                    "IB reconciliation: spawned risk manager for %s %s %s %s "
                    "(entry=%.4f, qty=%d, parent=%s, source=%s)",
                    symbol, strike, expiry, right, entry_price, qty, parent_sid, recovery_source,
                )

                # Populate parent BMC strategy's _active_positions so it knows
                # about the recovered position (cooldown, spawn counter, dashboard display)
                if parent_sid:
                    parent_state = self.execution_engine._strategies.get(parent_sid)
                    if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                        option_contract = {
                            "symbol": symbol,
                            "strike": float(strike) if strike else 0.0,
                            "expiry": expiry or "",
                            "right": right or "C",
                        }
                        parent_state.strategy._active_positions.append({
                            "order_id": 0,
                            "entry_price": entry_price,
                            "quantity": int(qty),
                            "fill_time": time.time(),
                            "perm_id": 0,
                            "signal": {"option_contract": option_contract},
                        })
                        if hasattr(parent_state.strategy, "_positions_spawned"):
                            parent_state.strategy._positions_spawned += 1
                        logger.info(
                            "IB reconciliation: populated %s._active_positions for %s",
                            parent_sid, ticker,
                        )
            except Exception as e:
                logger.error(
                    "IB reconciliation: failed to spawn risk manager for %s %s %s %s: %s",
                    symbol, strike, expiry, right, e,
                )

        return spawned

    def _aggregate_lot_into_manager(
        self,
        strategy_id: str,
        pos_info: dict,
        instrument: dict,
        lineage: Optional[dict],
    ) -> None:
        """Add a new lot to an existing aggregate risk manager.

        Updates the risk manager state, strategy config, position store
        entry, and records the new fill in the ledger.
        """
        state = self.execution_engine._strategies.get(strategy_id)
        if not state:
            logger.error("Cannot aggregate: strategy %s not found", strategy_id)
            return

        rm = state.strategy
        entry_price = float(pos_info.get("entry_price", 0))
        quantity = int(pos_info.get("quantity", 0))
        order_id = pos_info.get("order_id", 0)
        fill_time = pos_info.get("fill_time", time.time())
        perm_id = pos_info.get("perm_id", 0)

        # Aggregate into the risk manager
        rm.add_lot(entry_price, quantity, order_id, fill_time, perm_id)

        # Update the config to reflect new aggregate (for telemetry/recovery)
        state.config.setdefault("position", {})["quantity"] = rm.initial_qty
        state.config["position"]["entry_price"] = rm.entry_price

        # Update position store entry to reflect aggregate values
        self.position_store.update_entry(strategy_id, {
            "price": rm.entry_price,
            "quantity": rm.initial_qty,
        })

        # Record the new entry fill in the ledger
        entry_fill = self._build_entry_fill_record(
            {
                "order_id": order_id,
                "perm_id": perm_id,
                "fill_time": fill_time,
                "quantity": quantity,
                "entry_price": entry_price,
            },
            remaining_qty=rm.remaining_qty,
        )
        self.position_store.add_fill(strategy_id, entry_fill)
        self._attach_entry_execution_tracking(strategy_id, entry_fill)

        # Persist updated runtime state (lot_entries, qty, entry_price)
        self.position_store.update_runtime_state(
            strategy_id, rm.get_runtime_snapshot()
        )

        # Attach lineage if provided (updates to latest signal's lineage)
        if lineage:
            self.position_store.set_lineage(strategy_id, lineage)

        logger.info(
            "Aggregated lot into %s: now %d lots (%d qty) @ avg %.4f",
            strategy_id, len(rm._lot_entries), rm.initial_qty, rm.entry_price,
        )

    def _build_entry_fill_record(
        self,
        pos_info: dict,
        remaining_qty: Optional[int] = None,
    ) -> dict:
        """Build a risk-manager entry fill record with available analytics."""
        entry_order_id = int(pos_info.get("order_id", 0) or 0)
        fill_time = pos_info.get("fill_time", time.time()) or time.time()
        qty = int(pos_info.get("quantity", 0) or 0)
        fill_price = float(pos_info.get("entry_price", 0) or 0.0)

        exec_id = ""
        analytics = {
            "commission": None,
            "realized_pnl_ib": None,
            "slippage": None,
        }
        if self.execution_engine and entry_order_id:
            exec_data = dict(self.execution_engine._order_exec_details.get(entry_order_id) or {})
            exec_id = exec_data.get("execId") or self.execution_engine._order_exec_ids.get(entry_order_id, "")
            pre_trade_snapshot = self.execution_engine._order_pre_trade_snapshots.get(entry_order_id)
            routing_exchange = (
                self.execution_engine._order_routing_exchanges.get(entry_order_id)
                or self.execution_engine._contract_exchange(
                    self.execution_engine._order_contract_dicts.get(entry_order_id)
                )
            )
            fill_exchange = str(exec_data.get("exchange") or "").strip().upper()
            if fill_exchange:
                analytics["fill_exchange"] = fill_exchange
                analytics["exchange"] = fill_exchange
            if "lastLiquidity" in exec_data and exec_data.get("lastLiquidity") is not None:
                analytics["last_liquidity"] = exec_data.get("lastLiquidity")
            if exec_data.get("permId"):
                analytics["perm_id"] = exec_data.get("permId")
            if exec_data.get("side"):
                analytics["side"] = exec_data.get("side")
            if exec_data.get("account"):
                analytics["account"] = exec_data.get("account")
            if pre_trade_snapshot and fill_price > 0:
                opt_ask = pre_trade_snapshot.get("option_ask")
                opt_mid = pre_trade_snapshot.get("option_mid")
                if opt_ask and opt_ask > 0:
                    analytics["slippage"] = round(fill_price - opt_ask, 6)
                if opt_mid and opt_mid > 0:
                    analytics["effective_spread"] = round(2 * abs(fill_price - opt_mid), 6)
                analytics["pre_trade_snapshot"] = pre_trade_snapshot
            analytics["routing_exchange"] = routing_exchange

        return {
            "time": fill_time,
            "order_id": entry_order_id,
            "exec_id": exec_id,
            "level": "entry",
            "qty_filled": qty,
            "avg_price": fill_price,
            "remaining_qty": qty if remaining_qty is None else remaining_qty,
            "pnl_pct": 0.0,
            "execution_analytics": analytics,
        }

    def _attach_entry_execution_tracking(self, strategy_id: str, entry_fill: dict) -> None:
        """Wire post-fill analytics and commission routing for a BMC entry fill."""
        if not self.execution_engine:
            return

        order_id = int(entry_fill.get("order_id", 0) or 0)
        exec_id = entry_fill.get("exec_id", "") or ""

        if order_id > 0:
            self.execution_engine._order_position_ids[order_id] = strategy_id

        # Route future commission reports to the RM position.
        if exec_id:
            self.execution_engine._exec_id_to_position[exec_id] = strategy_id
            self.execution_engine._order_executor.submit(
                self.execution_engine._deferred_commission_update,
                strategy_id, exec_id,
            )

        if order_id <= 0:
            return

        contract_d = self.execution_engine._order_contract_dicts.get(order_id)
        pre_trade_snapshot = self.execution_engine._order_pre_trade_snapshots.get(order_id)
        routing_exchange = (
            self.execution_engine._order_routing_exchanges.get(order_id)
            or self.execution_engine._contract_exchange(contract_d)
        )
        if contract_d and pre_trade_snapshot:
            self.execution_engine._schedule_post_fill_capture(
                strategy_id,
                order_id,
                contract_d,
                float(entry_fill.get("avg_price", 0.0) or 0.0),
                float(entry_fill.get("time", time.time()) or time.time()),
                pre_trade_snapshot,
                routing_exchange,
                entry_fill,
            )

    # ── Periodic runtime state persistence ──

    def _persist_runtime_states(self):
        """Snapshot all active risk manager runtime states to the position store.

        Called from the heartbeat loop (~every 20s when engine is active).
        Ensures ARMED/ACTIVATED/HWM state survives agent restarts.
        """
        if not self.execution_engine or not self.position_store:
            return
        for sid, state in self.execution_engine._strategies.items():
            if sid.startswith("bmc_risk_") and hasattr(state.strategy, "get_runtime_snapshot"):
                try:
                    snapshot = state.strategy.get_runtime_snapshot()
                    self.position_store.update_runtime_state(sid, snapshot)
                except Exception as e:
                    logger.error("Error persisting runtime state for %s: %s", sid, e)

    # ── Engine config persistence ──

    def _persist_engine_config(self, reason: str = "") -> None:
        """Snapshot current engine configuration for auto-restart on next boot.

        Only persists BMC entry strategies (not bmc_risk_* risk managers, which
        persist via position_store.json).
        """
        if not self.execution_engine or not self.execution_engine.is_running:
            return
        try:
            strategies = []
            for sid, state in self.execution_engine._strategies.items():
                # Only persist entry strategies, not risk managers
                if sid.startswith("bmc_risk_"):
                    continue
                # Build a copy of config so we can update model_version to current.
                # Strip non-serializable internal keys (shared infra, bootstrap data).
                persisted_config = {k: v for k, v in state.config.items()
                                    if not k.startswith("_shared_")}
                # Sync config.model_version with the CURRENTLY loaded model.
                # Without this, auto-restart reloads a stale model_version from
                # the original directional expansion, then swap_model fixes it --
                # wasting a load cycle and risking failure if the stale model
                # is retired/deleted.
                if hasattr(state.strategy, "_model_version") and state.strategy._model_version:
                    persisted_config["model_version"] = state.strategy._model_version

                strat_entry = {
                    "strategy_id": sid,
                    "strategy_type": state.config.get("_strategy_type", "big_move_convexity"),
                    "config": persisted_config,
                    "ticker_budget": state.ticker_entry_budget,
                    "ticker_entries_placed": state.ticker_entries_placed,
                }
                # Capture model pin for non-production models (hot-swap recovery)
                if hasattr(state.strategy, "_model_version") and state.strategy._model_version:
                    strat_entry["model_pin"] = state.strategy._model_version
                strategies.append(strat_entry)

            engine_state = "paused" if self.execution_engine._auto_restart_paused else "running"
            self.engine_config_store.save(
                engine_state=engine_state,
                strategies=strategies,
                global_entry_cap=self.execution_engine._global_entry_cap,
                risk_budget_usd=self.execution_engine._risk_budget_usd,
                reason=reason,
                ticker_modes=self.execution_engine.get_all_ticker_modes(),
            )
        except Exception as e:
            logger.error("Error persisting engine config: %s", e)

    # ── Auto-restart on boot ──

    async def _maybe_auto_restart(self) -> None:
        """Auto-restart execution engine from saved config in PAUSED mode.

        Called once from run() after relay connects. Reconstructs strategies
        with same config/models but blocks all new entries (global_entry_cap=0).
        Risk managers rebuild from position_store.json and remain fully active.
        """
        # Guard: skip if engine already running or already attempted
        if self._auto_restart_attempted:
            return
        self._auto_restart_attempted = True

        if self.execution_engine and self.execution_engine.is_running:
            logger.info("Auto-restart: engine already running, skipping")
            return

        saved = self.engine_config_store.load()
        if saved is None:
            logger.info("Auto-restart: no saved config found (fresh start)")
            return

        strategies = saved.get("strategies", [])
        if not strategies:
            logger.info("Auto-restart: saved config has no strategies, skipping")
            return

        logger.info(
            "Auto-restart: found saved config (%d strategies, reason=%s, saved_at=%.0f)",
            len(strategies), saved.get("saved_reason", "?"), saved.get("saved_at", 0),
        )

        await self._send_boot_phase(
            "auto_restart_loading",
            f"Found {len(strategies)} strategies",
            progress=0.1,
        )

        # Reconstruct execution_start payload
        payload_strategies = []
        for strat in strategies:
            payload_strategies.append({
                "strategy_id": strat["strategy_id"],
                "strategy_type": strat.get("strategy_type", "big_move_convexity"),
                "config": strat.get("config", {}),
                "ticker_budget": strat.get("ticker_budget", -1),
            })

        payload = {"strategies": payload_strategies}
        try:
            await self._send_boot_phase(
                "strategies_loading", "Starting strategies...", progress=0.3,
            )
            result = await self._handle_execution_start(payload)
            if "error" in result:
                logger.error("Auto-restart: execution_start failed: %s", result["error"])
                return

            # Save original caps before pausing
            self._saved_entry_cap_before_pause = saved.get("global_entry_cap", 0)
            self._saved_ticker_budgets = {}
            for strat in strategies:
                sid = strat["strategy_id"]
                self._saved_ticker_budgets[sid] = strat.get("ticker_budget", -1)

            # Force PAUSED: block all new entries
            self.execution_engine.set_global_entry_cap(0)
            for sid, state in self.execution_engine._strategies.items():
                if not sid.startswith("bmc_risk_"):
                    state.ticker_entry_budget = 0

            # Restore risk budget (doesn't gate entries, safe immediately)
            risk_budget = saved.get("risk_budget_usd", 0.0)
            if risk_budget > 0:
                self.execution_engine.set_risk_budget(risk_budget)

            # Restore model pins (hot-swap non-production models)
            for strat in strategies:
                model_pin = strat.get("model_pin")
                if model_pin:
                    sid = strat["strategy_id"]
                    state = self.execution_engine._strategies.get(sid)
                    if state and hasattr(state.strategy, "swap_model"):
                        try:
                            await self._run_in_thread(state.strategy.swap_model, model_pin)
                            logger.info("Auto-restart: restored model pin %s on %s", model_pin, sid)
                        except Exception as e:
                            logger.warning("Auto-restart: model pin restore failed for %s: %s", sid, e)

            # Restore ticker modes
            ticker_modes = saved.get("ticker_modes", {})
            if ticker_modes:
                self.execution_engine.restore_ticker_modes(ticker_modes)

            # Mark as paused
            self.execution_engine._auto_restart_paused = True
            self._persist_engine_config("auto_restart_paused")

            await self._send_boot_phase(
                "engine_started", "Engine running (PAUSED)", progress=0.9,
            )

            logger.info(
                "Auto-restart: engine PAUSED — %d strategies loaded, entries blocked. "
                "Send execution_resume to re-enable entries.",
                len(payload_strategies),
            )

            # Immediately send execution telemetry so dashboard updates
            # without waiting for the next heartbeat cycle (~20s)
            if self.websocket and self.execution_engine and self.execution_engine.is_running:
                try:
                    telemetry = self.execution_engine.get_telemetry()
                    await self._send_ws_json({
                        "type": "execution_telemetry",
                        **telemetry
                    })
                    logger.info("Auto-restart: sent immediate execution telemetry")
                except Exception as e:
                    logger.warning("Auto-restart: failed to send immediate telemetry: %s", e)
        except Exception as e:
            logger.error("Auto-restart: unexpected error: %s", e)

    # ── Expired option cleanup ──

    def _check_expired_positions(self):
        """Detect options past their expiry date and clean them up.

        Called from the heartbeat loop (~every 20s when engine is active).
        Uses strict `today > expiry_date` so 0DTE options stay active on
        expiry day and only get cleaned up the next calendar day.
        """
        if not self.execution_engine or not self.execution_engine.is_running:
            return

        today = datetime.now(ZoneInfo("America/New_York")).date()
        expired_ids = []

        for sid, state in list(self.execution_engine._strategies.items()):
            if not sid.startswith("bmc_risk_"):
                continue
            config = getattr(state, "config", {}) or {}
            instrument = config.get("instrument", {})
            expiry_str = instrument.get("expiry", "")
            if not expiry_str:
                continue
            try:
                expiry_date = datetime.strptime(expiry_str, "%Y%m%d").date()
            except ValueError:
                continue
            if today > expiry_date:
                expired_ids.append((sid, state, instrument, config))

        for sid, state, instrument, config in expired_ids:
            self._cleanup_expired_position(sid, state, instrument, config)

    def _cleanup_expired_position(self, sid: str, state, instrument: dict, config: dict):
        """Clean up a single expired position: cancel orders, unload, record P&L."""
        try:
            symbol = instrument.get("symbol", "?")
            strike = instrument.get("strike", "?")
            expiry = instrument.get("expiry", "?")
            label = f"{symbol} {strike} {expiry}"

            # 1. Cancel any working IB orders on this risk manager
            if hasattr(state.strategy, "_pending_orders"):
                for oid in list(state.strategy._pending_orders.keys()):
                    logger.info("Cancelling order %d for expired position %s", oid, sid)
                    try:
                        self.scanner.cancelOrder(oid)
                    except Exception as e:
                        logger.error("Failed to cancel order %d: %s", oid, e)

            # 2. Get entry info from position store for P&L calculation
            pos = self.position_store.get_position(sid)
            entry_info = pos.get("entry", {}) if pos else {}
            entry_price = entry_info.get("price", 0)
            entry_qty = entry_info.get("quantity", 0)
            # Use remaining_qty from risk manager if available, else entry qty
            remaining_qty = getattr(state.strategy, "remaining_qty", entry_qty) or entry_qty
            multiplier = 100  # standard options multiplier
            pnl_dollar = -(entry_price * remaining_qty * multiplier)

            # 3. Unload the risk manager strategy (frees streaming market data line)
            self.execution_engine.unload_strategy(sid)
            logger.info("Unloaded expired risk manager %s (%s)", sid, label)

            # 4. Remove from parent BMC strategy's _active_positions list
            if pos:
                parent = pos.get("parent_strategy", "")
                if parent and self.execution_engine:
                    parent_state = self.execution_engine._strategies.get(parent)
                    if not parent_state:
                        # Fallback: try directional variants
                        for suffix in ("_up", "_down"):
                            alt = self.execution_engine._strategies.get(parent + suffix)
                            if alt and hasattr(alt.strategy, "_active_positions"):
                                parent_state = alt
                                break
                    if parent_state and hasattr(parent_state.strategy, "_active_positions"):
                        parent_state.strategy._active_positions = [
                            p for p in parent_state.strategy._active_positions
                            if abs(p.get("entry_price", 0) - entry_price) > 0.005
                        ]

            # 5. Record the expiry fill with P&L
            self.position_store.add_fill(sid, {
                "time": time.time(),
                "order_id": 0,
                "level": "expired_worthless",
                "qty_filled": remaining_qty,
                "avg_price": 0.0,
                "remaining_qty": 0,
                "pnl_pct": -100.0,
                "commission": 0.0,
            })

            # 6. Mark closed with exit reason
            self.position_store.mark_closed(sid, exit_reason="expired_worthless")

            logger.info(
                "Position %s expired worthless — loss $%.2f (0 commission) [%s]",
                sid, abs(pnl_dollar), label,
            )

        except Exception as e:
            logger.error("Error cleaning up expired position %s: %s", sid, e)

    def _periodic_reconciliation(self):
        """Compare agent position state against IB source of truth.

        Called from the heartbeat loop via run_in_executor (~every 60s).
        This is a BLOCKING call (get_positions_snapshot uses Event.wait).
        Returns the reconciliation report or None on error.
        """
        if not self.execution_engine or not self.execution_engine.is_running:
            return None
        if not self.scanner or not self.scanner.isConnected() or self.scanner.connection_lost:
            return None
        # Don't reconcile during reconnect hold — positions may be stale
        if self.execution_engine._reconnect_hold:
            return None
        try:
            ib_positions = [
                p for p in self.scanner.get_positions_snapshot(timeout_sec=5.0)
                if p.get("account") == self.IB_ACCT_CODE
            ]
            ib_open_orders = self.scanner.get_open_orders_snapshot(
                timeout_sec=5.0,
                force_refresh=False,
            )
            recon = self.execution_engine.reconcile_with_ib(
                ib_positions,
                ib_open_orders=ib_open_orders,
            )
            self.position_store.purge_phantom_entry_fills()
            return recon
        except Exception as e:
            logger.error("Periodic reconciliation failed: %s", e)
            return None

    async def send_heartbeat(self):
        """Send periodic heartbeats with agent state and execution telemetry."""
        telemetry_counter = 0  # send telemetry every 2nd heartbeat (~20s)
        while self.running and self.websocket:
            try:
                await self._send_ws_json({"type": "heartbeat"})
                # Piggyback agent resource state on every heartbeat cycle
                state = self.resource_manager.get_state_report()
                # Include IB connection status so relay can answer status
                # checks from cache without sending a request through the
                # congested WebSocket (avoids timeout on page load).
                state["ib_connected"] = bool(
                    self.scanner
                    and self.scanner.isConnected()
                    and not self.scanner.connection_lost
                )
                # Include data farm health for dashboard diagnostics
                if self.scanner:
                    state["ib_farms"] = self.scanner.get_farm_status()
                    state["ib_data_available"] = self.scanner.is_data_available()
                await self._send_ws_json({
                    "type": "agent_state",
                    **state
                })
                # Send execution telemetry when engine is running (every ~20s)
                telemetry_counter += 1
                if (
                    telemetry_counter % 2 == 0
                    and self.execution_engine is not None
                    and self.execution_engine.is_running
                ):
                    telemetry = self.execution_engine.get_telemetry()
                    await self._send_ws_json({
                        "type": "execution_telemetry",
                        **telemetry
                    })
                    # Persist risk manager runtime states (~20s cadence)
                    self._persist_runtime_states()
                    # Persist engine config for auto-restart
                    self._persist_engine_config("heartbeat")
                    # Check for expired options on the same ~20s cadence
                    self._check_expired_positions()
                # Periodic IB position reconciliation (~every 60s)
                # Runs in a thread pool to avoid blocking the async heartbeat loop.
                if (
                    telemetry_counter % 6 == 0
                    and self.execution_engine is not None
                    and self.execution_engine.is_running
                    and self.scanner
                    and self.scanner.isConnected()
                    and not self.scanner.connection_lost
                ):
                    try:
                        loop = asyncio.get_running_loop()
                        recon = await loop.run_in_executor(
                            None, self._periodic_reconciliation
                        )
                        if recon:
                            if recon["orphaned_ib"]:
                                n_spawned = self._spawn_missing_risk_managers(
                                    recon["orphaned_ib"]
                                )
                                logger.warning(
                                    "Periodic reconciliation: %d orphaned IB position(s) — "
                                    "auto-spawned %d risk manager(s)",
                                    len(recon["orphaned_ib"]), n_spawned,
                                )
                            if recon["stale_agent"] or recon["adjusted"]:
                                logger.warning(
                                    "Periodic reconciliation: matched=%d, stale=%d, adjusted=%d",
                                    len(recon["matched"]),
                                    len(recon["stale_agent"]),
                                    len(recon["adjusted"]),
                                )
                            elif recon["matched"]:
                                logger.debug(
                                    "Periodic reconciliation OK: %d matched, 0 stale, 0 adjusted",
                                    len(recon["matched"]),
                                )
                    except Exception as recon_err:
                        logger.error("Periodic reconciliation error: %s", recon_err)
                # Sync dirty positions to server for P&L history persistence
                dirty_positions = self.position_store.drain_dirty()
                if dirty_positions and self.websocket:
                    try:
                        await self._send_ws_json({
                            "type": "position_sync",
                            "positions": dirty_positions,
                        })
                        logger.info("Position sync: pushed %d dirty positions", len(dirty_positions))
                    except Exception as sync_err:
                        logger.warning("Position sync failed: %s — re-dirtying", sync_err)
                        # Re-dirty so they retry next cycle
                        for p in dirty_positions:
                            self.position_store._dirty_ids.add(p["id"])
                dirty_executions = self.position_store.drain_dirty_executions()
                if dirty_executions and self.websocket:
                    try:
                        await self._send_ws_json({
                            "type": "execution_ledger_sync",
                            "executions": dirty_executions,
                        })
                        logger.info("Execution ledger sync: pushed %d execution(s)", len(dirty_executions))
                    except Exception as sync_err:
                        logger.warning("Execution ledger sync failed: %s — marking all dirty", sync_err)
                        self.position_store.mark_all_dirty()
                dirty_reservations = self.position_store.drain_dirty_exit_reservations()
                if dirty_reservations and self.websocket:
                    try:
                        await self._send_ws_json({
                            "type": "exit_reservation_sync",
                            "reservations": dirty_reservations,
                        })
                        logger.info("Exit reservation sync: pushed %d reservation(s)", len(dirty_reservations))
                    except Exception as sync_err:
                        logger.warning("Exit reservation sync failed: %s — marking all dirty", sync_err)
                        self.position_store.mark_all_dirty()
                await asyncio.sleep(HEARTBEAT_INTERVAL)
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                break

    async def _quote_push_loop(self):
        """Push live quote snapshots every ~2s for real-time Book tab updates.

        Separate from the full telemetry push (~20s) to keep quote data fresh
        without sending the entire position_ledger/attribution payload.
        """
        QUOTE_PUSH_INTERVAL = 2  # seconds
        while self.running and self.websocket:
            try:
                if (
                    self.execution_engine is not None
                    and self.execution_engine.is_running
                ):
                    snapshot = self.execution_engine._cache.get_all_serialized()
                    if snapshot:
                        await self._send_ws_json({
                            "type": "execution_quotes",
                            "quote_snapshot": snapshot,
                            "timestamp": time.time(),
                        })
                await asyncio.sleep(QUOTE_PUSH_INTERVAL)
            except Exception as e:
                logger.debug("Quote push error: %s", e)
                break

    async def _account_event_push_loop(self):
        """Fallback: drain any events that the instant callback may have missed.

        The primary path is the instant callback registered via
        scanner.set_account_event_callback() — it pushes events within
        milliseconds.  This loop is a safety net running every 10 seconds.
        """
        while self.running and self.websocket:
            try:
                if self.scanner:
                    events = self.scanner.drain_account_events()
                    for event in events:
                        await self._send_ws_json({
                            "type": "account_event",
                            "event": event,
                        })
                        logger.info("Fallback push: %s (orderId=%s)",
                                    event.get("event"), event.get("orderId"))
                await asyncio.sleep(10.0)
            except Exception as e:
                logger.error(f"Account event push error: {e}")
                break
    
    # Routine polling requests — suppress per-request logging, emit periodic summary
    _QUIET_REQUEST_TYPES = frozenset({
        "execution_status", "ib_status", "check_availability",
        "get_positions", "get_ma_positions", "get_open_orders",
    })
    _request_counts: dict = {}
    _last_request_summary: float = 0.0  # initialized to time.time() on first use
    _REQUEST_SUMMARY_INTERVAL = 60.0  # seconds

    async def _process_request(self, request_id: str, data: dict):
        """Process a request and send response"""
        request_type = data.get("request_type", "unknown")
        is_quiet = request_type in self._QUIET_REQUEST_TYPES
        t_start = time.monotonic()
        try:
            if not is_quiet:
                logger.info(f"Processing request {request_id} ({request_type})...")
            result = await self.handle_request(data)
            t_handler = time.monotonic() - t_start

            if "error" in result:
                logger.error(f"Request {request_id} failed: {result.get('error')}")
            elif not is_quiet:
                contracts_count = len(result.get("contracts", [])) if "contracts" in result else "N/A"
                logger.info(f"Request {request_id} completed. Contracts: {contracts_count}")

            response = {
                "type": "response",
                "request_id": request_id,
                "success": "error" not in result,
                "data": result if "error" not in result else None,
                "error": result.get("error")
            }

            if self.websocket:
                resp_json = json.dumps(_sanitize_for_json(response))
                t_serialize = time.monotonic() - t_start - t_handler
                await self.websocket.send(resp_json)
                t_total = time.monotonic() - t_start
                if not is_quiet:
                    logger.info(
                        f"[perf] {request_type} request_id={request_id} "
                        f"handler={t_handler:.3f}s serialize={t_serialize:.3f}s "
                        f"total={t_total:.3f}s response_bytes={len(resp_json)}"
                    )

            # Track quiet request counts for periodic summary
            if is_quiet:
                self._request_counts[request_type] = self._request_counts.get(request_type, 0) + 1
                now = time.time()
                if self._last_request_summary == 0.0:
                    self._last_request_summary = now  # initialize on first use
                if now - self._last_request_summary >= self._REQUEST_SUMMARY_INTERVAL:
                    counts_str = ", ".join(f"{k}={v}" for k, v in sorted(self._request_counts.items()))
                    logger.info(f"[heartbeat] requests in last {int(now - self._last_request_summary)}s: {counts_str}")
                    self._request_counts.clear()
                    self._last_request_summary = now
        except Exception as e:
            t_total = time.monotonic() - t_start
            logger.error(f"Error processing request {request_id} ({t_total:.3f}s): {e}")
            if self.websocket:
                await self._send_ws_json({
                    "type": "response",
                    "request_id": request_id,
                    "success": False,
                    "error": str(e)
                })

    async def message_handler(self):
        """Handle incoming messages"""
        pending_tasks = set()
        
        while self.running and self.websocket:
            try:
                message = await self.websocket.recv()
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "heartbeat_ack":
                    pass
                elif msg_type == "request":
                    request_id = data.get("request_id")
                    task = asyncio.create_task(self._process_request(request_id, data))
                    pending_tasks.add(task)
                    task.add_done_callback(pending_tasks.discard)
                else:
                    logger.warning(f"Unknown message type: {msg_type}")
            except ConnectionClosed:
                logger.warning("WebSocket connection closed")
                break
            except Exception as e:
                logger.error(f"Message handler error: {e}")
        
        for task in pending_tasks:
            task.cancel()
    
    async def _send_boot_phase(self, phase: str, detail: str = "", progress: float = 0.0):
        """Send boot progress to relay for dashboard display."""
        if self.websocket:
            try:
                await self._send_ws_json({
                    "type": "boot_phase",
                    "phase": phase,
                    "detail": detail,
                    "progress": progress,
                    "timestamp": time.time(),
                })
            except Exception:
                pass  # WS may not be ready during early boot

    async def connect_to_relay(self) -> bool:
        """Connect to the WebSocket relay"""
        if not IB_PROVIDER_KEY:
            logger.error("IB_PROVIDER_KEY environment variable not set!")
            return False
        
        logger.info(f"Connecting to relay at {RELAY_URL}...")
        
        try:
            self.websocket = await websockets.connect(
                RELAY_URL,
                ping_interval=30,
                ping_timeout=60
            )
            
            # Read version from version.txt next to this script
            _agent_version = "0.0.0"
            try:
                _vf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "version.txt")
                with open(_vf) as _f:
                    _agent_version = _f.read().strip()
            except Exception:
                pass

            await self.websocket.send(json.dumps({
                "type": "auth",
                "api_key": IB_PROVIDER_KEY,
                "version": _agent_version
            }))
            
            response = await asyncio.wait_for(
                self.websocket.recv(),
                timeout=10.0
            )
            
            auth_result = json.loads(response)
            
            if auth_result.get("success"):
                self.provider_id = auth_result.get("provider_id")
                logger.info(f"Authenticated with relay as provider {self.provider_id}")
                return True
            else:
                logger.error(f"Authentication failed: {auth_result.get('error')}")
                return False
        except Exception as e:
            logger.error(f"Failed to connect to relay: {e}")
            return False
    
    def _make_account_event_callback(self, loop):
        """Create a callback for the scanner that pushes account events
        to the WebSocket relay instantly via call_soon_threadsafe.
        This bridges the IB message thread → asyncio event loop."""
        def on_account_event(event: dict):
            ws = self.websocket
            if ws is None:
                return
            async def _push():
                try:
                    await ws.send(json.dumps(_sanitize_for_json({
                        "type": "account_event",
                        "event": event,
                    })))
                    logger.info("Instant push: %s (orderId=%s)",
                                event.get("event"), event.get("orderId"))
                except Exception:
                    pass  # connection may be closing
            try:
                loop.call_soon_threadsafe(asyncio.ensure_future, _push())
            except RuntimeError:
                pass  # loop is closed
        return on_account_event

    async def run(self):
        """Main run loop"""
        self.running = True

        # Try IB once at startup (non-blocking — agent works without IB via Polygon)
        logger.info("Attempting IB TWS connection...")
        ib_ok = await self._connect_to_ib_with_retry(max_attempts=2)
        if ib_ok:
            logger.info("IB TWS connected — full IB + Polygon data available")
            # Register instant account-event callback (bridges IB thread → asyncio → WS)
            loop = asyncio.get_running_loop()
            self.scanner.set_account_event_callback(self._make_account_event_callback(loop))
        else:
            logger.warning(
                "IB TWS not available — agent will connect to relay without IB. "
                "Polygon data is still available. IB will auto-reconnect when TWS starts."
            )

        # Launch background TWS health monitor (handles reconnection if IB was down or drops)
        tws_health_task = asyncio.create_task(self._tws_health_loop())
        logger.info("TWS health monitor started (auto-reconnect enabled)")

        while self.running:
            try:
                if not await self.connect_to_relay():
                    logger.warning(f"Relay connection failed, retrying in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
                    continue
                
                await self._send_boot_phase("relay_connected", "Connected to relay")

                # Report IB managed accounts to relay for diagnostics / routing
                ib_accounts = getattr(self.scanner, "_managed_accounts", [])
                if ib_accounts and self.websocket:
                    await self.websocket.send(json.dumps({
                        "type": "ib_accounts",
                        "accounts": ib_accounts
                    }))
                    logger.info(f"Reported IB accounts to relay: {ib_accounts}")

                # Mark all positions dirty for full sync on (re)connect
                self.position_store.mark_all_dirty()

                # Auto-restart engine from saved config (once per lifecycle)
                await self._send_boot_phase("auto_restart_loading", "Checking saved config...")
                await self._maybe_auto_restart()
                await self._send_boot_phase("boot_complete", "Ready")

                heartbeat_task = asyncio.create_task(self.send_heartbeat())
                handler_task = asyncio.create_task(self.message_handler())
                event_push_task = asyncio.create_task(self._account_event_push_loop())
                quote_push_task = asyncio.create_task(self._quote_push_loop())

                logger.info("Agent running - ready to handle requests")
                logger.info("Press Ctrl+C to stop")

                done, pending = await asyncio.wait(
                    [heartbeat_task, handler_task, event_push_task, quote_push_task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                for task in pending:
                    task.cancel()
                
                if self.running:
                    logger.warning(f"Relay connection lost, reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
            except Exception as e:
                logger.error(f"Agent error: {e}")
                if self.running:
                    await asyncio.sleep(RECONNECT_DELAY)
        
        # Clean up health monitor
        tws_health_task.cancel()
        try:
            await tws_health_task
        except asyncio.CancelledError:
            pass
        
        self.disconnect_from_ib()
        if self.websocket:
            await self.websocket.close()
    
    def stop(self):
        """Stop the agent"""
        logger.info("Stopping agent...")
        self.running = False


def main():
    """Main entry point"""
    print("=" * 60)
    print("IB Data Agent (Standalone)")
    print("=" * 60)
    print(f"IB TWS:     {IB_HOST}:{IB_PORT} (client_id={IB_CLIENT_ID})")
    print(f"Relay URL:  {RELAY_URL}")
    print(f"API Key:    {'*' * 8 if IB_PROVIDER_KEY else 'NOT SET!'}")
    print("=" * 60)
    
    if not IB_PROVIDER_KEY:
        print("\nERROR: IB_PROVIDER_KEY environment variable is required!")
        print("Set it in config.env or with: export IB_PROVIDER_KEY='your-api-key'")
        sys.exit(1)
    
    agent = IBDataAgent()
    
    def signal_handler(sig, frame):
        print("\nShutting down...")
        agent.stop()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
