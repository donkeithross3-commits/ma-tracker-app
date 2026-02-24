"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

interface Deal {
  ticker: string;
  acquiror: string;
  category: string;
  deal_price: number | null;
  current_price: number | null;
  gross_yield: number | null;
  current_yield: number | null;
  deal_price_raw: string | null;
  current_price_raw: string | null;
  gross_yield_raw: string | null;
  current_yield_raw: string | null;
  investable: string | null;
  vote_risk: string | null;
  finance_risk: string | null;
  legal_risk: string | null;
}

interface HealthStatus {
  status: string;
  last_success_date: string | null;
  last_success_rows: number;
  last_success_at: string | null;
  recent_failures: number;
}

function riskBadge(risk: string | null) {
  if (!risk) return null;
  const lower = risk.toLowerCase();
  let color = "text-gray-400 bg-gray-400/10";
  if (lower.startsWith("low")) color = "text-green-400 bg-green-400/10";
  else if (lower.startsWith("med")) color = "text-yellow-400 bg-yellow-400/10";
  else if (lower.startsWith("high")) color = "text-red-400 bg-red-400/10";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
      {risk.length > 12 ? risk.slice(0, 12) + "..." : risk}
    </span>
  );
}

function yieldCell(raw: string | null, parsed: number | null) {
  if (raw === "#DIV/0!" || raw === "#VALUE!" || raw === "#N/A") {
    return <span className="text-gray-500">N/A</span>;
  }
  if (parsed === null) return <span className="text-gray-500">-</span>;
  const pct = (parsed * 100).toFixed(2);
  const color = parsed >= 0 ? "text-green-400" : "text-red-400";
  return <span className={color}>{pct}%</span>;
}

export default function SheetPortfolioPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string>("ticker");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState<string>("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [dealsResp, healthResp] = await Promise.all([
        fetch("/api/sheet-portfolio/deals"),
        fetch("/api/sheet-portfolio/health"),
      ]);
      if (dealsResp.ok) {
        setDeals(await dealsResp.json());
      } else {
        setError("Failed to load deals");
      }
      if (healthResp.ok) {
        setHealth(await healthResp.json());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleIngest() {
    setIngesting(true);
    setIngestResult(null);
    try {
      const resp = await fetch("/api/sheet-portfolio/ingest?force=true", {
        method: "POST",
      });
      const data = await resp.json();
      if (resp.ok) {
        setIngestResult(
          data.skipped
            ? "Skipped (no changes)"
            : `Ingested ${data.row_count} rows`
        );
        fetchData();
      } else {
        setIngestResult(`Error: ${data.error || data.detail}`);
      }
    } catch (e) {
      setIngestResult(
        `Error: ${e instanceof Error ? e.message : "Ingest failed"}`
      );
    } finally {
      setIngesting(false);
    }
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const filteredDeals = deals.filter((d) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      d.ticker?.toLowerCase().includes(q) ||
      d.acquiror?.toLowerCase().includes(q) ||
      d.category?.toLowerCase().includes(q) ||
      d.investable?.toLowerCase().includes(q)
    );
  });

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av = a[sortCol as keyof Deal];
    const bv = b[sortCol as keyof Deal];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  const sortIcon = (col: string) => {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  // Summary stats
  const investableDeals = deals.filter(
    (d) => d.investable?.toLowerCase().startsWith("yes")
  );
  const avgYield =
    investableDeals.length > 0
      ? investableDeals.reduce((s, d) => s + (d.current_yield || 0), 0) /
        investableDeals.filter((d) => d.current_yield !== null).length
      : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-3 py-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Sheet Portfolio</h1>
            <p className="text-xs text-gray-500">
              Google Sheet M&A deal tracker
              {health && (
                <span className="ml-2">
                  {health.status === "healthy" ? (
                    <span className="text-green-500">Healthy</span>
                  ) : (
                    <span className="text-yellow-500">{health.status}</span>
                  )}
                  {health.last_success_date &&
                    ` \u00B7 Last ingest: ${health.last_success_date}`}
                  {health.last_success_rows > 0 &&
                    ` (${health.last_success_rows} rows)`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleIngest}
              disabled={ingesting}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded transition-colors"
            >
              {ingesting ? "Ingesting..." : "Re-ingest Now"}
            </button>
            {ingestResult && (
              <span className="text-xs text-gray-400">{ingestResult}</span>
            )}
            <Link
              href="/"
              className="px-3 py-1.5 text-sm border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-3 py-3">
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">{error}</div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-6 mb-3 text-sm">
              <span className="text-gray-400">
                <strong className="text-gray-100">{deals.length}</strong> deals
              </span>
              <span className="text-gray-400">
                <strong className="text-green-400">
                  {investableDeals.length}
                </strong>{" "}
                investable
              </span>
              {avgYield !== 0 && (
                <span className="text-gray-400">
                  Avg IRR (investable):{" "}
                  <strong
                    className={
                      avgYield >= 0 ? "text-green-400" : "text-red-400"
                    }
                  >
                    {(avgYield * 100).toFixed(1)}%
                  </strong>
                </span>
              )}
              <div className="ml-auto">
                <input
                  type="text"
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-2 py-1 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 w-48 focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* Deals table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs">
                    {[
                      { key: "ticker", label: "Ticker", align: "left" },
                      { key: "acquiror", label: "Acquiror", align: "left" },
                      { key: "category", label: "Category", align: "left" },
                      {
                        key: "deal_price",
                        label: "Deal Px",
                        align: "right",
                      },
                      {
                        key: "current_price",
                        label: "Curr Px",
                        align: "right",
                      },
                      {
                        key: "gross_yield",
                        label: "Gross Yld",
                        align: "right",
                      },
                      {
                        key: "current_yield",
                        label: "Curr Yld",
                        align: "right",
                      },
                      {
                        key: "investable",
                        label: "Investable",
                        align: "left",
                      },
                      { key: "vote_risk", label: "Vote", align: "center" },
                      {
                        key: "finance_risk",
                        label: "Finance",
                        align: "center",
                      },
                      { key: "legal_risk", label: "Legal", align: "center" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={`py-2 px-2 font-medium cursor-pointer hover:text-gray-300 whitespace-nowrap ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {sortIcon(col.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedDeals.map((deal) => (
                    <tr
                      key={deal.ticker}
                      className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors"
                    >
                      <td className="py-1.5 px-2 font-mono font-semibold text-blue-400">
                        {deal.ticker}
                      </td>
                      <td className="py-1.5 px-2 text-gray-300 max-w-[200px] truncate">
                        {deal.acquiror}
                      </td>
                      <td className="py-1.5 px-2 text-gray-400">
                        {deal.category}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {deal.deal_price_raw || "-"}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {deal.current_price_raw || "-"}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {yieldCell(deal.gross_yield_raw, deal.gross_yield)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {yieldCell(
                          deal.current_yield_raw,
                          deal.current_yield
                        )}
                      </td>
                      <td className="py-1.5 px-2 max-w-[180px] truncate">
                        {deal.investable?.toLowerCase().startsWith("yes") ? (
                          <span className="text-green-400">
                            {deal.investable}
                          </span>
                        ) : (
                          <span className="text-gray-500">
                            {deal.investable || "-"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {riskBadge(deal.vote_risk)}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {riskBadge(deal.finance_risk)}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {riskBadge(deal.legal_risk)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sortedDeals.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                {filter
                  ? "No deals match your filter"
                  : "No deals found. Try ingesting first."}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
