"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────
interface FilingImpact {
  impact_level: string;
  summary: string | null;
  key_detail: string | null;
  risk_factor_affected: string | null;
  grade_change_suggested: string | null;
  action_required: boolean | null;
}

interface Filing {
  accession_number: string;
  filing_type: string;
  company_name: string | null;
  filing_date: string | null;
  filing_url: string | null;
  description: string | null;
  detected_at: string | null;
  impact: FilingImpact | null;
}

interface NewsArticle {
  title: string;
  publisher: string | null;
  published_at: string | null;
  article_url: string | null;
  summary: string | null;
  relevance_score: number | null;
  risk_factor_affected: string | null;
  source?: string;
}

interface Stats {
  total_filings: number;
  material_filings: number;
  filings_with_impact: number;
  total_news: number;
  keyword_matched_news: number;
  news_by_source?: Record<string, number>;
}

interface SourcesData {
  ticker: string;
  filings: Filing[];
  news: NewsArticle[];
  stats: Stats;
}

// ── Helpers ──────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncate(s: string | null, max: number): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function cleanCompanyName(name: string | null): string {
  if (!name) return "—";
  // Strip "(TICKER)" and "(CIK ...)" suffixes from SEC display names
  return name
    .replace(/\s*\(CIK\s*\d+\)\s*/gi, "")
    .replace(/\s*\([A-Z]{1,5}(?:,\s*[A-Z]{1,10})*\)\s*/g, "")
    .replace(/\s+$/, "")
    .trim() || name;
}

function impactColor(level: string | null): {
  bg: string;
  text: string;
  label: string;
} {
  switch (level) {
    case "critical":
      return {
        bg: "bg-purple-500/20",
        text: "text-purple-300",
        label: "Critical",
      };
    case "high":
      return { bg: "bg-red-500/20", text: "text-red-300", label: "High" };
    case "moderate":
      return {
        bg: "bg-yellow-500/20",
        text: "text-yellow-300",
        label: "Moderate",
      };
    case "low":
      return { bg: "bg-blue-500/20", text: "text-blue-300", label: "Low" };
    case "none":
      return { bg: "bg-gray-700/30", text: "text-gray-400", label: "None" };
    default:
      return { bg: "bg-gray-700/20", text: "text-gray-500", label: "—" };
  }
}

function sourceStyle(source: string | undefined): {
  bg: string;
  text: string;
  label: string;
} {
  switch (source) {
    case "polygon":
      return { bg: "bg-blue-500/20", text: "text-blue-300", label: "Polygon" };
    case "finnhub":
      return { bg: "bg-green-500/20", text: "text-green-300", label: "Finnhub" };
    case "doj":
      return { bg: "bg-red-500/20", text: "text-red-300", label: "DOJ" };
    case "ftc_hsr":
      return {
        bg: "bg-orange-500/20",
        text: "text-orange-300",
        label: "FTC HSR",
      };
    case "prnewswire":
      return {
        bg: "bg-purple-500/20",
        text: "text-purple-300",
        label: "PR News",
      };
    case "globenewswire":
      return { bg: "bg-teal-500/20", text: "text-teal-300", label: "Globe" };
    case "seekingalpha":
      return { bg: "bg-yellow-500/20", text: "text-yellow-300", label: "SA" };
    case "businesswire":
      return { bg: "bg-gray-500/20", text: "text-gray-300", label: "BizWire" };
    default:
      return {
        bg: "bg-gray-600/20",
        text: "text-gray-400",
        label: source ?? "—",
      };
  }
}

function relevanceColor(score: number | null): {
  bar: string;
  width: string;
} {
  if (score == null) return { bar: "bg-gray-600", width: "0%" };
  if (score >= 0.8)
    return { bar: "bg-green-500", width: `${score * 100}%` };
  if (score >= 0.5)
    return { bar: "bg-yellow-500", width: `${score * 100}%` };
  if (score >= 0.2) return { bar: "bg-blue-500", width: `${score * 100}%` };
  return { bar: "bg-gray-500", width: `${Math.max(score * 100, 10)}%` };
}

