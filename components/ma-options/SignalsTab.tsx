"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderBudgetControl } from "./OrderBudgetControl";

// ---------------------------------------------------------------------------
// Types — Full execution_status response
// ---------------------------------------------------------------------------

interface QuoteSnapshot {
  bid: number;
  ask: number;
  last: number;
  mid: number;
  bid_size: number;
  ask_size: number;
  volume: number;
  open_interest: number;
  implied_vol: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: number;
  age_seconds: number;
}

interface FillLogEntry {
  time: number;
  order_id: number;
  exec_id?: string;
  level: string;
  qty_filled: number;
  avg_price: number;
  remaining_qty: number;
  pnl_pct: number;
  execution_analytics?: {
    exchange?: string;
    last_liquidity?: number;
    commission?: number | null;
    realized_pnl_ib?: number | null;
    slippage?: number | null;
  };
}

interface RiskManagerState {
  remaining_qty: number;
  initial_qty: number;
  entry_price: number;
  high_water_mark: number;
  is_long: boolean;
  cache_key: string;
  completed: boolean;
  trailing_stop_price: number;
  trailing_active: boolean;
  level_states: Record<string, string>;
  pending_orders: Record<string, { level: string; expected_qty: number; filled_so_far: number; placed_at: number }>;
  fill_log: FillLogEntry[];
}

interface ExecutionStrategyInfo {
  strategy_id: string;
  is_active: boolean;
  subscriptions: string[];
  eval_count: number;
  orders_submitted: number;
  orders_placed: number;
  inflight_orders: number;
  last_eval_time: number;
  recent_errors: string[];
  config: Record<string, any>;
  strategy_state: RiskManagerState | Record<string, any>;
}

interface ActiveOrder {
  order_id: number;
  strategy_id: string;
  status: string;
  filled: number;
  remaining: number;
  avg_fill_price: number;
  placed_at: number;
  last_update: number;
}

interface PositionLedgerEntry {
  id: string;
  status: "active" | "closed";
  created_at: number;
  closed_at: number | null;
  exit_reason?: string;
  entry: { order_id: number; price: number; quantity: number; fill_time: number; perm_id: number };
  instrument: { symbol: string; strike?: number; expiry?: string; right?: string };
  fill_log: FillLogEntry[];
  lineage?: {
    model_version?: string;
    model_type?: string;
    signal?: { probability?: number; direction?: string; strength?: number };
    option_selection?: { strike?: number; limit_price?: number; opt_bid?: number; opt_ask?: number };
  };
}

interface FullExecutionStatus {
  running: boolean;
  eval_interval: number;
  strategy_count: number;
  strategies: ExecutionStrategyInfo[];
  inflight_orders_total: number;
  max_inflight_orders: number;
  lines_held: number;
  available_scan_lines: number;
  quote_snapshot: Record<string, QuoteSnapshot>;
  active_orders: ActiveOrder[];
  order_budget: number;
  total_algo_orders: number;
  position_ledger?: PositionLedgerEntry[];
}

// ---------------------------------------------------------------------------
// Types — BMC signal state
// ---------------------------------------------------------------------------

interface SignalState {
  type: string;
  ticker: string;
  started: boolean;
  startup_error: string;
  uptime_s: number;
  decisions_run: number;
  signals_generated: number;
  positions_spawned: number;
  last_decision_time: number;
  model_version: string;
  model_ticker: string;
  model_type: string;
  current_signal: {
    timestamp: string;
    probability: number;
    direction: string;
    strength: number;
    n_features: number;
    n_nan: number;
    computation_ms: number;
    bars_available: Record<string, number>;
    underlying_price: number | null;
    suppressed?: string;
    option_contract?: {
      symbol: string;
      strike: number;
      expiry: string;
      right: string;
    };
  } | null;
  signal_history: Array<{
    timestamp: string;
    probability: number;
    direction: string;
    strength: number;
    suppressed?: string;
  }>;
  polygon_ws: {
    connected: boolean;
    uptime_s: number;
    reconnect_count: number;
    message_count: number;
    error_count: number;
    subscribed_channels: string[];
  };
  bar_accumulator: {
    total_trades_received: number;
    total_quotes_received: number;
    total_bars_emitted: number;
    bars: Record<string, { has_data: boolean; n_trades: number; n_quotes: number; volume: number }>;
  };
  data_store: {
    n_equity_quotes: number;
    bar_counts: Record<string, number>;
    has_daily_features: boolean;
  };
  active_positions: Array<{
    order_id: number;
    entry_price: number;
    quantity: number;
    fill_time: number;
    perm_id?: number;
    signal?: {
      option_contract?: {
        symbol: string;
        strike: number;
        expiry: string;
        right: string;
      };
      direction?: string;
    } | null;
  }>;
}

interface StrategyEntry {
  ticker: string;
  strategy_id: string;
  signal: SignalState | null;
  config: BMCConfig | null;
}

interface BMCConfig {
  ticker: string;
  signal_threshold: number;
  min_signal_strength: number;
  cooldown_minutes: number;
  decision_interval_seconds: number;
  max_contracts: number;
  contract_budget_usd: number;
  scan_start: string;
  scan_end: string;
  auto_entry: boolean;
  direction_mode: string;
  use_delayed_data: boolean;
  // DTE / option selection
  preferred_dte: number[];
  max_spread: number;
  premium_min: number;
  premium_max: number;
  // Signal gating
  straddle_richness_max: number;
  straddle_richness_ideal: number;
  options_gate_enabled: boolean;
  // Risk management
  risk_preset: string;
  risk_stop_loss_enabled: boolean;
  risk_stop_loss_type: string;
  risk_stop_loss_trigger_pct: number;
  risk_trailing_enabled: boolean;
  risk_trailing_activation_pct: number;
  risk_trailing_trail_pct: number;
  risk_profit_targets_enabled: boolean;
  risk_profit_targets: Array<{ trigger_pct: number; exit_pct: number }>;
}

const DEFAULT_CONFIG: BMCConfig = {
  ticker: "SPY",
  signal_threshold: 0.5,
  min_signal_strength: 0.3,
  cooldown_minutes: 15,
  decision_interval_seconds: 60,
  max_contracts: 5,
  contract_budget_usd: 150,
  scan_start: "13:30",
  scan_end: "15:55",
  auto_entry: false,
  direction_mode: "both",
  use_delayed_data: false,
  preferred_dte: [0, 1],
  max_spread: 0.05,
  premium_min: 0.10,
  premium_max: 3.00,
  straddle_richness_max: 1.5,
  straddle_richness_ideal: 0.9,
  options_gate_enabled: false,
  risk_preset: "zero_dte_convexity",
  risk_stop_loss_enabled: false,
  risk_stop_loss_type: "none",
  risk_stop_loss_trigger_pct: -5.0,
  risk_trailing_enabled: true,
  risk_trailing_activation_pct: 25,
  risk_trailing_trail_pct: 15,
  risk_profit_targets_enabled: true,
  risk_profit_targets: [],
};

// Risk management presets (mirrors Python RiskManagerStrategy PRESETS)
const RISK_PRESETS: Record<string, Partial<BMCConfig>> = {
  zero_dte_convexity: {
    risk_stop_loss_enabled: false,
    risk_stop_loss_type: "none",
    risk_trailing_enabled: true,
    risk_trailing_activation_pct: 25,
    risk_trailing_trail_pct: 15,
    risk_profit_targets_enabled: true,
    risk_profit_targets: [],
  },
  zero_dte_lotto: {
    risk_stop_loss_enabled: false,
    risk_stop_loss_type: "none",
    risk_trailing_enabled: true,
    risk_trailing_activation_pct: 50,
    risk_trailing_trail_pct: 25,
    risk_profit_targets_enabled: true,
    risk_profit_targets: [
      { trigger_pct: 100, exit_pct: 20 },
      { trigger_pct: 300, exit_pct: 25 },
      { trigger_pct: 500, exit_pct: 25 },
      { trigger_pct: 1000, exit_pct: 50 },
    ],
  },
  stock_swing: {
    risk_stop_loss_enabled: true,
    risk_stop_loss_type: "simple",
    risk_stop_loss_trigger_pct: -5.0,
    risk_trailing_enabled: true,
    risk_trailing_activation_pct: 5,
    risk_trailing_trail_pct: 3,
    risk_profit_targets_enabled: true,
    risk_profit_targets: [{ trigger_pct: 10, exit_pct: 50 }],
  },
  conservative: {
    risk_stop_loss_enabled: true,
    risk_stop_loss_type: "simple",
    risk_stop_loss_trigger_pct: -5.0,
    risk_trailing_enabled: false,
    risk_trailing_activation_pct: 0,
    risk_trailing_trail_pct: 0,
    risk_profit_targets_enabled: true,
    risk_profit_targets: [
      { trigger_pct: 5, exit_pct: 50 },
      { trigger_pct: 10, exit_pct: 100 },
    ],
  },
};

