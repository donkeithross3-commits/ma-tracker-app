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
// Static Data (from ai_disruption_scan_20260314)
// ---------------------------------------------------------------------------

const SCAN_DATE = "2026-03-14";
const UNIVERSE_SIZE = 75;

const INDUSTRIES: Industry[] = [
  { industry_label: "Creative & Document Software", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.81, avg_valuation_gap_pct: 56.6, avg_dislocation_score: 1.86, avg_opportunity_score: 1.19 },
  { industry_label: "CRM / ERP Platforms", ticker_count: 7, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.96, avg_valuation_gap_pct: 58.9, avg_dislocation_score: 1.51, avg_opportunity_score: 1.04 },
  { industry_label: "Tax & Accounting Software", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: -13.8, avg_dislocation_score: 3.0, avg_opportunity_score: 0.96 },
  { industry_label: "Personal Auto Insurance", ticker_count: 2, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.33, avg_valuation_gap_pct: 53.0, avg_dislocation_score: -0.74, avg_opportunity_score: 0.8 },
  { industry_label: "Cloud Hyperscalers", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.95, avg_valuation_gap_pct: 27.1, avg_dislocation_score: 0.18, avg_opportunity_score: 0.45 },
  { industry_label: "Digital Advertising / Social", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.85, avg_valuation_gap_pct: 30.0, avg_dislocation_score: -0.62, avg_opportunity_score: 0.32 },
  { industry_label: "Healthcare IT / Life Sciences", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.93, avg_valuation_gap_pct: -32.1, avg_dislocation_score: 1.45, avg_opportunity_score: 0.27 },
  { industry_label: "Vertical SaaS", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: -15.4, avg_dislocation_score: 1.33, avg_opportunity_score: 0.22 },
  { industry_label: "Commercial / Specialty Insurance", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.63, avg_valuation_gap_pct: 57.3, avg_dislocation_score: -0.77, avg_opportunity_score: 0.2 },
  { industry_label: "DevOps & Developer Tools", ticker_count: 4, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.69, avg_valuation_gap_pct: 36.5, avg_dislocation_score: 1.24, avg_opportunity_score: 0.19 },
  { industry_label: "HR / Workforce Management", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.77, avg_valuation_gap_pct: 10.3, avg_dislocation_score: 0.68, avg_opportunity_score: 0.13 },
  { industry_label: "E-Commerce Platforms", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.73, avg_valuation_gap_pct: -50.7, avg_dislocation_score: 0.75, avg_opportunity_score: 0.09 },
  { industry_label: "FinTech / Payments", ticker_count: 7, switching_class: "high", favored_side: "entrant", avg_switching_cost_score: 0.56, avg_valuation_gap_pct: 30.5, avg_dislocation_score: 0.33, avg_opportunity_score: 0.05 },
  { industry_label: "Cybersecurity Platforms", ticker_count: 10, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.91, avg_valuation_gap_pct: 14.4, avg_dislocation_score: 0.2, avg_opportunity_score: -0.18 },
  { industry_label: "AI Compute / Semiconductors", ticker_count: 6, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.78, avg_valuation_gap_pct: -0.0, avg_dislocation_score: -0.99, avg_opportunity_score: -0.21 },
  { industry_label: "Horizontal SaaS / Collaboration", ticker_count: 5, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.49, avg_valuation_gap_pct: -9.1, avg_dislocation_score: 0.72, avg_opportunity_score: -0.31 },
  { industry_label: "Data Center Networking", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.88, avg_valuation_gap_pct: -0.0, avg_dislocation_score: -1.25, avg_opportunity_score: -0.31 },
  { industry_label: "Data Platforms", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.76, avg_valuation_gap_pct: 8.1, avg_dislocation_score: 0.26, avg_opportunity_score: -0.66 },
  { industry_label: "Government & Defense Analytics", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 1.0, avg_valuation_gap_pct: -80.5, avg_dislocation_score: -3.0, avg_opportunity_score: -0.78 },
  { industry_label: "IT Services", ticker_count: 6, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.47, avg_valuation_gap_pct: -2.5, avg_dislocation_score: 0.54, avg_opportunity_score: -1.26 },
];

