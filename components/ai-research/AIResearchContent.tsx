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
  { industry_label: "Government & Defense Analytics", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 1.0, avg_valuation_gap_pct: 15.4, avg_dislocation_score: 0.27, avg_opportunity_score: 1.86 },
  { industry_label: "DevOps & Developer Tools", ticker_count: 3, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.67, avg_valuation_gap_pct: 29.7, avg_dislocation_score: 1.88, avg_opportunity_score: 1.02 },
  { industry_label: "Digital Advertising / Social", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.85, avg_valuation_gap_pct: 34.5, avg_dislocation_score: -0.63, avg_opportunity_score: 0.98 },
  { industry_label: "Cloud Hyperscalers", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 99.8, avg_dislocation_score: -0.24, avg_opportunity_score: 0.81 },
  { industry_label: "Creative & Document Software", ticker_count: 2, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.81, avg_valuation_gap_pct: 9.2, avg_dislocation_score: 1.92, avg_opportunity_score: 0.77 },
  { industry_label: "CRM / ERP Platforms", ticker_count: 5, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.98, avg_valuation_gap_pct: 28.2, avg_dislocation_score: 1.56, avg_opportunity_score: 0.64 },
  { industry_label: "Personal Auto Insurance", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.25, avg_valuation_gap_pct: 0.0, avg_dislocation_score: -0.05, avg_opportunity_score: 0.21 },
  { industry_label: "Tax & Accounting Software", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.8, avg_valuation_gap_pct: -30.7, avg_dislocation_score: 2.58, avg_opportunity_score: 0.0 },
  { industry_label: "AI Compute / Semiconductors", ticker_count: 6, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.78, avg_valuation_gap_pct: 0.0, avg_dislocation_score: -0.7, avg_opportunity_score: -0.03 },
  { industry_label: "Data Center Networking", ticker_count: 1, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.88, avg_valuation_gap_pct: 0.0, avg_dislocation_score: -0.81, avg_opportunity_score: -0.06 },
  { industry_label: "Horizontal SaaS / Collaboration", ticker_count: 4, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.49, avg_valuation_gap_pct: -1.2, avg_dislocation_score: 0.59, avg_opportunity_score: -0.09 },
  { industry_label: "Cybersecurity Platforms", ticker_count: 8, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.92, avg_valuation_gap_pct: -17.1, avg_dislocation_score: 0.75, avg_opportunity_score: -0.25 },
  { industry_label: "Commercial / Specialty Insurance", ticker_count: 3, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.63, avg_valuation_gap_pct: 0.0, avg_dislocation_score: -1.25, avg_opportunity_score: -0.29 },
  { industry_label: "FinTech / Payments", ticker_count: 6, switching_class: "high", favored_side: "balanced", avg_switching_cost_score: 0.56, avg_valuation_gap_pct: 0.2, avg_dislocation_score: 0.51, avg_opportunity_score: -0.30 },
  { industry_label: "AI Infrastructure / Servers", ticker_count: 1, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.34, avg_valuation_gap_pct: -0.0, avg_dislocation_score: 0.63, avg_opportunity_score: -0.52 },
  { industry_label: "Data Platforms", ticker_count: 4, switching_class: "high", favored_side: "incumbent", avg_switching_cost_score: 0.76, avg_valuation_gap_pct: 23.9, avg_dislocation_score: 0.40, avg_opportunity_score: -0.54 },
  { industry_label: "IT Services", ticker_count: 6, switching_class: "low", favored_side: "entrant", avg_switching_cost_score: 0.47, avg_valuation_gap_pct: 6.2, avg_dislocation_score: 0.40, avg_opportunity_score: -0.71 },
];