const RISK_PRESET_NAMES = ["zero_dte_convexity", "zero_dte_lotto", "stock_swing", "conservative", "custom"] as const;

// Per-ticker config overrides (mirrors _TICKER_PROFILES in Python)
const TICKER_DEFAULTS: Record<string, Partial<BMCConfig>> = {
  SPY: {
    scan_start: "13:30",
    scan_end: "15:55",
    contract_budget_usd: 150,
    direction_mode: "both",
  },
  SLV: {
    preferred_dte: [0, 1, 2, 3, 4, 5],
    max_spread: 0.20,
    premium_min: 0.05,
    premium_max: 1.50,
    scan_start: "09:35",
    scan_end: "13:30",
    contract_budget_usd: 50,
    direction_mode: "both",
    straddle_richness_max: 2.5,
    straddle_richness_ideal: 1.5,
  },
  QQQ: {
    preferred_dte: [0, 1],
    max_spread: 0.05,
    scan_start: "13:30",
    scan_end: "15:55",
    contract_budget_usd: 150,
  },
  IWM: {
    preferred_dte: [0, 1],
    max_spread: 0.10,
    premium_min: 0.05,
    premium_max: 2.00,
    scan_start: "13:30",
    scan_end: "15:55",
    contract_budget_usd: 100,
  },
  GLD: {
    preferred_dte: [0, 1, 2, 3, 4, 5],
    max_spread: 0.15,
    premium_min: 0.05,
    premium_max: 2.00,
    scan_start: "09:35",
    scan_end: "13:30",
    contract_budget_usd: 50,
    straddle_richness_max: 2.0,
    straddle_richness_ideal: 1.2,
  },
};

// Available tickers for BMC strategies
const AVAILABLE_TICKERS = ["SPY", "SLV", "QQQ", "IWM", "GLD"];

function makeDefaultConfig(ticker: string): BMCConfig {
  return { ...DEFAULT_CONFIG, ...TICKER_DEFAULTS[ticker], ticker };
}

const BMC_CONFIGS_STORAGE_KEY = "bmc-configs";

