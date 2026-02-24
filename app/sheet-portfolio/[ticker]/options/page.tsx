"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type {
  OptionsScanResponse,
  CategoryResult,
  OpportunityResult,
} from "@/types/ma-options";

// ── Category metadata ──────────────────────────────────────────────
const CATEGORY_META: Record<
  string,
  { label: string; subtitle: string; order: number }
> = {
  covered_call: {
    label: "Sell Covered Calls",
    subtitle: "Premium income from selling calls against held stock",
    order: 0,
  },
  call: {
    label: "Long Calls",
    subtitle: "Directional upside bets",
    order: 1,
  },
  spread: {
    label: "Bull Call Spreads",
    subtitle: "Capped-cost debit spreads",
    order: 2,
  },
  put_spread: {
    label: "Credit Put Spreads",
    subtitle: "Income from selling put protection",
    order: 3,
  },
};

// ── Helpers ────────────────────────────────────────────────────────
function fmtDollar(v: number): string {
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function parseDte(expiry: string): number {
  const y = parseInt(expiry.substring(0, 4));
  const m = parseInt(expiry.substring(4, 6)) - 1;
  const d = parseInt(expiry.substring(6, 8));
  const exp = new Date(y, m, d);
  return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000));
}

function formatExpiry(expiry: string): string {
  const y = parseInt(expiry.substring(0, 4));
  const m = parseInt(expiry.substring(4, 6)) - 1;
  const d = parseInt(expiry.substring(6, 8));
  return new Date(y, m, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function strikesLabel(opp: OpportunityResult): string {
  return opp.contracts.map((c) => c.strike.toFixed(2)).join(" / ");
}

function liquidityLabel(opp: OpportunityResult): string {
  const c = opp.contracts[0];
  if (!c) return "-";
  return `V:${c.volume} OI:${c.open_interest}`;
}

function profitColor(v: number): string {
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-gray-400";
}

// ── Skeleton loader ────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 animate-pulse">
      <div className="h-5 bg-gray-800 rounded w-48 mb-3" />
      <div className="h-3 bg-gray-800 rounded w-64 mb-4" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-gray-800 rounded" />
        ))}
      </div>
    </div>
  );
}

