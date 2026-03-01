"use client";

import { useMemo, useCallback } from "react";
import { Trash2 } from "lucide-react";
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
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
}

function formatPrice(p: number | null): string {
  if (p == null) return "—";
  return p.toFixed(2);
}

function formatChange(c: number | null): string {
  if (c == null) return "—";
  const sign = c > 0 ? "+" : "";
  return sign + c.toFixed(2);
}

function formatChangePct(c: number | null): string {
  if (c == null) return "—";
  const sign = c > 0 ? "+" : "";
  return sign + c.toFixed(2) + "%";
}

function changeColor(v: number | null): string {
  if (v == null || v === 0) return "text-gray-400";
  return v > 0 ? "text-green-400" : "text-red-400";
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WatchlistTable({
  items,
  quotes,
  onRemoveItem,
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
        <table className="w-full text-sm d-table">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              {visibleSet.has("instrument") && (
                <th className="text-left py-2 px-2 font-medium">Instrument</th>
              )}
              {visibleSet.has("last") && (
                <th className="text-right py-2 px-2 font-medium">Last</th>
              )}
              {visibleSet.has("change") && (
                <th className="text-right py-2 px-2 font-medium">Change</th>
              )}
              {visibleSet.has("changePct") && (
                <th className="text-right py-2 px-2 font-medium">Chg %</th>
              )}
              {visibleSet.has("volume") && (
                <th className="text-right py-2 px-2 font-medium">Volume</th>
              )}
              {visibleSet.has("bid") && (
                <th className="text-right py-2 px-2 font-medium">Bid</th>
              )}
              {visibleSet.has("ask") && (
                <th className="text-right py-2 px-2 font-medium">Ask</th>
              )}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const q = quotes.get(item.ticker);
              const hasData = q && !q.stale;

              return (
                <tr
                  key={item.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  {visibleSet.has("instrument") && (
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        {/* Live indicator */}
                        <span
                          className={`text-[10px] ${hasData ? "text-blue-400" : "text-gray-600"}`}
                          title={hasData ? "Live data" : "No data"}
                        >
                          ◆
                        </span>
                        <div>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-base font-bold text-gray-100">
                              {item.ticker}
                            </span>
                            {item.exchange && (
                              <span className="text-xs text-gray-400">
                                {item.exchange}
                              </span>
                            )}
                          </div>
                          {item.displayName && (
                            <div className="text-xs text-gray-500 leading-tight">
                              {item.displayName}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleSet.has("last") && (
                    <td className="text-right py-2 px-2 font-mono text-gray-100">
                      {formatPrice(q?.price ?? null)}
                    </td>
                  )}
                  {visibleSet.has("change") && (
                    <td
                      className={`text-right py-2 px-2 font-mono ${changeColor(q?.change ?? null)}`}
                    >
                      {formatChange(q?.change ?? null)}
                    </td>
                  )}
                  {visibleSet.has("changePct") && (
                    <td
                      className={`text-right py-2 px-2 font-mono ${changeColor(q?.changePct ?? null)}`}
                    >
                      {formatChangePct(q?.changePct ?? null)}
                    </td>
                  )}
                  {visibleSet.has("volume") && (
                    <td className="text-right py-2 px-2 font-mono text-gray-300">
                      {formatVolume(q?.volume ?? null)}
                    </td>
                  )}
                  {visibleSet.has("bid") && (
                    <td className="text-right py-2 px-2 font-mono text-gray-300">
                      {formatPrice(q?.bid ?? null)}
                    </td>
                  )}
                  {visibleSet.has("ask") && (
                    <td className="text-right py-2 px-2 font-mono text-gray-300">
                      {formatPrice(q?.ask ?? null)}
                    </td>
                  )}
                  <td className="py-2 px-1">
                    <button
                      onClick={() => onRemoveItem(item.ticker)}
                      className="p-1 text-gray-600 hover:text-red-400 transition-colors"
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
