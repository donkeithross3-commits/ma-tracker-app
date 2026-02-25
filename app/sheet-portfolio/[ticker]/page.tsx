"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface DashboardData {
  ticker: string;
  acquiror: string;
  category: string;
  deal_price: number | null;
  current_price: number | null;
  gross_yield: number | null;
  current_yield: number | null;
  price_change: number | null;
  deal_price_raw: string | null;
  current_price_raw: string | null;
  gross_yield_raw: string | null;
  current_yield_raw: string | null;
  price_change_raw: string | null;
  investable: string | null;
  vote_risk: string | null;
  finance_risk: string | null;
  legal_risk: string | null;
  announced_date: string | null;
  close_date: string | null;
  end_date: string | null;
  countdown_days: number | null;
  go_shop_raw: string | null;
  cvr_flag: string | null;
}

interface DetailData {
  target: string | null;
  acquiror: string | null;
  category: string | null;
  cash_per_share: number | null;
  cash_pct: number | null;
  stock_per_share: number | null;
  stock_pct: number | null;
  stock_ratio: string | null;
  stress_test_discount: string | null;
  dividends_other: number | null;
  dividends_other_pct: number | null;
  total_price_per_share: number | null;
  target_current_price: number | null;
  acquiror_current_price: number | null;
  current_spread: number | null;
  spread_change: number | null;
  deal_spread: number | null;
  deal_close_time_months: number | null;
  expected_irr: number | null;
  ideal_price: number | null;
  hypothetical_irr: number | null;
  hypothetical_irr_spread: number | null;
  announce_date: string | null;
  expected_close_date: string | null;
  expected_close_date_note: string | null;
  outside_date: string | null;
  shareholder_vote: string | null;
  premium_attractive: string | null;
  board_approval: string | null;
  voting_agreements: string | null;
  aggressive_shareholders: string | null;
  regulatory_approvals: string | null;
  revenue_mostly_us: string | null;
  reputable_acquiror: string | null;
  target_business_description: string | null;
  mac_clauses: string | null;
  termination_fee: string | null;
  termination_fee_pct: number | null;
  closing_conditions: string | null;
  sellside_pushback: string | null;
  target_marketcap: string | null;
  target_enterprise_value: string | null;
  go_shop_or_overbid: string | null;
  financing_details: string | null;
  shareholder_risk: string | null;
  financing_risk: string | null;
  legal_risk: string | null;
  investable_deal: string | null;
  pays_dividend: string | null;
  prefs_or_baby_bonds: string | null;
  has_cvrs: string | null;
  probability_of_success: number | null;
  probability_of_higher_offer: number | null;
  offer_bump_premium: number | null;
  break_price: number | null;
  implied_downside: number | null;
  return_risk_ratio: number | null;
  optionable: string | null;
  long_naked_calls: string | null;
  long_vertical_call_spread: string | null;
  long_covered_call: string | null;
  short_put_vertical_spread: string | null;
  cvrs: Array<Record<string, unknown>> | null;
  dividends: Array<Record<string, unknown>> | null;
  price_history: Array<{ date: string; close: number }> | null;
  fetched_at: string | null;
}

interface DealResponse {
  ticker: string;
  dashboard: DashboardData | null;
  detail: DetailData | null;
  bamsec_url?: string | null;
}

