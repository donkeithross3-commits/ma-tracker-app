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

interface RiskAssessment {
  assessment_date: string;
  overall_risk_score: number | null;
  overall_risk_level: string | null;
  overall_risk_summary: string | null;
  probability_of_success: number | null;
  needs_attention: boolean;
  attention_reason: string | null;
  regulatory_score: number | null;
  regulatory_detail: string | null;
  vote_score: number | null;
  vote_detail: string | null;
  financing_score: number | null;
  financing_detail: string | null;
  legal_score: number | null;
  legal_detail: string | null;
  timing_score: number | null;
  timing_detail: string | null;
  mac_score: number | null;
  mac_detail: string | null;
  market_score: number | null;
  market_detail: string | null;
  competing_bid_score: number | null;
  competing_bid_detail: string | null;
}

const RISK_FACTORS = [
  { key: "regulatory", label: "Regulatory", short: "REG" },
  { key: "vote", label: "Vote", short: "VOT" },
  { key: "financing", label: "Financing", short: "FIN" },
  { key: "legal", label: "Legal", short: "LEG" },
  { key: "timing", label: "Timing", short: "TIM" },
  { key: "mac", label: "MAC", short: "MAC" },
  { key: "market", label: "Market", short: "MKT" },
  { key: "competing_bid", label: "Competing Bid", short: "BID" },
] as const;

function RiskRadarChart({ assessment }: { assessment: RiskAssessment }) {
  const cx = 128, cy = 128, r = 100;
  const n = RISK_FACTORS.length;

  const points = RISK_FACTORS.map((f, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const score = (assessment as unknown as Record<string, unknown>)[`${f.key}_score`] as number ?? 0;
    const ratio = score / 10;
    return {
      x: cx + r * ratio * Math.cos(angle),
      y: cy + r * ratio * Math.sin(angle),
      labelX: cx + (r + 16) * Math.cos(angle),
      labelY: cy + (r + 16) * Math.sin(angle),
    };
  });

  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(" ");
  const gridLevels = [2, 4, 6, 8, 10];

  const overall = assessment.overall_risk_score ?? 0;
  let fillColor = "rgba(74, 222, 128, 0.15)";
  if (overall >= 8) fillColor = "rgba(248, 113, 113, 0.2)";
  else if (overall >= 6) fillColor = "rgba(251, 146, 60, 0.2)";
  else if (overall >= 4) fillColor = "rgba(250, 204, 21, 0.15)";
  else if (overall >= 2) fillColor = "rgba(163, 230, 53, 0.15)";

  let strokeColor = "#4ade80";
  if (overall >= 8) strokeColor = "#f87171";
  else if (overall >= 6) strokeColor = "#fb923c";
  else if (overall >= 4) strokeColor = "#facc15";
  else if (overall >= 2) strokeColor = "#a3e635";

  return (
    <svg viewBox="0 0 256 256" className="w-full h-full">
      {gridLevels.map(level => {
        const gridPoints = Array.from({length: n}, (_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const ratio = level / 10;
          return `${cx + r * ratio * Math.cos(angle)},${cy + r * ratio * Math.sin(angle)}`;
        }).join(" ");
        return <polygon key={level} points={gridPoints} fill="none" stroke="#374151" strokeWidth="0.5" />;
      })}
      {RISK_FACTORS.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="#374151" strokeWidth="0.5" />;
      })}
      <polygon points={polygonPoints} fill={fillColor} stroke={strokeColor} strokeWidth="1.5" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={strokeColor} />
      ))}
      {points.map((p, i) => (
        <text key={i} x={p.labelX} y={p.labelY} textAnchor="middle" dominantBaseline="middle" className="fill-gray-400" fontSize="8">
          {RISK_FACTORS[i].short}
        </text>
      ))}
    </svg>
  );
}

