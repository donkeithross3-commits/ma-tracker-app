'use client'

import React, { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Printer, Filter, X, User, GitFork, Loader2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import KrjPrintLayout from "@/components/KrjPrintLayout"
import { ListSettingsModal } from "@/components/krj/ListSettingsModal"
import { TickerEditorModal } from "@/components/krj/TickerEditorModal"
import { ColumnChooser } from "@/components/ui/ColumnChooser"
import { useUIPreferences } from "@/lib/ui-preferences"

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

// Enriched signal decomposition data (from Python signal_generator.py)
type EnrichedTickerData = {
  raw_prediction: number;
  regime_adjusted: number;
  decomposition: {
    krj: number;
    stock_specific: number;
    market_regime: number;
    peer_market: number;
    cross_sectional: number;
  };
  legacy_signal: string;
  legacy_long_sv: number | null;
  legacy_short_sv: number | null;
};

type EnrichedRegime = {
  score: number;
  confidence: number;
  label: string;
  features: {
    breadth: number;
    dispersion: number;
    market_mom: number;
    market_dip: number;
    vol_regime: number;
  };
};

type EnrichedSignalsData = {
  signal_date?: string;
  generated_at?: string;
  regime?: EnrichedRegime;
  model_info?: {
    n_features: number;
    base_value: number;
  };
  tickers?: Record<string, EnrichedTickerData>;
};

interface KrjTabsClientProps {
  groups: GroupData[];
  columns: Array<{ key: string; label: string; description: string }>;
  userId?: string | null;
  userAlias?: string | null;
  enrichedSignals?: EnrichedSignalsData | null;
}

// Signal filter types
type FilterColumn = "signal" | "signal_status_prior_week" | "both" | null;
const SIGNAL_VALUES = ["Long", "Neutral", "Short"] as const;

// Sort types
type SortDirection = "asc" | "desc";
type SortConfig = {
  column: string | null; // null = custom/database order
  direction: SortDirection;
};

/** Compare two row values for sorting. Handles numeric, percentage, and string values. */
function compareRowValues(a: string, b: string, direction: SortDirection): number {
  // Empty values always sort to the end
  const aEmpty = a === undefined || a === null || a === "";
  const bEmpty = b === undefined || b === null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  // Try numeric comparison first
  const aNum = Number(a);
  const bNum = Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return direction === "asc" ? aNum - bNum : bNum - aNum;
  }

  // String comparison
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

/** Sort rows based on sort config. Returns a new sorted array. */
function sortRows(rows: RawRow[], sort: SortConfig): RawRow[] {
  if (!sort.column) return rows; // Custom order - preserve original
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aVal = (a[sort.column!] || "").toString().trim();
    const bVal = (b[sort.column!] || "").toString().trim();
    return compareRowValues(aVal, bVal, sort.direction);
  });
  return sorted;
}

// Formatting helper functions
function formatPrice(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  return num.toFixed(2);
}

function formatPercent(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  if (str.includes("%")) return str;
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  return (num * 100).toFixed(1) + "%";
}

function formatPercentInteger(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  if (str.includes("%")) return str;
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  return Math.round(num * 100) + "%";
}

function formatDailyRange(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  // Format as percentage with 2 decimal places (e.g., 0.68%)
  return (num * 100).toFixed(2) + "%";
}

function formatMillions(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  return num.toFixed(1) + "M";
}

function formatBillions(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  const num = Number(x);
  if (Number.isNaN(num)) return str;
  return num.toFixed(2) + "B";
}

function formatMarketCap(x: string | number | undefined): string {
  if (x === undefined || x === null || x === "") return "";
  const num = Number(x);
  if (Number.isNaN(num)) return String(x);
  if (num >= 1000) return (num / 1000).toFixed(2) + "T";
  return num.toFixed(1) + "B";
}

