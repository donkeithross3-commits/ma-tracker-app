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
const UNIVERSE_SIZE = 71;

const INDUSTRIES: Industry[] = [
  { industry_label: "Creative & Document Software", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.81, avg_valuation_gap_pct: 98.6, avg_dislocation_score: 1.9, avg_opportunity_score: 1.8 },
  { industry_label: "Tax & Accounting Software", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: 5.2, avg_dislocation_score: 3.0, avg_opportunity_score: 1.33 },
  { industry_label: "CRM / ERP Platforms", ticker_count: 5, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 58.0, avg_dislocation_score: 1.53, avg_opportunity_score: 0.99 },
  { industry_label: "Healthcare IT / Life Sciences", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.93, avg_valuation_gap_pct: 98.2, avg_dislocation_score: 1.07, avg_opportunity_score: 0.93 },
  { industry_label: "DevOps & Developer Tools", ticker_count: 3, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.67, avg_valuation_gap_pct: 44.0, avg_dislocation_score: 1.71, avg_opportunity_score: 0.91 },
  { industry_label: "Personal Auto Insurance", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.25, avg_valuation_gap_pct: 0.0, avg_dislocation_score: 0.04, avg_opportunity_score: 0.58 },
  { industry_label: "Digital Advertising / Social", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.85, avg_valuation_gap_pct: 30.0, avg_dislocation_score: -0.62, avg_opportunity_score: 0.47 },
  { industry_label: "Vertical SaaS", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: -12.5, avg_dislocation_score: 1.33, avg_opportunity_score: 0.34 },
  { industry_label: "FinTech / Payments", ticker_count: 6, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.56, avg_valuation_gap_pct: 27.6, avg_dislocation_score: 0.4, avg_opportunity_score: 0.15 },
  { industry_label: "Cloud Hyperscalers", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 7.4, avg_dislocation_score: -0.45, avg_opportunity_score: 0.15 },
  { industry_label: "AI Compute / Semiconductors", ticker_count: 6, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.78, avg_valuation_gap_pct: 1.2, avg_dislocation_score: -0.99, avg_opportunity_score: -0.07 },
  { industry_label: "HR / Workforce Management", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.77, avg_valuation_gap_pct: -7.5, avg_dislocation_score: 0.68, avg_opportunity_score: -0.16 },
  { industry_label: "Cybersecurity Platforms", ticker_count: 8, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.92, avg_valuation_gap_pct: 1.8, avg_dislocation_score: 0.25, avg_opportunity_score: -0.19 },
  { industry_label: "Horizontal SaaS / Collaboration", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.49, avg_valuation_gap_pct: -15.9, avg_dislocation_score: 0.69, avg_opportunity_score: -0.22 },
  { industry_label: "E-Commerce Platforms", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.71, avg_valuation_gap_pct: -19.9, avg_dislocation_score: 0.27, avg_opportunity_score: -0.27 },
  { industry_label: "Commercial / Specialty Insurance", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.63, avg_valuation_gap_pct: 0.0, avg_dislocation_score: -0.77, avg_opportunity_score: -0.28 },
  { industry_label: "AI Infrastructure / Servers", ticker_count: 1, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.34, avg_valuation_gap_pct: -1.9, avg_dislocation_score: 0.72, avg_opportunity_score: -0.29 },
  { industry_label: "Data Center Networking", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.88, avg_valuation_gap_pct: -4.5, avg_dislocation_score: -1.25, avg_opportunity_score: -0.34 },
  { industry_label: "Data Platforms", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.76, avg_valuation_gap_pct: 21.3, avg_dislocation_score: 0.26, avg_opportunity_score: -0.52 },
  { industry_label: "Government & Defense Analytics", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 1.0, avg_valuation_gap_pct: -86.5, avg_dislocation_score: -3.0, avg_opportunity_score: -1.1 },
  { industry_label: "IT Services", ticker_count: 6, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.47, avg_valuation_gap_pct: 5.2, avg_dislocation_score: 0.54, avg_opportunity_score: -1.16 },
];

