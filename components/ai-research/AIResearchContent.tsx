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
  { ticker: "GTLB", price: 25.37, market_cap_b: 4.194844, signal: "Long", ai_rationale: "Best: DevOps & Developer Tools challenger; dynamics favor entrant; opp +1.64, mgmt +0.59, val gap +137%, op margin -19%, FCF +6%, drawdown -59%, concrete AI +36%, discount AI +11%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates GTLB's fundamentals warrant a higher P/S multiple than its current 4.4x EV/S, producing a 137% gap — though this model explains only part of cross-company valuation differences. The stock is down 42% over 3 months (126d: 46%). Key risk: as a challenger, GTLB faces structural headwinds — DevOps & Developer Tools dynamics may favor established incumbents.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "entrant", switching_cost_class: "high", role: "challenger", rank: 1, opportunity_score: 1.639777, management_ai_execution_score: 0.586503, fundamental_score: 0.555571, valuation_score: 2.5, valuation_gap_pct: 1.366256, dislocation_score: 2.136635, ai_positioning_score: -1.259103, risk_penalty: 0.444629, revenue_growth_yoy: 0.309262, revenue_cagr_2y: 0.337634, operating_margin: -0.187969, operating_margin_change_2y: 0.310247, fcf_yield: 0.057764, free_cash_flow_b: 0.24231, ai_news_intensity: 0.910964, ai_exec_concrete_ratio: 0.359621, ai_fear_ratio: 0.274103, ai_net_sentiment: -0.274103, drawdown_252d: -0.589416, return_63d: -0.415033 },
  { ticker: "HUBS", price: 291.47, market_cap_b: 15.640733, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms challenger; dynamics favor incumbent; opp +1.36, mgmt +0.17, val gap +39%, op margin +0%, FCF +5%, drawdown -58%, concrete AI +40%, discount AI +0%.", ai_narrative: "HUBS has sold off significantly (down 22% over 3 months, 58% off its 52-week high), which scores high on our dislocation metric. The valuation model also flags a 39% gap vs. estimated fair P/S. Key risk: as a challenger, HUBS faces structural headwinds — CRM / ERP Platforms dynamics may favor established incumbents.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 2, opportunity_score: 1.363454, management_ai_execution_score: 0.16849, fundamental_score: 0.14264, valuation_score: 1.651165, valuation_gap_pct: 0.386218, dislocation_score: 2.068134, ai_positioning_score: -0.917144, risk_penalty: 0.158077, revenue_growth_yoy: 0.191709, revenue_cagr_2y: 0.201177, operating_margin: 0.002357, operating_margin_change_2y: 0.094941, fcf_yield: 0.045238, free_cash_flow_b: 0.707552, ai_news_intensity: 0.751455, ai_exec_concrete_ratio: 0.396545, ai_fear_ratio: 0.445595, ai_net_sentiment: -0.445595, drawdown_252d: -0.582619, return_63d: -0.219249 },
  { ticker: "TEAM", price: 82.51, market_cap_b: 22.054279, signal: "Long", ai_rationale: "Best: DevOps & Developer Tools incumbent; dynamics favor incumbent; opp +1.31, mgmt +0.28, val gap +57%, op margin -3%, FCF +6%, drawdown -70%, concrete AI +51%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates TEAM's fundamentals warrant a higher P/S multiple than its current 3.8x EV/S, producing a 57% gap — though this model explains only part of cross-company valuation differences. The stock is down 46% over 3 months (126d: 52%). Key risk: as an incumbent, TEAM faces structural headwinds — AI disruption in DevOps & Developer Tools may erode traditional advantages.", ai_bucket: "Best Pick", industry_label: "DevOps & Developer Tools", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 3, opportunity_score: 1.308244, management_ai_execution_score: 0.276644, fundamental_score: 0.011736, valuation_score: 2.445207, valuation_gap_pct: 0.571949, dislocation_score: 2.411149, ai_positioning_score: -1.023261, risk_penalty: 0.713721, revenue_growth_yoy: 0.196554, revenue_cagr_2y: 0.214694, operating_margin: -0.025002, operating_margin_change_2y: 0.072666, fcf_yield: 0.058118, free_cash_flow_b: 1.281752, ai_news_intensity: 0.594158, ai_exec_concrete_ratio: 0.505939, ai_fear_ratio: 0.262882, ai_net_sentiment: -0.262882, drawdown_252d: -0.701839, return_63d: -0.463907 },
  { ticker: "SAP", price: 199.48, market_cap_b: 235.541206, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +1.30, mgmt +0.04, val gap +55%, op margin +28%, FCF +2%, drawdown -36%, concrete AI +60%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates SAP's fundamentals warrant a higher P/S multiple than its current 8.1x EV/S, producing a 55% gap — though this model explains only part of cross-company valuation differences. The stock is down 17% over 3 months (126d: 26%).", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 4, opportunity_score: 1.303946, management_ai_execution_score: 0.040818, fundamental_score: 0.180812, valuation_score: 2.345259, valuation_gap_pct: 0.548571, dislocation_score: 0.332282, ai_positioning_score: 0.105634, risk_penalty: -0.209168, revenue_growth_yoy: 0.19, revenue_cagr_2y: 0.12, operating_margin: 0.283, operating_margin_change_2y: null, fcf_yield: 0.025, free_cash_flow_b: null, ai_news_intensity: 0.7579, ai_exec_concrete_ratio: 0.603663, ai_fear_ratio: 0.087962, ai_net_sentiment: -0.087962, drawdown_252d: -0.360498, return_63d: -0.174748 },
  { ticker: "CYBR", price: 408.85, market_cap_b: null, signal: "Long", ai_rationale: "Best: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +1.13, mgmt +0.37, val gap +106%, op margin -6%, FCF +1%, drawdown -22%, concrete AI +57%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates CYBR's fundamentals warrant a higher P/S multiple than its current 23.0x EV/S, producing a 106% gap — though this model explains only part of cross-company valuation differences. The dislocation score is a headwind (-0.45).", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 5, opportunity_score: 1.126237, management_ai_execution_score: 0.370072, fundamental_score: 0.234388, valuation_score: 2.5, valuation_gap_pct: 1.06494, dislocation_score: -0.449348, ai_positioning_score: 0.403298, risk_penalty: 0.302766, revenue_growth_yoy: 0.43, revenue_cagr_2y: 0.46, operating_margin: -0.059, operating_margin_change_2y: null, fcf_yield: 0.012, free_cash_flow_b: null, ai_news_intensity: 0.364015, ai_exec_concrete_ratio: 0.569104, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.216792, return_63d: -0.18858 },
  { ticker: "AMZN", price: 218.94, market_cap_b: 2288.79, signal: "Long", ai_rationale: "Best: Cloud Hyperscalers incumbent; dynamics favor incumbent; opp +1.12, mgmt +0.07, val gap +136%, op margin +11%, FCF +0%, drawdown -14%, concrete AI +14%, discount AI +5%.", ai_narrative: "Our regression model (fitted on 59 cross-sector companies) estimates AMZN's fundamentals warrant a higher P/S multiple than its current 3.2x EV/S, producing a 136% gap — though this model explains only part of cross-company valuation differences. The AI positioning signal also contributes meaningfully. Fundamentals are a drag on the overall score.", ai_bucket: "Best Pick", industry_label: "Cloud Hyperscalers", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 6, opportunity_score: 1.122145, management_ai_execution_score: 0.068903, fundamental_score: -0.382523, valuation_score: 2.5, valuation_gap_pct: 1.359498, dislocation_score: -0.367631, ai_positioning_score: 0.661237, risk_penalty: -0.501465, revenue_growth_yoy: 0.123778, revenue_cagr_2y: 0.116822, operating_margin: 0.1116, operating_margin_change_2y: 0.052575, fcf_yield: 0.003364, free_cash_flow_b: 7.7, ai_news_intensity: 0.710093, ai_exec_concrete_ratio: 0.141215, ai_fear_ratio: 0.082497, ai_net_sentiment: -0.023775, drawdown_252d: -0.138031, return_63d: -0.066035 },
  { ticker: "DOCU", price: 48.23, market_cap_b: 9.75128, signal: "Long", ai_rationale: "Best: Creative & Document Software incumbent; dynamics favor incumbent; opp +1.11, mgmt +0.39, val gap +29%, op margin +7%, FCF +10%, drawdown -49%, concrete AI +33%, discount AI +0%.", ai_narrative: "DOCU has sold off significantly (down 30% over 3 months, 49% off its 52-week high), which scores high on our dislocation metric. The valuation model also flags a 29% gap vs. estimated fair P/S. Key risk: as an incumbent, DOCU faces structural headwinds — AI disruption in Creative & Document Software may erode traditional advantages.", ai_bucket: "Best Pick", industry_label: "Creative & Document Software", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 7, opportunity_score: 1.105949, management_ai_execution_score: 0.393171, fundamental_score: 0.061948, valuation_score: 1.239526, valuation_gap_pct: 0.289933, dislocation_score: 1.476311, ai_positioning_score: -0.706094, risk_penalty: -0.170906, revenue_growth_yoy: 0.077794, revenue_cagr_2y: 0.087733, operating_margin: 0.067163, operating_margin_change_2y: 0.102153, fcf_yield: 0.101313, free_cash_flow_b: 0.987933, ai_news_intensity: 0.717433, ai_exec_concrete_ratio: 0.33011, ai_fear_ratio: 0.221829, ai_net_sentiment: -0.221829, drawdown_252d: -0.48604, return_63d: -0.299593 },
  { ticker: "META", price: 660.57, market_cap_b: 1631.21, signal: "Long", ai_rationale: "Best: Digital Advertising / Social incumbent; dynamics favor incumbent; opp +1.10, mgmt +0.11, val gap +44%, op margin +41%, FCF +3%, drawdown -16%, concrete AI +16%, discount AI +3%.", ai_narrative: "Our regression model (fitted on 59 cross-sector companies) estimates META's fundamentals warrant a higher P/S multiple than its current 8.2x EV/S, producing a 44% gap — though this model explains only part of cross-company valuation differences. Fundamentals support this: 22% revenue growth, 22% 2Y CAGR. The dislocation score is a headwind (-0.70).", ai_bucket: "Best Pick", industry_label: "Digital Advertising / Social", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 8, opportunity_score: 1.095673, management_ai_execution_score: 0.109268, fundamental_score: 0.674829, valuation_score: 1.871459, valuation_gap_pct: 0.437746, dislocation_score: -0.695755, ai_positioning_score: 0.535971, risk_penalty: -0.297588, revenue_growth_yoy: 0.22167, revenue_cagr_2y: 0.22054, operating_margin: 0.414379, operating_margin_change_2y: 0.067823, fcf_yield: 0.026729, free_cash_flow_b: 43.6, ai_news_intensity: 0.866356, ai_exec_concrete_ratio: 0.163236, ai_fear_ratio: 0.027223, ai_net_sentiment: 0.0307, drawdown_252d: -0.163835, return_63d: 0.020816 },
  { ticker: "ESTC", price: 53.02, market_cap_b: 5.595882, signal: "Long", ai_rationale: "Best: Data Platforms incumbent; dynamics favor incumbent; opp +1.06, mgmt +0.58, val gap +129%, op margin -4%, FCF +5%, drawdown -52%, concrete AI +67%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates ESTC's fundamentals warrant a higher P/S multiple than its current 3.2x EV/S, producing a 129% gap — though this model explains only part of cross-company valuation differences. AI execution is tangible — 67% of coverage cites concrete deployments, not just strategy talk.", ai_bucket: "Best Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 9, opportunity_score: 1.056561, management_ai_execution_score: 0.579866, fundamental_score: -0.193771, valuation_score: 2.5, valuation_gap_pct: 1.29429, dislocation_score: 0.370779, ai_positioning_score: 0.149565, risk_penalty: 0.644163, revenue_growth_yoy: 0.170419, revenue_cagr_2y: 0.177951, operating_margin: -0.037027, operating_margin_change_2y: 0.168, fcf_yield: 0.0459, free_cash_flow_b: 0.256849, ai_news_intensity: 0.558618, ai_exec_concrete_ratio: 0.667938, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.516373, return_63d: -0.266261 },
  { ticker: "SOFI", price: 19.25, market_cap_b: 24.102487, signal: "Long", ai_rationale: "Best: FinTech / Payments challenger; dynamics favor entrant; opp +0.93, mgmt +0.73, val gap +19%, op margin +15%, FCF +2%, drawdown -40%, concrete AI +24%, discount AI +0%.", ai_narrative: "SOFI ranks above peers on fundamentals: 53% YoY revenue growth, 83.0% gross margin, 14.7% operating margin, 1.7% FCF yield. The valuation model also flags a 19% gap vs. estimated fair P/S. Key risk: as a challenger, SOFI faces structural headwinds — FinTech / Payments dynamics may favor established incumbents.", ai_bucket: "Best Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 10, opportunity_score: 0.929467, management_ai_execution_score: 0.73149, fundamental_score: 1.189003, valuation_score: 0.809671, valuation_gap_pct: 0.189387, dislocation_score: 0.195389, ai_positioning_score: -0.638107, risk_penalty: -0.038439, revenue_growth_yoy: 0.531099, revenue_cagr_2y: 0.240453, operating_margin: 0.147, operating_margin_change_2y: 0.4, fcf_yield: 0.016596, free_cash_flow_b: 0.4, ai_news_intensity: 0.195798, ai_exec_concrete_ratio: 0.236471, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.40236, return_63d: -0.347679 },
  { ticker: "CRM", price: 201.39, market_cap_b: 186.54753, signal: "Long", ai_rationale: "Best: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp +0.86, mgmt +0.16, val gap +25%, op margin +20%, FCF +8%, drawdown -31%, concrete AI +33%, discount AI +1%.", ai_narrative: "CRM has sold off significantly (down 14% over 3 months, 31% off its 52-week high), which scores high on our dislocation metric. The valuation model also flags a 25% gap vs. estimated fair P/S. Key risk: as an incumbent, CRM faces structural headwinds — AI disruption in CRM / ERP Platforms may erode traditional advantages.", ai_bucket: "Best Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 11, opportunity_score: 0.864766, management_ai_execution_score: 0.162522, fundamental_score: 0.007749, valuation_score: 1.072863, valuation_gap_pct: 0.250949, dislocation_score: 1.084861, ai_positioning_score: -0.430219, risk_penalty: -0.17936, revenue_growth_yoy: 0.095791, revenue_cagr_2y: 0.091465, operating_margin: 0.200626, operating_margin_change_2y: 0.056867, fcf_yield: 0.077203, free_cash_flow_b: 14.402, ai_news_intensity: 0.88947, ai_exec_concrete_ratio: 0.3307, ai_fear_ratio: 0.266254, ai_net_sentiment: -0.229235, drawdown_252d: -0.310237, return_63d: -0.141962 },
  { ticker: "FTNT", price: 84.42, market_cap_b: 61.909406, signal: "Long", ai_rationale: "Best: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +0.81, mgmt +0.17, val gap +35%, op margin +31%, FCF +4%, drawdown -22%, concrete AI +55%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates FTNT's fundamentals warrant a higher P/S multiple than its current 8.9x EV/S, producing a 35% gap — though this model explains only part of cross-company valuation differences. Fundamentals support this: 14% revenue growth, 13% 2Y CAGR.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 12, opportunity_score: 0.80842, management_ai_execution_score: 0.171178, fundamental_score: 0.268304, valuation_score: 1.502514, valuation_gap_pct: 0.351448, dislocation_score: -0.154179, ai_positioning_score: 0.036302, risk_penalty: 0.155884, revenue_growth_yoy: 0.141677, revenue_cagr_2y: 0.132158, operating_margin: 0.305062, operating_margin_change_2y: 0.071971, fcf_yield: 0.035953, free_cash_flow_b: 2.2258, ai_news_intensity: 0.429317, ai_exec_concrete_ratio: 0.553046, ai_fear_ratio: 0.104063, ai_net_sentiment: -0.104063, drawdown_252d: -0.223296, return_63d: 0.017844 },
  { ticker: "OKTA", price: 79.65, market_cap_b: 14.306023, signal: "Long", ai_rationale: "Best: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp +0.80, mgmt +0.60, val gap +13%, op margin +5%, FCF +6%, drawdown -37%, concrete AI +40%, discount AI +0%.", ai_narrative: "OKTA has sold off significantly (down 3% over 3 months, 37% off its 52-week high), which scores high on our dislocation metric. AI execution is tangible — 40% of coverage cites concrete deployments, not just strategy talk. Key risk: as an incumbent, OKTA faces structural headwinds — AI disruption in Cybersecurity Platforms may erode traditional advantages.", ai_bucket: "Best Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 13, opportunity_score: 0.800141, management_ai_execution_score: 0.59967, fundamental_score: 0.19955, valuation_score: 0.545764, valuation_gap_pct: 0.127658, dislocation_score: 1.063303, ai_positioning_score: -0.570311, risk_penalty: -0.137358, revenue_growth_yoy: 0.118391, revenue_cagr_2y: 0.135729, operating_margin: 0.051045, operating_margin_change_2y: 0.279061, fcf_yield: 0.060324, free_cash_flow_b: 0.863, ai_news_intensity: 0.459768, ai_exec_concrete_ratio: 0.404939, ai_fear_ratio: 0.259429, ai_net_sentiment: -0.259429, drawdown_252d: -0.374313, return_63d: -0.027116 },
  { ticker: "ROOT", price: 48.0, market_cap_b: 0.746312, signal: "Long", ai_rationale: "Best: Personal Auto Insurance entrant; dynamics favor entrant; opp +0.78, mgmt +1.27, val gap -0%, op margin +4%, FCF +28%, drawdown -73%, concrete AI +0%, discount AI +0%.", ai_narrative: "ROOT ranks above peers on fundamentals: 29% YoY revenue growth, 37.7% gross margin, 4.1% operating margin, 27.5% FCF yield. The management execution signal also contributes meaningfully. Key risk: as an entrant, ROOT faces structural headwinds — Personal Auto Insurance dynamics may favor established incumbents.", ai_bucket: "Best Pick", industry_label: "Personal Auto Insurance", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 14, opportunity_score: 0.783632, management_ai_execution_score: 1.26978, fundamental_score: 1.681415, valuation_score: 0.0, valuation_gap_pct: -0.0, dislocation_score: 1.022302, ai_positioning_score: -1.367756, risk_penalty: 0.360517, revenue_growth_yoy: 0.29, revenue_cagr_2y: 0.945609, operating_margin: 0.041, operating_margin_change_2y: 0.4, fcf_yield: 0.275488, free_cash_flow_b: 0.2056, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.729867, return_63d: -0.376056 },
  { ticker: "CTSH", price: 65.78, market_cap_b: 31.688641, signal: "Long", ai_rationale: "Best: IT Services incumbent; dynamics favor entrant; opp +0.75, mgmt +0.41, val gap +113%, op margin +16%, FCF +8%, drawdown -24%, concrete AI +48%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 12 services/fintech companies) estimates CTSH's fundamentals warrant a higher P/S multiple than its current 1.4x EV/S, producing a 113% gap — though this model explains only part of cross-company valuation differences. AI execution is tangible — 48% of coverage cites concrete deployments, not just strategy talk. Key risk: as an incumbent, CTSH faces structural headwinds — AI disruption in IT Services may erode traditional advantages.", ai_bucket: "Best Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 15, opportunity_score: 0.749396, management_ai_execution_score: 0.410235, fundamental_score: -0.459271, valuation_score: 2.5, valuation_gap_pct: 1.127781, dislocation_score: -0.43357, ai_positioning_score: -0.737485, risk_penalty: -0.384917, revenue_growth_yoy: 0.069518, revenue_cagr_2y: 0.044358, operating_margin: 0.157618, operating_margin_change_2y: 0.018673, fcf_yield: 0.081891, free_cash_flow_b: 2.595, ai_news_intensity: 0.609329, ai_exec_concrete_ratio: 0.484968, ai_fear_ratio: 0.0, ai_net_sentiment: 0.086369, drawdown_252d: -0.241292, return_63d: -0.153302 },
  { ticker: "ACN", price: 214.0, market_cap_b: 132.318559, signal: "Short", ai_rationale: "Worst: IT Services incumbent; dynamics favor entrant; opp -0.54, mgmt +0.01, val gap -1%, op margin +15%, FCF +9%, drawdown -39%, concrete AI +36%, discount AI +0%.", ai_narrative: "As an incumbent in IT Services, ACN's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The fundamentals signal reinforces the concern.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 45, opportunity_score: -0.541214, management_ai_execution_score: 0.009137, fundamental_score: -0.54299, valuation_score: -0.051663, valuation_gap_pct: -0.012084, dislocation_score: 0.296109, ai_positioning_score: -1.100896, risk_penalty: -0.200011, revenue_growth_yoy: 0.015, revenue_cagr_2y: 0.04247, operating_margin: 0.146767, operating_margin_change_2y: 0.009352, fcf_yield: 0.086999, free_cash_flow_b: 11.511594, ai_news_intensity: 0.633677, ai_exec_concrete_ratio: 0.363459, ai_fear_ratio: 0.067819, ai_net_sentiment: -0.045232, drawdown_252d: -0.385517, return_63d: -0.180139 },
  { ticker: "MDB", price: 263.93, market_cap_b: 22.014029, signal: "Short", ai_rationale: "Worst: Data Platforms incumbent; dynamics favor incumbent; opp -0.67, mgmt -0.17, val gap -27%, op margin -11%, FCF +2%, drawdown -40%, concrete AI +18%, discount AI +12%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates MDB's fundamentals don't justify its current 9.1x EV/S, showing a 27% overvaluation gap. The AI positioning signal reinforces the concern. Counterpoint: already down 34% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 46, opportunity_score: -0.671021, management_ai_execution_score: -0.170267, fundamental_score: -0.03585, valuation_score: -1.172097, valuation_gap_pct: -0.274161, dislocation_score: 1.481705, ai_positioning_score: -0.79034, risk_penalty: 0.425962, revenue_growth_yoy: 0.192175, revenue_cagr_2y: 0.250041, operating_margin: -0.107685, operating_margin_change_2y: 0.162287, fcf_yield: 0.01573, free_cash_flow_b: 0.346277, ai_news_intensity: 0.580243, ai_exec_concrete_ratio: 0.179515, ai_fear_ratio: 0.252451, ai_net_sentiment: -0.252451, drawdown_252d: -0.400976, return_63d: -0.343441 },
  { ticker: "FIS", price: 50.58, market_cap_b: 26.486646, signal: "Short", ai_rationale: "Worst: FinTech / Payments incumbent; dynamics favor balanced; opp -0.68, mgmt +0.61, val gap -16%, op margin +16%, FCF +7%, drawdown -39%, concrete AI +100%, discount AI +0%.", ai_narrative: "FIS lags FinTech / Payments peers on fundamentals: slower growth (5% YoY). The valuation model also flags a 16% overvaluation vs. estimated P/S. Counterpoint: management execution is genuinely strong (100% concrete AI coverage).", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "balanced", switching_cost_class: "high", role: "incumbent", rank: 47, opportunity_score: -0.682188, management_ai_execution_score: 0.607209, fundamental_score: -0.744581, valuation_score: -0.694795, valuation_gap_pct: -0.162517, dislocation_score: 0.026132, ai_positioning_score: -0.449332, risk_penalty: 0.214515, revenue_growth_yoy: 0.05431, revenue_cagr_2y: 0.042139, operating_margin: 0.163061, operating_margin_change_2y: 0.015873, fcf_yield: 0.068978, free_cash_flow_b: 1.827, ai_news_intensity: 0.279422, ai_exec_concrete_ratio: 1.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.385792, return_63d: -0.242814 },
  { ticker: "ASAN", price: 7.91, market_cap_b: 1.887316, signal: "Short", ai_rationale: "Worst: Horizontal SaaS / Collaboration challenger; dynamics favor entrant; opp -0.69, mgmt +0.44, val gap -14%, op margin -37%, FCF +3%, drawdown -58%, concrete AI +0%, discount AI +0%.", ai_narrative: "As a challenger in Horizontal SaaS / Collaboration, ASAN's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The valuation model also flags a 14% overvaluation vs. estimated P/S. Counterpoint: already down 41% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 48, opportunity_score: -0.687843, management_ai_execution_score: 0.438895, fundamental_score: -0.076209, valuation_score: -0.58901, valuation_gap_pct: -0.137773, dislocation_score: 0.709725, ai_positioning_score: -1.018536, risk_penalty: 0.880501, revenue_growth_yoy: 0.109382, revenue_cagr_2y: 0.150149, operating_margin: -0.368482, operating_margin_change_2y: 0.376798, fcf_yield: 0.034517, free_cash_flow_b: 0.065145, ai_news_intensity: 1.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.583684, return_63d: -0.409261 },
  { ticker: "AFRM", price: 52.5, market_cap_b: 17.221821, signal: "Short", ai_rationale: "Worst: FinTech / Payments entrant; dynamics favor entrant; opp -0.85, mgmt +1.50, val gap -31%, op margin +3%, FCF +4%, drawdown -43%, concrete AI +51%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 12 services/fintech companies) estimates AFRM's fundamentals don't justify its current 19.0x EV/S, showing a 31% overvaluation gap. The AI positioning signal reinforces the concern. Counterpoint: management execution is genuinely strong (51% concrete AI coverage).", ai_bucket: "Worst Pick", industry_label: "FinTech / Payments", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "entrant", rank: 49, opportunity_score: -0.853683, management_ai_execution_score: 1.499316, fundamental_score: 0.347713, valuation_score: -1.321838, valuation_gap_pct: -0.309186, dislocation_score: 0.101916, ai_positioning_score: -0.56015, risk_penalty: 2.131797, revenue_growth_yoy: 0.348614, revenue_cagr_2y: 0.33298, operating_margin: 0.032, operating_margin_change_2y: 0.4, fcf_yield: 0.03595, free_cash_flow_b: 0.619133, ai_news_intensity: 0.162365, ai_exec_concrete_ratio: 0.509332, ai_fear_ratio: 0.0, ai_net_sentiment: 0.360094, drawdown_252d: -0.430462, return_63d: -0.216652 },
  { ticker: "CRWD", price: 426.16, market_cap_b: 108.14771, signal: "Short", ai_rationale: "Worst: Cybersecurity Platforms incumbent; dynamics favor incumbent; opp -0.92, mgmt +0.12, val gap -49%, op margin -6%, FCF +1%, drawdown -24%, concrete AI +45%, discount AI +6%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates CRWD's fundamentals don't justify its current 21.5x EV/S, showing a 49% overvaluation gap. Fundamentals are a concern: -6.1% operating margin hasn't proven sustainable profitability. Counterpoint: already down 17% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 50, opportunity_score: -0.922852, management_ai_execution_score: 0.117098, fundamental_score: -0.248222, valuation_score: -1.741853, valuation_gap_pct: -0.489888, dislocation_score: 0.415034, ai_positioning_score: -0.052878, risk_penalty: 0.477396, revenue_growth_yoy: 0.217112, revenue_cagr_2y: 0.254926, operating_margin: -0.06095, operating_margin_change_2y: -0.054686, fcf_yield: 0.012115, free_cash_flow_b: 1.310241, ai_news_intensity: 0.792206, ai_exec_concrete_ratio: 0.452824, ai_fear_ratio: 0.162905, ai_net_sentiment: -0.118599, drawdown_252d: -0.235629, return_63d: -0.174988 },
  { ticker: "ORCL", price: 154.79, market_cap_b: 439.620959, signal: "Short", ai_rationale: "Worst: CRM / ERP Platforms incumbent; dynamics favor incumbent; opp -0.95, mgmt -0.53, val gap +5%, op margin +31%, FCF -0%, drawdown -53%, concrete AI +22%, discount AI +3%.", ai_narrative: "ORCL scores below peers on management AI execution. Counterpoint: already down 23% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "CRM / ERP Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 51, opportunity_score: -0.954656, management_ai_execution_score: -0.534982, fundamental_score: -0.276444, valuation_score: 0.231569, valuation_gap_pct: 0.054165, dislocation_score: 0.663574, ai_positioning_score: 0.279325, risk_penalty: 2.848591, revenue_growth_yoy: 0.083798, revenue_cagr_2y: 0.071931, operating_margin: 0.307984, operating_margin_change_2y: 0.045883, fcf_yield: -0.00091, free_cash_flow_b: -0.4, ai_news_intensity: 0.849612, ai_exec_concrete_ratio: 0.218719, ai_fear_ratio: 0.059983, ai_net_sentiment: -0.04366, drawdown_252d: -0.528554, return_63d: -0.230283 },
  { ticker: "EPAM", price: 144.58, market_cap_b: 7.897397, signal: "Short", ai_rationale: "Worst: IT Services challenger; dynamics favor entrant; opp -0.96, mgmt -0.16, val gap -17%, op margin +10%, FCF +8%, drawdown -35%, concrete AI +35%, discount AI +0%.", ai_narrative: "As a challenger in IT Services, EPAM's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The valuation model also flags a 17% overvaluation vs. estimated P/S. Counterpoint: already down 25% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 52, opportunity_score: -0.964385, management_ai_execution_score: -0.160648, fundamental_score: -0.490002, valuation_score: -0.7275, valuation_gap_pct: -0.170167, dislocation_score: 1.363209, ai_positioning_score: -2.159911, risk_penalty: 0.176396, revenue_growth_yoy: 0.154214, revenue_cagr_2y: 0.078618, operating_margin: 0.09529, operating_margin_change_2y: -0.017098, fcf_yield: 0.077581, free_cash_flow_b: 0.612691, ai_news_intensity: 0.660496, ai_exec_concrete_ratio: 0.349838, ai_fear_ratio: 0.27705, ai_net_sentiment: -0.27705, drawdown_252d: -0.346974, return_63d: -0.250842 },
  { ticker: "SNOW", price: 177.45, market_cap_b: 61.760256, signal: "Short", ai_rationale: "Worst: Data Platforms incumbent; dynamics favor incumbent; opp -0.99, mgmt +0.13, val gap -15%, op margin -40%, FCF +1%, drawdown -36%, concrete AI +34%, discount AI +3%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates SNOW's fundamentals don't justify its current 14.2x EV/S, showing a 15% overvaluation gap. Fundamentals are a concern: -40.2% operating margin hasn't proven sustainable profitability. Counterpoint: already down 32% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "incumbent", rank: 53, opportunity_score: -0.991601, management_ai_execution_score: 0.130248, fundamental_score: -0.611936, valuation_score: -0.6331, valuation_gap_pct: -0.148086, dislocation_score: 0.77115, ai_positioning_score: -0.389526, risk_penalty: 1.928843, revenue_growth_yoy: 0.292147, revenue_cagr_2y: 0.324977, operating_margin: -0.401503, operating_margin_change_2y: 0.006244, fcf_yield: 0.012576, free_cash_flow_b: 0.776677, ai_news_intensity: 0.723816, ai_exec_concrete_ratio: 0.339312, ai_fear_ratio: 0.139808, ai_net_sentiment: -0.139808, drawdown_252d: -0.35971, return_63d: -0.316659 },
  { ticker: "GLOB", price: 53.2, market_cap_b: 7.0, signal: "Short", ai_rationale: "Worst: IT Services challenger; dynamics favor entrant; opp -1.01, mgmt -0.66, val gap -1%, op margin +9%, FCF +2%, drawdown -64%, concrete AI +0%, discount AI +0%.", ai_narrative: "As a challenger in IT Services, GLOB's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The fundamentals signal reinforces the concern. Counterpoint: already down 18% over 3 months — further downside may be limited.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "challenger", rank: 54, opportunity_score: -1.009433, management_ai_execution_score: -0.65975, fundamental_score: -0.859136, valuation_score: -0.062337, valuation_gap_pct: -0.014581, dislocation_score: 0.555274, ai_positioning_score: -1.069694, risk_penalty: 0.280964, revenue_growth_yoy: 0.016222, revenue_cagr_2y: 0.082245, operating_margin: 0.086, operating_margin_change_2y: -0.024972, fcf_yield: 0.024286, free_cash_flow_b: 0.17, ai_news_intensity: 0.0, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.636736, return_63d: -0.179772 },
  { ticker: "WIT", price: 2.22, market_cap_b: 24.305486, signal: "Short", ai_rationale: "Worst: IT Services incumbent; dynamics favor entrant; opp -1.03, mgmt +0.04, val gap -16%, op margin +17%, FCF +4%, drawdown -33%, concrete AI +47%, discount AI +0%.", ai_narrative: "As an incumbent in IT Services, WIT's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The fundamentals signal reinforces the concern.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 55, opportunity_score: -1.029374, management_ai_execution_score: 0.037199, fundamental_score: -0.675166, valuation_score: -0.674491, valuation_gap_pct: -0.157768, dislocation_score: -0.174571, ai_positioning_score: -0.955871, risk_penalty: -0.225418, revenue_growth_yoy: -0.05, revenue_cagr_2y: -0.006, operating_margin: 0.168, operating_margin_change_2y: null, fcf_yield: 0.045, free_cash_flow_b: null, ai_news_intensity: 0.693639, ai_exec_concrete_ratio: 0.470345, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.331325, return_63d: -0.186813 },
  { ticker: "ZM", price: 77.33, market_cap_b: 22.836684, signal: "Short", ai_rationale: "Worst: Horizontal SaaS / Collaboration incumbent; dynamics favor entrant; opp -1.11, mgmt +0.35, val gap -40%, op margin +23%, FCF +8%, drawdown -20%, concrete AI +45%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates ZM's fundamentals don't justify its current 4.4x EV/S, showing a 40% overvaluation gap. The AI positioning signal reinforces the concern. Counterpoint: management execution is genuinely strong (45% concrete AI coverage).", ai_bucket: "Worst Pick", industry_label: "Horizontal SaaS / Collaboration", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 56, opportunity_score: -1.105415, management_ai_execution_score: 0.346724, fundamental_score: 0.122768, valuation_score: -1.702684, valuation_gap_pct: -0.398269, dislocation_score: -0.625847, ai_positioning_score: -0.772898, risk_penalty: -0.235764, revenue_growth_yoy: 0.043584, revenue_cagr_2y: 0.037035, operating_margin: 0.230784, operating_margin_change_2y: 0.114757, fcf_yield: 0.084254, free_cash_flow_b: 1.924087, ai_news_intensity: 0.441798, ai_exec_concrete_ratio: 0.451907, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.196321, return_63d: -0.085501 },
  { ticker: "CFLT", price: 30.79, market_cap_b: 11.004721, signal: "Short", ai_rationale: "Worst: Data Platforms challenger; dynamics favor incumbent; opp -1.27, mgmt +0.21, val gap -13%, op margin -33%, FCF +1%, drawdown -4%, concrete AI +0%, discount AI +0%.", ai_narrative: "CFLT hasn't pulled back meaningfully (drawdown: -4%), scoring low on dislocation while fundamentals lag peers. The valuation model also flags a 13% overvaluation vs. estimated P/S.", ai_bucket: "Worst Pick", industry_label: "Data Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 57, opportunity_score: -1.265133, management_ai_execution_score: 0.210441, fundamental_score: -0.351765, valuation_score: -0.568868, valuation_gap_pct: -0.133062, dislocation_score: -1.513019, ai_positioning_score: -0.000506, risk_penalty: 1.419477, revenue_growth_yoy: 0.210769, revenue_cagr_2y: 0.225438, operating_margin: -0.325779, operating_margin_change_2y: 0.290441, fcf_yield: 0.005514, free_cash_flow_b: 0.060677, ai_news_intensity: 0.432491, ai_exec_concrete_ratio: 0.0, ai_fear_ratio: 0.0, ai_net_sentiment: 0.0, drawdown_252d: -0.043789, return_63d: 0.335212 },
  { ticker: "IBM", price: 256.55, market_cap_b: 242.810205, signal: "Short", ai_rationale: "Worst: IT Services incumbent; dynamics favor entrant; opp -1.41, mgmt -0.02, val gap -6%, op margin +15%, FCF +6%, drawdown -19%, concrete AI +48%, discount AI +0%.", ai_narrative: "As an incumbent in IT Services, IBM's structural position scores poorly — the model flags exposure to AI-driven disruption without corresponding competitive moats. The fundamentals signal reinforces the concern.", ai_bucket: "Worst Pick", industry_label: "IT Services", industry_dynamics_favor: "entrant", switching_cost_class: "low", role: "incumbent", rank: 58, opportunity_score: -1.411697, management_ai_execution_score: -0.018066, fundamental_score: -0.776523, valuation_score: -0.276823, valuation_gap_pct: -0.064751, dislocation_score: -0.280727, ai_positioning_score: -1.142021, risk_penalty: 1.22088, revenue_growth_yoy: 0.014, revenue_cagr_2y: 0.044863, operating_margin: 0.15, operating_margin_change_2y: 0.01514, fcf_yield: 0.060541, free_cash_flow_b: 14.7, ai_news_intensity: 0.636165, ai_exec_concrete_ratio: 0.477457, ai_fear_ratio: 0.056921, ai_net_sentiment: -0.056921, drawdown_252d: -0.185504, return_63d: -0.149877 },
  { ticker: "NET", price: 192.31, market_cap_b: 68.703034, signal: "Short", ai_rationale: "Worst: Cybersecurity Platforms challenger; dynamics favor incumbent; opp -1.51, mgmt -0.14, val gap -56%, op margin -10%, FCF +0%, drawdown -24%, concrete AI +20%, discount AI +0%.", ai_narrative: "Our regression model (fitted on 28 enterprise software companies) estimates NET's fundamentals don't justify its current 32.8x EV/S, showing a 56% overvaluation gap. The AI positioning signal reinforces the concern. The dislocation signal partially offsets the bearish case.", ai_bucket: "Worst Pick", industry_label: "Cybersecurity Platforms", industry_dynamics_favor: "incumbent", switching_cost_class: "high", role: "challenger", rank: 59, opportunity_score: -1.505974, management_ai_execution_score: -0.137581, fundamental_score: -0.455601, valuation_score: -1.741853, valuation_gap_pct: -0.55784, dislocation_score: 0.87425, ai_positioning_score: -0.809276, risk_penalty: 2.030523, revenue_growth_yoy: 0.298457, revenue_cagr_2y: 0.292993, operating_margin: -0.095577, operating_margin_change_2y: 0.047462, fcf_yield: 0.004185, free_cash_flow_b: 0.287497, ai_news_intensity: 0.624087, ai_exec_concrete_ratio: 0.204245, ai_fear_ratio: 0.281355, ai_net_sentiment: -0.281355, drawdown_252d: -0.240782, return_63d: -0.04447 },
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
