"use client";

import { useState, useCallback } from "react";
import type { IBPositionRow } from "../IBPositionsTab";
import type { TickerGreeksSummary } from "./useGreeksComputation";
import type { LegGreeksData } from "./useGreeksComputation";
import type { IBOpenOrder } from "./WorkingOrdersInline";
import PositionLegTable from "./PositionLegTable";
import WorkingOrdersInline from "./WorkingOrdersInline";
import InlineOrderTicket, { type PlaceOrderParams } from "./InlineOrderTicket";

interface LegPrice {
  bid: number;
  ask: number;
  mid: number;
  last: number;
}

interface TickerDetailViewProps {
  ticker: string;
  rows: IBPositionRow[];
  spotPrice: number | null;
  greeks: TickerGreeksSummary;
  legPrices: Record<string, LegPrice>;
  legGreeks: Record<string, LegGreeksData>;
  orders: IBOpenOrder[];
  accounts: string[];
  defaultAccount?: string;
  onBack: () => void;
  onPlaceOrder: (params: PlaceOrderParams) => Promise<{ orderId?: number; error?: string }>;
  onCancelOrder: (orderId: number) => Promise<void>;
  onModifyOrder: (orderId: number, updates: { qty?: number; lmtPrice?: number; stopPrice?: number }) => Promise<void>;
  onRefreshPrices: () => void;
  cancellingOrderId?: number | null;
  pricesLoading?: boolean;
}

function GreekBadge({ label, value, decimals = 1 }: { label: string; value: number; decimals?: number }) {
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-gray-500";
  return (
    <div className="flex flex-col items-center px-3 py-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-lg font-mono font-bold ${color}`}>
        {value.toFixed(decimals)}
      </span>
    </div>
  );
}

export default function TickerDetailView({
  ticker,
  rows,
  spotPrice,
  greeks,
  legPrices,
  legGreeks,
  orders,
  accounts,
  defaultAccount,
  onBack,
  onPlaceOrder,
  onCancelOrder,
  onModifyOrder,
  onRefreshPrices,
  cancellingOrderId,
  pricesLoading,
}: TickerDetailViewProps) {
  // Track prefilled option leg for order ticket
  const [prefillLeg, setPrefillLeg] = useState<IBPositionRow | null>(null);

  const handleSelectLeg = useCallback((row: IBPositionRow) => {
    setPrefillLeg(row);
  }, []);

  const handleClearPrefill = useCallback(() => {
    setPrefillLeg(null);
  }, []);

  // Compute stock position
  const stockPos = rows
    .filter((r) => r.contract.secType === "STK")
    .reduce((sum, r) => sum + r.position, 0);

  return (
    <div className="space-y-4">
      {/* 1. Back button */}
      <button
        onClick={onBack}
        className="min-h-[52px] px-4 text-base font-medium text-gray-300 hover:text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors flex items-center gap-2"
      >
        <span className="text-xl">←</span>
        Back to positions
      </button>

      {/* 2. Header bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-3xl font-bold text-white font-mono">{ticker}</h2>
        {spotPrice != null && (
          <span className="text-2xl font-mono text-gray-200">${spotPrice.toFixed(2)}</span>
        )}
        {stockPos !== 0 && (
          <span className={`text-sm px-2 py-0.5 rounded ${
            stockPos > 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
          }`}>
            {stockPos > 0 ? "+" : ""}{stockPos} shares
          </span>
        )}
        <button
          onClick={onRefreshPrices}
          disabled={pricesLoading}
          className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 rounded transition-colors disabled:opacity-40"
          title="Refresh prices"
        >
          {pricesLoading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {/* 3. Greek summary strip */}
      {(greeks.hasGreeks || greeks.stockDelta !== 0) && (
        <div className="flex gap-2 bg-gray-900 rounded-lg border border-gray-800 overflow-x-auto">
          <GreekBadge label="Net Δ" value={greeks.netDelta} />
          {greeks.hasGreeks && (
            <>
              <div className="w-px bg-gray-800" />
              <GreekBadge label="Stock Δ" value={greeks.stockDelta} />
              <div className="w-px bg-gray-800" />
              <GreekBadge label="Opt Δ" value={greeks.optionsDelta} />
              <div className="w-px bg-gray-800" />
              <GreekBadge label="Net Γ" value={greeks.netGamma} decimals={2} />
              <div className="w-px bg-gray-800" />
              <GreekBadge label="Net Θ" value={greeks.netTheta} />
              <div className="w-px bg-gray-800" />
              <GreekBadge label="Net V" value={greeks.netVega} />
            </>
          )}
        </div>
      )}

      {/* 4. Position legs table */}
      <PositionLegTable
        rows={rows}
        legPrices={legPrices}
        legGreeks={legGreeks}
        spotPrice={spotPrice}
        onSelectLeg={handleSelectLeg}
      />

      {/* 5. Working orders */}
      <WorkingOrdersInline
        orders={orders}
        onCancelOrder={onCancelOrder}
        onModifyOrder={onModifyOrder}
        cancellingOrderId={cancellingOrderId}
      />

      {/* 6. Inline order ticket */}
      <InlineOrderTicket
        ticker={ticker}
        prefillLeg={prefillLeg}
        spotPrice={spotPrice}
        accounts={accounts}
        defaultAccount={defaultAccount}
        onPlaceOrder={onPlaceOrder}
        onClearPrefill={handleClearPrefill}
      />
    </div>
  );
}
