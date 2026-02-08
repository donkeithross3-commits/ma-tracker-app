"use client";

import { useState, useMemo, useCallback } from "react";
import type { CandidateStrategy } from "@/types/ma-options";
import { StrategyTableHeader, StrategyMetricsCells, STRATEGY_COL_KEYS, type StrategyMetrics, type StrategyType } from "./StrategyColumns";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

const CANDIDATE_COLUMNS: ColumnDef[] = [
  { key: "strikes", label: "Strikes" },
  { key: "legPrices", label: "Leg Prices" },
  { key: "market", label: "Market Data" },
  { key: "midEntry", label: "Midpoint Entry" },
  { key: "farEntry", label: "Far Touch Entry" },
  { key: "action", label: "Actions" },
];
const CANDIDATE_DEFAULTS = ["strikes","legPrices","market","midEntry","farEntry","action"];
const CANDIDATE_LOCKED = ["action"];

interface CandidateStrategiesTableProps {
  candidates: CandidateStrategy[];
  onWatch: (strategy: CandidateStrategy) => void;
  dealPrice: number;
  daysToClose: number;
}

interface GroupedStrategies {
  [expiration: string]: {
    [strategyType: string]: CandidateStrategy[];
  };
}

interface RecalculatedMetrics {
  maxProfit: number;
  maxProfitFarTouch: number;
  annualizedYield: number;
  annualizedYieldFarTouch: number;
}

