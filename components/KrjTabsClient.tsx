'use client'

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Printer, Filter, X, User, GitFork, Edit3, Loader2 } from "lucide-react"
import KrjPrintLayout from "@/components/KrjPrintLayout"
import { ListSettingsModal } from "@/components/krj/ListSettingsModal"
import { TickerEditorModal } from "@/components/krj/TickerEditorModal"

type RawRow = Record<string, string>;

/** Row has ticker but no CSV data yet (placeholder for "Request signal"). */
function isPlaceholderRow(row: RawRow): boolean {
  const t = (row?.ticker ?? "").toString().trim()
  const c = (row?.c ?? "").toString().trim()
  const s = (row?.signal ?? "").toString().trim()
  return !!t && !c && !s
}

type GroupData = {
  key: string;
  label: string;
  rows: RawRow[];
  summary: {
    rowsSummary: Array<{
      label: string;
      current: number;
      last: number;
      delta: number;
    }>;
    totals: {
      current: number;
      last: number;
    };
  };
  // Extended metadata for customization features
  listId?: string;
  ownerId?: string | null;
  ownerAlias?: string | null;
  isSystem?: boolean;
  isEditable?: boolean;
  canEdit?: boolean;
  isFork?: boolean;
  forkDelta?: { added: string[]; removed: string[] };
  tickerCount?: number;
};

interface KrjTabsClientProps {
  groups: GroupData[];
  columns: Array<{ key: string; label: string; description: string }>;
  userId?: string | null;
  userAlias?: string | null;
}

// Signal filter types
type FilterColumn = "signal" | "signal_status_prior_week" | "both" | null;
const SIGNAL_VALUES = ["Long", "Neutral", "Short"] as const;

// Formatting helper functions
function formatPrice(x: string | undefined): string {
  if (!x) return "";
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return num.toFixed(2);
}

function formatPercent(x: string | undefined): string {
  if (!x) return "";
  if (x.includes("%")) return x;
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return (num * 100).toFixed(1) + "%";
}

function formatPercentInteger(x: string | undefined): string {
  if (!x) return "";
  if (x.includes("%")) return x;
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return Math.round(num * 100) + "%";
}

function formatDailyRange(x: string | undefined): string {
  if (!x) return "";
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  // Format as percentage with 2 decimal places (e.g., 0.68%)
  return (num * 100).toFixed(2) + "%";
}

function formatMillions(x: string | undefined): string {
  if (!x) return "";
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return num.toFixed(1) + "M";
}

function formatBillions(x: string | undefined): string {
  if (!x) return "";
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return num.toFixed(2) + "B";
}

function formatDecimal(x: string | undefined, decimals: number): string {
  if (!x) return "";
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return num.toFixed(decimals);
}

function isCurrencyPair(ticker: string): boolean {
  return ticker.startsWith("c:");
}

// Helper to compute summary from rows (for filtered data)
function computeSummaryFromRows(rows: RawRow[]) {
  const currentCounts: Record<string, number> = { Long: 0, Neutral: 0, Short: 0 };
  const lastCounts: Record<string, number> = { Long: 0, Neutral: 0, Short: 0 };

  for (const row of rows) {
    const cur = (row["signal"] || "").trim();
    const prev = (row["signal_status_prior_week"] || "").trim();

    if (cur && cur in currentCounts) currentCounts[cur]++;
    if (prev && prev in lastCounts) lastCounts[prev]++;
  }
  const keys = ["Long", "Neutral", "Short"] as const;

  const rowsSummary = keys.map((k) => ({
    label: k,
    current: currentCounts[k],
    last: lastCounts[k],
    delta: currentCounts[k] - lastCounts[k],
  }));

  const totals = {
    current: rowsSummary.reduce((s, r) => s + r.current, 0),
    last: rowsSummary.reduce((s, r) => s + r.last, 0),
  };

  return { rowsSummary, totals };
}

