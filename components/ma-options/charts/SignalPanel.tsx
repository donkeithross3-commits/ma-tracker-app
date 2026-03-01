"use client";

import { ArrowUpCircle, ArrowDownCircle, Activity, Pause } from "lucide-react";
import type { BMCStrategyState, SignalHistoryEntry } from "./types";

interface SignalPanelProps {
  currentSignal: BMCStrategyState["current_signal"] | null;
  signals: SignalHistoryEntry[];
  engineRunning: boolean;
  ticker: string;
}

function ProbabilityDisplay({
  probability,
  direction,
}: {
  probability: number;
  direction: string;
}) {
  const pct = Math.round(probability * 100);
  const isCall = direction === "call";
  const color = isCall ? "text-green-400" : "text-red-400";
  const Icon = isCall ? ArrowUpCircle : ArrowDownCircle;

  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-6 w-6 ${color}`} />
      <span className={`text-2xl font-bold tabular-nums ${color}`}>
        {pct}%
      </span>
      <span className="text-xs text-gray-500 uppercase">{direction}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export default function SignalPanel({
  currentSignal,
  signals,
  engineRunning,
  ticker,
}: SignalPanelProps) {
  const recentSignals = signals.slice(-5).reverse();

  return (
    <div className="flex flex-col h-full p-2 gap-2 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">
          {ticker} Signal
        </span>
        <div className="flex items-center gap-1">
          {engineRunning ? (
            <>
              <Activity className="h-3 w-3 text-green-400" />
              <span className="text-xs text-green-400">Live</span>
            </>
          ) : (
            <>
              <Pause className="h-3 w-3 text-gray-500" />
              <span className="text-xs text-gray-500">Stopped</span>
            </>
          )}
        </div>
      </div>

      {/* Current signal */}
      {currentSignal ? (
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <ProbabilityDisplay
            probability={currentSignal.probability}
            direction={currentSignal.direction}
          />
          {currentSignal.suppressed && (
            <div className="text-xs text-yellow-400 mt-1">
              ⚠ Suppressed: {currentSignal.suppressed}
            </div>
          )}
          {currentSignal.underlying_price && (
            <div className="text-xs text-gray-500 mt-0.5">
              Underlying: ${currentSignal.underlying_price.toFixed(2)}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded px-2 py-3 text-center">
          <span className="text-gray-500 text-xs">No signal data</span>
        </div>
      )}

      {/* Recent signals table */}
      {recentSignals.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-0.5 font-normal">Time</th>
                <th className="text-right py-0.5 font-normal">Prob</th>
                <th className="text-right py-0.5 font-normal">Dir</th>
                <th className="text-right py-0.5 font-normal">Str</th>
              </tr>
            </thead>
            <tbody>
              {recentSignals.map((sig, i) => (
                <tr
                  key={`${sig.timestamp}-${i}`}
                  className="border-b border-gray-800/50"
                >
                  <td className="py-0.5 text-gray-400 tabular-nums">
                    {formatTime(sig.timestamp)}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    <span
                      className={
                        sig.direction === "call"
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {Math.round(sig.probability * 100)}%
                    </span>
                  </td>
                  <td className="py-0.5 text-right text-gray-400">
                    {sig.direction === "call" ? "C" : "P"}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-gray-400">
                    {sig.strength.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
