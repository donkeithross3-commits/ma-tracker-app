"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import type { PositionFill } from "./types";

interface PositionsPanelProps {
  fills: PositionFill[];
  activePositionCount: number;
}

function formatTime(epoch: number): string {
  try {
    const d = new Date(epoch * 1000);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

/** Level label abbreviations */
const LEVEL_LABELS: Record<string, string> = {
  entry: "ENTRY",
  trailing_stop: "TS",
  stop_loss: "SL",
  profit_target_1: "PT1",
  profit_target_2: "PT2",
  profit_target_3: "PT3",
  expired_worthless: "EXP",
  manual_close: "MAN",
  reconciliation: "REC",
};

export default function PositionsPanel({
  fills,
  activePositionCount,
}: PositionsPanelProps) {
  // Compute summary stats
  const exitFills = fills.filter((f) => !f.isEntry);
  const wins = exitFills.filter((f) => f.pnl_pct > 0).length;
  const losses = exitFills.filter((f) => f.pnl_pct <= 0).length;
  const totalPnl = exitFills.reduce((sum, f) => sum + f.pnl_pct, 0);

  const recentFills = fills.slice(-5).reverse();

  return (
    <div className="flex flex-col h-full p-2 gap-2 text-sm">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Positions</span>
        <span className="text-xs text-gray-500">
          {activePositionCount} active
        </span>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-1">
        <div className="bg-gray-800/50 rounded px-1.5 py-1 text-center">
          <div className="text-xs text-gray-500">W/L</div>
          <div className="text-sm font-medium">
            <span className="text-green-400">{wins}</span>
            <span className="text-gray-600">/</span>
            <span className="text-red-400">{losses}</span>
          </div>
        </div>
        <div className="bg-gray-800/50 rounded px-1.5 py-1 text-center">
          <div className="text-xs text-gray-500">Fills</div>
          <div className="text-sm font-medium text-gray-300">
            {fills.length}
          </div>
        </div>
        <div className="bg-gray-800/50 rounded px-1.5 py-1 text-center">
          <div className="text-xs text-gray-500">P&L</div>
          <div
            className={`text-sm font-medium tabular-nums ${
              totalPnl >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {totalPnl >= 0 ? "+" : ""}
            {totalPnl.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Recent fills table */}
      {recentFills.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-0.5 font-normal">Time</th>
                <th className="text-left py-0.5 font-normal">Type</th>
                <th className="text-right py-0.5 font-normal">Price</th>
                <th className="text-right py-0.5 font-normal">P&L</th>
              </tr>
            </thead>
            <tbody>
              {recentFills.map((fill, i) => {
                const levelLabel =
                  LEVEL_LABELS[fill.level] ||
                  fill.level.slice(0, 5).toUpperCase();
                return (
                  <tr
                    key={`${fill.positionId}-${fill.time}-${i}`}
                    className="border-b border-gray-800/50"
                  >
                    <td className="py-0.5 text-gray-400 tabular-nums">
                      {formatTime(fill.time)}
                    </td>
                    <td className="py-0.5">
                      <span
                        className={
                          fill.isEntry
                            ? "text-blue-400"
                            : fill.pnl_pct >= 0
                              ? "text-green-400"
                              : "text-red-400"
                        }
                      >
                        {levelLabel}
                      </span>
                    </td>
                    <td className="py-0.5 text-right tabular-nums text-gray-300">
                      ${fill.price.toFixed(2)}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">
                      {fill.isEntry ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span
                          className={
                            fill.pnl_pct >= 0
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          {fill.pnl_pct >= 0 ? "+" : ""}
                          {fill.pnl_pct.toFixed(0)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-gray-500">No fills yet</span>
        </div>
      )}
    </div>
  );
}