function loadCachedConfigs(): Record<string, BMCConfig> | null {
  try {
    const raw = localStorage.getItem(BMC_CONFIGS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCachedConfigs(configs: Record<string, BMCConfig>) {
  try {
    localStorage.setItem(BMC_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // localStorage quota exceeded or unavailable — ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignalsTab() {
  // Multi-ticker state: strategy entries from the agent, keyed by ticker
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which tickers are enabled for starting
  const [enabledTickers, setEnabledTickers] = useState<string[]>(["SPY", "SLV"]);
  // Per-ticker configs (for editing before start or hot-reload)
  // Initialize from localStorage cache to survive page refreshes
  const [configs, setConfigs] = useState<Record<string, BMCConfig>>(() => {
    const cached = loadCachedConfigs();
    if (cached) return cached;
    return {
      SPY: makeDefaultConfig("SPY"),
      SLV: makeDefaultConfig("SLV"),
    };
  });
  const [configDirty, setConfigDirty] = useState<Record<string, boolean>>({});
  const configDirtyRef = useRef<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Currently selected ticker tab for viewing signal details
  const [activeTicker, setActiveTicker] = useState("SPY");

  // ── Model chooser state ──
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelList, setModelList] = useState<Array<{
    version_id: string;
    model_type: string;
    created_at: string;
    status: string;
    ticker: string;
    recipe_label: string;
    target_column: string;
    dataset_version: string;
    n_features: number;
    n_samples: number;
    tags: string[];
    metrics: Record<string, number | null>;
    is_current: boolean;
  }>>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelSwapping, setModelSwapping] = useState(false);
  const [swappingVersionId, setSwappingVersionId] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  // ── Poll signal state ──
  const fetchSignal = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/bmc-signal", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setRunning(data.running ?? false);

      // Multi-ticker: use strategies array if available
      if (data.strategies && Array.isArray(data.strategies)) {
        setStrategies(data.strategies);
        // Update configs from agent for tickers not being edited
        for (const strat of data.strategies) {
          const t = strat.ticker;
          if (strat.config && !configDirtyRef.current[t]) {
            setConfigs(prev => {
              const updated = {
                ...prev,
                [t]: configFromAgent(strat.config, t),
              };
              saveCachedConfigs(updated);
              return updated;
            });
          }
        }
      } else if (data.signal) {
        // Legacy single-ticker fallback
        const ticker = data.signal?.ticker || "SPY";
        setStrategies([{
          ticker,
          strategy_id: `bmc_${ticker.toLowerCase()}`,
          signal: data.signal,
          config: data.config,
        }]);
        if (data.config && !configDirtyRef.current[ticker]) {
          setConfigs(prev => {
            const updated = {
              ...prev,
              [ticker]: configFromAgent(data.config, ticker),
            };
            saveCachedConfigs(updated);
            return updated;
          });
        }
      }
      setError(null);
    } catch {
      // silent -- poll will retry
    }
  }, []);

  useEffect(() => {
    fetchSignal();
    pollRef.current = setInterval(fetchSignal, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchSignal]);

  // ── Execution status polling (for OrderBudgetControl + position display) ──
  const [executionStatus, setExecutionStatus] = useState<FullExecutionStatus | null>(null);
  const execPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchExecutionStatus = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/execution/status", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setExecutionStatus(data);
      }
    } catch { /* silent */ }
  }, []);

  // Always poll — faster when BMC is running, slower when stopped (catches
  // engine already running from a previous session or another tab).
  useEffect(() => {
    fetchExecutionStatus();
    const interval = running ? 5000 : 15000;
    execPollRef.current = setInterval(fetchExecutionStatus, interval);
    return () => { if (execPollRef.current) clearInterval(execPollRef.current); };
  }, [running, fetchExecutionStatus]);

  const handleSetBudget = useCallback(async (budget: number) => {
    const res = await fetch("/api/ma-options/execution/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget }),
      credentials: "include",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `Budget update failed: ${res.status}`);
    }
    setTimeout(fetchExecutionStatus, 300);
  }, [fetchExecutionStatus]);

  // ── IB Execution P&L (on-demand fetch) ──
  interface IBTrade {
    contract_label: string;
    symbol: string;
    sec_type: string;
    strike: number;
    expiry: string;
    right: string;
    buy_qty: number;
    sell_qty: number;
    open_qty: number;
    avg_buy: number;
    avg_sell: number | null;
    gross_pnl: number | null;
    total_commission: number;
    net_pnl: number | null;
    status: "open" | "closed";
    fills: { side: string; time: string; price: number; shares: number; exchange: string; commission: number | null }[];
  }
  interface IBPnlData {
    executions_count: number;
    trades: IBTrade[];
    summary: {
      total_gross_pnl: number;
      total_commission: number;
      total_net_pnl: number;
      closed_count: number;
      open_count: number;
      wins: number;
      losses: number;
    };
  }
  const [ibPnl, setIbPnl] = useState<IBPnlData | null>(null);
  const [ibPnlLoading, setIbPnlLoading] = useState(false);
  const fetchIbPnl = useCallback(async () => {
    setIbPnlLoading(true);
    try {
      const res = await fetch("/api/ma-options/execution/ib-pnl", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setIbPnl(data);
      }
    } catch { /* silent */ }
    finally { setIbPnlLoading(false); }
  }, []);

  // ── Start BMC (multi-ticker) ──
  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const tickers = enabledTickers.map(t => ({
        ticker: t,
        config: configs[t] || makeDefaultConfig(t),
      }));
      const res = await fetch("/api/ma-options/bmc-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setRunning(true);
    } catch (e: any) {
      setError(e.message || "Failed to start");
    } finally {
      setLoading(false);
    }
  };

  // ── Stop BMC ──
  const handleStop = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ma-options/execution/stop", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setRunning(false);
    } catch (e: any) {
      setError(e.message || "Failed to stop");
    } finally {
      setLoading(false);
    }
  };

  // ── Manually close a position ──
  const handleClosePosition = async (positionId: string, label: string) => {
    if (!confirm(`Mark position ${label} as manually closed? This will stop the risk manager.`)) return;
    try {
      const res = await fetch("/api/ma-options/execution/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ position_id: positionId }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
    } catch (e: any) {
      setError(e.message || "Failed to close position");
    }
  };

  // ── Update config for a specific ticker ──
  const handleConfigUpdate = async (ticker: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/ma-options/bmc-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configs[ticker], ticker }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setConfigDirty(prev => ({ ...prev, [ticker]: false }));
        configDirtyRef.current[ticker] = false;
        setError(null);
      }
    } catch (e: any) {
      setError(e.message || "Failed to update config");
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (ticker: string, key: keyof BMCConfig, value: any) => {
    setConfigs(prev => {
      const current = prev[ticker] || makeDefaultConfig(ticker);
      const updated = { ...current, [key]: value };
      // If a risk field changed (not the preset itself), switch preset to "custom"
      if (key !== "risk_preset" && key.startsWith("risk_")) {
        updated.risk_preset = "custom";
      }
      return { ...prev, [ticker]: updated };
    });
    setConfigDirty(prev => ({ ...prev, [ticker]: true }));
    configDirtyRef.current[ticker] = true;
  };

  const applyRiskPreset = (ticker: string, presetName: string) => {
    const preset = RISK_PRESETS[presetName];
    if (!preset) {
      updateConfig(ticker, "risk_preset", presetName);
      return;
    }
    setConfigs(prev => ({
      ...prev,
      [ticker]: { ...(prev[ticker] || makeDefaultConfig(ticker)), ...preset, risk_preset: presetName },
    }));
    setConfigDirty(prev => ({ ...prev, [ticker]: true }));
    configDirtyRef.current[ticker] = true;
  };

  const addProfitTarget = (ticker: string) => {
    const current = configs[ticker] || makeDefaultConfig(ticker);
    const targets = [...(current.risk_profit_targets || []), { trigger_pct: 100, exit_pct: 25 }];
    updateConfig(ticker, "risk_profit_targets", targets);
  };

  const removeProfitTarget = (ticker: string, idx: number) => {
    const current = configs[ticker] || makeDefaultConfig(ticker);
    const targets = (current.risk_profit_targets || []).filter((_, i) => i !== idx);
    updateConfig(ticker, "risk_profit_targets", targets);
  };

  const updateProfitTarget = (ticker: string, idx: number, field: "trigger_pct" | "exit_pct", val: number) => {
    const current = configs[ticker] || makeDefaultConfig(ticker);
    const targets = [...(current.risk_profit_targets || [])];
    targets[idx] = { ...targets[idx], [field]: val };
    updateConfig(ticker, "risk_profit_targets", targets);
  };

  const toggleTicker = (ticker: string) => {
    setEnabledTickers(prev => {
      if (prev.includes(ticker)) {
        return prev.filter(t => t !== ticker);
      }
      // Ensure config exists
      if (!configs[ticker]) {
        setConfigs(c => ({ ...c, [ticker]: makeDefaultConfig(ticker) }));
      }
      return [...prev, ticker];
    });
  };

  // ── Model chooser handlers ──
  const fetchModelList = useCallback(async () => {
    const strat = strategies.find(s => s.ticker === activeTicker);
    if (!strat) return;
    setModelListLoading(true);
    setModelError(null);
    try {
      const res = await fetch("/api/ma-options/execution/list-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strat.strategy_id, ticker: activeTicker }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) {
        setModelError(data.error);
      } else {
        setModelList(data.models || []);
        setModelModalOpen(true);
      }
    } catch (e: any) {
      setModelError(e.message || "Failed to fetch models");
    } finally {
      setModelListLoading(false);
    }
  }, [strategies, activeTicker]);

  const swapModel = useCallback(async (versionId: string) => {
    const strat = strategies.find(s => s.ticker === activeTicker);
    if (!strat) return;
    setModelSwapping(true);
    setSwappingVersionId(versionId);
    setModelError(null);
    try {
      const res = await fetch("/api/ma-options/execution/swap-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strat.strategy_id, version_id: versionId }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) {
        setModelError(data.error);
      } else {
        // Update model list locally so is_current markers reflect the swap immediately
        setModelList(prev => prev.map(m => ({
          ...m,
          is_current: m.version_id === versionId,
        })));
        setModelModalOpen(false);
        // Telemetry will auto-update on next poll (~5s)
      }
    } catch (e: any) {
      setModelError(e.message || "Failed to swap model");
    } finally {
      setModelSwapping(false);
      setSwappingVersionId(null);
    }
  }, [strategies, activeTicker]);

  // ── Derived: which tickers have running strategies ──
  const runningTickers = useMemo(
    () => strategies.map(s => s.ticker),
    [strategies],
  );

  // Current ticker's signal and config
  const activeStrategy = strategies.find(s => s.ticker === activeTicker);
  const signal = activeStrategy?.signal ?? null;
  const activeConfig = configs[activeTicker] || makeDefaultConfig(activeTicker);
  const activeConfigDirty = configDirty[activeTicker] ?? false;

  // ── Derived: position details with risk manager + live quotes ──
  const positionDetails = useMemo(() => {
    if (!signal?.active_positions?.length) return [];
    const riskStrategies = (executionStatus?.strategies || []).filter(
      s => s.strategy_id.includes("risk_") && s.strategy_state && "entry_price" in s.strategy_state,
    ) as (ExecutionStrategyInfo & { strategy_state: RiskManagerState })[];
    const quotes = executionStatus?.quote_snapshot || {};

    return signal.active_positions.map(pos => {
      // Match by entry_price + initial_qty (no explicit FK)
      const matchedStrategy = riskStrategies.find(
        s => Math.abs(s.strategy_state.entry_price - pos.entry_price) < 0.005
          && s.strategy_state.initial_qty === pos.quantity,
      );
      const rm = matchedStrategy?.strategy_state ?? null;
      const strategyId = matchedStrategy?.strategy_id ?? null;
      const quote = rm?.cache_key ? quotes[rm.cache_key] ?? null : null;

      // Unrealized P&L (assumes long — BMC always buys)
      let pnlPct: number | null = null;
      let pnlDollar: number | null = null;
      if (quote && quote.mid > 0 && pos.entry_price > 0) {
        pnlPct = ((quote.mid - pos.entry_price) / pos.entry_price) * 100;
        pnlDollar = (quote.mid - pos.entry_price) * pos.quantity * 100;
      }

      // Option info from the signal snapshot at fill time
      const optionContract = pos.signal?.option_contract ?? null;

      const recentErrors = matchedStrategy?.recent_errors ?? [];
      return { pos, rm, quote, pnlPct, pnlDollar, optionContract, strategyId, recentErrors };
    });
  }, [signal?.active_positions, executionStatus?.strategies, executionStatus?.quote_snapshot]);

  // ── Derived: all fills from position ledger (persists across restarts) ──
  const allFills = useMemo(() => {
    const ledger = executionStatus?.position_ledger;
    if (!ledger || ledger.length === 0) return [];
    const fills: (FillLogEntry & { source: string; instrument?: PositionLedgerEntry["instrument"]; positionStatus?: string; modelVersion?: string })[] = [];
    for (const pos of ledger) {
      const mv = pos.lineage?.model_version;
      // Entry fill from the position's entry data
      if (pos.entry?.fill_time) {
        fills.push({
          time: pos.entry.fill_time,
          order_id: pos.entry.order_id ?? 0,
          level: "entry",
          qty_filled: pos.entry.quantity ?? 0,
          avg_price: pos.entry.price ?? 0,
          remaining_qty: pos.entry.quantity ?? 0,
          pnl_pct: 0,
          source: pos.id,
          instrument: pos.instrument,
          positionStatus: pos.status,
          modelVersion: mv,
        });
      }
      // Exit fills from fill_log
      for (const f of pos.fill_log || []) {
        if (f.level !== "entry") {
          fills.push({ ...f, source: pos.id, instrument: pos.instrument, positionStatus: pos.status, modelVersion: mv });
        }
      }
    }
    fills.sort((a, b) => b.time - a.time);
    return fills;
  }, [executionStatus?.position_ledger]);

  // ── Derived: session summary from position ledger ──
  const sessionSummary = useMemo(() => {
    const ledger = executionStatus?.position_ledger || [];
    const activeLedger = ledger.filter(p => p.status === "active");
    const closedLedger = ledger.filter(p => p.status === "closed");
    let wins = 0;
    let losses = 0;
    let expired = 0;
    let totalPnl = 0;
    let totalCommission = 0;
    for (const pos of closedLedger) {
      if (pos.exit_reason === "expired_worthless") expired++;
      const exitFills = (pos.fill_log || []).filter(f => f.level !== "entry");
      const lastFill = exitFills[exitFills.length - 1];
      if (lastFill) {
        if (lastFill.pnl_pct >= 0) wins++;
        else losses++;
      }
      const entryPrice = pos.entry?.price ?? 0;
      for (const f of exitFills) {
        totalPnl += (f.avg_price - entryPrice) * f.qty_filled * 100;
      }
    }
    // Sum commissions across ALL fills (entry + exit, active + closed)
    for (const pos of ledger) {
      for (const f of pos.fill_log || []) {
        const comm = f.execution_analytics?.commission;
        if (comm != null && comm > 0) totalCommission += comm;
      }
    }
    // Unrealized P&L from live position details (quotes-driven, unchanged)
    let unrealizedPnl = 0;
    for (const pd of positionDetails) {
      if (pd.pnlDollar !== null) unrealizedPnl += pd.pnlDollar;
    }
    return {
      activeCount: activeLedger.length,
      completedCount: closedLedger.length,
      expired,
      wins,
      losses,
      totalPnl,       // gross P&L
      totalCommission, // total commissions paid
      netPnl: totalPnl - totalCommission,
      unrealizedPnl,
    };
  }, [executionStatus?.position_ledger, positionDetails]);

  const ws = signal?.polygon_ws;
  const bars = signal?.bar_accumulator;
  const currentSig = signal?.current_signal;
  const directionColor = currentSig?.direction === "long" ? "text-green-400"
    : currentSig?.direction === "short" ? "text-red-400"
    : "text-gray-500";

  return (
    <div className="space-y-3">
      {/* ── Ticker Selector / Tabs ── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 mr-1">Tickers:</span>
        {AVAILABLE_TICKERS.map(t => {
          const isActive = activeTicker === t;
          const isEnabled = enabledTickers.includes(t);
          const isRunning = runningTickers.includes(t);
          const strat = strategies.find(s => s.ticker === t);
          const hasModel = strat?.signal?.model_version;
          const hasFailed = strat?.signal?.startup_error;
          return (
            <div key={t} className="flex items-center gap-1">
              {!running && (
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleTicker(t)}
                  className="w-3 h-3 accent-blue-600 cursor-pointer inline-edit"
                />
              )}
              <button
                onClick={() => setActiveTicker(t)}
                title={
                  hasModel ? `Model: ${strat?.signal?.model_version} (${strat?.signal?.model_type})`
                  : hasFailed ? `Error: ${strat?.signal?.startup_error}`
                  : isRunning ? "Loading..."
                  : undefined
                }
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : hasFailed
                      ? "bg-red-900/30 text-red-400 hover:bg-red-900/50"
                      : isRunning
                        ? "bg-green-900/30 text-green-400 hover:bg-green-900/50"
                        : isEnabled
                          ? "bg-blue-900/30 text-blue-400 hover:bg-blue-900/50"
                          : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {t}
                {running && isRunning && hasModel && !isActive && (
                  <span className="ml-1 text-[9px]">{"\u25CF"}</span>
                )}
                {running && hasFailed && (
                  <span className="ml-1 text-[9px] text-red-400">{"\u26A0"}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-gray-600"}`} />
          <span className="text-gray-400">{running ? "Running" : "Stopped"}</span>
          {running && (
            <span className="text-gray-600 text-xs">
              ({runningTickers.length} ticker{runningTickers.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>

        {ws && (
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${ws.connected ? "bg-blue-500" : "bg-red-500"}`} />
            <span className="text-gray-400">
              Polygon {ws.connected ? "connected" : "disconnected"}
            </span>
            {ws.connected && (
              <span className="text-gray-600 text-xs">
                {ws.message_count.toLocaleString()} msgs
              </span>
            )}
          </div>
        )}

        {bars && (
          <span className="text-gray-600 text-xs">
            {bars.total_bars_emitted} bars
          </span>
        )}

        {signal && (
          <span className="text-gray-600 text-xs ml-auto">
            {signal.decisions_run} decisions &middot; {signal.signals_generated} signals &middot; {signal.positions_spawned} positions
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-3 py-1.5 rounded">
          {error}
        </div>
      )}

      {/* Per-ticker startup errors (show all, not just active) */}
      {running && strategies.filter(s => s.signal?.startup_error).map(s => (
        <div key={s.ticker} className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-3 py-1.5 rounded">
          <span className="font-medium">{s.ticker}:</span> {s.signal?.startup_error}
        </div>
      ))}
      {/* Non-running startup error for active ticker */}
      {!running && signal?.startup_error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-3 py-1.5 rounded">
          Startup error: {signal.startup_error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {/* ── Signal Panel ── */}
        <div className="col-span-2 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded p-3">
            <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <span>Current Signal {activeTicker && <span className="text-blue-400">({activeTicker})</span>}</span>
              {signal?.model_version && (
                running ? (
                  <button
                    onClick={fetchModelList}
                    disabled={modelListLoading}
                    className="text-[10px] text-gray-500 hover:text-blue-400 font-normal transition-colors cursor-pointer inline-flex items-center gap-0.5"
                    title={`Model: ${signal.model_version} — click to browse/swap`}
                  >
                    {signal.model_type}/{signal.model_ticker || "?"} {modelListLoading ? "..." : "▾"}
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-600 font-normal" title={`Model: ${signal.model_version}`}>
                    {signal.model_type}/{signal.model_ticker || "?"}
                  </span>
                )
              )}
            </h3>
            {currentSig ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className={`text-2xl font-bold ${directionColor}`}>
                    {currentSig.direction === "none" ? "\u2014" : currentSig.direction.toUpperCase()}
                  </span>
                  <span className="text-lg text-gray-300">
                    p={currentSig.probability.toFixed(4)}
                  </span>
                  <span className="text-sm text-gray-500">
                    strength={currentSig.strength.toFixed(3)}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>{currentSig.timestamp}</span>
                  <span>{currentSig.n_features} features ({currentSig.n_nan} NaN)</span>
                  <span>{currentSig.computation_ms?.toFixed(0)}ms</span>
                  {currentSig.underlying_price && (
                    <span>{activeTicker} ${currentSig.underlying_price.toFixed(2)}</span>
                  )}
                  {currentSig.suppressed && (
                    <span className="text-yellow-500">suppressed: {currentSig.suppressed}</span>
                  )}
                </div>
                {currentSig.option_contract && (
                  <div className="text-xs text-gray-400">
                    Contract: {currentSig.option_contract.symbol}{" "}
                    {currentSig.option_contract.strike.toFixed(2)}{" "}
                    {currentSig.option_contract.right}{" "}
                    {currentSig.option_contract.expiry}
                  </div>
                )}
                {currentSig.bars_available && (
                  <div className="flex gap-2 text-xs text-gray-600">
                    {Object.entries(currentSig.bars_available).map(([k, v]) => (
                      <span key={k}>{k}: {v}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-600 text-sm">
                {signal?.startup_error ? (
                  <span className="text-red-400">Failed to start: {signal.startup_error}</span>
                ) : running ? (
                  "Waiting for first decision cycle..."
                ) : (
                  "Strategy not running"
                )}
              </div>
            )}
          </div>

          {/* ── Active Positions (enhanced) ── */}
          {positionDetails.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">
                Active Positions ({positionDetails.length})
              </h3>
              <div className="space-y-2">
                {positionDetails.map((pd, i) => {
                  const { pos, rm, quote, pnlPct, pnlDollar, optionContract, strategyId, recentErrors } = pd;
                  const isCall = optionContract?.right?.toUpperCase() === "C" || optionContract?.right?.toUpperCase() === "CALL";
                  const isCompleted = rm?.completed;
                  const staleQuote = quote && quote.age_seconds > 30;
                  const posLabel = optionContract ? `${optionContract.strike} ${isCall ? "C" : "P"}` : "position";
                  return (
                    <div key={i} className={`border rounded p-2 space-y-1 ${isCompleted ? "border-gray-700 bg-gray-800/30" : "border-gray-700"}`}>
                      {/* Row 1: contract info */}
                      <div className="flex items-center gap-2 text-xs">
                        {optionContract ? (
                          <>
                            <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${isCall ? "bg-green-900/60 text-green-300" : "bg-red-900/60 text-red-300"}`}>
                              {isCall ? "CALL" : "PUT"}
                            </span>
                            <span className="text-gray-200 font-mono">{optionContract.strike}</span>
                            <span className="text-gray-500">{optionContract.expiry}</span>
                          </>
                        ) : (
                          <span className="text-gray-400">Option</span>
                        )}
                        <span className="text-gray-400">x{pos.quantity}</span>
                        <span className="text-gray-600 ml-auto">{new Date(pos.fill_time * 1000).toLocaleTimeString()}</span>
                        {isCompleted && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-600 text-gray-200">CLOSED</span>
                        )}
                        {!isCompleted && strategyId && (
                          <button
                            onClick={() => handleClosePosition(strategyId, posLabel)}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/40 text-red-400 hover:bg-red-900/70 transition-colors"
                            title="Mark position as manually closed"
                          >
                            Close
                          </button>
                        )}
                      </div>
                      {/* Row 2: prices + P&L */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-400">Entry <span className="text-gray-200 font-mono">${pos.entry_price.toFixed(2)}</span></span>
                        {quote ? (
                          <>
                            <span className={`text-gray-400 ${staleQuote ? "opacity-50" : ""}`}>
                              Bid/Ask <span className="text-gray-300 font-mono">{quote.bid.toFixed(2)}/{quote.ask.toFixed(2)}</span>
                            </span>
                            <span className={`text-gray-400 ${staleQuote ? "opacity-50" : ""}`}>
                              Mid <span className="text-gray-200 font-mono">{quote.mid.toFixed(2)}</span>
                            </span>
                          </>
                        ) : rm ? (
                          <span className="text-gray-600 italic">Waiting for quote...</span>
                        ) : null}
                        {pnlPct !== null && pnlDollar !== null && (
                          <span className={`ml-auto font-mono font-medium ${staleQuote ? "opacity-50" : ""} ${pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}% ({pnlDollar >= 0 ? "+$" : "-$"}{Math.abs(pnlDollar).toFixed(0)})
                          </span>
                        )}
                      </div>
                      {/* Row 3: risk manager state */}
                      {rm && (
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {Object.entries(rm.level_states || {}).map(([key, state]) => (
                            <span
                              key={key}
                              className={`px-1.5 py-0.5 rounded font-mono ${
                                state === "FILLED" ? "bg-green-900 text-green-300" :
                                state === "TRIGGERED" ? "bg-yellow-900 text-yellow-300" :
                                state === "PARTIAL" ? "bg-blue-900 text-blue-300" :
                                state === "FAILED" ? "bg-red-900 text-red-300" :
                                "bg-gray-700 text-gray-300"
                              }`}
                            >
                              {key}: {state}
                            </span>
                          ))}
                          {rm.trailing_active && (
                            <span className="text-yellow-300 font-mono">
                              trail@{rm.trailing_stop_price.toFixed(2)}
                            </span>
                          )}
                          <span className="text-gray-600 ml-auto">{rm.remaining_qty}/{rm.initial_qty} remaining</span>
                        </div>
                      )}
                      {/* Row 4: errors */}
                      {recentErrors.length > 0 && (
                        <div className="text-xs text-red-400 mt-0.5 truncate" title={recentErrors[recentErrors.length - 1]}>
                          {recentErrors[recentErrors.length - 1]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Trade Log ── */}
          {allFills.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Trade Log ({allFills.length})</h3>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Contract</th>
                      <th className="text-left py-1">Type</th>
                      <th className="text-left py-1">Model</th>
                      <th className="text-right py-1">Qty</th>
                      <th className="text-right py-1">Price</th>
                      <th className="text-right py-1">P&L%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFills.map((f, i) => {
                      const typeColor =
                        f.level === "entry" ? "text-blue-400" :
                        f.level.startsWith("profit") ? "text-green-400" :
                        f.level === "trailing" ? "text-yellow-400" :
                        f.level.startsWith("stop") ? "text-red-400" :
                        f.level === "expired_worthless" ? "text-red-500" :
                        "text-gray-400";
                      const inst = f.instrument;
                      const contractLabel = inst
                        ? `${inst.symbol ?? ""}${inst.strike ? ` ${inst.strike}` : ""}${inst.right ? inst.right[0] : ""}`
                        : "";
                      const closedRow = f.positionStatus === "closed" ? " opacity-60" : "";
                      return (
                        <tr key={i} className={`border-t border-gray-800${closedRow}`}>
                          <td className="py-1 text-gray-500">{new Date(f.time * 1000).toLocaleTimeString()}</td>
                          <td className="py-1 text-gray-400 font-mono">{contractLabel}</td>
                          <td className={`py-1 ${typeColor}`}>{f.level}</td>
                          <td className="py-1 text-gray-500 font-mono truncate max-w-[80px]" title={f.modelVersion}>{f.modelVersion ? f.modelVersion.slice(-8) : "—"}</td>
                          <td className="py-1 text-right text-gray-300">{f.qty_filled}</td>
                          <td className="py-1 text-right text-gray-300 font-mono">${f.avg_price.toFixed(2)}</td>
                          <td className={`py-1 text-right font-mono ${f.pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {f.level === "entry" ? "—" : `${f.pnl_pct >= 0 ? "+" : ""}${f.pnl_pct.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Session Summary ── */}
          {((executionStatus?.position_ledger?.length ?? 0) > 0 || (signal?.positions_spawned ?? 0) > 0) && (
            <div className="bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 flex items-center gap-2">
              <span>{sessionSummary.activeCount} active, {sessionSummary.completedCount} closed{sessionSummary.expired > 0 ? ` (${sessionSummary.expired} expired)` : ""}</span>
              {sessionSummary.completedCount > 0 && (
                <>
                  <span className="text-gray-600">|</span>
                  <span>Exits: <span className="text-green-400">{sessionSummary.wins}W</span>/<span className="text-red-400">{sessionSummary.losses}L</span></span>
                </>
              )}
              {(sessionSummary.totalPnl !== 0 || sessionSummary.unrealizedPnl !== 0) && (
                <>
                  <span className="text-gray-600">|</span>
                  {sessionSummary.totalPnl !== 0 && (
                    <span className={sessionSummary.totalPnl >= 0 ? "text-green-400" : "text-red-400"}>
                      Gross {sessionSummary.totalPnl >= 0 ? "+" : ""}${sessionSummary.totalPnl.toFixed(0)}
                    </span>
                  )}
                  {sessionSummary.totalCommission > 0 && (
                    <span className="text-gray-500">
                      Comm -${sessionSummary.totalCommission.toFixed(2)}
                    </span>
                  )}
                  {sessionSummary.totalPnl !== 0 && sessionSummary.totalCommission > 0 && (
                    <span className={sessionSummary.netPnl >= 0 ? "text-green-400" : "text-red-400"}>
                      Net {sessionSummary.netPnl >= 0 ? "+" : ""}${sessionSummary.netPnl.toFixed(0)}
                    </span>
                  )}
                  {sessionSummary.unrealizedPnl !== 0 && (
                    <span className={`${sessionSummary.unrealizedPnl >= 0 ? "text-blue-400" : "text-orange-400"}`}>
                      Unreal {sessionSummary.unrealizedPnl >= 0 ? "+" : ""}${sessionSummary.unrealizedPnl.toFixed(0)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── IB Execution P&L ── */}
          <div className="bg-gray-900 border border-gray-800 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-300">IB Execution P&L</h3>
              <button
                onClick={fetchIbPnl}
                disabled={ibPnlLoading}
                className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-50"
              >
                {ibPnlLoading ? "Loading..." : ibPnl ? "Refresh" : "Fetch from IB"}
              </button>
            </div>
            {ibPnl ? (
              <>
                {/* Summary bar */}
                <div className="text-xs text-gray-400 flex items-center gap-2 mb-2">
                  <span>{ibPnl.executions_count} fills</span>
                  <span className="text-gray-600">|</span>
                  <span>{ibPnl.summary.closed_count} closed, {ibPnl.summary.open_count} open</span>
                  {ibPnl.summary.closed_count > 0 && (
                    <>
                      <span className="text-gray-600">|</span>
                      <span><span className="text-green-400">{ibPnl.summary.wins}W</span>/<span className="text-red-400">{ibPnl.summary.losses}L</span></span>
                    </>
                  )}
                  <span className="text-gray-600">|</span>
                  <span className={ibPnl.summary.total_gross_pnl >= 0 ? "text-green-400" : "text-red-400"}>
                    Gross {ibPnl.summary.total_gross_pnl >= 0 ? "+" : ""}${ibPnl.summary.total_gross_pnl.toFixed(2)}
                  </span>
                  {ibPnl.summary.total_commission > 0 && (
                    <span className="text-gray-500">
                      Comm -${ibPnl.summary.total_commission.toFixed(2)}
                    </span>
                  )}
                  <span className={`font-medium ${ibPnl.summary.total_net_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    Net {ibPnl.summary.total_net_pnl >= 0 ? "+" : ""}${ibPnl.summary.total_net_pnl.toFixed(2)}
                  </span>
                </div>
                {/* Trades table */}
                {ibPnl.trades.length > 0 && (
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500">
                          <th className="text-left py-1">Contract</th>
                          <th className="text-right py-1">Buy</th>
                          <th className="text-right py-1">Sell</th>
                          <th className="text-right py-1">Avg In</th>
                          <th className="text-right py-1">Avg Out</th>
                          <th className="text-right py-1">Gross</th>
                          <th className="text-right py-1">Comm</th>
                          <th className="text-right py-1">Net</th>
                          <th className="text-left py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ibPnl.trades.map((t, i) => (
                          <tr key={i} className={`border-t border-gray-800 ${t.status === "closed" ? "opacity-70" : ""}`}>
                            <td className="py-1 text-gray-300 font-mono">{t.contract_label}</td>
                            <td className="py-1 text-right text-gray-400">{t.buy_qty}</td>
                            <td className="py-1 text-right text-gray-400">{t.sell_qty}</td>
                            <td className="py-1 text-right text-gray-300 font-mono">${t.avg_buy.toFixed(2)}</td>
                            <td className="py-1 text-right text-gray-300 font-mono">{t.avg_sell != null ? `$${t.avg_sell.toFixed(2)}` : "—"}</td>
                            <td className={`py-1 text-right font-mono ${(t.gross_pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {t.gross_pnl != null ? `${t.gross_pnl >= 0 ? "+" : ""}$${t.gross_pnl.toFixed(2)}` : "—"}
                            </td>
                            <td className="py-1 text-right text-gray-500 font-mono">{t.total_commission > 0 ? `-$${t.total_commission.toFixed(2)}` : "—"}</td>
                            <td className={`py-1 text-right font-mono ${(t.net_pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {t.net_pnl != null ? `${t.net_pnl >= 0 ? "+" : ""}$${t.net_pnl.toFixed(2)}` : "—"}
                            </td>
                            <td className="py-1 text-gray-500">{t.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-600 text-xs">Click &ldquo;Fetch from IB&rdquo; to load execution data from IB TWS</div>
            )}
          </div>

          {/* ── Signal History ── */}
          <div className="bg-gray-900 border border-gray-800 rounded p-3">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Signal History</h3>
            {signal?.signal_history && signal.signal_history.length > 0 ? (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Dir</th>
                      <th className="text-right py-1">Prob</th>
                      <th className="text-right py-1">Strength</th>
                      <th className="text-left py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...signal.signal_history].reverse().map((h, i) => {
                      const hColor = h.direction === "long" ? "text-green-400"
                        : h.direction === "short" ? "text-red-400"
                        : "text-gray-500";
                      return (
                        <tr key={i} className="border-t border-gray-800">
                          <td className="py-1 text-gray-500">{h.timestamp}</td>
                          <td className={`py-1 ${hColor}`}>{h.direction}</td>
                          <td className="py-1 text-right text-gray-300">{h.probability.toFixed(4)}</td>
                          <td className="py-1 text-right text-gray-400">{h.strength.toFixed(3)}</td>
                          <td className="py-1 text-gray-500">{h.suppressed || "fired"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-gray-600 text-sm">No signals yet</div>
            )}
          </div>
        </div>

        {/* ── Config Panel ── */}
        <div className="space-y-2">
          {executionStatus?.running && (
            <OrderBudgetControl
              orderBudget={executionStatus.order_budget ?? 0}
              totalAlgoOrders={executionStatus.total_algo_orders ?? 0}
              isRunning={true}
              onSetBudget={handleSetBudget}
            />
          )}
          <div className="bg-gray-900 border border-gray-800 rounded p-2.5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <span className="bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded text-xs font-bold">{activeTicker}</span>
                Config
              </h3>
              {!running ? (
                <button
                  onClick={handleStart}
                  disabled={loading || enabledTickers.length === 0}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded"
                >
                  {loading ? "Starting..." : `Start ${enabledTickers.length > 1 ? enabledTickers.join("+") : enabledTickers[0] || ""}`}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  {activeConfigDirty && runningTickers.includes(activeTicker) && (
                    <button
                      onClick={() => handleConfigUpdate(activeTicker)}
                      disabled={loading}
                      className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-xs font-medium rounded"
                    >
                      {loading ? "Applying..." : "Apply"}
                    </button>
                  )}
                  {!runningTickers.includes(activeTicker) && (
                    <span className="text-xs text-gray-500 italic">not started</span>
                  )}
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded"
                  >
                    Stop
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <ConfigField
                label="Signal Threshold"
                value={activeConfig.signal_threshold}
                onChange={v => updateConfig(activeTicker, "signal_threshold", parseFloat(v))}
                type="number"
                step="0.05"
              />
              <ConfigField
                label="Min Strength"
                value={activeConfig.min_signal_strength}
                onChange={v => updateConfig(activeTicker, "min_signal_strength", parseFloat(v))}
                type="number"
                step="0.05"
              />
              <ConfigField
                label="Cooldown (min)"
                value={activeConfig.cooldown_minutes}
                onChange={v => updateConfig(activeTicker, "cooldown_minutes", parseInt(v, 10))}
                type="number"
              />
              <ConfigField
                label="Interval (sec)"
                value={activeConfig.decision_interval_seconds}
                onChange={v => updateConfig(activeTicker, "decision_interval_seconds", parseInt(v, 10))}
                type="number"
              />
              <ConfigField
                label="Max Contracts"
                value={activeConfig.max_contracts}
                onChange={v => updateConfig(activeTicker, "max_contracts", parseInt(v, 10))}
                type="number"
              />
              <ConfigField
                label="Budget ($)"
                value={activeConfig.contract_budget_usd}
                onChange={v => updateConfig(activeTicker, "contract_budget_usd", parseFloat(v))}
                type="number"
              />
              <ConfigField
                label="Scan Start"
                value={activeConfig.scan_start}
                onChange={v => updateConfig(activeTicker, "scan_start", v)}
              />
              <ConfigField
                label="Scan End"
                value={activeConfig.scan_end}
                onChange={v => updateConfig(activeTicker, "scan_end", v)}
              />

              {/* Option Selection */}
              <div className="col-span-2 border-t border-gray-800 pt-1.5 mt-1">
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">Option Selection</span>
              </div>
              <div className="col-span-2 flex items-center justify-between py-0.5">
                <label className="text-gray-400">Preferred DTE</label>
                <input
                  type="text"
                  value={activeConfig.preferred_dte.join(",")}
                  onChange={e => {
                    const parsed = e.target.value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                    updateConfig(activeTicker, "preferred_dte", parsed);
                  }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-right text-gray-200 text-xs inline-edit"
                  title="Comma-separated DTE values (e.g. 0,1 or 0,1,2,3,4,5)"
                />
              </div>
              <ConfigField
                label="Max Spread ($)"
                value={activeConfig.max_spread}
                onChange={v => updateConfig(activeTicker, "max_spread", parseFloat(v))}
                type="number"
                step="0.01"
              />
              <ConfigField
                label="Premium Min ($)"
                value={activeConfig.premium_min}
                onChange={v => updateConfig(activeTicker, "premium_min", parseFloat(v))}
                type="number"
                step="0.01"
              />
              <ConfigField
                label="Premium Max ($)"
                value={activeConfig.premium_max}
                onChange={v => updateConfig(activeTicker, "premium_max", parseFloat(v))}
                type="number"
                step="0.1"
              />
              <ConfigField
                label="Straddle Rich Max"
                value={activeConfig.straddle_richness_max}
                onChange={v => updateConfig(activeTicker, "straddle_richness_max", parseFloat(v))}
                type="number"
                step="0.1"
              />
              <ConfigField
                label="Straddle Rich Ideal"
                value={activeConfig.straddle_richness_ideal}
                onChange={v => updateConfig(activeTicker, "straddle_richness_ideal", parseFloat(v))}
                type="number"
                step="0.1"
              />

              {/* Signal Gating + General (no section headers, just a divider) */}
              <div className="col-span-2 border-t border-gray-800 mt-1" />
              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Opt Gate</label>
                <button
                  onClick={() => updateConfig(activeTicker, "options_gate_enabled", !activeConfig.options_gate_enabled)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.options_gate_enabled
                      ? "bg-purple-900/50 text-purple-400 border border-purple-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {activeConfig.options_gate_enabled ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Direction</label>
                <select
                  value={activeConfig.direction_mode}
                  onChange={e => updateConfig(activeTicker, "direction_mode", e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 text-xs inline-edit"
                >
                  <option value="both">Both</option>
                  <option value="long_only">Long Only</option>
                  <option value="short_only">Short Only</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Auto Entry</label>
                <button
                  onClick={() => updateConfig(activeTicker, "auto_entry", !activeConfig.auto_entry)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.auto_entry
                      ? "bg-green-900/50 text-green-400 border border-green-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {activeConfig.auto_entry ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Delayed</label>
                <button
                  onClick={() => updateConfig(activeTicker, "use_delayed_data", !activeConfig.use_delayed_data)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.use_delayed_data
                      ? "bg-yellow-900/50 text-yellow-400 border border-yellow-700"
                      : "bg-blue-900/50 text-blue-400 border border-blue-700"
                  }`}
                >
                  {activeConfig.use_delayed_data ? "15m delay" : "LIVE"}
                </button>
              </div>

              {/* ── Risk Management ── */}
              <div className="col-span-2 border-t border-gray-800 mt-1" />
              <div className="col-span-2 flex items-center justify-between py-0.5">
                <label className="text-gray-400 text-xs font-medium">Risk Preset</label>
                <select
                  value={activeConfig.risk_preset}
                  onChange={e => applyRiskPreset(activeTicker, e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 text-xs inline-edit"
                >
                  {RISK_PRESET_NAMES.map(p => (
                    <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Trailing</label>
                <button
                  onClick={() => updateConfig(activeTicker, "risk_trailing_enabled", !activeConfig.risk_trailing_enabled)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.risk_trailing_enabled
                      ? "bg-green-900/50 text-green-400 border border-green-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {activeConfig.risk_trailing_enabled ? "ON" : "OFF"}
                </button>
              </div>
              {activeConfig.risk_trailing_enabled && (
                <>
                  <ConfigField
                    label="Activation %"
                    value={activeConfig.risk_trailing_activation_pct}
                    onChange={v => updateConfig(activeTicker, "risk_trailing_activation_pct", parseFloat(v))}
                    type="number"
                    step="1"
                  />
                  <ConfigField
                    label="Trail %"
                    value={activeConfig.risk_trailing_trail_pct}
                    onChange={v => updateConfig(activeTicker, "risk_trailing_trail_pct", parseFloat(v))}
                    type="number"
                    step="1"
                  />
                </>
              )}

              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Stop Loss</label>
                <button
                  onClick={() => updateConfig(activeTicker, "risk_stop_loss_enabled", !activeConfig.risk_stop_loss_enabled)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.risk_stop_loss_enabled
                      ? "bg-red-900/50 text-red-400 border border-red-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {activeConfig.risk_stop_loss_enabled ? "ON" : "OFF"}
                </button>
              </div>
              {activeConfig.risk_stop_loss_enabled && (
                <>
                  <div className="flex items-center justify-between py-0.5">
                    <label className="text-gray-400">Type</label>
                    <select
                      value={activeConfig.risk_stop_loss_type}
                      onChange={e => updateConfig(activeTicker, "risk_stop_loss_type", e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 text-xs inline-edit"
                    >
                      <option value="simple">Simple</option>
                      <option value="laddered">Laddered</option>
                    </select>
                  </div>
                  {activeConfig.risk_stop_loss_type === "simple" && (
                    <ConfigField
                      label="Trigger %"
                      value={activeConfig.risk_stop_loss_trigger_pct}
                      onChange={v => updateConfig(activeTicker, "risk_stop_loss_trigger_pct", parseFloat(v))}
                      type="number"
                      step="0.5"
                    />
                  )}
                </>
              )}

              <div className="flex items-center justify-between py-0.5">
                <label className="text-gray-400">Profit Targets</label>
                <button
                  onClick={() => updateConfig(activeTicker, "risk_profit_targets_enabled", !activeConfig.risk_profit_targets_enabled)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    activeConfig.risk_profit_targets_enabled
                      ? "bg-green-900/50 text-green-400 border border-green-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {activeConfig.risk_profit_targets_enabled ? "ON" : "OFF"}
                </button>
              </div>
              {activeConfig.risk_profit_targets_enabled && activeConfig.risk_profit_targets.length > 0 && (
                <div className="col-span-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left py-0.5">Trigger %</th>
                        <th className="text-left py-0.5">Exit %</th>
                        <th className="w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeConfig.risk_profit_targets.map((t, i) => (
                        <tr key={i}>
                          <td className="py-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={t.trigger_pct}
                              onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v)) updateProfitTarget(activeTicker, i, "trigger_pct", v);
                              }}
                              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-right text-gray-200 text-xs inline-edit"
                            />
                          </td>
                          <td className="py-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={t.exit_pct}
                              onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v)) updateProfitTarget(activeTicker, i, "exit_pct", v);
                              }}
                              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-right text-gray-200 text-xs inline-edit"
                            />
                          </td>
                          <td className="py-0.5 text-center">
                            <button
                              onClick={() => removeProfitTarget(activeTicker, i)}
                              className="text-red-500 hover:text-red-400 text-xs px-1"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {activeConfig.risk_profit_targets_enabled && (
                <div className="col-span-2">
                  <button
                    onClick={() => addProfitTarget(activeTicker)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    + Add Target
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Data Store Status ── */}
          {signal?.data_store && (
            <div className="bg-gray-900 border border-gray-800 rounded p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Data Store</h3>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Equity quotes</span>
                  <span className="text-gray-300">{signal.data_store.n_equity_quotes}</span>
                </div>
                <div className="flex justify-between">
                  <span>Daily features</span>
                  <span className={signal.data_store.has_daily_features ? "text-green-400" : "text-gray-600"}>
                    {signal.data_store.has_daily_features ? "loaded" : "missing"}
                  </span>
                </div>
                {signal.data_store.bar_counts && Object.entries(signal.data_store.bar_counts).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="text-gray-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Model Chooser Modal ── */}
      {modelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => { if (!modelSwapping) setModelModalOpen(false); }}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-[700px] max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-medium text-gray-200">
                Available Models {activeTicker && <span className="text-blue-400">({activeTicker})</span>}
              </h3>
              <button
                onClick={() => setModelModalOpen(false)}
                disabled={modelSwapping}
                className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
              >
                &times;
              </button>
            </div>

            {/* Error */}
            {modelError && (
              <div className="mx-4 mt-2 bg-red-900/30 border border-red-800 text-red-300 text-xs px-2 py-1 rounded">
                {modelError}
              </div>
            )}

            {/* Table */}
            <div className="overflow-auto flex-1 px-4 py-2">
              {modelList.length === 0 ? (
                <div className="text-gray-500 text-sm py-4 text-center">No models found in registry</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-1.5 px-1">Version</th>
                      <th className="text-left py-1.5 px-1">Type</th>
                      <th className="text-left py-1.5 px-1">Recipe</th>
                      <th className="text-left py-1.5 px-1">Date</th>
                      <th className="text-left py-1.5 px-1">Status</th>
                      <th className="text-right py-1.5 px-1">AUC</th>
                      <th className="text-right py-1.5 px-1">PF</th>
                      <th className="text-center py-1.5 px-1 w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelList.map(m => (
                      <tr
                        key={m.version_id}
                        className={`border-b border-gray-800/50 ${m.is_current ? "bg-blue-900/20" : "hover:bg-gray-800/50"}`}
                      >
                        <td className="py-1.5 px-1 font-mono text-gray-300" title={m.version_id}>
                          {m.version_id.length > 20 ? m.version_id.slice(0, 20) + "..." : m.version_id}
                        </td>
                        <td className="py-1.5 px-1 text-gray-400">{m.model_type}</td>
                        <td className="py-1.5 px-1 text-gray-400" title={m.recipe_label}>
                          {m.recipe_label ? (m.recipe_label.length > 24 ? m.recipe_label.slice(0, 24) + "..." : m.recipe_label) : "\u2014"}
                        </td>
                        <td className="py-1.5 px-1 text-gray-500">
                          {m.created_at ? m.created_at.slice(0, 10) : "\u2014"}
                        </td>
                        <td className="py-1.5 px-1">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            m.status === "active" ? "bg-green-900/50 text-green-400" :
                            m.status === "candidate" ? "bg-yellow-900/50 text-yellow-400" :
                            "bg-gray-800 text-gray-500"
                          }`}>
                            {m.status || "unknown"}
                          </span>
                        </td>
                        <td className="py-1.5 px-1 text-right text-gray-300 font-mono">
                          {m.metrics?.auc_roc != null ? m.metrics.auc_roc.toFixed(3) : "\u2014"}
                        </td>
                        <td className="py-1.5 px-1 text-right text-gray-300 font-mono">
                          {m.metrics?.profit_factor != null ? m.metrics.profit_factor.toFixed(2) : "\u2014"}
                        </td>
                        <td className="py-1.5 px-1 text-center">
                          {m.is_current ? (
                            <span className="text-[10px] text-blue-400 font-medium">current</span>
                          ) : (
                            <button
                              onClick={() => swapModel(m.version_id)}
                              disabled={modelSwapping}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-900/50 text-blue-300 hover:bg-blue-800/60 border border-blue-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {swappingVersionId === m.version_id ? "Loading..." : modelSwapping ? "..." : "Load"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
              {modelList.length} model{modelList.length !== 1 ? "s" : ""} in registry
              {modelSwapping && <span className="ml-2 text-yellow-500">Swapping model...</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configFromAgent(c: any, ticker: string): BMCConfig {
  const defaults = makeDefaultConfig(ticker);
  return {
    ticker: c.ticker ?? ticker,
    signal_threshold: c.signal_threshold ?? defaults.signal_threshold,
    min_signal_strength: c.min_signal_strength ?? defaults.min_signal_strength,
    cooldown_minutes: c.cooldown_minutes ?? defaults.cooldown_minutes,
    decision_interval_seconds: c.decision_interval_seconds ?? defaults.decision_interval_seconds,
    max_contracts: c.max_contracts ?? defaults.max_contracts,
    contract_budget_usd: c.contract_budget_usd ?? defaults.contract_budget_usd,
    scan_start: c.scan_start ?? defaults.scan_start,
    scan_end: c.scan_end ?? defaults.scan_end,
    auto_entry: c.auto_entry ?? defaults.auto_entry,
    direction_mode: c.direction_mode ?? defaults.direction_mode,
    use_delayed_data: c.use_delayed_data ?? defaults.use_delayed_data,
    preferred_dte: c.preferred_dte ?? defaults.preferred_dte,
    max_spread: c.max_spread ?? defaults.max_spread,
    premium_min: c.premium_min ?? defaults.premium_min,
    premium_max: c.premium_max ?? defaults.premium_max,
    straddle_richness_max: c.straddle_richness_max ?? defaults.straddle_richness_max,
    straddle_richness_ideal: c.straddle_richness_ideal ?? defaults.straddle_richness_ideal,
    options_gate_enabled: c.options_gate_enabled ?? defaults.options_gate_enabled,
    risk_preset: c.risk_preset ?? defaults.risk_preset,
    risk_stop_loss_enabled: c.risk_stop_loss_enabled ?? defaults.risk_stop_loss_enabled,
    risk_stop_loss_type: c.risk_stop_loss_type ?? defaults.risk_stop_loss_type,
    risk_stop_loss_trigger_pct: c.risk_stop_loss_trigger_pct ?? defaults.risk_stop_loss_trigger_pct,
    risk_trailing_enabled: c.risk_trailing_enabled ?? defaults.risk_trailing_enabled,
    risk_trailing_activation_pct: c.risk_trailing_activation_pct ?? defaults.risk_trailing_activation_pct,
    risk_trailing_trail_pct: c.risk_trailing_trail_pct ?? defaults.risk_trailing_trail_pct,
    risk_profit_targets_enabled: c.risk_profit_targets_enabled ?? defaults.risk_profit_targets_enabled,
    risk_profit_targets: c.risk_profit_targets ?? defaults.risk_profit_targets,
  };
}

// ---------------------------------------------------------------------------
// Config field helper
// ---------------------------------------------------------------------------

function ConfigField({
  label,
  value,
  onChange,
  onCommit,
  type = "text",
  step,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  onCommit?: () => void;
  type?: string;
  step?: string;
}) {
  const isNumber = type === "number";
  const [localValue, setLocalValue] = useState(String(value));
  const prevValue = useRef(value);

  if (value !== prevValue.current) {
    prevValue.current = value;
    setLocalValue(String(value));
  }

  if (isNumber) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <label className="text-gray-400">{label}</label>
        <input
          type="text"
          inputMode="decimal"
          value={localValue}
          step={step}
          onChange={e => {
            setLocalValue(e.target.value);
            const parsed = step?.includes(".") || String(value).includes(".")
              ? parseFloat(e.target.value)
              : parseInt(e.target.value, 10);
            if (!isNaN(parsed)) {
              onChange(String(parsed));
            }
          }}
          onBlur={() => {
            const parsed = step?.includes(".") || String(value).includes(".")
              ? parseFloat(localValue)
              : parseInt(localValue, 10);
            if (isNaN(parsed)) {
              setLocalValue(String(value));
            } else {
              setLocalValue(String(parsed));
            }
            onCommit?.();
          }}
          className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-right text-gray-200 text-xs inline-edit"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-1">
      <label className="text-gray-400">{label}</label>
      <input
        type={type}
        value={value}
        step={step}
        onChange={e => onChange(e.target.value)}
        className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-right text-gray-200 text-xs inline-edit"
      />
    </div>
  );
}