export default function CandidateStrategiesTable({
  candidates,
  onWatch,
  dealPrice,
  daysToClose,
}: CandidateStrategiesTableProps) {
  const [sortKey, setSortKey] = useState<string>("annualizedYield");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Column visibility
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("candidateStrategies");
  const visibleColKeys = useMemo(() => savedCols ?? CANDIDATE_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleColKeys), [visibleColKeys]);
  const handleColumnsChange = useCallback(
    (keys: string[]) => setVisibleColumns("candidateStrategies", keys),
    [setVisibleColumns],
  );
  const stratVisibleSet = useMemo(
    () => new Set(STRATEGY_COL_KEYS.filter((k) => visibleSet.has(k))),
    [visibleSet],
  );
  const visibleColCount = useMemo(() => {
    let count = 0;
    for (const k of visibleColKeys) {
      count += (k === "midEntry" || k === "farEntry") ? 3 : 1;
    }
    return count;
  }, [visibleColKeys]);

  /**
   * Recalculate metrics for a strategy based on the current deal price
   * This mirrors the logic in Python scanner.py
   */
  const recalculateMetrics = useCallback((candidate: CandidateStrategy): RecalculatedMetrics => {
    const legs = candidate.legs;
    const netPremium = candidate.netPremium; // Midpoint entry cost
    const netPremiumFarTouch = candidate.netPremiumFarTouch; // Far touch entry cost
    
    // Calculate days to expiration
    let expiryDate: Date;
    if (candidate.expiration instanceof Date) {
      expiryDate = candidate.expiration;
    } else if (typeof candidate.expiration === 'string') {
      // Handle YYYYMMDD format (e.g., "20260515")
      if (/^\d{8}$/.test(candidate.expiration)) {
        const year = parseInt(candidate.expiration.substring(0, 4));
        const month = parseInt(candidate.expiration.substring(4, 6)) - 1; // 0-indexed
        const day = parseInt(candidate.expiration.substring(6, 8));
        expiryDate = new Date(year, month, day);
      } else {
        // Try ISO format or other parseable formats
        expiryDate = new Date(candidate.expiration);
      }
    } else {
      expiryDate = new Date(candidate.expiration);
    }
    
    const daysToExpiry = Math.max(1, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const yearsToExpiry = daysToExpiry / 365;
    
    let valueAtDealClose: number;
    
    if (candidate.strategyType === 'spread' || candidate.strategyType === 'call_vertical') {
      // Call spread: Buy lower strike, sell higher strike
      const buyLeg = legs.find(l => l.side === 'BUY');
      const sellLeg = legs.find(l => l.side === 'SELL');
      
      if (buyLeg && sellLeg) {
        const buyStrike = buyLeg.strike;
        const sellStrike = sellLeg.strike;
        
        // Value at deal close (same logic as Python scanner.py lines 992-1001)
        if (dealPrice >= sellStrike) {
          valueAtDealClose = sellStrike - buyStrike; // Full width
        } else if (dealPrice > buyStrike) {
          valueAtDealClose = dealPrice - buyStrike; // Partial
        } else {
          valueAtDealClose = 0; // OTM
        }
      } else {
        valueAtDealClose = 0;
      }
    } else if (candidate.strategyType === 'call' || candidate.strategyType === 'long_call') {
      // Long call: profit = intrinsic value at deal price - premium
      const strike = legs[0]?.strike || 0;
      valueAtDealClose = Math.max(0, dealPrice - strike);
    } else if (candidate.strategyType === 'put' || candidate.strategyType === 'long_put') {
      // Long put: profit = intrinsic value at deal price - premium
      // For M&A deals, we assume deal closes at deal price, so put is worthless
      const strike = legs[0]?.strike || 0;
      valueAtDealClose = Math.max(0, strike - dealPrice);
    } else if (candidate.strategyType === 'put_spread' || candidate.strategyType === 'put_vertical') {
      // Put credit spread: Max profit is the credit received (doesn't change with deal price)
      // Since it's a credit spread, maxProfit = credit received when deal closes above short strike
      // For now, keep original profit since put spreads profit when deal closes
      return {
        maxProfit: candidate.maxProfit,
        maxProfitFarTouch: candidate.maxProfit, // Far touch profit is same for credit spreads
        annualizedYield: candidate.annualizedYield,
        annualizedYieldFarTouch: candidate.annualizedYieldFarTouch,
      };
    } else {
      // Unknown strategy type, return original
      return {
        maxProfit: candidate.maxProfit,
        maxProfitFarTouch: candidate.maxProfit,
        annualizedYield: candidate.annualizedYield,
        annualizedYieldFarTouch: candidate.annualizedYieldFarTouch,
      };
    }
    
    // Calculate profits
    const maxProfit = valueAtDealClose - netPremium;
    const maxProfitFarTouch = valueAtDealClose - netPremiumFarTouch;
    
    // Calculate annualized yields
    const annualizedYield = netPremium > 0 ? (maxProfit / netPremium) / yearsToExpiry : 0;
    const annualizedYieldFarTouch = netPremiumFarTouch > 0 ? (maxProfitFarTouch / netPremiumFarTouch) / yearsToExpiry : 0;
    
    return {
      maxProfit,
      maxProfitFarTouch,
      annualizedYield,
      annualizedYieldFarTouch,
    };
  }, [dealPrice]);

  // Create a map of candidate ID to recalculated metrics
  const recalculatedMetricsMap = useMemo(() => {
    const map = new Map<string, RecalculatedMetrics>();
    candidates.forEach((candidate) => {
      map.set(candidate.id, recalculateMetrics(candidate));
    });
    return map;
  }, [candidates, recalculateMetrics]);

  // Group strategies by expiration, then by strategy type
  const groupedStrategies = useMemo(() => {
    const grouped: GroupedStrategies = {};
    
    candidates.forEach((candidate) => {
      // Convert Date to ISO string for grouping key
      const expirationKey = candidate.expiration instanceof Date 
        ? candidate.expiration.toISOString().split('T')[0]
        : candidate.expiration;
      
      if (!grouped[expirationKey]) {
        grouped[expirationKey] = {};
      }
      if (!grouped[expirationKey][candidate.strategyType]) {
        grouped[expirationKey][candidate.strategyType] = [];
      }
      grouped[expirationKey][candidate.strategyType].push(candidate);
    });

    // Sort strategies within each group using recalculated metrics
    Object.keys(grouped).forEach((expiration) => {
      Object.keys(grouped[expiration]).forEach((strategyType) => {
        grouped[expiration][strategyType].sort((a, b) => {
          // Use recalculated annualizedYield for sorting when that's the sort key
          let aVal: number;
          let bVal: number;
          
          if (sortKey === 'annualizedYield') {
            aVal = recalculatedMetricsMap.get(a.id)?.annualizedYield ?? a.annualizedYield;
            bVal = recalculatedMetricsMap.get(b.id)?.annualizedYield ?? b.annualizedYield;
          } else if (sortKey === 'maxProfit') {
            aVal = recalculatedMetricsMap.get(a.id)?.maxProfit ?? a.maxProfit;
            bVal = recalculatedMetricsMap.get(b.id)?.maxProfit ?? b.maxProfit;
          } else {
            aVal = (a as any)[sortKey];
            bVal = (b as any)[sortKey];
          }
          
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        });
      });
    });

    return grouped;
  }, [candidates, sortKey, sortDir, recalculatedMetricsMap]);

  // Sort expirations chronologically
  const sortedExpirations = useMemo(() => {
    return Object.keys(groupedStrategies).sort();
  }, [groupedStrategies]);

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

  const formatStrategyType = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      'spread': 'Call Spread',
      'put_spread': 'Put Spread',
      'call': 'Long Call',
      'put': 'Long Put',
    };
    return typeMap[type] || type;
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-gray-100">
          Candidate Strategies ({candidates.length})
        </h3>
        <ColumnChooser
          columns={CANDIDATE_COLUMNS}
          visible={visibleColKeys}
          defaults={CANDIDATE_DEFAULTS}
          onChange={handleColumnsChange}
          locked={CANDIDATE_LOCKED}
        />
      </div>

      <div className="space-y-4">
        {sortedExpirations.map((expiration) => {
          const strategiesByType = groupedStrategies[expiration];
          const strategyTypes = Object.keys(strategiesByType).sort();
          const totalInExpiration = Object.values(strategiesByType).reduce(
            (sum, strategies) => sum + strategies.length,
            0
          );

          return (
            <div key={expiration} className="border border-gray-700 rounded">
              {/* Expiration Header */}
              <div className="bg-gray-800 px-4 py-2 flex justify-between items-center">
                <h4 className="text-sm font-semibold text-gray-100">
                  Expiration: {expiration}
                  <span className="text-gray-400 ml-2 font-normal">
                    ({totalInExpiration} strategies)
                  </span>
                </h4>
              </div>

              {/* Strategy Type Groups */}
              {strategyTypes.map((strategyType) => {
                const strategies = strategiesByType[strategyType];
                const groupKey = `${expiration}-${strategyType}`;
                const isExpanded = expandedGroups.has(groupKey);

                return (
                  <div key={strategyType} className="border-t border-gray-700">
                    {/* Strategy Type Header */}
                    <div
                      className="bg-gray-850 px-4 py-2 flex justify-between items-center cursor-pointer hover:bg-gray-800"
                      onClick={() => toggleGroup(groupKey)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                        <span className="text-sm font-medium text-gray-200">
                          {formatStrategyType(strategyType)}
                        </span>
                        <span className="text-xs text-gray-400">
                          ({strategies.length})
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">
                        Best: {((recalculatedMetricsMap.get(strategies[0].id)?.annualizedYield ?? strategies[0].annualizedYield) * 100).toFixed(1)}% annualized
                      </div>
                    </div>

                    {/* Strategy Table (Collapsible) */}
                    {isExpanded && (
                      <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleColCount } as React.CSSProperties}>
                        <table className="w-full text-xs d-table">
                          <thead className="bg-gray-900">
                            <StrategyTableHeader 
                              onSort={handleSort} 
                              sortKey={sortKey} 
                              strategyType={strategyType as StrategyType}
                              visibleCols={stratVisibleSet}
                            />
                            {visibleSet.has("action") && (
                              <tr className="border-b border-gray-700">
                                <th className="text-center py-2 px-2 text-gray-400">Action</th>
                              </tr>
                            )}
                          </thead>
                          <tbody>
                            {strategies.map((candidate) => {
                              // Get recalculated metrics for this candidate
                              const recalculated = recalculatedMetricsMap.get(candidate.id);
                              
                              // Convert candidate to StrategyMetrics format with recalculated values
                              const metrics: StrategyMetrics = {
                                legs: candidate.legs as any,
                                netPremium: candidate.netPremium,
                                netPremiumFarTouch: candidate.netPremiumFarTouch,
                                maxProfit: recalculated?.maxProfit ?? candidate.maxProfit,
                                maxProfitFarTouch: recalculated?.maxProfitFarTouch,
                                annualizedYield: recalculated?.annualizedYield ?? candidate.annualizedYield,
                                annualizedYieldFarTouch: recalculated?.annualizedYieldFarTouch ?? candidate.annualizedYieldFarTouch,
                                liquidityScore: candidate.liquidityScore,
                              };

                              return (
                                <tr
                                  key={candidate.id}
                                  className="border-b border-gray-800 hover:bg-gray-800"
                                >
                                  {/* Strategy metrics columns - type-specific */}
                                  <StrategyMetricsCells 
                                    metrics={metrics} 
                                    strategyType={strategyType as StrategyType}
                                    visibleCols={stratVisibleSet}
                                  />

                                  {/* Action button */}
                                  {visibleSet.has("action") && (
                                    <td className="py-2 px-2 text-center">
                                      <button
                                        onClick={() => onWatch(candidate)}
                                        className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
                                      >
                                        Watch
                                      </button>
                                    </td>
                                  )}
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

        {candidates.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No candidate strategies found. Try adjusting the scan parameters.
          </div>
        )}
      </div>
    </div>
  );
}

