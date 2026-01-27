"use client";

import { useState, useMemo } from "react";
import type { WatchedSpreadDTO, SpreadUpdateFailure } from "@/types/ma-options";
import { StrategyMetricsCells, type StrategyMetrics } from "./StrategyColumns";
import SpreadAnalysisModal from "./SpreadAnalysisModal";

interface WatchedSpreadsTableProps {
  spreads: WatchedSpreadDTO[];
  onDeactivate: (spreadId: string) => void;
  onRefresh: () => void;
  onRefreshSingle: (spreadId: string) => void;
  isRefreshing?: boolean;
  refreshingSpreads?: Set<string>;
  refreshStatus?: string;
  failedSpreads?: Map<string, SpreadUpdateFailure>;
}

interface GroupedSpreads {
  [ticker: string]: {
    [expiration: string]: WatchedSpreadDTO[];
  };
}

export default function WatchedSpreadsTable({
  spreads,
  onDeactivate,
  onRefresh,
  onRefreshSingle,
  isRefreshing = false,
  refreshingSpreads = new Set(),
  refreshStatus = "",
  failedSpreads = new Map(),
}: WatchedSpreadsTableProps) {
  const [sortKey, setSortKey] = useState<string>("annualizedYield");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [analyzingSpread, setAnalyzingSpread] = useState<WatchedSpreadDTO | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Group spreads by ticker, then by expiration
  const groupedSpreads = useMemo(() => {
    const grouped: GroupedSpreads = {};
    
    spreads.forEach((spread) => {
      const ticker = spread.dealTicker;
      const expirationKey = new Date(spread.expiration).toISOString().split('T')[0];
      
      if (!grouped[ticker]) {
        grouped[ticker] = {};
      }
      if (!grouped[ticker][expirationKey]) {
        grouped[ticker][expirationKey] = [];
      }
      grouped[ticker][expirationKey].push(spread);
    });

    // Sort spreads within each group by the selected sort key
    Object.keys(grouped).forEach((ticker) => {
      Object.keys(grouped[ticker]).forEach((expiration) => {
        grouped[ticker][expiration].sort((a, b) => {
          const aVal = (a as any)[sortKey] ?? 0;
          const bVal = (b as any)[sortKey] ?? 0;
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        });
      });
    });

    return grouped;
  }, [spreads, sortKey, sortDir]);

  // Sort tickers alphabetically
  const sortedTickers = useMemo(() => {
    return Object.keys(groupedSpreads).sort();
  }, [groupedSpreads]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleGroup = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  const formatStrategyType = (spread: WatchedSpreadDTO): string => {
    if (spread.strategyType === "spread") {
      return spread.legs[0]?.right === "C" ? "Call Spread" : "Put Spread";
    }
    const typeMap: { [key: string]: string } = {
      'long_call': 'Long Call',
      'long_put': 'Long Put',
      'call': 'Long Call',
      'put': 'Long Put',
      'put_spread': 'Put Spread',
    };
    return typeMap[spread.strategyType] || spread.strategyType;
  };

  const formatExpiration = (expiration: string): string => {
    const date = new Date(expiration + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // Calculate metrics for a spread
  const calculateMetrics = (spread: WatchedSpreadDTO) => {
    const isSingleLeg = spread.legs.length === 1 || 
      spread.strategyType === "long_call" || 
      spread.strategyType === "long_put" ||
      spread.strategyType === "call" ||
      spread.strategyType === "put";

    const farTouchCost = spread.legs.reduce((total, leg) => {
      const price = leg.side === "BUY" ? leg.ask : leg.bid;
      return total + (leg.side === "BUY" ? price : -price) * leg.quantity;
    }, 0);

    let farProfit: number;
    let farReturn: number;
    
    if (isSingleLeg) {
      const costDiff = Math.abs(farTouchCost) - Math.abs(spread.entryPremium);
      farProfit = spread.maxProfit - costDiff;
      farReturn = Math.abs(farTouchCost) > 0 ? farProfit / Math.abs(farTouchCost) : 0;
    } else {
      const strikeWidth = spread.maxProfit + Math.abs(spread.entryPremium);
      farProfit = strikeWidth - Math.abs(farTouchCost);
      farReturn = Math.abs(farTouchCost) > 0 ? farProfit / Math.abs(farTouchCost) : 0;
    }
    
    const yearsToExpiry = spread.daysToClose / 365;
    const farTouchIRR = yearsToExpiry > 0 ? farReturn / yearsToExpiry : 0;

    return {
      legs: spread.legs as any,
      netPremium: spread.entryPremium,
      netPremiumFarTouch: farTouchCost,
      maxProfit: spread.maxProfit,
      annualizedYield: spread.annualizedYield,
      annualizedYieldFarTouch: farTouchIRR,
      liquidityScore: spread.liquidityScore,
    } as StrategyMetrics;
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

      <div className="space-y-4">
        {sortedTickers.map((ticker) => {
          const expirationsByTicker = groupedSpreads[ticker];
          const sortedExpirations = Object.keys(expirationsByTicker).sort();
          const totalForTicker = Object.values(expirationsByTicker).reduce(
            (sum, spreads) => sum + spreads.length,
            0
          );
          
          // Get deal info from first spread
          const firstSpread = expirationsByTicker[sortedExpirations[0]][0];
          const dealInfo = firstSpread ? {
            targetName: firstSpread.dealTargetName,
            price: firstSpread.dealPrice,
            closeDate: firstSpread.dealExpectedCloseDate,
          } : null;

          return (
            <div key={ticker} className="border border-gray-700 rounded">
              {/* Ticker Header */}
              <div className="bg-gray-800 px-4 py-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-base font-semibold text-gray-100 font-mono">{ticker}</span>
                    {dealInfo && (
                      <span className="text-gray-400 text-sm ml-3">
                        {dealInfo.targetName}
                      </span>
                    )}
                    <span className="text-gray-500 ml-2 text-sm">
                      ({totalForTicker} {totalForTicker === 1 ? 'position' : 'positions'})
                    </span>
                  </div>
                  {dealInfo && (
                    <div className="text-xs text-gray-400">
                      Deal: ${dealInfo.price?.toFixed(2)} | Close: {dealInfo.closeDate ? formatExpiration(dealInfo.closeDate) : "—"}
                    </div>
                  )}
                </div>
              </div>

              {/* Expiration Groups */}
              {sortedExpirations.map((expiration) => {
                const spreadsInExpiry = expirationsByTicker[expiration];
                const groupKey = `${ticker}-${expiration}`;
                const isExpanded = expandedGroups.has(groupKey);
                
                // Find best IRR in this group
                const bestIRR = Math.max(...spreadsInExpiry.map(s => s.annualizedYield || 0));

                return (
                  <div key={expiration} className="border-t border-gray-700">
                    {/* Expiration Header */}
                    <div
                      className="bg-gray-850 px-4 py-2 flex justify-between items-center cursor-pointer hover:bg-gray-800"
                      onClick={() => toggleGroup(groupKey)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                        <span className="text-sm font-medium text-gray-200">
                          {formatExpiration(expiration)}
                        </span>
                        <span className="text-xs text-gray-400">
                          ({spreadsInExpiry.length} {spreadsInExpiry.length === 1 ? 'strategy' : 'strategies'})
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">
                        Best: <span className={bestIRR > 0 ? "text-green-400" : "text-red-400"}>
                          {(bestIRR * 100).toFixed(1)}%
                        </span> annualized
                      </div>
                    </div>

                    {/* Strategies Table (Collapsible) */}
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-900">
                            <tr className="border-b border-gray-700">
                              <th className="text-left py-2 px-2 text-gray-400">Strategy</th>
                              <th className="text-left py-2 px-2 text-gray-400">Strikes</th>
                              <th className="text-left py-2 px-2 text-gray-400">Leg Prices</th>
                              <th className="text-left py-2 px-2 text-gray-400">Market Data</th>
                              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                                Midpoint Entry
                              </th>
                              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                                Far Touch Entry
                              </th>
                              <th className="text-left py-2 px-2 text-gray-400">Updated</th>
                              <th className="text-center py-2 px-2 text-gray-400">Action</th>
                            </tr>
                            <tr className="border-b border-gray-700">
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Cost</th>
                              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Profit</th>
                              <th
                                className="text-right py-1 px-2 text-gray-400 text-[10px] cursor-pointer hover:text-gray-200"
                                onClick={() => handleSort("annualizedYield")}
                              >
                                IRR {sortKey === "annualizedYield" && (sortDir === "desc" ? "↓" : "↑")}
                              </th>
                              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Cost</th>
                              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">Profit</th>
                              <th className="text-right py-1 px-2 text-gray-400 text-[10px]">IRR</th>
                              <th></th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {spreadsInExpiry.map((spread) => {
                              const metrics = calculateMetrics(spread);

                              return (
                                <tr
                                  key={spread.id}
                                  className="border-b border-gray-800 hover:bg-gray-800"
                                >
                                  <td className="py-2 px-2 text-gray-300">
                                    {formatStrategyType(spread)}
                                  </td>

                                  {/* Strategy metrics columns */}
                                  <StrategyMetricsCells metrics={metrics} />

                                  {/* Last Updated */}
                                  <td className="py-2 px-2 text-gray-400 text-[10px]">
                                    {spread.lastUpdated
                                      ? new Date(spread.lastUpdated).toLocaleString('en-US', {
                                          month: 'numeric',
                                          day: 'numeric',
                                          hour: 'numeric',
                                          minute: '2-digit',
                                          hour12: true
                                        })
                                      : "—"}
                                  </td>

                                  {/* Actions */}
                                  <td className="py-2 px-2 text-center">
                                    <div className="flex gap-1 justify-center items-center">
                                      {/* Refresh button */}
                                      <div className="relative">
                                        <button
                                          onClick={() => onRefreshSingle(spread.id)}
                                          disabled={refreshingSpreads.has(spread.id)}
                                          className={`w-6 h-6 flex items-center justify-center hover:bg-gray-700 rounded transition-colors ${
                                            refreshingSpreads.has(spread.id) 
                                              ? 'animate-spin text-gray-400' 
                                              : failedSpreads.has(spread.id)
                                                ? 'text-yellow-400 hover:text-yellow-300'
                                                : 'text-gray-400 hover:text-white'
                                          }`}
                                          title={failedSpreads.has(spread.id) 
                                            ? `Update failed: ${failedSpreads.get(spread.id)?.reason}` 
                                            : "Refresh this spread"
                                          }
                                        >
                                          ↻
                                        </button>
                                        {failedSpreads.has(spread.id) && !refreshingSpreads.has(spread.id) && (
                                          <span 
                                            className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-500 rounded-full text-[8px] text-black font-bold flex items-center justify-center"
                                            title={failedSpreads.get(spread.id)?.reason}
                                          >
                                            !
                                          </span>
                                        )}
                                      </div>
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

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
