"use client";

import { useMemo, useCallback } from "react";
import { Trash2, ChevronUp, ChevronDown } from "lucide-react";
import {
  ColumnChooser,
  type ColumnDef,
} from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";
import type { QuoteData } from "./useWatchlistQuotes";

// ---------------------------------------------------------------------------
// Column definitions — module level (avoids re-creation on render)
// ---------------------------------------------------------------------------

const WATCHLIST_COLUMNS: ColumnDef[] = [
  { key: "instrument", label: "Instrument" },
  { key: "last", label: "Last" },
  { key: "change", label: "Change" },
  { key: "changePct", label: "Chg %" },
  { key: "volume", label: "Volume" },
  { key: "bid", label: "Bid" },
  { key: "ask", label: "Ask" },
];

const WATCHLIST_DEFAULTS = ["instrument", "last", "change", "changePct", "volume"];
const WATCHLIST_LOCKED = ["instrument"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatVolume(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) {
    const n = v / 1_000_000_000;
    return (n >= 100 ? Math.round(n).toString() : n.toFixed(1)) + "B";
  }
  if (v >= 1_000_000) {
    const n = v / 1_000_000;
    return (n >= 100 ? Math.round(n).toString() : n.toFixed(1)) + "M";
  }
  if (v >= 1_000) {
    const n = v / 1_000;
    return (n >= 100 ? Math.round(n).toString() : n.toFixed(1)) + "K";
  }
  return v.toLocaleString();
}

