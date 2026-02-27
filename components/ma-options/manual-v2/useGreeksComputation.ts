import { useMemo } from "react";
import type { IBPositionRow } from "../IBPositionsTab";

/** Greeks data for a single position leg (from fetch-prices response). */
export interface LegGreeksData {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  implied_vol: number | null;
}

/** Aggregated greeks summary for a single ticker (stock + options combined). */
export interface TickerGreeksSummary {
  /** Stock delta contribution: stock qty × 1.0 */
  stockDelta: number;
  /** Options delta contribution: Σ(option_qty × contract_delta × 100) */
  optionsDelta: number;
  /** Net delta: stockDelta + optionsDelta */
  netDelta: number;
  /** Net gamma: Σ(option_qty × contract_gamma × 100) */
  netGamma: number;
  /** Net theta: Σ(option_qty × contract_theta × 100) */
  netTheta: number;
  /** Net vega: Σ(option_qty × contract_vega × 100) */
  netVega: number;
  /** True if any option leg has valid greeks */
  hasGreeks: boolean;
}

/** Stable key to identify a position row for the greeks map. */
export function greeksLegKey(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT") {
    return `${row.account}:OPT:${c.symbol}:${c.lastTradeDateOrContractMonth}:${c.strike}:${c.right}`;
  }
  return `${row.account}:${c.secType}:${c.symbol}`;
}

/**
 * Pure computation of net greeks for a set of positions.
 * Takes position rows + a map of leg greeks (keyed by greeksLegKey()).
 */
export function computeTickerGreeks(
  rows: IBPositionRow[],
  legGreeks: Record<string, LegGreeksData>
): TickerGreeksSummary {
  let stockDelta = 0;
  let optionsDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;
  let hasGreeks = false;

  for (const row of rows) {
    const c = row.contract;
    if (c.secType === "STK") {
      // Stock delta is simply the position size
      stockDelta += row.position;
    } else if (c.secType === "OPT" || c.secType === "FOP") {
      const key = greeksLegKey(row);
      const greeks = legGreeks[key];
      const multiplier = parseInt(c.multiplier || "100", 10) || 100;
      if (greeks) {
        if (greeks.delta != null) {
          optionsDelta += row.position * greeks.delta * multiplier;
          hasGreeks = true;
        }
        if (greeks.gamma != null) {
          netGamma += row.position * greeks.gamma * multiplier;
        }
        if (greeks.theta != null) {
          netTheta += row.position * greeks.theta * multiplier;
        }
        if (greeks.vega != null) {
          netVega += row.position * greeks.vega * multiplier;
        }
      }
    } else if (c.secType === "FUT") {
      // Futures delta is position × multiplier (simplified)
      const multiplier = parseInt(c.multiplier || "1", 10) || 1;
      stockDelta += row.position * multiplier;
    }
  }

  return {
    stockDelta,
    optionsDelta,
    netDelta: stockDelta + optionsDelta,
    netGamma,
    netTheta,
    netVega,
    hasGreeks,
  };
}

/**
 * Hook that memoizes net greek computation for a set of positions.
 */
export function useGreeksComputation(
  rows: IBPositionRow[],
  legGreeks: Record<string, LegGreeksData>
): TickerGreeksSummary {
  return useMemo(
    () => computeTickerGreeks(rows, legGreeks),
    [rows, legGreeks]
  );
}
