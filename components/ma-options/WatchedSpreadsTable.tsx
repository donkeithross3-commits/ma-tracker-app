"use client";

import { useState, useMemo } from "react";
import type { WatchedSpreadDTO, SpreadUpdateFailure } from "@/types/ma-options";
import { StrategyMetricsCells, type StrategyMetrics } from "./StrategyColumns";
import SpreadAnalysisModal from "./SpreadAnalysisModal";

/**
 * Format timestamp for display in Eastern Time
 * Shows "X:XX PM ET" for today, or "Jan 11, X:XX PM ET" for other days
 */
function formatTimestampET(timestamp: string | null): string {
  if (!timestamp) return "";
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "";
  
  const options: Intl.DateTimeFormatOptions = { 
    hour: 'numeric', 
    minute: '2-digit',
    timeZone: 'America/New_York'
  };
  
  // Check if date is today in Eastern Time
  const nowET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const dateET = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const isToday = nowET === dateET;
  
  const timeStr = date.toLocaleTimeString('en-US', options);
  
  if (isToday) {
    return `${timeStr} ET`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    return `${dateStr}, ${timeStr} ET`;
  }
}

/**
 * Format timestamp for compact display in table rows
 * Shows just time for today, or "M/D H:MM" for other days
 */
function formatTimestampCompact(timestamp: string | null): string {
  if (!timestamp) return "—";
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "—";
  
  // Check if date is today in Eastern Time
  const nowET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const dateET = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const isToday = nowET === dateET;
  
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    timeZone: 'America/New_York'
  });
  
  if (isToday) {
    return timeStr;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    return `${dateStr} ${timeStr}`;
  }
}

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

interface GroupedSpread extends WatchedSpreadDTO {
  isFirstInTicker: boolean;
  isLastInTicker: boolean;
  isFirstInExpiration: boolean;
  isLastInExpiration: boolean;
  tickerRowSpan: number;
  expirationRowSpan: number;
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