/** 2 decimals, but trim trailing ".00" for round prices (saves width on YM/NQ). */
function formatPrice(p: number | null): string {
  if (p == null) return "—";
  const s = p.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** Change: ≥100 → 0 decimals, ≥10 → 1, <10 → 2 */
function formatChange(c: number | null): string {
  if (c == null) return "—";
  const sign = c > 0 ? "+" : "";
  const a = Math.abs(c);
  if (a >= 100) return sign + Math.round(c).toString();
  if (a >= 10) {
    const s = c.toFixed(1);
    return sign + (s.startsWith("-") ? s : s);
  }
  return sign + c.toFixed(2);
}

/** Change %: always 1 decimal for compact display */
function formatChangePct(c: number | null): string {
  if (c == null) return "—";
  const sign = c > 0 ? "+" : "";
  return sign + c.toFixed(1) + "%";
}

function changeColor(v: number | null): string {
  if (v == null || v === 0) return "text-gray-400";
  return v > 0 ? "text-green-400" : "text-red-400";
}

// ---------------------------------------------------------------------------
// Futures front-month — mirrors agent's _get_front_month() logic
// ---------------------------------------------------------------------------

const FUTURES_MONTH_CODES = "FGHJKMNQUVXZ"; // Jan=F … Dec=Z
const QUARTERLY_FUTURES = new Set([
  "ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM",
]);

/** Derive the front-month contract code for a bare futures root, e.g. "H6" */
function getFrontMonthCode(symbol: string): string {
  const now = new Date();
  const month = now.getUTCMonth(); // 0-based
  const year = now.getUTCFullYear();

  if (QUARTERLY_FUTURES.has(symbol)) {
    // Quarterly: nearest Mar(2), Jun(5), Sep(8), Dec(11)
    const quarters = [2, 5, 8, 11];
    for (const q of quarters) {
      if (q >= month) {
        return FUTURES_MONTH_CODES[q] + String(year % 10);
      }
    }
    return FUTURES_MONTH_CODES[2] + String((year + 1) % 10);
  }

  // Monthly: always next month (current month contract typically expired)
  const nextMonth = (month + 1) % 12;
  const nextYear = month === 11 ? year + 1 : year;
  return FUTURES_MONTH_CODES[nextMonth] + String(nextYear % 10);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchlistItemDisplay {
  id: string;
  ticker: string;
  instrumentType: string;
  displayName?: string | null;
  exchange?: string | null;
  sortOrder: number;
}

interface WatchlistTableProps {
  items: WatchlistItemDisplay[];
  quotes: Map<string, QuoteData>;
  onRemoveItem: (ticker: string) => void;
  onMoveItem: (index: number, direction: "up" | "down") => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WatchlistTable({
  items,
  quotes,
  onRemoveItem,
  onMoveItem,
}: WatchlistTableProps) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("watchlist");
  const visibleKeys = useMemo(
    () => savedCols ?? WATCHLIST_DEFAULTS,
    [savedCols]
  );
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("watchlist", keys),
    [setVisibleColumns]
  );

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No instruments in this watchlist. Use the controls above to add tickers.
      </div>
    );
  }

  return (
    <div>
      {/* Header row with column chooser */}
      <div className="flex items-center justify-end mb-1">
        <ColumnChooser
          columns={WATCHLIST_COLUMNS}
          visible={visibleKeys}
          defaults={WATCHLIST_DEFAULTS}
          onChange={handleColsChange}
          locked={WATCHLIST_LOCKED}
          size="sm"
        />
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto d-table-wrap"
        style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}
      >
        <table className="w-full text-sm d-table" style={{ tableLayout: "auto" }}>
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="w-5 sm:w-6"></th>
              {visibleSet.has("instrument") && (
                <th className="text-left py-2 px-1 sm:px-2 font-medium">Instrument</th>
              )}
              {visibleSet.has("last") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">Last</th>
              )}
              {visibleSet.has("change") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">Chg</th>
              )}
              {visibleSet.has("changePct") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">%</th>
              )}
              {visibleSet.has("volume") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">Vol</th>
              )}
              {visibleSet.has("bid") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">Bid</th>
              )}
              {visibleSet.has("ask") && (
                <th className="text-right py-2 px-1 sm:px-2 font-medium whitespace-nowrap">Ask</th>
              )}
              <th className="w-6 sm:w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const q = quotes.get(item.ticker);
              const isFirst = idx === 0;
              const isLast = idx === items.length - 1;

              return (
                <tr
                  key={item.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  {/* Up/down arrows — left column */}
                  <td className="py-0 px-0">
                    <div className="flex flex-col items-center">
                      <button
                        onClick={() => onMoveItem(idx, "up")}
                        disabled={isFirst}
                        className={`p-0.5 transition-colors no-density ${isFirst ? "text-gray-700 cursor-default" : "text-gray-500 hover:text-gray-200"}`}
                        title="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onMoveItem(idx, "down")}
                        disabled={isLast}
                        className={`p-0.5 transition-colors no-density ${isLast ? "text-gray-700 cursor-default" : "text-gray-500 hover:text-gray-200"}`}
                        title="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  {visibleSet.has("instrument") && (
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2">
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm sm:text-base font-bold text-gray-100 whitespace-nowrap">
                          {item.ticker}
                        </span>
                        {item.instrumentType === "future" && (
                          <span className="text-xs font-mono text-amber-500/80">
                            {getFrontMonthCode(item.ticker)}
                          </span>
                        )}
                        {item.exchange && (
                          <span className="text-xs text-gray-500 hidden sm:inline">
                            {item.exchange}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleSet.has("last") && (
                    <td className="text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono text-gray-100 whitespace-nowrap">
                      {formatPrice(q?.price ?? null)}
                    </td>
                  )}
                  {visibleSet.has("change") && (
                    <td
                      className={`text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono whitespace-nowrap ${changeColor(q?.change ?? null)}`}
                    >
                      {formatChange(q?.change ?? null)}
                    </td>
                  )}
                  {visibleSet.has("changePct") && (
                    <td
                      className={`text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono whitespace-nowrap ${changeColor(q?.changePct ?? null)}`}
                    >
                      {formatChangePct(q?.changePct ?? null)}
                    </td>
                  )}
                  {visibleSet.has("volume") && (
                    <td className="text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono text-gray-300 whitespace-nowrap">
                      {formatVolume(q?.volume ?? null)}
                    </td>
                  )}
                  {visibleSet.has("bid") && (
                    <td className="text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono text-gray-300 whitespace-nowrap">
                      {formatPrice(q?.bid ?? null)}
                    </td>
                  )}
                  {visibleSet.has("ask") && (
                    <td className="text-right py-1.5 sm:py-2 px-1 sm:px-2 font-mono text-gray-300 whitespace-nowrap">
                      {formatPrice(q?.ask ?? null)}
                    </td>
                  )}
                  {/* Trash — right column */}
                  <td className="py-1.5 sm:py-2 px-0">
                    <button
                      onClick={() => onRemoveItem(item.ticker)}
                      className="p-1 text-gray-600 hover:text-red-400 transition-colors no-density"
                      title={`Remove ${item.ticker}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
