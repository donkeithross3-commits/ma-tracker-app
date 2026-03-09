"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import { UserMenu } from "@/components/UserMenu";
import { TICKER_DETAILS } from "./ticker-details";
import { TickerDetailPanel } from "./TickerDetailPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ticker {
  ticker: string;
  price: number | null;
  market_cap_b: number | null;
  signal: "Long" | "Short";
  ai_rationale: string;
  ai_narrative: string;
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
// Static Data (from ai_disruption_scan_20260308)
// ---------------------------------------------------------------------------

const SCAN_DATE = "2026-03-08";
const UNIVERSE_SIZE = 59;

const INDUSTRIES: Industry[] = [
  { industry_label: "Digital Advertising / Social", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.85, avg_valuation_gap_pct: 43.8, avg_dislocation_score: -0.7, avg_opportunity_score: 1.03 },
  { industry_label: "DevOps & Developer Tools", ticker_count: 3, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.67, avg_valuation_gap_pct: 70.5, avg_dislocation_score: 1.52, avg_opportunity_score: 0.94 },
  { industry_label: "Creative & Document Software", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.81, avg_valuation_gap_pct: 14.3, avg_dislocation_score: 1.43, avg_opportunity_score: 0.62 },
  { industry_label: "CRM / ERP Platforms", ticker_count: 5, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 28.6, avg_dislocation_score: 1.1, avg_opportunity_score: 0.55 },
  { industry_label: "Cloud Hyperscalers", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 39.5, avg_dislocation_score: -0.36, avg_opportunity_score: 0.38 },
  { industry_label: "Personal Auto Insurance", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.25, avg_valuation_gap_pct: -0.0, avg_dislocation_score: -0.12, avg_opportunity_score: 0.16 },
  { industry_label: "AI Compute / Semiconductors", ticker_count: 6, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.78, avg_valuation_gap_pct: 0.8, avg_dislocation_score: -0.87, avg_opportunity_score: 0.02 },
  { industry_label: "Government & Defense Analytics", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 1.0, avg_valuation_gap_pct: -75.9, avg_dislocation_score: 0.1, avg_opportunity_score: 0.0 },
  { industry_label: "Cybersecurity Platforms", ticker_count: 8, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.92, avg_valuation_gap_pct: 5.3, avg_dislocation_score: 0.41, avg_opportunity_score: -0.05 },
  { industry_label: "Data Center Networking", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.88, avg_valuation_gap_pct: -3.8, avg_dislocation_score: -0.99, avg_opportunity_score: -0.1 },
  { industry_label: "Commercial / Specialty Insurance", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.63, avg_valuation_gap_pct: -0.0, avg_dislocation_score: -1.24, avg_opportunity_score: -0.14 },
  { industry_label: "Tax & Accounting Software", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: -29.7, avg_dislocation_score: 1.74, avg_opportunity_score: -0.18 },
  { industry_label: "FinTech / Payments", ticker_count: 6, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.56, avg_valuation_gap_pct: -2.6, avg_dislocation_score: 0.36, avg_opportunity_score: -0.2 },
  { industry_label: "AI Infrastructure / Servers", ticker_count: 1, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.34, avg_valuation_gap_pct: -0.6, avg_dislocation_score: 0.32, avg_opportunity_score: -0.4 },
  { industry_label: "Horizontal SaaS / Collaboration", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.49, avg_valuation_gap_pct: -17.2, avg_dislocation_score: 0.5, avg_opportunity_score: -0.44 },
  { industry_label: "Data Platforms", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.76, avg_valuation_gap_pct: 18.5, avg_dislocation_score: 0.28, avg_opportunity_score: -0.58 },
  { industry_label: "IT Services", ticker_count: 6, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.47, avg_valuation_gap_pct: 11.8, avg_dislocation_score: 0.22, avg_opportunity_score: -0.71 },
];

