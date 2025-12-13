import fs from "fs";
import path from "path";
import Papa from "papaparse";

type RawRow = Record<string, string>;

type GroupKey = "equities" | "etfs_fx" | "sp500" | "sp100";

const GROUPS: { key: GroupKey; label: string; file: string }[] = [
  { key: "equities", label: "Top Equities", file: "latest_equities.csv" },
  { key: "etfs_fx", label: "ETFs / FX", file: "latest_etfs_fx.csv" },
  { key: "sp500", label: "SP500", file: "latest_sp500.csv" },
  { key: "sp100", label: "SP100", file: "latest_sp100.csv" },
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

function getWeekEnding(rows: RawRow[]): string | null {
  if (!rows.length) return null;
  const raw = rows[0]["date"];
  if (!raw) return null;
  // raw should look like "2025-12-12" or "2025-12-12T00:00:00"
  const d = raw.split("T")[0];
  return d;
}

function formatPercentString(x: string | undefined) {
  if (!x) return "";
  if (x.includes("%")) return x;
  const num = Number(x);
  if (Number.isNaN(num)) return x;
  return (num * 100).toFixed(1) + "%";
}

// Server component
export default function KrjPage() {
  const dataByGroup: Record<GroupKey, RawRow[]> = {
    equities: loadCsv("latest_equities.csv"),
    etfs_fx: loadCsv("latest_etfs_fx.csv"),
    sp500: loadCsv("latest_sp500.csv"),
    sp100: loadCsv("latest_sp100.csv"),
  };

  const summaries: Record<GroupKey, ReturnType<typeof computeSummary>> = {
    equities: computeSummary(dataByGroup.equities),
    etfs_fx: computeSummary(dataByGroup.etfs_fx),
    sp500: computeSummary(dataByGroup.sp500),
    sp100: computeSummary(dataByGroup.sp100),
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

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold mb-2">KRJ Weekly Signals</h1>

      <p className="text-sm text-gray-400">
        Latest snapshot for each group. Source: KRJ_signals_latest_week_*.csv
      </p>

      {GROUPS.map((group) => {
        const rows = dataByGroup[group.key];
        const summary = summaries[group.key];

        return (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{group.label}</h2>
            </div>

            <div className="grid grid-cols-12 gap-4">
              {/* Main table */}
              <div className="col-span-9 border border-gray-700 rounded-lg overflow-auto max-h-[70vh]">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-900 sticky top-0 z-10">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className="px-2 py-1 text-left font-semibold border-b border-gray-700 whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={(row["ticker"] || "") + "-" + idx}
                        className={idx % 2 === 0 ? "bg-black" : "bg-gray-950"}
                      >
                        {columns.map((col) => {
                          let value = row[col.key] ?? "";
                          if (
                            col.key === "long_signal_value" ||
                            col.key === "short_signal_value"
                          ) {
                            value = formatPercentString(value);
                          }
                          return (
                            <td
                              key={col.key}
                              className="px-2 py-1 border-b border-gray-900 whitespace-nowrap"
                            >
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary card (yellow box analogue) */}
              <div className="col-span-3">
                <div className="bg-yellow-300 text-black rounded-lg p-3 shadow">
                  <h3 className="font-semibold mb-2 text-sm">
                    Current vs Last Week (Signals)
                  </h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Signal</th>
                        <th className="text-right">Current</th>
                        <th className="text-right">Last</th>
                        <th className="text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rowsSummary.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td>
                          <td className="text-right">{r.current}</td>
                          <td className="text-right">{r.last}</td>
                          <td
                            className={
                              "text-right " +
                              (r.delta > 0
                                ? "text-green-700"
                                : r.delta < 0
                                ? "text-red-700"
                                : "")
                            }
                          >
                            {r.delta > 0 ? "+" : ""}
                            {r.delta}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold border-t border-yellow-600">
                        <td>Total</td>
                        <td className="text-right">{summary.totals.current}</td>
                        <td className="text-right">{summary.totals.last}</td>
                        <td className="text-right">
                          {summary.totals.current - summary.totals.last}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
