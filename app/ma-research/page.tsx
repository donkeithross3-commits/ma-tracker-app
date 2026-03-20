import Link from "next/link";
import { Database, ArrowLeft, FlaskConical, GitBranch } from "lucide-react";
import EnrichmentProgress from "@/components/ma-research/EnrichmentProgress";

export const metadata = {
  title: "Historical M&A Research Database — DR3 Dashboard",
};

// ── column row ──────────────────────────────────────────────────────────────
function Col({ name, desc }: { name: string; desc?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-[3px]">
      <code className="text-cyan-400 text-xs font-mono whitespace-nowrap">{name}</code>
      {desc && <span className="text-gray-500 text-xs">{desc}</span>}
    </div>
  );
}

// ── column group ────────────────────────────────────────────────────────────
function ColGroup({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    blue: "border-blue-800/60 bg-blue-950/20",
    emerald: "border-emerald-800/60 bg-emerald-950/20",
    amber: "border-amber-800/60 bg-amber-950/20",
    purple: "border-purple-800/60 bg-purple-950/20",
    cyan: "border-cyan-800/60 bg-cyan-950/20",
    rose: "border-rose-800/60 bg-rose-950/20",
    gray: "border-gray-700/60 bg-gray-800/20",
    orange: "border-orange-800/60 bg-orange-950/20",
    teal: "border-teal-800/60 bg-teal-950/20",
    indigo: "border-indigo-800/60 bg-indigo-950/20",
    pink: "border-pink-800/60 bg-pink-950/20",
    lime: "border-lime-800/60 bg-lime-950/20",
    sky: "border-sky-800/60 bg-sky-950/20",
  };
  const labelColorMap: Record<string, string> = {
    blue: "text-blue-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
    cyan: "text-cyan-400",
    rose: "text-rose-400",
    gray: "text-gray-400",
    orange: "text-orange-400",
    teal: "text-teal-400",
    indigo: "text-indigo-400",
    pink: "text-pink-400",
    lime: "text-lime-400",
    sky: "text-sky-400",
  };
  return (
    <div className={`border rounded px-3 py-2 ${colorMap[color] ?? colorMap.gray}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${labelColorMap[color] ?? labelColorMap.gray}`}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── collapsible table section ───────────────────────────────────────────────
function TableSection({
  title,
  badge,
  description,
  defaultOpen,
  children,
}: {
  title: string;
  badge?: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border border-gray-800 rounded-lg bg-gray-900/50">
      <summary className="cursor-pointer px-4 py-3 flex items-center gap-3 select-none hover:bg-gray-800/40 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <svg
          className="w-3.5 h-3.5 text-gray-500 transition-transform group-open:rotate-90 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <code className="text-base font-semibold text-gray-100 font-mono">{title}</code>
            {badge && (
              <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-2 border-t border-gray-800/50">
        {children}
      </div>
    </details>
  );
}

// ── event taxonomy ──────────────────────────────────────────────────────────
function EventCategory({ category, events }: { category: string; events: string[] }) {
  return (
    <div className="py-1">
      <span className="text-amber-400 font-mono text-xs font-semibold">{category}</span>
      <span className="text-gray-600 text-xs ml-2">{events.join(", ")}</span>
    </div>
  );
}

// ── pipeline step ───────────────────────────────────────────────────────────
function PipelineStep({ step, desc, last }: { step: string; desc: string; last?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-cyan-500/80 border border-cyan-400/40 mt-1 flex-shrink-0" />
        {!last && <div className="w-px flex-1 bg-gray-700 min-h-[24px]" />}
      </div>
      <div className="pb-3">
        <div className="text-sm font-semibold text-gray-200">{step}</div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </div>
  );
}

// ── main page ───────────────────────────────────────────────────────────────
export default function ResearchPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-gray-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Historical M&A Research Database</h1>
              <p className="text-xs text-gray-500">
                10-year institutional-grade database of ~6,100 U.S.-listed acquisition deals (2016-2026)
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Live enrichment stats + progress */}
        <EnrichmentProgress />

        {/* Data Model */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-200">Data Model</h2>
          </div>

          <div className="space-y-3">
            {/* ── research_deals ── */}
            <TableSection
              title="research_deals"
              badge="Master deal record"
              description="One row per acquisition deal. Core identification, classification, financials, timeline, and outcome."
              defaultOpen
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <ColGroup label="Target ID" color="blue">
                  <Col name="deal_key" />
                  <Col name="target_ticker" />
                  <Col name="target_name" />
                  <Col name="target_cik" />
                  <Col name="target_sic" />
                  <Col name="target_exchange" />
                  <Col name="target_listing_status" />
                  <Col name="target_incorporation" />
                  <Col name="is_foreign_private_issuer" />
                </ColGroup>

                <ColGroup label="Acquirer ID" color="emerald">
                  <Col name="acquirer_name" />
                  <Col name="acquirer_ticker" />
                  <Col name="acquirer_cik" />
                  <Col name="acquirer_type" />
                  <Col name="acquirer_group" />
                </ColGroup>

                <ColGroup label="Deal Classification" color="purple">
                  <Col name="deal_type" />
                  <Col name="deal_structure" />
                  <Col name="is_hostile" />
                  <Col name="is_mbo" />
                  <Col name="is_going_private" />
                  <Col name="has_cvr" />
                  <Col name="is_non_binding_offer" />
                  <Col name="is_cash_distribution" />
                  <Col name="is_bankruptcy_363" />
                  <Col name="has_earnout" />
                  <Col name="has_activist_involvement" />
                  <Col name="buyer_attempted_walkaway" />
                  <Col name="mac_invoked" />
                </ColGroup>

                <ColGroup label="Financial" color="amber">
                  <Col name="initial_deal_value_mm" />
                  <Col name="initial_premium_1d_pct" />
                  <Col name="initial_premium_30d_pct" />
                  <Col name="acquirer_toehold_pct" />
                  <Col name="tax_treatment" />
                  <Col name="shareholder_approval_threshold" />
                </ColGroup>

                <ColGroup label="Timeline" color="cyan">
                  <Col name="announced_date" />
                  <Col name="signing_date" />
                  <Col name="expected_close_date" />
                  <Col name="outside_date" />
                  <Col name="actual_close_date" />
                  <Col name="terminated_date" />
                </ColGroup>

                <ColGroup label="Outcome" color="rose">
                  <Col name="outcome" desc="pending / closed / closed_amended / closed_higher_bid / terminated_* / withdrawn" />
                  <Col name="outcome_reason" />
                </ColGroup>
              </div>
            </TableSection>

            {/* ── research_deal_consideration ── */}
            <TableSection
              title="research_deal_consideration"
              badge="N per deal"
              description="Versioned price terms. One row per bid revision -- tracks initial offers, price bumps, and competing bids."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <ColGroup label="Bid Identity" color="blue">
                  <Col name="version" />
                  <Col name="bidder_name" />
                  <Col name="is_original_bidder" />
                  <Col name="is_topping_bid" />
                </ColGroup>

                <ColGroup label="Consideration" color="emerald">
                  <Col name="cash_per_share" />
                  <Col name="stock_ratio" />
                  <Col name="stock_reference" />
                  <Col name="mixed_cash_pct" />
                  <Col name="cvr_value_est" />
                </ColGroup>

                <ColGroup label="Valuation" color="amber">
                  <Col name="total_per_share" />
                  <Col name="total_deal_value_mm" />
                </ColGroup>

                <ColGroup label="Premium Analysis" color="purple">
                  <Col name="premium_to_prior_close" />
                  <Col name="premium_to_30d_avg" />
                  <Col name="premium_to_prior_bid" />
                </ColGroup>
              </div>
            </TableSection>

            {/* ── research_deal_clauses ── */}
            <TableSection
              title="research_deal_clauses"
              badge="1:1 with deals"
              description="Deal protection provisions extracted from merger agreements. Go-shop windows, termination fees, match rights, financing conditions, regulatory requirements."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                <ColGroup label="Go-Shop" color="emerald">
                  <Col name="has_go_shop" />
                  <Col name="go_shop_period_days" />
                  <Col name="go_shop_start_date" />
                  <Col name="go_shop_end_date" />
                  <Col name="go_shop_fee_mm" />
                  <Col name="go_shop_fee_pct" />
                  <Col name="go_shop_bidder_emerged" />
                  <Col name="post_go_shop_match" />
                </ColGroup>

                <ColGroup label="No-Shop" color="blue">
                  <Col name="no_shop_strength" />
                  <Col name="fiduciary_out" />
                  <Col name="fiduciary_out_type" />
                  <Col name="superior_proposal_def" />
                  <Col name="window_shop_allowed" />
                </ColGroup>

                <ColGroup label="Match Rights" color="purple">
                  <Col name="has_match_right" />
                  <Col name="match_right_days" />
                  <Col name="match_right_rounds" />
                  <Col name="match_right_type" />
                </ColGroup>

                <ColGroup label="Termination Fees" color="amber">
                  <Col name="target_termination_fee_mm" />
                  <Col name="target_termination_fee_pct" />
                  <Col name="acquirer_termination_fee_mm" />
                  <Col name="acquirer_termination_fee_pct" />
                  <Col name="two_tier_fee" />
                </ColGroup>

                <ColGroup label="Financing" color="cyan">
                  <Col name="has_financing_condition" />
                  <Col name="financing_committed" />
                  <Col name="financing_sources" />
                </ColGroup>

                <ColGroup label="Regulatory" color="rose">
                  <Col name="requires_hsr" />
                  <Col name="requires_cfius" />
                  <Col name="requires_eu_merger" />
                  <Col name="requires_other_regulatory" />
                  <Col name="regulatory_complexity" />
                </ColGroup>

                <ColGroup label="MAC" color="orange">
                  <Col name="mac_exclusion_breadth" />
                  <Col name="pandemic_carveout" />
                  <Col name="industry_carveout" />
                </ColGroup>

                <ColGroup label="Collar" color="teal">
                  <Col name="has_collar" />
                  <Col name="collar_type" />
                  <Col name="collar_floor" />
                  <Col name="collar_ceiling" />
                  <Col name="walk_away_right" />
                </ColGroup>

                <ColGroup label="Specific Performance" color="indigo">
                  <Col name="target_has_specific_performance" />
                  <Col name="acquirer_has_specific_performance" />
                </ColGroup>

                <ColGroup label="Golden Parachute" color="pink">
                  <Col name="has_golden_parachute" />
                  <Col name="management_retention_agreements" />
                  <Col name="golden_parachute_total_mm" />
                </ColGroup>

                <ColGroup label="Appraisal" color="gray">
                  <Col name="appraisal_rights_available" />
                  <Col name="appraisal_state" />
                </ColGroup>

                <ColGroup label="CVR Detail" color="sky">
                  <Col name="cvr_description" />
                  <Col name="cvr_trigger_type" />
                  <Col name="cvr_max_value" />
                  <Col name="cvr_expiration_date" />
                </ColGroup>

                <ColGroup label="Earnout Detail" color="lime">
                  <Col name="has_earnout" />
                  <Col name="earnout_max_value_mm" />
                  <Col name="earnout_description" />
                </ColGroup>
              </div>
            </TableSection>

            {/* ── research_deal_events ── */}
            <TableSection
              title="research_deal_events"
              badge="N per deal"
              description="Lifecycle events with a structured taxonomy. Each event has a category and sub-type."
            >
              <div className="space-y-0.5">
                <EventCategory category="ANNOUNCEMENT" events={["initial_announcement", "formal_agreement", "hostile_approach", "non_binding_proposal"]} />
                <EventCategory category="PRICE_CHANGE" events={["price_increase", "price_decrease", "consideration_change", "topping_bid", "matching_bid"]} />
                <EventCategory category="COMPETING_BID" events={["competing_bid_announced", "competing_bid_withdrawn", "competing_bid_increased", "white_knight"]} />
                <EventCategory category="REGULATORY" events={["hsr_filing", "hsr_clearance", "hsr_second_request", "doj_challenge", "ftc_challenge", "cfius_filing", "cfius_clearance", "eu_phase1_clearance", "eu_phase2_investigation", "regulatory_remedy", "regulatory_block"]} />
                <EventCategory category="SHAREHOLDER" events={["proxy_filed", "definitive_proxy", "vote_scheduled", "vote_approved", "vote_rejected", "recommendation_change"]} />
                <EventCategory category="FINANCING" events={["financing_committed", "financing_updated", "financing_concern", "financing_failed"]} />
                <EventCategory category="LEGAL" events={["shareholder_litigation", "regulatory_litigation", "counterparty_litigation", "preliminary_injunction", "injunction_granted", "injunction_denied", "litigation_settled", "appraisal_petition"]} />
                <EventCategory category="ACTIVIST" events={["activist_stake_disclosed", "activist_opposition", "activist_campaign", "activist_settlement", "activist_board_seats"]} />
                <EventCategory category="WALKAWAY" events={["mac_invocation", "buyer_walkaway_attempt", "buyer_walkaway_litigation", "specific_performance_suit"]} />
                <EventCategory category="ARBITRATION" events={["arbitration_filed", "arbitration_ruling", "arbitration_settlement"]} />
                <EventCategory category="GO_SHOP" events={["go_shop_started", "go_shop_bidder_emerged", "go_shop_expired", "go_shop_extended"]} />
                <EventCategory category="TIMELINE" events={["expected_close_updated", "outside_date_extended", "closing_condition_waived"]} />
                <EventCategory category="TERMINATION" events={["mutual_termination", "target_termination", "acquirer_termination", "regulatory_termination", "vote_failure_termination"]} />
                <EventCategory category="COMPLETION" events={["closing", "tender_offer_completed", "squeeze_out_merger", "delisting"]} />
              </div>
            </TableSection>

            {/* ── research_deal_filings ── */}
            <TableSection
              title="research_deal_filings"
              badge="N per deal"
              description="SEC filings linked to deals. Cross-references EDGAR accession numbers for traceability."
            >
              <ColGroup label="Filing Record" color="gray">
                <Col name="accession_number" />
                <Col name="filing_type" />
                <Col name="filing_date" />
                <Col name="filed_by_cik" />
                <Col name="filed_by_name" />
                <Col name="filing_url" />
                <Col name="primary_doc_url" />
              </ColGroup>
            </TableSection>

            {/* ── research_market_daily ── */}
            <TableSection
              title="research_market_daily"
              badge="Daily per deal"
              description="Daily stock data with computed merger arbitrage spreads and market context."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <ColGroup label="Price Data" color="blue">
                  <Col name="trade_date" />
                  <Col name="open" />
                  <Col name="high" />
                  <Col name="low" />
                  <Col name="close" />
                  <Col name="volume" />
                  <Col name="vwap" />
                </ColGroup>

                <ColGroup label="Spread Analysis" color="emerald">
                  <Col name="deal_price_on_date" />
                  <Col name="gross_spread" />
                  <Col name="gross_spread_pct" />
                  <Col name="annualized_spread" />
                </ColGroup>

                <ColGroup label="Timeline Context" color="purple">
                  <Col name="days_since_announce" />
                  <Col name="days_to_expected_close" />
                </ColGroup>

                <ColGroup label="Market Context" color="amber">
                  <Col name="sp500_close" />
                  <Col name="vix_close" />
                </ColGroup>
              </div>
            </TableSection>

            {/* ── research_options_daily ── */}
            <TableSection
              title="research_options_daily"
              badge="Daily per deal"
              description="Daily options summary with implied volatility surface, skew metrics, and market-implied deal probabilities."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <ColGroup label="Reference Prices" color="gray">
                  <Col name="trade_date" />
                  <Col name="stock_close" />
                  <Col name="deal_price" />
                </ColGroup>

                <ColGroup label="Implied Volatility" color="cyan">
                  <Col name="atm_call_iv" />
                  <Col name="atm_put_iv" />
                  <Col name="upside_call_iv" />
                  <Col name="downside_put_iv" />
                </ColGroup>

                <ColGroup label="Skew" color="purple">
                  <Col name="call_skew_25d" />
                  <Col name="put_skew_25d" />
                  <Col name="skew_ratio" />
                </ColGroup>

                <ColGroup label="Volume" color="blue">
                  <Col name="total_call_volume" />
                  <Col name="total_put_volume" />
                  <Col name="put_call_ratio" />
                </ColGroup>

                <ColGroup label="Above-Deal Activity" color="amber">
                  <Col name="above_deal_call_volume" />
                  <Col name="above_deal_call_oi" />
                  <Col name="above_deal_call_iv_avg" />
                </ColGroup>

                <ColGroup label="Implied Probabilities" color="emerald">
                  <Col name="impl_prob_deal_close" />
                  <Col name="impl_prob_higher_bid" />
                </ColGroup>
              </div>
            </TableSection>
          </div>
        </section>

        {/* Data Pipeline */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-200">Data Pipeline</h2>
          </div>

          <div className="bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-3">
            <PipelineStep step="SEC EDGAR Master Index" desc="Universe construction -- 6,127 deals identified from 10 years of M&A filings" />
            <PipelineStep step="Claude CLI Enrichment" desc="Acquirer identification, price extraction, deal structure classification" />
            <PipelineStep step="Clause Extraction" desc="Go-shop windows, match rights, termination fees, financing conditions from merger agreements" />
            <PipelineStep step="Polygon API" desc="Daily stock data (OHLCV, VWAP) and options chains for active tickers" />
            <PipelineStep step="Outcome Classification" desc="Filing pattern analysis to determine deal completion, amendment, or termination" />
            <PipelineStep step="Feature Engineering" desc="Computed spreads, annualized returns, implied probabilities, skew metrics" last />
          </div>
        </section>

        {/* Research Study */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FlaskConical className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-200">Research: Higher-Bid Dynamics</h2>
          </div>

          <div className="bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-gray-500">Question</span>
                <p className="text-gray-300">What predicts whether an announced acquisition receives a higher bid?</p>
              </div>
              <div>
                <span className="text-gray-500">Target variable</span>
                <p className="text-gray-300 font-mono text-xs mt-0.5">received_higher_bid</p>
              </div>
              <div>
                <span className="text-gray-500">Method</span>
                <p className="text-gray-300">Logistic regression + XGBoost + survival analysis</p>
              </div>
              <div>
                <span className="text-gray-500">Status</span>
                <p className="text-amber-400">Data collection in progress</p>
              </div>
            </div>
          </div>
        </section>

        {/* v2 footer */}
        <div className="border-t border-gray-800/50 pt-4 pb-8">
          <p className="text-xs text-gray-600 text-center">
            v1 -- static reference. v2 will add interactive data exploration, live queries, and deal drill-down.
          </p>
        </div>
      </main>
    </div>
  );
}
