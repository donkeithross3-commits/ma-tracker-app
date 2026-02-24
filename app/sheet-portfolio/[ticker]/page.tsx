"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const targetPrice = d?.target_current_price ?? dash?.current_price;
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
              <div>
                <div className="text-xs text-gray-500">Target Px</div>
                <div className="font-mono font-semibold">{fmtPrice(targetPrice)}</div>
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
            <Row label="Target current price" value={fmtPrice(targetPrice)} />
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
