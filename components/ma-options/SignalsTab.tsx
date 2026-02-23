"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
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
};

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
  const [configs, setConfigs] = useState<Record<string, BMCConfig>>({
    SPY: makeDefaultConfig("SPY"),
    SLV: makeDefaultConfig("SLV"),
  });
  const [configDirty, setConfigDirty] = useState<Record<string, boolean>>({});
  const configDirtyRef = useRef<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Currently selected ticker tab for viewing signal details
  const [activeTicker, setActiveTicker] = useState("SPY");

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
            setConfigs(prev => ({
              ...prev,
              [t]: configFromAgent(strat.config, t),
            }));
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
          setConfigs(prev => ({
            ...prev,
            [ticker]: configFromAgent(data.config, ticker),
          }));
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
    setConfigs(prev => ({
      ...prev,
      [ticker]: { ...(prev[ticker] || makeDefaultConfig(ticker)), [key]: value },
    }));
    setConfigDirty(prev => ({ ...prev, [ticker]: true }));
    configDirtyRef.current[ticker] = true;
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
        {!running ? (
          // Before start: checkboxes to enable/disable, click to select for config viewing
          <>
            <span className="text-xs text-gray-500 mr-1">Tickers:</span>
            {AVAILABLE_TICKERS.map(t => {
              const isActive = activeTicker === t;
              const isEnabled = enabledTickers.includes(t);
              return (
                <div key={t} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => toggleTicker(t)}
                    className="w-3 h-3 accent-blue-600 cursor-pointer inline-edit"
                  />
                  <button
                    onClick={() => setActiveTicker(t)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : isEnabled
                          ? "bg-blue-900/30 text-blue-400 hover:bg-blue-900/50"
                          : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t}
                  </button>
                </div>
              );
            })}
          </>
        ) : (
          // While running: show ticker tabs for running strategies
          <>
            {runningTickers.map(t => (
              <button
                key={t}
                onClick={() => setActiveTicker(t)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  activeTicker === t
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                {t}
              </button>
            ))}
          </>
        )}
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

      {signal?.startup_error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-3 py-1.5 rounded">
          Startup error: {signal.startup_error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {/* ── Signal Panel ── */}
        <div className="col-span-2 space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded p-3">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Current Signal {activeTicker && <span className="text-blue-400">({activeTicker})</span>}
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
                {running ? "Waiting for first decision cycle..." : "Strategy not running"}
              </div>
            )}
          </div>

          {/* ── Active Positions ── */}
          {signal?.active_positions && signal.active_positions.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">
                Active Positions ({signal.active_positions.length})
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left py-1">Order</th>
                    <th className="text-right py-1">Entry</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Fill Time</th>
                  </tr>
                </thead>
                <tbody>
                  {signal.active_positions.map((pos, i) => (
                    <tr key={i} className="text-gray-300 border-t border-gray-800">
                      <td className="py-1">{pos.order_id}</td>
                      <td className="text-right py-1">${pos.entry_price.toFixed(2)}</td>
                      <td className="text-right py-1">{pos.quantity}</td>
                      <td className="text-right py-1 text-gray-500">
                        {new Date(pos.fill_time * 1000).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
        <div className="space-y-3">
          <div className="bg-gray-900 border border-gray-800 rounded p-3">
            <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <span className="bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded text-xs font-bold">{activeTicker}</span>
              Configuration
            </h3>
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
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="bg-gray-900 border border-gray-800 rounded p-3 space-y-2">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Actions</h3>
            {!running ? (
              <button
                onClick={handleStart}
                disabled={loading || enabledTickers.length === 0}
                className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded"
              >
                {loading ? "Starting..." : `Start ${enabledTickers.length > 1 ? enabledTickers.join(" + ") : enabledTickers[0] || "Strategy"}`}
              </button>
            ) : (
              <>
                {activeConfigDirty && (
                  <button
                    onClick={() => handleConfigUpdate(activeTicker)}
                    disabled={loading}
                    className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded"
                  >
                    {loading ? "Applying..." : `Apply ${activeTicker} Config`}
                  </button>
                )}
              </>
            )}
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