const TICKERS: Ticker[] = [
  { ticker: "GTLB", price: 24.91, market_cap_b: 4.2, signal: "Long", ai_rationale: "Best: DevOps & Developer Tools challenger; dynamics favor entrant; opp +1.96, mgmt +0.58, val gap +52%, op margin -19%, FCF +6%, drawdown -57%, concrete AI +36%, discount AI +11%.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "entrant", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 1.96, management_ai_execution_score: 0.58, fundamental_score: 0.63, valuation_score: 2.14, valuation_gap_pct: 52.4, dislocation_score: 2.66, ai_positioning_score: -1.37, risk_penalty: 0.16, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.19, operating_margin_change_2y: null, fcf_yield: 0.06, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.36, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.572, return_63d: null },
  { ticker: "PLTR", price: 157.16, market_cap_b: 375.9, signal: "Long", ai_rationale: "Best: Government & Defense Analytics incumbent; dynamics favor incumbent; opp +1.86, mgmt +0.95, val gap +15%, op margin +32%, FCF +1%, drawdown -24%, concrete AI +18%, discount AI +1%.", ai_bucket: "Best Pick", industry_label: "Government & Defense Analytics", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 2, opportunity_score: 1.86, management_ai_execution_score: 0.95, fundamental_score: 1.39, valuation_score: 0.67, valuation_gap_pct: 15.4, dislocation_score: 0.27, ai_positioning_score: 0.66, risk_penalty: -0.14, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.32, operating_margin_change_2y: null, fcf_yield: 0.01, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.18, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.241, return_63d: null },
  { ticker: "CRM", price: 202.11, market_cap_b: 186.5, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +1.60, mgmt +0.16, val gap +46%, op margin +20%, FCF +8%, drawdown -31%, concrete AI +34%, discount AI +1%.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 3, opportunity_score: 1.6, management_ai_execution_score: 0.16, fundamental_score: -0.03, valuation_score: 1.99, valuation_gap_pct: 45.9, dislocation_score: 1.67, ai_positioning_score: -0.54, risk_penalty: -0.17, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.2, operating_margin_change_2y: null, fcf_yield: 0.08, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.34, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.306, return_63d: null },
  { ticker: "DOCU", price: 48.69, market_cap_b: 9.8, signal: "Long", ai_rationale: "Best: Creative & Document Software incumbent; dynamics favor incumbent; opp +1.41, mgmt +0.37, val gap +30%, op margin +7%, FCF +10%, drawdown -48%, concrete AI +33%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 4, opportunity_score: 1.41, management_ai_execution_score: 0.37, fundamental_score: 0.02, valuation_score: 1.31, valuation_gap_pct: 30.1, dislocation_score: 2.01, ai_positioning_score: -0.8, risk_penalty: -0.18, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.07, operating_margin_change_2y: null, fcf_yield: 0.1, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.33, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.481, return_63d: null },
  { ticker: "HUBS", price: 296.56, market_cap_b: 15.6, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms challenger; dynamics favor incumbent; opp +1.36, mgmt +0.17, val gap +21%, op margin +0%, FCF +5%, drawdown -56%, concrete AI +40%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 5, opportunity_score: 1.36, management_ai_execution_score: 0.17, fundamental_score: 0.15, valuation_score: 0.9, valuation_gap_pct: 20.7, dislocation_score: 2.91, ai_positioning_score: -1.16, risk_penalty: 0.28, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.0, operating_margin_change_2y: null, fcf_yield: 0.05, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.4, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.559, return_63d: null },
  { ticker: "TEAM", price: 83.62, market_cap_b: 22.1, signal: "Long", ai_rationale: "Best: DevOps & Developer Tools incumbent; dynamics favor incumbent; opp +1.13, mgmt +0.27, val gap +34%, op margin -3%, FCF +6%, drawdown -67%, concrete AI +51%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 6, opportunity_score: 1.13, management_ai_execution_score: 0.27, fundamental_score: 0.05, valuation_score: 1.48, valuation_gap_pct: 34.2, dislocation_score: 2.99, ai_positioning_score: -1.13, risk_penalty: 0.88, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.03, operating_margin_change_2y: null, fcf_yield: 0.06, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.51, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.666, return_63d: null },
  { ticker: "AMZN", price: 213.21, market_cap_b: 2288.8, signal: "Long", ai_rationale: "Best: Cloud Hyperscalers incumbent; dynamics favor incumbent; opp +1.12, mgmt +0.04, val gap +258%, op margin +12%, FCF -0%, drawdown -16%, concrete AI +16%, discount AI +4%.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 7, opportunity_score: 1.12, management_ai_execution_score: 0.04, fundamental_score: -0.37, valuation_score: 2.14, valuation_gap_pct: 258.5, dislocation_score: -0.23, ai_positioning_score: 0.74, risk_penalty: -0.61, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.12, operating_margin_change_2y: null, fcf_yield: -0.0, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.16, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.161, return_63d: null },
  { ticker: "OKTA", price: 80.72, market_cap_b: 14.3, signal: "Long", ai_rationale: "Best: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +1.09, mgmt +0.48, val gap +10%, op margin +5%, FCF +6%, drawdown -37%, concrete AI +28%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 8, opportunity_score: 1.09, management_ai_execution_score: 0.48, fundamental_score: 0.19, valuation_score: 0.43, valuation_gap_pct: 9.9, dislocation_score: 2.15, ai_positioning_score: -0.98, risk_penalty: -0.15, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.05, operating_margin_change_2y: null, fcf_yield: 0.06, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.28, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.366, return_63d: null },
  { ticker: "NOW", price: 124.34, market_cap_b: 130.1, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +1.05, mgmt -0.28, val gap +22%, op margin +14%, FCF +4%, drawdown -40%, concrete AI +33%, discount AI +4%.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 9, opportunity_score: 1.05, management_ai_execution_score: -0.28, fundamental_score: 0.2, valuation_score: 0.97, valuation_gap_pct: 22.5, dislocation_score: 1.8, ai_positioning_score: -0.44, risk_penalty: -0.03, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.14, operating_margin_change_2y: null, fcf_yield: 0.04, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.33, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.405, return_63d: null },
  { ticker: "ROOT", price: 47.98, market_cap_b: 0.7, signal: "Long", ai_rationale: "Best: Personal Auto Insurance entrant; dynamics favor entrant; opp +0.99, mgmt +1.27, val gap +0%, op margin +6%, FCF +28%, drawdown -73%, concrete AI +0%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "Personal Auto Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 10, opportunity_score: 0.99, management_ai_execution_score: 1.27, fundamental_score: 2.24, valuation_score: 0.0, valuation_gap_pct: 0.0, dislocation_score: 1.18, ai_positioning_score: -1.46, risk_penalty: 0.88, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.06, operating_margin_change_2y: null, fcf_yield: 0.28, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.73, return_63d: null },
  { ticker: "META", price: 644.86, market_cap_b: 1631.2, signal: "Long", ai_rationale: "Best: Digital Advertising / Social incumbent; dynamics favor incumbent; opp +0.98, mgmt +0.12, val gap +35%, op margin +41%, FCF +3%, drawdown -18%, concrete AI +16%, discount AI +2%.", ai_bucket: "Best Pick", industry_label: "Digital Advertising / Social", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 0.98, management_ai_execution_score: 0.12, fundamental_score: 0.6, valuation_score: 1.5, valuation_gap_pct: 34.5, dislocation_score: -0.63, ai_positioning_score: 0.53, risk_penalty: -0.32, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.41, operating_margin_change_2y: null, fcf_yield: 0.03, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.16, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.184, return_63d: null },
  { ticker: "FI", price: 63.8, market_cap_b: null, signal: "Long", ai_rationale: "Best: FinTech / Payments incumbent; dynamics favor incumbent; opp +0.97, mgmt +1.42, val gap n/a, op margin +29%, FCF n/a, drawdown -73%, concrete AI +44%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 12, opportunity_score: 0.97, management_ai_execution_score: 1.42, fundamental_score: 0.93, valuation_score: 0, valuation_gap_pct: null, dislocation_score: 1.37, ai_positioning_score: -0.45, risk_penalty: 0.37, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.29, operating_margin_change_2y: null, fcf_yield: null, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.44, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.732, return_63d: null },
  { ticker: "ESTC", price: 53.73, market_cap_b: 5.6, signal: "Long", ai_rationale: "Best: Data Platforms incumbent; dynamics favor incumbent; opp +0.89, mgmt +0.57, val gap +151%, op margin -4%, FCF +5%, drawdown -48%, concrete AI +67%, discount AI +0%.", ai_bucket: "Best Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 13, opportunity_score: 0.89, management_ai_execution_score: 0.57, fundamental_score: -0.14, valuation_score: 2.14, valuation_gap_pct: 151.3, dislocation_score: 0.39, ai_positioning_score: 0.13, risk_penalty: 0.91, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.04, operating_margin_change_2y: null, fcf_yield: 0.05, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.67, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.475, return_63d: null },
  { ticker: "GOOGL", price: 298.52, market_cap_b: 3611.2, signal: "Long", ai_rationale: "Best: Cloud Hyperscalers incumbent; dynamics favor incumbent; opp +0.85, mgmt +0.12, val gap +25%, op margin +32%, FCF +2%, drawdown -13%, concrete AI +24%, discount AI +3%.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 14, opportunity_score: 0.85, management_ai_execution_score: 0.12, fundamental_score: 0.07, valuation_score: 1.1, valuation_gap_pct: 25.4, dislocation_score: -0.48, ai_positioning_score: 0.64, risk_penalty: -0.85, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.32, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.24, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.131, return_63d: null },
  { ticker: "NVDA", price: 177.82, market_cap_b: 4321.0, signal: "Long", ai_rationale: "Best: AI Compute / Semiconductors incumbent; dynamics favor incumbent; opp +0.80, mgmt +0.12, val gap -0%, op margin +60%, FCF +2%, drawdown -14%, concrete AI +12%, discount AI +2%.", ai_bucket: "Best Pick", industry_label: "AI Compute / Semiconductors", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 15, opportunity_score: 0.8, management_ai_execution_score: 0.12, fundamental_score: 1.68, valuation_score: -0.0, valuation_gap_pct: -0.0, dislocation_score: -0.64, ai_positioning_score: 0.31, risk_penalty: -0.55, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.6, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.12, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.141, return_63d: null },
  // --- Shorts ---
  { ticker: "AMAT", price: 324.74, market_cap_b: 257.7, signal: "Short", ai_rationale: "Worst: AI Compute / Semiconductors incumbent; dynamics favor incumbent; opp -0.66, mgmt -0.48, val gap +0%, op margin +29%, FCF +2%, drawdown -18%, concrete AI +13%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "AI Compute / Semiconductors", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 45, opportunity_score: -0.66, management_ai_execution_score: -0.48, fundamental_score: -0.39, valuation_score: -0.0, valuation_gap_pct: 0.0, dislocation_score: -0.62, ai_positioning_score: 0.13, risk_penalty: 0.17, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.29, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.13, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.178, return_63d: null },
  { ticker: "EPAM", price: 145.87, market_cap_b: 7.9, signal: "Short", ai_rationale: "Worst: IT Services challenger; dynamics favor entrant; opp -0.67, mgmt -0.17, val gap -4%, op margin +10%, FCF +8%, drawdown -34%, concrete AI +35%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 46, opportunity_score: -0.67, management_ai_execution_score: -0.17, fundamental_score: -0.48, valuation_score: -0.16, valuation_gap_pct: -3.8, dislocation_score: 1.98, ai_positioning_score: -2.27, risk_penalty: 0.29, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.1, operating_margin_change_2y: null, fcf_yield: 0.08, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.35, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.341, return_63d: null },
  { ticker: "MDB", price: 270.47, market_cap_b: 22.0, signal: "Short", ai_rationale: "Worst: Data Platforms incumbent; dynamics favor incumbent; opp -0.69, mgmt -0.17, val gap -29%, op margin -11%, FCF +2%, drawdown -39%, concrete AI +15%, discount AI +11%.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 47, opportunity_score: -0.69, management_ai_execution_score: -0.17, fundamental_score: 0.02, valuation_score: -1.24, valuation_gap_pct: -28.6, dislocation_score: 1.75, ai_positioning_score: -0.75, risk_penalty: 0.46, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.11, operating_margin_change_2y: null, fcf_yield: 0.02, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.15, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.386, return_63d: null },
  { ticker: "SQ", price: null, market_cap_b: null, signal: "Short", ai_rationale: "Worst: FinTech / Payments challenger; dynamics favor balanced; opp -0.73, mgmt -0.23, val gap n/a, op margin +4%, FCF n/a, drawdown n/a, concrete AI +0%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "balanced", switching_cost_class: "low", role: "challenger", rank: 48, opportunity_score: -0.73, management_ai_execution_score: -0.23, fundamental_score: -0.49, valuation_score: 0, valuation_gap_pct: null, dislocation_score: -0.24, ai_positioning_score: -0.59, risk_penalty: -0.2, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.04, operating_margin_change_2y: null, fcf_yield: null, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: null, return_63d: null },
  { ticker: "CHKP", price: 165.22, market_cap_b: 17.7, signal: "Short", ai_rationale: "Worst: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp -0.78, mgmt -0.15, val gap -23%, op margin +34%, FCF +6%, drawdown -29%, concrete AI +47%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 49, opportunity_score: -0.78, management_ai_execution_score: -0.15, fundamental_score: 0.05, valuation_score: -1.01, valuation_gap_pct: -23.3, dislocation_score: -0.28, ai_positioning_score: 0.38, risk_penalty: -0.15, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.34, operating_margin_change_2y: null, fcf_yield: 0.06, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.47, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.292, return_63d: null },
  { ticker: "SNOW", price: 180.48, market_cap_b: 61.8, signal: "Short", ai_rationale: "Worst: Data Platforms incumbent; dynamics favor incumbent; opp -0.81, mgmt +0.14, val gap -14%, op margin -40%, FCF +1%, drawdown -35%, concrete AI +34%, discount AI +3%.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 50, opportunity_score: -0.81, management_ai_execution_score: 0.14, fundamental_score: -0.49, valuation_score: -0.6, valuation_gap_pct: -13.7, dislocation_score: 1.1, ai_positioning_score: -0.45, risk_penalty: 1.58, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.4, operating_margin_change_2y: null, fcf_yield: 0.01, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.34, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.349, return_63d: null },
  { ticker: "CRWD", price: 428.99, market_cap_b: 108.1, signal: "Short", ai_rationale: "Worst: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp -0.99, mgmt +0.11, val gap -46%, op margin -6%, FCF +1%, drawdown -23%, concrete AI +43%, discount AI +5%.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 51, opportunity_score: -0.99, management_ai_execution_score: 0.11, fundamental_score: -0.19, valuation_score: -1.69, valuation_gap_pct: -45.5, dislocation_score: 0.72, ai_positioning_score: -0.09, risk_penalty: 0.6, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.06, operating_margin_change_2y: null, fcf_yield: 0.01, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.43, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.231, return_63d: null },
  { ticker: "GLOB", price: 51.61, market_cap_b: 2.2, signal: "Short", ai_rationale: "Worst: IT Services challenger; dynamics favor entrant; opp -1.04, mgmt -0.61, val gap n/a, op margin +7%, FCF n/a, drawdown -63%, concrete AI +0%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 52, opportunity_score: -1.04, management_ai_execution_score: -0.61, fundamental_score: -0.75, valuation_score: 0, valuation_gap_pct: null, dislocation_score: 0.76, ai_positioning_score: -1.1, risk_penalty: 0.13, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.07, operating_margin_change_2y: null, fcf_yield: null, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.633, return_63d: null },
  { ticker: "ORCL", price: 152.96, market_cap_b: 439.6, signal: "Short", ai_rationale: "Worst: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp -1.12, mgmt -0.52, val gap +24%, op margin +31%, FCF -3%, drawdown -53%, concrete AI +24%, discount AI +2%.", ai_bucket: "Worst Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 53, opportunity_score: -1.12, management_ai_execution_score: -0.52, fundamental_score: -0.32, valuation_score: 1.03, valuation_gap_pct: 23.7, dislocation_score: 0.91, ai_positioning_score: 0.23, risk_penalty: 4.21, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.31, operating_margin_change_2y: null, fcf_yield: -0.03, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.24, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.534, return_63d: null },
  { ticker: "FIS", price: 51.49, market_cap_b: 26.5, signal: "Short", ai_rationale: "Worst: FinTech / Payments incumbent; dynamics favor balanced; opp -1.14, mgmt +0.58, val gap -25%, op margin +16%, FCF +7%, drawdown -37%, concrete AI +100%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "incumbent", rank: 54, opportunity_score: -1.14, management_ai_execution_score: 0.58, fundamental_score: -0.75, valuation_score: -1.08, valuation_gap_pct: -24.8, dislocation_score: 0.04, ai_positioning_score: -0.47, risk_penalty: 0.43, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.16, operating_margin_change_2y: null, fcf_yield: 0.07, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.375, return_63d: null },
  { ticker: "AFRM", price: 51.7, market_cap_b: 17.2, signal: "Short", ai_rationale: "Worst: FinTech / Payments entrant; dynamics favor entrant; opp -1.25, mgmt +1.50, val gap -5%, op margin -159%, FCF +4%, drawdown -44%, concrete AI +51%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 55, opportunity_score: -1.25, management_ai_execution_score: 1.5, fundamental_score: 0.41, valuation_score: -0.21, valuation_gap_pct: -4.9, dislocation_score: 0.26, ai_positioning_score: -0.64, risk_penalty: 4.48, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -1.59, operating_margin_change_2y: null, fcf_yield: 0.04, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.51, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.439, return_63d: null },
  { ticker: "ZM", price: 77.5, market_cap_b: 22.8, signal: "Short", ai_rationale: "Worst: Horizontal SaaS / Collaboration incumbent; dynamics favor entrant; opp -1.39, mgmt +0.33, val gap -41%, op margin +23%, FCF +8%, drawdown -19%, concrete AI +45%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 56, opportunity_score: -1.39, management_ai_execution_score: 0.33, fundamental_score: 0.04, valuation_score: -1.69, valuation_gap_pct: -41.0, dislocation_score: -0.59, ai_positioning_score: -0.79, risk_penalty: -0.26, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.23, operating_margin_change_2y: null, fcf_yield: 0.08, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.45, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.195, return_63d: null },
  { ticker: "CFLT", price: 30.77, market_cap_b: 11.0, signal: "Short", ai_rationale: "Worst: Data Platforms challenger; dynamics favor incumbent; opp -1.56, mgmt +0.24, val gap -13%, op margin -33%, FCF +1%, drawdown -0%, concrete AI +0%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 57, opportunity_score: -1.56, management_ai_execution_score: 0.24, fundamental_score: -0.25, valuation_score: -0.58, valuation_gap_pct: -13.4, dislocation_score: -1.63, ai_positioning_score: -0.02, risk_penalty: 1.41, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.33, operating_margin_change_2y: null, fcf_yield: 0.01, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.001, return_63d: null },
  { ticker: "NET", price: 195.19, market_cap_b: 68.7, signal: "Short", ai_rationale: "Worst: Cybersecurity Platforms challenger; dynamics favor incumbent; opp -1.87, mgmt -0.06, val gap -58%, op margin -10%, FCF +0%, drawdown -23%, concrete AI +26%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 58, opportunity_score: -1.87, management_ai_execution_score: -0.06, fundamental_score: -0.34, valuation_score: -1.69, valuation_gap_pct: -58.5, dislocation_score: 1.04, ai_positioning_score: -0.71, risk_penalty: 2.81, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: -0.1, operating_margin_change_2y: null, fcf_yield: 0.0, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.26, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.229, return_63d: null },
  { ticker: "IBM", price: 258.85, market_cap_b: 242.8, signal: "Short", ai_rationale: "Worst: IT Services incumbent; dynamics favor entrant; opp -2.52, mgmt -0.06, val gap -37%, op margin +18%, FCF +5%, drawdown -18%, concrete AI +47%, discount AI +0%.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 59, opportunity_score: -2.52, management_ai_execution_score: -0.06, fundamental_score: -0.6, valuation_score: -1.61, valuation_gap_pct: -37.1, dislocation_score: -0.19, ai_positioning_score: -1.17, risk_penalty: 1.87, revenue_growth_yoy: null, revenue_cagr_2y: null, operating_margin: 0.18, operating_margin_change_2y: null, fcf_yield: 0.05, free_cash_flow_b: null, ai_news_intensity: null, ai_exec_concrete_ratio: 0.47, ai_fear_ratio: null, ai_net_sentiment: null, drawdown_252d: -0.178, return_63d: null },
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
                    <TickerDetailPanel ticker={t.ticker} detail={detail} colSpan={12} />
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
