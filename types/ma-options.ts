// M&A Options Scanner - Shared TypeScript Types

export interface OptionContract {
  symbol: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  open_interest: number;
  implied_vol: number | null;
  delta: number | null;
  bid_size: number;
  ask_size: number;
}

export interface StrategyLeg {
  symbol: string;
  strike: number;
  right: "C" | "P";
  quantity: number;
  side: "BUY" | "SELL";
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  openInterest: number;
  bidSize: number;
  askSize: number;
}

export interface CandidateStrategy {
  id: string; // Temporary UUID for UI key
  strategyType: string; // "call_vertical", "put_vertical", "long_call", "long_put"
  expiration: Date;
  legs: StrategyLeg[];
  netPremium: number;
  netPremiumFarTouch: number;
  maxProfit: number;
  maxLoss: number;
  returnOnRisk: number;
  annualizedYield: number;
  annualizedYieldFarTouch: number; // Far touch annualized yield
  liquidityScore: number; // 0-100
  notes: string;
}

export interface WatchedSpreadDTO {
  id: string;
  dealId: string;
  dealTicker: string;
  dealTargetName: string;
  strategyType: string;
  expiration: string;
  legs: StrategyLeg[];
  entryPremium: number;
  currentPremium: number | null;
  maxProfit: number;
  maxLoss: number;
  returnOnRisk: number;
  annualizedYield: number;
  pnlDollar: number;
  pnlPercent: number;
  daysToClose: number;
  liquidityScore: number;
  lastUpdated: string | null;
  status: string;
  notes: string | null;
}

export interface DealForScanner {
  id: string;
  ticker: string;
  targetName: string;
  acquirorName: string | null;
  dealPrice: number;
  expectedCloseDate: string;
  daysToClose: number;
  status: string;
  noOptionsAvailable: boolean;
  lastOptionsCheck: string | null;
  watchedSpreadsCount: number;
}

export interface OptionChainResponse {
  snapshotId?: string;
  ticker: string;
  spotPrice: number;
  dealPrice?: number;
  daysToClose?: number;
  expirations: string[];
  contracts: OptionContract[];
  source?: "agent" | "python-service" | "ws-relay";
  agentId?: string;
  timestamp?: string;
  agentTimestamp?: string;
  ageMinutes?: number;
}

export interface AvailabilityCheckResponse {
  available: boolean;
  expirationCount: number;
  error?: string;
}

export interface ScanParameters {
  daysBeforeClose: number;
  strikeLowerBound: number; // % below deal price for long leg
  strikeUpperBound: number; // % above deal price for long leg
  shortStrikeLower: number; // % below deal price for short leg
  shortStrikeUpper: number; // % above deal price for short leg
  topStrategiesPerExpiration: number;
}

export interface GenerateCandidatesResponse {
  candidates: CandidateStrategy[];
}

export interface WatchSpreadRequest {
  dealId: string;
  strategy: CandidateStrategy;
  notes?: string;
}

export interface WatchSpreadResponse {
  spreadId: string;
  success: boolean;
}

export interface UpdateSpreadPricesRequest {
  spreadIds: string[];
}

export interface UpdateSpreadPricesResponse {
  updates: Array<{
    spreadId: string;
    currentPremium: number;
    lastUpdated: string;
  }>;
}

// Scanner Deals - lightweight deal management for options scanner
export interface ScannerDeal {
  id: string;
  ticker: string;
  targetName: string | null;
  expectedClosePrice: number;
  expectedCloseDate: string; // YYYY-MM-DD
  daysToClose: number;
  notes: string | null;
  isActive: boolean;
  noOptionsAvailable: boolean;
  lastOptionsCheck: string | null;
  createdAt: string;
  updatedAt: string;
}

