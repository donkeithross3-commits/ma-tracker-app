"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type {
  OptionsScanResponse,
  OptionsScanErrorCode,
  CategoryResult,
  OpportunityResult,
  RawChainContract,
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
          <div className="text-gray-500">Entry (FT)</div>
          <div className="font-mono text-gray-100">
            {fmtDollar(opp.entry_cost_ft)}
            <span className="text-gray-600 ml-1 text-[10px]">mid {fmtDollar(opp.entry_cost)}</span>
          </div>
        </div>
        <div>
          <div className="text-gray-500">Max Profit</div>
          <div className={`font-mono font-semibold ${profitColor(opp.max_profit)}`}>
            {fmtDollar(opp.max_profit)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Ann. Return (FT)</div>
          <div className={`font-mono font-semibold ${profitColor(opp.annualized_return_ft)}`}>
            {fmtPct(opp.annualized_return_ft)}
            <span className="text-gray-600 ml-1 text-[10px] font-normal">mid {fmtPct(opp.annualized_return)}</span>
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
  const sorted = [...opportunities].sort(
    (a, b) => (b.annualized_return_ft ?? 0) - (a.annualized_return_ft ?? 0)
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-800/50">
          <tr className="border-b border-gray-700">
            <th className="text-left py-1.5 px-2 text-gray-400">Strike(s)</th>
            <th className="text-left py-1.5 px-2 text-gray-400">Expiry</th>
            <th className="text-right py-1.5 px-2 text-gray-400">DTE</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Cost (FT)</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Max Profit</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Ann. Yield (FT)</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Prob.</th>
            <th className="text-right py-1.5 px-2 text-gray-400">Liquidity</th>
            <th className="text-left py-1.5 px-2 text-gray-400">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((opp, i) => {
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
                  {fmtDollar(opp.entry_cost_ft)}
                  <span className="text-gray-600 ml-1 text-[10px]">mid {fmtDollar(opp.entry_cost)}</span>
                </td>
                <td
                  className={`py-1.5 px-2 text-right font-mono ${profitColor(opp.max_profit)}`}
                >
                  {fmtDollar(opp.max_profit)}
                </td>
                <td
                  className={`py-1.5 px-2 text-right font-mono font-semibold ${profitColor(opp.annualized_return_ft)}`}
                >
                  {fmtPct(opp.annualized_return_ft)}
                  <span className="text-gray-600 ml-1 text-[10px] font-normal">mid {fmtPct(opp.annualized_return)}</span>
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

// ── Scan status / error banner ────────────────────────────────────
function ScanStatusBanner({
  errorCode,
  errorMessage,
  marketOpen,
  onRetry,
  loading,
}: {
  errorCode: OptionsScanErrorCode | null;
  errorMessage: string;
  marketOpen?: boolean;
  onRetry: () => void;
  loading: boolean;
}) {
  // Pick style + icon based on error type
  const isWarning =
    errorCode === "timeout" ||
    errorCode === "rate_limited" ||
    errorCode === "polygon_error";
  const isInfo =
    errorCode === "ticker_not_found" ||
    errorCode === "polygon_not_configured";
  const isRetryable =
    errorCode !== "ticker_not_found" &&
    errorCode !== "polygon_not_configured";

  const bgClass = isInfo
    ? "bg-gray-900 border-gray-700"
    : isWarning
      ? "bg-yellow-900/15 border-yellow-700/40"
      : "bg-red-900/15 border-red-700/40";
  const textClass = isInfo
    ? "text-gray-400"
    : isWarning
      ? "text-yellow-400"
      : "text-red-400";
  const iconColor = isInfo
    ? "text-gray-500"
    : isWarning
      ? "text-yellow-500"
      : "text-red-500";

  // Context hint
  let hint: string | null = null;
  if (marketOpen === false && errorCode !== "ticker_not_found") {
    hint = "Markets are closed. Options data refreshes during trading hours (9:30 AM – 4:00 PM ET).";
  } else if (errorCode === "rate_limited") {
    hint = "Too many requests — wait a few seconds and retry.";
  } else if (errorCode === "timeout") {
    hint = "The scan took too long. This can happen with illiquid names or during high load.";
  }

  return (
    <div className={`${bgClass} border rounded-lg p-3 text-sm`}>
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 mt-0.5 shrink-0 ${iconColor}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          {isInfo ? (
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          ) : (
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          )}
        </svg>
        <div className="flex-1 min-w-0">
          <div className={`font-medium ${textClass}`}>{errorMessage}</div>
          {hint && (
            <div className="text-xs text-gray-500 mt-1">{hint}</div>
          )}
        </div>
        {isRetryable && (
          <button
            onClick={onRetry}
            disabled={loading}
            className={`shrink-0 px-3 py-1 text-xs rounded transition-colors ${
              loading
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : "bg-gray-700 hover:bg-gray-600 text-gray-200"
            }`}
          >
            {loading ? "Scanning..." : "Retry"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProvenancePill({ type }: { type: "ai" | "live" | "prior-close" }) {
  if (type === "ai") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>;
  }
  if (type === "live") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium">LIVE</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-500 font-medium">PRIOR CLOSE</span>;
}

// ── Raw chain – compact bid/ask card grid ──────────────────────────

/** Single contract mini-card: label, ask/bid stacked, vol+OI footer */
function MiniCard({
  contract,
  label,
  isAtm,
}: {
  contract: RawChainContract | undefined;
  label: string;
  isAtm: boolean;
}) {
  if (!contract) {
    return (
      <div className="border border-gray-800 rounded bg-gray-900/50 flex flex-col items-center justify-center min-h-[68px]">
        <span className="text-[11px] text-gray-600">{label}</span>
        <span className="text-gray-700">—</span>
      </div>
    );
  }
  return (
    <div
      className={`border rounded overflow-hidden ${
        isAtm ? "border-cyan-700/50" : "border-gray-700"
      }`}
    >
      {/* Label */}
      <div
        className={`text-center text-[11px] font-semibold py-0.5 border-b ${
          isAtm
            ? "bg-cyan-900/25 text-cyan-300 border-cyan-800/40"
            : "bg-gray-800/80 text-gray-400 border-gray-700"
        }`}
      >
        {label}
      </div>
      {/* Ask / Bid stacked */}
      <div className="bg-red-900/15 px-2 py-[3px] flex justify-between items-baseline">
        <span className="text-red-400 font-mono text-sm font-semibold">
          ${contract.ask.toFixed(2)}
        </span>
      </div>
      <div className="bg-blue-900/15 px-2 py-[3px] flex justify-between items-baseline">
        <span className="text-blue-400 font-mono text-sm font-semibold">
          ${contract.bid.toFixed(2)}
        </span>
      </div>
      {/* Vol · OI */}
      <div className="px-1.5 py-[2px] text-[10px] text-gray-500 text-center font-mono border-t border-gray-800">
        V {contract.volume ?? 0} · OI {(contract.open_interest ?? 0).toLocaleString()}
      </div>
    </div>
  );
}

function RawChainTable({
  contracts,
  dealPrice,
}: {
  contracts: RawChainContract[];
  dealPrice?: number;
}) {
  if (!contracts || contracts.length === 0) return null;

  const byExpiry: Record<string, { calls: RawChainContract[]; puts: RawChainContract[] }> = {};
  for (const c of contracts) {
    if (!byExpiry[c.expiry]) byExpiry[c.expiry] = { calls: [], puts: [] };
    if (c.right === "C") byExpiry[c.expiry].calls.push(c);
    else byExpiry[c.expiry].puts.push(c);
  }

  const allStrikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
  const expirations = Object.keys(byExpiry).sort();

  return (
    <div className="space-y-4">
      {expirations.map((expiry) => {
        const { calls, puts } = byExpiry[expiry];
        const dte = parseDte(expiry);
        const callByStrike = new Map(calls.map((c) => [c.strike, c]));
        const putByStrike = new Map(puts.map((c) => [c.strike, c]));
        const strikes = allStrikes.filter(
          (s) => callByStrike.has(s) || putByStrike.has(s)
        );

        return (
          <div
            key={expiry}
            className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden"
          >
            {/* Expiration header bar */}
            <div className="px-3 py-1.5 bg-gray-800/60 border-b border-gray-700 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-100">
                {formatExpiry(expiry)}{" "}
                <span className="text-gray-500 font-normal">({dte}d)</span>
              </span>
              <span className="text-[11px] text-gray-500">
                {calls.length}C / {puts.length}P
              </span>
            </div>

            {/* Strike grid: columns = strikes, rows = calls then puts */}
            <div className="p-2">
              {/* Header row: strike labels */}
              <div
                className="grid gap-2 mb-1"
                style={{ gridTemplateColumns: `repeat(${strikes.length}, minmax(0, 1fr))` }}
              >
                {strikes.map((strike) => {
                  const isAtm =
                    dealPrice != null &&
                    Math.abs(strike - dealPrice) <=
                      (allStrikes.length > 1
                        ? Math.abs(allStrikes[1] - allStrikes[0]) / 2
                        : 0.5);
                  const sd =
                    strike % 1 === 0
                      ? strike.toFixed(0)
                      : parseFloat(strike.toFixed(2)).toString();
                  return (
                    <div key={strike} className="text-center">
                      <span
                        className={`text-sm font-bold font-mono ${
                          isAtm ? "text-cyan-400" : "text-gray-300"
                        }`}
                      >
                        {sd}
                      </span>
                      {isAtm && (
                        <span className="text-[9px] text-cyan-600 ml-1">ATM</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Calls row */}
              <div
                className="grid gap-2 mb-1.5"
                style={{ gridTemplateColumns: `repeat(${strikes.length}, minmax(0, 1fr))` }}
              >
                {strikes.map((strike) => {
                  const isAtm =
                    dealPrice != null &&
                    Math.abs(strike - dealPrice) <=
                      (allStrikes.length > 1
                        ? Math.abs(allStrikes[1] - allStrikes[0]) / 2
                        : 0.5);
                  const sd =
                    strike % 1 === 0
                      ? strike.toFixed(0)
                      : parseFloat(strike.toFixed(2)).toString();
                  return (
                    <MiniCard
                      key={`c-${strike}`}
                      contract={callByStrike.get(strike)}
                      label={`${sd}C`}
                      isAtm={isAtm}
                    />
                  );
                })}
              </div>

              {/* Puts row */}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${strikes.length}, minmax(0, 1fr))` }}
              >
                {strikes.map((strike) => {
                  const isAtm =
                    dealPrice != null &&
                    Math.abs(strike - dealPrice) <=
                      (allStrikes.length > 1
                        ? Math.abs(allStrikes[1] - allStrikes[0]) / 2
                        : 0.5);
                  const sd =
                    strike % 1 === 0
                      ? strike.toFixed(0)
                      : parseFloat(strike.toFixed(2)).toString();
                  return (
                    <MiniCard
                      key={`p-${strike}`}
                      contract={putByStrike.get(strike)}
                      label={`${sd}P`}
                      isAtm={isAtm}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
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
  const [errorCode, setErrorCode] = useState<OptionsScanErrorCode | null>(null);

  const fetchScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch(
        `/api/sheet-portfolio/risk/options-scan?ticker=${encodeURIComponent(ticker)}`
      );
      const json: OptionsScanResponse = await res.json().catch(() => ({
        ticker,
        optionable: false,
        categories: {},
        total_opportunities: 0,
        scan_time_ms: 0,
        error_code: "unknown" as OptionsScanErrorCode,
        error_message: `HTTP ${res.status}`,
      }));

      // Backend now returns 200 with error_code for structured errors
      if (json.error_code) {
        setErrorCode(json.error_code);
        setError(json.error_message || "Unknown error");
        // Still set data for partial info (deal_price, current_price, etc.)
        setData(json);
      } else if (!res.ok) {
        setError(`HTTP ${res.status}`);
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setErrorCode("unknown");
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
    data && (data.deal_price ?? 0) > 0 && (data.current_price ?? 0) > 0
      ? ((data.deal_price! - data.current_price!) / data.current_price!) * 100
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
                <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                  Options Opportunities{" "}
                  <span className="font-mono text-cyan-400">{ticker}</span>
                  {data && !loading && (
                    <ProvenancePill type={data.market_open !== false ? "live" : "prior-close"} />
                  )}
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
        {data && (data.deal_price ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <div>
              <span className="text-gray-500">Deal </span>
              <span className="font-mono font-semibold text-gray-100">
                ${data.deal_price!.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Current </span>
              <span className="font-mono font-semibold text-gray-100">
                ${(data.current_price ?? 0).toFixed(2)}
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

        {/* Error state — context-aware messaging */}
        {error && (
          <ScanStatusBanner
            errorCode={errorCode}
            errorMessage={error}
            marketOpen={data?.market_open}
            onRetry={fetchScan}
            loading={loading}
          />
        )}

        {/* Not optionable */}
        {data && !data.optionable && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
            <div className="text-gray-400 text-sm">
              No options available for{" "}
              <span className="font-mono text-gray-200">{ticker}</span>
            </div>
          </div>
        )}

        {/* Raw chain + categories when optionable */}
        {data && data.optionable && !loading && (() => {
          const hasStrategies = data.total_opportunities > 0;
          return (
            <>
              {/* When no strategies, show chain summary banner + raw chain */}
              {!hasStrategies && (
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-sm text-gray-300 font-medium mb-1">
                    Options chain available — no spread or strategy recommendations
                  </div>
                  {data.chain_summary && (
                    <div className="text-xs text-gray-500">
                      {data.chain_summary.total_contracts} contracts across{" "}
                      {data.chain_summary.expiration_count} expirations
                      {" "}({data.chain_summary.calls}C / {data.chain_summary.puts}P)
                      {data.chain_summary.contracts_with_quotes <
                        data.chain_summary.total_contracts && (
                        <span>
                          {" "}— {data.chain_summary.contracts_with_quotes} with active quotes
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Raw option chain table — always show when we have contracts */}
              {data.raw_chain && data.raw_chain.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-300 mb-2">
                    Option Chain
                    <span className="text-gray-600 font-normal ml-2 text-xs">
                      {data.raw_chain.length} contracts
                    </span>
                  </h3>
                  <RawChainTable
                    contracts={data.raw_chain}
                    dealPrice={data.deal_price}
                  />
                </div>
              )}

              {/* Strategy category sections */}
              {hasStrategies &&
                sortedCategories.map(([catKey, result]) => (
                  <CategorySection
                    key={catKey}
                    catKey={catKey}
                    result={result as CategoryResult}
                  />
                ))}
            </>
          );
        })()}
      </main>
    </div>
  );
}
