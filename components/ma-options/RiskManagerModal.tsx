"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ─── Types ─── */

interface StopLadder {
  trigger_pct: number;
  exit_pct: number;
}

interface ProfitTarget {
  trigger_pct: number;
  exit_pct: number;
}

interface RiskManagerConfig {
  instrument: {
    symbol: string;
    secType: string;
    expiry?: string;
    strike?: number;
    right?: string;
    exchange: string;
    currency: string;
    multiplier?: string;
  };
  position: {
    side: "LONG" | "SHORT";
    quantity: number;
    entry_price: number;
  };
  stop_loss: {
    enabled: boolean;
    type: "simple" | "laddered" | "none";
    trigger_pct: number;
    ladders: StopLadder[];
  };
  profit_taking: {
    enabled: boolean;
    targets: ProfitTarget[];
    trailing_stop: {
      enabled: boolean;
      activation_pct: number;
      trail_pct: number;
    };
  };
  execution: {
    stop_order_type: string;
    profit_order_type: string;
    limit_offset_ticks: number;
  };
}

interface StrategyState {
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
  pending_orders: Record<string, { level: string; expected_qty: number; filled_so_far: number }>;
  fill_log: Array<{
    time: number;
    order_id: number;
    level: string;
    qty_filled: number;
    avg_price: number;
    remaining_qty: number;
    pnl_pct: number;
  }>;
}

interface PositionInfo {
  symbol: string;
  secType: string;
  position: number;
  avgCost: number;
  lastPrice?: number;
  contract?: Record<string, unknown>;
}

interface RiskManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: PositionInfo;
  executionStatus?: {
    running: boolean;
    strategies?: Array<{
      strategy_id: string;
      is_active: boolean;
      strategy_state?: StrategyState;
      config?: RiskManagerConfig;
    }>;
    order_budget?: number;
    total_algo_orders?: number;
  };
  onStart: (config: RiskManagerConfig) => Promise<void>;
  onStop: () => Promise<void>;
}

/* ─── Presets ─── */

const PRESETS: Record<string, { label: string; description: string; config: Partial<RiskManagerConfig> }> = {
  zero_dte_lotto: {
    label: "0DTE Lotto",
    description: "No stop loss, aggressive profit taking at 2x/4x/6x/11x",
    config: {
      stop_loss: { enabled: false, type: "none", trigger_pct: 0, ladders: [] },
      profit_taking: {
        enabled: true,
        targets: [
          { trigger_pct: 100, exit_pct: 20 },
          { trigger_pct: 300, exit_pct: 25 },
          { trigger_pct: 500, exit_pct: 25 },
          { trigger_pct: 1000, exit_pct: 50 },
        ],
        trailing_stop: { enabled: true, activation_pct: 50, trail_pct: 25 },
      },
      execution: { stop_order_type: "MKT", profit_order_type: "MKT", limit_offset_ticks: 0 },
    },
  },
  stock_swing: {
    label: "Stock Swing",
    description: "Simple -5% stop, take 50% at +10%, 3% trailing stop",
    config: {
      stop_loss: { enabled: true, type: "simple", trigger_pct: -5, ladders: [] },
      profit_taking: {
        enabled: true,
        targets: [{ trigger_pct: 10, exit_pct: 50 }],
        trailing_stop: { enabled: true, activation_pct: 5, trail_pct: 3 },
      },
      execution: { stop_order_type: "MKT", profit_order_type: "LMT", limit_offset_ticks: 1 },
    },
  },
  conservative: {
    label: "Conservative",
    description: "Laddered stops at -2%/-4%/-6%, take profits at +5%/+10%",
    config: {
      stop_loss: {
        enabled: true, type: "laddered", trigger_pct: 0,
        ladders: [
          { trigger_pct: -2, exit_pct: 33 },
          { trigger_pct: -4, exit_pct: 50 },
          { trigger_pct: -6, exit_pct: 100 },
        ],
      },
      profit_taking: {
        enabled: true,
        targets: [
          { trigger_pct: 5, exit_pct: 50 },
          { trigger_pct: 10, exit_pct: 100 },
        ],
        trailing_stop: { enabled: false, activation_pct: 0, trail_pct: 0 },
      },
      execution: { stop_order_type: "MKT", profit_order_type: "LMT", limit_offset_ticks: 1 },
    },
  },
};