function fmtPct(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${(val * 100).toFixed(2)}%`;
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null) return "-";
  return `$${val.toFixed(2)}`;
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "-";
  const parts = val.split("-");
  if (parts.length !== 3) return val;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0].slice(2)}`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtExpiry(expiry: string): string {
  // Parse YYYYMMDD -> "Jun" (month abbreviation)
  if (expiry.length === 8) {
    const month = parseInt(expiry.slice(4, 6), 10);
    if (month >= 1 && month <= 12) return MONTH_ABBR[month - 1];
  }
  // Fallback: try ISO date YYYY-MM-DD
  if (expiry.includes("-")) {
    const parts = expiry.split("-");
    const month = parseInt(parts[1], 10);
    if (month >= 1 && month <= 12) return MONTH_ABBR[month - 1];
  }
  return expiry;
}

function riskBadge(risk: string | null | undefined) {
  if (!risk) return <span className="text-gray-600">-</span>;
  const lower = risk.toLowerCase();
  let color = "text-gray-400";
  if (lower.startsWith("low")) color = "text-blue-400";
  else if (lower.startsWith("med")) color = "text-yellow-400";
  else if (lower.startsWith("high")) color = "text-red-400";
  return <span className={`font-medium ${color}`}>{risk}</span>;
}

function flagBadge(val: string | null | undefined) {
  if (!val) return <span className="text-gray-600">-</span>;
  const lower = val.toLowerCase();
  if (lower === "yes") return <span className="text-blue-400">{val}</span>;
  if (lower === "no") return <span className="text-blue-400">{val}</span>;
  return <span className="text-blue-400">{val}</span>;
}

interface OpportunityResult {
  strategy: string;
  contracts: Array<{ symbol: string; strike: number; expiry: string; right: string; bid: number; ask: number }>;
  entry_cost: number;
  max_profit: number;
  annualized_return: number;
  annualized_return_ft: number;
  notes: string;
}

interface OptionsCategoryData {
  best: OpportunityResult | null;
  count: number;
  all: OpportunityResult[];
}

interface OptionsScanResponse {
  ticker: string;
  deal_price?: number;
  current_price?: number;
  days_to_close?: number;
  expected_close?: string;
  optionable: boolean;
  market_open?: boolean;
  error_code?: string;
  error_message?: string;
  categories: {
    covered_call?: OptionsCategoryData;
    call?: OptionsCategoryData;
    spread?: OptionsCategoryData;
    put_spread?: OptionsCategoryData;
  };
  total_opportunities: number;
}

interface RiskAssessment {
  assessment_date: string;
  overall_risk_score: number | null;
  overall_risk_level: string | null;
  overall_risk_summary: string | null;
  probability_of_success: number | null;
  needs_attention: boolean;
  attention_reason: string | null;
  // Grade-based factors (new)
  vote_grade: string | null;
  vote_confidence: number | null;
  vote_detail: string | null;
  financing_grade: string | null;
  financing_confidence: number | null;
  financing_detail: string | null;
  legal_grade: string | null;
  legal_confidence: number | null;
  legal_detail: string | null;
  regulatory_grade: string | null;
  regulatory_confidence: number | null;
  regulatory_detail: string | null;
  mac_grade: string | null;
  mac_confidence: number | null;
  mac_detail: string | null;
  // Supplemental scores
  market_score: number | null;
  market_detail: string | null;
  timing_score: number | null;
  timing_detail: string | null;
  competing_bid_score: number | null;
  competing_bid_detail: string | null;
  // New fields
  investable_assessment: string | null;
  deal_summary: string | null;
  key_risks: string[] | null;
  discrepancies: Array<{ field: string; sheet_value: string; ai_value: string; explanation: string }> | null;
  overnight_events: Array<{ type: string; ticker: string; headline: string; severity: string }> | null;
  discrepancy_count: number;
  event_count: number;
  // Legacy scores for backward compat
  regulatory_score: number | null;
  vote_score: number | null;
  financing_score: number | null;
  legal_score: number | null;
  mac_score: number | null;
  // Full AI response with production disagreements
  ai_response?: {
    production_disagreements?: Array<{
      factor: string;
      sheet_says: string;
      ai_says: string;
      severity: string;
      is_new: boolean;
      evidence: Array<{ source: string; date: string; detail: string }>;
      reasoning: string;
    }>;
  } | null;
}

const GRADE_FACTORS = [
  { key: "vote", label: "Vote Risk" },
  { key: "financing", label: "Financing Risk" },
  { key: "legal", label: "Legal Risk" },
  { key: "regulatory", label: "Regulatory Risk" },
  { key: "mac", label: "MAC Risk" },
] as const;

const SUPPLEMENTAL_FACTORS = [
  { key: "market", label: "Market" },
  { key: "timing", label: "Timing" },
  { key: "competing_bid", label: "Competing Bid" },
] as const;

function gradeStyle(grade: string | null): { text: string; bg: string; border: string } {
  if (!grade) return { text: "text-gray-500", bg: "bg-gray-500/10", border: "border-gray-500/30" };
  const g = grade.toUpperCase();
  if (g === "LOW") return { text: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" };
  if (g === "MEDIUM" || g === "MED") return { text: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" };
  if (g === "HIGH") return { text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" };
  return { text: "text-gray-400", bg: "bg-gray-400/10", border: "border-gray-400/30" };
}

function GradeBadge({ grade, label }: { grade: string | null; label: string }) {
  const style = gradeStyle(grade);
  return (
    <div className={`px-3 py-2 rounded border text-center ${style.bg} ${style.border}`}>
      <div className={`text-lg font-bold ${style.text}`}>{grade || "-"}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function GradeFactorCard({ label, grade, confidence, detail }: {
  label: string;
  grade: string | null;
  confidence: number | null;
  detail: string | null;
}) {
  if (!grade) return null;
  const style = gradeStyle(grade);

  return (
    <div className="bg-gray-800/50 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>{grade}</span>
      </div>
      {confidence != null && (
        <div className="w-full bg-gray-700 rounded-full h-1 mb-1.5" title={`Confidence: ${(confidence * 100).toFixed(0)}%`}>
          <div className="h-1 rounded-full bg-blue-400" style={{ width: `${confidence * 100}%` }} />
        </div>
      )}
      {detail && <p className="text-xs text-gray-500 line-clamp-2">{detail}</p>}
    </div>
  );
}

function SupplementalScoreCard({ label, score, detail, hasDisagreement }: {
  label: string;
  score: number | null;
  detail: string | null;
  hasDisagreement?: boolean;
}) {
  if (score === null) return null;

  let barColor = "bg-green-400";
  if (score >= 8) barColor = "bg-red-400";
  else if (score >= 6) barColor = "bg-orange-400";
  else if (score >= 4) barColor = "bg-yellow-400";
  else if (score >= 2) barColor = "bg-lime-400";

  return (
    <div className={`bg-gray-800/50 rounded p-2 ${hasDisagreement ? "border border-amber-500/40" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-400">
          {label}
          {hasDisagreement && <span className="ml-1 text-amber-400" title="AI disagrees with sheet timing">&#x23F0;</span>}
        </span>
        <span className="text-xs font-mono font-bold text-gray-200">{score.toFixed(1)}/10</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1 mb-1.5">
        <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      {detail && <p className="text-xs text-gray-500 line-clamp-2">{detail}</p>}
    </div>
  );
}

function ProductionDisagreements({ disagreements }: {
  disagreements: Array<{
    factor: string;
    sheet_says: string;
    ai_says: string;
    severity: string;
    is_new: boolean;
    evidence: Array<{ source: string; date: string; detail: string }>;
    reasoning: string;
  }>;
}) {
  if (!disagreements || disagreements.length === 0) return null;

  const severityStyle = (s: string) => {
    if (s === "material") return "bg-red-400/15 text-red-400";
    if (s === "notable") return "bg-amber-400/15 text-amber-400";
    return "bg-gray-700 text-gray-400";
  };

  return (
    <div className="mb-3 p-2 bg-amber-400/5 border border-amber-600/20 rounded">
      <h4 className="text-xs font-medium text-amber-400 mb-1.5">
        AI Disagreements ({disagreements.length})
      </h4>
      <div className="space-y-2">
        {disagreements.map((d, i) => (
          <div key={i} className="text-xs bg-gray-800/60 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              {d.factor === "timing" && <span title="Timeline Mismatch">&#x23F0;</span>}
              <span className="font-medium text-gray-200 capitalize">{d.factor}</span>
              <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${severityStyle(d.severity)}`}>
                {d.severity}
              </span>
              {d.is_new && (
                <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-400/15 text-blue-400">NEW</span>
              )}
            </div>
            <div className="text-gray-400 mb-1">
              <span className="text-gray-500">Sheet:</span> {d.sheet_says}
              <span className="mx-1.5 text-gray-600">&rarr;</span>
              <span className="text-amber-300">AI:</span> {d.ai_says}
            </div>
            {d.reasoning && <p className="text-gray-500 mb-1">{d.reasoning}</p>}
            {Array.isArray(d.evidence) && d.evidence.length > 0 && (
              <div className="space-y-0.5 mt-1 pl-2 border-l border-gray-700">
                {d.evidence.map((e, j) => (
                  <div key={j} className="text-[11px] text-gray-500">
                    <span className="text-gray-400">{e.source}</span>
                    {e.date && <span className="text-gray-600 ml-1">({e.date})</span>}
                    {e.detail && <span className="ml-1">- {e.detail}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex justify-between items-start py-1 border-b border-gray-800/40">
      <span className="text-gray-400 text-sm shrink-0 mr-3">{label}</span>
      <span className={`text-sm font-mono text-right ${color || "text-gray-100"}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold text-gray-300 mb-1 mt-3 first:mt-0">{children}</h3>
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

function useMarketFreshness(lastRefresh: Date | null): "fresh" | "stale" | "disconnected" {
  const [freshness, setFreshness] = useState<"fresh" | "stale" | "disconnected">("disconnected");
  useEffect(() => {
    function check() {
      if (!lastRefresh) { setFreshness("disconnected"); return; }
      const age = (Date.now() - lastRefresh.getTime()) / 1000;
      setFreshness(age > 90 ? "stale" : "fresh");
    }
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [lastRefresh]);
  return freshness;
}

function freshnessDotColor(freshness: "fresh" | "stale" | "disconnected"): string {
  if (freshness === "fresh") return "bg-green-500";
  if (freshness === "stale") return "bg-amber-500";
  return "bg-gray-600";
}

function freshnessPriceColor(freshness: "fresh" | "stale" | "disconnected"): string {
  return freshness === "stale" ? "text-cyan-600" : "text-cyan-400";
}

export default function DealDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase();
  const [data, setData] = useState<DealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [livePrice, setLivePrice] = useState<{ price: number; change: number; change_pct: number } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [optionsScan, setOptionsScan] = useState<OptionsScanResponse | null>(null);
  const [optionsScanLoading, setOptionsScanLoading] = useState(false);
  const [optionsScanError, setOptionsScanError] = useState(false);

  const freshness = useMarketFreshness(lastRefresh);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/sheet-portfolio/deal/${encodeURIComponent(ticker)}`),
      fetch(`/api/sheet-portfolio/risk/${encodeURIComponent(ticker)}`),
    ])
      .then(async ([dealResp, riskResp]) => {
        if (!dealResp.ok) {
          const body = await dealResp.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(body.detail || body.error || `HTTP ${dealResp.status}`);
        }
        setData(await dealResp.json());
        if (riskResp.ok) {
          setRiskAssessment(await riskResp.json());
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticker]);

  // Fetch options scan data (non-blocking)
  useEffect(() => {
    if (!ticker) return;
    setOptionsScanLoading(true);
    setOptionsScanError(false);
    fetch(`/api/sheet-portfolio/risk/options-scan?ticker=${encodeURIComponent(ticker)}`)
      .then(async (resp) => {
        const json = await resp.json().catch(() => null);
        if (json && !json.error_code) {
          setOptionsScan(json);
        } else if (json?.error_code) {
          // Structured error — still set scan data for partial info
          setOptionsScan(json);
          setOptionsScanError(true);
        } else {
          setOptionsScanError(true);
        }
      })
      .catch(() => { setOptionsScanError(true); })
      .finally(() => setOptionsScanLoading(false));
  }, [ticker]);

  const fetchLivePrice = useCallback(async () => {
    if (!ticker) return;
    try {
      setRefreshing(true);
      const resp = await fetch("/api/sheet-portfolio/live-prices");
      if (resp.ok) {
        const data = await resp.json();
        const prices = data.prices || {};
        if (prices[ticker]) {
          setLivePrice(prices[ticker]);
        }
        setLastRefresh(new Date());
      }
    } catch {
      // silently fail -- static sheet prices still show
    } finally {
      setRefreshing(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchLivePrice();
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchLivePrice();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchLivePrice]);

  async function handleAssessNow() {
    setAssessing(true);
    try {
      const resp = await fetch(`/api/sheet-portfolio/risk?ticker=${encodeURIComponent(ticker)}`, { method: "POST" });
      if (resp.ok) {
        const riskResp = await fetch(`/api/sheet-portfolio/risk/${encodeURIComponent(ticker)}`);
        if (riskResp.ok) setRiskAssessment(await riskResp.json());
      }
    } catch { /* silently fail */ }
    finally { setAssessing(false); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading {ticker}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <Link href="/sheet-portfolio" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">
            &larr; Back to Dashboard
          </Link>
          <div className="text-center py-20 text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { dashboard: dash, detail: d } = data;
  const acquiror = d?.acquiror ?? dash?.acquiror ?? "";
  const category = d?.category ?? dash?.category ?? "";
  const sheetTargetPrice = d?.target_current_price ?? dash?.current_price;
  const targetPrice = livePrice?.price ?? sheetTargetPrice;
  const targetPriceIsLive = livePrice?.price != null;
  const dealPrice = d?.total_price_per_share ?? dash?.deal_price;
  // Use paired sources: detail current_spread+spread_change, or dashboard gross_yield+price_change
  const spread = d?.current_spread ?? dash?.gross_yield ?? d?.deal_spread;
  const spreadChange = d?.current_spread != null ? d?.spread_change : dash?.price_change;

  const hasCvrs = d?.has_cvrs && d.has_cvrs.toLowerCase() !== "no";
  const cvrs = d?.cvrs && Array.isArray(d.cvrs) ? d.cvrs : [];
  const paysDividend = d?.pays_dividend && d.pays_dividend.toLowerCase() !== "no";
  const dividends = d?.dividends && Array.isArray(d.dividends) ? d.dividends : [];
  const history = d?.price_history && Array.isArray(d.price_history) ? d.price_history : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/sheet-portfolio" className="text-gray-500 hover:text-gray-300 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold font-mono">{ticker}</h1>
                  <span className="text-gray-400 text-sm">/ {d?.target ?? ticker}</span>
                  {category && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-400/10 text-blue-400">{category}</span>
                  )}
                </div>
                <p className="text-sm text-gray-500">Acquiror: {acquiror}</p>
              </div>
            </div>
            <div className="flex items-center gap-5 text-right">
              <div className="flex items-center gap-1.5 border border-gray-700 rounded px-2.5 py-1">
                <span className={`inline-block w-2 h-2 rounded-full ${freshnessDotColor(freshness)}`} title={lastRefresh ? (freshness === "stale" ? "Market data stale" : "Polygon connected") : "No market data yet"} />
                <span className="text-xs text-gray-400">
                  {lastRefresh
                    ? `Mkt data ${lastRefresh.toLocaleTimeString()}${freshness === "stale" ? " (stale)" : ""}`
                    : "Mkt data loading\u2026"}
                </span>
                <button
                  onClick={fetchLivePrice}
                  disabled={refreshing}
                  className="ml-1 p-0.5 text-cyan-400 hover:text-cyan-300 disabled:opacity-40 transition-colors"
                  title="Refresh market data now"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
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
                </button>
              </div>
              <div>
                <div className="text-xs text-gray-500">Target Px</div>
                <div className={`font-mono font-semibold ${targetPriceIsLive ? freshnessPriceColor(freshness) : ""}`} title={targetPriceIsLive ? `Live: $${targetPrice?.toFixed(2)} (${freshness})` : "From sheet"}>{fmtPrice(targetPrice)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Deal Px</div>
                <div className="font-mono font-semibold">{fmtPrice(dealPrice)}</div>
              </div>
              {d?.acquiror_current_price != null && d.acquiror_current_price > 0 && (
                <div>
                  <div className="text-xs text-gray-500">Acquiror Px</div>
                  <div className="font-mono font-semibold">{fmtPrice(d.acquiror_current_price)}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500">Spread</div>
                <div className={`font-mono font-semibold ${spread != null ? (spread >= 0 ? "text-green-400" : "text-red-400") : ""}`}>
                  {fmtPct(spread)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Chg</div>
                <div className={`font-mono font-semibold ${spreadChange != null ? (spreadChange >= 0 ? "text-green-400" : "text-red-400") : ""}`}>
                  {fmtPct(spreadChange)}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <a
                  href={`https://finance.yahoo.com/quote/${ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Yahoo Quote
                </a>
                {data?.bamsec_url && (
                  <a
                    href={data.bamsec_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    BamSEC
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-3">
        {!d && (
          <div className="bg-yellow-400/10 border border-yellow-600/30 rounded-lg px-4 py-2 mb-3 text-sm text-yellow-300">
            Detail data not yet ingested for this deal. Showing dashboard data only.
          </div>
        )}

        {/* Main content: 3-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Column 1: Deal Terms + Pricing */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <SectionTitle>Deal Terms</SectionTitle>
            <Row label="Category" value={category || "-"} />
            <Row label="Cash per share" value={
              d?.cash_per_share != null ? (
                <span>{fmtPrice(d.cash_per_share)} <span className="text-gray-500 text-xs">{fmtPct(d.cash_pct)}</span></span>
              ) : "-"
            } />
            <Row label="Stock per share" value={
              d?.stock_per_share != null ? (
                <span>{fmtPrice(d.stock_per_share)} <span className="text-gray-500 text-xs">{fmtPct(d.stock_pct)}</span></span>
              ) : "-"
            } />
            <Row label="Stock ratio" value={d?.stock_ratio ?? "-"} />
            <Row label="Stress test discount" value={d?.stress_test_discount ?? "-"} />
            <Row label="Dividends / Other" value={
              d?.dividends_other != null ? (
                <span>{fmtPrice(d.dividends_other)} <span className="text-gray-500 text-xs">{fmtPct(d.dividends_other_pct)}</span></span>
              ) : "-"
            } />
            <Row label="Total price/share" value={fmtPrice(d?.total_price_per_share)} color="text-white font-semibold" />

            <SectionTitle>Pricing &amp; Returns</SectionTitle>
            <Row label="Target current price" value={fmtPrice(targetPrice)} color={targetPriceIsLive ? freshnessPriceColor(freshness) : undefined} />
            <Row label="Deal spread" value={fmtPct(d?.deal_spread)} />
            <Row label="Close time (months)" value={d?.deal_close_time_months != null ? d.deal_close_time_months.toFixed(2) : "-"} />
            <Row label="Expected IRR" value={fmtPct(d?.expected_irr)} color={d?.expected_irr != null ? (d.expected_irr >= 0 ? "text-green-400" : "text-red-400") : undefined} />

            <SectionTitle>Hypothetical Terms</SectionTitle>
            <Row label="Ideal price" value={fmtPrice(d?.ideal_price)} color="text-green-400" />
            <Row label="Expected IRR" value={
              d?.hypothetical_irr != null ? (
                <span>{fmtPct(d.hypothetical_irr)} <span className="text-gray-500 text-xs">{fmtPct(d.hypothetical_irr_spread)}</span></span>
              ) : "-"
            } />
          </div>

          {/* Column 2: Dates + Deal Assessment */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <SectionTitle>Key Dates</SectionTitle>
            <Row label="Announce Date" value={fmtDate(d?.announce_date ?? dash?.announced_date)} color="text-green-400" />
            <Row label="Expected close" value={
              <span>
                <span className="text-green-400">{fmtDate(d?.expected_close_date ?? dash?.close_date)}</span>
                {d?.expected_close_date_note && <span className="text-gray-400 text-xs ml-1">{d.expected_close_date_note}</span>}
              </span>
            } />
            <Row label="Outside Date" value={fmtDate(d?.outside_date ?? dash?.end_date)} color="text-green-400" />
            <Row label="Days to close" value={dash?.countdown_days != null ? String(dash.countdown_days) : "-"} />

            <SectionTitle>Deal Assessment</SectionTitle>
            <Row label="Shareholder vote" value={d?.shareholder_vote ?? "-"} color="text-blue-400" />
            <Row label="Premium attractive" value={d?.premium_attractive ?? "-"} color="text-green-400" />
            <Row label="Board approval" value={d?.board_approval ?? "-"} />
            <Row label="Voting agreements" value={d?.voting_agreements ?? "-"} color="text-green-400" />
            <Row label="Aggressive shareholders" value={d?.aggressive_shareholders ?? "-"} />
            <Row label="Regulatory approvals" value={d?.regulatory_approvals ?? "-"} />
            <Row label="Revenue mostly US?" value={d?.revenue_mostly_us ?? "-"} />
            <Row label="Reputable Acquiror?" value={d?.reputable_acquiror ?? "-"} />
            <Row label="Target Biz Description" value={d?.target_business_description ?? "-"} />
            <Row label="MAC Clauses" value={d?.mac_clauses ?? "-"} />
            <Row label="Termination Fee" value={
              d?.termination_fee ? (
                <span className="text-blue-400">
                  {d.termination_fee}
                  {d.termination_fee_pct != null && <span className="text-green-400 ml-1">{fmtPct(d.termination_fee_pct)}</span>}
                </span>
              ) : "-"
            } />
            <Row label="Closing conditions" value={d?.closing_conditions ?? "-"} />
            <Row label="Sellside pushback?" value={d?.sellside_pushback ?? "-"} />
            <Row label="Target Marketcap" value={d?.target_marketcap ?? "-"} />
            <Row label="Target EV" value={d?.target_enterprise_value ?? "-"} color="text-blue-400" />
            <Row label="Go Shop / Overbid?" value={d?.go_shop_or_overbid ?? dash?.go_shop_raw ?? "-"} />
            <Row label="Financing details" value={d?.financing_details ?? "-"} color="text-blue-400" />
          </div>

          {/* Column 3: Risk + Probability + Options */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <SectionTitle>Risk Assessment</SectionTitle>
            <Row label="Shareholder Risk" value={riskBadge(d?.shareholder_risk ?? dash?.vote_risk)} />
            <Row label="Financing Risk" value={riskBadge(d?.financing_risk ?? dash?.finance_risk)} />
            <Row label="Legal Risk" value={riskBadge(d?.legal_risk ?? dash?.legal_risk)} />
            <Row label="Investable Deal?" value={flagBadge(d?.investable_deal ?? dash?.investable)} />
            <Row label="Pays A Dividend?" value={flagBadge(d?.pays_dividend)} />
            <Row label="Prefs or Baby Bonds?" value={flagBadge(d?.prefs_or_baby_bonds)} />
            <Row label="CVRs?" value={flagBadge(d?.has_cvrs)} />

            <SectionTitle>Probability Analysis</SectionTitle>
            <Row label="Prob. of Success" value={fmtPct(d?.probability_of_success)} color="text-green-400" />
            <Row label="Prob. Higher Offer" value={fmtPct(d?.probability_of_higher_offer)} color="text-green-400" />
            <Row label="Offer Bump Premium" value={fmtPct(d?.offer_bump_premium)} color="text-green-400" />
            <Row label="Break Price" value={d?.break_price != null ? fmtPrice(d.break_price) : "-"} />
            <Row label="Implied Downside" value={fmtPct(d?.implied_downside)} color={d?.implied_downside != null ? "text-red-400" : undefined} />
            <Row label="Return/Risk Ratio" value={d?.return_risk_ratio != null ? d.return_risk_ratio.toFixed(2) : "-"} />

            {/* Options teaser - dynamic from options-scan API */}
            <div className="mt-3 first:mt-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-gray-300 flex items-center gap-1.5">
                  Options
                  {optionsScan && !optionsScanLoading && (
                    <ProvenancePill type={optionsScan.market_open !== false ? "live" : "prior-close"} />
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {optionsScanLoading && (
                    <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  <Link
                    href={`/sheet-portfolio/${ticker}/options`}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    View All →
                  </Link>
                </div>
              </div>

              {(() => {
                // Loading state
                if (optionsScanLoading && !optionsScan) {
                  return (
                    <>
                      <Row label="Optionable" value={d?.optionable ?? "-"} />
                      <Row label="Sell Covered Calls" value="-" />
                      <Row label="Bull Call Spreads" value="-" />
                      <Row label="Credit Put Spreads" value="-" />
                      <Row label="Long Calls" value="-" />
                    </>
                  );
                }

                // Error or no data: show graceful status
                if (optionsScanError || !optionsScan) {
                  const errMsg = optionsScan?.error_message;
                  const isMarketClosed = optionsScan?.market_open === false;
                  return (
                    <>
                      <Row label="Optionable" value={d?.optionable ?? "-"} />
                      <div className="text-xs text-gray-500 py-1.5">
                        {isMarketClosed
                          ? "Markets closed — options data refreshes during trading hours."
                          : errMsg
                            ? errMsg
                            : "Options scan unavailable. View full page for details."}
                      </div>
                    </>
                  );
                }

                // Not optionable
                if (!optionsScan.optionable) {
                  return (
                    <>
                      <Row label="Optionable" value={<span className="text-red-400">No</span>} />
                      <Row label="Sell Covered Calls" value="-" />
                      <Row label="Bull Call Spreads" value="-" />
                      <Row label="Credit Put Spreads" value="-" />
                      <Row label="Long Calls" value="-" />
                    </>
                  );
                }

                const { categories } = optionsScan;

                const renderBest = (cat: OptionsCategoryData | undefined, type: "covered_call" | "call" | "spread" | "put_spread") => {
                  if (!cat?.best) return <span className="text-gray-600">-</span>;
                  const b = cat.best;
                  const c0 = b.contracts[0];
                  const c1 = b.contracts[1];
                  if (!c0) return <span className="text-gray-600">-</span>;
                  const expLabel = fmtExpiry(c0.expiry);
                  const ann = ((b.annualized_return_ft ?? b.annualized_return) * 100).toFixed(1);

                  switch (type) {
                    case "covered_call":
                      return (
                        <span>
                          <span className="font-mono">{expLabel} {c0.strike}C @ ${c0.bid.toFixed(2)}</span>
                          <span className="text-green-400 ml-1.5">{ann}% return</span>
                        </span>
                      );
                    case "call":
                      return (
                        <span>
                          <span className="font-mono">{expLabel} {c0.strike}C @ ${c0.ask.toFixed(2)}</span>
                          <span className="text-green-400 ml-1.5">{ann}% return</span>
                        </span>
                      );
                    case "spread":
                      return (
                        <span>
                          <span className="font-mono">{expLabel} {c0.strike}/{c1?.strike ?? "?"} @ ${Math.abs(b.entry_cost).toFixed(2)}</span>
                          <span className="text-green-400 ml-1.5">{ann}% return</span>
                        </span>
                      );
                    case "put_spread":
                      return (
                        <span>
                          <span className="font-mono">{expLabel} {c0.strike}/{c1?.strike ?? "?"} cr ${Math.abs(b.entry_cost).toFixed(2)}</span>
                          <span className="text-green-400 ml-1.5">{ann}% return</span>
                        </span>
                      );
                  }
                };

                return (
                  <>
                    <Row label="Optionable" value={<span className="text-green-400">Yes</span>} />
                    <div className="mt-1.5 space-y-2">
                      <div>
                        <div className="text-gray-300 text-xs uppercase tracking-wider mb-0.5">Sell Covered Calls</div>
                        <div className="text-sm">{renderBest(categories.covered_call, "covered_call")}</div>
                      </div>
                      <div>
                        <div className="text-gray-300 text-xs uppercase tracking-wider mb-0.5">Bull Call Spreads</div>
                        <div className="text-sm">{renderBest(categories.spread, "spread")}</div>
                      </div>
                      <div>
                        <div className="text-gray-300 text-xs uppercase tracking-wider mb-0.5">Credit Put Spreads</div>
                        <div className="text-sm">{renderBest(categories.put_spread, "put_spread")}</div>
                      </div>
                      <div>
                        <div className="text-gray-300 text-xs uppercase tracking-wider mb-0.5">Long Calls</div>
                        <div className="text-sm">{renderBest(categories.call, "call")}</div>
                      </div>
                    </div>
                    {optionsScan.total_opportunities > 0 && (
                      <div className="mt-2 text-xs text-gray-500">
                        {optionsScan.total_opportunities} total opportunities found
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Risk Assessment */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mt-3 border-l-2 border-l-purple-500/40">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-300 flex items-center gap-1.5">AI Risk Assessment <ProvenancePill type="ai" /></h3>
            <div className="flex items-center gap-2">
              {riskAssessment?.assessment_date && (
                <span className="text-xs text-gray-500">
                  Assessed: {riskAssessment.assessment_date}
                </span>
              )}
              <button
                onClick={handleAssessNow}
                disabled={assessing}
                className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:bg-gray-700 disabled:text-gray-500 border border-gray-700 rounded transition-colors"
              >
                {assessing ? "Assessing..." : "Assess Now"}
              </button>
            </div>
          </div>

          {riskAssessment ? (
            <>
              {/* Overall summary */}
              <div className="flex items-center gap-3 mb-3 p-2 bg-gray-800/50 rounded">
                <div className="flex-1">
                  <p className="text-sm text-gray-300">{riskAssessment.overall_risk_summary || riskAssessment.deal_summary}</p>
                  {riskAssessment.needs_attention && riskAssessment.attention_reason && (
                    <p className="text-xs text-red-400 mt-1">&#9873; {riskAssessment.attention_reason}</p>
                  )}
                  {riskAssessment.investable_assessment && (
                    <p className="text-xs text-blue-400 mt-1">Investable: {riskAssessment.investable_assessment}</p>
                  )}
                </div>
                {riskAssessment.probability_of_success != null && (
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Success Prob</div>
                    <div className="font-mono font-semibold text-green-400">{riskAssessment.probability_of_success.toFixed(0)}%</div>
                  </div>
                )}
              </div>

              {/* Grade badges row */}
              <div className="grid grid-cols-5 gap-2 mb-3">
                {GRADE_FACTORS.map(f => {
                  const grade = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_grade`] as string | null;
                  return <GradeBadge key={f.key} grade={grade} label={f.label} />;
                })}
              </div>

              {/* Factor detail cards */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                {GRADE_FACTORS.map(f => {
                  const grade = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_grade`] as string | null;
                  const confidence = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_confidence`] as number | null;
                  const detail = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_detail`] as string | null;
                  return <GradeFactorCard key={f.key} label={f.label} grade={grade} confidence={confidence} detail={detail} />;
                })}
              </div>

              {/* Supplemental scores */}
              {(riskAssessment.market_score != null || riskAssessment.timing_score != null || riskAssessment.competing_bid_score != null) && (
                <div className="mb-3">
                  <h4 className="text-xs font-medium text-gray-500 mb-1.5">Supplemental Scores</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {SUPPLEMENTAL_FACTORS.map(f => {
                      const score = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_score`] as number | null;
                      const detail = (riskAssessment as unknown as Record<string, unknown>)[`${f.key}_detail`] as string | null;
                      const timingDisagreement = f.key === "timing" && riskAssessment.ai_response?.production_disagreements?.some(d => d.factor === "timing");
                      return <SupplementalScoreCard key={f.key} label={f.label} score={score} detail={detail} hasDisagreement={timingDisagreement || false} />;
                    })}
                  </div>
                </div>
              )}

              {/* Key risks */}
              {Array.isArray(riskAssessment.key_risks) && riskAssessment.key_risks.length > 0 && (
                <div className="mb-3 p-2 bg-gray-800/50 rounded">
                  <h4 className="text-xs font-medium text-gray-500 mb-1">Key Risks</h4>
                  <ul className="text-xs text-gray-400 space-y-0.5">
                    {riskAssessment.key_risks.map((risk, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-red-400 shrink-0">-</span>
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Discrepancies */}
              {Array.isArray(riskAssessment.discrepancies) && riskAssessment.discrepancies.length > 0 && (
                <div className="mb-3 p-2 bg-yellow-400/5 border border-yellow-600/20 rounded">
                  <h4 className="text-xs font-medium text-yellow-400 mb-1">Discrepancies ({riskAssessment.discrepancies.length})</h4>
                  <div className="space-y-1">
                    {riskAssessment.discrepancies.map((disc, i) => (
                      <div key={i} className="text-xs">
                        <span className="text-gray-400 font-medium">{disc.field}:</span>{" "}
                        <span className="text-gray-500">Sheet: {disc.sheet_value}</span>{" "}
                        <span className="text-purple-400">AI: {disc.ai_value}</span>
                        {disc.explanation && <span className="text-gray-600 ml-1">- {disc.explanation}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Production Disagreements (AI vs Sheet) */}
              {riskAssessment.ai_response?.production_disagreements && riskAssessment.ai_response.production_disagreements.length > 0 && (
                <ProductionDisagreements disagreements={riskAssessment.ai_response.production_disagreements} />
              )}

              {/* Overnight events */}
              {Array.isArray(riskAssessment.overnight_events) && riskAssessment.overnight_events.length > 0 && (
                <div className="p-2 bg-blue-400/5 border border-blue-600/20 rounded">
                  <h4 className="text-xs font-medium text-blue-400 mb-1">Overnight Events ({riskAssessment.overnight_events.length})</h4>
                  <div className="space-y-1">
                    {riskAssessment.overnight_events.map((evt, i) => (
                      <div key={i} className="text-xs flex items-center gap-1.5">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                          evt.severity === "high" ? "bg-red-400/10 text-red-400" :
                          evt.severity === "medium" ? "bg-yellow-400/10 text-yellow-400" :
                          "bg-gray-700 text-gray-400"
                        }`}>{evt.type}</span>
                        <span className="text-gray-300">{evt.headline}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-600 text-sm py-6 text-center">
              No risk assessment available yet.
              <button onClick={handleAssessNow} disabled={assessing} className="ml-2 text-blue-400 hover:text-blue-300">
                {assessing ? "Running..." : "Run assessment"}
              </button>
            </div>
          )}
        </div>


        {/* Dividends + CVRs side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
          {/* Dividends */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h3 className="text-sm font-bold text-gray-300 mb-2">
              Dividends
              {paysDividend && <span className="ml-2 text-green-400 text-xs font-normal">Pays Dividend</span>}
            </h3>
            {paysDividend && dividends.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500 text-xs">
                    <th className="text-left py-1 px-2">Date</th>
                    <th className="text-right py-1 px-2">Value</th>
                    <th className="text-center py-1 px-2">Paid?</th>
                  </tr>
                </thead>
                <tbody>
                  {dividends.map((div, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-1 px-2 text-gray-300">{String(div.date ?? "-")}</td>
                      <td className="py-1 px-2 text-right font-mono text-green-400">
                        {div.value != null ? `$${Number(div.value).toFixed(2)}` : "-"}
                      </td>
                      <td className="py-1 px-2 text-center text-gray-400">{String(div.paid ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-gray-600 text-sm py-3 text-center">
                {paysDividend ? "Dividend data not available." : "No dividends."}
              </div>
            )}
          </div>

          {/* CVRs */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h3 className="text-sm font-bold text-gray-300 mb-2">
              CVRs
              {hasCvrs && <span className="ml-2 text-purple-400 text-xs font-normal">Active</span>}
            </h3>
            {hasCvrs && cvrs.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500 text-xs">
                    <th className="text-left py-1 px-2">NPV</th>
                    <th className="text-right py-1 px-2">Value</th>
                    <th className="text-right py-1 px-2">Prob</th>
                    <th className="text-left py-1 px-2">Payment</th>
                    <th className="text-left py-1 px-2">Deadline</th>
                    <th className="text-right py-1 px-2">Years</th>
                  </tr>
                </thead>
                <tbody>
                  {cvrs.map((cvr, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-1 px-2 font-mono">{cvr.npv != null ? `$${Number(cvr.npv).toFixed(4)}` : "-"}</td>
                      <td className="py-1 px-2 text-right font-mono">{cvr.value != null ? String(cvr.value) : "-"}</td>
                      <td className="py-1 px-2 text-right font-mono">{cvr.probability != null ? fmtPct(Number(cvr.probability)) : "-"}</td>
                      <td className="py-1 px-2">{String(cvr.payment ?? "-")}</td>
                      <td className="py-1 px-2">{String(cvr.deadline ?? "-")}</td>
                      <td className="py-1 px-2 text-right font-mono">{String(cvr.years ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-gray-600 text-sm py-3 text-center">
                {hasCvrs ? "CVR data not available." : "No CVRs."}
              </div>
            )}
          </div>
        </div>

        {/* Price History - collapsible */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mt-3">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-sm font-bold text-gray-300 w-full text-left flex items-center justify-between"
          >
            <span>Price History ({history.length} entries)</span>
            <span className="text-gray-500 text-xs">{showHistory ? "Hide" : "Show"}</span>
          </button>
          {showHistory && history.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto mt-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-700 text-gray-500 text-xs">
                    <th className="text-left py-1 px-2">Date</th>
                    <th className="text-right py-1 px-2">Close</th>
                    <th className="text-right py-1 px-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry, i) => {
                    const prev = i < history.length - 1 ? history[i + 1] : null;
                    const change = prev && entry.close != null && prev.close != null
                      ? entry.close - prev.close : null;
                    return (
                      <tr key={i} className="border-b border-gray-800/50">
                        <td className="py-1 px-2 text-gray-300">{entry.date ?? "-"}</td>
                        <td className="py-1 px-2 text-right font-mono">
                          {entry.close != null ? `$${Number(entry.close).toFixed(2)}` : "-"}
                        </td>
                        <td className="py-1 px-2 text-right font-mono">
                          {change != null ? (
                            <span className={change > 0 ? "text-green-400" : change < 0 ? "text-red-400" : "text-gray-400"}>
                              {change > 0 ? "+" : ""}{change.toFixed(2)}
                            </span>
                          ) : <span className="text-gray-600">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {showHistory && history.length === 0 && (
            <div className="text-gray-600 text-sm py-3 text-center mt-2">No price history data.</div>
          )}
        </div>
      </main>
    </div>
  );
}
