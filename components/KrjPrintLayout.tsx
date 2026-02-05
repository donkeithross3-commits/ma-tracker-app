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

interface KrjPrintLayoutProps {
  groups: GroupData[];
  columns: Array<{ key: string; label: string }>;
  filterDescription?: string;
}

// Formatting helper functions (duplicated from KrjTabsClient for print)
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

// Abbreviate column headers for print to save space
function getAbbreviatedLabel(label: string): string {
  const abbreviations: Record<string, string> = {
    "25 DMA (shifted 3 weeks)": "25 DMA (3w)",
    "ADV (25 DMA - MM Shares)": "ADV (MM)",
    "ADV (25 DMA - $B)": "ADV ($B)",
    "Current Week Signal": "Signal",
    "Last Week Signal": "Last Signal",
    "Vol Ratio (to SP500)": "Vol Ratio",
    "Avg Daily Range (25 DMA)": "Avg Range",
    "Average Trade Size": "Avg Trade",
    // Force these to wrap into 3 lines for narrower columns
    "Long Signal Value": "Long\nSignal\nValue",
    "Short Signal Value": "Short\nSignal\nValue",
  };
  return abbreviations[label] || label;
}

export default function KrjPrintLayout({ groups, columns, filterDescription }: KrjPrintLayoutProps) {
  const numericCols = [
    'c', 'weekly_low', '25DMA', '25DMA_shifted', 
    'long_signal_value', 'short_signal_value', 
    'vol_ratio', '25DMA_range_bps', 
    '25D_ADV_Shares_MM', '25D_ADV_nortional_B', 
    'avg_trade_size'
  ];

  return (
    <div className="print-layout">
      {groups.map((group, groupIdx) => (
        <div key={group.key} className="print-group">
          {/* Group title with optional filter indicator */}
          <h2 className="print-group-title">
            {group.label}
            {filterDescription && (
              <span style={{ fontSize: '0.7em', fontWeight: 'normal', marginLeft: '12px', color: '#666' }}>
                (Filtered: {filterDescription})
              </span>
            )}
          </h2>

          {/* Summary card */}
          <div className="print-summary">
            {group.summary.rowsSummary.map((r, idx) => (
              <span key={r.label}>
                {idx > 0 && " | "}
                <strong>{r.label}:</strong> {r.current}
                <span style={{ 
                  color: r.delta > 0 ? '#166534' : r.delta < 0 ? '#991b1b' : '#000'
                }}>
                  {" "}({r.delta > 0 ? "+" : ""}{r.delta})
                </span>
              </span>
            ))}
            {" | "}
            <strong>Total:</strong> {group.summary.totals.current}
          </div>

          {/* Data table: group name in first thead row so it repeats on every page when table breaks */}
          <table className="print-table">
            <thead>
              <tr>
                <th
                  colSpan={columns.length}
                  className="print-table-group-header"
                  style={{ textAlign: 'left' }}
                >
                  {group.label}
                  {filterDescription && (
                    <span style={{ fontSize: '0.9em', fontWeight: 'normal', marginLeft: '8px', color: '#666' }}>
                      (Filtered: {filterDescription})
                    </span>
                  )}
                </th>
              </tr>
              <tr>
                {columns.map((col) => {
                  const isNumeric = numericCols.includes(col.key);
                  const label = getAbbreviatedLabel(col.label);
                  return (
                    <th
                      key={col.key}
                      className={isNumeric ? 'numeric' : ''}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row, idx) => (
                <tr key={(row["ticker"] || "") + "-" + idx}>
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
                    const isPlaceholder = !!(row.ticker || "").trim() && !(row.c ?? "").toString().trim() && !(row.signal ?? "").toString().trim();
                    if (isPlaceholder && col.key === "signal") value = "No signal yet";
                    return (
                      <td
                        key={col.key}
                        className={isNumeric ? 'numeric' : ''}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Page break after each group except the last */}
          {groupIdx < groups.length - 1 && <div className="page-break" />}
        </div>
      ))}
    </div>
  );
}
