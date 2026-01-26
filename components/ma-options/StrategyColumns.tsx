"use client";

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
  netPremium: number; // Midpoint cost
  netPremiumFarTouch: number; // Far touch cost
  maxProfit: number;
  annualizedYield: number; // Midpoint IRR
  annualizedYieldFarTouch: number; // Far touch IRR
  liquidityScore: number;
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
 * Calculate midpoint metrics
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
 * Calculate far touch metrics
 */
export function calculateFarMetrics(metrics: StrategyMetrics) {
  const midCost = Math.abs(metrics.netPremium || 0);
  const midProfit = metrics.maxProfit || 0;
  const farCost = Math.abs(metrics.netPremiumFarTouch || 0);
  
  // For spreads: Profit = Strike Width - Entry Cost
  const strikeWidth = midProfit + midCost;
  const farProfit = Math.max(0, strikeWidth - farCost);
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
 * BidAskGrids component - displays bid/ask prices (no quantities)
 */
export function BidAskGrids({ legs }: { legs: StrategyLeg[] }) {
  return (
    <div className="flex gap-2">
      {legs.map((leg, idx) => {
        // Create leg label: e.g., "BUY 145C" or "SELL 150C"
        const legLabel = `${leg.side} ${leg.strike.toFixed(0)}${leg.right}`;
        
        return (
          <div key={idx} className="border border-gray-700 rounded">
            {/* Leg label */}
            <div className="bg-gray-800 px-1 py-0.5 text-center text-[9px] text-gray-400 border-b border-gray-700">
              {legLabel}
            </div>
            {/* Bid/Ask prices only (no quantities) */}
            <div className="flex flex-col text-[10px]">
              {/* Ask price */}
              <div className="bg-red-900/20 px-2 py-0.5 text-right text-red-400">
                ${leg.ask.toFixed(2)}
              </div>
              {/* Bid price */}
              <div className="bg-blue-900/20 px-2 py-0.5 text-right text-blue-400">
                ${leg.bid.toFixed(2)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Shared table header component for strategy metrics
 */
export function StrategyTableHeader({
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
 * Shared table row cells for strategy metrics
 */
export function StrategyMetricsCells({ metrics }: { metrics: StrategyMetrics }) {
  const strikes = renderStrikes(metrics.legs);
  const legPricesMid = renderLegPricesMid(metrics.legs);
  const legPricesFar = renderLegPricesFar(metrics.legs);
  
  const midMetrics = calculateMidMetrics(metrics);
  const farMetrics = calculateFarMetrics(metrics);

  return (
    <>
      {/* Strikes */}
      <td className="py-2 px-2 text-gray-100 font-mono text-[11px]">
        {strikes}
      </td>

      {/* Leg Prices */}
      <td className="py-2 px-2 text-gray-300 text-[10px]">
        <div className="flex items-center gap-1" title={`Midpoint: ${legPricesMid}`}>
          <span className="text-gray-500 text-[9px]">Mid:</span>
          <span>{legPricesMid}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500" title={`Far Touch: ${legPricesFar}`}>
          <span className="text-[9px]">Far:</span>
          <span>{legPricesFar}</span>
        </div>
      </td>

      {/* Market Data - Bid/Ask Grids */}
      <td className="py-2 px-2">
        <BidAskGrids legs={metrics.legs} />
      </td>

      {/* Midpoint Entry - Cost */}
      <td className="py-2 px-2 text-right text-gray-100 font-mono text-[11px]">
        ${midMetrics.cost.toFixed(2)}
      </td>

      {/* Midpoint Entry - Profit */}
      <td className="py-2 px-2 text-right text-green-400 font-mono text-[11px]">
        ${midMetrics.profit.toFixed(2)}
      </td>

      {/* Midpoint Entry - IRR */}
      <td className="py-2 px-2 text-right text-green-400 font-mono text-[11px]">
        {(midMetrics.irr * 100).toFixed(1)}%
      </td>

      {/* Far Touch Entry - Cost */}
      <td className="py-2 px-2 text-right text-gray-100 font-mono text-[11px]">
        ${farMetrics.cost.toFixed(2)}
      </td>

      {/* Far Touch Entry - Profit */}
      <td className="py-2 px-2 text-right text-green-400 font-mono text-[11px]">
        ${farMetrics.profit.toFixed(2)}
      </td>

      {/* Far Touch Entry - IRR */}
      <td className="py-2 px-2 text-right text-green-400 font-mono text-[11px]">
        {(farMetrics.irr * 100).toFixed(1)}%
      </td>
    </>
  );
}

