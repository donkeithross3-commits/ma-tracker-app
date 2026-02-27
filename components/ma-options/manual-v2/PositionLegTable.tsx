"use client";

import { useMemo } from "react";
import type { IBPositionRow } from "../IBPositionsTab";
import type { LegGreeksData } from "./useGreeksComputation";
import { greeksLegKey } from "./useGreeksComputation";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

/* ─── Column definitions ─── */
const LEG_COLUMNS: ColumnDef[] = [
  { key: "type", label: "Type" },
  { key: "description", label: "Description" },
  { key: "pos", label: "Pos" },
  { key: "avgCost", label: "Avg Cost" },
  { key: "last", label: "Last" },
  { key: "mktVal", label: "Mkt Val" },
  { key: "pnl", label: "P&L" },
  { key: "delta", label: "Delta" },
];
const LEG_DEFAULTS = LEG_COLUMNS.map((c) => c.key);
const LEG_LOCKED = ["type", "description"];

interface LegPrice {
  bid: number;
  ask: number;
  mid: number;
  last: number;
}

interface PositionLegTableProps {
  rows: IBPositionRow[];
  legPrices: Record<string, LegPrice>;
  legGreeks: Record<string, LegGreeksData>;
  spotPrice?: number | null;
  /** Called when user clicks an option row to pre-fill the order ticket */
  onSelectLeg?: (row: IBPositionRow) => void;
}

function displayLegType(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT") return `OPT ${c.right || ""}`;
  return c.secType || "?";
}

function displayLegDescription(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT" && (c.lastTradeDateOrContractMonth || c.strike)) {
    const exp = (c.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    return `${exp} ${c.strike}`;
  }
  if (c.secType === "FUT" && c.lastTradeDateOrContractMonth) {
    return c.lastTradeDateOrContractMonth;
  }
  return c.localSymbol || c.symbol || "Stock";
}

function getMultiplier(row: IBPositionRow): number {
  const c = row.contract;
  if (c.secType === "OPT" || c.secType === "FOP") {
    const m = parseInt(c.multiplier || "100", 10);
    return isNaN(m) || m <= 0 ? 100 : m;
  }
  if (c.secType === "FUT") {
    const m = parseInt(c.multiplier || "1", 10);
    return isNaN(m) || m <= 0 ? 1 : m;
  }
  return 1;
}

function legKey(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT") {
    return `${row.account}:OPT:${c.symbol}:${c.lastTradeDateOrContractMonth}:${c.strike}:${c.right}`;
  }
  return `${row.account}:${c.secType}:${c.symbol}`;
}

function formatPnl(n: number): string {
  const abs = Math.abs(n);
  const formatted = "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return "+" + formatted;
  if (n < 0) return "\u2212" + formatted;
  return formatted;
}