// ── Best-opportunity highlight card ────────────────────────────────
function BestCard({ opp }: { opp: OpportunityResult }) {
  const dte = opp.contracts[0] ? parseDte(opp.contracts[0].expiry) : 0;
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded p-3 mb-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
          Best
        </span>
        <span className="text-xs text-gray-400">{opp.strategy}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-gray-500">Strike(s)</div>
          <div className="font-mono text-gray-100">{strikesLabel(opp)}</div>
        </div>
        <div>
          <div className="text-gray-500">Expiry</div>
          <div className="font-mono text-gray-100">
            {opp.contracts[0] ? formatExpiry(opp.contracts[0].expiry) : "-"}{" "}
            <span className="text-gray-500">({dte}d)</span>
          </div>
        </div>
        <div>
          <div className="text-gray-500">Entry (Mid)</div>
          <div className="font-mono text-gray-100">
            {fmtDollar(opp.entry_cost)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Max Profit</div>
          <div className={`font-mono font-semibold ${profitColor(opp.max_profit)}`}>
            {fmtDollar(opp.max_profit)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Ann. Return (Mid)</div>
          <div className={`font-mono font-semibold ${profitColor(opp.annualized_return)}`}>
            {fmtPct(opp.annualized_return)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Ann. Return (FT)</div>
          <div className={`font-mono ${profitColor(opp.annualized_return_ft)}`}>
            {fmtPct(opp.annualized_return_ft)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Prob. Profit</div>
          <div className="font-mono text-gray-100">
            {fmtPct(opp.probability_of_profit)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Breakeven</div>
          <div className="font-mono text-gray-100">
            {fmtDollar(opp.breakeven)}
          </div>
        </div>
      </div>
      {opp.notes && (
        <div className="mt-2 text-[11px] text-gray-500 italic">{opp.notes}</div>
      )}
    </div>
  );
}

// ── Opportunity table ──────────────────────────────────────────────
function OpportunityTable({ opportunities }: { opportunities: OpportunityResult[] }) {
  if (opportunities.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-800/50">
          <tr className="border-b border-gray-700">
            <th className="text-left py-1.5 px-2 text-gray-400">Strike(s)</th>
            <th className="text-left py-1.5 px-2 text-gray-400">Expiry</th>
            <th className="text-right py-1.5 px-2 text-gray-400">DTE</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Premium/Cost</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Max Profit</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Ann. Yield</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Prob.</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Liquidity</th>
            <th className="text-left py-1.5 px-2 text-gray-400">Notes</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opp, i) => {
            const dte = opp.contracts[0] ? parseDte(opp.contracts[0].expiry) : 0;
            return (
              <tr
                key={i}
                className="border-b border-gray-800 hover:bg-gray-800/40"
              >
                <td className="py-1.5 px-2 font-mono text-gray-100">
                  {strikesLabel(opp)}
                </td>
                <td className="py-1.5 px-2 font-mono text-gray-300">
                  {opp.contracts[0]
                    ? formatExpiry(opp.contracts[0].expiry)
                    : "-"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-400">
                  {dte}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-100">
                  {fmtDollar(opp.entry_cost)}
                </td>
                <td
                  className={`py-1.5 px-2 text-right font-mono ${profitColor(opp.max_profit)}`}
                >
                  {fmtDollar(opp.max_profit)}
                </td>
                <td
                  className={`py-1.5 px-2 text-right font-mono font-semibold ${profitColor(opp.annualized_return)}`}
                >
                  {fmtPct(opp.annualized_return)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-300">
                  {fmtPct(opp.probability_of_profit)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-500 text-[10px]">
                  {liquidityLabel(opp)}
                </td>
                <td className="py-1.5 px-2 text-gray-500 max-w-[180px] truncate">
                  {opp.notes || "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Category section ───────────────────────────────────────────────
function CategorySection({
  catKey,
  result,
}: {
  catKey: string;
  result: CategoryResult;
}) {
  const meta = CATEGORY_META[catKey] ?? {
    label: catKey,
    subtitle: "",
    order: 99,
  };
  const [expanded, setExpanded] = useState(result.count > 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
          <div>
            <span className="text-sm font-bold text-gray-100">
              {meta.label}
            </span>
            <span className="ml-2 text-[11px] text-gray-500">
              {meta.subtitle}
            </span>
          </div>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-mono ${
            result.count > 0
              ? "bg-blue-400/10 text-blue-400"
              : "bg-gray-800 text-gray-600"
          }`}
        >
          {result.count}
        </span>
      </button>

      {/* Body */}
      {expanded && result.count > 0 && (
        <div className="border-t border-gray-800 px-3 py-2 space-y-2">
          {result.best && <BestCard opp={result.best} />}
          <OpportunityTable opportunities={result.all} />
        </div>
      )}

      {expanded && result.count === 0 && (
        <div className="border-t border-gray-800 px-3 py-4 text-center text-xs text-gray-600">
          No opportunities found in this category
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────
export default function DealOptionsPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase() ?? "";

  const [data, setData] = useState<OptionsScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sheet-portfolio/risk/options-scan?ticker=${encodeURIComponent(ticker)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: OptionsScanResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    if (ticker) fetchScan();
  }, [ticker, fetchScan]);

  // Sort categories by defined order
  const sortedCategories = data
    ? Object.entries(data.categories)
        .sort(
          ([a], [b]) =>
            (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
        )
    : [];

  const spread =
    data && data.deal_price > 0 && data.current_price > 0
      ? ((data.deal_price - data.current_price) / data.current_price) * 100
      : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href={`/sheet-portfolio/${ticker}`}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-100">
                  Options Opportunities{" "}
                  <span className="font-mono text-cyan-400">{ticker}</span>
                </h1>
              </div>
            </div>
            <button
              onClick={fetchScan}
              disabled={loading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                loading
                  ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {loading ? "Scanning..." : "Refresh Scan"}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-3 space-y-3">
        {/* Deal metrics bar */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <div>
              <span className="text-gray-500">Deal </span>
              <span className="font-mono font-semibold text-gray-100">
                ${data.deal_price.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Current </span>
              <span className="font-mono font-semibold text-gray-100">
                ${data.current_price.toFixed(2)}
              </span>
            </div>
            {spread !== null && (
              <div>
                <span className="text-gray-500">Spread </span>
                <span
                  className={`font-mono font-semibold ${
                    spread >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {spread.toFixed(2)}%
                </span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Close </span>
              <span className="font-mono text-gray-300">
                {data.expected_close}
              </span>
              <span className="text-gray-600 ml-1">
                ({data.days_to_close}d)
              </span>
            </div>
            {data.scan_time_ms > 0 && (
              <div className="ml-auto">
                <span className="text-gray-600">
                  {data.total_opportunities} opportunities in{" "}
                  {(data.scan_time_ms / 1000).toFixed(1)}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && !data && (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400">
            <div className="font-semibold mb-1">Scan Error</div>
            <div>{error}</div>
            <button
              onClick={fetchScan}
              className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
            >
              Retry
            </button>
          </div>
        )}

        {/* Not optionable */}
        {data && !data.optionable && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
            <div className="text-gray-400 text-sm">
              No options available for{" "}
              <span className="font-mono text-gray-200">{ticker}</span>
            </div>
          </div>
        )}

        {/* Category sections */}
        {data &&
          data.optionable &&
          sortedCategories.map(([catKey, result]) => (
            <CategorySection
              key={catKey}
              catKey={catKey}
              result={result as CategoryResult}
            />
          ))}
      </main>
    </div>
  );
}
