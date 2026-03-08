"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { UserMenu } from "@/components/UserMenu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ticker {
  ticker: string;
  price: number | null;
  market_cap_b: number | null;
  signal: "Long" | "Short";
  ai_rationale: string;
  ai_bucket: "Best Pick" | "Worst Pick";
  industry_label: string;
  industry_dynamics_favor: string;
  switching_cost_class: string;
  role: string;
  rank: number;
  opportunity_score: number;
  management_ai_execution_score: number;
  fundamental_score: number;
  valuation_score: number;
  valuation_gap_pct: number | null;
  dislocation_score: number;
  ai_positioning_score: number;
  risk_penalty: number;
  revenue_growth_yoy: number | null;
  revenue_cagr_2y: number | null;
  operating_margin: number | null;
  operating_margin_change_2y: number | null;
  fcf_yield: number | null;
  free_cash_flow_b: number | null;
  ai_news_intensity: number | null;
  ai_exec_concrete_ratio: number | null;
  ai_fear_ratio: number | null;
  ai_net_sentiment: number | null;
  drawdown_252d: number | null;
  return_63d: number | null;
}

interface Industry {
  industry_label: string;
  ticker_count: number;
  switching_class: string;
  favored_side: string;
  avg_switching_cost_score: number;
  avg_valuation_gap_pct: number;
  avg_dislocation_score: number;
  avg_opportunity_score: number;
}

// ---------------------------------------------------------------------------
// Static Data (from ai_disruption_scan_20260305)
// ---------------------------------------------------------------------------

const SCAN_DATE = "2026-03-05";
const UNIVERSE_SIZE = 60;

const INDUSTRIES: Industry[] = [
  { industry_label: "CRM/ERP Platforms", ticker_count: 7, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.938, avg_valuation_gap_pct: 77.2, avg_dislocation_score: 2.007, avg_opportunity_score: 0.767 },
  { industry_label: "Cloud Hyperscalers", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.976, avg_valuation_gap_pct: 51.4, avg_dislocation_score: -0.370, avg_opportunity_score: 0.636 },
  { industry_label: "Consumer Insurance", ticker_count: 7, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.330, avg_valuation_gap_pct: 77.1, avg_dislocation_score: -0.636, avg_opportunity_score: 0.344 },
  { industry_label: "Cybersecurity Platforms", ticker_count: 8, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.878, avg_valuation_gap_pct: 7.3, avg_dislocation_score: 0.831, avg_opportunity_score: 0.121 },
  { industry_label: "Horizontal SaaS", ticker_count: 7, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.432, avg_valuation_gap_pct: 13.7, avg_dislocation_score: 1.014, avg_opportunity_score: 0.014 },
  { industry_label: "AI Compute / Semis", ticker_count: 8, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.756, avg_valuation_gap_pct: -6.0, avg_dislocation_score: -0.694, avg_opportunity_score: -0.046 },
  { industry_label: "Data Platforms / Dev Tools", ticker_count: 7, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.626, avg_valuation_gap_pct: -5.3, avg_dislocation_score: 0.422, avg_opportunity_score: -0.185 },
  { industry_label: "FinTech / Payments", ticker_count: 6, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.559, avg_valuation_gap_pct: 87.5, avg_dislocation_score: 0.394, avg_opportunity_score: -0.438 },
  { industry_label: "IT Services", ticker_count: 6, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.469, avg_valuation_gap_pct: -2.1, avg_dislocation_score: 0.374, avg_opportunity_score: -0.805 },
];

