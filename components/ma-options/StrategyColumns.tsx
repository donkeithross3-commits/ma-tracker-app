"use client";

import { formatCompactVolOi } from "@/lib/utils";

/**
 * Shared column definitions and rendering for strategy tables
 * Used by both CandidateStrategiesTable (Curator) and WatchedSpreadsTable (Monitor)
 */

export interface StrategyLeg {
  symbol: string;
  strike: number;
  right: string;
  quantity: number;
  side: "BUY" | "SELL";
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  openInterest: number;
  bidSize?: number;
  askSize?: number;
}

export interface StrategyMetrics {
  legs: StrategyLeg[];
  netPremium: number; // Midpoint cost (debit) or max loss (credit)
  netPremiumFarTouch: number; // Far touch cost/max loss
  maxProfit: number; // Max profit (debit) or credit received (credit)
  maxProfitFarTouch?: number; // Far touch max profit (optional, calculated if not provided)
  annualizedYield: number; // Midpoint IRR
  annualizedYieldFarTouch: number; // Far touch IRR
  liquidityScore: number;
}

export type StrategyType = "spread" | "put_spread" | "call" | "put";

/**
 * Get color class for profit/return values
 * Positive = green, Zero = gray, Negative = red
 */
export function getProfitColorClass(value: number): string {
  if (value > 0) return "text-green-400";
  if (value < 0) return "text-red-400";
  return "text-gray-400";
}

/**
 * Render strikes column
 */
export function renderStrikes(legs: StrategyLeg[]): string {
  return legs.map((leg) => leg.strike.toFixed(2)).join(" / ");
}

/**
 * Render leg prices for midpoint
 */
