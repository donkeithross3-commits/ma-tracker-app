"use client";

import { useState, useEffect } from "react";
import type { ScannerDeal } from "@/types/ma-options";

export interface ScanParameters {
  dealPrice: number; // User-editable deal price
  daysBeforeClose: number;
  // Call spread params
  callLongStrikeLower: number;   // % below deal for long call (deepest ITM)
  callLongStrikeUpper: number;   // % below deal for long call (shallowest, hardcoded 0 = at deal)
  callShortStrikeLower: number;  // % below deal for short call
  callShortStrikeUpper: number;  // % above deal for short call (higher offer buffer)
  // Put spread params
  putLongStrikeLower: number;    // % below deal for long put (deepest OTM)
  putLongStrikeUpper: number;    // % below deal for long put (shallowest, hardcoded 0 = at deal)
  putShortStrikeLower: number;   // % below deal for short put
  putShortStrikeUpper: number;   // % above deal for short put
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
    // Call spread defaults
    callLongStrikeLower: 25,    // 25% below deal (deep ITM)
    callLongStrikeUpper: 0,     // at deal price (hardcoded)
    callShortStrikeLower: 5,    // 5% below deal
    callShortStrikeUpper: 10,   // 10% above deal (higher offer buffer)
    // Put spread defaults
    putLongStrikeLower: 25,     // 25% below deal (deep OTM)
    putLongStrikeUpper: 0,      // at deal price (hardcoded)
    putShortStrikeLower: 5,     // 5% below deal
    putShortStrikeUpper: 3,     // 3% above deal (tight to deal)
    topStrategiesPerExpiration: 5,
  });

  // Derive SEPARATE fetch ranges for calls vs puts
  const callFetchLower = dealPrice * (1 - params.callLongStrikeLower / 100);
  const callFetchUpper = dealPrice * (1 + params.callShortStrikeUpper / 100);
  const putFetchLower = dealPrice * (1 - params.putLongStrikeLower / 100);
  const putFetchUpper = dealPrice * (1 + params.putShortStrikeUpper / 100);

  const inputClass = "w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  const disabledInputClass = "w-16 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-gray-500 text-sm text-center cursor-not-allowed";

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

          {/* Row 2: Call Spread and Put Spread side by side */}
          <div className="grid grid-cols-2 gap-4">
            {/* Call Spread */}
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs font-medium text-green-400 mb-3">Call Spread</div>
              
              {/* Long Leg */}
              <div className="mb-3">
                <div className="text-[10px] text-gray-500 mb-1">Long Leg (Buy)</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400 w-12">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.callLongStrikeLower}
                    onChange={(e) => setParams({ ...params, callLongStrikeLower: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.callLongStrikeLower / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-12">Upper</span>
                  <input
                    type="number"
                    value={params.callLongStrikeUpper}
                    disabled
                    className={disabledInputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.callLongStrikeUpper / 100)).toFixed(0)}</span>
                </div>
              </div>
              
              {/* Short Leg */}
              <div>
                <div className="text-[10px] text-gray-500 mb-1">Short Leg (Sell)</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400 w-12">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={params.callShortStrikeLower}
                    onChange={(e) => setParams({ ...params, callShortStrikeLower: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.callShortStrikeLower / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-12">Upper</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={params.callShortStrikeUpper}
                    onChange={(e) => setParams({ ...params, callShortStrikeUpper: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% above</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 + params.callShortStrikeUpper / 100)).toFixed(0)}</span>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mt-2">Higher offer buffer on short leg</div>
            </div>

            {/* Put Spread */}
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs font-medium text-orange-400 mb-3">Put Spread</div>
              
              {/* Long Leg */}
              <div className="mb-3">
                <div className="text-[10px] text-gray-500 mb-1">Long Leg (Buy)</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400 w-12">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={params.putLongStrikeLower}
                    onChange={(e) => setParams({ ...params, putLongStrikeLower: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.putLongStrikeLower / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-12">Upper</span>
                  <input
                    type="number"
                    value={params.putLongStrikeUpper}
                    disabled
                    className={disabledInputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.putLongStrikeUpper / 100)).toFixed(0)}</span>
                </div>
              </div>
              
              {/* Short Leg */}
              <div>
                <div className="text-[10px] text-gray-500 mb-1">Short Leg (Sell)</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400 w-12">Lower</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={params.putShortStrikeLower}
                    onChange={(e) => setParams({ ...params, putShortStrikeLower: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% below</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 - params.putShortStrikeLower / 100)).toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-12">Upper</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={params.putShortStrikeUpper}
                    onChange={(e) => setParams({ ...params, putShortStrikeUpper: parseInt(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-gray-500">% above</span>
                  <span className="text-[10px] text-gray-600 ml-auto">${(dealPrice * (1 + params.putShortStrikeUpper / 100)).toFixed(0)}</span>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mt-2">Tight to deal price on short leg</div>
            </div>
          </div>

          {/* Row 3: Derived Fetch Ranges (read-only) */}
          <div className="bg-gray-800/30 rounded p-2 border border-gray-700">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-green-500/70">Calls fetched:</span>
                <span className="text-gray-400 font-mono">${callFetchLower.toFixed(0)} - ${callFetchUpper.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-orange-500/70">Puts fetched:</span>
                <span className="text-gray-400 font-mono">${putFetchLower.toFixed(0)} - ${putFetchUpper.toFixed(0)}</span>
              </div>
            </div>
          </div>

          {/* Row 4: Results + Reset */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-400">Top Strategies</span>
              <input
                type="number"
                min="1"
                max="20"
                value={params.topStrategiesPerExpiration === 0 ? "" : params.topStrategiesPerExpiration}
                onChange={(e) => {
                  const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                  setParams({ ...params, topStrategiesPerExpiration: isNaN(val) ? 0 : val });
                }}
                onBlur={(e) => {
                  // Restore default if left empty
                  if (!e.target.value || parseInt(e.target.value) < 1) {
                    setParams({ ...params, topStrategiesPerExpiration: 5 });
                  }
                }}
                className={inputClass}
              />
              <span className="text-xs text-gray-500">per expiration</span>
            </div>
            <button
              onClick={() => setParams({
                dealPrice: deal.expectedClosePrice,
                daysBeforeClose: 60,
                callLongStrikeLower: 25,
                callLongStrikeUpper: 0,
                callShortStrikeLower: 5,
                callShortStrikeUpper: 10,
                putLongStrikeLower: 25,
                putLongStrikeUpper: 0,
                putShortStrikeLower: 5,
                putShortStrikeUpper: 3,
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
              <li><strong>Long Leg Lower:</strong> Deepest strike to consider - deeper ITM costs more but protects if deal breaks</li>
              <li><strong>Long Leg Upper:</strong> Shallowest strike (hardcoded at deal price)</li>
              <li><strong>Short Leg:</strong> Range for sold strike - call spreads may benefit from buffer above for higher offers</li>
              <li><strong>Fetch Range:</strong> Automatically derived from strategy params</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
