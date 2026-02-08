"use client";

import { useState, useMemo, useCallback } from "react";
import type { OptionChainResponse, OptionContract } from "@/types/ma-options";
import { formatCompactVolOi } from "@/lib/utils";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

const CHAIN_COLUMNS: ColumnDef[] = [
  { key: "expiry", label: "Expiry" },
  { key: "strike", label: "Strike" },
  { key: "type", label: "Type" },
  { key: "bid", label: "Bid" },
  { key: "ask", label: "Ask" },
  { key: "mid", label: "Mid" },
  { key: "vol", label: "Volume" },
  { key: "oi", label: "Open Interest" },
  { key: "watch", label: "Watch" },
];
const CHAIN_DEFAULTS = ["expiry","strike","type","bid","ask","mid","vol","oi","watch"];
const CHAIN_LOCKED = ["expiry", "strike"];

interface OptionChainViewerProps {
  chainData: OptionChainResponse;
  onWatchSingleLeg?: (contract: OptionContract) => void;
}

export default function OptionChainViewer({ chainData, onWatchSingleLeg }: OptionChainViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false); // Default to collapsed per user preference
  const [addingContract, setAddingContract] = useState<string | null>(null);

  // Column visibility
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("optionChain");
  const visibleColKeys = useMemo(() => savedCols ?? CHAIN_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleColKeys), [visibleColKeys]);
  const handleColumnsChange = useCallback(
    (keys: string[]) => setVisibleColumns("optionChain", keys),
    [setVisibleColumns],
  );
  const visibleColCount = visibleColKeys.length;

  // Helper to get status color
  const getStatusColor = (age: number | undefined) => {
    if (age === undefined) return "bg-gray-500";
    if (age < 5) return "bg-green-500";
    if (age < 30) return "bg-yellow-500";
    if (age < 1440) return "bg-orange-500";
    return "bg-gray-500";
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex justify-between items-center mb-1">
        <h3 className="text-lg font-semibold text-gray-100">Option Chain</h3>
        <div className="flex items-center gap-4">
          {chainData.source === "agent" && (
            <div className="flex items-center gap-2 text-xs">
              <div 
                className={`w-2 h-2 rounded-full ${getStatusColor(chainData.ageMinutes)}`}
                title={chainData.ageMinutes !== undefined ? `${chainData.ageMinutes} minutes old` : "Unknown age"}
              ></div>
              <span className="text-gray-400">
                Source: <span className="text-blue-400">{chainData.agentId}</span> 
                {chainData.ageMinutes !== undefined && ` (${chainData.ageMinutes}m ago)`}
              </span>
            </div>
          )}
          <ColumnChooser
            columns={CHAIN_COLUMNS}
            visible={visibleColKeys}
            defaults={CHAIN_DEFAULTS}
            onChange={handleColumnsChange}
            locked={CHAIN_LOCKED}
          />
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-blue-400 hover:text-blue-300 font-medium"
          >
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="text-sm text-gray-400 mb-3 flex gap-3">
        <span>Spot Price: <span className="text-gray-100">${chainData.spotPrice.toFixed(2)}</span></span>
        <span>|</span>
        <span>{chainData.expirations.length} expirations</span>
        <span>|</span>
        <span>{chainData.contracts.length} contracts</span>
      </div>

      {isExpanded && (
        <div className="overflow-x-auto max-h-96 overflow-y-auto d-table-wrap" style={{ "--visible-cols": visibleColCount } as React.CSSProperties}>
          <table className="w-full text-xs d-table">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-700">
                {visibleSet.has("expiry") && <th className="text-left py-1 px-1 text-gray-400">Expiry</th>}
                {visibleSet.has("strike") && <th className="text-right py-1 px-1 text-gray-400">Strike</th>}
                {visibleSet.has("type") && <th className="text-center py-1 px-1 text-gray-400">Type</th>}
                {visibleSet.has("bid") && <th className="text-right py-1 px-1 text-gray-400">Bid</th>}
                {visibleSet.has("ask") && <th className="text-right py-1 px-1 text-gray-400">Ask</th>}
                {visibleSet.has("mid") && <th className="text-right py-1 px-1 text-gray-400">Mid</th>}
                {visibleSet.has("vol") && <th className="text-right py-1 px-1 text-gray-400">Vol</th>}
                {visibleSet.has("oi") && <th className="text-right py-1 px-1 text-gray-400">OI</th>}
                {onWatchSingleLeg && visibleSet.has("watch") && (
                  <th className="text-center py-1 px-1 text-gray-400 w-8">Watch</th>
                )}
              </tr>
            </thead>
            <tbody>
              {chainData.contracts.map((contract, idx) => {
                const contractKey = `${contract.expiry}_${contract.strike}_${contract.right}`;
                const isAdding = addingContract === contractKey;
                
                const handleAddClick = async () => {
                  if (!onWatchSingleLeg) return;
                  setAddingContract(contractKey);
                  try {
                    await onWatchSingleLeg(contract);
                  } finally {
                    setAddingContract(null);
                  }
                };
                
                return (
                  <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800">
                    {visibleSet.has("expiry") && <td className="py-1 px-1 text-gray-300">{contract.expiry}</td>}
                    {visibleSet.has("strike") && <td className="py-1 px-1 text-right text-gray-100">{contract.strike}</td>}
                    {visibleSet.has("type") && <td className="py-1 px-1 text-center text-gray-100">{contract.right}</td>}
                    {visibleSet.has("bid") && <td className="py-1 px-1 text-right text-gray-100">{contract.bid.toFixed(2)}</td>}
                    {visibleSet.has("ask") && <td className="py-1 px-1 text-right text-gray-100">{contract.ask.toFixed(2)}</td>}
                    {visibleSet.has("mid") && <td className="py-1 px-1 text-right text-gray-100">{contract.mid.toFixed(2)}</td>}
                    {visibleSet.has("vol") && <td className="py-1 px-1 text-right text-gray-300">{formatCompactVolOi(contract.volume)}</td>}
                    {visibleSet.has("oi") && <td className="py-1 px-1 text-right text-gray-300">{formatCompactVolOi(contract.open_interest)}</td>}
                    {onWatchSingleLeg && visibleSet.has("watch") && (
                      <td className="py-1 px-1 text-center">
                        <button
                          onClick={handleAddClick}
                          disabled={isAdding || contract.bid <= 0}
                          className={`w-5 h-5 rounded text-xs font-bold transition-colors ${
                            isAdding
                              ? 'bg-gray-600 text-gray-400 cursor-wait'
                              : contract.bid <= 0
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-green-700 hover:bg-green-600 text-white cursor-pointer'
                          }`}
                          title={
                            contract.bid <= 0 
                              ? "No bid - contract may be illiquid" 
                              : `Add ${contract.strike}${contract.right} to watchlist`
                          }
                        >
                          {isAdding ? '...' : '+'}
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
}