const TICKERS: Ticker[] = [
  { ticker: "GTLB", price: null, market_cap_b: 4.1948, signal: "Long", ai_rationale: "Best Pick: DevOps & Developer Tools challenger; dynamics favor entrant; opp +1.47, mgmt +0.59, val gap 136.6%, op margin -19%, FCF 6%, 6mo -42%, concrete AI 36%, discount AI 11%.", ai_narrative: "GTLB appears undervalued — the model estimates it trades 137% below fair value based on its growth and margin profile relative to DevOps & Developer Tools peers. The stock is down 42% over 3 months, creating a potential entry point if the market's fear proves overblown. The main risk is competitive positioning — dynamics in DevOps & Developer Tools may not favor the challenger.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "entrant", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 1.474, management_ai_execution_score: 0.5865, fundamental_score: 0.5556, valuation_score: 2.5, valuation_gap_pct: 136.6, dislocation_score: 2.1366, ai_positioning_score: -1.2591, risk_penalty: 0.5892, revenue_growth_yoy: 0.309262, revenue_cagr_2y: 0.337634, operating_margin: -0.187969, operating_margin_change_2y: 0.310247, fcf_yield: 0.057764, free_cash_flow_b: 0.24231, ai_news_intensity: 0.910964, ai_exec_concrete_ratio: 0.359621, ai_fear_ratio: 0.274103, ai_net_sentiment: -0.274103, drawdown_252d: -0.589416, return_63d: -0.415033 },
  { ticker: "HUBS", price: null, market_cap_b: 15.6407, signal: "Long", ai_rationale: "Best Pick: CRM / ERP Platforms challenger; dynamics favor incumbent; opp +1.24, mgmt +0.17, val gap 38.6%, op margin 0%, FCF 5%, 6mo -22%, concrete AI 40%, discount AI 0%.", ai_narrative: "HUBS has been sold off sharply (down 58% from highs) despite fundamentals that don't justify that level of pessimism. It also trades 39% below its model-estimated fair value. The main risk is competitive positioning — dynamics in CRM / ERP Platforms may not favor the challenger.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 2, opportunity_score: 1.2398, management_ai_execution_score: 0.1685, fundamental_score: 0.1426, valuation_score: 1.6512, valuation_gap_pct: 38.6, dislocation_score: 2.0681, ai_positioning_score: -0.9171, risk_penalty: 0.213, revenue_growth_yoy: 0.191709, revenue_cagr_2y: 0.201177, operating_margin: 0.002357, operating_margin_change_2y: 0.094941, fcf_yield: 0.045238, free_cash_flow_b: 0.707552, ai_news_intensity: 0.751455, ai_exec_concrete_ratio: 0.396545, ai_fear_ratio: 0.445595, ai_net_sentiment: -0.445595, drawdown_252d: -0.582619, return_63d: -0.219249 },
  { ticker: "SAP", price: null, market_cap_b: 235.5412, signal: "Long", ai_rationale: "Best Pick: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +1.22, mgmt +0.04, val gap 54.9%, op margin 28%, FCF 2%, 6mo -17%, concrete AI 60%, discount AI 0%.", ai_narrative: "SAP appears undervalued — the model estimates it trades 55% below fair value based on its growth and margin profile relative to CRM / ERP Platforms peers. The stock is down 17% over 3 months, creating a potential entry point if the market's fear proves overblown.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 3, opportunity_score: 1.2201, management_ai_execution_score: 0.0408, fundamental_score: 0.1808, valuation_score: 2.3453, valuation_gap_pct: 54.9, dislocation_score: 0.3323, ai_positioning_score: 0.1056, risk_penalty: -0.2759, revenue_growth_yoy: 0.19, revenue_cagr_2y: 0.12, operating_margin: 0.283, operating_margin_change_2y: null, fcf_yield: 0.025, free_cash_flow_b: null, ai_news_intensity: 0.7579, ai_exec_concrete_ratio: 0.603663, ai_fear_ratio: 0.087962, ai_net_sentiment: -0.087962, drawdown_252d: -0.360498, return_63d: -0.174748 },
  { ticker: "TEAM", price: null, market_cap_b: 22.0543, signal: "Long", ai_rationale: "Best Pick: DevOps & Developer Tools incumbent; dynamics favor incumbent; opp +1.14, mgmt +0.28, val gap 57.2%, op margin -3%, FCF 6%, 6mo -46%, concrete AI 51%, discount AI 0%.", ai_narrative: "TEAM appears undervalued — the model estimates it trades 57% below fair value based on its growth and margin profile relative to DevOps & Developer Tools peers. The stock is down 46% over 3 months, creating a potential entry point if the market's fear proves overblown. The main risk is competitive positioning — dynamics in DevOps & Developer Tools may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 4, opportunity_score: 1.1372, management_ai_execution_score: 0.2766, fundamental_score: 0.0117, valuation_score: 2.4452, valuation_gap_pct: 57.2, dislocation_score: 2.4111, ai_positioning_score: -1.0233, risk_penalty: 0.9361, revenue_growth_yoy: 0.196554, revenue_cagr_2y: 0.214694, operating_margin: -0.025002, operating_margin_change_2y: 0.072666, fcf_yield: 0.058118, free_cash_flow_b: 1.281752, ai_news_intensity: 0.594158, ai_exec_concrete_ratio: 0.505939, ai_fear_ratio: 0.262882, ai_net_sentiment: -0.262882, drawdown_252d: -0.701839, return_63d: -0.463907 },
  { ticker: "AMZN", price: null, market_cap_b: 2288.7925, signal: "Long", ai_rationale: "Best Pick: Cloud Hyperscalers incumbent; dynamics favor incumbent; opp +1.08, mgmt +0.07, val gap 135.9%, op margin 11%, FCF 0%, 6mo -7%, concrete AI 14%, discount AI 5%.", ai_narrative: "AMZN appears undervalued — the model estimates it trades 136% below fair value based on its growth and margin profile relative to Cloud Hyperscalers peers. The AI positioning signal also supports the bullish case. The fundamentals signal is a headwind.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 5, opportunity_score: 1.0766, management_ai_execution_score: 0.0689, fundamental_score: -0.3825, valuation_score: 2.5, valuation_gap_pct: 135.9, dislocation_score: -0.3676, ai_positioning_score: 0.6612, risk_penalty: -0.6625, revenue_growth_yoy: 0.123778, revenue_cagr_2y: 0.116822, operating_margin: 0.1116, operating_margin_change_2y: 0.052575, fcf_yield: 0.003364, free_cash_flow_b: 7.7, ai_news_intensity: 0.710093, ai_exec_concrete_ratio: 0.141215, ai_fear_ratio: 0.082497, ai_net_sentiment: -0.023775, drawdown_252d: -0.138031, return_63d: -0.066035 },
  { ticker: "META", price: null, market_cap_b: 1631.2091, signal: "Long", ai_rationale: "Best Pick: Digital Advertising / Social incumbent; dynamics favor incumbent; opp +1.03, mgmt +0.11, val gap 43.8%, op margin 41%, FCF 3%, 6mo 2%, concrete AI 16%, discount AI 3%.", ai_narrative: "META appears undervalued — the model estimates it trades 44% below fair value based on its growth and margin profile relative to Digital Advertising / Social peers. Revenue is growing at 22% annually, reinforcing the thesis. The dislocation signal is a headwind.", ai_bucket: "Best Pick", industry_label: "Digital Advertising / Social", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 6, opportunity_score: 1.0323, management_ai_execution_score: 0.1093, fundamental_score: 0.6748, valuation_score: 1.8715, valuation_gap_pct: 43.8, dislocation_score: -0.6958, ai_positioning_score: 0.536, risk_penalty: -0.3943, revenue_growth_yoy: 0.22167, revenue_cagr_2y: 0.22054, operating_margin: 0.414379, operating_margin_change_2y: 0.067823, fcf_yield: 0.026729, free_cash_flow_b: 43.6, ai_news_intensity: 0.866356, ai_exec_concrete_ratio: 0.163236, ai_fear_ratio: 0.027223, ai_net_sentiment: 0.0307, drawdown_252d: -0.163835, return_63d: 0.020816 },
  { ticker: "DOCU", price: null, market_cap_b: 9.7513, signal: "Long", ai_rationale: "Best Pick: Creative & Document Software incumbent; dynamics favor incumbent; opp +1.03, mgmt +0.39, val gap 29.0%, op margin 7%, FCF 10%, 6mo -30%, concrete AI 33%, discount AI 0%.", ai_narrative: "DOCU has been sold off sharply (down 49% from highs) despite fundamentals that don't justify that level of pessimism. It also trades 29% below its model-estimated fair value. The main risk is competitive positioning — dynamics in Creative & Document Software may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 7, opportunity_score: 1.0284, management_ai_execution_score: 0.3932, fundamental_score: 0.0619, valuation_score: 1.2395, valuation_gap_pct: 29.0, dislocation_score: 1.4763, ai_positioning_score: -0.7061, risk_penalty: -0.2224, revenue_growth_yoy: 0.077794, revenue_cagr_2y: 0.087733, operating_margin: 0.067163, operating_margin_change_2y: 0.102153, fcf_yield: 0.101313, free_cash_flow_b: 0.987933, ai_news_intensity: 0.717433, ai_exec_concrete_ratio: 0.33011, ai_fear_ratio: 0.221829, ai_net_sentiment: -0.221829, drawdown_252d: -0.48604, return_63d: -0.299593 },
  { ticker: "CYBR", price: null, market_cap_b: null, signal: "Long", ai_rationale: "Best Pick: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +1.01, mgmt +0.37, val gap 106.5%, op margin -6%, FCF 1%, 6mo -19%, concrete AI 57%, discount AI 0%.", ai_narrative: "CYBR appears undervalued — the model estimates it trades 106% below fair value based on its growth and margin profile relative to Cybersecurity Platforms peers. The AI positioning signal also supports the bullish case. The dislocation signal is a headwind.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 8, opportunity_score: 1.006, management_ai_execution_score: 0.3701, fundamental_score: 0.2344, valuation_score: 2.5, valuation_gap_pct: 106.5, dislocation_score: -0.4493, ai_positioning_score: 0.4033, risk_penalty: 0.3894, revenue_growth_yoy: 0.43, revenue_cagr_2y: 0.46, operating_margin: -0.059, operating_margin_change_2y: null, fcf_yield: 0.012, free_cash_flow_b: null, ai_news_intensity: 0.364015, ai_exec_concrete_ratio: 0.569104, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.216792, return_63d: -0.18858 },
  { ticker: "ESTC", price: null, market_cap_b: 5.5959, signal: "Long", ai_rationale: "Best Pick: Data Platforms incumbent; dynamics favor incumbent; opp +0.91, mgmt +0.58, val gap 129.4%, op margin -4%, FCF 5%, 6mo -27%, concrete AI 67%, discount AI 0%.", ai_narrative: "ESTC appears undervalued — the model estimates it trades 129% below fair value based on its growth and margin profile relative to Data Platforms peers. Management backs this up with concrete AI execution — 67% of coverage describes real deployments.", ai_bucket: "Best Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 9, opportunity_score: 0.906, management_ai_execution_score: 0.5799, fundamental_score: -0.1938, valuation_score: 2.5, valuation_gap_pct: 129.4, dislocation_score: 0.3708, ai_positioning_score: 0.1496, risk_penalty: 0.8445, revenue_growth_yoy: 0.170419, revenue_cagr_2y: 0.177951, operating_margin: -0.037027, operating_margin_change_2y: 0.168, fcf_yield: 0.0459, free_cash_flow_b: 0.256849, ai_news_intensity: 0.558618, ai_exec_concrete_ratio: 0.667938, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.516373, return_63d: -0.266261 },
  { ticker: "SOFI", price: null, market_cap_b: 24.1025, signal: "Long", ai_rationale: "Best Pick: FinTech / Payments challenger; dynamics favor entrant; opp +0.85, mgmt +0.73, val gap 18.9%, op margin 15%, FCF 2%, 6mo -35%, concrete AI 24%, discount AI 0%.", ai_narrative: "SOFI stands out on fundamentals — 53% revenue growth with 15% operating margins in FinTech / Payments. It also trades 19% below its model-estimated fair value. The main risk is competitive positioning — dynamics in FinTech / Payments may not favor the challenger.", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 10, opportunity_score: 0.8495, management_ai_execution_score: 0.7315, fundamental_score: 1.189, valuation_score: 0.8097, valuation_gap_pct: 18.9, dislocation_score: 0.1954, ai_positioning_score: -0.6381, risk_penalty: -0.0498, revenue_growth_yoy: 0.531099, revenue_cagr_2y: 0.240453, operating_margin: 0.147, operating_margin_change_2y: 0.4, fcf_yield: 0.016596, free_cash_flow_b: 0.4, ai_news_intensity: 0.195798, ai_exec_concrete_ratio: 0.236471, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.40236, return_63d: -0.347679 },
  { ticker: "CRM", price: null, market_cap_b: 186.5475, signal: "Long", ai_rationale: "Best Pick: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +0.8, mgmt +0.16, val gap 25.1%, op margin 20%, FCF 8%, 6mo -14%, concrete AI 33%, discount AI 1%.", ai_narrative: "CRM has been sold off sharply (down 31% from highs) despite fundamentals that don't justify that level of pessimism. It also trades 25% below its model-estimated fair value. The main risk is competitive positioning — dynamics in CRM / ERP Platforms may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 0.8024, management_ai_execution_score: 0.1625, fundamental_score: 0.0077, valuation_score: 1.0729, valuation_gap_pct: 25.1, dislocation_score: 1.0849, ai_positioning_score: -0.4302, risk_penalty: -0.2374, revenue_growth_yoy: 0.095791, revenue_cagr_2y: 0.091465, operating_margin: 0.200626, operating_margin_change_2y: 0.056867, fcf_yield: 0.077203, free_cash_flow_b: 14.402, ai_news_intensity: 0.88947, ai_exec_concrete_ratio: 0.3307, ai_fear_ratio: 0.266254, ai_net_sentiment: -0.229235, drawdown_252d: -0.310237, return_63d: -0.141962 },
  { ticker: "OKTA", price: null, market_cap_b: 14.306, signal: "Long", ai_rationale: "Best Pick: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +0.74, mgmt +0.6, val gap 12.8%, op margin 5%, FCF 6%, 6mo -3%, concrete AI 40%, discount AI 0%.", ai_narrative: "OKTA has been sold off sharply (down 37% from highs) despite fundamentals that don't justify that level of pessimism. Management backs this up with concrete AI execution — 40% of coverage describes real deployments. The main risk is competitive positioning — dynamics in Cybersecurity Platforms may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 12, opportunity_score: 0.7363, management_ai_execution_score: 0.5997, fundamental_score: 0.1996, valuation_score: 0.5458, valuation_gap_pct: 12.8, dislocation_score: 1.0633, ai_positioning_score: -0.5703, risk_penalty: -0.1788, revenue_growth_yoy: 0.118391, revenue_cagr_2y: 0.135729, operating_margin: 0.051045, operating_margin_change_2y: 0.279061, fcf_yield: 0.060324, free_cash_flow_b: 0.863, ai_news_intensity: 0.459768, ai_exec_concrete_ratio: 0.404939, ai_fear_ratio: 0.259429, ai_net_sentiment: -0.259429, drawdown_252d: -0.374313, return_63d: -0.027116 },
  { ticker: "FTNT", price: null, market_cap_b: 61.9094, signal: "Long", ai_rationale: "Best Pick: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +0.72, mgmt +0.17, val gap 35.1%, op margin 31%, FCF 4%, 6mo 2%, concrete AI 55%, discount AI 0%.", ai_narrative: "FTNT appears undervalued — the model estimates it trades 35% below fair value based on its growth and margin profile relative to Cybersecurity Platforms peers. Revenue is growing at 14% annually, reinforcing the thesis.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 13, opportunity_score: 0.7192, management_ai_execution_score: 0.1712, fundamental_score: 0.2683, valuation_score: 1.5025, valuation_gap_pct: 35.1, dislocation_score: -0.1542, ai_positioning_score: 0.0363, risk_penalty: 0.1974, revenue_growth_yoy: 0.141677, revenue_cagr_2y: 0.132158, operating_margin: 0.305062, operating_margin_change_2y: 0.071971, fcf_yield: 0.035953, free_cash_flow_b: 2.2258, ai_news_intensity: 0.429317, ai_exec_concrete_ratio: 0.553046, ai_fear_ratio: 0.104063, ai_net_sentiment: -0.104063, drawdown_252d: -0.223296, return_63d: 0.017844 },
  { ticker: "CTSH", price: null, market_cap_b: 31.6886, signal: "Long", ai_rationale: "Best Pick: IT Services incumbent; dynamics favor entrant; opp +0.71, mgmt +0.41, val gap 112.8%, op margin 16%, FCF 8%, 6mo -15%, concrete AI 48%, discount AI 0%.", ai_narrative: "CTSH appears undervalued — the model estimates it trades 113% below fair value based on its growth and margin profile relative to IT Services peers. Management backs this up with concrete AI execution — 48% of coverage describes real deployments. The main risk is competitive positioning — dynamics in IT Services may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 14, opportunity_score: 0.7124, management_ai_execution_score: 0.4102, fundamental_score: -0.4593, valuation_score: 2.5, valuation_gap_pct: 112.8, dislocation_score: -0.4336, ai_positioning_score: -0.7375, risk_penalty: -0.5063, revenue_growth_yoy: 0.069518, revenue_cagr_2y: 0.044358, operating_margin: 0.157618, operating_margin_change_2y: 0.018673, fcf_yield: 0.081891, free_cash_flow_b: 2.595, ai_news_intensity: 0.609329, ai_exec_concrete_ratio: 0.484968, ai_fear_ratio: 0.0, ai_net_sentiment: 0.086369, drawdown_252d: -0.241292, return_63d: -0.153302 },
  { ticker: "NOW", price: null, market_cap_b: 130.0596, signal: "Long", ai_rationale: "Best Pick: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +0.68, mgmt -0.29, val gap 19.1%, op margin 14%, FCF 4%, 6mo -27%, concrete AI 34%, discount AI 4%.", ai_narrative: "NOW has been sold off sharply (down 42% from highs) despite fundamentals that don't justify that level of pessimism. It also trades 19% below its model-estimated fair value. The main risk is competitive positioning — dynamics in CRM / ERP Platforms may not favor the incumbent.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 15, opportunity_score: 0.6794, management_ai_execution_score: -0.2897, fundamental_score: 0.2052, valuation_score: 0.8178, valuation_gap_pct: 19.1, dislocation_score: 1.3687, ai_positioning_score: -0.3741, risk_penalty: -0.1096, revenue_growth_yoy: 0.208849, revenue_cagr_2y: 0.216595, operating_margin: 0.13737, operating_margin_change_2y: 0.05243, fcf_yield: 0.035184, free_cash_flow_b: 4.576, ai_news_intensity: 0.798497, ai_exec_concrete_ratio: 0.342068, ai_fear_ratio: 0.2373, ai_net_sentiment: -0.212296, drawdown_252d: -0.423848, return_63d: -0.269876 },
  // --- Shorts ---
  { ticker: "NET", price: null, market_cap_b: 68.703, signal: "Short", ai_rationale: "Worst Pick: Cybersecurity Platforms challenger; dynamics favor incumbent; opp -1.64, mgmt -0.14, val gap -55.8%, op margin -10%, FCF 0%, 6mo -4%, concrete AI 20%, discount AI 0%.", ai_narrative: "NET appears overvalued — the model estimates it trades 56% above fair value relative to its Cybersecurity Platforms peers. The AI positioning signal reinforces the bearish case. The stock has already sold off meaningfully, so further downside from current levels is less certain. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 45, opportunity_score: -1.6434, management_ai_execution_score: -0.1376, fundamental_score: -0.4556, valuation_score: -1.7419, valuation_gap_pct: -55.8, dislocation_score: 0.8743, ai_positioning_score: -0.8093, risk_penalty: 2.6546, revenue_growth_yoy: 0.298457, revenue_cagr_2y: 0.292993, operating_margin: -0.095577, operating_margin_change_2y: 0.047462, fcf_yield: 0.004185, free_cash_flow_b: 0.287497, ai_news_intensity: 0.624087, ai_exec_concrete_ratio: 0.204245, ai_fear_ratio: 0.281355, ai_net_sentiment: -0.281355, drawdown_252d: -0.240782, return_63d: -0.04447 },
  { ticker: "IBM", price: null, market_cap_b: 242.8102, signal: "Short", ai_rationale: "Worst Pick: IT Services incumbent; dynamics favor entrant; opp -1.48, mgmt -0.02, val gap -6.5%, op margin 15%, FCF 6%, 6mo -15%, concrete AI 48%, discount AI 0%.", ai_narrative: "IBM is poorly positioned for AI-driven disruption in IT Services, with low switching costs and dynamics favoring the entrant. The fundamentals signal reinforces the bearish case. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 46, opportunity_score: -1.4777, management_ai_execution_score: -0.0181, fundamental_score: -0.7765, valuation_score: -0.2768, valuation_gap_pct: -6.5, dislocation_score: -0.2807, ai_positioning_score: -1.142, risk_penalty: 1.5902, revenue_growth_yoy: 0.014, revenue_cagr_2y: 0.044863, operating_margin: 0.15, operating_margin_change_2y: 0.01514, fcf_yield: 0.060541, free_cash_flow_b: 14.7, ai_news_intensity: 0.636165, ai_exec_concrete_ratio: 0.477457, ai_fear_ratio: 0.056921, ai_net_sentiment: -0.056921, drawdown_252d: -0.185504, return_63d: -0.149877 },
  { ticker: "CFLT", price: null, market_cap_b: 11.0047, signal: "Short", ai_rationale: "Worst Pick: Data Platforms challenger; dynamics favor incumbent; opp -1.36, mgmt +0.21, val gap -13.3%, op margin -33%, FCF 1%, 6mo 34%, concrete AI 0%, discount AI 0%.", ai_narrative: "CFLT ranks as a bottom-tier pick in Data Platforms based on a combination of overvaluation, weak positioning, and execution concerns. The stock trades 13% above its model-estimated fair value. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 47, opportunity_score: -1.3614, management_ai_execution_score: 0.2104, fundamental_score: -0.3518, valuation_score: -0.5689, valuation_gap_pct: -13.3, dislocation_score: -1.513, ai_positioning_score: -0.0005, risk_penalty: 1.8625, revenue_growth_yoy: 0.210769, revenue_cagr_2y: 0.225438, operating_margin: -0.325779, operating_margin_change_2y: 0.290441, fcf_yield: 0.005514, free_cash_flow_b: 0.060677, ai_news_intensity: 0.432491, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.043789, return_63d: 0.335212 },
  { ticker: "ORCL", price: null, market_cap_b: 439.621, signal: "Short", ai_rationale: "Worst Pick: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp -1.2, mgmt -0.53, val gap 5.4%, op margin 31%, FCF -0%, 6mo -23%, concrete AI 22%, discount AI 3%.", ai_narrative: "ORCL's AI narrative lacks substance — high talk-to-execution ratio with limited evidence of concrete deployment or margin improvement. The stock has already sold off meaningfully, so further downside from current levels is less certain. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 48, opportunity_score: -1.1959, management_ai_execution_score: -0.535, fundamental_score: -0.2764, valuation_score: 0.2316, valuation_gap_pct: 5.4, dislocation_score: 0.6636, ai_positioning_score: 0.2793, risk_penalty: 3.7174, revenue_growth_yoy: 0.083798, revenue_cagr_2y: 0.071931, operating_margin: 0.307984, operating_margin_change_2y: 0.045883, fcf_yield: -0.00091, free_cash_flow_b: -0.4, ai_news_intensity: 0.849612, ai_exec_concrete_ratio: 0.218719, ai_fear_ratio: 0.059983, ai_net_sentiment: -0.04366, drawdown_252d: -0.528554, return_63d: -0.230283 },
  { ticker: "SNOW", price: null, market_cap_b: 61.7603, signal: "Short", ai_rationale: "Worst Pick: Data Platforms incumbent; dynamics favor incumbent; opp -1.15, mgmt +0.13, val gap -14.8%, op margin -40%, FCF 1%, 6mo -32%, concrete AI 34%, discount AI 3%.", ai_narrative: "SNOW appears overvalued — the model estimates it trades 15% above fair value relative to its Data Platforms peers. Operating margins remain negative at 40%, suggesting the business hasn't proven it can generate sustainable profits. The stock has already sold off meaningfully, so further downside from current levels is less certain. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 49, opportunity_score: -1.1498, management_ai_execution_score: 0.1302, fundamental_score: -0.6119, valuation_score: -0.6331, valuation_gap_pct: -14.8, dislocation_score: 0.7711, ai_positioning_score: -0.3895, risk_penalty: 2.5279, revenue_growth_yoy: 0.292147, revenue_cagr_2y: 0.324977, operating_margin: -0.401503, operating_margin_change_2y: 0.006244, fcf_yield: 0.012576, free_cash_flow_b: 0.776677, ai_news_intensity: 0.723816, ai_exec_concrete_ratio: 0.339312, ai_fear_ratio: 0.139808, ai_net_sentiment: -0.139808, drawdown_252d: -0.35971, return_63d: -0.316659 },
  { ticker: "ZM", price: null, market_cap_b: 22.8367, signal: "Short", ai_rationale: "Worst Pick: Horizontal SaaS / Collaboration incumbent; dynamics favor entrant; opp -1.06, mgmt +0.35, val gap -39.8%, op margin 23%, FCF 8%, 6mo -9%, concrete AI 45%, discount AI 0%.", ai_narrative: "ZM appears overvalued — the model estimates it trades 40% above fair value relative to its Horizontal SaaS / Collaboration peers. The AI positioning signal reinforces the bearish case. However, management is showing real AI execution (45% concrete coverage), which could challenge the bearish thesis.", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 50, opportunity_score: -1.0554, management_ai_execution_score: 0.3467, fundamental_score: 0.1228, valuation_score: -1.7027, valuation_gap_pct: -39.8, dislocation_score: -0.6258, ai_positioning_score: -0.7729, risk_penalty: -0.3083, revenue_growth_yoy: 0.043584, revenue_cagr_2y: 0.037035, operating_margin: 0.230784, operating_margin_change_2y: 0.114757, fcf_yield: 0.084254, free_cash_flow_b: 1.924087, ai_news_intensity: 0.441798, ai_exec_concrete_ratio: 0.451907, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.196321, return_63d: -0.085501 },
  { ticker: "AFRM", price: null, market_cap_b: 17.2218, signal: "Short", ai_rationale: "Worst Pick: FinTech / Payments entrant; dynamics favor entrant; opp -1.04, mgmt +1.5, val gap -30.9%, op margin 3%, FCF 4%, 6mo -22%, concrete AI 51%, discount AI 0%.", ai_narrative: "AFRM appears overvalued — the model estimates it trades 31% above fair value relative to its FinTech / Payments peers. The AI positioning signal reinforces the bearish case. However, management is showing real AI execution (51% concrete coverage), which could challenge the bearish thesis. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 51, opportunity_score: -1.0358, management_ai_execution_score: 1.4993, fundamental_score: 0.3477, valuation_score: -1.3218, valuation_gap_pct: -30.9, dislocation_score: 0.1019, ai_positioning_score: -0.5601, risk_penalty: 2.7853, revenue_growth_yoy: 0.348614, revenue_cagr_2y: 0.33298, operating_margin: 0.032, operating_margin_change_2y: 0.4, fcf_yield: 0.03595, free_cash_flow_b: 0.619133, ai_news_intensity: 0.162365, ai_exec_concrete_ratio: 0.509332, ai_fear_ratio: 0.0, ai_net_sentiment: 0.360094, drawdown_252d: -0.430462, return_63d: -0.216652 },
  { ticker: "GLOB", price: null, market_cap_b: 7.0, signal: "Short", ai_rationale: "Worst Pick: IT Services challenger; dynamics favor entrant; opp -1.01, mgmt -0.66, val gap -1.5%, op margin 9%, FCF 2%, 6mo -18%, concrete AI 0%, discount AI 0%.", ai_narrative: "GLOB is poorly positioned for AI-driven disruption in IT Services, with low switching costs and dynamics favoring the entrant. The fundamentals signal reinforces the bearish case. The stock has already sold off meaningfully, so further downside from current levels is less certain.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 52, opportunity_score: -1.0138, management_ai_execution_score: -0.6597, fundamental_score: -0.8591, valuation_score: -0.0623, valuation_gap_pct: -1.5, dislocation_score: 0.5553, ai_positioning_score: -1.0697, risk_penalty: 0.3717, revenue_growth_yoy: 0.016222, revenue_cagr_2y: 0.082245, operating_margin: 0.086, operating_margin_change_2y: -0.024972, fcf_yield: 0.024286, free_cash_flow_b: 0.17, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.636736, return_63d: -0.179772 },
  { ticker: "WIT", price: null, market_cap_b: 24.3055, signal: "Short", ai_rationale: "Worst Pick: IT Services incumbent; dynamics favor entrant; opp -0.98, mgmt +0.04, val gap -15.8%, op margin 17%, FCF 4%, 6mo -19%, concrete AI 47%, discount AI 0%.", ai_narrative: "WIT is poorly positioned for AI-driven disruption in IT Services, with low switching costs and dynamics favoring the entrant. The fundamentals signal reinforces the bearish case.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 53, opportunity_score: -0.9837, management_ai_execution_score: 0.0372, fundamental_score: -0.6752, valuation_score: -0.6745, valuation_gap_pct: -15.8, dislocation_score: -0.1746, ai_positioning_score: -0.9559, risk_penalty: -0.2976, revenue_growth_yoy: -0.05, revenue_cagr_2y: -0.006, operating_margin: 0.168, operating_margin_change_2y: null, fcf_yield: 0.045, free_cash_flow_b: null, ai_news_intensity: 0.693639, ai_exec_concrete_ratio: 0.470345, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.331325, return_63d: -0.186813 },
  { ticker: "EPAM", price: null, market_cap_b: 7.8974, signal: "Short", ai_rationale: "Worst Pick: IT Services challenger; dynamics favor entrant; opp -0.96, mgmt -0.16, val gap -17.0%, op margin 10%, FCF 8%, 6mo -25%, concrete AI 35%, discount AI 0%.", ai_narrative: "EPAM is poorly positioned for AI-driven disruption in IT Services, with low switching costs and dynamics favoring the entrant. The stock trades 17% above its model-estimated fair value. The stock has already sold off meaningfully, so further downside from current levels is less certain.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 54, opportunity_score: -0.9639, management_ai_execution_score: -0.1606, fundamental_score: -0.49, valuation_score: -0.7275, valuation_gap_pct: -17.0, dislocation_score: 1.3632, ai_positioning_score: -2.1599, risk_penalty: 0.243, revenue_growth_yoy: 0.154214, revenue_cagr_2y: 0.078618, operating_margin: 0.09529, operating_margin_change_2y: -0.017098, fcf_yield: 0.077581, free_cash_flow_b: 0.612691, ai_news_intensity: 0.660496, ai_exec_concrete_ratio: 0.349838, ai_fear_ratio: 0.27705, ai_net_sentiment: -0.27705, drawdown_252d: -0.346974, return_63d: -0.250842 },
  { ticker: "CRWD", price: null, market_cap_b: 108.1477, signal: "Short", ai_rationale: "Worst Pick: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp -0.96, mgmt +0.12, val gap -49.0%, op margin -6%, FCF 1%, 6mo -17%, concrete AI 45%, discount AI 6%.", ai_narrative: "CRWD appears overvalued — the model estimates it trades 49% above fair value relative to its Cybersecurity Platforms peers. Operating margins remain negative at 6%, suggesting the business hasn't proven it can generate sustainable profits. The stock has already sold off meaningfully, so further downside from current levels is less certain.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 55, opportunity_score: -0.9564, management_ai_execution_score: 0.1171, fundamental_score: -0.2482, valuation_score: -1.7419, valuation_gap_pct: -49.0, dislocation_score: 0.415, ai_positioning_score: -0.0529, risk_penalty: 0.6496, revenue_growth_yoy: 0.217112, revenue_cagr_2y: 0.254926, operating_margin: -0.06095, operating_margin_change_2y: -0.054686, fcf_yield: 0.012115, free_cash_flow_b: 1.310241, ai_news_intensity: 0.792206, ai_exec_concrete_ratio: 0.452824, ai_fear_ratio: 0.162905, ai_net_sentiment: -0.118599, drawdown_252d: -0.235629, return_63d: -0.174988 },
  { ticker: "ASAN", price: null, market_cap_b: 1.8873, signal: "Short", ai_rationale: "Worst Pick: Horizontal SaaS / Collaboration challenger; dynamics favor entrant; opp -0.77, mgmt +0.44, val gap -13.8%, op margin -37%, FCF 3%, 6mo -41%, concrete AI 0%, discount AI 0%.", ai_narrative: "ASAN is poorly positioned for AI-driven disruption in Horizontal SaaS / Collaboration, with low switching costs and dynamics favoring the entrant. The stock trades 14% above its model-estimated fair value. The stock has already sold off meaningfully, so further downside from current levels is less certain. Risk is elevated (volatility and/or leverage), which penalizes the overall score.", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 56, opportunity_score: -0.7666, management_ai_execution_score: 0.4389, fundamental_score: -0.0762, valuation_score: -0.589, valuation_gap_pct: -13.8, dislocation_score: 0.7097, ai_positioning_score: -1.0185, risk_penalty: 1.1602, revenue_growth_yoy: 0.109382, revenue_cagr_2y: 0.150149, operating_margin: -0.368482, operating_margin_change_2y: 0.376798, fcf_yield: 0.034517, free_cash_flow_b: 0.065145, ai_news_intensity: 1.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.583684, return_63d: -0.409261 },
  { ticker: "MDB", price: null, market_cap_b: 22.014, signal: "Short", ai_rationale: "Worst Pick: Data Platforms incumbent; dynamics favor incumbent; opp -0.71, mgmt -0.17, val gap -27.4%, op margin -11%, FCF 2%, 6mo -34%, concrete AI 18%, discount AI 12%.", ai_narrative: "MDB appears overvalued — the model estimates it trades 27% above fair value relative to its Data Platforms peers. The AI positioning signal reinforces the bearish case. The stock has already sold off meaningfully, so further downside from current levels is less certain.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 57, opportunity_score: -0.7087, management_ai_execution_score: -0.1703, fundamental_score: -0.0359, valuation_score: -1.1721, valuation_gap_pct: -27.4, dislocation_score: 1.4817, ai_positioning_score: -0.7903, risk_penalty: 0.5658, revenue_growth_yoy: 0.192175, revenue_cagr_2y: 0.250041, operating_margin: -0.107685, operating_margin_change_2y: 0.162287, fcf_yield: 0.01573, free_cash_flow_b: 0.346277, ai_news_intensity: 0.580243, ai_exec_concrete_ratio: 0.179515, ai_fear_ratio: 0.252451, ai_net_sentiment: -0.252451, drawdown_252d: -0.400976, return_63d: -0.343441 },
  { ticker: "FIS", price: null, market_cap_b: 26.4866, signal: "Short", ai_rationale: "Worst Pick: FinTech / Payments incumbent; dynamics favor balanced; opp -0.69, mgmt +0.61, val gap -16.3%, op margin 16%, FCF 7%, 6mo -24%, concrete AI 100%, discount AI 0%.", ai_narrative: "FIS has the weakest fundamental profile in FinTech / Payments, with below-peer margins and growth that don't support its valuation. The stock trades 16% above its model-estimated fair value. However, management is showing real AI execution (100% concrete coverage), which could challenge the bearish thesis.", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "incumbent", rank: 58, opportunity_score: -0.6948, management_ai_execution_score: 0.6072, fundamental_score: -0.7446, valuation_score: -0.6948, valuation_gap_pct: -16.3, dislocation_score: 0.0261, ai_positioning_score: -0.4493, risk_penalty: 0.273, revenue_growth_yoy: 0.05431, revenue_cagr_2y: 0.042139, operating_margin: 0.163061, operating_margin_change_2y: 0.015873, fcf_yield: 0.068978, free_cash_flow_b: 1.827, ai_news_intensity: 0.279422, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.385792, return_63d: -0.242814 },
  { ticker: "AMAT", price: null, market_cap_b: 257.7169, signal: "Short", ai_rationale: "Worst Pick: AI Compute / Semiconductors incumbent; dynamics favor incumbent; opp -0.53, mgmt -0.49, val gap 0.4%, op margin 29%, FCF 2%, 6mo 31%, concrete AI 14%, discount AI 0%.", ai_narrative: "AMAT ranks as a bottom-tier pick in AI Compute / Semiconductors based on a combination of overvaluation, weak positioning, and execution concerns. The management execution signal reinforces the bearish case.", ai_bucket: "Worst Pick", industry_label: "AI Compute / Semiconductors", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 59, opportunity_score: -0.533, management_ai_execution_score: -0.4917, fundamental_score: -0.3418, valuation_score: 0.017, valuation_gap_pct: 0.4, dislocation_score: -0.953, ai_positioning_score: 0.1433, risk_penalty: 0.0336, revenue_growth_yoy: 0.043862, revenue_cagr_2y: 0.034313, operating_margin: 0.292195, operating_margin_change_2y: 0.00355, fcf_yield: 0.024034, free_cash_flow_b: 6.194, ai_news_intensity: 0.636173, ai_exec_concrete_ratio: 0.142454, ai_fear_ratio: 0.065014, ai_net_sentiment: -0.065014, drawdown_252d: -0.122598, return_63d: 0.306034 },
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
        <SummaryCard label="Best Opportunity" value="GTLB" sub="+1.96" color="text-emerald-400" />
        <SummaryCard label="Biggest Dislocation" value="TEAM / HUBS" sub="3.0 / 2.9" color="text-orange-400" />
        <SummaryCard label="Best AI Execution" value="AFRM" sub="+1.50 mgmt" color="text-blue-400" />
        <SummaryCard label="Top Industry" value="Gov & Defense" sub="avg +1.86" color="text-green-400" />
        <SummaryCard label="Most Overvalued" value="NET" sub="-58% gap" color="text-red-400" />
        <SummaryCard label="Worst Industry" value="IT Services" sub="avg -0.71" color="text-red-400" />
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
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const toggleExpand = useCallback((ticker: string) => {
    setExpandedTicker((prev) => (prev === ticker ? null : ticker));
  }, []);

  return (
    <div className="space-y-3">
      {/* Thesis */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Core Thesis: &quot;Winners the Market Thinks Are Losers&quot;</h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          The Saaspocalypse narrative has punished enterprise SaaS stocks indiscriminately. But switching costs vary dramatically across industries.
          CRM/ERP platforms with deep enterprise integration (HUBS, CRM, NOW) have been hit as hard as genuinely vulnerable horizontal SaaS (ZM, CFLT).
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
            {tickers.map((t) => {
              const isExpanded = expandedTicker === t.ticker;
              const detail = TICKER_DETAILS[t.ticker];
              return (
                <Fragment key={t.ticker}>
                  <tr
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer select-none ${
                      isExpanded ? "bg-gray-800/50" : ""
                    }`}
                    onClick={() => toggleExpand(t.ticker)}
                  >
                    <td className="px-2 py-1.5 text-right text-xs text-gray-600">{t.rank}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-500 w-2.5">{isExpanded ? "\u25BE" : "\u25B8"}</span>
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
                  {isExpanded && detail && (
                    <TickerDetailPanel ticker={t.ticker} detail={detail} colSpan={12} narrative={t.ai_narrative} />
                  )}
                </Fragment>
              );
            })}
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
            { weight: "22%", name: "Valuation Gap", desc: "Linear regression predicts log(P/S) from 6 fundamentals. Gap = (Expected - Actual) / Actual." },
            { weight: "20%", name: "Fundamental Score", desc: "Revenue growth, margins, FCF quality, ROE. Insurance uses underwriting-specific weights." },
            { weight: "20%", name: "Management AI Execution", desc: "Concrete AI actions (ai-powered, ai-driven, ai-enabled, production deploy, underwriting automation) + margin/FCF follow-through. Penalizes hype and discounting." },
            { weight: "18%", name: "Dislocation Score", desc: "45% drawdown severity + 35% AI fear ratio in news + 20% weak recent returns." },
            { weight: "12%", name: "AI Positioning Score", desc: "Switching costs strength + incumbent/entrant advantage delta + AI sentiment + industry AI tailwind." },
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
            <p className="text-gray-500">saaspocalypse, commoditization, price war, pricing pressure, churn, ai disruption, ai displacement, ai threat, ai replacement, secular decline, market share loss, layoff, margin pressure, open-source pressure, demand slowdown</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-300 mb-1">Concrete Execution (bullish signal)</h4>
            <p className="text-gray-500">launched, rolled out, deployment, integrated, customer win, ai-powered, ai-driven, ai-enabled, ai-native, production deploy, underwriting automation, payback period, claims automation, seat expansion, renewal rate</p>
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
