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
  /** Shown when index constituent count is outside expected range */
  compositionWarning?: string;
};

// Enriched signal decomposition data (from Python signal_generator.py)
type EnrichedTickerData = {
  raw_prediction: number;
  regime_adjusted: number;
  ticker_confidence?: number;
  optimized_signal?: string;
  ticker_regime_confidence?: {
    hit_rate: number;
    raw_hit_rate: number;
    n_weeks: number;
    confidence: number;
  };
  decomposition: {
    krj: number;
    stock_specific: number;
    market_state: number;
    factor_sensitivity: number;
    peer_market: number;
    cross_sectional: number;
    // Legacy compat: old key still accepted
    market_regime?: number;
  };
  legacy_signal: string;
  legacy_long_sv: number | null;
  legacy_short_sv: number | null;
};

type EnrichedRegime = {
  // New macro regime classifier fields
  name?: string;
  probability?: number;
  dimensions?: Record<string, number>;
  all_probabilities?: Record<string, number>;
  description?: string;
  is_transition?: boolean;
  entropy?: number;
  runner_up_regime?: string;
  runner_up_probability?: number;
  confidence?: {
    score: number;
    label: string;
    regime_historical_quality: number;
    regime_historical_hit_rate: number;
    n_historical_weeks: number;
  };
  // Legacy fields (backward compat)
  score: number;
  label: string;
  features?: {
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

type DisplacementRegimeContext = {
  regime_label: string;
  regime_prob: number;
  regime_age_days: number;
  transitioning: boolean;
  interpretation: string;
  regime_weight_applied?: boolean;
} | null;

type TransitionWarning = {
  warning_score: number;
  warning_level: string;
  components: {
    prob_instability: number;
    prob_3w_change: number;
    current_prob: number;
    velocity_score: number;
    features_used: string[];
  };
} | null;

interface KrjTabsClientProps {
  groups: GroupData[];
  columns: Array<{ key: string; label: string; description: string }>;
  userId?: string | null;
  userAlias?: string | null;
  enrichedSignals?: EnrichedSignalsData | null;
  displacementRegimeContext?: DisplacementRegimeContext;
  transitionWarning?: TransitionWarning;
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

export default function KrjTabsClient({ groups: groupsProp, columns, userId, userAlias, enrichedSignals, displacementRegimeContext, transitionWarning }: KrjTabsClientProps) {
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

      {/* Macro Regime Banner */}
      {regime && (() => {
        const regimeName = regime.name ?? regime.label ?? "Unknown";
        const regimeProb = regime.probability ?? 0;
        const dims = regime.dimensions;
        const allProbs = regime.all_probabilities;
        // confidence can be a number (old format) or an object (new format)
        const conf = typeof regime.confidence === "object" && regime.confidence !== null
          ? regime.confidence
          : null;
        const desc = regime.description ?? "";

        const isTransition = Boolean(regime.is_transition);
        // Color by regime name (V2: 7 regimes)
        const regimeColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
          "Crisis": { bg: "bg-red-900/50", border: "border-red-700/60", text: "text-red-200", dot: "bg-red-400" },
          "Liquidity Shock": { bg: "bg-red-800/40", border: "border-red-600/50", text: "text-red-300", dot: "bg-red-500" },
          "Stagflation": { bg: "bg-orange-900/40", border: "border-orange-700/50", text: "text-orange-200", dot: "bg-orange-400" },
          "Defensive Rotation": { bg: "bg-yellow-900/30", border: "border-yellow-700/40", text: "text-yellow-200", dot: "bg-yellow-400" },
          "Safe Haven Rotation": { bg: "bg-yellow-900/30", border: "border-yellow-700/40", text: "text-yellow-200", dot: "bg-yellow-400" },
          "Reflation Rally": { bg: "bg-emerald-900/40", border: "border-emerald-700/50", text: "text-emerald-200", dot: "bg-emerald-400" },
          "Goldilocks": { bg: "bg-sky-900/40", border: "border-sky-700/50", text: "text-sky-200", dot: "bg-sky-400" },
          "Steady Growth": { bg: "bg-gray-800/60", border: "border-gray-700/40", text: "text-gray-300", dot: "bg-blue-400" },
        };
        const colors = regimeColors[regimeName] ?? regimeColors["Steady Growth"];

        // Dimension gauge helper
        const DimGauge = ({ label, value, tooltip }: { label: string; value: number; tooltip: string }) => {
          const clamped = Math.max(-3, Math.min(3, value));
          const pct = ((clamped + 3) / 6) * 100;
          const isPositive = value >= 0;
          return (
            <div title={tooltip} className="flex-1 min-w-0">
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-gray-500 truncate">{label}</span>
                <span className={`font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                  {value > 0 ? "+" : ""}{value.toFixed(2)}
                </span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full relative overflow-hidden">
                <div className="absolute top-0 left-1/2 w-px h-full bg-gray-500/50" />
                {isPositive ? (
                  <div className="absolute top-0 h-full bg-emerald-500/70 rounded-full" style={{ left: "50%", width: `${(pct - 50)}%` }} />
                ) : (
                  <div className="absolute top-0 h-full bg-red-500/70 rounded-full" style={{ left: `${pct}%`, width: `${(50 - pct)}%` }} />
                )}
              </div>
            </div>
          );
        };

        return (
        <div className="mb-1">
          <button
            onClick={() => setRegimeBannerExpanded(!regimeBannerExpanded)}
            title={desc || `Macro regime classification based on 4-week rolling returns of 10 benchmark ETFs (SPY, QQQ, IWM, GLD, SLV, TLT, UUP, USO, HYG, EEM). Uses PCA + Gaussian Mixture Model to identify 5 market states. Click to expand.`}
            className={`w-full text-left rounded px-3 py-1.5 text-sm font-medium transition-colors ${colors.bg} border ${colors.border} ${colors.text}`}
          >
            <span className="flex items-center gap-3">
              <span className={`inline-block w-2 h-2 rounded-full ${colors.dot}`} />
              <span className="flex-1 min-w-0">
                <span>
                  Macro Regime: <span className="font-semibold">{regimeName}</span>
                  {isTransition && (
                    <span className="ml-1.5 text-[10px] opacity-60 italic" title="Regime classification uncertain (low posterior probability)">
                      (transition)
                    </span>
                  )}
                </span>
                <span className="ml-2 opacity-70 text-xs">
                  ({(regimeProb * 100).toFixed(0)}% probability)
                </span>
              </span>
              {conf && (
                <span className="text-xs opacity-60 whitespace-nowrap" title={`Signal confidence in this regime. Based on historical out-of-sample prediction quality when the market was in the "${regimeName}" regime. Hit rate = fraction of per-ticker predictions that got the direction right.`}>
                  hist. hit: {(conf.regime_historical_hit_rate * 100).toFixed(0)}% ({conf.n_historical_weeks}w)
                </span>
              )}
              <span className="text-xs opacity-50 flex-shrink-0">
                {regimeBannerExpanded ? "collapse" : "expand"}
              </span>
            </span>
          </button>
          {regimeBannerExpanded && (
            <div className="mt-1 rounded bg-gray-800/40 border border-gray-700/30 px-3 py-2 text-xs text-gray-400">
              {/* Regime probabilities (primary): always show every regime with label + percentage */}
              {(() => {
                const regimeList = [
                  { key: "steady_growth", label: "Steady Growth", color: "bg-blue-600", textColor: "text-blue-400" },
                  { key: "goldilocks", label: "Goldilocks", color: "bg-sky-500", textColor: "text-sky-400" },
                  { key: "reflation_rally", label: "Reflation Rally", color: "bg-emerald-500", textColor: "text-emerald-400" },
                  { key: "defensive_rotation", label: "Defensive Rotation", color: "bg-yellow-500", textColor: "text-yellow-400" },
                  { key: "safe_haven_rotation", label: "Safe Haven Rotation", color: "bg-yellow-600", textColor: "text-yellow-500" },
                  { key: "stagflation", label: "Stagflation", color: "bg-orange-500", textColor: "text-orange-400" },
                  { key: "liquidity_shock", label: "Liquidity Shock", color: "bg-red-500", textColor: "text-red-400" },
                  { key: "crisis", label: "Crisis", color: "bg-red-600", textColor: "text-red-500" },
                ];
                return (
                  <div className="mb-2">
                    <div className="text-[10px] text-gray-500 mb-1">Regime Probabilities</div>
                    <div className="flex h-2.5 rounded-sm overflow-hidden gap-px">
                      {(() => {
                        const minP = 0.005;
                        const total = regimeList.reduce((s, { key }) => s + Math.max(allProbs?.[key] ?? 0, minP), 0);
                        return regimeList.map(({ key, label, color }) => {
                          const p = allProbs?.[key] ?? 0;
                          const pct = (Math.max(p, minP) / total) * 100;
                          return (
                            <div
                              key={key}
                              style={{ width: `${pct}%` }}
                              className={`${color} relative group cursor-default min-w-0`}
                              title={`${label}: ${(p * 100).toFixed(1)}%`}
                            />
                          );
                        });
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                      {regimeList.map(({ key, label, textColor }) => {
                        const p = allProbs?.[key] ?? 0;
                        return (
                          <span key={key} className={textColor}>
                            {label}: {(p * 100).toFixed(0)}%
                          </span>
                        );
                      })}
                    </div>
                    {/* Uncertainty / runner-up line when backend provides it */}
                    {(typeof regime.entropy === "number" || (regime.runner_up_regime && typeof regime.runner_up_probability === "number")) && (
                      <div className="text-[10px] text-gray-500 mt-1">
                        {typeof regime.entropy === "number" && (
                          <span title="Higher entropy = more uncertainty in regime assignment">
                            Uncertainty: {regime.entropy < 0.5 ? "low" : regime.entropy < 1.2 ? "moderate" : "high"} (entropy {regime.entropy.toFixed(2)})
                          </span>
                        )}
                        {regime.runner_up_regime && typeof regime.runner_up_probability === "number" && (
                          <span className={typeof regime.entropy === "number" ? " ml-2" : ""}>
                            Runner-up: {regime.runner_up_regime} {(regime.runner_up_probability * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Signal confidence in current regime */}
              {conf && (
                <div className="text-[10px] text-gray-500 border-t border-gray-700/30 pt-1">
                  Signal confidence in <span className="text-gray-300">{regimeName}</span> regime:
                  {" "}
                  <span className="text-gray-300">
                    {(conf.regime_historical_hit_rate * 100).toFixed(1)}% directional hit rate
                  </span>
                  {" "}across {conf.n_historical_weeks} historical weeks
                  {" "}(Spearman quality: {conf.regime_historical_quality > 0 ? "+" : ""}{(conf.regime_historical_quality * 100).toFixed(2)}%)
                </div>
              )}
              {/* Description */}
              {desc && (
                <div className="text-[10px] text-gray-500 mt-1 italic">
                  {desc}
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* Displacement Regime Banner */}
      {displacementRegimeContext && (() => {
        const drc = displacementRegimeContext;
        const isMomentum = drc.interpretation.startsWith("MOMENTUM");
        const borderColor = isMomentum ? "border-l-emerald-500" : "border-l-amber-500";
        const textAccent = isMomentum ? "text-emerald-400" : "text-amber-400";
        return (
          <div className={`mb-1 rounded bg-gray-900/60 border border-gray-700/40 border-l-2 ${borderColor} px-3 py-1.5 text-sm flex items-center gap-3`}>
            <span className="text-gray-400">Displacement Regime:</span>
            <span className="text-gray-200 font-medium">{drc.regime_label}</span>
            <span className="text-gray-500">({(drc.regime_prob * 100).toFixed(0)}%)</span>
            <span className="text-gray-600">|</span>
            <span className={`font-medium ${textAccent}`}>{drc.interpretation}</span>
            {drc.regime_weight_applied && (
              <>
                <span className="text-gray-600">|</span>
                <span className="text-gray-400 text-xs" title="Regime weights are active: signals may be amplified, inverted, or suppressed based on leader type and regime context">
                  Regime weights active
                </span>
              </>
            )}
            {transitionWarning && (() => {
              const tw = transitionWarning;
              const levelColors: Record<string, { bg: string; text: string; border: string }> = {
                low: { bg: "bg-emerald-900/50", text: "text-emerald-300", border: "border-emerald-700/50" },
                moderate: { bg: "bg-yellow-900/50", text: "text-yellow-300", border: "border-yellow-700/50" },
                elevated: { bg: "bg-orange-900/50", text: "text-orange-300", border: "border-orange-700/50" },
                high: { bg: "bg-red-900/50", text: "text-red-300", border: "border-red-700/50" },
              };
              const c = levelColors[tw.warning_level] ?? levelColors.low;
              const prob3wPct = (tw.components.prob_3w_change * 100).toFixed(1);
              const prob3wSign = tw.components.prob_3w_change >= 0 ? "+" : "";
              return (
                <>
                  <span className="text-gray-600">|</span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${c.bg} ${c.text} ${c.border} cursor-default`}
                    title={`Transition Warning Score: ${tw.warning_score.toFixed(2)}\nLevel: ${tw.warning_level}\n\nComponents:\n  Prob instability: ${tw.components.prob_instability.toFixed(3)} (1 - current regime prob)\n  Current regime prob: ${(tw.components.current_prob * 100).toFixed(1)}%\n  3-week prob change: ${prob3wSign}${prob3wPct}%\n  Feature velocity: ${tw.components.velocity_score.toFixed(3)}\n  Features: ${tw.components.features_used.join(", ")}\n\nThresholds: low <0.3, moderate 0.3-0.5, elevated 0.5-0.7, high >0.7`}
                  >
                    Transition: {tw.warning_level} ({tw.warning_score.toFixed(2)})
                  </span>
                </>
              );
            })()}
          </div>
        );
      })()}

      {visibleGroups.map((group) => {
        const filteredRows = getFilteredRows(group.rows);
        const sortedRows = sortRows(filteredRows, sortConfig);
        const displaySummary = isFilterActive ? computeSummaryFromRows(filteredRows) : group.summary;
        
        return (
        <TabsContent key={group.key} value={group.key} className="mt-0">
          {group.compositionWarning && (
            <div className="mb-1 rounded bg-amber-900/40 border border-amber-600/50 px-3 py-1.5 text-sm text-amber-200" role="alert">
              {group.compositionWarning}
            </div>
          )}
          {/* Summary card and filter controls - same row */}
          <div className="mb-1 flex items-center gap-4 flex-wrap">
            {/* Yellow summary box */}
            <div title="Signal summary for this list. L = Long, N = Neutral, S = Short. Tot = tickers with signal data. The number in parentheses is total constituents in the list." className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
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
              {group.rows.length !== displaySummary.totals.current && (
                <span className="text-black/80"> ({group.rows.length} tickers)</span>
              )}
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
                    const numericCols = ['market_cap_b', 'c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size', 'prediction', 'adj_prediction', 'displacement_composite', 'displacement_confidence'];
                    const isNumeric = numericCols.includes(col.key);
                    const isSorted = sortConfig.column === col.key;
                    return (
                      <th
                        key={col.key}
                        title={col.description}
                        onClick={() => handleColumnSort(col.key)}
                        className={`px-1.5 py-1 ${isNumeric ? 'text-right' : 'text-left'} font-bold text-gray-100 border-b border-gray-600 whitespace-nowrap text-[13px] leading-tight cursor-pointer select-none hover:bg-gray-700/50 transition-colors ${isSorted ? 'text-blue-300' : ''}`}
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
                  const numericCols = ['market_cap_b', 'c', 'weekly_low', '25DMA', '25DMA_shifted', 'long_signal_value', 'short_signal_value', 'vol_ratio', '25DMA_range_bps', '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 'avg_trade_size', 'prediction', 'adj_prediction', 'displacement_composite', 'displacement_confidence'];
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
                            <td key={col.key} title={`Raw LightGBM predicted 1-week return for ${tickerUpper}: ${p > 0 ? "+" : ""}${p.toFixed(3)}%. This is the model's best estimate of next week's price change, before regime adjustment. Scale: within ±0.5% is weak/noise. ±0.5-1.5% is a moderate signal. Beyond ±2% is strong conviction (rare). The prediction is capped at ±15% as a guardrail.`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls}`}>
                              {p > 0 ? "+" : ""}{p.toFixed(2)}%
                            </td>
                          );
                        }
                        if (col.key === "adj_prediction" && enrichedRow) {
                          const p = enrichedRow.regime_adjusted * 100;
                          const tickerConf = enrichedRow.ticker_confidence ?? 0;
                          const cls = p > 0 ? "text-emerald-400" : p < 0 ? "text-red-400" : "text-gray-400";
                          return (
                            <td key={col.key} title={`Regime-adjusted prediction for ${tickerUpper}: ${p > 0 ? "+" : ""}${p.toFixed(3)}%. Calculated as Raw Prediction (${(enrichedRow.raw_prediction * 100).toFixed(2)}%) x Per-Ticker Confidence (${(tickerConf * 100).toFixed(1)}%). Confidence is based on ${tickerUpper}'s historical directional hit rate in the current "${regime?.name ?? "?"}" regime${enrichedRow.ticker_regime_confidence ? ` (${(enrichedRow.ticker_regime_confidence.hit_rate * 100).toFixed(0)}% hit rate over ${enrichedRow.ticker_regime_confidence.n_weeks} weeks)` : ""}.`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls}`}>
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

                        // Signal source mini bar (with intensity shading)
                        if (col.key === "signal_source" && enrichedRow) {
                          const d = enrichedRow.decomposition;
                          const mktState = d.market_state ?? d.market_regime ?? 0;
                          const factorSens = d.factor_sensitivity ?? 0;
                          const peerMkt = d.peer_market ?? 0;
                          const total = Math.abs(d.krj) + Math.abs(d.stock_specific) + Math.abs(mktState) + Math.abs(factorSens) + Math.abs(peerMkt) + Math.abs(d.cross_sectional);
                          const pctKrj = total > 0 ? Math.abs(d.krj) / total * 100 : 16.67;
                          const pctStock = total > 0 ? Math.abs(d.stock_specific) / total * 100 : 16.67;
                          const pctMktState = total > 0 ? Math.abs(mktState) / total * 100 : 16.67;
                          const pctFactor = total > 0 ? Math.abs(factorSens) / total * 100 : 16.67;
                          const pctPeer = total > 0 ? Math.abs(peerMkt) / total * 100 : 16.67;
                          const pctCross = total > 0 ? Math.abs(d.cross_sectional) / total * 100 : 16.67;
                          // Intensity: scale opacity by total SHAP magnitude relative to a reference (2% = full intensity)
                          const intensityRef = 0.02;
                          const intensity = Math.max(0.15, Math.min(1.0, total / intensityRef));
                          return (
                            <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap">
                              <div className="flex h-3 w-20 rounded-sm overflow-hidden" style={{ opacity: intensity }} title={`SHAP signal decomposition for ${tickerUpper} (intensity: ${(intensity*100).toFixed(0)}%) — how much each category contributes to the prediction:\n\nBlue = KRJ Signal (${(d.krj*100).toFixed(2)}%): price action vs moving average\nPurple = Stock Specific (${(d.stock_specific*100).toFixed(2)}%): vol, correlation, market cap, 52w high, autocorr\nGreen = Market State (${(mktState*100).toFixed(2)}%): breadth, dispersion, vol regime\nRose = Factor Sensitivity (${(factorSens*100).toFixed(2)}%): per-ticker betas to 10 macro factors\nTeal = Peer Market (${(peerMkt*100).toFixed(2)}%): adaptive peer signal weighted by IC\nAmber = Cross-Sectional (${(d.cross_sectional*100).toFixed(2)}%): z-scores, rank, interactions\n\nBright = bullish, Dark = bearish. Faded = low conviction. Click row to expand.`}>
                                <div style={{ width: `${pctKrj}%` }} className={d.krj >= 0 ? "bg-blue-500" : "bg-blue-800"} />
                                <div style={{ width: `${pctStock}%` }} className={d.stock_specific >= 0 ? "bg-purple-500" : "bg-purple-800"} />
                                <div style={{ width: `${pctMktState}%` }} className={mktState >= 0 ? "bg-emerald-500" : "bg-emerald-800"} />
                                <div style={{ width: `${pctFactor}%` }} className={factorSens >= 0 ? "bg-rose-500" : "bg-rose-800"} />
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

                        // Displacement composite z-score (heatmap cell)
                        if (col.key === "displacement_composite") {
                          const raw = row.displacement_composite;
                          if (!raw || raw === "") {
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right text-gray-600 text-sm">--</td>
                            );
                          }
                          const z = Number(raw);
                          const absZ = Math.abs(z);
                          const weightAction = (row.displacement_weight_action || "").trim();
                          const isSuppressed = weightAction === "suppress";
                          const cls = isSuppressed ? "text-gray-500" : absZ < 0.5 ? "text-gray-400" : z > 0 ? "text-emerald-400" : "text-red-400";
                          // Subtle heatmap background: intensity 0-20% based on |z| (capped at 3)
                          const bgOpacity = isSuppressed ? 0 : Math.min(absZ / 3, 1) * 0.2;
                          const bgColor = z > 0 ? `rgba(16, 185, 129, ${bgOpacity})` : z < 0 ? `rgba(239, 68, 68, ${bgOpacity})` : "transparent";
                          return (
                            <td key={col.key} title={`Displacement composite z-score for ${tickerUpper}: ${z > 0 ? "+" : ""}${z.toFixed(3)}. 1m z: ${row.displacement_1m_z ?? "n/a"}, 3m z: ${row.displacement_3m_z ?? "n/a"}. Benchmark: ${row.displacement_benchmark ?? "n/a"}${weightAction ? `. Weight action: ${weightAction}` : ""}`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls} ${isSuppressed ? "opacity-50" : ""}`} style={{ backgroundColor: bgColor }}>
                              {z > 0 ? "+" : ""}{z.toFixed(2)}
                            </td>
                          );
                        }

                        // Displacement direction pill (LONG/SHORT/NEUTRAL) with regime weight indicators
                        if (col.key === "displacement_direction") {
                          const dir = (row.displacement_direction || "").trim();
                          if (!dir) {
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-gray-600 text-sm">--</td>
                            );
                          }
                          const weightAction = (row.displacement_weight_action || "").trim();
                          const leaderType = (row.displacement_leader_type || "").trim();
                          const regimeWeight = row.displacement_regime_weight ? Number(row.displacement_regime_weight) : null;
                          const isInverted = weightAction === "invert";
                          const isSuppressed = weightAction === "suppress";
                          const pillCls = isSuppressed
                            ? "bg-gray-800/50 text-gray-500 border-gray-700/50"
                            : isInverted
                            ? dir === "LONG"
                              ? "bg-emerald-900/50 text-emerald-300 border-amber-500/60"
                              : dir === "SHORT"
                              ? "bg-red-900/50 text-red-300 border-amber-500/60"
                              : "bg-gray-800/50 text-gray-400 border-amber-500/60"
                            : dir === "LONG"
                            ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/50"
                            : dir === "SHORT"
                            ? "bg-red-900/50 text-red-300 border-red-700/50"
                            : "bg-gray-800/50 text-gray-400 border-gray-700/50";
                          const leaderAbbrev: Record<string, string> = { old_leader: "old", new_leader: "new", defensive: "def", cyclical: "cyc", other: "oth" };
                          const leaderLabel = leaderType ? (leaderAbbrev[leaderType] ?? leaderType.replace(/_/g, " ")) : "";
                          const leaderFull = leaderType ? leaderType.replace(/_/g, " ") : "";
                          const tooltipParts = [`Direction: ${dir}`];
                          if (weightAction) tooltipParts.push(`Weight action: ${weightAction}`);
                          if (regimeWeight != null) tooltipParts.push(`Regime weight: ${regimeWeight.toFixed(2)}`);
                          if (leaderFull) tooltipParts.push(`Leader type: ${leaderFull}`);
                          return (
                            <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap" title={tooltipParts.join("\n")}>
                              <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium border ${pillCls} ${isSuppressed ? "opacity-50" : ""}`}>
                                {isInverted && <span className="text-amber-400 text-[10px]" title="Signal inverted by regime weights">inv</span>}
                                {dir}
                              </span>
                              {leaderLabel && (
                                <span className="ml-0.5 text-[10px] text-gray-500" title={`Leader type: ${leaderFull}`}>
                                  {leaderLabel}
                                </span>
                              )}
                            </td>
                          );
                        }

                        // Displacement confidence (0-1 decimal, dimmed when low or suppressed)
                        if (col.key === "displacement_confidence") {
                          const raw = row.displacement_confidence;
                          if (!raw || raw === "") {
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right text-gray-600 text-sm">--</td>
                            );
                          }
                          const conf = Number(raw);
                          const weightAction = (row.displacement_weight_action || "").trim();
                          const isSuppressed = weightAction === "suppress";
                          const cls = isSuppressed ? "text-gray-600" : conf >= 0.5 ? "text-gray-200" : conf >= 0.25 ? "text-gray-400" : "text-gray-600";
                          return (
                            <td key={col.key} title={`Displacement confidence for ${tickerUpper}: ${conf.toFixed(3)}${weightAction ? `. Weight action: ${weightAction}` : ""}`} className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap text-right font-mono text-sm ${cls} ${isSuppressed ? "opacity-50" : ""}`}>
                              {conf.toFixed(3)}
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

                        // Override optimized signal columns from enriched JSON data
                        if (col.key === "optimized_signal" && enrichedRow && enrichedRow.optimized_signal) {
                          value = enrichedRow.optimized_signal;
                        }
                        
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
                            {/* 6 SHAP group bars */}
                            <div className="flex-1 space-y-1">
                              <div className="text-xs text-gray-400 font-medium mb-1" title="SHAP (SHapley Additive exPlanations) decomposition of the LightGBM prediction into 6 interpretable signal categories. Each bar shows how much that category contributed to the total predicted return. Positive = bullish contribution, negative = bearish. The bars sum to the total raw prediction.">Signal Decomposition</div>
                              {([
                                { key: "krj" as const, label: "KRJ Signal", barClass: "bg-blue-500/70", tip: "Legacy KRJ oscillator contribution: how far the stock's price dipped (long_sv) or rallied (short_sv, high_sv) relative to its reference moving average. Positive = price action is bullish, negative = bearish. Typical contribution: -0.02% to +0.02%. When this dominates (>0.05%), the stock's own price action is strongly driving the signal." },
                                { key: "stock_specific" as const, label: "Stock Specific", barClass: "bg-purple-500/70", tip: "Stock-specific characteristics contribution: volatility ratio, SPX correlation, market cap, 52-week high proximity, and return autocorrelation. Typical contribution: -0.3% to +0.2%. Large negative values often come from small-cap, high-vol stocks that the model views as riskier. Near zero for blue-chips." },
                                { key: "market_state" as const, label: "Market State", barClass: "bg-emerald-500/70", tip: "Market-wide state contribution from breadth, dispersion, and vol regime. Same for all tickers in a given week — captures whether the overall market environment is bullish or bearish. Typical contribution: -0.5% to +0.3%. Smaller than the old 'Market Regime' group because directional factors (SPY momentum, market dip) have been replaced by per-ticker factor sensitivity." },
                                { key: "factor_sensitivity" as const, label: "Factor Sensitivity", barClass: "bg-rose-500/70", tip: "Per-ticker multi-factor contribution: rolling 60-day betas to 10 macro benchmarks (SPY, QQQ, IWM, GLD, SLV, TLT, UUP, USO, HYG, EEM) multiplied by each benchmark's current weekly return. DIFFERENT for every ticker — a bank has high beta to TLT/HYG, a gold miner to GLD/SLV, a tech stock to QQQ. This is the key factor that makes market impact stock-specific rather than uniform." },
                                { key: "peer_market" as const, label: "Peer Market", barClass: "bg-teal-500/70", tip: "Adaptive peer market contribution: dynamically selects correlated tickers with predictive ability (weighted by IC). Different for every ticker — captures sector/thematic relationships beyond the 10 macro benchmarks. Typical contribution: -0.1% to +0.1%." },
                                { key: "cross_sectional" as const, label: "Cross-Sectional", barClass: "bg-amber-500/70", tip: "Cross-sectional positioning: z-scores, percentile rank, and interaction terms vs the universe. Typical contribution: -0.02% to +0.02%. Captures relative strength or weakness. Large positive = stock is holding up better than peers; large negative = lagging." },
                              ]).map(({ key, label, barClass, tip }) => {
                                const decomp = enrichedRow.decomposition;
                                const rawVal = key === "market_state" ? (decomp.market_state ?? decomp.market_regime ?? 0) : (decomp[key] ?? 0);
                                const val = rawVal;
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
                                <span className="w-28 text-gray-300 text-right font-medium" title="Sum of all 6 SHAP contributions plus the model's base value. This equals the raw LightGBM prediction — the model's best estimate of this stock's 1-week forward return before regime adjustment.">Total (raw)</span>
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
                                  { k: "Market state", v: d.market_state ?? d.market_regime ?? 0 },
                                  { k: "Factor sensitivity", v: d.factor_sensitivity ?? 0 },
                                  { k: "KRJ signal", v: d.krj },
                                  { k: "Stock-specific", v: d.stock_specific },
                                  { k: "Peer market", v: d.peer_market ?? 0 },
                                  { k: "Cross-sectional", v: d.cross_sectional },
                                ];
                                const sorted = [...entries].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
                                const dominant = sorted[0];
                                return (
                                  <div className="text-gray-500" title="The signal category with the largest absolute SHAP contribution — the primary reason this stock has a bullish or bearish prediction. When 'Factor sensitivity' dominates, the prediction is driven by this stock's specific macro factor exposures (betas to SPY, QQQ, TLT, GLD, etc).">
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