export function renderLegPricesMid(legs: StrategyLeg[]): string {
  return legs
    .map((leg) => {
      const price = leg.mid || 0;
      const sign = leg.side === "BUY" ? "-" : "+";
      return `${sign}$${price.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Render leg prices for far touch
 */
export function renderLegPricesFar(legs: StrategyLeg[]): string {
  return legs
    .map((leg) => {
      const price = leg.side === "BUY" ? leg.ask : leg.bid;
      const sign = leg.side === "BUY" ? "-" : "+";
      return `${sign}$${price.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Calculate midpoint metrics for debit spreads (call spreads)
 */
export function calculateMidMetrics(metrics: StrategyMetrics) {
  const midCost = Math.abs(metrics.netPremium || 0);
  const midProfit = metrics.maxProfit || 0;
  const midReturn = midCost > 0 ? midProfit / midCost : 0;
  const midIRR = metrics.annualizedYield || 0;

  return {
    cost: midCost,
    profit: midProfit,
    return: midReturn,
    irr: midIRR,
  };
}

/**
 * Calculate far touch metrics for debit spreads (call spreads)
 * Note: Profit CAN be negative if far touch cost exceeds strike width
 * Max loss for call spread is capped at the premium paid (farCost)
 */
export function calculateFarMetrics(metrics: StrategyMetrics) {
  const midCost = Math.abs(metrics.netPremium || 0);
  const midProfit = metrics.maxProfit || 0;
  const farCost = Math.abs(metrics.netPremiumFarTouch || 0);
  
  // Use provided far touch profit if available, otherwise calculate from strike width
  let farProfit: number;
  if (metrics.maxProfitFarTouch !== undefined) {
    farProfit = metrics.maxProfitFarTouch;
  } else {
    // For spreads: Profit = Strike Width - Entry Cost
    // Can be negative if cost exceeds strike width (guaranteed loss)
    const strikeWidth = midProfit + midCost;
    farProfit = strikeWidth - farCost;
  }
  
  const farReturn = farCost > 0 ? farProfit / farCost : 0;
  const farIRR = metrics.annualizedYieldFarTouch || 0;

  return {
    cost: farCost,
    profit: farProfit,
    return: farReturn,
    irr: farIRR,
  };
}

/**
 * Calculate midpoint metrics for credit spreads (put spreads)
 * For credit spreads:
 * - maxProfit = credit received (max gain)
 * - netPremium = max loss (capital at risk)
 */
export function calculateCreditMidMetrics(metrics: StrategyMetrics) {
  const credit = metrics.maxProfit || 0; // Credit received = max gain
  const maxLoss = Math.abs(metrics.netPremium || 0); // Capital at risk
  const midIRR = metrics.annualizedYield || 0;

  return {
    credit,
    maxLoss,
    irr: midIRR,
  };
}

/**
 * Calculate far touch metrics for credit spreads (put spreads)
 * Note: Credit CAN be negative if far touch prices are unfavorable
 * This means the spread would be entered at a net debit (guaranteed loss)
 */
export function calculateCreditFarMetrics(metrics: StrategyMetrics) {
  const midCredit = metrics.maxProfit || 0;
  const midMaxLoss = Math.abs(metrics.netPremium || 0);
  const farMaxLoss = Math.abs(metrics.netPremiumFarTouch || 0);
  
  // For credit spreads: Credit = Strike Width - Max Loss
  // Can be negative if far touch prices result in net debit
  const strikeWidth = midCredit + midMaxLoss;
  const farCredit = strikeWidth - farMaxLoss;
  const farIRR = metrics.annualizedYieldFarTouch || 0;

  return {
    credit: farCredit,
    maxLoss: farMaxLoss,
    irr: farIRR,
  };
}

/**
 * BidAskGrids component - displays bid/ask prices (no quantities)
 */
export function BidAskGrids({ legs }: { legs: StrategyLeg[] }) {
  return (
    <div className="flex gap-2 justify-center">
      {legs.map((leg, idx) => {
        // Create leg label: e.g., "BUY 17.5C" or "SELL 150C"
        // Show full strike price without trailing zeros
        const strikeDisplay = leg.strike % 1 === 0 
          ? leg.strike.toFixed(0) 
          : parseFloat(leg.strike.toFixed(2)).toString();
        const legLabel = `${leg.side} ${strikeDisplay}${leg.right}`;
        
        return (
          <div key={idx} className="border border-gray-700 rounded w-[72px]">
            {/* Leg label */}
            <div className="bg-gray-800 px-1 py-0.5 text-center text-[10px] text-gray-300 border-b border-gray-700 truncate">
              {legLabel}
            </div>
            {/* Bid/Ask prices only (no quantities) */}
            <div className="flex flex-col text-xs">
              {/* Ask price */}
              <div className="bg-red-900/20 px-2 py-0.5 text-center text-red-400">
                ${leg.ask.toFixed(2)}
              </div>
              {/* Bid price */}
              <div className="bg-blue-900/20 px-2 py-0.5 text-center text-blue-400">
                ${leg.bid.toFixed(2)}
              </div>
              {/* Volume / Open interest */}
              <div className="px-1 py-0.5 text-[10px] text-gray-300 text-center border-t border-gray-700">
                V {formatCompactVolOi(leg.volume)}  OI {formatCompactVolOi(leg.openInterest)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Table header for debit spreads (call spreads, long calls)
 */
export function DebitStrategyTableHeader({
  onSort,
  sortKey,
}: {
  onSort: (key: string) => void;
  sortKey?: string;
}) {
  return (
    <>
      <tr className="border-b border-gray-700">
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Strikes
        </th>
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Leg Prices
        </th>
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Market Data
        </th>
        <th
          className="text-center py-1 px-2 text-gray-400 border-b border-gray-700"
          colSpan={3}
        >
          Midpoint Entry
        </th>
        <th
          className="text-center py-1 px-2 text-gray-400 border-b border-gray-700"
          colSpan={3}
        >
          Far Touch Entry
        </th>
      </tr>
      <tr className="border-b border-gray-700">
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Cost
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Profit
        </th>
        <th
          className="text-right py-1 px-2 text-gray-400 text-[10px] cursor-pointer hover:text-gray-200"
          onClick={() => onSort("annualizedYield")}
        >
          IRR
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Cost
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Profit
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">IRR</th>
      </tr>
    </>
  );
}

/**
 * Table header for credit spreads (put spreads)
 */
export function CreditStrategyTableHeader({
  onSort,
  sortKey,
}: {
  onSort: (key: string) => void;
  sortKey?: string;
}) {
  return (
    <>
      <tr className="border-b border-gray-700">
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Strikes
        </th>
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Leg Prices
        </th>
        <th className="text-left py-2 px-2 text-gray-400" rowSpan={2}>
          Market Data
        </th>
        <th
          className="text-center py-1 px-2 text-gray-400 border-b border-gray-700"
          colSpan={3}
        >
          Midpoint Entry
        </th>
        <th
          className="text-center py-1 px-2 text-gray-400 border-b border-gray-700"
          colSpan={3}
        >
          Far Touch Entry
        </th>
      </tr>
      <tr className="border-b border-gray-700">
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Credit
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Max Loss
        </th>
        <th
          className="text-right py-1 px-2 text-gray-400 text-[10px] cursor-pointer hover:text-gray-200"
          onClick={() => onSort("annualizedYield")}
        >
          IRR
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Credit
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">
          Max Loss
        </th>
        <th className="text-right py-1 px-2 text-gray-400 text-[10px]">IRR</th>
      </tr>
    </>
  );
}

/**
 * Shared table header component for strategy metrics
 * Routes to appropriate header based on strategy type
 */
export function StrategyTableHeader({
  onSort,
  sortKey,
  strategyType,
}: {
  onSort: (key: string) => void;
  sortKey?: string;
  strategyType?: StrategyType;
}) {
  if (strategyType === "put_spread") {
    return <CreditStrategyTableHeader onSort={onSort} sortKey={sortKey} />;
  }
  return <DebitStrategyTableHeader onSort={onSort} sortKey={sortKey} />;
}

/**
 * Table row cells for debit spreads (call spreads, long calls)
 */
export function DebitStrategyMetricsCells({ metrics }: { metrics: StrategyMetrics }) {
  const strikes = renderStrikes(metrics.legs);
  const legPricesMid = renderLegPricesMid(metrics.legs);
  const legPricesFar = renderLegPricesFar(metrics.legs);
  
  const midMetrics = calculateMidMetrics(metrics);
  const farMetrics = calculateFarMetrics(metrics);

  return (
    <>
      {/* Strikes */}
      <td className="py-1 px-2 text-gray-100 font-mono text-sm">
        {strikes}
      </td>

      {/* Leg Prices */}
      <td className="py-1 px-2 text-gray-300 text-xs">
        <div className="flex items-center gap-1" title={`Midpoint: ${legPricesMid}`}>
          <span className="text-gray-500 text-[10px]">Mid:</span>
          <span>{legPricesMid}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500" title={`Far Touch: ${legPricesFar}`}>
          <span className="text-[10px]">Far:</span>
          <span>{legPricesFar}</span>
        </div>
      </td>

      {/* Market Data - Bid/Ask Grids */}
      <td className="py-1 px-2">
        <BidAskGrids legs={metrics.legs} />
      </td>

      {/* Midpoint Entry - Cost */}
      <td className="py-1 px-2 text-right text-gray-100 font-mono text-sm">
        ${midMetrics.cost.toFixed(2)}
      </td>

      {/* Midpoint Entry - Profit */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(midMetrics.profit)}`}>
        ${midMetrics.profit.toFixed(2)}
      </td>

      {/* Midpoint Entry - IRR */}
      <td className={`py-1 px-2 text-right font-mono text-sm font-semibold ${getProfitColorClass(midMetrics.irr)}`}>
        {(midMetrics.irr * 100).toFixed(1)}%
      </td>

      {/* Far Touch Entry - Cost */}
      <td className="py-1 px-2 text-right text-gray-100 font-mono text-sm">
        ${farMetrics.cost.toFixed(2)}
      </td>

      {/* Far Touch Entry - Profit */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(farMetrics.profit)}`}>
        ${farMetrics.profit.toFixed(2)}
      </td>

      {/* Far Touch Entry - IRR */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(farMetrics.irr)}`}>
        {(farMetrics.irr * 100).toFixed(1)}%
      </td>
    </>
  );
}

/**
 * Table row cells for credit spreads (put spreads)
 */
export function CreditStrategyMetricsCells({ metrics }: { metrics: StrategyMetrics }) {
  const strikes = renderStrikes(metrics.legs);
  const legPricesMid = renderLegPricesMid(metrics.legs);
  const legPricesFar = renderLegPricesFar(metrics.legs);
  
  const midMetrics = calculateCreditMidMetrics(metrics);
  const farMetrics = calculateCreditFarMetrics(metrics);

  return (
    <>
      {/* Strikes */}
      <td className="py-1 px-2 text-gray-100 font-mono text-sm">
        {strikes}
      </td>

      {/* Leg Prices */}
      <td className="py-1 px-2 text-gray-300 text-xs">
        <div className="flex items-center gap-1" title={`Midpoint: ${legPricesMid}`}>
          <span className="text-gray-500 text-[10px]">Mid:</span>
          <span>{legPricesMid}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500" title={`Far Touch: ${legPricesFar}`}>
          <span className="text-[10px]">Far:</span>
          <span>{legPricesFar}</span>
        </div>
      </td>

      {/* Market Data - Bid/Ask Grids */}
      <td className="py-1 px-2">
        <BidAskGrids legs={metrics.legs} />
      </td>

      {/* Midpoint Entry - Credit (max gain) */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(midMetrics.credit)}`}>
        ${midMetrics.credit.toFixed(2)}
      </td>

      {/* Midpoint Entry - Max Loss */}
      <td className="py-1 px-2 text-right text-red-400 font-mono text-sm">
        ${midMetrics.maxLoss.toFixed(2)}
      </td>

      {/* Midpoint Entry - IRR */}
      <td className={`py-1 px-2 text-right font-mono text-sm font-semibold ${getProfitColorClass(midMetrics.irr)}`}>
        {(midMetrics.irr * 100).toFixed(1)}%
      </td>

      {/* Far Touch Entry - Credit (max gain) */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(farMetrics.credit)}`}>
        ${farMetrics.credit.toFixed(2)}
      </td>

      {/* Far Touch Entry - Max Loss */}
      <td className="py-1 px-2 text-right text-red-400 font-mono text-sm">
        ${farMetrics.maxLoss.toFixed(2)}
      </td>

      {/* Far Touch Entry - IRR */}
      <td className={`py-1 px-2 text-right font-mono text-sm ${getProfitColorClass(farMetrics.irr)}`}>
        {(farMetrics.irr * 100).toFixed(1)}%
      </td>
    </>
  );
}

/**
 * Shared table row cells for strategy metrics
 * Routes to appropriate cells based on strategy type
 */
export function StrategyMetricsCells({ 
  metrics, 
  strategyType 
}: { 
  metrics: StrategyMetrics;
  strategyType?: StrategyType;
}) {
  if (strategyType === "put_spread") {
    return <CreditStrategyMetricsCells metrics={metrics} />;
  }
  return <DebitStrategyMetricsCells metrics={metrics} />;
}