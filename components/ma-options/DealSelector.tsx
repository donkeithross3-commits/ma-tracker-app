"use client";

import { useState } from "react";
import type { DealForScanner } from "@/types/ma-options";

interface DealSelectorProps {
  deals: DealForScanner[];
  selectedDeal: DealForScanner | null;
  onSelectDeal: (deal: DealForScanner) => void;
}

export default function DealSelector({
  deals,
  selectedDeal,
  onSelectDeal,
}: DealSelectorProps) {
  const [filter, setFilter] = useState("");
  const [hideNoOptions, setHideNoOptions] = useState(false);
  const [hideClosedDeals, setHideClosedDeals] = useState(false);

  const filteredDeals = deals.filter((deal) => {
    // Text filter
    const matchesText =
      deal.ticker.toLowerCase().includes(filter.toLowerCase()) ||
      deal.targetName.toLowerCase().includes(filter.toLowerCase());
    
    // No options filter
    const matchesOptionsFilter = hideNoOptions ? !deal.noOptionsAvailable : true;
    
    // Closed deals filter (negative days to close)
    const matchesClosedFilter = hideClosedDeals ? deal.daysToClose >= 0 : true;
    
    return matchesText && matchesOptionsFilter && matchesClosedFilter;
  });

  const noOptionsCount = deals.filter(d => d.noOptionsAvailable).length;
  const closedDealsCount = deals.filter(d => d.daysToClose < 0).length;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-100">Select Deal</h2>
        <div className="text-xs text-gray-400">
          Showing {filteredDeals.length} of {deals.length} deals
        </div>
      </div>

      {/* Filter Input */}
      <input
        type="text"
        placeholder="Filter by ticker or name..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm mb-3"
      />

      {/* Toggle Filters */}
      <div className="flex flex-col gap-2 mb-3 pb-3 border-b border-gray-700">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-gray-100 select-none">
          <input
            type="checkbox"
            checked={hideNoOptions}
            onChange={(e) => setHideNoOptions(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <span>Hide tickers with no options</span>
          {noOptionsCount > 0 && (
            <span className="text-xs text-orange-400 px-2 py-0.5 bg-orange-900/30 border border-orange-700 rounded">
              {noOptionsCount}
            </span>
          )}
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-gray-100 select-none">
          <input
            type="checkbox"
            checked={hideClosedDeals}
            onChange={(e) => setHideClosedDeals(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <span>Hide closed deals (past expected close)</span>
          {closedDealsCount > 0 && (
            <span className="text-xs text-red-400 px-2 py-0.5 bg-red-900/30 border border-red-700 rounded">
              {closedDealsCount}
            </span>
          )}
        </label>
      </div>

      {/* Deals Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-2 text-gray-400 font-medium">
                Ticker
              </th>
              <th className="text-left py-2 px-2 text-gray-400 font-medium">
                Target
              </th>
              <th className="text-left py-2 px-2 text-gray-400 font-medium">
                Acquiror
              </th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">
                Deal Price
              </th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">
                Days to Close
              </th>
              <th className="text-center py-2 px-2 text-gray-400 font-medium">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredDeals.map((deal) => (
              <tr
                key={deal.id}
                className={`border-b border-gray-800 hover:bg-gray-800 ${
                  selectedDeal?.id === deal.id ? "bg-gray-800" : ""
                } ${deal.noOptionsAvailable ? "opacity-60" : ""}`}
              >
                <td className="py-2 px-2 text-gray-100 font-mono">
                  <div className="flex items-center gap-2">
                    {deal.ticker}
                    {deal.noOptionsAvailable && (
                      <span
                        className="text-xs text-orange-400 border border-orange-400 px-1 rounded"
                        title={`No options found${
                          deal.lastOptionsCheck
                            ? ` (checked ${new Date(
                                deal.lastOptionsCheck
                              ).toLocaleDateString()})`
                            : ""
                        }`}
                      >
                        No Options
                      </span>
                    )}
                    {!deal.noOptionsAvailable && deal.lastOptionsCheck && deal.watchedSpreadsCount === 0 && (
                      <span
                        className="text-xs text-green-500/70 border border-green-600/60 px-1 rounded font-semibold"
                        title="Options available but no spreads watched yet"
                      >
                        0
                      </span>
                    )}
                    {deal.watchedSpreadsCount > 0 && (
                      <span
                        className="text-xs text-green-400 border border-green-400 px-1 rounded font-semibold"
                        title={`${deal.watchedSpreadsCount} active spread${deal.watchedSpreadsCount !== 1 ? 's' : ''} on watchlist`}
                      >
                        {deal.watchedSpreadsCount}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2 text-gray-300">{deal.targetName}</td>
                <td className="py-2 px-2 text-gray-300">
                  {deal.acquirorName || "—"}
                </td>
                <td className="py-2 px-2 text-right text-gray-100 font-mono">
                  ${deal.dealPrice.toFixed(2)}
                </td>
                <td className="py-2 px-2 text-right text-gray-100 font-mono">
                  {deal.daysToClose}
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    onClick={() => onSelectDeal(deal)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredDeals.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No deals found
          </div>
        )}
      </div>
    </div>
  );
}

