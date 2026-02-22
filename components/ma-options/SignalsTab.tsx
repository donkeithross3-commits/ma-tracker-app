"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalState {
  type: string;
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

interface BMCConfig {
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
}

const DEFAULT_CONFIG: BMCConfig = {
  signal_threshold: 0.5,
  min_signal_strength: 0.3,
  cooldown_minutes: 15,
  decision_interval_seconds: 300,
  max_contracts: 5,
  contract_budget_usd: 150,
  scan_start: "13:30",
  scan_end: "15:55",
  auto_entry: false,
  direction_mode: "both",
  use_delayed_data: true,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignalsTab() {
  const [signal, setSignal] = useState<SignalState | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<BMCConfig>({ ...DEFAULT_CONFIG });
  const [configDirty, setConfigDirty] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll signal state ──
  const fetchSignal = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/bmc-signal", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setRunning(data.running ?? false);
      if (data.signal) {
        setSignal(data.signal);
      }
      setError(null);
    } catch {
      // silent — poll will retry
    }
  }, []);

  useEffect(() => {
    fetchSignal();
    pollRef.current = setInterval(fetchSignal, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchSignal]);

  // ── Start BMC ──
  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ma-options/bmc-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
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

  // ── Update config ──
  const handleConfigUpdate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ma-options/bmc-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setConfigDirty(false);
        setError(null);
      }
    } catch (e: any) {
      setError(e.message || "Failed to update config");
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (key: keyof BMCConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setConfigDirty(true);
  };

  // ── Derived values ──
  const ws = signal?.polygon_ws;
  const bars = signal?.bar_accumulator;
  const currentSig = signal?.current_signal;
  const directionColor = currentSig?.direction === "long" ? "text-green-400"
    : currentSig?.direction === "short" ? "text-red-400"
    : "text-gray-500";

  return (
    <div className="space-y-3">
      {/* ── Status Bar ── */}
      <div className="flex items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-gray-600"}`} />
          <span className="text-gray-400">{running ? "Running" : "Stopped"}</span>
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
            <h3 className="text-sm font-medium text-gray-300 mb-2">Current Signal</h3>
            {currentSig ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className={`text-2xl font-bold ${directionColor}`}>
                    {currentSig.direction === "none" ? "—" : currentSig.direction.toUpperCase()}
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
                    <span>SPY ${currentSig.underlying_price.toFixed(2)}</span>
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
                {/* Bars available */}
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
            <h3 className="text-sm font-medium text-gray-300 mb-2">Configuration</h3>
            <div className="space-y-2 text-xs">
              <ConfigField
                label="Signal Threshold"
                value={config.signal_threshold}
                onChange={v => updateConfig("signal_threshold", parseFloat(v) || 0.5)}
                type="number"
                step="0.05"
              />
              <ConfigField
                label="Min Strength"
                value={config.min_signal_strength}
                onChange={v => updateConfig("min_signal_strength", parseFloat(v) || 0.3)}
                type="number"
                step="0.05"
              />
              <ConfigField
                label="Cooldown (min)"
                value={config.cooldown_minutes}
                onChange={v => updateConfig("cooldown_minutes", parseInt(v) || 15)}
                type="number"
              />
              <ConfigField
                label="Interval (sec)"
                value={config.decision_interval_seconds}
                onChange={v => updateConfig("decision_interval_seconds", parseInt(v) || 300)}
                type="number"
              />
              <ConfigField
                label="Max Contracts"
                value={config.max_contracts}
                onChange={v => updateConfig("max_contracts", parseInt(v) || 5)}
                type="number"
              />
              <ConfigField
                label="Budget ($)"
                value={config.contract_budget_usd}
                onChange={v => updateConfig("contract_budget_usd", parseFloat(v) || 150)}
                type="number"
              />
              <ConfigField
                label="Scan Start"
                value={config.scan_start}
                onChange={v => updateConfig("scan_start", v)}
              />
              <ConfigField
                label="Scan End"
                value={config.scan_end}
                onChange={v => updateConfig("scan_end", v)}
              />

              <div className="flex items-center justify-between py-1">
                <label className="text-gray-400">Direction</label>
                <select
                  value={config.direction_mode}
                  onChange={e => updateConfig("direction_mode", e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 text-xs inline-edit"
                >
                  <option value="both">Both</option>
                  <option value="long_only">Long Only</option>
                </select>
              </div>

              <div className="flex items-center justify-between py-1">
                <label className="text-gray-400">Auto Entry</label>
                <button
                  onClick={() => updateConfig("auto_entry", !config.auto_entry)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    config.auto_entry
                      ? "bg-green-900/50 text-green-400 border border-green-700"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {config.auto_entry ? "ON" : "OFF"}
                </button>
              </div>

              <div className="flex items-center justify-between py-1">
                <label className="text-gray-400">Delayed Data</label>
                <button
                  onClick={() => updateConfig("use_delayed_data", !config.use_delayed_data)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    config.use_delayed_data
                      ? "bg-yellow-900/50 text-yellow-400 border border-yellow-700"
                      : "bg-blue-900/50 text-blue-400 border border-blue-700"
                  }`}
                >
                  {config.use_delayed_data ? "15min delay" : "LIVE"}
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
                disabled={loading}
                className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded"
              >
                {loading ? "Starting..." : "Start Strategy"}
              </button>
            ) : (
              <>
                {configDirty && (
                  <button
                    onClick={handleConfigUpdate}
                    disabled={loading}
                    className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded"
                  >
                    {loading ? "Applying..." : "Apply Config"}
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
// Config field helper
// ---------------------------------------------------------------------------

function ConfigField({
  label,
  value,
  onChange,
  type = "text",
  step,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
}) {
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