function formatDecimal(x: string | number | undefined, decimals: number): string {
  if (x === undefined || x === null || x === "") return "";
  const str = String(x);
  const num = Number(x);
  if (Number.isNaN(num)) return str;
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

/** Default columns shown when user has no column visibility preference. */
const KRJ_DEFAULT_COLUMNS = [
  "ticker", "c", "weekly_low", "25DMA", "25DMA_shifted",
  "long_signal_value", "short_signal_value",
  "signal", "signal_status_prior_week",
  "25DMA_range_bps", "vol_ratio", "market_cap_b",
  "25D_ADV_Shares_MM", "25D_ADV_nortional_B", "avg_trade_size",
]

export default function KrjTabsClient({ groups: groupsProp, columns, userId, userAlias, enrichedSignals }: KrjTabsClientProps) {
  const router = useRouter()
  const { getVisibleColumns, setVisibleColumns, isComfort } = useUIPreferences()

  // Local groups state — allows immediate UI updates when tickers are added/removed
  const [localGroups, setLocalGroups] = useState<GroupData[]>(groupsProp)
  // Sync from server when props change (e.g. after router.refresh())
  useEffect(() => { setLocalGroups(groupsProp) }, [groupsProp])

  // Callback for TickerEditorModal to remove a ticker from a group immediately
  const handleTickerRemovedFromGroup = (listId: string, ticker: string) => {
    setLocalGroups((prev) =>
      prev.map((g) => {
        if (g.listId !== listId) return g;
        const newRows = g.rows.filter(
          (r) => (r.ticker || "").toUpperCase() !== ticker.toUpperCase()
        );
        return {
          ...g,
          rows: newRows,
          summary: computeSummaryFromRows(newRows),
          tickerCount: (g.tickerCount ?? g.rows.length) - 1,
        };
      })
    );
  };

  // Callback for TickerEditorModal to add a ticker to a group immediately
  const handleTickerAddedToGroup = (listId: string, ticker: string) => {
    setLocalGroups((prev) =>
      prev.map((g) => {
        if (g.listId !== listId) return g;
        // Add a placeholder row for the new ticker
        const newRows = [...g.rows, { ticker } as RawRow];
        return {
          ...g,
          rows: newRows,
          summary: computeSummaryFromRows(newRows),
          tickerCount: (g.tickerCount ?? g.rows.length) + 1,
        };
      })
    );
  };

  // Print state management
  const [printMode, setPrintMode] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const [currentTab, setCurrentTab] = useState(localGroups[0]?.key || "equities")
  const [selectedGroups, setSelectedGroups] = useState<string[]>(() => [localGroups[0]?.key || "equities"])
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
  const visibleGroups = localGroups.filter((g) => !g.listId || !hiddenListIds.includes(g.listId))

  // Column visibility (from UIPreferences context)
  const savedVisibleCols = getVisibleColumns("krj")
  const visibleColKeys = useMemo(
    () => savedVisibleCols ?? KRJ_DEFAULT_COLUMNS,
    [savedVisibleCols]
  )
  const visibleColumns = useMemo(
    () => {
      const keySet = new Set(visibleColKeys)
      return columns.filter((c) => keySet.has(c.key))
    },
    [columns, visibleColKeys]
  )
  const handleColumnsChange = useCallback(
    (keys: string[]) => setVisibleColumns("krj", keys),
    [setVisibleColumns]
  )

  // Expanded decomposition row
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  // Regime banner expanded state
  const [regimeBannerExpanded, setRegimeBannerExpanded] = useState(false)

  // Enriched data lookups
  const regime = enrichedSignals?.regime ?? null
  const enrichedTickers = enrichedSignals?.tickers ?? {}
  const hasEnrichedData = Object.keys(enrichedTickers).length > 0

  // Sort state management
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: "asc" })

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
    const keys = selectedGroupsForPrint.length > 0 ? selectedGroupsForPrint : localGroups.map((g) => g.key);
    return localGroups
      .filter((g) => keys.includes(g.key))
      .map((g) => {
        const rows = longShortOnlyForPrint ? filterAndSortLongShort(g.rows) : g.rows;
        const summary = computeSummaryFromRows(rows);
        return { ...g, rows, summary };
      });
  }, [localGroups, selectedGroupsForPrint, longShortOnlyForPrint]);

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
    setSelectedGroupsForPrint(localGroups.map((g) => g.key));
    setLongShortOnlyForPrint(true);
    setShowPrintDialog(false);
    setTimeout(() => setPrintMode(true), 150);
  };

  const handleSelectCurrentTab = () => setSelectedGroups([currentTab]);
  const handleSelectAll = () => setSelectedGroups(localGroups.map((g) => g.key));
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

  // Sort handlers
  const handleColumnSort = (columnKey: string) => {
    setSortConfig((prev) => {
      if (prev.column === columnKey) {
        // Toggle direction, then back to custom
        if (prev.direction === "asc") return { column: columnKey, direction: "desc" };
        return { column: null, direction: "asc" }; // Reset to custom order
      }
      return { column: columnKey, direction: "asc" };
    });
  };

  const handleResetSort = () => {
    setSortConfig({ column: null, direction: "asc" });
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
                {localGroups.map((group) => (
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
          columns={visibleColumns}
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
              <ColumnChooser
                columns={columns.map((c) => ({ key: c.key, label: c.label }))}
                visible={visibleColKeys}
                defaults={KRJ_DEFAULT_COLUMNS}
                onChange={handleColumnsChange}
                locked={["ticker"]}
              />
              <ListSettingsModal
                lists={localGroups.map((g) => ({
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

      {/* Regime Banner */}
      {regime && (
        <div className="mb-1">
          <button
            onClick={() => setRegimeBannerExpanded(!regimeBannerExpanded)}
            title="Market regime assessment from the LightGBM prediction model. Indicates whether current market conditions are favorable for the model's predictions. Click to expand and see the 5 underlying market features."
            className={`w-full text-left rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              regime.confidence >= 0.6
                ? "bg-emerald-900/40 border border-emerald-700/50 text-emerald-200"
                : regime.confidence >= 0.3
                ? "bg-yellow-900/30 border border-yellow-700/40 text-yellow-200"
                : "bg-gray-800/60 border border-gray-700/40 text-gray-400"
            }`}
          >
            <span className="flex items-center gap-3">
              <span
                title={`Regime confidence indicator: ${regime.confidence >= 0.6 ? "Green = high confidence (>=60%)" : regime.confidence >= 0.3 ? "Yellow = moderate confidence (30-60%)" : "Gray = low confidence (<30%)"}`}
                className={`inline-block w-2 h-2 rounded-full ${
                  regime.confidence >= 0.6 ? "bg-emerald-400" :
                  regime.confidence >= 0.3 ? "bg-yellow-400" : "bg-gray-500"
                }`}
              />
              <span>
                <span title="Overall market environment classification based on 5 market-wide features. Labels: High Dislocation (score >= 0.6), Moderate Dislocation (0.35-0.6), Moderate Opportunity (0.15-0.35), Low Signal Environment (< 0.15).">
                  Market Regime: <span className="font-semibold">{regime.label}</span>
                </span>
                <span className="ml-2 opacity-70">
                  (<span title="Regime score from -1 to +1. Positive = favorable environment for model predictions (historically more accurate). Derived from a logistic regression trained on which market conditions led to accurate predictions in out-of-sample walk-forward testing.">score: {regime.score > 0 ? "+" : ""}{regime.score.toFixed(2)}</span>
                  {" | "}
                  <span title="Absolute value of regime score. Used to scale predictions: Adj. Prediction = Raw Prediction x Confidence. Higher confidence means the model's predictions are more trustworthy this week.">confidence: {(regime.confidence * 100).toFixed(0)}%</span>)
                </span>
              </span>
              <span className="ml-auto text-xs opacity-50">
                {regimeBannerExpanded ? "collapse" : "expand"}
              </span>
            </span>
          </button>
          {regimeBannerExpanded && (
            <div className="mt-1 rounded bg-gray-800/40 border border-gray-700/30 px-3 py-2 text-xs text-gray-400 grid grid-cols-5 gap-3">
              <div title="Fraction of tickers in the universe with their weekly low above their reference moving average. High breadth (>50%) = broad market strength. Low breadth (<30%) = widespread weakness. Currently indicates how many stocks are holding above support.">
                <span className="block text-gray-500">Breadth</span>
                <span className="text-gray-200 font-mono">{(regime.features.breadth * 100).toFixed(1)}%</span>
              </div>
              <div title="Cross-sectional standard deviation of signal values across all tickers. High dispersion = stocks are moving independently (idiosyncratic opportunities). Low dispersion = stocks moving in lockstep (harder to pick winners). The model historically performs better when dispersion is elevated.">
                <span className="block text-gray-500">Dispersion</span>
                <span className="text-gray-200 font-mono">{(regime.features.dispersion * 100).toFixed(2)}%</span>
              </div>
              <div title="SPY's weekly return — a direct measure of broad market direction. Positive = up week for the market, negative = down week. Used as a proxy for overall market momentum.">
                <span className="block text-gray-500">Mkt Momentum</span>
                <span className={`font-mono ${regime.features.market_mom >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {regime.features.market_mom >= 0 ? "+" : ""}{(regime.features.market_mom * 100).toFixed(2)}%
                </span>
              </div>
              <div title="SPY's own long signal value: (SPY weekly low - SPY DEMA43 reference) / SPY DEMA43. Normal range: -0.5% to -3%. Strongly negative = the market itself has dipped well below its moving average. This captures how far the broad market has pulled back from its trend.">
                <span className="block text-gray-500">Mkt Dip</span>
                <span className={`font-mono ${regime.features.market_dip >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {regime.features.market_dip >= 0 ? "+" : ""}{(regime.features.market_dip * 100).toFixed(2)}%
                </span>
              </div>
              <div title="Mean volatility ratio across the universe — an implicit VIX proxy. Values above 2x indicate elevated market volatility. Computed as the average of each stock's daily range divided by SPY's daily range. Higher = more volatile market environment.">
                <span className="block text-gray-500">Vol Regime</span>
                <span className="text-gray-200 font-mono">{regime.features.vol_regime.toFixed(2)}x</span>
              </div>
            </div>
          )}
        </div>
      )}

      {visibleGroups.map((group) => {
        const filteredRows = getFilteredRows(group.rows);
        const sortedRows = sortRows(filteredRows, sortConfig);
        const displaySummary = isFilterActive ? computeSummaryFromRows(filteredRows) : group.summary;
        
        return (
        <TabsContent key={group.key} value={group.key} className="mt-0">
          {/* Summary card and filter controls - same row */}
          <div className="mb-1 flex items-center gap-4 flex-wrap">
            {/* Yellow summary box */}
            <div title="Signal summary for this list. L = Long (bullish), N = Neutral, S = Short (bearish). Numbers in parentheses show the change from last week (e.g. +3 means 3 more stocks entered that signal this week). Tot = total tickers with signal data." className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
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
                listSlug={group.key}
                onTickerRemoved={(ticker) => handleTickerRemovedFromGroup(group.listId!, ticker)}
                onTickerAdded={(ticker) => handleTickerAddedToGroup(group.listId!, ticker)}
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

            {/* Sort indicator */}
            {sortConfig.column && (
              <span className="flex items-center gap-1 text-sm text-blue-400">
                <ArrowUpDown className="h-3 w-3" />
                Sort: {columns.find((c) => c.key === sortConfig.column)?.label || sortConfig.column}
                {sortConfig.direction === "asc" ? " ↑" : " ↓"}
                <Button
                  onClick={handleResetSort}
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-gray-100 hover:bg-gray-700 h-5 px-1 ml-0.5"
                  title="Reset to custom order"
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            )}

            {/* Tooltip hint */}
            <span className="text-xs text-gray-500 ml-auto">
              click column headers to sort &bull; hold mouse over titles for details
            </span>
          </div>

          {requestError && (
            <div className="mb-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-2 py-1">
              {requestError}
            </div>
          )}

          {/* Main table */}
          <div
            className="d-table-wrap border border-gray-600 rounded overflow-auto max-h-[80vh]"
            style={{ "--visible-cols": visibleColumns.length } as React.CSSProperties}
          >
            <table className="d-table min-w-full text-[16px]">
              <thead className="bg-gray-800 sticky top-0 z-10">
                <tr>
                  {visibleColumns.map((col) => {
                    const numericCols = ['market_cap_b', 'c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size', 'prediction', 'adj_prediction'];
                    const isNumeric = numericCols.includes(col.key);
                    const isSorted = sortConfig.column === col.key;
                    return (
                      <th
                        key={col.key}
                        title={col.description}
                        onClick={() => handleColumnSort(col.key)}
                        className={`px-1 py-1 ${isNumeric ? 'text-right' : 'text-left'} font-bold text-gray-100 border-b border-gray-600 whitespace-normal max-w-[50px] text-[14px] leading-tight cursor-pointer select-none hover:bg-gray-700/50 transition-colors ${isSorted ? 'text-blue-300' : ''}`}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {col.label}
                          {isSorted ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-blue-400 inline flex-shrink-0" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-blue-400 inline flex-shrink-0" />
                            )
                          ) : null}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => {
                  const numericCols = ['market_cap_b', 'c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size', 'prediction', 'adj_prediction'];
                  const tickerUpper = (row["ticker"] || "").trim().toUpperCase();
                  const enrichedRow = enrichedTickers[tickerUpper] as EnrichedTickerData | undefined;
                  const isExpanded = expandedTicker === tickerUpper;
                  return (
                    <React.Fragment key={(row["ticker"] || "") + "-" + idx}>
                    <tr
                      className={`${idx % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"} hover:bg-gray-700 transition-colors text-gray-100 ${enrichedRow ? "cursor-pointer" : ""} ${isExpanded ? "bg-gray-700/60" : ""}`}
                      onClick={enrichedRow ? () => setExpandedTicker(isExpanded ? null : tickerUpper) : undefined}
                    >
                      {visibleColumns.map((col) => {
                        let value = row[col.key] ?? "";
                        
                        // Enriched columns: prediction and adj_prediction
                        if (col.key === "prediction" && enrichedRow) {
                          const p = enrichedRow.raw_prediction * 100;
                          const cls = p > 0 ? "text-emerald-400" : p < 0 ? "text-red-400" : "text-gray-400";
                          return (
                            <td key={col.key} title={`Raw LightGBM predicted 1-week return for ${tickerUpper}: ${p > 0 ? "+" : ""}${p.toFixed(3)}%. This is the model's best estimate of next week's price change, before regime adjustment. Heavily influenced by market-wide factors when the regime signal is strong.`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls}`}>
                              {p > 0 ? "+" : ""}{p.toFixed(2)}%
                            </td>
                          );
                        }
                        if (col.key === "adj_prediction" && enrichedRow) {
                          const p = enrichedRow.regime_adjusted * 100;
                          const cls = p > 0 ? "text-emerald-400" : p < 0 ? "text-red-400" : "text-gray-400";
                          return (
                            <td key={col.key} title={`Regime-adjusted prediction for ${tickerUpper}: ${p > 0 ? "+" : ""}${p.toFixed(3)}%. Calculated as Raw Prediction (${(enrichedRow.raw_prediction * 100).toFixed(2)}%) x Regime Confidence (${regime ? (regime.confidence * 100).toFixed(0) : "?"}%). Scales down the raw signal when the model is less confident about the current market regime. Use this as the actionable signal.`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls}`}>
                              {p > 0 ? "+" : ""}{p.toFixed(2)}%
                            </td>
                          );
                        }
                        if ((col.key === "prediction" || col.key === "adj_prediction") && !enrichedRow) {
                          return (
                            <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right text-gray-600 text-sm">
                              --
                            </td>
                          );
                        }

                        // Signal source mini bar
                        if (col.key === "signal_source" && enrichedRow) {
                          const d = enrichedRow.decomposition;
                          const peerMkt = d.peer_market ?? 0;
                          const total = Math.abs(d.krj) + Math.abs(d.stock_specific) + Math.abs(d.market_regime) + Math.abs(peerMkt) + Math.abs(d.cross_sectional);
                          const pctKrj = total > 0 ? Math.abs(d.krj) / total * 100 : 20;
                          const pctStock = total > 0 ? Math.abs(d.stock_specific) / total * 100 : 20;
                          const pctMarket = total > 0 ? Math.abs(d.market_regime) / total * 100 : 20;
                          const pctPeer = total > 0 ? Math.abs(peerMkt) / total * 100 : 20;
                          const pctCross = total > 0 ? Math.abs(d.cross_sectional) / total * 100 : 20;
                          return (
                            <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap">
                              <div className="flex h-3 w-20 rounded-sm overflow-hidden" title={`SHAP signal decomposition for ${tickerUpper} — how much each category contributes to the prediction:\n\nBlue = KRJ Signal (${(d.krj*100).toFixed(2)}%): price action vs moving average (dip/strength)\nPurple = Stock Specific (${(d.stock_specific*100).toFixed(2)}%): vol ratio, SPX correlation, market cap, 52-week high proximity, return autocorrelation\nGreen = Market Regime (${(d.market_regime*100).toFixed(2)}%): breadth, dispersion, SPY momentum, market dip, vol regime\nTeal = Peer Market (${(peerMkt*100).toFixed(2)}%): adaptive per-ticker peer signal — dynamically selected correlated tickers weighted by predictive IC\nAmber = Cross-Sectional (${(d.cross_sectional*100).toFixed(2)}%): z-scores vs peers, percentile rank, interaction terms\n\nBright = positive (bullish) contribution, Dark = negative (bearish) contribution\nBar width = proportion of total explanation from that category\nClick row to expand full decomposition view.`}>
                                <div style={{ width: `${pctKrj}%` }} className={d.krj >= 0 ? "bg-blue-500" : "bg-blue-800"} />
                                <div style={{ width: `${pctStock}%` }} className={d.stock_specific >= 0 ? "bg-purple-500" : "bg-purple-800"} />
                                <div style={{ width: `${pctMarket}%` }} className={d.market_regime >= 0 ? "bg-emerald-500" : "bg-emerald-800"} />
                                <div style={{ width: `${pctPeer}%` }} className={peerMkt >= 0 ? "bg-teal-500" : "bg-teal-800"} />
                                <div style={{ width: `${pctCross}%` }} className={d.cross_sectional >= 0 ? "bg-amber-500" : "bg-amber-800"} />
                              </div>
                            </td>
                          );
                        }
                        if (col.key === "signal_source" && !enrichedRow) {
                          return (
                            <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-gray-600 text-sm">
                              --
                            </td>
                          );
                        }

                        // Apply formatting based on column type
                        if (col.key === "ticker") {
                          // Strip c: prefix from currency pairs for cleaner display
                          value = isCurrencyPair(value) ? value.substring(2) : value;
                        } else if (col.key === "market_cap_b") {
                          value = formatMarketCap(value);
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
                        if (col.key === "signal" || col.key === "signal_status_prior_week" || col.key === "optimized_signal" || col.key === "optimized_signal_prior_week") {
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
                    {/* Decomposition drawer */}
                    {isExpanded && enrichedRow && (
                      <tr className="bg-gray-800/80">
                        <td colSpan={visibleColumns.length} className="px-3 py-2">
                          <div className="flex gap-6 items-start">
                            {/* 5 SHAP group bars */}
                            <div className="flex-1 space-y-1">
                              <div className="text-xs text-gray-400 font-medium mb-1" title="SHAP (SHapley Additive exPlanations) decomposition of the LightGBM prediction into 5 interpretable signal categories. Each bar shows how much that category contributed to the total predicted return. Positive = bullish contribution, negative = bearish. The bars sum to the total raw prediction.">Signal Decomposition</div>
                              {([
                                { key: "krj" as const, label: "KRJ Signal", barClass: "bg-blue-500/70", tip: "Legacy KRJ oscillator contribution: how far the stock's price dipped (long_sv) or rallied (short_sv, high_sv) relative to its reference moving average. Positive = price action is bullish, negative = bearish." },
                                { key: "stock_specific" as const, label: "Stock Specific", barClass: "bg-purple-500/70", tip: "Stock-specific characteristics contribution: volatility ratio to SPY, rolling 60-day SPX correlation, log market cap, proximity to 52-week high, and 60-day return autocorrelation. Captures what kind of stock this is and how it tends to behave." },
                                { key: "market_regime" as const, label: "Market Regime", barClass: "bg-emerald-500/70", tip: "Market-wide regime contribution: breadth (% of stocks above reference), dispersion (spread of signals), SPY momentum, SPY dip level, and vol regime. Same value for all tickers — captures whether the overall market environment is bullish or bearish." },
                                { key: "peer_market" as const, label: "Peer Market", barClass: "bg-teal-500/70", tip: "Adaptive peer market contribution: dynamically selects other tickers that are correlated with AND predictive of this stock, weighted by Information Coefficient. Different for every ticker — a bank stock's peers include XLF/IEF, a tech stock's peers include QQQ/XLK. Captures sector, macro, and factor effects through the peer mechanism." },
                                { key: "cross_sectional" as const, label: "Cross-Sectional", barClass: "bg-amber-500/70", tip: "Cross-sectional positioning contribution: how this stock's signals compare to the universe via z-scores, percentile rank, and interaction terms (dip x breadth, dip x dispersion). Captures relative strength or weakness versus peers." },
                              ]).map(({ key, label, barClass, tip }) => {
                                const val = enrichedRow.decomposition[key] ?? 0;
                                const pct = val * 100;
                                // Scale: map contribution to bar width (max ~50px per 1% contribution)
                                const maxBarWidth = 120;
                                const maxContrib = 0.02; // 2% is a large contribution
                                const barWidth = Math.min(Math.abs(val) / maxContrib * maxBarWidth, maxBarWidth);
                                const isPositive = val >= 0;
                                return (
                                  <div key={key} className="flex items-center gap-2 text-xs">
                                    <span className="w-28 text-gray-400 text-right" title={tip}>{label}</span>
                                    <div className="flex items-center w-72">
                                      {/* Center-origin bar chart */}
                                      <div className="relative w-60 h-3 bg-gray-700/50 rounded-sm">
                                        {isPositive ? (
                                          <div
                                            className={`absolute left-1/2 top-0 h-full rounded-r-sm ${barClass}`}
                                            style={{ width: `${barWidth / 2.4}px` }}
                                          />
                                        ) : (
                                          <div
                                            className={`absolute top-0 h-full rounded-l-sm ${barClass}`}
                                            style={{ width: `${barWidth / 2.4}px`, right: "50%" }}
                                          />
                                        )}
                                        {/* Center line */}
                                        <div className="absolute left-1/2 top-0 h-full w-px bg-gray-500" />
                                      </div>
                                    </div>
                                    <span className={`w-16 text-right font-mono ${pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-gray-500"}`}>
                                      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="flex items-center gap-2 text-xs mt-1 pt-1 border-t border-gray-700/50">
                                <span className="w-28 text-gray-300 text-right font-medium" title="Sum of all 5 SHAP contributions plus the model's base value. This equals the raw LightGBM prediction — the model's best estimate of this stock's 1-week forward return before regime adjustment.">Total (raw)</span>
                                <div className="w-72" />
                                <span className={`w-16 text-right font-mono font-medium ${enrichedRow.raw_prediction > 0 ? "text-emerald-300" : enrichedRow.raw_prediction < 0 ? "text-red-300" : "text-gray-400"}`}>
                                  {enrichedRow.raw_prediction > 0 ? "+" : ""}{(enrichedRow.raw_prediction * 100).toFixed(2)}%
                                </span>
                              </div>
                            </div>
                            {/* Summary text */}
                            <div className="text-xs text-gray-400 max-w-xs space-y-1">
                              <div title="The actionable signal: Raw Prediction multiplied by the current Regime Confidence. When the regime model is less confident about the market environment, predictions are scaled down. This is the signal you'd actually use for trading decisions.">
                                <span className="text-gray-300">Regime-adjusted:</span>{" "}
                                <span className={`font-mono ${enrichedRow.regime_adjusted > 0 ? "text-emerald-300" : enrichedRow.regime_adjusted < 0 ? "text-red-300" : "text-gray-400"}`}>
                                  {enrichedRow.regime_adjusted > 0 ? "+" : ""}{(enrichedRow.regime_adjusted * 100).toFixed(2)}%
                                </span>
                              </div>
                              {(() => {
                                const d = enrichedRow.decomposition;
                                const entries = [
                                  { k: "Market regime", v: d.market_regime },
                                  { k: "KRJ signal", v: d.krj },
                                  { k: "Stock-specific", v: d.stock_specific },
                                  { k: "Cross-sectional", v: d.cross_sectional },
                                ];
                                const sorted = [...entries].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
                                const dominant = sorted[0];
                                return (
                                  <div className="text-gray-500" title="The signal category with the largest absolute SHAP contribution — the primary reason this stock has a bullish or bearish prediction. When 'Market regime' dominates, the prediction is mainly about overall market conditions, not this specific stock.">
                                    Dominant driver: <span className="text-gray-300">{dominant.k}</span>{" "}
                                    ({dominant.v > 0 ? "+" : ""}{(dominant.v * 100).toFixed(2)}%)
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
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
