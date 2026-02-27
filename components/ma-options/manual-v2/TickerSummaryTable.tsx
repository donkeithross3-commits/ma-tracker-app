"use client";

import { useState, useMemo, useCallback } from "react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";
import type { IBPositionRow } from "../IBPositionsTab";
import type { TickerGreeksSummary } from "./useGreeksComputation";
import InlineAddTicker from "./InlineAddTicker";

/* ─── Column definitions ─── */
const SUMMARY_COLUMNS: ColumnDef[] = [
  { key: "ticker", label: "Ticker" },
  { key: "stockPos", label: "Stock" },
  { key: "options", label: "Options" },
  { key: "spot", label: "Spot" },
  { key: "notional", label: "Notional" },
  { key: "netDelta", label: "Net \u0394" },
  { key: "netGamma", label: "Net \u0393" },
  { key: "netTheta", label: "Net \u0398" },
  { key: "pnl", label: "P&L" },
];
const SUMMARY_DEFAULTS = ["ticker", "stockPos", "options", "spot", "notional", "netDelta", "netTheta", "pnl"];
const SUMMARY_LOCKED = ["ticker"];

/* ─── Types ─── */
export interface TickerGroup {
  key: string;
  rows: IBPositionRow[];
  stockPosition: number;
  callCount: number;
  putCount: number;
  isManual?: boolean;
}

interface TickerSummaryRow {
  group: TickerGroup;
  spot: number | null;
  notional: number;
  greeks: TickerGreeksSummary;
  pnl: number;
}

type SortKey = "ticker" | "stockPos" | "spot" | "notional" | "netDelta" | "netGamma" | "netTheta" | "pnl";

interface TickerSummaryTableProps {
  groups: TickerGroup[];
  /** Spot prices by ticker (uppercase) */
  spotPrices: Record<string, number | null>;
  /** Greeks by ticker */
  greeks: Record<string, TickerGreeksSummary>;
  /** P&L by ticker */
  pnls: Record<string, number>;
  /** Called when user clicks a ticker row */
  onSelectTicker: (ticker: string) => void;
  /** Called when user adds a manual ticker */
  onAddTicker: (ticker: string, name: string) => void;
  /** Existing ticker keys for preventing duplicates */
  existingTickers: Set<string>;
}

function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPnl(n: number): string {
  const abs = Math.abs(n);
  const formatted = "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (n > 0) return "+" + formatted;
  if (n < 0) return "\u2212" + formatted;
  return formatted;
}

function optionsSummary(group: TickerGroup): string {
  const parts: string[] = [];
  if (group.callCount > 0) parts.push(`${group.callCount}C`);
  if (group.putCount > 0) parts.push(`${group.putCount}P`);
  return parts.join(" / ") || "\u2014";
}

