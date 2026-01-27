"use client";

import { useEffect, useState } from "react";
import type { WatchedSpreadDTO } from "@/types/ma-options";

interface WatchlistManagerProps {
  dealId: string;
}

export default function WatchlistManager({ dealId }: WatchlistManagerProps) {
  const [spreads, setSpreads] = useState<WatchedSpreadDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSpreads();
  }, [dealId]);

  const loadSpreads = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/ma-options/watched-spreads?dealId=${dealId}`
      );
      if (response.ok) {
        const data = await response.json();
        setSpreads(data.spreads || []);
      }
    } catch (error) {
      console.error("Error loading spreads:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (spreadId: string) => {
    try {
      const response = await fetch(
        `/api/ma-options/watched-spreads/${spreadId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "inactive" }),
        }
      );

      if (response.ok) {
        loadSpreads();
      }
    } catch (error) {
      console.error("Error deactivating spread:", error);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading watchlist...</div>;
  }

  if (spreads.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-3">
        Current Watchlist ({spreads.length})
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-1 text-gray-400">Strategy</th>
              <th className="text-left py-2 px-1 text-gray-400">Expiration</th>
              <th className="text-right py-2 px-1 text-gray-400">Entry</th>
              <th className="text-right py-2 px-1 text-gray-400">Current</th>
              <th className="text-right py-2 px-1 text-gray-400">P&L</th>
              <th className="text-center py-2 px-1 text-gray-400">Status</th>
              <th className="text-center py-2 px-1 text-gray-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {spreads.map((spread) => (
              <tr
                key={spread.id}
                className="border-b border-gray-800 hover:bg-gray-800"
              >
                <td className="py-2 px-1 text-gray-100">{spread.strategyType}</td>
                <td className="py-2 px-1 text-gray-300">
                  {new Date(spread.expiration).toLocaleDateString()}
                </td>
                <td className="py-2 px-1 text-right text-gray-100 font-mono">
                  ${spread.entryPremium.toFixed(2)}
                </td>
                <td className="py-2 px-1 text-right text-gray-100 font-mono">
                  ${(spread.currentPremium || spread.entryPremium).toFixed(2)}
                </td>
                <td
                  className={`py-2 px-1 text-right font-mono ${
                    spread.pnlDollar > 0 ? "text-green-400" : spread.pnlDollar < 0 ? "text-red-400" : "text-gray-400"
                  }`}
                >
                  ${spread.pnlDollar.toFixed(2)} ({spread.pnlPercent.toFixed(1)}%)
                </td>
                <td className="py-2 px-1 text-center text-gray-300">
                  {spread.status}
                </td>
                <td className="py-2 px-1 text-center">
                  {spread.status === "active" && (
                    <button
                      onClick={() => handleDeactivate(spread.id)}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

