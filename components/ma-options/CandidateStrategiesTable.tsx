"use client";

import { useState, useMemo } from "react";
import type { CandidateStrategy } from "@/types/ma-options";
import { StrategyTableHeader, StrategyMetricsCells, type StrategyMetrics, type StrategyType } from "./StrategyColumns";

interface CandidateStrategiesTableProps {
  candidates: CandidateStrategy[];
  onWatch: (strategy: CandidateStrategy) => void;
}

interface GroupedStrategies {
  [expiration: string]: {
    [strategyType: string]: CandidateStrategy[];
  };
}

export default function CandidateStrategiesTable({
  candidates,
  onWatch,
}: CandidateStrategiesTableProps) {
  const [sortKey, setSortKey] = useState<string>("annualizedYield");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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

    // Sort strategies within each group
    Object.keys(grouped).forEach((expiration) => {
      Object.keys(grouped[expiration]).forEach((strategyType) => {
        grouped[expiration][strategyType].sort((a, b) => {
          const aVal = (a as any)[sortKey];
          const bVal = (b as any)[sortKey];
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        });
      });
    });

    return grouped;
  }, [candidates, sortKey, sortDir]);

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
      <h3 className="text-lg font-semibold text-gray-100 mb-3">
        Candidate Strategies ({candidates.length})
      </h3>

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
                        Best: {(strategies[0].annualizedYield * 100).toFixed(1)}% annualized
                      </div>
                    </div>

                    {/* Strategy Table (Collapsible) */}
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-900">
                            <StrategyTableHeader 
                              onSort={handleSort} 
                              sortKey={sortKey} 
                              strategyType={strategyType as StrategyType}
                            />
                            <tr className="border-b border-gray-700">
                              <th className="text-center py-2 px-2 text-gray-400">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {strategies.map((candidate) => {
                              // Convert candidate to StrategyMetrics format
                              const metrics: StrategyMetrics = {
                                legs: candidate.legs as any,
                                netPremium: candidate.netPremium,
                                netPremiumFarTouch: candidate.netPremiumFarTouch,
                                maxProfit: candidate.maxProfit,
                                annualizedYield: candidate.annualizedYield,
                                annualizedYieldFarTouch: candidate.annualizedYieldFarTouch,
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
                                  />

                                  {/* Action button */}
                                  <td className="py-2 px-2 text-center">
                                    <button
                                      onClick={() => onWatch(candidate)}
                                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
                                    >
                                      Watch
                                    </button>
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

        {candidates.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No candidate strategies found. Try adjusting the scan parameters.
          </div>
        )}
      </div>
    </div>
  );
}