export default function TickerSummaryTable({
  groups,
  spotPrices,
  greeks,
  pnls,
  onSelectTicker,
  onAddTicker,
  existingTickers,
}: TickerSummaryTableProps) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("manualV2Summary");
  const visibleKeys = useMemo(() => savedCols ?? SUMMARY_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("manualV2Summary", keys),
    [setVisibleColumns]
  );

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" ? "asc" : "desc");
    }
  }, [sortKey]);

  const sortIcon = (key: string) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  // Build enriched rows
  const enrichedRows: TickerSummaryRow[] = useMemo(() => {
    return groups.map((group) => {
      const ticker = group.key.split(" ")[0]?.toUpperCase() ?? group.key;
      const spot = spotPrices[ticker] ?? null;
      const notional = spot != null ? group.stockPosition * spot : 0;
      const tickerGreeks = greeks[group.key] ?? {
        stockDelta: 0, optionsDelta: 0, netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, hasGreeks: false,
      };
      const pnl = pnls[group.key] ?? 0;
      return { group, spot, notional, greeks: tickerGreeks, pnl };
    });
  }, [groups, spotPrices, greeks, pnls]);

  // Sort
  const sortedRows = useMemo(() => {
    if (!sortKey) return enrichedRows;
    return [...enrichedRows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "ticker": return a.group.key.localeCompare(b.group.key) * dir;
        case "stockPos": return (a.group.stockPosition - b.group.stockPosition) * dir;
        case "spot": return ((a.spot ?? 0) - (b.spot ?? 0)) * dir;
        case "notional": return (a.notional - b.notional) * dir;
        case "netDelta": return (a.greeks.netDelta - b.greeks.netDelta) * dir;
        case "netGamma": return (a.greeks.netGamma - b.greeks.netGamma) * dir;
        case "netTheta": return (a.greeks.netTheta - b.greeks.netTheta) * dir;
        case "pnl": return (a.pnl - b.pnl) * dir;
        default: return 0;
      }
    });
  }, [enrichedRows, sortKey, sortDir]);

  return (
    <div>
      {/* Header with add ticker + column chooser */}
      <div className="flex items-center justify-between mb-2">
        <InlineAddTicker onAdd={onAddTicker} existingTickers={existingTickers} />
        <ColumnChooser
          columns={SUMMARY_COLUMNS}
          visible={visibleKeys}
          defaults={SUMMARY_DEFAULTS}
          onChange={handleColsChange}
          locked={SUMMARY_LOCKED}
          size="sm"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
        <table className="w-full text-sm d-table">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              {visibleSet.has("ticker") && (
                <th className="py-1.5 px-2 text-left font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("ticker")}>
                  Ticker{sortIcon("ticker")}
                </th>
              )}
              {visibleSet.has("stockPos") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("stockPos")}>
                  Stock{sortIcon("stockPos")}
                </th>
              )}
              {visibleSet.has("options") && (
                <th className="py-1.5 px-2 text-center font-medium">Options</th>
              )}
              {visibleSet.has("spot") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("spot")}>
                  Spot{sortIcon("spot")}
                </th>
              )}
              {visibleSet.has("notional") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("notional")}>
                  Notional{sortIcon("notional")}
                </th>
              )}
              {visibleSet.has("netDelta") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("netDelta")}>
                  Net Δ{sortIcon("netDelta")}
                </th>
              )}
              {visibleSet.has("netGamma") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("netGamma")}>
                  Net Γ{sortIcon("netGamma")}
                </th>
              )}
              {visibleSet.has("netTheta") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("netTheta")}>
                  Net Θ{sortIcon("netTheta")}
                </th>
              )}
              {visibleSet.has("pnl") && (
                <th className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort("pnl")}>
                  P&L{sortIcon("pnl")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ group, spot, notional, greeks: g, pnl }) => (
              <tr
                key={group.key}
                className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors"
                onClick={() => onSelectTicker(group.key)}
              >
                {visibleSet.has("ticker") && (
                  <td className="py-2 px-2 font-mono font-semibold text-blue-400">
                    {group.key}
                    {group.isManual && (
                      <span className="ml-1 text-[10px] text-gray-600">(manual)</span>
                    )}
                  </td>
                )}
                {visibleSet.has("stockPos") && (
                  <td className={`py-2 px-2 text-right font-mono ${
                    group.stockPosition > 0 ? "text-green-400" : group.stockPosition < 0 ? "text-red-400" : "text-gray-500"
                  }`}>
                    {group.stockPosition !== 0 ? group.stockPosition.toLocaleString() : "\u2014"}
                  </td>
                )}
                {visibleSet.has("options") && (
                  <td className="py-2 px-2 text-center text-gray-400 text-xs">
                    {optionsSummary(group)}
                  </td>
                )}
                {visibleSet.has("spot") && (
                  <td className="py-2 px-2 text-right font-mono text-gray-300">
                    {spot != null ? spot.toFixed(2) : "\u2014"}
                  </td>
                )}
                {visibleSet.has("notional") && (
                  <td className="py-2 px-2 text-right font-mono text-gray-300">
                    {notional !== 0 ? "$" + formatCompactNumber(notional) : "\u2014"}
                  </td>
                )}
                {visibleSet.has("netDelta") && (
                  <td className={`py-2 px-2 text-right font-mono ${
                    g.netDelta > 0 ? "text-green-400" : g.netDelta < 0 ? "text-red-400" : "text-gray-500"
                  }`}>
                    {g.hasGreeks || g.stockDelta !== 0 ? g.netDelta.toFixed(1) : "\u2014"}
                  </td>
                )}
                {visibleSet.has("netGamma") && (
                  <td className="py-2 px-2 text-right font-mono text-gray-400">
                    {g.hasGreeks ? g.netGamma.toFixed(2) : "\u2014"}
                  </td>
                )}
                {visibleSet.has("netTheta") && (
                  <td className={`py-2 px-2 text-right font-mono ${
                    g.netTheta < 0 ? "text-red-400" : g.netTheta > 0 ? "text-green-400" : "text-gray-500"
                  }`}>
                    {g.hasGreeks ? g.netTheta.toFixed(2) : "\u2014"}
                  </td>
                )}
                {visibleSet.has("pnl") && (
                  <td className={`py-2 px-2 text-right font-mono ${
                    pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-500"
                  }`}>
                    {pnl !== 0 ? formatPnl(pnl) : "\u2014"}
                  </td>
                )}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleKeys.length} className="py-8 text-center text-gray-500">
                  No positions. Add a ticker above to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