  // Group and sort spreads by ticker, then by expiration, then by sort key
  const groupedSpreads = useMemo(() => {
    // First, group by ticker then expiration
    const byTicker: { [ticker: string]: { [exp: string]: WatchedSpreadDTO[] } } = {};
    
    spreads.forEach((spread) => {
      const ticker = spread.dealTicker;
      const exp = new Date(spread.expiration).toISOString().split('T')[0];
      
      if (!byTicker[ticker]) byTicker[ticker] = {};
      if (!byTicker[ticker][exp]) byTicker[ticker][exp] = [];
      byTicker[ticker][exp].push(spread);
    });

    // Sort within each group
    Object.keys(byTicker).forEach((ticker) => {
      Object.keys(byTicker[ticker]).forEach((exp) => {
        byTicker[ticker][exp].sort((a, b) => {
          const aVal = (a as any)[sortKey] ?? 0;
          const bVal = (b as any)[sortKey] ?? 0;
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        });
      });
    });

    // Flatten into ordered array with grouping metadata
    const result: GroupedSpread[] = [];
    const sortedTickers = Object.keys(byTicker).sort();
    
    sortedTickers.forEach((ticker) => {
      const expirations = Object.keys(byTicker[ticker]).sort();
      const tickerSpreads: WatchedSpreadDTO[] = [];
      
      expirations.forEach((exp) => {
        tickerSpreads.push(...byTicker[ticker][exp]);
      });
      
      let tickerIdx = 0;
      expirations.forEach((exp) => {
        const expSpreads = byTicker[ticker][exp];
        expSpreads.forEach((spread, expIdx) => {
          result.push({
            ...spread,
            isFirstInTicker: tickerIdx === 0,
            isLastInTicker: tickerIdx === tickerSpreads.length - 1,
            isFirstInExpiration: expIdx === 0,
            isLastInExpiration: expIdx === expSpreads.length - 1,
            tickerRowSpan: tickerIdx === 0 ? tickerSpreads.length : 0,
            expirationRowSpan: expIdx === 0 ? expSpreads.length : 0,
          });
          tickerIdx++;
        });
      });
    });

    return result;
  }, [spreads, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const formatStrategyType = (spread: WatchedSpreadDTO): string => {
    if (spread.strategyType === "spread") {
      return spread.legs[0]?.right === "C" ? "call sprd" : "put sprd";
    }
    const typeMap: { [key: string]: string } = {
      'long_call': 'long call',
      'long_put': 'long put',
      'call': 'long call',
      'put': 'long put',
      'put_spread': 'put sprd',
    };
    return typeMap[spread.strategyType] || spread.strategyType;
  };

  const formatExpiration = (expiration: string): string => {
    const date = new Date(expiration + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };
  
  const formatDealCloseDate = (closeDate: string | null | undefined): string => {
    if (!closeDate) return "—";
    const date = new Date(closeDate + "T00:00:00");
    // Compact format: M/D/YY (e.g., "3/31/26")
    return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
  };

  // Calculate metrics for a spread
  const calculateMetrics = (spread: WatchedSpreadDTO): StrategyMetrics => {
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
    };
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
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Ticker</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Exp</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Type</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Strikes</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Leg Prices</th>
              <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>Market</th>
              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                Midpoint Entry
              </th>
              <th className="text-center py-1 px-2 text-gray-400 border-b border-gray-700" colSpan={3}>
                Far Touch Entry
              </th>
              <th className="text-center py-2 px-2 text-gray-400" rowSpan={2}>Quote</th>
              <th className="text-center py-2 px-2 text-gray-400" rowSpan={2}>Action</th>
            </tr>
            <tr className="border-b border-gray-700">
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
            </tr>
          </thead>
          <tbody>
            {groupedSpreads.map((spread) => {
              const metrics = calculateMetrics(spread);
              const expStr = new Date(spread.expiration).toISOString().split('T')[0];

              return (
                <tr
                  key={spread.id}
                  className={`
                    hover:bg-gray-800
                    ${spread.isFirstInTicker ? 'border-t border-t-gray-500' : ''}
                    ${spread.isFirstInExpiration && !spread.isFirstInTicker ? 'border-t border-t-gray-700' : ''}
                    ${!spread.isFirstInExpiration ? 'border-t border-t-gray-800' : ''}
                    ${spread.isLastInTicker ? 'border-b border-b-gray-500' : ''}
                  `}
                >
                  {/* Ticker - only show on first row of ticker group */}
                  {spread.tickerRowSpan > 0 ? (
                    <td 
                      className="py-1 px-2 text-gray-100 font-mono font-bold text-sm border-l border-l-gray-500 bg-gray-800/50"
                      rowSpan={spread.tickerRowSpan}
                    >
                      <div>{spread.dealTicker}</div>
                      <div className="text-xs text-gray-500 font-normal">
                        ${spread.dealPrice?.toFixed(2)} · {formatDealCloseDate(spread.dealExpectedCloseDate)}
                      </div>
                    </td>
                  ) : null}

                  {/* Expiration - only show on first row of expiration group */}
                  {spread.expirationRowSpan > 0 ? (
                    <td 
                      className="py-1 px-2 text-gray-300 text-sm border-l border-l-gray-700"
                      rowSpan={spread.expirationRowSpan}
                    >
                      {formatExpiration(expStr)}
                    </td>
                  ) : null}

                  {/* Strategy Type */}
                  <td className="py-1 px-2 text-gray-300 text-sm">
                    {formatStrategyType(spread)}
                  </td>

                  {/* Strategy metrics columns */}
                  <StrategyMetricsCells metrics={metrics} />

                  {/* Quote Timestamp */}
                  <td className="py-1 px-2 text-center text-[10px] text-gray-500 whitespace-nowrap">
                    {formatTimestampCompact(spread.lastUpdated)}
                  </td>

                  {/* Actions */}
                  <td className="py-1 px-2 text-center border-r border-r-gray-500">
                    <div className="flex gap-1 justify-center items-center">
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
