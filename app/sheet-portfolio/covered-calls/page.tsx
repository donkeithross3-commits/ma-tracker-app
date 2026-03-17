"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import Link from "next/link";
import type { CoveredCallResult, CoveredCallsResponse } from "@/types/ma-options";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function fmtDollar(v: number | null | undefined) {
  if (v == null) return "-";
  return `$${v.toFixed(2)}`;
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtPctBold(v: number | null | undefined) {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}
function formatExpiry(expiry: string) {
  if (!expiry || expiry.length !== 8) return expiry;
  const y = expiry.slice(0, 4);
  const m = parseInt(expiry.slice(4, 6), 10);
  const d = expiry.slice(6, 8);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${parseInt(d)}, '${y.slice(2)}`;
}
function yieldColor(v: number) {
  if (v >= 0.20) return "text-green-300 font-bold";
  if (v >= 0.10) return "text-green-400";
  if (v >= 0.05) return "text-yellow-400";
  return "text-gray-400";
}

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------
type SortKey = "annualized_yield" | "if_called_return" | "downside_cushion" | "days_to_expiry" | "open_interest" | "ticker" | "premium" | "static_return";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CoveredCallsPage() {
  const [data, setData] = useState<CoveredCallsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minYield, setMinYield] = useState(0);
  const [minOI, setMinOI] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("annualized_yield");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupByTicker, setGroupByTicker] = useState(true);

  const doScan = useCallback(async (yieldPct: number, oi: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        min_yield: (yieldPct / 100).toString(),
        min_liquidity: oi.toString(),
      });
      const resp = await fetch(`/api/sheet-portfolio/risk/covered-calls?${qs}`, {
        method: "POST",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `HTTP ${resp.status}`);
      }
      const json: CoveredCallsResponse = await resp.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(() => doScan(minYield, minOI), [doScan, minYield, minOI]);

  // Auto-scan on page load with 0/0 defaults
  useEffect(() => { doScan(0, 0); }, [doScan]);

  // Sort and optionally group by ticker (best per ticker)
  const sorted = useMemo(() => {
    if (!data?.results) return [];
    let items = [...data.results];

    if (groupByTicker) {
      // Keep only the best opportunity per ticker (highest ann yield)
      const best = new Map<string, CoveredCallResult>();
      for (const item of items) {
        const existing = best.get(item.ticker);
        if (!existing || item.annualized_yield > existing.annualized_yield) {
          best.set(item.ticker, item);
        }
      }
      items = Array.from(best.values());
    }

    items.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [data, sortKey, sortDir, groupByTicker]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " \u25BC" : " \u25B2";
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-3 py-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/sheet-portfolio" className="text-gray-500 hover:text-gray-300 text-sm">
              &larr; Portfolio
            </Link>
            <h1 className="text-xl font-bold">Covered Call Screener</h1>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Scan all active M&A deals for covered call income opportunities
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-300">Home</Link>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Min Yield</label>
          <input
            type="number"
            value={minYield}
            onChange={e => setMinYield(Number(e.target.value))}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-right font-mono"
            min={0}
            max={100}
            step={1}
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Min OI</label>
          <input
            type="number"
            value={minOI}
            onChange={e => setMinOI(Number(e.target.value))}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-right font-mono"
            min={0}
            step={10}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={groupByTicker}
            onChange={e => setGroupByTicker(e.target.checked)}
            className="rounded"
          />
          Best per ticker
        </label>
        <button
          onClick={scan}
          disabled={loading}
          className="ml-auto px-4 py-1.5 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Scanning..." : data ? "Re-scan" : "Scan All Deals"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 mb-3 text-sm text-red-300">
          {error}
          <button onClick={scan} className="ml-3 text-xs underline hover:text-red-200">Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          <div className="animate-pulse text-gray-400 mb-2">
            Scanning option chains for all active deals...
          </div>
          <div className="text-xs text-gray-600">
            This takes 1-2 minutes (fetching from Polygon for each ticker)
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <div className="text-gray-400 mb-2">Click &quot;Scan All Deals&quot; to find covered call opportunities</div>
          <div className="text-xs text-gray-600">
            Scans Polygon option chains for all active M&A deals and ranks by annualized premium yield
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-2 text-xs text-gray-400">
            <span><strong className="text-gray-200">{sorted.length}</strong> {groupByTicker ? "deals with" : ""} opportunities</span>
            <span>{data.scanned} deals scanned</span>
            {data.errors && data.errors.length > 0 && (
              <span className="text-yellow-500" title={data.errors.map(e => `${e.ticker}: ${e.error}`).join("\n")}>
                {data.errors.length} scan errors
              </span>
            )}
          </div>

          {/* Table */}
          {sorted.length > 0 ? (
            <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <Th align="left" onClick={() => toggleSort("ticker")}>
                      Ticker{sortIndicator("ticker")}
                    </Th>
                    <Th align="right">Stock Px</Th>
                    <Th align="right">Deal Px</Th>
                    <Th align="right">Strike</Th>
                    <Th align="left" onClick={() => toggleSort("days_to_expiry")}>
                      Expiry{sortIndicator("days_to_expiry")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("premium")}>
                      Premium{sortIndicator("premium")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("annualized_yield")}>
                      Ann. Yield{sortIndicator("annualized_yield")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("static_return")}>
                      Static Ret{sortIndicator("static_return")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("if_called_return")}>
                      If Called{sortIndicator("if_called_return")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("downside_cushion")}>
                      Cushion{sortIndicator("downside_cushion")}
                    </Th>
                    <Th align="right" onClick={() => toggleSort("open_interest")}>
                      OI{sortIndicator("open_interest")}
                    </Th>
                    <Th align="right">Vol</Th>
                    <Th align="right">IV</Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr
                      key={`${r.ticker}-${r.strike}-${r.expiry}-${i}`}
                      className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="py-1.5 px-2 font-mono font-semibold">
                        <Link
                          href={`/sheet-portfolio/${r.ticker}/options`}
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {r.ticker}
                        </Link>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtDollar(r.current_price)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtDollar(r.deal_price)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtDollar(r.strike)}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-300 whitespace-nowrap">
                        {formatExpiry(r.expiry)}
                        <span className="text-gray-500 ml-1">({r.days_to_expiry}d)</span>
                        {r.days_to_close != null && (
                          (() => {
                            const diff = r.days_to_close - r.days_to_expiry;
                            const absDiff = Math.abs(diff);
                            const isPre = r.expires_before_close;
                            return (
                              <span className={`ml-1 text-[9px] px-1 py-0.5 rounded ${
                                isPre
                                  ? "bg-green-500/15 text-green-400"
                                  : "bg-yellow-500/15 text-yellow-400"
                              }`}
                                title={isPre
                                  ? `Expires ${absDiff}d before deal close (${r.close_date}) — option likely expires worthless, you keep premium and tender`
                                  : `Expires ${absDiff}d after deal close (${r.close_date}) — assignment risk if deal closes early`}
                              >
                                {isPre ? `${absDiff}d pre` : `${absDiff}d post`}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-green-400">{fmtDollar(r.premium)}</td>
                      <td className={`py-1.5 px-2 text-right font-mono font-bold ${yieldColor(r.annualized_yield)}`}>
                        {fmtPctBold(r.annualized_yield)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-300">{fmtPct(r.static_return)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-300">{fmtPct(r.if_called_return)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-300">{fmtPct(r.downside_cushion)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-400">{r.open_interest}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-500">{r.volume}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-gray-500">
                        {r.implied_vol != null ? `${(r.implied_vol * 100).toFixed(0)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center text-gray-500">
              No covered call opportunities found with current filters.
              Try lowering the minimum yield or OI thresholds.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table header cell
// ---------------------------------------------------------------------------
function Th({ children, align = "left", onClick }: { children: React.ReactNode; align?: "left" | "right"; onClick?: () => void }) {
  return (
    <th
      className={`py-2 px-2 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      } ${onClick ? "cursor-pointer hover:text-gray-200 select-none" : ""}`}
      onClick={onClick}
    >
      {children}
    </th>
  );
}
