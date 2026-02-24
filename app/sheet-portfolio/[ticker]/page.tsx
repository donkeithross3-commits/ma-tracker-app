"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  termination_fee: string | null;
  termination_fee_pct: number | null;
  target_marketcap: string | null;
  target_enterprise_value: string | null;
  shareholder_risk: string | null;
  financing_risk: string | null;
  legal_risk: string | null;
  investable_deal: string | null;
  pays_dividend: string | null;
  has_cvrs: string | null;
  cvrs: Array<Record<string, unknown>> | null;
  dividends: Array<Record<string, unknown>> | null;
  price_history: Array<{ date: string; close: number }> | null;
  fetched_at: string | null;
}

interface DealResponse {
  ticker: string;
  dashboard: DashboardData | null;
  detail: DetailData | null;
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
  return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`;
}

function riskBadge(risk: string | null | undefined) {
  if (!risk) return <span className="text-gray-500">-</span>;
  const lower = risk.toLowerCase();
  let color = "text-gray-400 bg-gray-400/10";
  if (lower.startsWith("low")) color = "text-green-400 bg-green-400/10";
  else if (lower.startsWith("med")) color = "text-yellow-400 bg-yellow-400/10";
  else if (lower.startsWith("high")) color = "text-red-400 bg-red-400/10";
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${color}`}>{risk}</span>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color || "text-gray-100"}`}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className="text-gray-100 text-sm font-mono">{value}</span>
    </div>
  );
}

// --- Tab components ---

function OverviewTab({
  dash,
  detail,
}: {
  dash: DashboardData | null;
  detail: DetailData | null;
}) {
  const spread = detail?.current_spread;
  const irr = detail?.expected_irr ?? dash?.current_yield;
  const days = dash?.countdown_days;
  const investable = detail?.investable_deal ?? dash?.investable;

  return (
    <div className="space-y-4">
      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Current Spread"
          value={spread != null ? fmtPct(spread) : "-"}
          color={spread != null ? (spread >= 0 ? "text-green-400" : "text-red-400") : undefined}
        />
        <MetricCard
          label="Expected IRR"
          value={irr != null ? fmtPct(irr) : "-"}
          color={irr != null ? (irr >= 0 ? "text-green-400" : "text-red-400") : undefined}
        />
        <MetricCard
          label="Days to Close"
          value={days != null ? String(days) : "-"}
          color={
            days != null
              ? days < 0
                ? "text-red-400"
                : days < 30
                ? "text-yellow-400"
                : "text-gray-100"
              : undefined
          }
        />
        <MetricCard
          label="Investable"
          value={investable || "-"}
          color={
            investable?.toLowerCase().startsWith("yes")
              ? "text-green-400"
              : "text-gray-400"
          }
        />
      </div>

      {/* Prices */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Prices</h3>
        <InfoRow label="Target Current Price" value={fmtPrice(detail?.target_current_price ?? dash?.current_price)} />
        <InfoRow label="Acquiror Current Price" value={fmtPrice(detail?.acquiror_current_price)} />
        <InfoRow label="Total Deal Price" value={fmtPrice(detail?.total_price_per_share ?? dash?.deal_price)} />
        <InfoRow label="Spread Change" value={detail?.spread_change != null ? fmtPct(detail.spread_change) : "-"} />
      </div>

      {/* Deal info */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Deal Info</h3>
        <InfoRow label="Announce Date" value={fmtDate(detail?.announce_date ?? dash?.announced_date)} />
        <InfoRow label="Expected Close" value={
          <span>
            {fmtDate(detail?.expected_close_date ?? dash?.close_date)}
            {detail?.expected_close_date_note && (
              <span className="text-gray-500 text-xs ml-1">({detail.expected_close_date_note})</span>
            )}
          </span>
        } />
        <InfoRow label="Outside Date" value={fmtDate(detail?.outside_date ?? dash?.end_date)} />
        <InfoRow label="Category" value={detail?.category ?? dash?.category ?? "-"} />
        <InfoRow label="Market Cap" value={detail?.target_marketcap ?? "-"} />
        <InfoRow label="Enterprise Value" value={detail?.target_enterprise_value ?? "-"} />
      </div>

      {/* Risk */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Risk Assessment</h3>
        <div className="flex gap-4 mb-3">
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">Shareholder</div>
            {riskBadge(detail?.shareholder_risk ?? dash?.vote_risk)}
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">Financing</div>
            {riskBadge(detail?.financing_risk ?? dash?.finance_risk)}
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">Legal</div>
            {riskBadge(detail?.legal_risk ?? dash?.legal_risk)}
          </div>
        </div>
      </div>

      {/* Qualitative */}
      {detail && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Qualitative</h3>
          <InfoRow label="Shareholder Vote" value={detail.shareholder_vote ?? "-"} />
          <InfoRow label="Premium Attractive" value={detail.premium_attractive ?? "-"} />
          <InfoRow label="Board Approval" value={detail.board_approval ?? "-"} />
          <InfoRow label="Voting Agreements" value={detail.voting_agreements ?? "-"} />
          <InfoRow label="Regulatory Approvals" value={detail.regulatory_approvals ?? "-"} />
          <InfoRow label="Termination Fee" value={
            detail.termination_fee
              ? `${detail.termination_fee}${detail.termination_fee_pct != null ? ` (${fmtPct(detail.termination_fee_pct)})` : ""}`
              : "-"
          } />
        </div>
      )}
    </div>
  );
}

function DealTermsTab({ detail }: { detail: DetailData | null }) {
  if (!detail) {
    return (
      <div className="text-center py-10 text-gray-500">
        Detail data not yet ingested for this deal.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Consideration breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Consideration Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-500 text-xs">
              <th className="text-left py-1.5 px-2">Component</th>
              <th className="text-right py-1.5 px-2">Per Share</th>
              <th className="text-right py-1.5 px-2">% of Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-800/50">
              <td className="py-1.5 px-2 text-gray-300">Cash</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(detail.cash_per_share)}</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPct(detail.cash_pct)}</td>
            </tr>
            <tr className="border-b border-gray-800/50">
              <td className="py-1.5 px-2 text-gray-300">Stock</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(detail.stock_per_share)}</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPct(detail.stock_pct)}</td>
            </tr>
            <tr className="border-b border-gray-800/50">
              <td className="py-1.5 px-2 text-gray-300">Dividends/Other</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(detail.dividends_other)}</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPct(detail.dividends_other_pct)}</td>
            </tr>
            <tr className="border-t border-gray-700 font-semibold">
              <td className="py-1.5 px-2 text-gray-100">Total</td>
              <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(detail.total_price_per_share)}</td>
              <td className="py-1.5 px-2 text-right font-mono">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Spread & return */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Spread & Return</h3>
        <InfoRow label="Deal Spread" value={fmtPct(detail.deal_spread)} />
        <InfoRow label="Close Time (months)" value={detail.deal_close_time_months != null ? detail.deal_close_time_months.toFixed(1) : "-"} />
        <InfoRow label="Expected IRR" value={
          <span className={detail.expected_irr != null ? (detail.expected_irr >= 0 ? "text-green-400" : "text-red-400") : ""}>
            {fmtPct(detail.expected_irr)}
          </span>
        } />
      </div>

      {/* Hypothetical */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Hypothetical Terms</h3>
        <InfoRow label="Ideal Price" value={fmtPrice(detail.ideal_price)} />
        <InfoRow label="Hypothetical IRR" value={fmtPct(detail.hypothetical_irr)} />
        <InfoRow label="Hypothetical IRR Spread" value={fmtPct(detail.hypothetical_irr_spread)} />
        <InfoRow label="Stress Test Discount" value={detail.stress_test_discount ?? "-"} />
        <InfoRow label="Stock Ratio" value={detail.stock_ratio ?? "-"} />
      </div>
    </div>
  );
}

function CvrsDividendsTab({ detail }: { detail: DetailData | null }) {
  if (!detail) {
    return (
      <div className="text-center py-10 text-gray-500">
        Detail data not yet ingested for this deal.
      </div>
    );
  }

  const hasCvrs = detail.has_cvrs && detail.has_cvrs.toLowerCase() !== "no";
  const cvrs = detail.cvrs && Array.isArray(detail.cvrs) ? detail.cvrs : [];
  const paysDividend = detail.pays_dividend && detail.pays_dividend.toLowerCase() !== "no";
  const dividends = detail.dividends && Array.isArray(detail.dividends) ? detail.dividends : [];

  return (
    <div className="space-y-4">
      {/* CVRs */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Contingent Value Rights (CVRs)
          {hasCvrs && <span className="ml-2 text-purple-400 text-xs">Active</span>}
        </h3>
        {hasCvrs && cvrs.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500 text-xs">
                <th className="text-left py-1.5 px-2">NPV</th>
                <th className="text-right py-1.5 px-2">Value</th>
                <th className="text-right py-1.5 px-2">Probability</th>
                <th className="text-left py-1.5 px-2">Payment</th>
                <th className="text-left py-1.5 px-2">Deadline</th>
                <th className="text-right py-1.5 px-2">Years</th>
              </tr>
            </thead>
            <tbody>
              {cvrs.map((cvr, i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-1.5 px-2 font-mono">{cvr.npv != null ? `$${cvr.npv}` : "-"}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{cvr.value != null ? `$${cvr.value}` : "-"}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{String(cvr.probability ?? "-")}</td>
                  <td className="py-1.5 px-2">{String(cvr.payment ?? "-")}</td>
                  <td className="py-1.5 px-2">{String(cvr.deadline ?? "-")}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{String(cvr.years ?? "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-500 text-sm py-4 text-center">
            {hasCvrs ? "CVR data not available." : "This deal has no CVRs."}
          </div>
        )}
      </div>

      {/* Dividends */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Dividends
          {paysDividend && <span className="ml-2 text-green-400 text-xs">Pays Dividend</span>}
        </h3>
        {paysDividend && dividends.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500 text-xs">
                <th className="text-left py-1.5 px-2">Date</th>
                <th className="text-right py-1.5 px-2">Value</th>
                <th className="text-center py-1.5 px-2">Paid?</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map((div, i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-1.5 px-2">{String(div.date ?? "-")}</td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {div.value != null ? `$${div.value}` : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {String(div.paid ?? "-")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-500 text-sm py-4 text-center">
            {paysDividend ? "Dividend data not available." : "This deal does not pay dividends."}
          </div>
        )}
      </div>
    </div>
  );
}

function PriceHistoryTab({ detail }: { detail: DetailData | null }) {
  if (!detail) {
    return (
      <div className="text-center py-10 text-gray-500">
        Detail data not yet ingested for this deal.
      </div>
    );
  }

  const history = detail.price_history && Array.isArray(detail.price_history)
    ? detail.price_history
    : [];

  if (history.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        No price history data available.
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Price History ({history.length} entries)
      </h3>
      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="border-b border-gray-700 text-gray-500 text-xs">
              <th className="text-left py-1.5 px-2">Date</th>
              <th className="text-right py-1.5 px-2">Close</th>
              <th className="text-right py-1.5 px-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, i) => {
              const prev = i < history.length - 1 ? history[i + 1] : null;
              const change = prev && entry.close != null && prev.close != null
                ? entry.close - prev.close
                : null;
              return (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-1.5 px-2 text-gray-300">{entry.date ?? "-"}</td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {entry.close != null ? `$${Number(entry.close).toFixed(2)}` : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {change != null ? (
                      <span className={change > 0 ? "text-green-400" : change < 0 ? "text-red-400" : "text-gray-400"}>
                        {change > 0 ? "+" : ""}{change.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main page ---

export default function DealDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase();
  const [data, setData] = useState<DealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(`/api/sheet-portfolio/deal/${encodeURIComponent(ticker)}`)
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(body.detail || body.error || `HTTP ${resp.status}`);
        }
        return resp.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticker]);

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
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Link href="/sheet-portfolio" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">
            &larr; Back to Portfolio
          </Link>
          <div className="text-center py-20 text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { dashboard: dash, detail } = data;
  const acquiror = detail?.acquiror ?? dash?.acquiror ?? "";
  const category = detail?.category ?? dash?.category ?? "";
  const dealPrice = detail?.total_price_per_share ?? dash?.deal_price;
  const currentPrice = detail?.target_current_price ?? dash?.current_price;
  const spread = detail?.current_spread ?? dash?.gross_yield;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/sheet-portfolio"
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold font-mono">{ticker}</h1>
                  {category && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-400/10 text-blue-400">
                      {category}
                    </span>
                  )}
                </div>
                {acquiror && (
                  <p className="text-sm text-gray-400">
                    {detail?.target ? `${detail.target} / ` : ""}Acquiror: {acquiror}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <div className="text-xs text-gray-500">Deal Price</div>
                <div className="font-mono font-semibold">{fmtPrice(dealPrice)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Current</div>
                <div className="font-mono font-semibold">{fmtPrice(currentPrice)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Spread</div>
                <div className={`font-mono font-semibold ${spread != null ? (spread >= 0 ? "text-green-400" : "text-red-400") : ""}`}>
                  {fmtPct(spread)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4">
        {!detail && (
          <div className="bg-yellow-400/10 border border-yellow-600/30 rounded-lg px-4 py-3 mb-4 text-sm text-yellow-300">
            Detail data not yet ingested for this deal. Showing dashboard data only.
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="terms">Deal Terms</TabsTrigger>
            <TabsTrigger value="cvrs">CVRs & Dividends</TabsTrigger>
            <TabsTrigger value="history">Price History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab dash={dash} detail={detail} />
          </TabsContent>

          <TabsContent value="terms">
            <DealTermsTab detail={detail} />
          </TabsContent>

          <TabsContent value="cvrs">
            <CvrsDividendsTab detail={detail} />
          </TabsContent>

          <TabsContent value="history">
            <PriceHistoryTab detail={detail} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