export default function KrjTabsClient({ groups, columns, userId, userAlias }: KrjTabsClientProps) {
  const router = useRouter()
  // Print state management
  const [printMode, setPrintMode] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const [currentTab, setCurrentTab] = useState(groups[0]?.key || "equities")
  const [selectedGroups, setSelectedGroups] = useState<string[]>(() => [groups[0]?.key || "equities"])
  const [printLongShortOnly, setPrintLongShortOnly] = useState(false)
  // Payload for current print run (set when user clicks Print or Print all Long/Short)
  const [selectedGroupsForPrint, setSelectedGroupsForPrint] = useState<string[]>([])
  const [longShortOnlyForPrint, setLongShortOnlyForPrint] = useState(false)
  // Request signal for one ticker (placeholder row)
  const [requestingTicker, setRequestingTicker] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  
  // List visibility state (for hiding tabs)
  const [hiddenListIds, setHiddenListIds] = useState<string[]>([])
  
  // Filter visible groups based on hidden list IDs
  const visibleGroups = groups.filter((g) => !g.listId || !hiddenListIds.includes(g.listId))
  
  // Filter state management
  const [filterColumn, setFilterColumn] = useState<FilterColumn>(null)
  const [filterValues, setFilterValues] = useState<string[]>([])

  // Filter rows based on current filter state
  const getFilteredRows = (rows: RawRow[]): RawRow[] => {
    if (!filterColumn || filterValues.length === 0) return rows;
    return rows.filter(row => {
      if (filterColumn === "both") {
        // Match if EITHER current week OR last week signal matches any selected value
        const currentWeek = (row["signal"] || "").trim();
        const lastWeek = (row["signal_status_prior_week"] || "").trim();
        return filterValues.includes(currentWeek) || filterValues.includes(lastWeek);
      }
      const value = (row[filterColumn] || "").trim();
      return filterValues.includes(value);
    });
  };

  // Check if filter is active
  const isFilterActive = filterColumn !== null && filterValues.length > 0;

  async function handleRequestSignal(ticker: string) {
    if (!ticker?.trim()) return
    setRequestError(null)
    setRequestingTicker(ticker.toUpperCase())
    try {
      const res = await fetch("/api/krj/signals/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Request failed")
      router.refresh()
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setRequestingTicker(null)
    }
  }

  // Get filter description for display
  const getFilterDescription = (): string => {
    if (!isFilterActive) return "";
    const colLabel = filterColumn === "signal" ? "Current Week" : 
                     filterColumn === "both" ? "Either Week" : "Last Week";
    return `${colLabel}: ${filterValues.join(", ")}`;
  };

  // Trigger print when printMode becomes true
  useEffect(() => {
    if (printMode) {
      const timer = setTimeout(() => {
        window.print()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [printMode])

  // Restore normal view after printing
  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintMode(false)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  // Filter + sort a group's rows to Long/Short only (Long first, then Short)
  const filterAndSortLongShort = (rows: RawRow[]) => {
    const out = rows.filter((row) => {
      const s = (row["signal"] || "").trim();
      return s === "Long" || s === "Short";
    });
    out.sort((a, b) => {
      const sa = (a["signal"] || "").trim();
      const sb = (b["signal"] || "").trim();
      if (sa === sb) return 0;
      return sa === "Long" ? -1 : 1;
    });
    return out;
  };

  // Groups to print: from dialog selection + optional Long/Short filter
  const getGroupsForPrint = useMemo(() => {
    const keys = selectedGroupsForPrint.length > 0 ? selectedGroupsForPrint : groups.map((g) => g.key);
    return groups
      .filter((g) => keys.includes(g.key))
      .map((g) => {
        const rows = longShortOnlyForPrint ? filterAndSortLongShort(g.rows) : g.rows;
        const summary = computeSummaryFromRows(rows);
        return { ...g, rows, summary };
      });
  }, [groups, selectedGroupsForPrint, longShortOnlyForPrint]);

  const handleOpenPrintDialog = () => {
    setShowPrintDialog(true);
  };

  const handlePrint = () => {
    const groupKeys = selectedGroups.length > 0 ? selectedGroups : [currentTab];
    setSelectedGroupsForPrint(groupKeys);
    setLongShortOnlyForPrint(printLongShortOnly);
    setShowPrintDialog(false);
    setTimeout(() => setPrintMode(true), 150);
  };

  const handlePrintAllLongShort = () => {
    setSelectedGroupsForPrint(groups.map((g) => g.key));
    setLongShortOnlyForPrint(true);
    setShowPrintDialog(false);
    setTimeout(() => setPrintMode(true), 150);
  };

  const handleSelectCurrentTab = () => setSelectedGroups([currentTab]);
  const handleSelectAll = () => setSelectedGroups(groups.map((g) => g.key));
  const handleToggleGroup = (groupKey: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupKey) ? prev.filter((k) => k !== groupKey) : [...prev, groupKey]
    );
  };

  // Filter handlers
  const handleFilterColumnChange = (value: string) => {
    if (value === "none") {
      setFilterColumn(null);
      setFilterValues([]);
    } else {
      setFilterColumn(value as FilterColumn);
      // Default to showing Long and Short when filter is first enabled
      if (filterValues.length === 0) {
        setFilterValues(["Long", "Short"]);
      }
    }
  };

  const handleToggleFilterValue = (value: string) => {
    setFilterValues(prev =>
      prev.includes(value)
        ? prev.filter(v => v !== value)
        : [...prev, value]
    );
  };

  const handleClearFilter = () => {
    setFilterColumn(null);
    setFilterValues([]);
  };

  return (
    <>
      {/* Print dialog */}
      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent className="bg-gray-900 text-gray-100 border-gray-700">
          <DialogHeader>
            <DialogTitle>Print KRJ Signals</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-400 mb-3">Select groups to print:</p>
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group.key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`print-${group.key}`}
                      checked={selectedGroups.includes(group.key)}
                      onCheckedChange={() => handleToggleGroup(group.key)}
                    />
                    <label
                      htmlFor={`print-${group.key}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {group.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">Quick actions:</p>
              <div className="flex gap-2">
                <Button
                  onClick={handleSelectCurrentTab}
                  variant="outline"
                  size="sm"
                  className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
                >
                  Current Tab
                </Button>
                <Button
                  onClick={handleSelectAll}
                  variant="outline"
                  size="sm"
                  className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
                >
                  All Groups
                </Button>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="print-long-short-only"
                  checked={printLongShortOnly}
                  onCheckedChange={(checked) => setPrintLongShortOnly(checked === true)}
                />
                <label
                  htmlFor="print-long-short-only"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Long/Short only (sorted) for selected groups
                </label>
              </div>
              <Button
                onClick={handlePrintAllLongShort}
                variant="secondary"
                size="sm"
                className="w-full bg-blue-900/50 border border-blue-600 text-blue-200 hover:bg-blue-800/50"
              >
                Print all (Long/Short only) — one click
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setShowPrintDialog(false)}
              variant="outline"
              className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print layout (hidden on screen, visible in print) */}
      {printMode && (
        <KrjPrintLayout
          groups={getGroupsForPrint}
          columns={columns}
          filterDescription={longShortOnlyForPrint ? "Current Week: Long, Short" : undefined}
        />
      )}

      {/* Normal tabbed layout (visible on screen, hidden in print) */}
      <div className="screen-only">
        <Tabs 
          defaultValue="equities" 
          className="w-full"
          onValueChange={setCurrentTab}
        >
          <div className="flex justify-between items-center mb-1">
            <TabsList className="bg-gray-800 border border-gray-600 h-auto p-1">
              {visibleGroups.map((group) => (
                <TabsTrigger
                  key={group.key}
                  value={group.key}
                  className="data-[state=active]:bg-gray-700 data-[state=active]:text-gray-100 text-gray-400 text-lg px-3 py-1"
                  title={group.ownerAlias ? `Owner: ${group.ownerAlias}` : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    {group.label}
                    {group.isFork && (
                      <GitFork className="h-3 w-3 text-blue-400" />
                    )}
                    {group.ownerAlias && (
                      <span className="text-xs text-gray-500 font-normal">
                        ({group.ownerAlias})
                      </span>
                    )}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex items-center gap-2">
              <ListSettingsModal
                lists={groups.map((g) => ({
                  listId: g.listId || g.key,
                  key: g.key,
                  label: g.label,
                  ownerAlias: g.ownerAlias || null,
                  isSystem: g.isSystem || false,
                  isEditable: g.isEditable || false,
                  canEdit: g.canEdit || false,
                  isFork: g.isFork || false,
                  forkDelta: g.forkDelta,
                  tickerCount: g.tickerCount || g.rows.length,
                }))}
                hiddenListIds={hiddenListIds}
                onHiddenListsChange={setHiddenListIds}
                onForkList={(listId) => console.log("Fork list:", listId)}
                onResetFork={async (listId) => {
                  try {
                    await fetch(`/api/krj/lists/${listId}/fork`, { method: "DELETE" });
                    window.location.reload();
                  } catch (error) {
                    console.error("Failed to reset fork:", error);
                  }
                }}
                userId={userId || null}
              />
              <Button
                onClick={handleOpenPrintDialog}
                variant="outline"
                size="sm"
                className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700 hover:text-gray-100 no-print"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>

      {visibleGroups.map((group) => {
        const filteredRows = getFilteredRows(group.rows);
        const displaySummary = isFilterActive ? computeSummaryFromRows(filteredRows) : group.summary;
        
        return (
        <TabsContent key={group.key} value={group.key} className="mt-0">
          {/* Summary card and filter controls - same row */}
          <div className="mb-1 flex items-center gap-4 flex-wrap">
            {/* Yellow summary box */}
            <div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
              {displaySummary.rowsSummary.map((r, idx) => {
                // Color coding: Long=blue, Neutral=black, Short=red
                const labelColor = r.label === "Long" ? "text-blue-700" : r.label === "Short" ? "text-red-700" : "text-black";
                // Muted colors for delta (+/-)
                const deltaColor = r.delta > 0 ? "text-green-600 opacity-70" : r.delta < 0 ? "text-red-600 opacity-70" : "";
                
                return (
                  <span key={r.label}>
                    {idx > 0 && " | "}
                    <span className={labelColor}>
                      {r.label.charAt(0)}:{r.current}
                    </span>
                    <span className={deltaColor}>
                      ({r.delta > 0 ? "+" : ""}{r.delta})
                    </span>
                  </span>
                );
              })}
              {" | Tot:"}{displaySummary.totals.current}
            </div>

            {/* Edit button for list owners */}
            {group.canEdit && group.listId && (
              <TickerEditorModal
                listId={group.listId}
                listName={group.label}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
                  >
                    <Edit3 className="h-4 w-4 mr-1" />
                    Edit Tickers
                  </Button>
                }
              />
            )}

            {/* Filter controls */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={filterColumn || "none"}
                onChange={(e) => handleFilterColumnChange(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-gray-100 text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="none">No Filter</option>
                <option value="signal">Current Week</option>
                <option value="signal_status_prior_week">Last Week</option>
                <option value="both">Either Week</option>
              </select>
            </div>

            {filterColumn && (
              <>
                <div className="flex items-center gap-2">
                  {SIGNAL_VALUES.map((signal) => (
                    <label key={signal} className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={filterValues.includes(signal)}
                        onCheckedChange={() => handleToggleFilterValue(signal)}
                        className="border-gray-500 h-4 w-4"
                      />
                      <span className={`text-sm ${
                        signal === "Long" ? "text-blue-400" : 
                        signal === "Short" ? "text-red-400" : 
                        "text-gray-300"
                      }`}>
                        {signal}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  onClick={handleClearFilter}
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-gray-100 hover:bg-gray-700 h-6 px-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              </>
            )}

            {isFilterActive && (
              <span className="text-sm text-gray-400">
                ({filteredRows.length} of {group.rows.length} rows)
              </span>
            )}

            {/* Tooltip hint */}
            <span className="text-xs text-gray-500 ml-auto">
              hold mouse motionless over column titles until &apos;?&apos; changes to text box to see more
            </span>
          </div>

          {requestError && (
            <div className="mb-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-2 py-1">
              {requestError}
            </div>
          )}

          {/* Main table */}
          <div className="border border-gray-600 rounded overflow-auto max-h-[80vh]">
            <table className="min-w-full text-[16px]">
              <thead className="bg-gray-800 sticky top-0 z-10">
                <tr>
                  {columns.map((col) => {
                    const numericCols = ['c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size'];
                    const isNumeric = numericCols.includes(col.key);
                    return (
                      <th
                        key={col.key}
                        title={col.description}
                        className={`px-1 py-1 ${isNumeric ? 'text-right' : 'text-left'} font-bold text-gray-100 border-b border-gray-600 whitespace-normal max-w-[50px] text-[14px] leading-tight cursor-help`}
                      >
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const numericCols = ['c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size'];
                  return (
                    <tr
                      key={(row["ticker"] || "") + "-" + idx}
                      className={`${idx % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"} hover:bg-gray-700 transition-colors text-gray-100`}
                    >
                      {columns.map((col) => {
                        let value = row[col.key] ?? "";
                        
                        // Apply formatting based on column type
                        if (col.key === "ticker") {
                          // Strip c: prefix from currency pairs for cleaner display
                          value = isCurrencyPair(value) ? value.substring(2) : value;
                        } else if (col.key === "c" || col.key === "weekly_low" || col.key === "25DMA" || col.key === "25DMA_shifted") {
                          value = formatPrice(value);
                        } else if (col.key === "long_signal_value" || col.key === "short_signal_value") {
                          value = formatPercent(value);
                        } else if (col.key === "vol_ratio") {
                          value = formatPercentInteger(value);
                        } else if (col.key === "25DMA_range_bps") {
                          value = formatDailyRange(value);
                        } else if (col.key === "25D_ADV_Shares_MM") {
                          value = formatMillions(value);
                        } else if (col.key === "25D_ADV_nortional_B") {
                          value = formatBillions(value);
                        } else if (col.key === "avg_trade_size") {
                          value = formatDecimal(value, 0);
                        }
                        
                        const isNumeric = numericCols.includes(col.key);
                        
                        // Color coding for signal columns
                        let cellColorClass = "";
                        if (col.key === "signal" || col.key === "signal_status_prior_week") {
                          if (value === "Long") {
                            cellColorClass = "text-blue-400";
                          } else if (value === "Short") {
                            cellColorClass = "text-red-400";
                          }
                          // Neutral stays default gray-100
                        }

                        const isPlaceholder = isPlaceholderRow(row);
                        const tickerForRequest = (row.ticker || "").trim().toUpperCase();
                        const isRequesting = requestingTicker === tickerForRequest;

                        return (
                          <td
                            key={col.key}
                            className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap ${isNumeric ? 'text-right' : 'text-left'} ${cellColorClass}`}
                          >
                            {isPlaceholder && col.key === "signal" ? (
                              <span className="flex flex-col gap-1">
                                <span className="text-gray-500 text-xs">No signal yet</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700"
                                  disabled={!!requestingTicker}
                                  onClick={() => handleRequestSignal(row.ticker || "")}
                                >
                                  {isRequesting ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Request signal"
                                  )}
                                </Button>
                              </span>
                            ) : (
                              value
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
        );
      })}
        </Tabs>
      </div>
    </>
  );
}
