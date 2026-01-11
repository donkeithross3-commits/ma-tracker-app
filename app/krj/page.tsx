import fs from "fs";
import path from "path";
import Papa from "papaparse";
import Link from "next/link";
import KrjTabsClient from "@/components/KrjTabsClient";

// Force dynamic rendering to ensure metadata.json is read at request time
export const dynamic = 'force-dynamic';

type RawRow = Record<string, string>;

type GroupKey = "equities" | "etfs_fx" | "sp500" | "sp100" | "drc";

const GROUPS: { key: GroupKey; label: string; file: string }[] = [
  { key: "equities", label: "Top Equities", file: "latest_equities.csv" },
  { key: "etfs_fx", label: "ETFs / FX", file: "latest_etfs_fx.csv" },
  { key: "sp500", label: "SP500", file: "latest_sp500.csv" },
  { key: "sp100", label: "SP100", file: "latest_sp100.csv" },
  { key: "drc", label: "DRC", file: "latest_drc.csv" },
];

function loadCsv(fileName: string): RawRow[] {
  const filePath = path.join(process.cwd(), "data", "krj", fileName);
  const csv = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<RawRow>(csv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    console.error("CSV parse errors", fileName, parsed.errors);
  }
  return parsed.data;
}

function getSignalDate(): string {
  /**
   * SIGNAL DATE RESOLUTION (FIXED v2):
   * 
   * PROBLEM:
   * - KRJ signals are generated every Friday (e.g., 2025-12-19)
   * - Source CSV filenames contain the signal date: KRJ_signals_latest_week_Equities_2025-12-19.csv
   * - Batch script copies these to latest_*.csv, stripping the date from filename
   * - Previous fix used file modification timestamp (e.g., 2025-12-24) which was wrong
   * 
   * CORRECT SOLUTION:
   * - Batch script (run_krj_batch.py) now extracts the signal date from source filenames
   * - Writes metadata.json with the actual signal date: { "signal_date": "2025-12-19" }
   * - UI reads from metadata.json to display the correct Friday signal date
   * 
   * FALLBACK:
   * - If metadata.json doesn't exist (old batch script), fall back to file timestamp
   * - This ensures backwards compatibility during deployment
   */
  try {
    // Try to read metadata.json first (preferred method)
    const metadataPath = path.join(process.cwd(), "data", "krj", "metadata.json");
    
    if (fs.existsSync(metadataPath)) {
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata = JSON.parse(metadataContent);
      
      if (metadata.signal_date) {
        // Parse YYYY-MM-DD format and format as "Mon DD, YYYY"
        const [year, month, day] = metadata.signal_date.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      }
    }
    
    // Fallback: Use file modification timestamp (backwards compatibility)
    const filePath = path.join(process.cwd(), "data", "krj", "latest_equities.csv");
    const stats = fs.statSync(filePath);
    const fileDate = stats.mtime;
    
    return fileDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch (error) {
    console.error(`Error reading signal date:`, error);
    return "—"; // Defensive fallback only if file is inaccessible
  }
}

function computeSummary(rows: RawRow[]) {
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

function isCurrencyPair(ticker: string): boolean {
  return ticker.startsWith("c:");
}

function sortWithCurrencyPairsFirst(rows: RawRow[]): RawRow[] {
  return [...rows].sort((a, b) => {
    const tickerA = (a["ticker"] || "").trim();
    const tickerB = (b["ticker"] || "").trim();
    
    const isACurrency = isCurrencyPair(tickerA);
    const isBCurrency = isCurrencyPair(tickerB);
    
    // Currency pairs come first
    if (isACurrency && !isBCurrency) return -1;
    if (!isACurrency && isBCurrency) return 1;
    
    // Within same type, sort alphabetically
    return tickerA.localeCompare(tickerB);
  });
}

// Server component
export default function KrjPage() {
  const dataByGroup: Record<GroupKey, RawRow[]> = {
    equities: loadCsv("latest_equities.csv"),
    etfs_fx: sortWithCurrencyPairsFirst(loadCsv("latest_etfs_fx.csv")),
    sp500: loadCsv("latest_sp500.csv"),
    sp100: loadCsv("latest_sp100.csv"),
  drc: loadCsv("latest_drc.csv"),
  };

  // Get the signal date from metadata.json (source of truth)
  // This reflects the actual Friday signal date from the batch pipeline
  const dataDate = getSignalDate();

  const summaries: Record<GroupKey, ReturnType<typeof computeSummary>> = {
    equities: computeSummary(dataByGroup.equities),
    etfs_fx: computeSummary(dataByGroup.etfs_fx),
    sp500: computeSummary(dataByGroup.sp500),
    sp100: computeSummary(dataByGroup.sp100),
  drc: computeSummary(dataByGroup.drc),
  };

  const columns: { key: string; label: string }[] = [
    { key: "ticker", label: "Ticker" },
    { key: "c", label: "Friday Close" },
    { key: "weekly_low", label: "Last Week Low" },
    { key: "25DMA", label: "25 DMA" },
    { key: "25DMA_shifted", label: "25 DMA (shifted 3 weeks)" },
    { key: "long_signal_value", label: "Long Signal Value" },
    { key: "short_signal_value", label: "Short Signal Value" },
    { key: "signal", label: "Current Week Signal" },
    { key: "signal_status_prior_week", label: "Last Week Signal" },
    { key: "vol_ratio", label: "Vol Ratio (to SP500)" },
    { key: "25DMA_range_bps", label: "Avg Daily Range (25 DMA)" },
    { key: "25D_ADV_Shares_MM", label: "ADV (25 DMA - MM Shares)" },
    { key: "25D_ADV_nortional_B", label: "ADV (25 DMA - $B)" },
    { key: "avg_trade_size", label: "Average Trade Size" },
  ];

  const groupsData = GROUPS.map(group => ({
    key: group.key,
    label: group.label,
    rows: dataByGroup[group.key],
    summary: summaries[group.key],
  }));

  return (
    <div className="p-3 bg-gray-950 text-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-2 no-print">
        <div>
          <h1 className="text-3xl font-semibold text-gray-100">
            KRJ Weekly Signals
            <span className="text-xl text-gray-400 ml-3 font-normal">
              {dataDate}
            </span>
          </h1>
        </div>
        <Link
          href="/ma-options"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-semibold transition-colors"
        >
          M&A Options Scanner →
        </Link>
      </div>

      <KrjTabsClient groups={groupsData} columns={columns} />
    </div>
  );
}
