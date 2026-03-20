"use client";

import { useEffect, useState } from "react";

// ── types ────────────────────────────────────────────────────────────────────
interface EnrichmentData {
  total_deals: number;
  by_status: {
    not_ma: number;
    sec_failed: number;
    extraction_failed: number;
    enriched: number;
  };
  enriched_detail: {
    total: number;
    with_price: number;
    with_stock_data: number;
    with_clauses: number;
    with_options: number;
  };
  actionable_retries: number;
  by_year: Record<string, { total: number; enriched: number }>;
  retriable_samples: {
    deal_key: string;
    target: string;
    status: string;
    reason: string;
    filings: number;
  }[];
}

// ── stat card ────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-center min-w-[110px]">
      <div className="text-xl font-bold font-mono text-gray-100">{value}</div>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider mt-0.5">
        {label}
      </div>
      {note && (
        <div className="text-[10px] text-gray-600 mt-0.5">{note}</div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ── status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    sec_failed: "bg-blue-900/50 text-blue-300 border-blue-700/50",
    extraction_failed: "bg-amber-900/50 text-amber-300 border-amber-700/50",
    enriched: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
    not_ma: "bg-gray-800/50 text-gray-400 border-gray-700/50",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${colors[status] ?? colors.not_ma}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── main component ───────────────────────────────────────────────────────────
export default function EnrichmentProgress() {
  const [data, setData] = useState<EnrichmentData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/research/enrichment/progress")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // ── loading state ──────────────────────────────────────────────────────────
  if (!data && !error) {
    return (
      <div className="space-y-6">
        {/* Stats skeleton */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-center min-w-[110px] animate-pulse"
            >
              <div className="h-6 w-12 bg-gray-800 rounded mx-auto mb-1" />
              <div className="h-3 w-16 bg-gray-800 rounded mx-auto" />
            </div>
          ))}
        </div>
        {/* Section skeleton */}
        <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-4 animate-pulse">
          <div className="h-5 w-48 bg-gray-800 rounded mb-4" />
          <div className="h-8 w-full bg-gray-800 rounded mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 w-full bg-gray-800 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── error / fallback ───────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Stat label="Total Deals" value="--" />
          <Stat label="Enriched" value="--" />
          <Stat label="Retriable" value="--" />
          <Stat label="With Deal Price" value="--" />
          <Stat label="With Stock Data" value="--" />
          <Stat label="With Options Data" value="--" />
          <Stat label="With Clause Data" value="--" />
        </div>
        <div className="border border-gray-800 rounded-lg bg-gray-900/50 px-4 py-3 text-center text-sm text-gray-500">
          Failed to load enrichment progress from API.
        </div>
      </div>
    );
  }

  // ── live data ──────────────────────────────────────────────────────────────
  const { by_status, enriched_detail, by_year, retriable_samples } = data;
  const total = data.total_deals;

  // Stacked bar segments
  const segments = [
    {
      label: "Enriched",
      count: by_status.enriched,
      color: "bg-emerald-500",
      textColor: "text-emerald-400",
    },
    {
      label: "SEC Failed",
      count: by_status.sec_failed,
      color: "bg-blue-500",
      textColor: "text-blue-400",
    },
    {
      label: "Extraction Failed",
      count: by_status.extraction_failed,
      color: "bg-amber-500",
      textColor: "text-amber-400",
    },
    {
      label: "Not M&A",
      count: by_status.not_ma,
      color: "bg-gray-600",
      textColor: "text-gray-400",
    },
  ];

  // Coverage bars for enriched deals
  const coverageBars = [
    { label: "With deal price", count: enriched_detail.with_price },
    { label: "With stock data", count: enriched_detail.with_stock_data },
    { label: "With clause data", count: enriched_detail.with_clauses },
    { label: "With options data", count: enriched_detail.with_options },
  ];

  // Sort years
  const yearEntries = Object.entries(by_year).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="space-y-6">
      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Stat label="Total Deals" value={fmt(data.total_deals)} />
        <Stat
          label="Enriched"
          value={fmt(enriched_detail.total)}
          note="acquirer, price, structure"
        />
        <Stat
          label="Retriable"
          value={fmt(data.actionable_retries)}
          note="SEC / extraction failures"
        />
        <Stat label="With Deal Price" value={fmt(enriched_detail.with_price)} />
        <Stat
          label="With Stock Data"
          value={fmt(enriched_detail.with_stock_data)}
        />
        <Stat
          label="With Options Data"
          value={fmt(enriched_detail.with_options)}
          note={enriched_detail.with_options === 0 ? "pending" : undefined}
        />
        <Stat
          label="With Clause Data"
          value={fmt(enriched_detail.with_clauses)}
          note={enriched_detail.with_clauses < 10 ? "growing" : undefined}
        />
      </div>

      {/* ── Enrichment Progress section ───────────────────────────────────── */}
      <details
        open
        className="group border border-gray-800 rounded-lg bg-gray-900/50"
      >
        <summary className="cursor-pointer px-4 py-3 flex items-center gap-3 select-none hover:bg-gray-800/40 transition-colors list-none [&::-webkit-details-marker]:hidden">
          <svg
            className="w-3.5 h-3.5 text-gray-500 transition-transform group-open:rotate-90 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          <div>
            <div className="text-base font-semibold text-gray-100">
              Enrichment Progress
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Live database build status -- {fmt(enriched_detail.total)} of{" "}
              {fmt(total)} deals enriched ({pct(enriched_detail.total, total)})
            </p>
          </div>
        </summary>

        <div className="px-4 pb-4 pt-2 border-t border-gray-800/50 space-y-5">
          {/* ── (a) Status breakdown -- stacked bar ──────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">
              Deal Status Breakdown
            </h3>

            {/* Bar */}
            <div className="flex h-8 rounded overflow-hidden border border-gray-700">
              {segments.map((seg) => {
                const widthPct = (seg.count / total) * 100;
                if (widthPct < 0.5) return null;
                return (
                  <div
                    key={seg.label}
                    className={`${seg.color} flex items-center justify-center transition-all relative group/seg`}
                    style={{ width: `${widthPct}%` }}
                    title={`${seg.label}: ${fmt(seg.count)} (${pct(seg.count, total)})`}
                  >
                    {widthPct > 8 && (
                      <span className="text-[10px] font-mono text-white/90 font-semibold truncate px-1">
                        {fmt(seg.count)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {segments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-sm ${seg.color}`} />
                  <span className={`text-xs ${seg.textColor}`}>
                    {seg.label}
                  </span>
                  <span className="text-xs text-gray-600 font-mono">
                    {fmt(seg.count)} ({pct(seg.count, total)})
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── (b) Enriched data coverage -- progress bars ──────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">
              Enriched Deal Data Coverage
              <span className="text-xs text-gray-500 font-normal ml-2">
                of {fmt(enriched_detail.total)} enriched deals
              </span>
            </h3>

            <div className="space-y-2">
              {coverageBars.map((bar) => {
                const ratio =
                  enriched_detail.total > 0
                    ? (bar.count / enriched_detail.total) * 100
                    : 0;
                return (
                  <div key={bar.label}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-400">{bar.label}</span>
                      <span className="text-gray-500 font-mono">
                        {fmt(bar.count)}/{fmt(enriched_detail.total)} (
                        {pct(bar.count, enriched_detail.total)})
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500/80 transition-all"
                        style={{ width: `${Math.max(ratio, 0.5)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── (c) Enrichment by year -- compact table ──────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">
              Enrichment by Year
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 py-1 pr-3 font-medium">
                      Year
                    </th>
                    <th className="text-right text-gray-500 py-1 px-2 font-medium">
                      Total
                    </th>
                    <th className="text-right text-gray-500 py-1 px-2 font-medium">
                      Enriched
                    </th>
                    <th className="text-right text-gray-500 py-1 px-2 font-medium w-16">
                      Rate
                    </th>
                    <th className="text-left text-gray-500 py-1 pl-3 font-medium w-[40%]">
                      Coverage
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {yearEntries.map(([year, d]) => {
                    const rate =
                      d.total > 0
                        ? ((d.enriched / d.total) * 100).toFixed(0)
                        : "0";
                    const barWidth =
                      d.total > 0 ? (d.enriched / d.total) * 100 : 0;
                    return (
                      <tr
                        key={year}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30"
                      >
                        <td className="py-1 pr-3 font-mono text-gray-300">
                          {year}
                        </td>
                        <td className="py-1 px-2 text-right font-mono text-gray-400">
                          {fmt(d.total)}
                        </td>
                        <td className="py-1 px-2 text-right font-mono text-emerald-400">
                          {fmt(d.enriched)}
                        </td>
                        <td className="py-1 px-2 text-right font-mono text-gray-500">
                          {rate}%
                        </td>
                        <td className="py-1 pl-3">
                          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500/70"
                              style={{
                                width: `${Math.max(barWidth, barWidth > 0 ? 1 : 0)}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── (d) Top retriable deals ──────────────────────────────────── */}
          {retriable_samples && retriable_samples.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Top Retriable Deals
                <span className="text-xs text-gray-500 font-normal ml-2">
                  highest filing count, worth retrying
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 py-1 pr-2 font-medium">
                        Deal Key
                      </th>
                      <th className="text-left text-gray-500 py-1 px-2 font-medium">
                        Target
                      </th>
                      <th className="text-left text-gray-500 py-1 px-2 font-medium">
                        Status
                      </th>
                      <th className="text-right text-gray-500 py-1 px-2 font-medium">
                        Filings
                      </th>
                      <th className="text-left text-gray-500 py-1 pl-2 font-medium">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {retriable_samples.map((s) => (
                      <tr
                        key={s.deal_key}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30"
                      >
                        <td className="py-1 pr-2 font-mono text-cyan-400 whitespace-nowrap">
                          {s.deal_key}
                        </td>
                        <td
                          className="py-1 px-2 text-gray-300 max-w-[200px] truncate"
                          title={s.target}
                        >
                          {s.target}
                        </td>
                        <td className="py-1 px-2">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="py-1 px-2 text-right font-mono text-gray-400">
                          {s.filings}
                        </td>
                        <td
                          className="py-1 pl-2 text-gray-500 max-w-[300px] truncate"
                          title={s.reason}
                        >
                          {s.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