// ── Component ────────────────────────────────────────────────────────
export default function DealSourcesPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase() ?? "";

  const [data, setData] = useState<SourcesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFilings, setExpandedFilings] = useState<Set<string>>(
    new Set()
  );
  const [expandedNews, setExpandedNews] = useState<Set<number>>(new Set());

  const fetchSources = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sheet-portfolio/sources/${encodeURIComponent(ticker)}`
      );
      if (!res.ok) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body}`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const toggleFiling = (accession: string) => {
    setExpandedFilings((prev) => {
      const next = new Set(prev);
      if (next.has(accession)) next.delete(accession);
      else next.add(accession);
      return next;
    });
  };

  const toggleNews = (idx: number) => {
    setExpandedNews((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-2">
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
              <h1 className="text-xl font-bold">
                Intelligence Sources{" "}
                <span className="font-mono text-cyan-400">{ticker}</span>
              </h1>
              <p className="text-xs text-gray-500">
                SEC filings &amp; news articles feeding AI risk assessment
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-gray-400 py-8">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading sources…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Content */}
        {data && !loading && (
          <>
            {/* Stats Banner */}
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-2 mb-4 text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <span className="text-gray-200 font-semibold">
                  {data.stats.total_filings}
                </span>{" "}
                filings
                {data.stats.material_filings > 0 && (
                  <>
                    {" "}
                    (
                    <span className="text-yellow-400">
                      {data.stats.material_filings} material
                    </span>{" "}
                    ·{" "}
                    <span className="text-blue-400">
                      {data.stats.filings_with_impact} AI-assessed
                    </span>
                    )
                  </>
                )}
              </span>
              <span className="text-gray-600">·</span>
              <span>
                <span className="text-gray-200 font-semibold">
                  {data.stats.total_news}
                </span>{" "}
                news articles
                {data.stats.keyword_matched_news > 0 && (
                  <>
                    {" "}
                    (
                    <span className="text-green-400">
                      {data.stats.keyword_matched_news} keyword-matched
                    </span>
                    )
                  </>
                )}
              </span>
              {data.stats.news_by_source &&
                Object.keys(data.stats.news_by_source).length > 1 && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="flex flex-wrap gap-1 items-center">
                      {Object.entries(data.stats.news_by_source)
                        .sort(([, a], [, b]) => b - a)
                        .map(([src, count]) => {
                          const ss = sourceStyle(src);
                          return (
                            <span
                              key={src}
                              className={`text-[10px] px-1.5 py-0.5 rounded ${ss.bg} ${ss.text}`}
                            >
                              {ss.label} {count}
                            </span>
                          );
                        })}
                    </span>
                  </>
                )}
            </div>

            {/* ── SEC Filings ─────────────────────────────────── */}
            <section className="mb-6">
              <h2 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wider">
                SEC Filings
              </h2>
              {data.filings.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">
                  No filings detected for {ticker}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                        <th className="text-left py-2 px-2 w-20">Date</th>
                        <th className="text-left py-2 px-2 w-24">Type</th>
                        <th className="text-left py-2 px-2 w-40">Company</th>
                        <th className="text-left py-2 px-2 w-24">AI Impact</th>
                        <th className="text-left py-2 px-2 w-24">
                          Risk Factor
                        </th>
                        <th className="text-left py-2 px-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {data.filings.map((f) => {
                        const ic = impactColor(f.impact?.impact_level ?? null);
                        const isExpanded = expandedFilings.has(
                          f.accession_number
                        );
                        const hasDetails =
                          f.impact?.key_detail ||
                          f.impact?.grade_change_suggested;
                        return (
                          <React.Fragment key={f.accession_number}>
                            <tr
                              className={`hover:bg-gray-800/30 ${hasDetails ? "cursor-pointer" : ""}`}
                              onClick={() =>
                                hasDetails && toggleFiling(f.accession_number)
                              }
                            >
                              <td
                                className="py-2 px-2 text-gray-400 whitespace-nowrap"
                                title={fmtDateFull(f.filing_date)}
                              >
                                {fmtDate(f.filing_date)}
                              </td>
                              <td className="py-2 px-2">
                                {f.filing_url ? (
                                  <a
                                    href={f.filing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300 hover:text-blue-300 hover:bg-gray-700"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {f.filing_type}
                                    <svg
                                      className="h-3 w-3 opacity-50"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                      />
                                    </svg>
                                  </a>
                                ) : (
                                  <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">
                                    {f.filing_type}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-gray-300" title={f.company_name ?? ""}>
                                {truncate(cleanCompanyName(f.company_name), 35)}
                              </td>
                              <td className="py-2 px-2">
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${ic.bg} ${ic.text}`}
                                >
                                  {ic.label}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-xs text-gray-500">
                                {f.impact?.risk_factor_affected ?? "—"}
                              </td>
                              <td className="py-2 px-2">
                                <div className="text-gray-300 text-xs">
                                  {truncate(f.description, 80)}
                                </div>
                                {f.impact?.summary && (
                                  <div className="text-gray-500 text-xs mt-0.5">
                                    {truncate(f.impact.summary, 100)}
                                  </div>
                                )}
                              </td>
                            </tr>
                            {isExpanded && f.impact && (
                              <tr>
                                <td colSpan={6} className="px-2 py-2">
                                  <div className="bg-gray-800/40 rounded-lg p-3 ml-4 text-xs space-y-2 border-l-2 border-gray-700">
                                    {f.impact.key_detail && (
                                      <div>
                                        <span className="text-gray-500 uppercase tracking-wider text-[10px]">
                                          Key Detail
                                        </span>
                                        <p className="text-gray-300 mt-0.5 leading-relaxed">
                                          {f.impact.key_detail}
                                        </p>
                                      </div>
                                    )}
                                    {f.impact.grade_change_suggested && (
                                      <div>
                                        <span className="text-gray-500 uppercase tracking-wider text-[10px]">
                                          Grade Change Suggested
                                        </span>
                                        <p className="text-amber-300 font-mono mt-0.5">
                                          {f.impact.grade_change_suggested}
                                        </p>
                                      </div>
                                    )}
                                    {f.impact.action_required != null && (
                                      <div>
                                        <span className="text-gray-500 uppercase tracking-wider text-[10px]">
                                          Action Required
                                        </span>
                                        <span
                                          className={`ml-2 text-xs px-1.5 py-0.5 rounded ${f.impact.action_required ? "bg-red-500/20 text-red-300" : "bg-green-500/20 text-green-300"}`}
                                        >
                                          {f.impact.action_required
                                            ? "Yes"
                                            : "No"}
                                        </span>
                                      </div>
                                    )}
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
              )}
            </section>

            {/* ── News Articles ───────────────────────────────── */}
            <section>
              <h2 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wider">
                News Articles
              </h2>
              {data.news.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">
                  No news articles captured for {ticker}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                        <th className="text-left py-2 px-2 w-20">Date</th>
                        <th className="text-left py-2 px-2 w-20">Source</th>
                        <th className="text-left py-2 px-2 w-28">Relevance</th>
                        <th className="text-left py-2 px-2">Title</th>
                        <th className="text-left py-2 px-2 w-28">Publisher</th>
                        <th className="text-left py-2 px-2 w-24">
                          Risk Factor
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {data.news.map((n, idx) => {
                        const rc = relevanceColor(n.relevance_score);
                        const isExpanded = expandedNews.has(idx);
                        return (
                          <React.Fragment key={idx}>
                            <tr
                              className={`hover:bg-gray-800/30 ${n.summary ? "cursor-pointer" : ""}`}
                              onClick={() => n.summary && toggleNews(idx)}
                            >
                              <td
                                className="py-2 px-2 text-gray-400 whitespace-nowrap"
                                title={fmtDateFull(n.published_at)}
                              >
                                {fmtDate(n.published_at)}
                              </td>
                              <td className="py-2 px-2">
                                {(() => {
                                  const ss = sourceStyle(n.source);
                                  return (
                                    <span
                                      className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${ss.bg} ${ss.text}`}
                                    >
                                      {ss.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${rc.bar}`}
                                      style={{ width: rc.width }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400 font-mono w-6">
                                    {n.relevance_score != null
                                      ? n.relevance_score.toFixed(1)
                                      : "—"}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-2">
                                {n.article_url ? (
                                  <a
                                    href={n.article_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-200 hover:text-blue-300 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {n.title}
                                  </a>
                                ) : (
                                  <span className="text-gray-200">
                                    {n.title}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-gray-500 text-xs">
                                {n.publisher ?? "—"}
                              </td>
                              <td className="py-2 px-2">
                                {n.risk_factor_affected ? (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/40 text-gray-400">
                                    {n.risk_factor_affected}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-600">
                                    general
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && n.summary && (
                              <tr>
                                <td colSpan={6} className="px-2 py-2">
                                  <div className="bg-gray-800/40 rounded-lg p-3 ml-4 text-xs text-gray-300 border-l-2 border-gray-700 leading-relaxed">
                                    {n.summary}
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
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