function defaultConfig(pos: PositionInfo): RiskManagerConfig {
  return {
    instrument: {
      symbol: pos.symbol,
      secType: pos.secType || "STK",
      exchange: "SMART",
      currency: "USD",
      ...(pos.contract as Record<string, unknown> || {}),
    },
    position: {
      side: pos.position >= 0 ? "LONG" : "SHORT",
      quantity: Math.abs(pos.position),
      entry_price: pos.avgCost || 0,
    },
    stop_loss: { enabled: true, type: "simple", trigger_pct: -5, ladders: [] },
    profit_taking: {
      enabled: true,
      targets: [{ trigger_pct: 10, exit_pct: 50 }],
      trailing_stop: { enabled: false, activation_pct: 0, trail_pct: 0 },
    },
    execution: { stop_order_type: "MKT", profit_order_type: "LMT", limit_offset_ticks: 1 },
  };
}

/* ─── Component ─── */

export function RiskManagerModal({
  isOpen,
  onClose,
  position,
  executionStatus,
  onStart,
  onStop,
}: RiskManagerModalProps) {
  const [config, setConfig] = useState<RiskManagerConfig>(() => defaultConfig(position));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Find active strategy for this position
  const activeStrategy = useMemo(() => {
    if (!executionStatus?.strategies) return null;
    const stratId = `risk_${position.symbol}_${Math.abs(position.position)}`;
    return executionStatus.strategies.find(
      (s) => s.strategy_id === stratId || s.strategy_state?.cache_key?.startsWith(position.symbol)
    );
  }, [executionStatus, position]);

  const isRunning = !!activeStrategy?.is_active;
  const stratState = activeStrategy?.strategy_state;

  // Reset config when position changes
  useEffect(() => {
    if (!isRunning) {
      setConfig(defaultConfig(position));
      setActivePreset(null);
    }
  }, [position.symbol, position.position, isRunning]);

  const applyPreset = useCallback((presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    setConfig((prev) => ({
      ...prev,
      stop_loss: preset.config.stop_loss || prev.stop_loss,
      profit_taking: preset.config.profit_taking || prev.profit_taking,
      execution: preset.config.execution || prev.execution,
    }));
    setActivePreset(presetKey);
  }, []);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await onStart(config);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }, [config, onStart]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await onStop();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setLoading(false);
    }
  }, [onStop]);

  if (!isOpen) return null;

  const pnlPct = position.lastPrice && config.position.entry_price > 0
    ? ((position.lastPrice - config.position.entry_price) / config.position.entry_price * 100 * (config.position.side === "LONG" ? 1 : -1))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
              <span className="text-yellow-400">&#9881;</span>
              Risk Manager: {position.symbol}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {config.position.side} {Math.abs(position.position)} @ {config.position.entry_price.toFixed(2)}
              {pnlPct !== null && (
                <span className={pnlPct >= 0 ? "text-green-400 ml-2" : "text-red-400 ml-2"}>
                  {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* ── Live Status (when running) ── */}
          {isRunning && stratState && (
            <div className="bg-gray-800 border border-gray-600 rounded p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="font-semibold text-green-400">RUNNING</span>
                <span className="text-gray-400 ml-auto">
                  {stratState.remaining_qty} / {stratState.initial_qty} remaining
                </span>
              </div>
              {/* Level states */}
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stratState.level_states || {}).map(([key, state]) => (
                  <span
                    key={key}
                    className={`text-xs px-2 py-0.5 rounded font-mono ${
                      state === "FILLED" ? "bg-green-900 text-green-300" :
                      state === "TRIGGERED" ? "bg-yellow-900 text-yellow-300" :
                      state === "PARTIAL" ? "bg-blue-900 text-blue-300" :
                      "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {key}: {state}
                  </span>
                ))}
              </div>
              {stratState.trailing_active && (
                <p className="text-xs text-yellow-300">
                  Trailing stop active: {stratState.trailing_stop_price.toFixed(4)} (HWM: {stratState.high_water_mark.toFixed(4)})
                </p>
              )}
              {/* Fill log */}
              {stratState.fill_log && stratState.fill_log.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-gray-400 font-semibold mb-1">Recent Fills:</p>
                  <div className="max-h-24 overflow-y-auto text-xs font-mono space-y-0.5">
                    {[...stratState.fill_log].reverse().map((fill, i) => (
                      <div key={i} className="text-gray-300">
                        {fill.level}: {fill.qty_filled} @ {fill.avg_price.toFixed(4)} ({fill.pnl_pct >= 0 ? "+" : ""}{fill.pnl_pct.toFixed(1)}%) — {fill.remaining_qty} left
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stratState.completed && (
                <p className="text-green-400 font-semibold text-sm">Position fully exited.</p>
              )}
            </div>
          )}

          {/* ── Presets ── */}
          {!isRunning && (
            <>
              <div>
                <label className="block text-xs text-gray-400 font-semibold mb-1.5">Presets</label>
                <div className="flex gap-2">
                  {Object.entries(PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      onClick={() => applyPreset(key)}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition ${
                        activePreset === key
                          ? "border-blue-500 bg-blue-500/20 text-blue-300"
                          : "border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {activePreset && PRESETS[activePreset] && (
                  <p className="text-xs text-gray-500 mt-1">{PRESETS[activePreset].description}</p>
                )}
              </div>

              {/* ── Entry Price Override ── */}
              <div className="flex gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.position.entry_price}
                    onChange={(e) => setConfig((c) => ({
                      ...c,
                      position: { ...c.position, entry_price: parseFloat(e.target.value) || 0 },
                    }))}
                    className="w-28 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    step="1"
                    value={config.position.quantity}
                    onChange={(e) => setConfig((c) => ({
                      ...c,
                      position: { ...c.position, quantity: parseInt(e.target.value) || 0 },
                    }))}
                    className="w-24 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200"
                  />
                </div>
              </div>

              {/* ── Stop Loss ── */}
              <div className="border border-gray-700 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={config.stop_loss.enabled}
                    onChange={(e) => setConfig((c) => ({
                      ...c,
                      stop_loss: { ...c.stop_loss, enabled: e.target.checked },
                    }))}
                    className="accent-red-500"
                  />
                  <span className="text-sm font-semibold text-red-400">Stop Loss</span>
                  {config.stop_loss.enabled && (
                    <select
                      value={config.stop_loss.type}
                      onChange={(e) => {
                        const type = e.target.value as "simple" | "laddered" | "none";
                        setConfig((c) => ({
                          ...c,
                          stop_loss: {
                            ...c.stop_loss,
                            type,
                            ladders: type === "laddered" && c.stop_loss.ladders.length === 0
                              ? [{ trigger_pct: -5, exit_pct: 33 }, { trigger_pct: -10, exit_pct: 50 }, { trigger_pct: -15, exit_pct: 100 }]
                              : c.stop_loss.ladders,
                          },
                        }));
                      }}
                      className="ml-auto px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300"
                    >
                      <option value="simple">Simple</option>
                      <option value="laddered">Laddered</option>
                    </select>
                  )}
                </div>
                {config.stop_loss.enabled && config.stop_loss.type === "simple" && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">Close all at</label>
                    <input
                      type="number"
                      step="0.5"
                      value={config.stop_loss.trigger_pct}
                      onChange={(e) => setConfig((c) => ({
                        ...c,
                        stop_loss: { ...c.stop_loss, trigger_pct: parseFloat(e.target.value) || 0 },
                      }))}
                      className="w-20 px-2 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                    />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                )}
                {config.stop_loss.enabled && config.stop_loss.type === "laddered" && (
                  <div className="space-y-1">
                    {config.stop_loss.ladders.map((ladder, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-4">{i + 1}.</span>
                        <label className="text-xs text-gray-400">At</label>
                        <input
                          type="number"
                          step="0.5"
                          value={ladder.trigger_pct}
                          onChange={(e) => {
                            const newLadders = [...config.stop_loss.ladders];
                            newLadders[i] = { ...newLadders[i], trigger_pct: parseFloat(e.target.value) || 0 };
                            setConfig((c) => ({ ...c, stop_loss: { ...c.stop_loss, ladders: newLadders } }));
                          }}
                          className="w-16 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                        />
                        <span className="text-xs text-gray-500">% exit</span>
                        <input
                          type="number"
                          step="1"
                          value={ladder.exit_pct}
                          onChange={(e) => {
                            const newLadders = [...config.stop_loss.ladders];
                            newLadders[i] = { ...newLadders[i], exit_pct: parseInt(e.target.value) || 0 };
                            setConfig((c) => ({ ...c, stop_loss: { ...c.stop_loss, ladders: newLadders } }));
                          }}
                          className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                        />
                        <span className="text-xs text-gray-500">%</span>
                        <button
                          onClick={() => {
                            const newLadders = config.stop_loss.ladders.filter((_, j) => j !== i);
                            setConfig((c) => ({ ...c, stop_loss: { ...c.stop_loss, ladders: newLadders } }));
                          }}
                          className="text-xs text-red-400 hover:text-red-300"
                        >&times;</button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const last = config.stop_loss.ladders[config.stop_loss.ladders.length - 1];
                        const newTrigger = last ? last.trigger_pct - 5 : -5;
                        setConfig((c) => ({
                          ...c,
                          stop_loss: {
                            ...c.stop_loss,
                            ladders: [...c.stop_loss.ladders, { trigger_pct: newTrigger, exit_pct: 100 }],
                          },
                        }));
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >+ Add level</button>
                  </div>
                )}
              </div>

              {/* ── Profit Taking ── */}
              <div className="border border-gray-700 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={config.profit_taking.enabled}
                    onChange={(e) => setConfig((c) => ({
                      ...c,
                      profit_taking: { ...c.profit_taking, enabled: e.target.checked },
                    }))}
                    className="accent-green-500"
                  />
                  <span className="text-sm font-semibold text-green-400">Profit Taking</span>
                </div>
                {config.profit_taking.enabled && (
                  <>
                    <div className="space-y-1 mb-2">
                      {config.profit_taking.targets.map((target, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-4">{i + 1}.</span>
                          <label className="text-xs text-gray-400">At +</label>
                          <input
                            type="number"
                            step="1"
                            value={target.trigger_pct}
                            onChange={(e) => {
                              const newTargets = [...config.profit_taking.targets];
                              newTargets[i] = { ...newTargets[i], trigger_pct: parseFloat(e.target.value) || 0 };
                              setConfig((c) => ({ ...c, profit_taking: { ...c.profit_taking, targets: newTargets } }));
                            }}
                            className="w-16 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                          />
                          <span className="text-xs text-gray-500">% bank</span>
                          <input
                            type="number"
                            step="1"
                            value={target.exit_pct}
                            onChange={(e) => {
                              const newTargets = [...config.profit_taking.targets];
                              newTargets[i] = { ...newTargets[i], exit_pct: parseInt(e.target.value) || 0 };
                              setConfig((c) => ({ ...c, profit_taking: { ...c.profit_taking, targets: newTargets } }));
                            }}
                            className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                          />
                          <span className="text-xs text-gray-500">%</span>
                          <button
                            onClick={() => {
                              const newTargets = config.profit_taking.targets.filter((_, j) => j !== i);
                              setConfig((c) => ({ ...c, profit_taking: { ...c.profit_taking, targets: newTargets } }));
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >&times;</button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const last = config.profit_taking.targets[config.profit_taking.targets.length - 1];
                          const newTrigger = last ? last.trigger_pct + 50 : 50;
                          setConfig((c) => ({
                            ...c,
                            profit_taking: {
                              ...c.profit_taking,
                              targets: [...c.profit_taking.targets, { trigger_pct: newTrigger, exit_pct: 25 }],
                            },
                          }));
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >+ Add target</button>
                    </div>
                    {/* Trailing stop */}
                    <div className="border-t border-gray-700 pt-2 mt-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.profit_taking.trailing_stop.enabled}
                          onChange={(e) => setConfig((c) => ({
                            ...c,
                            profit_taking: {
                              ...c.profit_taking,
                              trailing_stop: { ...c.profit_taking.trailing_stop, enabled: e.target.checked },
                            },
                          }))}
                          className="accent-yellow-500"
                        />
                        <span className="text-xs font-semibold text-yellow-400">Trailing Stop</span>
                      </div>
                      {config.profit_taking.trailing_stop.enabled && (
                        <div className="flex gap-4 mt-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs text-gray-400">Activate at +</label>
                            <input
                              type="number"
                              step="1"
                              value={config.profit_taking.trailing_stop.activation_pct}
                              onChange={(e) => setConfig((c) => ({
                                ...c,
                                profit_taking: {
                                  ...c.profit_taking,
                                  trailing_stop: {
                                    ...c.profit_taking.trailing_stop,
                                    activation_pct: parseFloat(e.target.value) || 0,
                                  },
                                },
                              }))}
                              className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                            />
                            <span className="text-xs text-gray-500">%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <label className="text-xs text-gray-400">Trail</label>
                            <input
                              type="number"
                              step="0.5"
                              value={config.profit_taking.trailing_stop.trail_pct}
                              onChange={(e) => setConfig((c) => ({
                                ...c,
                                profit_taking: {
                                  ...c.profit_taking,
                                  trailing_stop: {
                                    ...c.profit_taking.trailing_stop,
                                    trail_pct: parseFloat(e.target.value) || 0,
                                  },
                                },
                              }))}
                              className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200"
                            />
                            <span className="text-xs text-gray-500">% from high</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-sm text-red-300">{error}</div>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
            {isRunning ? (
              <button
                onClick={handleStop}
                disabled={loading}
                className="px-4 py-2 rounded font-semibold text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {loading ? "Stopping..." : "Stop Strategy"}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading || config.position.quantity <= 0}
                className="px-4 py-2 rounded font-semibold text-sm bg-green-600 hover:bg-green-500 text-white disabled:opacity-50"
              >
                {loading ? "Starting..." : "Start Risk Manager"}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded font-semibold text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
