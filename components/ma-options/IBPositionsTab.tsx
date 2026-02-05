"use client";

import { useCallback, useEffect, useState } from "react";
import { useIBConnection } from "./IBConnectionContext";

export interface IBPositionContract {
  conId?: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  lastTradeDateOrContractMonth?: string;
  strike?: number;
  right?: string;
  multiplier?: string;
  localSymbol?: string;
  tradingClass?: string;
}

export interface IBPositionRow {
  account: string;
  contract: IBPositionContract;
  position: number;
  avgCost: number;
}

interface IBPositionsResponse {
  positions?: IBPositionRow[];
  accounts?: string[];
  error?: string;
}

function formatAvgCost(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPosition(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function displaySymbol(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT" && (c.lastTradeDateOrContractMonth || c.strike)) {
    const exp = (c.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    return c.symbol
      ? `${c.symbol} ${exp} ${c.strike} ${c.right || ""}`.trim()
      : (c.localSymbol || c.symbol || "—");
  }
  if (c.secType === "FUT" && c.lastTradeDateOrContractMonth) {
    return c.symbol ? `${c.symbol} ${c.lastTradeDateOrContractMonth}` : (c.localSymbol || "—");
  }
  return c.localSymbol || c.symbol || "—";
}

interface IBPositionsTabProps {
  /** When true, auto-refresh positions every 60s (e.g. when tab is active). */
  autoRefresh?: boolean;
}

export default function IBPositionsTab({ autoRefresh = true }: IBPositionsTabProps) {
  const { isConnected } = useIBConnection();
  const [data, setData] = useState<IBPositionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ib-connection/positions", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error || `Request failed: ${res.status}`;
        setError(msg);
        setData(null);
        return;
      }
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch positions");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    if (!autoRefresh || !isConnected) return;
    const interval = setInterval(fetchPositions, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, isConnected, fetchPositions]);

  const positions = data?.positions ?? [];
  const byType = positions.reduce<Record<string, number>>((acc, row) => {
    const t = row.contract?.secType || "?";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  if (!isConnected) {
    return (
      <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-4 text-sm text-gray-300">
        <p className="mb-2">Connect your agent to see live positions.</p>
        <p className="text-xs text-gray-500">
          Download and start the IB Data Agent, then ensure TWS is running.
        </p>
      </div>
    );
  }

  if (loading && positions.length === 0) {
    return (
      <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-4 text-sm text-gray-400">
        Loading positions…
      </div>
    );
  }

  if (error && positions.length === 0) {
    return (
      <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-4 text-sm">
        <p className="text-red-400 mb-2">{error}</p>
        <button
          type="button"
          onClick={fetchPositions}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Exposure summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>Positions: {positions.length} total</span>
        {Object.keys(byType).length > 0 && (
          <span>By type: {Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(", ")}</span>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-4 text-sm text-gray-400">
          No positions.
        </div>
      ) : (
        <div className="rounded border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-gray-200 font-medium border-b border-gray-700">
                  <th className="text-left py-2 px-2">Account</th>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-right py-2 px-2">Position</th>
                  <th className="text-right py-2 px-2">Avg cost</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((row, i) => (
                  <tr
                    key={`${row.account}-${row.contract?.conId ?? i}-${row.contract?.localSymbol ?? row.contract?.symbol}`}
                    className={`border-b border-gray-800 hover:bg-gray-800/50 ${i % 2 === 1 ? "bg-gray-900/30" : ""}`}
                  >
                    <td className="py-1.5 px-2 text-gray-300">{row.account}</td>
                    <td className="py-1.5 px-2 text-gray-300 whitespace-nowrap">
                      {displaySymbol(row)}
                    </td>
                    <td className="py-1.5 px-2 text-gray-400">{row.contract?.secType ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">
                      {formatPosition(row.position)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">
                      {formatAvgCost(row.avgCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={fetchPositions}
          disabled={loading}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 rounded text-xs"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