export default function PositionLegTable({
  rows,
  legPrices,
  legGreeks,
  spotPrice,
  onSelectLeg,
}: PositionLegTableProps) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("manualV2Legs");
  const visibleKeys = useMemo(() => savedCols ?? LEG_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);

  // Compute totals across all legs
  const totals = useMemo(() => {
    let totalMktVal = 0;
    let totalPnl = 0;
    let totalDelta = 0;
    let hasAnyPrice = false;

    for (const row of rows) {
      const key = legKey(row);
      const price = legPrices[key];
      const greeksKey = greeksLegKey(row);
      const grks = legGreeks[greeksKey];
      const mult = getMultiplier(row);
      const isOpt = row.contract.secType === "OPT";

      const lastPrice = isOpt
        ? (price?.last || price?.mid || 0)
        : (spotPrice ?? 0);

      if (lastPrice > 0) {
        hasAnyPrice = true;
        const mktVal = row.position * lastPrice * mult;
        const costBasis = row.position * row.avgCost;
        totalMktVal += mktVal;
        totalPnl += mktVal - costBasis;
      }

      // Delta
      if (row.contract.secType === "STK") {
        totalDelta += row.position;
      } else if (isOpt && grks?.delta != null) {
        totalDelta += row.position * grks.delta * mult;
      }
    }
    return { totalMktVal, totalPnl, totalDelta, hasAnyPrice };
  }, [rows, legPrices, legGreeks, spotPrice]);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-2">No positions</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-300">Position Legs</h3>
        <ColumnChooser
          columns={LEG_COLUMNS}
          visible={visibleKeys}
          defaults={LEG_DEFAULTS}
          onChange={(keys) => setVisibleColumns("manualV2Legs", keys)}
          locked={LEG_LOCKED}
          size="sm"
        />
      </div>
      <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
        <table className="w-full text-sm d-table">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              {visibleSet.has("type") && <th className="py-1.5 px-2 text-left font-medium">Type</th>}
              {visibleSet.has("description") && <th className="py-1.5 px-2 text-left font-medium">Description</th>}
              {visibleSet.has("pos") && <th className="py-1.5 px-2 text-right font-medium">Pos</th>}
              {visibleSet.has("avgCost") && <th className="py-1.5 px-2 text-right font-medium">Avg Cost</th>}
              {visibleSet.has("last") && <th className="py-1.5 px-2 text-right font-medium">Last</th>}
              {visibleSet.has("mktVal") && <th className="py-1.5 px-2 text-right font-medium">Mkt Val</th>}
              {visibleSet.has("pnl") && <th className="py-1.5 px-2 text-right font-medium">P&L</th>}
              {visibleSet.has("delta") && <th className="py-1.5 px-2 text-right font-medium">Delta</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const key = legKey(row);
              const price = legPrices[key];
              const greeksKey = greeksLegKey(row);
              const greeks = legGreeks[greeksKey];
              const mult = getMultiplier(row);
              const isOption = row.contract.secType === "OPT";

              // For stocks, use spotPrice; for options, use leg price
              const lastPrice = isOption
                ? (price?.last || price?.mid || 0)
                : (spotPrice ?? 0);
              const mktVal = row.position * lastPrice * mult;
              const costBasis = row.position * row.avgCost;
              const pnl = lastPrice > 0 ? mktVal - costBasis : 0;

              // Per-leg delta contribution
              let legDelta: number | null = null;
              if (row.contract.secType === "STK") {
                legDelta = row.position;
              } else if (isOption && greeks?.delta != null) {
                legDelta = row.position * greeks.delta * mult;
              }

              return (
                <tr
                  key={`${key}-${i}`}
                  className={`border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors ${
                    isOption ? "cursor-pointer" : ""
                  }`}
                  onClick={() => {
                    if (isOption && onSelectLeg) onSelectLeg(row);
                  }}
                  title={isOption ? "Click to trade this option" : undefined}
                >
                  {visibleSet.has("type") && (
                    <td className="py-1.5 px-2 text-gray-400 font-mono text-xs">
                      {displayLegType(row)}
                    </td>
                  )}
                  {visibleSet.has("description") && (
                    <td className="py-1.5 px-2 text-gray-300 font-mono">
                      {displayLegDescription(row)}
                    </td>
                  )}
                  {visibleSet.has("pos") && (
                    <td className={`py-1.5 px-2 text-right font-mono ${
                      row.position > 0 ? "text-green-400" : row.position < 0 ? "text-red-400" : "text-gray-400"
                    }`}>
                      {row.position > 0 ? "+" : ""}{row.position}
                    </td>
                  )}
                  {visibleSet.has("avgCost") && (
                    <td className="py-1.5 px-2 text-right font-mono text-gray-400">
                      {row.avgCost > 0 ? row.avgCost.toFixed(2) : "\u2014"}
                    </td>
                  )}
                  {visibleSet.has("last") && (
                    <td className="py-1.5 px-2 text-right font-mono text-gray-300">
                      {lastPrice > 0 ? lastPrice.toFixed(2) : "\u2014"}
                    </td>
                  )}
                  {visibleSet.has("mktVal") && (
                    <td className="py-1.5 px-2 text-right font-mono text-gray-300">
                      {lastPrice > 0
                        ? "$" + Math.abs(mktVal).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                        : "\u2014"}
                    </td>
                  )}
                  {visibleSet.has("pnl") && (
                    <td className={`py-1.5 px-2 text-right font-mono ${
                      pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-400"
                    }`}>
                      {lastPrice > 0 ? formatPnl(pnl) : "\u2014"}
                    </td>
                  )}
                  {visibleSet.has("delta") && (
                    <td className="py-1.5 px-2 text-right font-mono text-gray-300">
                      {legDelta != null ? legDelta.toFixed(1) : "\u2014"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {rows.length >= 2 && (
            <tfoot>
              <tr className="bg-gray-700/30 border-t border-gray-500 font-semibold text-sm">
                {visibleSet.has("type") && <td className="py-2 px-2 text-gray-300">Totals</td>}
                {visibleSet.has("description") && <td className="py-2 px-2"></td>}
                {visibleSet.has("pos") && <td className="py-2 px-2"></td>}
                {visibleSet.has("avgCost") && <td className="py-2 px-2"></td>}
                {visibleSet.has("last") && <td className="py-2 px-2"></td>}
                {visibleSet.has("mktVal") && (
                  <td className="py-2 px-2 text-right font-mono text-gray-200">
                    {totals.hasAnyPrice
                      ? "$" + Math.abs(totals.totalMktVal).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                      : "—"}
                  </td>
                )}
                {visibleSet.has("pnl") && (
                  <td className={`py-2 px-2 text-right font-mono ${
                    totals.totalPnl > 0 ? "text-green-400" : totals.totalPnl < 0 ? "text-red-400" : "text-gray-400"
                  }`}>
                    {totals.hasAnyPrice ? formatPnl(totals.totalPnl) : "—"}
                  </td>
                )}
                {visibleSet.has("delta") && (
                  <td className="py-2 px-2 text-right font-mono text-gray-200">
                    {totals.totalDelta.toFixed(1)}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
