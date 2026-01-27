'use client'

import { useState, useEffect, useMemo } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Printer, Filter, X } from "lucide-react"
import KrjPrintLayout from "@/components/KrjPrintLayout"

type RawRow = Record<string, string>;

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
};

interface KrjTabsClientProps {
  groups: GroupData[];
  columns: Array<{ key: string; label: string; description: string }>;
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

export default function KrjTabsClient({ groups, columns }: KrjTabsClientProps) {
  // Print state management
  const [printMode, setPrintMode] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const [currentTab, setCurrentTab] = useState("equities")
  
  // Filter state management
  const [filterColumn, setFilterColumn] = useState<FilterColumn>(null)
  const [filterValues, setFilterValues] = useState<string[]>([])
  
  // Print filter option
  const [printFilteredOnly, setPrintFilteredOnly] = useState(true)

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

  // Print dialog handlers
  const handleOpenPrintDialog = () => {
    setShowPrintDialog(true)
  }

  // Prepare groups for printing (with optional filtering)
  const getGroupsForPrint = useMemo(() => {
    const groupKeys = selectedGroups.length > 0 ? selectedGroups : [currentTab];
    return groups
      .filter(g => groupKeys.includes(g.key))
      .map(g => {
        const rows = (isFilterActive && printFilteredOnly) ? getFilteredRows(g.rows) : g.rows;
        const summary = (isFilterActive && printFilteredOnly) ? computeSummaryFromRows(rows) : g.summary;
        return { ...g, rows, summary };
      });
  }, [groups, selectedGroups, currentTab, isFilterActive, printFilteredOnly, filterColumn, filterValues]);

  const handlePrint = () => {
    // If no groups selected, default to current tab
    const groupsToPrint = selectedGroups.length > 0 ? selectedGroups : [currentTab]
    setSelectedGroups(groupsToPrint)
    setShowPrintDialog(false)
    
    // Wait for dialog to close before triggering print
    setTimeout(() => {
      setPrintMode(true)
    }, 150)
  }

  const handleSelectCurrentTab = () => {
    setSelectedGroups([currentTab])
  }

  const handleSelectAll = () => {
    setSelectedGroups(groups.map(g => g.key))
  }

  const handleToggleGroup = (groupKey: string) => {
    setSelectedGroups(prev => 
      prev.includes(groupKey)
        ? prev.filter(k => k !== groupKey)
        : [...prev, groupKey]
    )
  }

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

            {/* Filter option for print */}
            {isFilterActive && (
              <div className="border-t border-gray-700 pt-4">
                <p className="text-sm text-gray-400 mb-2">Filter active: {getFilterDescription()}</p>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="print-filtered-only"
                    checked={printFilteredOnly}
                    onCheckedChange={(checked) => setPrintFilteredOnly(checked === true)}
                  />
                  <label
                    htmlFor="print-filtered-only"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Print filtered rows only
                  </label>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={() => setShowPrintDialog(false)}
              variant="outline"
              className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePrint}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
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
          filterDescription={isFilterActive && printFilteredOnly ? getFilterDescription() : undefined}
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
              {groups.map((group) => (
                <TabsTrigger
                  key={group.key}
                  value={group.key}
                  className="data-[state=active]:bg-gray-700 data-[state=active]:text-gray-100 text-gray-400 text-lg px-3 py-1"
                >
                  {group.label}
                </TabsTrigger>
              ))}
            </TabsList>
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

      {groups.map((group) => {
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
                        
                        return (
                          <td
                            key={col.key}
                            className={`px-1 py-0.5 border-b border-gray-700 whitespace-nowrap ${isNumeric ? 'text-right' : 'text-left'} ${cellColorClass}`}
                          >
                            {value}
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