const TICKERS: Ticker[] = [
  { ticker: "FRSH", price: 8.13, market_cap_b: 2.310019, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 2.382835, management_ai_execution_score: 1.401677, fundamental_score: 0.542203, valuation_score: 0.901713, valuation_gap_pct: 0.459, dislocation_score: 3.0, ai_positioning_score: -0.438056, risk_penalty: 0.098074, revenue_growth_yoy: 0.2, revenue_cagr_2y: 0.2, operating_margin: 0.05, operating_margin_change_2y: 0.301059, fcf_yield: 0.04, free_cash_flow_b: 0.23667, ai_news_intensity: 0.206079, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: 1.0, ai_net_sentiment: -1.0, drawdown_252d: -0.505775, return_63d: -0.395089 },
  { ticker: "KVYO", price: 19.12, market_cap_b: 5.827281, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 2, opportunity_score: 2.238883, management_ai_execution_score: 2.043913, fundamental_score: 0.801505, valuation_score: 2.416166, valuation_gap_pct: 1.949621, dislocation_score: 0.169425, ai_positioning_score: 0.69736, risk_penalty: 0.316907, revenue_growth_yoy: 0.34, revenue_cagr_2y: 0.41, operating_margin: 0.04, operating_margin_change_2y: 0.4, fcf_yield: 0.015, free_cash_flow_b: 0.208522, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.490133, return_63d: -0.351425 },
  { ticker: "HUBS", price: 264.3, market_cap_b: 13.939324, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 3, opportunity_score: 1.813173, management_ai_execution_score: 0.183026, fundamental_score: 0.185272, valuation_score: 1.281799, valuation_gap_pct: 0.635166, dislocation_score: 3.0, ai_positioning_score: -0.297464, risk_penalty: 0.222996, revenue_growth_yoy: 0.191709, revenue_cagr_2y: 0.201177, operating_margin: 0.002357, operating_margin_change_2y: 0.094941, fcf_yield: 0.050759, free_cash_flow_b: 0.707552, ai_news_intensity: 0.773913, ai_exec_concrete_ratio: 0.3321, ai_fear_ratio: 0.39357, ai_net_sentiment: -0.39357, drawdown_252d: -0.606837, return_63d: -0.326573 },
  { ticker: "NTNX", price: 39.29, market_cap_b: 10.420183, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 4, opportunity_score: 1.655716, management_ai_execution_score: 0.035171, fundamental_score: 0.190088, valuation_score: 1.891462, valuation_gap_pct: 0.917737, dislocation_score: 2.359719, ai_positioning_score: 0.195423, risk_penalty: 0.252926, revenue_growth_yoy: 0.17, revenue_cagr_2y: 0.13, operating_margin: 0.09, operating_margin_change_2y: 0.179183, fcf_yield: 0.025, free_cash_flow_b: 0.777114, ai_news_intensity: 0.304513, ai_exec_concrete_ratio: 0.377548, ai_fear_ratio: 0.326628, ai_net_sentiment: -0.326628, drawdown_252d: -0.527025, return_63d: -0.179578 },
  { ticker: "GTLB", price: 22.69, market_cap_b: 3.858843, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "entrant", switching_cost_class: "high", role: "challenger", rank: 5, opportunity_score: 1.636747, management_ai_execution_score: 0.910268, fundamental_score: 0.642026, valuation_score: 2.416166, valuation_gap_pct: 1.259608, dislocation_score: 2.072478, ai_positioning_score: -0.59709, risk_penalty: 0.967061, revenue_growth_yoy: 0.309262, revenue_cagr_2y: 0.337634, operating_margin: -0.187969, operating_margin_change_2y: 0.310247, fcf_yield: 0.062793, free_cash_flow_b: 0.24231, ai_news_intensity: 0.923025, ai_exec_concrete_ratio: 0.308019, ai_fear_ratio: 0.235053, ai_net_sentiment: -0.235053, drawdown_252d: -0.575332, return_63d: -0.439753 },
  { ticker: "DOCU", price: 47.05, market_cap_b: 9.422832, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 6, opportunity_score: 1.425492, management_ai_execution_score: 0.760835, fundamental_score: 0.020055, valuation_score: 1.132816, valuation_gap_pct: 0.566113, dislocation_score: 1.863977, ai_positioning_score: -0.423474, risk_penalty: -0.229898, revenue_growth_yoy: 0.077794, revenue_cagr_2y: 0.087733, operating_margin: 0.067163, operating_margin_change_2y: 0.102153, fcf_yield: 0.104845, free_cash_flow_b: 0.987933, ai_news_intensity: 0.73143, ai_exec_concrete_ratio: 0.345335, ai_fear_ratio: 0.232061, ai_net_sentiment: -0.232061, drawdown_252d: -0.498615, return_63d: -0.316233 },
  { ticker: "WDAY", price: 133.09, market_cap_b: 35.00267, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "HR / Workforce Management", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 7, opportunity_score: 1.262627, management_ai_execution_score: 0.31826, fundamental_score: 0.042446, valuation_score: 1.518217, valuation_gap_pct: 0.744742, dislocation_score: 2.020055, ai_positioning_score: -0.08628, risk_penalty: 0.124086, revenue_growth_yoy: 0.164, revenue_cagr_2y: 0.165, operating_margin: 0.056, operating_margin_change_2y: 0.050271, fcf_yield: 0.045, free_cash_flow_b: 2.777, ai_news_intensity: 0.680134, ai_exec_concrete_ratio: 0.376164, ai_fear_ratio: 0.247788, ai_net_sentiment: -0.189231, drawdown_252d: -0.515525, return_63d: -0.402514 },
  { ticker: "S", price: 14.52, market_cap_b: 4.934898, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 8, opportunity_score: 1.255772, management_ai_execution_score: 1.103163, fundamental_score: 0.339532, valuation_score: 2.416166, valuation_gap_pct: 1.406893, dislocation_score: -0.470192, ai_positioning_score: 0.713501, risk_penalty: 0.968405, revenue_growth_yoy: 0.32, revenue_cagr_2y: 0.37, operating_margin: -0.18, operating_margin_change_2y: 0.4, fcf_yield: 0.005, free_cash_flow_b: 0.068131, ai_news_intensity: 0.921828, ai_exec_concrete_ratio: 0.547527, ai_fear_ratio: 0.0, ai_net_sentiment: 0.057028, drawdown_252d: -0.286136, return_63d: -0.047244 },
  { ticker: "CRM", price: 192.83, market_cap_b: 177.98209, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 9, opportunity_score: 1.226412, management_ai_execution_score: 0.297435, fundamental_score: -0.039097, valuation_score: 0.897139, valuation_gap_pct: 0.45688, dislocation_score: 1.712977, ai_positioning_score: 0.265811, risk_penalty: -0.163745, revenue_growth_yoy: 0.095791, revenue_cagr_2y: 0.091465, operating_margin: 0.200626, operating_margin_change_2y: 0.056867, fcf_yield: 0.080918, free_cash_flow_b: 14.402, ai_news_intensity: 0.909984, ai_exec_concrete_ratio: 0.380054, ai_fear_ratio: 0.270778, ai_net_sentiment: -0.238553, drawdown_252d: -0.337695, return_63d: -0.270136 },
  { ticker: "ALL", price: 206.17, market_cap_b: 53.508505, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Personal Auto Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 10, opportunity_score: 1.103014, management_ai_execution_score: 1.048172, fundamental_score: 0.775803, valuation_score: 1.584092, valuation_gap_pct: 0.775275, dislocation_score: -0.735268, ai_positioning_score: -0.648915, risk_penalty: -0.457309, revenue_growth_yoy: 0.055829, revenue_cagr_2y: 0.088807, operating_margin: 0.176583, operating_margin_change_2y: 0.17604, fcf_yield: 0.184681, free_cash_flow_b: 9.882, ai_news_intensity: 0.25675, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.041916, return_63d: 0.024753 },
  { ticker: "HIG", price: 132.93, market_cap_b: 36.670498, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Commercial / Specialty Insurance", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 1.010998, management_ai_execution_score: 0.373482, fundamental_score: 0.36611, valuation_score: 2.209218, valuation_gap_pct: 1.065013, dislocation_score: -0.696198, ai_positioning_score: -0.100871, risk_penalty: -0.60252, revenue_growth_yoy: 0.069079, revenue_cagr_2y: 0.075455, operating_margin: 0.17481, operating_margin_change_2y: 0.040794, fcf_yield: 0.156884, free_cash_flow_b: 5.753, ai_news_intensity: 1.0, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.073852, return_63d: 0.020654 },
  { ticker: "OKTA", price: 79.16, market_cap_b: 14.002449, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 12, opportunity_score: 1.009128, management_ai_execution_score: 0.549118, fundamental_score: 0.114227, valuation_score: 0.189269, valuation_gap_pct: 0.128791, dislocation_score: 2.046835, ai_positioning_score: 0.00462, risk_penalty: -0.140262, revenue_growth_yoy: 0.118391, revenue_cagr_2y: 0.135729, operating_margin: 0.051045, operating_margin_change_2y: 0.279061, fcf_yield: 0.061632, free_cash_flow_b: 0.863, ai_news_intensity: 0.548794, ai_exec_concrete_ratio: 0.284295, ai_fear_ratio: 0.332792, ai_net_sentiment: -0.332792, drawdown_252d: -0.378162, return_63d: -0.118878 },
  { ticker: "TEAM", price: 75.21, market_cap_b: 19.836192, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 13, opportunity_score: 0.97905, management_ai_execution_score: 0.344189, fundamental_score: 0.035412, valuation_score: 1.511008, valuation_gap_pct: 0.741401, dislocation_score: 2.582549, ai_positioning_score: -0.466683, risk_penalty: 0.921685, revenue_growth_yoy: 0.196554, revenue_cagr_2y: 0.214694, operating_margin: -0.025002, operating_margin_change_2y: 0.072666, fcf_yield: 0.064617, free_cash_flow_b: 1.281752, ai_news_intensity: 0.594158, ai_exec_concrete_ratio: 0.505939, ai_fear_ratio: 0.262882, ai_net_sentiment: -0.262882, drawdown_252d: -0.68161, return_63d: -0.534966 },
  { ticker: "INTU", price: 439.96, market_cap_b: 121.670938, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Tax & Accounting Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 14, opportunity_score: 0.961015, management_ai_execution_score: 0.289438, fundamental_score: 0.093574, valuation_score: -0.385388, valuation_gap_pct: -0.137556, dislocation_score: 3.0, ai_positioning_score: -0.529916, risk_penalty: 0.139477, revenue_growth_yoy: 0.133, revenue_cagr_2y: 0.144823, operating_margin: 0.221, operating_margin_change_2y: 0.04282, fcf_yield: 0.056538, free_cash_flow_b: 6.879, ai_news_intensity: 0.702519, ai_exec_concrete_ratio: 0.327222, ai_fear_ratio: 0.469602, ai_net_sentiment: -0.420657, drawdown_252d: -0.455084, return_63d: -0.335839 },
  { ticker: "ADBE", price: 249.32, market_cap_b: 101.632036, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 15, opportunity_score: 0.951358, management_ai_execution_score: -0.102235, fundamental_score: 0.282611, valuation_score: 1.132244, valuation_gap_pct: 0.565848, dislocation_score: 1.758636, ai_positioning_score: -0.457933, risk_penalty: 0.067982, revenue_growth_yoy: 0.105278, revenue_cagr_2y: 0.106634, operating_margin: 0.314, operating_margin_change_2y: 0.023651, fcf_yield: 0.096938, free_cash_flow_b: 9.852, ai_news_intensity: 0.729742, ai_exec_concrete_ratio: 0.388195, ai_fear_ratio: 0.257391, ai_net_sentiment: -0.257391, drawdown_252d: -0.40734, return_63d: -0.273395 },
  { ticker: "NET", price: 212.45, market_cap_b: 74.778214, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 75, opportunity_score: -2.156124, management_ai_execution_score: -0.073819, fundamental_score: -0.346584, valuation_score: -1.234952, valuation_gap_pct: -0.693658, dislocation_score: -0.634417, ai_positioning_score: 0.100754, risk_penalty: 2.570142, revenue_growth_yoy: 0.298457, revenue_cagr_2y: 0.292993, operating_margin: -0.095577, operating_margin_change_2y: 0.047462, fcf_yield: 0.003845, free_cash_flow_b: 0.287497, ai_news_intensity: 0.671397, ai_exec_concrete_ratio: 0.259884, ai_fear_ratio: 0.228615, ai_net_sentiment: -0.228615, drawdown_252d: -0.161271, return_63d: -0.004732 },
  { ticker: "GLOB", price: 44.95, market_cap_b: 7.0, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 74, opportunity_score: -2.110848, management_ai_execution_score: -0.70472, fundamental_score: -0.877822, valuation_score: -0.981978, valuation_gap_pct: -0.414069, dislocation_score: 0.674038, ai_positioning_score: -1.088208, risk_penalty: 0.348232, revenue_growth_yoy: 0.016222, revenue_cagr_2y: 0.082245, operating_margin: 0.086, operating_margin_change_2y: -0.024972, fcf_yield: 0.024286, free_cash_flow_b: 0.17, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.679752, return_63d: -0.347795 },
  { ticker: "IBM", price: 246.28, market_cap_b: 231.111386, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 73, opportunity_score: -2.085731, management_ai_execution_score: 0.01747, fundamental_score: -0.854251, valuation_score: -0.360937, valuation_gap_pct: -0.126224, dislocation_score: 0.015656, ai_positioning_score: -1.06845, risk_penalty: 1.632043, revenue_growth_yoy: 0.014, revenue_cagr_2y: 0.044863, operating_margin: 0.15, operating_margin_change_2y: 0.01514, fcf_yield: 0.063606, free_cash_flow_b: 14.7, ai_news_intensity: 0.656969, ai_exec_concrete_ratio: 0.483806, ai_fear_ratio: 0.051383, ai_net_sentiment: -0.051383, drawdown_252d: -0.218109, return_63d: -0.212332 },
  { ticker: "ORCL", price: 155.11, market_cap_b: 445.800255, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 72, opportunity_score: -1.757524, management_ai_execution_score: -0.497146, fundamental_score: -0.484849, valuation_score: 0.178328, valuation_gap_pct: 0.123719, dislocation_score: 0.455084, ai_positioning_score: 0.798843, risk_penalty: 3.587294, revenue_growth_yoy: 0.083798, revenue_cagr_2y: 0.071931, operating_margin: 0.307984, operating_margin_change_2y: 0.045883, fcf_yield: -0.000897, free_cash_flow_b: -0.4, ai_news_intensity: 0.868097, ai_exec_concrete_ratio: 0.205497, ai_fear_ratio: 0.043957, ai_net_sentiment: -0.025006, drawdown_252d: -0.527579, return_63d: -0.304471 },
  { ticker: "SNOW", price: 178.66, market_cap_b: 61.137452, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 71, opportunity_score: -1.657545, management_ai_execution_score: 0.247904, fundamental_score: -0.401706, valuation_score: -1.061556, valuation_gap_pct: -0.450952, dislocation_score: 0.257971, ai_positioning_score: 0.240772, risk_penalty: 2.26523, revenue_growth_yoy: 0.292147, revenue_cagr_2y: 0.324977, operating_margin: -0.401503, operating_margin_change_2y: 0.006244, fcf_yield: 0.012704, free_cash_flow_b: 0.776677, ai_news_intensity: 0.526869, ai_exec_concrete_ratio: 0.384385, ai_fear_ratio: 0.132065, ai_net_sentiment: -0.132065, drawdown_252d: -0.355344, return_63d: -0.174971 },
  { ticker: "WIT", price: 2.26, market_cap_b: 23.677009, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 70, opportunity_score: -1.630544, management_ai_execution_score: -0.005853, fundamental_score: -0.733469, valuation_score: -0.862608, valuation_gap_pct: -0.358743, dislocation_score: -0.169063, ai_positioning_score: -0.968661, risk_penalty: -0.014248, revenue_growth_yoy: -0.05, revenue_cagr_2y: -0.006, operating_margin: 0.168, operating_margin_change_2y: null, fcf_yield: 0.045, free_cash_flow_b: null, ai_news_intensity: 0.693639, ai_exec_concrete_ratio: 0.470345, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.280255, return_63d: -0.217993 },
  { ticker: "FROG", price: 41.07, market_cap_b: 4.91316, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "challenger", rank: 69, opportunity_score: -1.454402, management_ai_execution_score: -0.25544, fundamental_score: -0.076119, valuation_score: -0.915062, valuation_gap_pct: -0.383054, dislocation_score: -0.221609, ai_positioning_score: 0.017903, risk_penalty: 0.468139, revenue_growth_yoy: 0.2, revenue_cagr_2y: 0.22, operating_margin: -0.02, operating_margin_change_2y: 0.043214, fcf_yield: 0.01, free_cash_flow_b: 0.142269, ai_news_intensity: 0.552508, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.40461, return_63d: -0.402444 },
  { ticker: "AFRM", price: 46.88, market_cap_b: 15.616227, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 68, opportunity_score: -1.310259, management_ai_execution_score: 1.510339, fundamental_score: 0.332968, valuation_score: -0.698346, valuation_gap_pct: -0.282609, dislocation_score: -0.127908, ai_positioning_score: -0.275909, risk_penalty: 2.741573, revenue_growth_yoy: 0.348614, revenue_cagr_2y: 0.33298, operating_margin: 0.032, operating_margin_change_2y: 0.4, fcf_yield: 0.039647, free_cash_flow_b: 0.619133, ai_news_intensity: 0.166446, ai_exec_concrete_ratio: 0.509332, ai_fear_ratio: 0.0, ai_net_sentiment: 0.360094, drawdown_252d: -0.49143, return_63d: -0.338414 },
  { ticker: "CFLT", price: 30.67, market_cap_b: 11.018765, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 67, opportunity_score: -1.227721, management_ai_execution_score: 0.525954, fundamental_score: -0.273132, valuation_score: -0.708524, valuation_gap_pct: -0.287326, dislocation_score: -1.235319, ai_positioning_score: 0.408131, risk_penalty: 0.888334, revenue_growth_yoy: 0.210769, revenue_cagr_2y: 0.225438, operating_margin: -0.325779, operating_margin_change_2y: 0.290441, fcf_yield: 0.005507, free_cash_flow_b: 0.060677, ai_news_intensity: 0.432491, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.003897, return_63d: 0.022333 },
  { ticker: "DAY", price: 69.86, market_cap_b: null, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "HR / Workforce Management", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 66, opportunity_score: -1.162151, management_ai_execution_score: -0.06445, fundamental_score: -0.61336, valuation_score: -0.338806, valuation_gap_pct: -0.115966, dislocation_score: -0.991918, ai_positioning_score: 0.225048, risk_penalty: 0.038696, revenue_growth_yoy: 0.16, revenue_cagr_2y: 0.11, operating_margin: 0.04, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: 0.643941, ai_exec_concrete_ratio: 0.600991, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.026206, return_63d: 0.016293 },
  { ticker: "EPAM", price: 137.14, market_cap_b: 7.424755, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 65, opportunity_score: -0.988514, management_ai_execution_score: -0.152332, fundamental_score: -0.410228, valuation_score: -0.533791, valuation_gap_pct: -0.206339, dislocation_score: 2.052893, ai_positioning_score: -1.804019, risk_penalty: 0.534571, revenue_growth_yoy: 0.154214, revenue_cagr_2y: 0.078618, operating_margin: 0.09529, operating_margin_change_2y: -0.017098, fcf_yield: 0.08252, free_cash_flow_b: 0.612691, ai_news_intensity: 0.539663, ai_exec_concrete_ratio: 0.349838, ai_fear_ratio: 0.27705, ai_net_sentiment: -0.27705, drawdown_252d: -0.380578, return_63d: -0.352258 },
  { ticker: "CRWD", price: 441.78, market_cap_b: 112.041633, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 64, opportunity_score: -0.964023, management_ai_execution_score: 0.294961, fundamental_score: -0.142793, valuation_score: -1.234952, valuation_gap_pct: -0.588983, dislocation_score: -0.393618, ai_positioning_score: 0.548069, risk_penalty: 0.58228, revenue_growth_yoy: 0.217112, revenue_cagr_2y: 0.254926, operating_margin: -0.06095, operating_margin_change_2y: -0.054686, fcf_yield: 0.011694, free_cash_flow_b: 1.310241, ai_news_intensity: 0.754999, ai_exec_concrete_ratio: 0.437961, ai_fear_ratio: 0.149186, ai_net_sentiment: -0.108654, drawdown_252d: -0.207612, return_63d: -0.149671 },
  { ticker: "AMAT", price: 341.53, market_cap_b: 271.041578, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "AI Compute / Semiconductors", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 63, opportunity_score: -0.93604, management_ai_execution_score: -0.464264, fundamental_score: -0.486039, valuation_score: -0.088603, valuation_gap_pct: 0.0, dislocation_score: -0.861982, ai_positioning_score: 0.681938, risk_penalty: 0.163622, revenue_growth_yoy: 0.043862, revenue_cagr_2y: 0.034313, operating_margin: 0.292195, operating_margin_change_2y: 0.00355, fcf_yield: 0.022853, free_cash_flow_b: 6.194, ai_news_intensity: 0.674236, ai_exec_concrete_ratio: 0.170008, ai_fear_ratio: 0.048438, ai_net_sentiment: -0.048438, drawdown_252d: -0.135258, return_63d: 0.24125 },
  { ticker: "ZM", price: 74.1, market_cap_b: 21.834816, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 62, opportunity_score: -0.897518, management_ai_execution_score: 0.454553, fundamental_score: 0.018517, valuation_score: -0.481011, valuation_gap_pct: -0.181877, dislocation_score: -0.404495, ai_positioning_score: -0.791187, risk_penalty: -0.235796, revenue_growth_yoy: 0.043584, revenue_cagr_2y: 0.037035, operating_margin: 0.230784, operating_margin_change_2y: 0.114757, fcf_yield: 0.08812, free_cash_flow_b: 1.924087, ai_news_intensity: 0.565684, ai_exec_concrete_ratio: 0.274607, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.22989, return_63d: -0.158433 },
  { ticker: "PLTR", price: 150.95, market_cap_b: 361.023449, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Government & Defense Analytics", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 61, opportunity_score: -0.779185, management_ai_execution_score: 1.04992, fundamental_score: 0.717275, valuation_score: -1.234952, valuation_gap_pct: -0.804514, dislocation_score: -3.0, ai_positioning_score: 1.223441, risk_penalty: -0.142791, revenue_growth_yoy: 0.29, revenue_cagr_2y: 0.418247, operating_margin: 0.108, operating_margin_change_2y: 0.262033, fcf_yield: 0.005818, free_cash_flow_b: 2.100591, ai_news_intensity: 0.838329, ai_exec_concrete_ratio: 0.215487, ai_fear_ratio: 0.072946, ai_net_sentiment: -0.010698, drawdown_252d: -0.271407, return_63d: -0.19669 },
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
