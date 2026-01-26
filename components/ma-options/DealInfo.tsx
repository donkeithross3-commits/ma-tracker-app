"use client";

import { useState, useEffect } from "react";
import type { ScannerDeal } from "@/types/ma-options";

export interface ScanParameters {
  dealPrice: number; // User-editable deal price
  daysBeforeClose: number;
  strikeLowerBound: number; // percentage below deal price for long leg (e.g., 20 = 20%)
  strikeUpperBound: number; // percentage above deal price for long leg (e.g., 10 = 10%)
  shortStrikeLower: number; // percentage below deal price for short leg (e.g., 10 = 10%)
  shortStrikeUpper: number; // percentage above deal price for short leg (e.g., 20 = 20%)
  topStrategiesPerExpiration: number;
}

interface DealInfoProps {
  deal: ScannerDeal;
  onLoadChain: (params: ScanParameters) => void;
  loading: boolean;
  ibConnected: boolean;
}

export default function DealInfo({ deal, onLoadChain, loading, ibConnected }: DealInfoProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dealPrice, setDealPrice] = useState(deal.expectedClosePrice);
  
  // Reset deal price when deal changes
  useEffect(() => {
    setDealPrice(deal.expectedClosePrice);
  }, [deal.id, deal.expectedClosePrice]);

  const [params, setParams] = useState<ScanParameters>({
    dealPrice: deal.expectedClosePrice,
    daysBeforeClose: 60,
    strikeLowerBound: 20,
    strikeUpperBound: 10,
    shortStrikeLower: 10,
    shortStrikeUpper: 20,
    topStrategiesPerExpiration: 5,
  });

  const inputClass = "w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="bg-gray-900 border-2 border-blue-600 rounded p-4 shadow-lg">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-100">{deal.ticker}</h2>
          <p className="text-sm text-gray-400">{deal.targetName}</p>
          <p className="text-xs text-green-400 mt-1">✓ Selected</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
          >
            {showAdvanced ? "Hide" : "Show"} Parameters
          </button>
          <div className="relative group">
            <button
              onClick={() => {
                if (!ibConnected) {
                  alert("⚠️ IB TWS Not Connected\n\nPlease start Interactive Brokers TWS or Gateway and ensure it's accepting API connections on port 7497.\n\nThe connection status indicator is shown in the top-right corner of the page.");
                  return;
                }
                onLoadChain({ ...params, dealPrice });
              }}
              disabled={loading || !ibConnected}
              className={`px-4 py-2 text-white text-sm rounded font-semibold transition-colors ${
                loading || !ibConnected
                  ? "bg-gray-700 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
              title={!ibConnected ? "IB TWS must be connected to scan options" : ""}
            >
              {loading ? "Loading..." : "Load Option Chain"}
            </button>
            {!ibConnected && !loading && (
              <div className="absolute bottom-full mb-2 right-0 w-64 bg-orange-900 border border-orange-700 text-orange-100 text-xs rounded p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                ⚠️ IB TWS is not connected. Please start Interactive Brokers and check the connection status in the top-right corner.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm mb-4">
        <div>
          <div className="text-gray-500 mb-1">Deal Price</div>
          <input
            type="number"
            step="0.01"
            min="0"
            value={dealPrice}
            onChange={(e) => setDealPrice(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-100 font-mono text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div>
          <div className="text-gray-500">Days to Close</div>
          <div className="text-gray-100 font-mono">{deal.daysToClose}</div>
        </div>
        <div>
          <div className="text-gray-500">Expected Close</div>
          <div className="text-gray-100 font-mono text-xs">{deal.expectedCloseDate}</div>
        </div>
        <div>
          <div className="text-gray-500">Notes</div>
          <div className="text-gray-100 text-xs truncate" title={deal.notes || "—"}>{deal.notes || "—"}</div>
        </div>
      </div>

      {/* Scan Parameters - Compact Layout */}
      {showAdvanced && (
        <div className="border-t border-gray-700 pt-4 mt-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-100">Scan Parameters</h3>
          
          {/* Row 1: Expirations */}
          <div className="bg-gray-800/50 rounded p-3">
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-400 w-32">Days Before Close</span>
              <input
                type="number"
                min="0"
                max="180"
                value={params.daysBeforeClose}
                onChange={(e) => setParams({ ...params, daysBeforeClose: parseInt(e.target.value) || 0 })}
                className={inputClass}
              />
              <span className="text-xs text-gray-500">
                {params.daysBeforeClose === 0 
                  ? "2 expirations after close + exact match if exists"
                  : `Expirations from ${params.daysBeforeClose} days before close through 2 after`}
              </span>
            </div>
          </div>

          {/* Row 2: Strike Ranges - Side by Side */}
          <div className="grid grid-cols-2 gap-4">
            {/* Long Leg (Buy) */}
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs font-medium text-blue-400 mb-2">Long Leg (Buy)</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.strikeLowerBound}
                    onChange={(e) => setParams({ ...params, strikeLowerBound: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-xs text-gray-500">% below deal</span>
                  <span className="text-xs text-gray-600 ml-auto">${(dealPrice * (1 - params.strikeLowerBound / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">Upper</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.strikeUpperBound}
                    onChange={(e) => setParams({ ...params, strikeUpperBound: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-xs text-gray-500">% above deal</span>
                  <span className="text-xs text-gray-600 ml-auto">${(dealPrice * (1 + params.strikeUpperBound / 100)).toFixed(0)}</span>
                </div>
              </div>
            </div>

            {/* Short Leg (Sell) */}
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs font-medium text-orange-400 mb-2">Short Leg (Sell)</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.shortStrikeLower}
                    onChange={(e) => setParams({ ...params, shortStrikeLower: parseInt(e.target.value) || 10 })}
                    className={inputClass}
                  />
                  <span className="text-xs text-gray-500">% below deal</span>
                  <span className="text-xs text-gray-600 ml-auto">${(dealPrice * (1 - params.shortStrikeLower / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">Upper</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.shortStrikeUpper}
                    onChange={(e) => setParams({ ...params, shortStrikeUpper: parseInt(e.target.value) || 20 })}
                    className={inputClass}
                  />
                  <span className="text-xs text-gray-500">% above deal</span>
                  <span className="text-xs text-gray-600 ml-auto">${(dealPrice * (1 + params.shortStrikeUpper / 100)).toFixed(0)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Results + Reset */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-400">Top Strategies</span>
              <input
                type="number"
                min="1"
                max="20"
                value={params.topStrategiesPerExpiration}
                onChange={(e) => setParams({ ...params, topStrategiesPerExpiration: parseInt(e.target.value) || 5 })}
                className={inputClass}
              />
              <span className="text-xs text-gray-500">per expiration</span>
            </div>
            <button
              onClick={() => setParams({
                dealPrice: deal.expectedClosePrice,
                daysBeforeClose: 60,
                strikeLowerBound: 20,
                strikeUpperBound: 10,
                shortStrikeLower: 10,
                shortStrikeUpper: 20,
                topStrategiesPerExpiration: 5,
              })}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
            >
              Reset to Defaults
            </button>
          </div>

          {/* Quick Guide */}
          <div className="p-2 bg-gray-800 rounded text-xs text-gray-400">
            <strong className="text-gray-300">Quick Guide:</strong>
            <ul className="mt-1 space-y-1 ml-4 list-disc">
              <li><strong>Days Before Close:</strong> Include expirations from N days before close through 2 after (0 = 2 after + exact match only)</li>
              <li><strong>Long Leg:</strong> Strike range to fetch for the bought option (wider = more spread combinations)</li>
              <li><strong>Short Leg:</strong> Strike range for the sold option near deal price (where stock converges at close)</li>
              <li><strong>Top Strategies:</strong> Best N spreads per expiration ranked by annualized return</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