function RiskScoreBadge({ score, level }: { score: number | null; level: string | null }) {
  if (score === null) return <span className="text-gray-600 text-2xl font-mono">-</span>;
  let color = "text-green-400 bg-green-400/10 border-green-400/30";
  if (score >= 8) color = "text-red-400 bg-red-400/10 border-red-400/30";
  else if (score >= 6) color = "text-orange-400 bg-orange-400/10 border-orange-400/30";
  else if (score >= 4) color = "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
  else if (score >= 2) color = "text-lime-400 bg-lime-400/10 border-lime-400/30";
  return (
    <div className={`px-3 py-2 rounded border text-center ${color}`}>
      <div className="text-2xl font-mono font-bold">{score.toFixed(1)}</div>
      <div className="text-xs uppercase tracking-wider">{level}</div>
    </div>
  );
}

function FactorCard({ factor, assessment }: { factor: typeof RISK_FACTORS[number]; assessment: RiskAssessment }) {
  const score = (assessment as unknown as Record<string, unknown>)[`${factor.key}_score`] as number | null;
  const detail = (assessment as unknown as Record<string, unknown>)[`${factor.key}_detail`] as string | null;

  if (score === null) return null;

  let barColor = "bg-green-400";
  if (score >= 8) barColor = "bg-red-400";
  else if (score >= 6) barColor = "bg-orange-400";
  else if (score >= 4) barColor = "bg-yellow-400";
  else if (score >= 2) barColor = "bg-lime-400";

  return (
    <div className="bg-gray-800/50 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-400">{factor.label}</span>
        <span className="text-xs font-mono font-bold text-gray-200">{score.toFixed(1)}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1 mb-1.5">
        <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      {detail && <p className="text-xs text-gray-500 line-clamp-2">{detail}</p>}
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
  const spread = d?.current_spread;
  const spreadChange = d?.spread_change;

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
                <span className={`inline-block w-2 h-2 rounded-full ${lastRefresh ? "bg-green-500" : "bg-gray-600"}`} title={lastRefresh ? "Polygon connected" : "No market data yet"} />
                <span className="text-xs text-gray-400">
                  {lastRefresh
                    ? `Mkt data ${lastRefresh.toLocaleTimeString()}`
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
                <div className={`font-mono font-semibold ${targetPriceIsLive ? "text-cyan-400" : ""}`}>{fmtPrice(targetPrice)}</div>
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
            <Row label="Target current price" value={fmtPrice(targetPrice)} color={targetPriceIsLive ? "text-cyan-400" : undefined} />
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

            <SectionTitle>Options</SectionTitle>
            <Row label="Optionable" value={d?.optionable ?? "-"} />
            <Row label="Long Naked Calls" value={d?.long_naked_calls ?? "-"} />
            <Row label="Long Vert Call Spread" value={d?.long_vertical_call_spread ?? "-"} />
            <Row label="Long Covered Call" value={d?.long_covered_call ?? "-"} />
            <Row label="Short Put Vert Spread" value={d?.short_put_vertical_spread ?? "-"} />
          </div>
        </div>

        {/* Risk Assessment */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-300">AI Risk Assessment</h3>
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
                <RiskScoreBadge score={riskAssessment.overall_risk_score} level={riskAssessment.overall_risk_level} />
                <div className="flex-1">
                  <p className="text-sm text-gray-300">{riskAssessment.overall_risk_summary}</p>
                  {riskAssessment.needs_attention && riskAssessment.attention_reason && (
                    <p className="text-xs text-red-400 mt-1">&#9873; {riskAssessment.attention_reason}</p>
                  )}
                </div>
                {riskAssessment.probability_of_success != null && (
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Success Prob</div>
                    <div className="font-mono font-semibold text-green-400">{riskAssessment.probability_of_success.toFixed(0)}%</div>
                  </div>
                )}
              </div>

              {/* Radar chart + factor cards */}
              <div className="flex gap-3">
                <div className="w-64 h-64 shrink-0">
                  <RiskRadarChart assessment={riskAssessment} />
                </div>

                <div className="flex-1 grid grid-cols-2 gap-2">
                  {RISK_FACTORS.map(f => (
                    <FactorCard key={f.key} factor={f} assessment={riskAssessment} />
                  ))}
                </div>
              </div>
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