const TICKERS: Ticker[] = [
  { ticker: "OKTA", price: 71.74, market_cap_b: 12.9, signal: "Long", ai_rationale: "Cybersecurity challenger with high switching costs, strong AI execution (+48% concrete), punished -44% on AI fear despite 97% valuation gap.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 2.25, management_ai_execution_score: 1.59, fundamental_score: 0.33, valuation_score: 1.50, valuation_gap_pct: 97.0, dislocation_score: 2.39, ai_positioning_score: 0.26, risk_penalty: -0.19, revenue_growth_yoy: 0.153, revenue_cagr_2y: 0.185, operating_margin: -0.028, operating_margin_change_2y: 0.40, fcf_yield: 0.070, free_cash_flow_b: 0.895, ai_news_intensity: 0.403, ai_exec_concrete_ratio: 0.481, ai_fear_ratio: 0.327, ai_net_sentiment: -0.186, drawdown_252d: -0.436, return_63d: -0.110 },
  { ticker: "ROOT", price: 48.68, market_cap_b: 0.7, signal: "Long", ai_rationale: "InsurTech entrant with explosive 159% revenue growth, 486% valuation gap. AI narrative is absent from news -- the market isn't even pricing AI disruption potential.", ai_bucket: "Best Pick", industry_label: "Consumer Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 2, opportunity_score: 2.18, management_ai_execution_score: 0.84, fundamental_score: 2.07, valuation_score: 2.50, valuation_gap_pct: 486.3, dislocation_score: 0.97, ai_positioning_score: -0.88, risk_penalty: 0.86, revenue_growth_yoy: 1.586, revenue_cagr_2y: 0.946, operating_margin: 0.062, operating_margin_change_2y: 0.40, fcf_yield: 0.277, free_cash_flow_b: 0.206, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.726, return_63d: -0.379 },
  { ticker: "HUBS", price: 278.59, market_cap_b: 14.5, signal: "Long", ai_rationale: "CRM/ERP challenger with maximum dislocation score (3.0). Deep enterprise workflows with 118% valuation gap. Market treating as AI-disrupted but switching costs are fortress-level.", ai_bucket: "Best Pick", industry_label: "CRM/ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 3, opportunity_score: 1.65, management_ai_execution_score: 0.22, fundamental_score: 0.11, valuation_score: 1.83, valuation_gap_pct: 118.3, dislocation_score: 3.00, ai_positioning_score: 0.00, risk_penalty: 0.26, revenue_growth_yoy: 0.192, revenue_cagr_2y: 0.201, operating_margin: 0.002, operating_margin_change_2y: 0.095, fcf_yield: 0.049, free_cash_flow_b: 0.708, ai_news_intensity: 0.751, ai_exec_concrete_ratio: 0.376, ai_fear_ratio: 0.446, ai_net_sentiment: -0.352, drawdown_252d: -0.601, return_63d: -0.254 },
  { ticker: "NVDA", price: 183.04, market_cap_b: 4375.2, signal: "Long", ai_rationale: "AI compute incumbent with 62% operating margin expansion. Despite being the AI leader, only -12% drawdown. Slightly overvalued on P/S but unmatched execution.", ai_bucket: "Best Pick", industry_label: "AI Compute / Semis", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 4, opportunity_score: 1.50, management_ai_execution_score: 0.82, fundamental_score: 1.99, valuation_score: -0.69, valuation_gap_pct: -47.0, dislocation_score: -0.51, ai_positioning_score: 0.75, risk_penalty: -0.46, revenue_growth_yoy: 1.142, revenue_cagr_2y: 1.200, operating_margin: 0.624, operating_margin_change_2y: 0.40, fcf_yield: 0.018, free_cash_flow_b: 77.3, ai_news_intensity: 0.819, ai_exec_concrete_ratio: 0.113, ai_fear_ratio: 0.069, ai_net_sentiment: 0.096, drawdown_252d: -0.116, return_63d: 0.017 },
  { ticker: "ADBE", price: 273.12, market_cap_b: 111.2, signal: "Long", ai_rationale: "CRM/ERP incumbent with 128% valuation gap and deep creative tool moat. AI fear ratio at 34% but operating margins at 37%. Market punishing despite proven execution.", ai_bucket: "Best Pick", industry_label: "CRM/ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 5, opportunity_score: 1.49, management_ai_execution_score: -0.65, fundamental_score: 0.38, valuation_score: 1.97, valuation_gap_pct: 128.0, dislocation_score: 2.45, ai_positioning_score: 0.25, risk_penalty: 0.05, revenue_growth_yoy: 0.105, revenue_cagr_2y: 0.107, operating_margin: 0.366, operating_margin_change_2y: 0.024, fcf_yield: 0.089, free_cash_flow_b: 9.9, ai_news_intensity: 0.703, ai_exec_concrete_ratio: 0.427, ai_fear_ratio: 0.341, ai_net_sentiment: -0.241, drawdown_252d: -0.395, return_63d: -0.154 },
  { ticker: "CRM", price: 193.08, market_cap_b: 183.7, signal: "Long", ai_rationale: "Salesforce: 129% valuation gap, 20% operating margin, $14B FCF. Enterprise CRM lock-in is extreme. AI fear at 28% but concrete execution at 30%.", ai_bucket: "Best Pick", industry_label: "CRM/ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 6, opportunity_score: 1.48, management_ai_execution_score: 0.11, fundamental_score: -0.07, valuation_score: 1.99, valuation_gap_pct: 129.1, dislocation_score: 1.84, ai_positioning_score: 0.31, risk_penalty: -0.14, revenue_growth_yoy: 0.096, revenue_cagr_2y: 0.091, operating_margin: 0.201, operating_margin_change_2y: 0.057, fcf_yield: 0.078, free_cash_flow_b: 14.4, ai_news_intensity: 0.885, ai_exec_concrete_ratio: 0.297, ai_fear_ratio: 0.277, ai_net_sentiment: -0.192, drawdown_252d: -0.339, return_63d: -0.171 },
  { ticker: "INTU", price: 440.14, market_cap_b: 120.6, signal: "Long", ai_rationale: "Tax/accounting data moat with maximum dislocation (3.0). 51% valuation gap, 26% operating margin. AI fear at 59% is extreme -- market most confused here.", ai_bucket: "Best Pick", industry_label: "CRM/ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 7, opportunity_score: 1.27, management_ai_execution_score: 0.46, fundamental_score: 0.14, valuation_score: 0.80, valuation_gap_pct: 50.6, dislocation_score: 3.00, ai_positioning_score: 0.15, risk_penalty: 0.14, revenue_growth_yoy: 0.156, revenue_cagr_2y: 0.145, operating_margin: 0.261, operating_margin_change_2y: 0.043, fcf_yield: 0.057, free_cash_flow_b: 6.9, ai_news_intensity: 0.736, ai_exec_concrete_ratio: 0.380, ai_fear_ratio: 0.586, ai_net_sentiment: -0.474, drawdown_252d: -0.455, return_63d: -0.303 },
  { ticker: "SMCI", price: 32.65, market_cap_b: 18.4, signal: "Long", ai_rationale: "AI compute entrant with 291% valuation gap and 76% revenue CAGR. Server/infrastructure play for AI buildout. Governance risk is real but priced in at -46%.", ai_bucket: "Best Pick", industry_label: "AI Compute / Semis", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "entrant", rank: 8, opportunity_score: 1.10, management_ai_execution_score: 0.01, fundamental_score: 0.29, valuation_score: 2.50, valuation_gap_pct: 291.5, dislocation_score: 0.44, ai_positioning_score: 0.52, risk_penalty: 1.65, revenue_growth_yoy: 0.466, revenue_cagr_2y: 0.756, operating_margin: 0.057, operating_margin_change_2y: -0.050, fcf_yield: 0.024, free_cash_flow_b: 0.440, ai_news_intensity: 0.847, ai_exec_concrete_ratio: 0.107, ai_fear_ratio: 0.076, ai_net_sentiment: 0.104, drawdown_252d: -0.462, return_63d: -0.023 },
  { ticker: "HIG", price: 142.17, market_cap_b: 38.9, signal: "Long", ai_rationale: "Hartford Insurance: 100% concrete AI execution ratio (highest in universe). 65% valuation gap, only -1% drawdown. Market hasn't punished it yet -- early mover advantage.", ai_bucket: "Best Pick", industry_label: "Consumer Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 9, opportunity_score: 1.05, management_ai_execution_score: 1.39, fundamental_score: 0.19, valuation_score: 1.02, valuation_gap_pct: 65.3, dislocation_score: -1.34, ai_positioning_score: -0.13, risk_penalty: -0.61, revenue_growth_yoy: 0.069, revenue_cagr_2y: 0.075, operating_margin: 0.175, operating_margin_change_2y: 0.041, fcf_yield: 0.148, free_cash_flow_b: 5.8, ai_news_intensity: 1.000, ai_exec_concrete_ratio: 1.000, ai_fear_ratio: 0.0, ai_net_sentiment: 1.000, drawdown_252d: -0.009, return_63d: 0.049 },
  { ticker: "AMZN", price: 216.82, market_cap_b: 2240.7, signal: "Long", ai_rationale: "Cloud hyperscaler with 156% valuation gap. AWS + AI infrastructure moat. Highest switching costs in universe (0.976). Negative FCF from capex buildout.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 10, opportunity_score: 1.03, management_ai_execution_score: -0.60, fundamental_score: -0.39, valuation_score: 2.40, valuation_gap_pct: 156.1, dislocation_score: -0.16, ai_positioning_score: 1.00, risk_penalty: -0.53, revenue_growth_yoy: 0.124, revenue_cagr_2y: 0.117, operating_margin: 0.118, operating_margin_change_2y: 0.053, fcf_yield: -0.001, free_cash_flow_b: -2.9, ai_news_intensity: 0.709, ai_exec_concrete_ratio: 0.101, ai_fear_ratio: 0.090, ai_net_sentiment: 0.034, drawdown_252d: -0.146, return_63d: -0.073 },
  { ticker: "META", price: 667.73, market_cap_b: 1657.1, signal: "Long", ai_rationale: "Cloud hyperscaler with 59% valuation gap. 41% operating margin, $46B FCF. AI positioning is strong but market fairly pricing the AI narrative.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 0.92, management_ai_execution_score: -0.13, fundamental_score: 0.54, valuation_score: 0.92, valuation_gap_pct: 58.6, dislocation_score: -0.67, ai_positioning_score: 1.12, risk_penalty: -0.26, revenue_growth_yoy: 0.222, revenue_cagr_2y: 0.221, operating_margin: 0.414, operating_margin_change_2y: 0.068, fcf_yield: 0.028, free_cash_flow_b: 46.1, ai_news_intensity: 0.851, ai_exec_concrete_ratio: 0.125, ai_fear_ratio: 0.040, ai_net_sentiment: 0.136, drawdown_252d: -0.155, return_63d: 0.042 },
  { ticker: "ESTC", price: 51.85, market_cap_b: 5.5, signal: "Long", ai_rationale: "Elastic: data platform challenger with 113% valuation gap. Strong AI execution (+36% concrete). Observability/search moat in AI infrastructure stack.", ai_bucket: "Best Pick", industry_label: "Data Platforms / Dev Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 12, opportunity_score: 0.77, management_ai_execution_score: 0.81, fundamental_score: -0.19, valuation_score: 1.74, valuation_gap_pct: 112.7, dislocation_score: 0.35, ai_positioning_score: 0.62, risk_penalty: 0.89, revenue_growth_yoy: 0.170, revenue_cagr_2y: 0.178, operating_margin: -0.037, operating_margin_change_2y: 0.168, fcf_yield: 0.047, free_cash_flow_b: 0.257, ai_news_intensity: 0.712, ai_exec_concrete_ratio: 0.355, ai_fear_ratio: 0.0, ai_net_sentiment: 0.337, drawdown_252d: -0.527, return_63d: -0.271 },
  { ticker: "FI", price: 63.80, market_cap_b: null, signal: "Long", ai_rationale: "Fiserv: FinTech incumbent with highest management AI execution (+1.35). 44% concrete AI ratio, 29% operating margin improvement. Deep payments infrastructure.", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 13, opportunity_score: 0.77, management_ai_execution_score: 1.35, fundamental_score: 0.82, valuation_score: 0.0, valuation_gap_pct: null, dislocation_score: 1.16, ai_positioning_score: -0.09, risk_penalty: 0.36, revenue_growth_yoy: 0.071, revenue_cagr_2y: 4.505, operating_margin: 0.287, operating_margin_change_2y: 0.40, fcf_yield: null, free_cash_flow_b: null, ai_news_intensity: 0.128, ai_exec_concrete_ratio: 0.442, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.732, return_63d: -0.518 },
  { ticker: "GTLB", price: 25.05, market_cap_b: 4.5, signal: "Long", ai_rationale: "GitLab: 99% valuation gap, DevOps platform with AI code generation integration. Balanced dynamics but high switching costs keep incumbents safe.", ai_bucket: "Best Pick", industry_label: "Data Platforms / Dev Tools", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "challenger", rank: 14, opportunity_score: 0.76, management_ai_execution_score: -0.24, fundamental_score: 0.54, valuation_score: 1.53, valuation_gap_pct: 98.8, dislocation_score: 0.68, ai_positioning_score: 0.42, risk_penalty: 0.33, revenue_growth_yoy: 0.309, revenue_cagr_2y: 0.338, operating_margin: -0.188, operating_margin_change_2y: 0.310, fcf_yield: 0.054, free_cash_flow_b: 0.242, ai_news_intensity: 0.893, ai_exec_concrete_ratio: 0.118, ai_fear_ratio: 0.0, ai_net_sentiment: 0.207, drawdown_252d: -0.601, return_63d: -0.391 },
  { ticker: "PLTR", price: 153.19, market_cap_b: 352.1, signal: "Long", ai_rationale: "Palantir: pure AI/data play with 32% operating margin expansion. Overvalued on P/S (-91% gap) but strongest AI positioning score. Growth monster.", ai_bucket: "Best Pick", industry_label: "Data Platforms / Dev Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 15, opportunity_score: 0.70, management_ai_execution_score: 0.62, fundamental_score: 1.28, valuation_score: -0.99, valuation_gap_pct: -90.8, dislocation_score: 0.30, ai_positioning_score: 0.22, risk_penalty: -0.10, revenue_growth_yoy: 0.562, revenue_cagr_2y: 0.418, operating_margin: 0.316, operating_margin_change_2y: 0.262, fcf_yield: 0.006, free_cash_flow_b: 2.1, ai_news_intensity: 0.879, ai_exec_concrete_ratio: 0.241, ai_fear_ratio: 0.113, ai_net_sentiment: 0.021, drawdown_252d: -0.261, return_63d: -0.085 },
  // --- Shorts ---
  { ticker: "LMND", price: 54.77, market_cap_b: 4.0, signal: "Short", ai_rationale: "Lemonade: InsurTech with -33% operating margin despite AI claims. Concrete execution (+43%) but no margin follow-through. Burning cash.", ai_bucket: "Worst Pick", industry_label: "Consumer Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 46, opportunity_score: -0.70, management_ai_execution_score: 1.11, fundamental_score: -0.08, valuation_score: -0.55, valuation_gap_pct: -38.0, dislocation_score: 0.55, ai_positioning_score: -0.81, risk_penalty: 0.99, revenue_growth_yoy: 0.216, revenue_cagr_2y: 0.408, operating_margin: -0.327, operating_margin_change_2y: 0.40, fcf_yield: -0.008, free_cash_flow_b: -0.033, ai_news_intensity: 0.680, ai_exec_concrete_ratio: 0.435, ai_fear_ratio: 0.058, ai_net_sentiment: 0.029, drawdown_252d: -0.433, return_63d: -0.272 },
  { ticker: "ACN", price: 210.00, market_cap_b: 129.2, signal: "Short", ai_rationale: "Accenture: IT services incumbent in entrant-favored industry. Low switching costs, AI threatens core consulting model. -8% valuation gap.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 47, opportunity_score: -0.74, management_ai_execution_score: -0.002, fundamental_score: -0.48, valuation_score: -0.10, valuation_gap_pct: -8.1, dislocation_score: 0.41, ai_positioning_score: -0.52, risk_penalty: -0.15, revenue_growth_yoy: 0.074, revenue_cagr_2y: 0.042, operating_margin: 0.147, operating_margin_change_2y: 0.009, fcf_yield: 0.089, free_cash_flow_b: 11.5, ai_news_intensity: 0.653, ai_exec_concrete_ratio: 0.348, ai_fear_ratio: 0.066, ai_net_sentiment: 0.023, drawdown_252d: -0.397, return_63d: -0.184 },
  { ticker: "SNOW", price: 168.26, market_cap_b: 56.7, signal: "Short", ai_rationale: "Snowflake: -40% operating margin, overvalued by 46%. High AI narrative intensity (73%) but concrete execution ratio is modest. Cash burn continues.", ai_bucket: "Worst Pick", industry_label: "Data Platforms / Dev Tools", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "challenger", rank: 52, opportunity_score: -1.18, management_ai_execution_score: -0.16, fundamental_score: -0.52, valuation_score: -0.68, valuation_gap_pct: -46.3, dislocation_score: 1.30, ai_positioning_score: 0.14, risk_penalty: 1.52, revenue_growth_yoy: 0.292, revenue_cagr_2y: 0.325, operating_margin: -0.402, operating_margin_change_2y: 0.006, fcf_yield: 0.014, free_cash_flow_b: 0.777, ai_news_intensity: 0.735, ai_exec_concrete_ratio: 0.415, ai_fear_ratio: 0.160, ai_net_sentiment: -0.016, drawdown_252d: -0.393, return_63d: -0.332 },
  { ticker: "NET", price: 185.89, market_cap_b: 63.0, signal: "Short", ai_rationale: "Cloudflare: highest dislocation score (2.48) but -10% operating margin and -68% valuation gap. The market fear is CORRECT here -- overvalued despite the drawdown.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 56, opportunity_score: -1.34, management_ai_execution_score: -0.50, fundamental_score: -0.39, valuation_score: -0.99, valuation_gap_pct: -67.7, dislocation_score: 2.48, ai_positioning_score: 0.08, risk_penalty: 2.68, revenue_growth_yoy: 0.298, revenue_cagr_2y: 0.293, operating_margin: -0.096, operating_margin_change_2y: 0.047, fcf_yield: 0.005, free_cash_flow_b: 0.287, ai_news_intensity: 0.624, ai_exec_concrete_ratio: 0.034, ai_fear_ratio: 0.404, ai_net_sentiment: -0.314, drawdown_252d: -0.266, return_63d: -0.057 },
  { ticker: "ORCL", price: 152.37, market_cap_b: 428.3, signal: "Short", ai_rationale: "Oracle: CRM/ERP incumbent but -54% drawdown, 31% valuation gap is tiny for the risk. Highest risk penalty (4.0) in universe from extreme debt and discount behavior.", ai_bucket: "Worst Pick", industry_label: "CRM/ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 59, opportunity_score: -1.53, management_ai_execution_score: -0.68, fundamental_score: -0.35, valuation_score: 0.50, valuation_gap_pct: 30.9, dislocation_score: 0.80, ai_positioning_score: 0.60, risk_penalty: 4.01, revenue_growth_yoy: 0.084, revenue_cagr_2y: 0.072, operating_margin: 0.308, operating_margin_change_2y: 0.046, fcf_yield: -0.031, free_cash_flow_b: -13.2, ai_news_intensity: 0.866, ai_exec_concrete_ratio: 0.213, ai_fear_ratio: 0.062, ai_net_sentiment: 0.019, drawdown_252d: -0.536, return_63d: -0.242 },
  { ticker: "IBM", price: 250.06, market_cap_b: 230.1, signal: "Short", ai_rationale: "IBM: IT services incumbent in most AI-threatened industry. Low switching costs, entrant-favored dynamics. Despite 39% concrete AI ratio, no margin inflection.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 60, opportunity_score: -1.72, management_ai_execution_score: 0.09, fundamental_score: -0.61, valuation_score: -0.38, valuation_gap_pct: -26.5, dislocation_score: -0.02, ai_positioning_score: -0.55, risk_penalty: 1.79, revenue_growth_yoy: 0.076, revenue_cagr_2y: 0.045, operating_margin: 0.182, operating_margin_change_2y: 0.015, fcf_yield: 0.053, free_cash_flow_b: 12.1, ai_news_intensity: 0.617, ai_exec_concrete_ratio: 0.387, ai_fear_ratio: 0.071, ai_net_sentiment: -0.006, drawdown_252d: -0.206, return_63d: -0.182 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number, invert = false): string {
  const s = invert ? -score : score;
  if (s >= 1.5) return "text-emerald-400";
  if (s >= 0.5) return "text-green-400";
  if (s >= 0) return "text-gray-400";
  if (s >= -0.5) return "text-orange-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 1.5) return "bg-emerald-500/20";
  if (score >= 0.5) return "bg-green-500/15";
  if (score >= 0) return "bg-gray-500/10";
  if (score >= -0.5) return "bg-orange-500/15";
  return "bg-red-500/20";
}

function pct(v: number | null, decimals = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return `${(v * 100).toFixed(decimals)}%`;
}

function pctRaw(v: number | null, decimals = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return `${v.toFixed(decimals)}%`;
}

function fmt(v: number | null, decimals = 2): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return v.toFixed(decimals);
}

function mcap(v: number | null): string {
  if (v === null || v === undefined) return "--";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}T`;
  if (v >= 1) return `$${v.toFixed(1)}B`;
  return `$${(v * 1000).toFixed(0)}M`;
}

type SortKey = "rank" | "opportunity_score" | "dislocation_score" | "valuation_gap_pct" | "management_ai_execution_score" | "fundamental_score" | "drawdown_252d";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  initialUser?: { name?: string | null; email?: string | null };
}

type Tab = "opportunities" | "industries" | "dislocations" | "methodology";

export default function AIResearchContent({ initialUser }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("opportunities");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterSignal, setFilterSignal] = useState<"all" | "Long" | "Short">("all");

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(key === "rank");
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    let items = [...TICKERS];
    if (filterSignal !== "all") items = items.filter((t) => t.signal === filterSignal);
    items.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [sortKey, sortAsc, filterSignal]);

  const longs = useMemo(() => TICKERS.filter((t) => t.signal === "Long"), []);
  const shorts = useMemo(() => TICKERS.filter((t) => t.signal === "Short"), []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "opportunities", label: "Opportunities" },
    { key: "industries", label: "Industry Map" },
    { key: "dislocations", label: "AI Fear & Dislocation" },
    { key: "methodology", label: "Methodology" },
  ];

  return (
    <div>
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10 mb-3">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                AI Disruption Research
                <span className="text-xs font-normal bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                  Research
                </span>
              </h1>
              <p className="text-xs text-gray-500">
                Saaspocalypse rotation scan &middot; {UNIVERSE_SIZE} tickers &middot; {INDUSTRIES.length} industries &middot; as-of {SCAN_DATE}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              Dashboard
            </Link>
            <UserMenu variant="dark" initialUser={initialUser} />
          </div>
        </div>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3 px-1">
        <SummaryCard label="Best Opportunity" value="OKTA" sub="+2.25" color="text-emerald-400" />
        <SummaryCard label="Biggest Dislocation" value="HUBS / INTU" sub="3.0" color="text-orange-400" />
        <SummaryCard label="Best AI Execution" value="HIG" sub="100% concrete" color="text-blue-400" />
        <SummaryCard label="Top Industry" value="CRM/ERP" sub="avg +0.77" color="text-green-400" />
        <SummaryCard label="Most Overvalued" value="PLTR" sub="-91% gap" color="text-red-400" />
        <SummaryCard label="Worst Industry" value="IT Services" sub="avg -0.81" color="text-red-400" />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800 mb-3 px-1">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-1">
        {activeTab === "opportunities" && (
          <OpportunitiesTab
            tickers={filtered}
            longs={longs}
            shorts={shorts}
            sortKey={sortKey}
            sortAsc={sortAsc}
            filterSignal={filterSignal}
            onSort={handleSort}
            onFilterChange={setFilterSignal}
          />
        )}
        {activeTab === "industries" && <IndustryTab industries={INDUSTRIES} />}
        {activeTab === "dislocations" && <DislocationTab tickers={TICKERS} />}
        {activeTab === "methodology" && <MethodologyTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opportunities Tab
// ---------------------------------------------------------------------------

function SortHeader({ label, sortKey: key, currentKey, asc, onSort, className = "" }: {
  label: string; sortKey: SortKey; currentKey: SortKey; asc: boolean; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = currentKey === key;
  return (
    <th
      className={`px-2 py-1.5 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-300 select-none whitespace-nowrap ${className}`}
      onClick={() => onSort(key)}
    >
      {label}
      {active && <span className="ml-0.5 text-blue-400">{asc ? "\u25B2" : "\u25BC"}</span>}
    </th>
  );
}

function OpportunitiesTab({ tickers, longs, shorts, sortKey, sortAsc, filterSignal, onSort, onFilterChange }: {
  tickers: Ticker[]; longs: Ticker[]; shorts: Ticker[]; sortKey: SortKey; sortAsc: boolean;
  filterSignal: "all" | "Long" | "Short"; onSort: (k: SortKey) => void; onFilterChange: (v: "all" | "Long" | "Short") => void;
}) {
  return (
    <div className="space-y-3">
      {/* Thesis */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Core Thesis: &quot;Winners the Market Thinks Are Losers&quot;</h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          The Saaspocalypse narrative has punished enterprise SaaS stocks indiscriminately. But switching costs vary dramatically across industries.
          CRM/ERP platforms with deep enterprise integration (HUBS, ADBE, CRM, INTU) have been hit as hard as genuinely vulnerable horizontal SaaS (TEAM, MNDY, ZM).
          This scan identifies stocks where AI-fear repricing has created a gap between the market&apos;s perception and the company&apos;s actual competitive moat.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Show:</span>
        {(["all", "Long", "Short"] as const).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              filterSignal === f
                ? f === "Long" ? "bg-green-500/20 text-green-400" : f === "Short" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f === "all" ? `All (${longs.length + shorts.length})` : f === "Long" ? `Longs (${longs.length})` : `Shorts (${shorts.length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <SortHeader label="#" sortKey="rank" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right w-8" />
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-left">Ticker</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-left">Industry</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-left">Role</th>
              <SortHeader label="Opp Score" sortKey="opportunity_score" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <SortHeader label="Val Gap" sortKey="valuation_gap_pct" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <SortHeader label="Dislocation" sortKey="dislocation_score" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <SortHeader label="Mgmt AI" sortKey="management_ai_execution_score" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <SortHeader label="Fundmtl" sortKey="fundamental_score" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <SortHeader label="Drawdown" sortKey="drawdown_252d" currentKey={sortKey} asc={sortAsc} onSort={onSort} className="text-right" />
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Mkt Cap</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((t) => (
              <tr key={t.ticker} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-2 py-1.5 text-right text-xs text-gray-600">{t.rank}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold ${
                      t.signal === "Long" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {t.ticker}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-400">{t.industry_label}</td>
                <td className="px-2 py-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    t.role === "incumbent" ? "bg-blue-500/15 text-blue-400" :
                    t.role === "challenger" ? "bg-purple-500/15 text-purple-400" :
                    "bg-amber-500/15 text-amber-400"
                  }`}>
                    {t.role}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`font-mono font-bold text-sm ${scoreColor(t.opportunity_score)} ${scoreBg(t.opportunity_score)} px-1.5 py-0.5 rounded`}>
                    {t.opportunity_score > 0 ? "+" : ""}{fmt(t.opportunity_score)}
                  </span>
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${t.valuation_gap_pct !== null && t.valuation_gap_pct > 0 ? "text-green-400" : "text-red-400"}`}>
                  {pctRaw(t.valuation_gap_pct, 0)}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(t.dislocation_score)}`}>
                  {fmt(t.dislocation_score)}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(t.management_ai_execution_score)}`}>
                  {fmt(t.management_ai_execution_score)}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(t.fundamental_score)}`}>
                  {fmt(t.fundamental_score)}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${t.drawdown_252d !== null && t.drawdown_252d < -0.3 ? "text-red-400" : t.drawdown_252d !== null && t.drawdown_252d < -0.1 ? "text-orange-400" : "text-gray-400"}`}>
                  {pct(t.drawdown_252d, 0)}
                </td>
                <td className="px-2 py-1.5 text-right text-xs text-gray-500">{mcap(t.market_cap_b)}</td>
                <td className="px-2 py-1.5 text-right text-xs text-gray-400 font-mono">${t.price?.toFixed(2) ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rationale cards */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Signal Rationale</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tickers.slice(0, 10).map((t) => (
            <div key={t.ticker} className={`border rounded-lg p-3 ${
              t.signal === "Long" ? "border-green-800/50 bg-green-950/20" : "border-red-800/50 bg-red-950/20"
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-mono font-bold text-sm ${t.signal === "Long" ? "text-green-400" : "text-red-400"}`}>
                  {t.ticker}
                </span>
                <span className="text-[10px] text-gray-500">{t.industry_label}</span>
                <span className={`text-[10px] ml-auto font-mono ${scoreColor(t.opportunity_score)}`}>
                  {t.opportunity_score > 0 ? "+" : ""}{fmt(t.opportunity_score)}
                </span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{t.ai_rationale}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Industry Tab
// ---------------------------------------------------------------------------

function IndustryTab({ industries }: { industries: Industry[] }) {
  const sorted = useMemo(() => [...industries].sort((a, b) => b.avg_opportunity_score - a.avg_opportunity_score), [industries]);

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">The Saaspocalypse Split</h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          Industries with <span className="text-blue-400 font-medium">high switching costs</span> (CRM/ERP, Cloud, Cybersecurity) are being punished
          as if they&apos;re as vulnerable as <span className="text-orange-400 font-medium">low switching cost</span> horizontal SaaS.
          The key insight: where switching costs are high and dynamics favor incumbents, the market is overreacting.
          Where switching costs are low and dynamics favor entrants, the Saaspocalypse is real.
        </p>
      </div>

      {/* Industry grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {sorted.map((ind) => {
          const isPositive = ind.avg_opportunity_score > 0;
          return (
            <div
              key={ind.industry_label}
              className={`border rounded-lg p-3 ${
                isPositive ? "border-green-800/40 bg-green-950/10" : "border-red-800/40 bg-red-950/10"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-200">{ind.industry_label}</h4>
                <span className={`text-xs font-mono font-bold ${scoreColor(ind.avg_opportunity_score)} ${scoreBg(ind.avg_opportunity_score)} px-1.5 py-0.5 rounded`}>
                  {ind.avg_opportunity_score > 0 ? "+" : ""}{ind.avg_opportunity_score.toFixed(2)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-gray-500">Switching costs</div>
                <div className={`text-right font-medium ${ind.switching_class === "high" ? "text-blue-400" : "text-orange-400"}`}>
                  {ind.switching_class}
                </div>
                <div className="text-gray-500">Dynamics favor</div>
                <div className={`text-right font-medium ${
                  ind.favored_side === "incumbent" ? "text-blue-400" : ind.favored_side === "entrant" ? "text-amber-400" : "text-gray-400"
                }`}>
                  {ind.favored_side}
                </div>
                <div className="text-gray-500">Tickers</div>
                <div className="text-right text-gray-300">{ind.ticker_count}</div>
                <div className="text-gray-500">Avg val gap</div>
                <div className={`text-right font-mono ${ind.avg_valuation_gap_pct > 0 ? "text-green-400" : "text-red-400"}`}>
                  {ind.avg_valuation_gap_pct.toFixed(0)}%
                </div>
                <div className="text-gray-500">Avg dislocation</div>
                <div className={`text-right font-mono ${scoreColor(ind.avg_dislocation_score)}`}>
                  {ind.avg_dislocation_score.toFixed(2)}
                </div>
                <div className="text-gray-500">Switching score</div>
                <div className="text-right font-mono text-gray-300">{ind.avg_switching_cost_score.toFixed(2)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Industry comparison table */}
      <div className="overflow-x-auto mt-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Industry Comparison</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-left">Industry</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-center">Tickers</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-center">Switching</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-center">Favors</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Avg Opp</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Avg Val Gap</th>
              <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Avg Dislocation</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ind) => (
              <tr key={ind.industry_label} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-2 py-1.5 text-xs text-gray-300 font-medium">{ind.industry_label}</td>
                <td className="px-2 py-1.5 text-xs text-gray-400 text-center">{ind.ticker_count}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    ind.switching_class === "high" ? "bg-blue-500/15 text-blue-400" : "bg-orange-500/15 text-orange-400"
                  }`}>
                    {ind.switching_class}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    ind.favored_side === "incumbent" ? "bg-blue-500/15 text-blue-400" :
                    ind.favored_side === "entrant" ? "bg-amber-500/15 text-amber-400" :
                    "bg-gray-500/15 text-gray-400"
                  }`}>
                    {ind.favored_side}
                  </span>
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(ind.avg_opportunity_score)}`}>
                  {ind.avg_opportunity_score > 0 ? "+" : ""}{ind.avg_opportunity_score.toFixed(2)}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${ind.avg_valuation_gap_pct > 0 ? "text-green-400" : "text-red-400"}`}>
                  {ind.avg_valuation_gap_pct.toFixed(0)}%
                </td>
                <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(ind.avg_dislocation_score)}`}>
                  {ind.avg_dislocation_score.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dislocation Tab
// ---------------------------------------------------------------------------

function DislocationTab({ tickers }: { tickers: Ticker[] }) {
  const byDislocation = useMemo(() =>
    [...tickers].sort((a, b) => b.dislocation_score - a.dislocation_score),
    [tickers]
  );

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">AI Fear Repricing</h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          Dislocation score = 45% drawdown severity + 35% AI fear ratio in news + 20% recent momentum.
          High dislocation with high switching costs = potential opportunity. High dislocation with low switching costs = the market may be right.
        </p>
      </div>

      {/* Scatter-style cards: dislocation vs opportunity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* High dislocation + positive opportunity = "Market is wrong" */}
        <div className="border border-emerald-800/40 rounded-lg p-3 bg-emerald-950/10">
          <h4 className="text-xs font-semibold text-emerald-400 mb-2 uppercase tracking-wider">
            Market Overreaction (High Dislocation + Positive Opportunity)
          </h4>
          <div className="space-y-1.5">
            {byDislocation
              .filter((t) => t.dislocation_score > 0.5 && t.opportunity_score > 0)
              .map((t) => (
                <DislocationRow key={t.ticker} ticker={t} />
              ))}
          </div>
        </div>

        {/* High dislocation + negative opportunity = "Market is right" */}
        <div className="border border-red-800/40 rounded-lg p-3 bg-red-950/10">
          <h4 className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wider">
            Justified Fear (High Dislocation + Negative Opportunity)
          </h4>
          <div className="space-y-1.5">
            {byDislocation
              .filter((t) => t.dislocation_score > 0.5 && t.opportunity_score <= 0)
              .map((t) => (
                <DislocationRow key={t.ticker} ticker={t} />
              ))}
          </div>
        </div>
      </div>

      {/* AI Sentiment Analysis */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">AI News Sentiment Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-left">Ticker</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">AI Intensity</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Fear Ratio</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Concrete Exec</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Net Sentiment</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Drawdown</th>
                <th className="px-2 py-1.5 text-xs font-medium text-gray-500 text-right">Opp Score</th>
              </tr>
            </thead>
            <tbody>
              {byDislocation.map((t) => (
                <tr key={t.ticker} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-2 py-1.5">
                    <span className={`font-mono font-bold text-xs ${t.signal === "Long" ? "text-green-400" : "text-red-400"}`}>
                      {t.ticker}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-gray-400">{pct(t.ai_news_intensity, 0)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${(t.ai_fear_ratio ?? 0) > 0.3 ? "text-red-400" : (t.ai_fear_ratio ?? 0) > 0.1 ? "text-orange-400" : "text-gray-400"}`}>
                    {pct(t.ai_fear_ratio, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${(t.ai_exec_concrete_ratio ?? 0) > 0.3 ? "text-green-400" : "text-gray-400"}`}>
                    {pct(t.ai_exec_concrete_ratio, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${scoreColor(t.ai_net_sentiment ?? 0)}`}>
                    {fmt(t.ai_net_sentiment)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${(t.drawdown_252d ?? 0) < -0.3 ? "text-red-400" : "text-orange-400"}`}>
                    {pct(t.drawdown_252d, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs font-bold ${scoreColor(t.opportunity_score)}`}>
                    {t.opportunity_score > 0 ? "+" : ""}{fmt(t.opportunity_score)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DislocationRow({ ticker: t }: { ticker: Ticker }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded bg-gray-900/50">
      <div className="flex items-center gap-2">
        <span className={`font-mono font-bold text-xs ${t.signal === "Long" ? "text-green-400" : "text-red-400"}`}>
          {t.ticker}
        </span>
        <span className="text-[10px] text-gray-500">{t.industry_label}</span>
      </div>
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="text-gray-500">disl:</span>
        <span className={scoreColor(t.dislocation_score)}>{fmt(t.dislocation_score)}</span>
        <span className="text-gray-500">fear:</span>
        <span className={`${(t.ai_fear_ratio ?? 0) > 0.3 ? "text-red-400" : "text-gray-400"}`}>{pct(t.ai_fear_ratio, 0)}</span>
        <span className="text-gray-500">dd:</span>
        <span className="text-red-400">{pct(t.drawdown_252d, 0)}</span>
        <span className={`${t.switching_cost_class === "high" ? "text-blue-400" : "text-orange-400"}`}>
          {t.switching_cost_class}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Methodology Tab
// ---------------------------------------------------------------------------

function MethodologyTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Opportunity Score Composition</h3>
        <div className="space-y-2">
          {[
            { weight: "27%", name: "Fundamental Score", desc: "Revenue growth, margins, FCF quality, ROE. Insurance uses underwriting-specific weights." },
            { weight: "22%", name: "Valuation Score", desc: "Linear regression predicts log(P/S) from 6 fundamentals. Gap = (Expected - Actual) / Actual." },
            { weight: "20%", name: "Management AI Execution", desc: "Concrete AI actions (launched, deployed, automation) + margin/FCF follow-through. Penalizes hype and discounting." },
            { weight: "16%", name: "AI Positioning Score", desc: "Switching costs strength + incumbent/entrant advantage delta + AI sentiment + industry AI tailwind." },
            { weight: "12%", name: "Dislocation Score", desc: "45% drawdown severity + 35% AI fear ratio in news + 20% weak recent returns." },
            { weight: "8%", name: "Technical Rebound", desc: "21-day return + distance to 200-day SMA." },
            { weight: "-15%", name: "Risk Penalty", desc: "Volatility, negative margins, debt/equity, discount burn, execution miss." },
          ].map((item) => (
            <div key={item.name} className="flex items-start gap-3">
              <span className={`text-xs font-mono font-bold w-12 text-right flex-shrink-0 ${
                item.weight.startsWith("-") ? "text-red-400" : "text-blue-400"
              }`}>
                {item.weight}
              </span>
              <div>
                <span className="text-xs font-medium text-gray-200">{item.name}</span>
                <p className="text-[11px] text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Industry Classification Priors</h3>
        <p className="text-xs text-gray-400 mb-3">
          Each industry has hand-coded structural priors that influence the switching cost score and industry dynamics.
          These are based on integration depth, data advantage, regulation burden, and disruption susceptibility.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-2 py-1 text-gray-500 text-left">Industry</th>
                <th className="px-2 py-1 text-gray-500 text-right">Switching</th>
                <th className="px-2 py-1 text-gray-500 text-right">Integration</th>
                <th className="px-2 py-1 text-gray-500 text-right">Data Moat</th>
                <th className="px-2 py-1 text-gray-500 text-right">Regulation</th>
                <th className="px-2 py-1 text-gray-500 text-right">AI Tailwind</th>
                <th className="px-2 py-1 text-gray-500 text-right">Disruption Risk</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Cloud Hyperscalers", sw: 0.86, int: 0.95, data: 0.95, reg: 0.52, ai: 0.90, disr: 0.22 },
                { name: "CRM/ERP Platforms", sw: 0.85, int: 0.90, data: 0.85, reg: 0.50, ai: 0.70, disr: 0.30 },
                { name: "Cybersecurity", sw: 0.82, int: 0.88, data: 0.80, reg: 0.72, ai: 0.78, disr: 0.38 },
                { name: "AI Compute / Semis", sw: 0.70, int: 0.66, data: 0.72, reg: 0.35, ai: 0.95, disr: 0.30 },
                { name: "Data Platforms", sw: 0.62, int: 0.68, data: 0.74, reg: 0.30, ai: 0.85, disr: 0.55 },
                { name: "FinTech / Payments", sw: 0.52, int: 0.62, data: 0.65, reg: 0.58, ai: 0.67, disr: 0.62 },
                { name: "Horizontal SaaS", sw: 0.45, int: 0.50, data: 0.55, reg: 0.25, ai: 0.60, disr: 0.75 },
                { name: "IT Services", sw: 0.42, int: 0.48, data: 0.40, reg: 0.35, ai: 0.55, disr: 0.70 },
                { name: "Consumer Insurance", sw: 0.30, int: 0.35, data: 0.50, reg: 0.55, ai: 0.70, disr: 0.80 },
              ].map((row) => (
                <tr key={row.name} className="border-b border-gray-800/50">
                  <td className="px-2 py-1 text-gray-300">{row.name}</td>
                  <td className={`px-2 py-1 text-right font-mono ${row.sw >= 0.7 ? "text-blue-400" : row.sw >= 0.5 ? "text-gray-300" : "text-orange-400"}`}>{row.sw.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono text-gray-400">{row.int.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono text-gray-400">{row.data.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono text-gray-400">{row.reg.toFixed(2)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${row.ai >= 0.8 ? "text-green-400" : "text-gray-400"}`}>{row.ai.toFixed(2)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${row.disr >= 0.7 ? "text-red-400" : row.disr >= 0.5 ? "text-orange-400" : "text-gray-400"}`}>{row.disr.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">AI News Sentiment (Term-Weighted NLP)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <h4 className="font-medium text-gray-300 mb-1">Fear Terms (bearish signal)</h4>
            <p className="text-gray-500">saaspocalypse, commoditization, price war, pricing pressure, churn, disruption, layoff, margin pressure, open-source pressure, demand slowdown</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-300 mb-1">Concrete Execution (bullish signal)</h4>
            <p className="text-gray-500">launched, rolled out, deployment, integrated, customer win, contract, production, GA, automation, claims automation, seat expansion, renewal rate</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-300 mb-1">Hype Terms (penalized)</h4>
            <p className="text-gray-500">revolutionary, game-changing, massive opportunity, transformative, paradigm shift, next big thing, moonshot, category defining</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-300 mb-1">Data Sources</h4>
            <p className="text-gray-500">Polygon news API with recency-weighted exponential decay (90-day half-life). Financials from latest annual income statement + ratios. 252-day price history.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