const TICKERS: Ticker[] = [
  { ticker: "HIMS", price: 24.77, market_cap_b: 5.646043, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Healthcare IT / Life Sciences", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 2.649734, management_ai_execution_score: 0.76572, fundamental_score: 1.100833, valuation_score: 2.5, valuation_gap_pct: 3.827492, dislocation_score: 0.535894, ai_positioning_score: 0.894792, risk_penalty: 0.383877, revenue_growth_yoy: 0.7, revenue_cagr_2y: 0.67, operating_margin: 0.1, operating_margin_change_2y: 0.078763, fcf_yield: 0.035, free_cash_flow_b: 0.057415, ai_news_intensity: 0.066659, ai_exec_concrete_ratio: 0.334994, ai_fear_ratio: 0.0, ai_net_sentiment: 0.334994, drawdown_252d: -0.625718, return_63d: -0.346093 },
  { ticker: "HUBS", price: 264.3, market_cap_b: 13.939324, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 2, opportunity_score: 2.640373, management_ai_execution_score: 0.184003, fundamental_score: 0.169653, valuation_score: 2.5, valuation_gap_pct: 1.349269, dislocation_score: 3.0, ai_positioning_score: -0.443883, risk_penalty: 0.212821, revenue_growth_yoy: 0.191709, revenue_cagr_2y: 0.201177, operating_margin: 0.002357, operating_margin_change_2y: 0.094941, fcf_yield: 0.050759, free_cash_flow_b: 0.707552, ai_news_intensity: 0.773913, ai_exec_concrete_ratio: 0.3321, ai_fear_ratio: 0.39357, ai_net_sentiment: -0.39357, drawdown_252d: -0.606837, return_63d: -0.326573 },
  { ticker: "DOCU", price: 47.05, market_cap_b: 9.422832, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 3, opportunity_score: 2.361032, management_ai_execution_score: 0.788276, fundamental_score: 0.059809, valuation_score: 2.5, valuation_gap_pct: 1.436118, dislocation_score: 1.94169, ai_positioning_score: -0.487081, risk_penalty: -0.220272, revenue_growth_yoy: 0.077794, revenue_cagr_2y: 0.087733, operating_margin: 0.067163, operating_margin_change_2y: 0.102153, fcf_yield: 0.104845, free_cash_flow_b: 0.987933, ai_news_intensity: 0.73143, ai_exec_concrete_ratio: 0.345335, ai_fear_ratio: 0.232061, ai_net_sentiment: -0.232061, drawdown_252d: -0.498615, return_63d: -0.316233 },
  { ticker: "OKTA", price: 79.16, market_cap_b: 14.002449, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 4, opportunity_score: 2.307989, management_ai_execution_score: 0.56606, fundamental_score: 0.143326, valuation_score: 2.327895, valuation_gap_pct: 0.8853, dislocation_score: 2.183195, ai_positioning_score: -0.128621, risk_penalty: -0.140912, revenue_growth_yoy: 0.118391, revenue_cagr_2y: 0.135729, operating_margin: 0.051045, operating_margin_change_2y: 0.279061, fcf_yield: 0.061632, free_cash_flow_b: 0.863, ai_news_intensity: 0.548794, ai_exec_concrete_ratio: 0.284295, ai_fear_ratio: 0.332792, ai_net_sentiment: -0.332792, drawdown_252d: -0.378162, return_63d: -0.118878 },
  { ticker: "CRM", price: 192.83, market_cap_b: 177.98209, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 5, opportunity_score: 2.26997, management_ai_execution_score: 0.283623, fundamental_score: 0.012667, valuation_score: 2.5, valuation_gap_pct: 1.002909, dislocation_score: 1.830383, ai_positioning_score: 0.147395, risk_penalty: -0.187528, revenue_growth_yoy: 0.095791, revenue_cagr_2y: 0.091465, operating_margin: 0.200626, operating_margin_change_2y: 0.056867, fcf_yield: 0.080918, free_cash_flow_b: 14.402, ai_news_intensity: 0.909984, ai_exec_concrete_ratio: 0.380054, ai_fear_ratio: 0.270778, ai_net_sentiment: -0.238553, drawdown_252d: -0.337695, return_63d: -0.270136 },
  { ticker: "GTLB", price: 22.69, market_cap_b: 3.858843, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "entrant", switching_cost_class: "high", role: "challenger", rank: 6, opportunity_score: 2.053855, management_ai_execution_score: 0.93433, fundamental_score: 0.570537, valuation_score: 2.433496, valuation_gap_pct: 0.92546, dislocation_score: 2.150632, ai_positioning_score: -0.615417, risk_penalty: 0.374614, revenue_growth_yoy: 0.309262, revenue_cagr_2y: 0.337634, operating_margin: -0.187969, operating_margin_change_2y: 0.310247, fcf_yield: 0.062793, free_cash_flow_b: 0.24231, ai_news_intensity: 0.923025, ai_exec_concrete_ratio: 0.308019, ai_fear_ratio: 0.235053, ai_net_sentiment: -0.235053, drawdown_252d: -0.575332, return_63d: -0.439753 },
  { ticker: "ROOT", price: 43.76, market_cap_b: 0.680671, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Personal Auto Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 7, opportunity_score: 1.877174, management_ai_execution_score: 3.0, fundamental_score: 1.797431, valuation_score: 0.0, valuation_gap_pct: 0.0, dislocation_score: 1.011622, ai_positioning_score: -0.833427, risk_penalty: 0.401235, revenue_growth_yoy: 0.29, revenue_cagr_2y: 0.945609, operating_margin: 0.041, operating_margin_change_2y: 0.4, fcf_yield: 0.302055, free_cash_flow_b: 0.2056, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.753728, return_63d: -0.476054 },
  { ticker: "TEAM", price: 75.21, market_cap_b: 19.836192, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 8, opportunity_score: 1.495654, management_ai_execution_score: 0.345594, fundamental_score: 0.044717, valuation_score: 2.171008, valuation_gap_pct: 0.825636, dislocation_score: 2.655187, ai_positioning_score: -0.514835, risk_penalty: 0.784299, revenue_growth_yoy: 0.196554, revenue_cagr_2y: 0.214694, operating_margin: -0.025002, operating_margin_change_2y: 0.072666, fcf_yield: 0.064617, free_cash_flow_b: 1.281752, ai_news_intensity: 0.594158, ai_exec_concrete_ratio: 0.505939, ai_fear_ratio: 0.262882, ai_net_sentiment: -0.262882, drawdown_252d: -0.68161, return_63d: -0.534966 },
  { ticker: "INTU", price: 439.96, market_cap_b: 121.670938, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Tax & Accounting Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 9, opportunity_score: 1.334785, management_ai_execution_score: 0.274677, fundamental_score: 0.131338, valuation_score: 0.135863, valuation_gap_pct: 0.051669, dislocation_score: 2.998352, ai_positioning_score: -0.626696, risk_penalty: 0.092265, revenue_growth_yoy: 0.133, revenue_cagr_2y: 0.144823, operating_margin: 0.221, operating_margin_change_2y: 0.04282, fcf_yield: 0.056538, free_cash_flow_b: 6.879, ai_news_intensity: 0.702519, ai_exec_concrete_ratio: 0.327222, ai_fear_ratio: 0.469602, ai_net_sentiment: -0.420657, drawdown_252d: -0.455084, return_63d: -0.335839 },
  { ticker: "PYPL", price: 44.9, market_cap_b: 41.337838, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 10, opportunity_score: 1.322674, management_ai_execution_score: -0.057679, fundamental_score: -0.277441, valuation_score: 2.5, valuation_gap_pct: 1.021391, dislocation_score: 1.443669, ai_positioning_score: -0.4772, risk_penalty: 0.263229, revenue_growth_yoy: 0.043243, revenue_cagr_2y: 0.055575, operating_margin: 0.182835, operating_margin_change_2y: 0.013946, fcf_yield: 0.134598, free_cash_flow_b: 5.564, ai_news_intensity: 0.16448, ai_exec_concrete_ratio: 0.270675, ai_fear_ratio: 0.175023, ai_net_sentiment: -0.175023, drawdown_252d: -0.425978, return_63d: -0.26586 },
  { ticker: "ADBE", price: 249.32, market_cap_b: 101.632036, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 1.247188, management_ai_execution_score: -0.181664, fundamental_score: 0.329888, valuation_score: 1.408923, valuation_gap_pct: 0.535814, dislocation_score: 1.862888, ai_positioning_score: -0.532185, risk_penalty: -0.002806, revenue_growth_yoy: 0.105278, revenue_cagr_2y: 0.106634, operating_margin: 0.314, operating_margin_change_2y: 0.023651, fcf_yield: 0.096938, free_cash_flow_b: 9.852, ai_news_intensity: 0.729742, ai_exec_concrete_ratio: 0.388195, ai_fear_ratio: 0.257391, ai_net_sentiment: -0.257391, drawdown_252d: -0.40734, return_63d: -0.273395 },
  { ticker: "PCOR", price: 57.15, market_cap_b: 8.578243, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Vertical SaaS", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 12, opportunity_score: 1.178316, management_ai_execution_score: 0.381319, fundamental_score: 0.069191, valuation_score: 0.188511, valuation_gap_pct: 0.071691, dislocation_score: 2.513667, ai_positioning_score: -0.706612, risk_penalty: 0.238407, revenue_growth_yoy: 0.22, revenue_cagr_2y: 0.27, operating_margin: -0.06, operating_margin_change_2y: 0.133005, fcf_yield: 0.025, free_cash_flow_b: 0.278637, ai_news_intensity: 1.0, ai_exec_concrete_ratio: 0.306303, ai_fear_ratio: 0.693697, ai_net_sentiment: -0.693697, drawdown_252d: -0.282035, return_63d: -0.257213 },
  { ticker: "SOFI", price: 17.76, market_cap_b: 22.648686, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 13, opportunity_score: 1.16094, management_ai_execution_score: 0.747732, fundamental_score: 1.186531, valuation_score: 1.076532, valuation_gap_pct: 0.409406, dislocation_score: 0.078424, ai_positioning_score: -0.177576, risk_penalty: -0.029093, revenue_growth_yoy: 0.531099, revenue_cagr_2y: 0.240453, operating_margin: 0.147, operating_margin_change_2y: 0.4, fcf_yield: 0.017661, free_cash_flow_b: 0.4, ai_news_intensity: 0.18046, ai_exec_concrete_ratio: 0.24365, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.448618, return_63d: -0.344408 },
  { ticker: "NOW", price: 113.62, market_cap_b: 118.84652, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 14, opportunity_score: 1.060478, management_ai_execution_score: -0.280239, fundamental_score: 0.228391, valuation_score: 0.544779, valuation_gap_pct: 0.20718, dislocation_score: 1.710278, ai_positioning_score: 0.180783, risk_penalty: -0.040948, revenue_growth_yoy: 0.208849, revenue_cagr_2y: 0.216595, operating_margin: 0.13737, operating_margin_change_2y: 0.05243, fcf_yield: 0.038503, free_cash_flow_b: 4.576, ai_news_intensity: 0.812744, ai_exec_concrete_ratio: 0.334068, ai_fear_ratio: 0.245221, ai_net_sentiment: -0.223969, drawdown_252d: -0.456202, return_63d: -0.334435 },
  { ticker: "TOST", price: 27.6, market_cap_b: 16.2564, signal: "Long", ai_rationale: "", ai_narrative: "", ai_bucket: "Best Pick", industry_label: "Vertical SaaS", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 15, opportunity_score: 1.014235, management_ai_execution_score: 0.266665, fundamental_score: -0.195908, valuation_score: 0.78885, valuation_gap_pct: 0.3, dislocation_score: 2.544592, ai_positioning_score: -0.635876, risk_penalty: 0.193342, revenue_growth_yoy: 0.26, revenue_cagr_2y: 0.31, operating_margin: 0.02, operating_margin_change_2y: 0.121713, fcf_yield: 0.018, free_cash_flow_b: 0.608, ai_news_intensity: 0.776211, ai_exec_concrete_ratio: 0.480461, ai_fear_ratio: 0.341335, ai_net_sentiment: -0.341335, drawdown_252d: -0.440162, return_63d: -0.220339 },
  { ticker: "GLOB", price: 44.95, market_cap_b: 7.0, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 71, opportunity_score: -2.482275, management_ai_execution_score: -0.719422, fundamental_score: -0.764939, valuation_score: -1.344092, valuation_gap_pct: -0.511159, dislocation_score: 0.646504, ai_positioning_score: -0.988507, risk_penalty: 0.300794, revenue_growth_yoy: 0.016222, revenue_cagr_2y: 0.082245, operating_margin: 0.086, operating_margin_change_2y: -0.024972, fcf_yield: 0.024286, free_cash_flow_b: 0.17, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.679752, return_63d: -0.347795 },
  { ticker: "IBM", price: 246.28, market_cap_b: 231.111386, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 70, opportunity_score: -2.2533, management_ai_execution_score: 0.035601, fundamental_score: -0.701807, valuation_score: -0.70313, valuation_gap_pct: -0.267401, dislocation_score: 0.060985, ai_positioning_score: -1.000355, risk_penalty: 1.321216, revenue_growth_yoy: 0.014, revenue_cagr_2y: 0.044863, operating_margin: 0.15, operating_margin_change_2y: 0.01514, fcf_yield: 0.063606, free_cash_flow_b: 14.7, ai_news_intensity: 0.656969, ai_exec_concrete_ratio: 0.483806, ai_fear_ratio: 0.051383, ai_net_sentiment: -0.051383, drawdown_252d: -0.218109, return_63d: -0.212332 },
  { ticker: "NET", price: 212.45, market_cap_b: 74.778214, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 69, opportunity_score: -2.247836, management_ai_execution_score: -0.087046, fundamental_score: -0.322528, valuation_score: -1.424333, valuation_gap_pct: -0.697123, dislocation_score: -0.352913, ai_positioning_score: 0.016756, risk_penalty: 2.172421, revenue_growth_yoy: 0.298457, revenue_cagr_2y: 0.292993, operating_margin: -0.095577, operating_margin_change_2y: 0.047462, fcf_yield: 0.003845, free_cash_flow_b: 0.287497, ai_news_intensity: 0.671397, ai_exec_concrete_ratio: 0.259884, ai_fear_ratio: 0.228615, ai_net_sentiment: -0.228615, drawdown_252d: -0.161271, return_63d: -0.004732 },
  { ticker: "WIT", price: 2.26, market_cap_b: 23.677009, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 68, opportunity_score: -1.670748, management_ai_execution_score: 0.008188, fundamental_score: -0.588155, valuation_score: -0.801459, valuation_gap_pct: -0.304795, dislocation_score: -0.153777, ai_positioning_score: -0.882059, risk_penalty: -0.038209, revenue_growth_yoy: -0.05, revenue_cagr_2y: -0.006, operating_margin: 0.168, operating_margin_change_2y: null, fcf_yield: 0.045, free_cash_flow_b: null, ai_news_intensity: 0.693639, ai_exec_concrete_ratio: 0.470345, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.280255, return_63d: -0.217993 },
  { ticker: "SNOW", price: 178.66, market_cap_b: 61.137452, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 67, opportunity_score: -1.560035, management_ai_execution_score: 0.192972, fundamental_score: -0.431869, valuation_score: -0.674491, valuation_gap_pct: -0.256509, dislocation_score: 0.372838, ai_positioning_score: 0.210172, risk_penalty: 1.984767, revenue_growth_yoy: 0.292147, revenue_cagr_2y: 0.324977, operating_margin: -0.401503, operating_margin_change_2y: 0.006244, fcf_yield: 0.012704, free_cash_flow_b: 0.776677, ai_news_intensity: 0.526869, ai_exec_concrete_ratio: 0.384385, ai_fear_ratio: 0.132065, ai_net_sentiment: -0.132065, drawdown_252d: -0.355344, return_63d: -0.174971 },
  { ticker: "ORCL", price: 155.11, market_cap_b: 445.800255, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 66, opportunity_score: -1.442587, management_ai_execution_score: -0.553416, fundamental_score: -0.357969, valuation_score: 0.625718, valuation_gap_pct: 0.237961, dislocation_score: 0.481326, ai_positioning_score: 0.745128, risk_penalty: 2.984994, revenue_growth_yoy: 0.083798, revenue_cagr_2y: 0.071931, operating_margin: 0.307984, operating_margin_change_2y: 0.045883, fcf_yield: -0.000897, free_cash_flow_b: -0.4, ai_news_intensity: 0.868097, ai_exec_concrete_ratio: 0.205497, ai_fear_ratio: 0.043957, ai_net_sentiment: -0.025006, drawdown_252d: -0.527579, return_63d: -0.304471 },
  { ticker: "CRWD", price: 441.78, market_cap_b: 112.041633, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 65, opportunity_score: -1.176457, management_ai_execution_score: 0.137809, fundamental_score: -0.161246, valuation_score: -1.369334, valuation_gap_pct: -0.520758, dislocation_score: -0.205215, ai_positioning_score: 0.484391, risk_penalty: 0.540847, revenue_growth_yoy: 0.217112, revenue_cagr_2y: 0.254926, operating_margin: -0.06095, operating_margin_change_2y: -0.054686, fcf_yield: 0.011694, free_cash_flow_b: 1.310241, ai_news_intensity: 0.754999, ai_exec_concrete_ratio: 0.437961, ai_fear_ratio: 0.149186, ai_net_sentiment: -0.108654, drawdown_252d: -0.207612, return_63d: -0.149671 },
  { ticker: "AFRM", price: 46.88, market_cap_b: 15.616227, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 64, opportunity_score: -1.151001, management_ai_execution_score: 1.521855, fundamental_score: 0.398571, valuation_score: -0.620113, valuation_gap_pct: -0.235829, dislocation_score: -0.08613, ai_positioning_score: -0.171274, risk_penalty: 2.297044, revenue_growth_yoy: 0.348614, revenue_cagr_2y: 0.33298, operating_margin: 0.032, operating_margin_change_2y: 0.4, fcf_yield: 0.039647, free_cash_flow_b: 0.619133, ai_news_intensity: 0.166446, ai_exec_concrete_ratio: 0.509332, ai_fear_ratio: 0.0, ai_net_sentiment: 0.360094, drawdown_252d: -0.49143, return_63d: -0.338414 },
  { ticker: "CYBR", price: 408.85, market_cap_b: null, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 63, opportunity_score: -1.119243, management_ai_execution_score: 0.380472, fundamental_score: 0.361429, valuation_score: -1.053222, valuation_gap_pct: -0.400541, dislocation_score: -1.215152, ai_positioning_score: 0.784885, risk_penalty: 0.363857, revenue_growth_yoy: 0.43, revenue_cagr_2y: 0.46, operating_margin: -0.059, operating_margin_change_2y: null, fcf_yield: 0.012, free_cash_flow_b: null, ai_news_intensity: 0.364015, ai_exec_concrete_ratio: 0.569104, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.216792, return_63d: -0.18858 },
  { ticker: "ZM", price: 74.1, market_cap_b: 21.834816, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 62, opportunity_score: -1.105351, management_ai_execution_score: 0.480572, fundamental_score: 0.080527, valuation_score: -0.790516, valuation_gap_pct: -0.300634, dislocation_score: -0.374448, ai_positioning_score: -0.716716, risk_penalty: -0.225912, revenue_growth_yoy: 0.043584, revenue_cagr_2y: 0.037035, operating_margin: 0.230784, operating_margin_change_2y: 0.114757, fcf_yield: 0.08812, free_cash_flow_b: 1.924087, ai_news_intensity: 0.565684, ai_exec_concrete_ratio: 0.274607, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.22989, return_63d: -0.158433 },
  { ticker: "PLTR", price: 150.95, market_cap_b: 361.023449, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Government & Defense Analytics", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 61, opportunity_score: -1.104378, management_ai_execution_score: 0.9618, fundamental_score: 0.673942, valuation_score: -1.424333, valuation_gap_pct: -0.864831, dislocation_score: -3.0, ai_positioning_score: 1.162554, risk_penalty: -0.136973, revenue_growth_yoy: 0.29, revenue_cagr_2y: 0.418247, operating_margin: 0.108, operating_margin_change_2y: 0.262033, fcf_yield: 0.005818, free_cash_flow_b: 2.100591, ai_news_intensity: 0.838329, ai_exec_concrete_ratio: 0.215487, ai_fear_ratio: 0.072946, ai_net_sentiment: -0.010698, drawdown_252d: -0.271407, return_63d: -0.19669 },
  { ticker: "DAY", price: 69.86, market_cap_b: null, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "HR / Workforce Management", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 60, opportunity_score: -1.085383, management_ai_execution_score: -0.061992, fundamental_score: -0.505066, valuation_score: -0.190769, valuation_gap_pct: -0.072549, dislocation_score: -0.934526, ai_positioning_score: 0.249611, risk_penalty: -0.07684, revenue_growth_yoy: 0.16, revenue_cagr_2y: 0.11, operating_margin: 0.04, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: 0.643941, ai_exec_concrete_ratio: 0.600991, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.026206, return_63d: 0.016293 },
  { ticker: "CFLT", price: 30.67, market_cap_b: 11.018765, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 59, opportunity_score: -1.028485, management_ai_execution_score: 0.531289, fundamental_score: -0.295098, valuation_score: -0.217938, valuation_gap_pct: -0.082882, dislocation_score: -1.154226, ai_positioning_score: 0.435057, risk_penalty: 0.723848, revenue_growth_yoy: 0.210769, revenue_cagr_2y: 0.225438, operating_margin: -0.325779, operating_margin_change_2y: 0.290441, fcf_yield: 0.005507, free_cash_flow_b: 0.060677, ai_news_intensity: 0.432491, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.003897, return_63d: 0.022333 },
  { ticker: "AMAT", price: 341.53, market_cap_b: 271.041578, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "AI Compute / Semiconductors", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 58, opportunity_score: -0.899087, management_ai_execution_score: -0.455423, fundamental_score: -0.351978, valuation_score: -0.05179, valuation_gap_pct: -0.019696, dislocation_score: -0.780303, ai_positioning_score: 0.661661, risk_penalty: 0.117897, revenue_growth_yoy: 0.043862, revenue_cagr_2y: 0.034313, operating_margin: 0.292195, operating_margin_change_2y: 0.00355, fcf_yield: 0.022853, free_cash_flow_b: 6.194, ai_news_intensity: 0.674236, ai_exec_concrete_ratio: 0.170008, ai_fear_ratio: 0.048438, ai_net_sentiment: -0.048438, drawdown_252d: -0.135258, return_63d: 0.24125 },
  { ticker: "DDOG", price: 124.52, market_cap_b: 44.061567, signal: "Short", ai_rationale: "", ai_narrative: "", ai_bucket: "Worst Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "incumbent", rank: 57, opportunity_score: -0.824767, management_ai_execution_score: -0.014135, fundamental_score: 0.193652, valuation_score: -1.133455, valuation_gap_pct: -0.431053, dislocation_score: 0.316835, ai_positioning_score: 0.081147, risk_penalty: 0.411476, revenue_growth_yoy: 0.276754, revenue_cagr_2y: 0.26895, operating_margin: -0.012947, operating_margin_change_2y: 0.002775, fcf_yield: 0.022708, free_cash_flow_b: 1.000557, ai_news_intensity: 0.856208, ai_exec_concrete_ratio: 0.334271, ai_fear_ratio: 0.11179, ai_net_sentiment: -0.042405, drawdown_252d: -0.376527, return_63d: -0.176455 },
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
