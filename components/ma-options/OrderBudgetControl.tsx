"use client";

import { useCallback, useState } from "react";

interface OrderBudgetControlProps {
  /** Current order budget from execution telemetry. -1=unlimited, 0=halted, N=N remaining */
  orderBudget: number;
  /** Lifetime total algo orders sent */
  totalAlgoOrders: number;
  /** Whether the execution engine is running */
  isRunning: boolean;
  /** Callback to set order budget */
  onSetBudget: (budget: number) => Promise<void>;
}

export function OrderBudgetControl({
  orderBudget,
  totalAlgoOrders,
  isRunning,
  onSetBudget,
}: OrderBudgetControlProps) {
  const [inputValue, setInputValue] = useState("10");
  const [loading, setLoading] = useState(false);

  const isHalted = orderBudget === 0;
  const isUnlimited = orderBudget === -1;

  const handleSetBudget = useCallback(async (budget: number) => {
    setLoading(true);
    try {
      await onSetBudget(budget);
    } catch {
      // parent handles error display
    } finally {
      setLoading(false);
    }
  }, [onSetBudget]);

  // Status indicator color
  const statusColor = isHalted ? "bg-red-500" : isUnlimited ? "bg-blue-400" : "bg-yellow-400";
  const statusLabel = isHalted ? "HALTED" : isUnlimited ? "UNLIMITED" : `${orderBudget} left`;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/80 border border-gray-700 rounded text-xs">
      {/* Status dot + label */}
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor} ${!isHalted && isRunning ? "animate-pulse" : ""}`} />
        <span className="font-semibold text-gray-300">Algo Budget:</span>
        <span className={`font-mono font-bold ${isHalted ? "text-red-400" : isUnlimited ? "text-blue-300" : "text-yellow-300"}`}>
          {statusLabel}
        </span>
      </div>

      {/* Lifetime counter */}
      <span className="text-gray-500 border-l border-gray-600 pl-2">
        {totalAlgoOrders} lifetime
      </span>

      {/* Quick buttons */}
      <div className="flex items-center gap-1 border-l border-gray-600 pl-2">
        <button
          onClick={() => handleSetBudget(0)}
          disabled={loading || isHalted}
          className={`px-2 py-0.5 rounded font-semibold transition ${
            isHalted
              ? "bg-red-900/50 text-red-600 cursor-default"
              : "bg-red-700 hover:bg-red-600 text-white"
          }`}
          title="Emergency halt: set budget to 0"
        >
          HALT
        </button>
        <div className="flex items-center gap-0.5">
          <span className="text-gray-500">+</span>
          <input
            type="number"
            min="1"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-12 px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-center text-gray-200 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(inputValue);
                if (n > 0) handleSetBudget(n);
              }
            }}
          />
          <button
            onClick={() => {
              const n = parseInt(inputValue);
              if (n > 0) handleSetBudget(n);
            }}
            disabled={loading}
            className="px-2 py-0.5 rounded font-semibold bg-yellow-700 hover:bg-yellow-600 text-white disabled:opacity-50"
            title="Set budget to exactly this many orders"
          >
            Set
          </button>
        </div>
        <button
          onClick={() => handleSetBudget(-1)}
          disabled={loading || isUnlimited}
          className={`px-2 py-0.5 rounded font-semibold transition ${
            isUnlimited
              ? "bg-blue-900/50 text-blue-600 cursor-default"
              : "bg-blue-700 hover:bg-blue-600 text-white"
          }`}
          title="Allow unlimited algo orders"
        >
          UNL
        </button>
      </div>
    </div>
  );
}
