"use client";

import { useState } from "react";
import type { WatchedSpreadDTO } from "@/types/ma-options";
import { StrategyTableHeader, StrategyMetricsCells, type StrategyMetrics } from "./StrategyColumns";
import SpreadAnalysisModal from "./SpreadAnalysisModal";

interface WatchedSpreadsTableProps {
  spreads: WatchedSpreadDTO[];
  onDeactivate: (spreadId: string) => void;
  onRefresh: () => void;
  onRefreshSingle: (spreadId: string) => void;
  isRefreshing?: boolean;
  refreshingSpreads?: Set<string>;
  refreshStatus?: string;
}

export default function WatchedSpreadsTable({
  spreads,
  onDeactivate,
  onRefresh,
  onRefreshSingle,
  isRefreshing = false,
  refreshingSpreads = new Set(),
  refreshStatus = "",
}: WatchedSpreadsTableProps) {
  const [sortKey, setSortKey] = useState<string>("pnlPercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [analyzingSpread, setAnalyzingSpread] = useState<WatchedSpreadDTO | null>(null);

  const sortedSpreads = [...spreads].sort((a, b) => {
    const aVal = (a as any)[sortKey];
    const bVal = (b as any)[sortKey];
    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-gray-100">
          Watched Spreads ({spreads.length})
        </h3>
        <div className="flex items-center gap-3">
          {refreshStatus && (
            <div className="text-sm text-gray-400">
              {refreshStatus}
            </div>
          )}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`px-3 py-1 text-white text-sm rounded transition-colors ${
              isRefreshing
                ? 'bg-gray-600 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Prices'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900">
            {/* First header row */}
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Deal</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Strategy</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Expiration</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Strikes</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Leg Prices</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Market Data</th>
              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                Midpoint Entry
              </th>
              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                Far Touch Entry
              </th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Last Updated</th>
              <th className="text-center py-2 px-2 text-gray-400" rowSpan={2}>Action</th>
            </tr>
            {/* Second header row - sub-headers for Midpoint and Far Touch */}
            <tr className="border-b border-gray-700">
              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Cost</th>
              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Profit</th>
              <th
                className="text-right py-1 px-2 text-gray-400 text-[10px] cursor-pointer hover:text-gray-200"
                onClick={() => handleSort("annualizedYield")}
              >
                IRR
              </th>
              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Cost</th>
              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Profit</th>
              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">IRR</th>
            </tr>
          </thead>
          <tbody>
            {sortedSpreads.map((spread) => {
              // Calculate far touch entry cost from legs
              const farTouchCost = spread.legs.reduce((total, leg) => {
                const price = leg.side === "BUY" ? leg.ask : leg.bid;
                return total + (leg.side === "BUY" ? price : -price) * leg.quantity;
              }, 0);

              // Calculate far touch IRR
              // For spreads: farProfit = strikeWidth - farCost (can be negative)
              const strikeWidth = spread.maxProfit + Math.abs(spread.entryPremium);
              const farProfit = strikeWidth - Math.abs(farTouchCost);
              const farReturn = Math.abs(farTouchCost) > 0 ? farProfit / Math.abs(farTouchCost) : 0;
              
              // Annualize the far touch return
              // Assuming daysToClose represents days to expiration
              const yearsToExpiry = spread.daysToClose / 365;
              const farTouchIRR = yearsToExpiry > 0 ? farReturn / yearsToExpiry : 0;

              // Convert spread to StrategyMetrics format
              const metrics: StrategyMetrics = {
                legs: spread.legs as any,
                netPremium: spread.entryPremium,
                netPremiumFarTouch: farTouchCost,
                maxProfit: spread.maxProfit,
                annualizedYield: spread.annualizedYield,
                annualizedYieldFarTouch: farTouchIRR,
                liquidityScore: spread.liquidityScore,
              };

              return (
                <tr
                  key={spread.id}
                  className="border-b border-gray-800 hover:bg-gray-800"
                >
                  <td className="py-2 px-1 text-gray-100">
                    <div className="font-mono">{spread.dealTicker}</div>
                    <div className="text-gray-400 text-xs truncate max-w-[120px]" title={spread.dealTargetName}>
                      {spread.dealTargetName}
                    </div>
                    <div className="text-gray-500 text-[10px] mt-0.5">
                      ${spread.dealPrice?.toFixed(2) || "—"} | {spread.dealExpectedCloseDate ? new Date(spread.dealExpectedCloseDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </div>
                  </td>
                  <td className="py-2 px-1 text-gray-300">
                    {spread.strategyType === "spread" 
                      ? (spread.legs[0]?.right === "C" ? "call spread" : "put spread")
                      : spread.strategyType}
                  </td>
                  <td className="py-2 px-1 text-gray-300">
                    {new Date(spread.expiration).toLocaleDateString()}
                  </td>

                  {/* Shared strategy metrics columns */}
                  <StrategyMetricsCells metrics={metrics} />

                  {/* Last Updated */}
                  <td className="py-2 px-1 text-gray-300">
                    {spread.lastUpdated
                      ? new Date(spread.lastUpdated).toLocaleString('en-US', {
                          month: 'numeric',
                          day: 'numeric',
                          year: '2-digit',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })
                      : "—"}
                  </td>

                  {/* Action */}
                  <td className="py-2 px-1 text-center">
                    <div className="flex gap-1 justify-center items-center">
                      <button
                        onClick={() => onRefreshSingle(spread.id)}
                        disabled={refreshingSpreads.has(spread.id)}
                        className={`w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors ${
                          refreshingSpreads.has(spread.id) ? 'animate-spin' : ''
                        }`}
                        title="Refresh this spread"
                      >
                        ↻
                      </button>
                      <button
                        onClick={() => setAnalyzingSpread(spread)}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                        title="Compare spread vs stock ownership"
                      >
                        Analyze
                      </button>
                      {spread.status === "active" && (
                        <button
                          onClick={() => onDeactivate(spread.id)}
                          className="w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                          title="Deactivate spread"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {spreads.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No watched spreads yet
          </div>
        )}
      </div>
      
      {/* Analysis Modal */}
      {analyzingSpread && (
        <SpreadAnalysisModal
          spread={analyzingSpread}
          onClose={() => setAnalyzingSpread(null)}
        />
      )}
    </div>
  );
}

