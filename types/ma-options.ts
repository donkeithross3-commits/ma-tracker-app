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

export interface CoveredCallResult {
  ticker: string;
  current_price: number;
  deal_price: number;
  strike: number;
  expiry: string;
  premium: number;
  annualized_yield: number;
  downside_cushion: number;
  effective_basis: number;
  if_called_return: number;
  static_return: number;
  implied_vol: number | null;
  days_to_expiry: number;
  open_interest: number;
  volume: number;
  bid: number;
  ask: number;
  breakeven: number;
  notes: string | null;
}

export interface CoveredCallsResponse {
  results: CoveredCallResult[];
  scanned: number;
  total_opportunities: number;
  filters: {
    ticker: string | null;
    min_yield: number;
    min_liquidity: number;
  };
  errors: Array<{ ticker: string; error: string }> | null;
}

export interface CandidateStrategy {
  id: string; // Temporary UUID for UI key
  strategyType: string; // "call_vertical", "put_vertical", "long_call", "long_put", "covered_call"
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
  dealPrice: number;
  dealExpectedCloseDate: string;
  strategyType: string;
  expiration: string;
  legs: StrategyLeg[];
  entryPremium: number;
  currentPremium: number | null;
  underlyingPrice: number | null;
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
  // User attribution
  curatedById: string | null;
  curatedByAlias: string | null;
  isPublic: boolean;
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
  // Call spread params
  callLongStrikeLower: number;   // % below deal for long call (deepest ITM)
  callLongStrikeUpper: number;   // % below deal for long call (shallowest, hardcoded 0 = at deal)
  callShortStrikeLower: number;  // % below deal for short call
  callShortStrikeUpper: number;  // % above deal for short call (higher offer buffer)
  // Put spread params
  putLongStrikeLower: number;    // % below deal for long put (deepest OTM)
  putLongStrikeUpper: number;    // % below deal for long put (shallowest, hardcoded 0 = at deal)
  putShortStrikeLower: number;   // % below deal for short put
  putShortStrikeUpper: number;   // % above deal for short put
  topStrategiesPerExpiration: number;
}

export interface GenerateCandidatesResponse {
  candidates: CandidateStrategy[];
}

export interface WatchSpreadRequest {
  dealId: string;
  strategy: CandidateStrategy;
  underlyingPrice?: number;
  notes?: string;
  listIds?: string[]; // User's deal lists to add this spread's deal to
  newListName?: string; // Create a new list with this name
}

export interface WatchSpreadResponse {
  spreadId: string;
  success: boolean;
  duplicate?: boolean;
  message?: string;
}

export interface UpdateSpreadPricesRequest {
  spreadIds: string[];
}

export interface SpreadUpdateFailure {
  spreadId: string;
  ticker: string;
  reason: string;
}

export interface UpdateSpreadPricesResponse {
  updates: Array<{
    spreadId: string;
    currentPremium: number;
    underlyingPrice?: number | null;
    lastUpdated: string;
  }>;
  failures?: SpreadUpdateFailure[];
  metadata?: {
    totalSpreads: number;
    updatedSpreads: number;
    failedSpreads: number;
    contractsFetched: number;
    contractsNeeded: number;
    durationSeconds: number;
  };
}

// Options Scan Response - unified scan endpoint for deal-specific options page
export interface OptionsScanContract {
  symbol: string;
  strike: number;
  expiry: string; // "YYYYMMDD"
  right: string; // "C" or "P"
  bid: number;
  ask: number;
  mid_price: number;
  volume: number;
  open_interest: number;
  implied_vol: number | null;
}

export interface OpportunityResult {
  strategy: string;
  contracts: OptionsScanContract[];
  entry_cost: number;
  max_profit: number;
  breakeven: number;
  expected_return: number;
  annualized_return: number;
  probability_of_profit: number;
  notes: string;
  entry_cost_ft: number;
  expected_return_ft: number;
  annualized_return_ft: number;
}

export interface CategoryResult {
  best: OpportunityResult | null;
  count: number;
  all: OpportunityResult[];
}

export interface OptionsScanResponse {
  ticker: string;
  deal_price: number;
  current_price: number;
  days_to_close: number;
  expected_close: string;
  optionable: boolean;
  categories: {
    covered_call?: CategoryResult;
    call?: CategoryResult;
    spread?: CategoryResult;
    put_spread?: CategoryResult;
  };
  total_opportunities: number;
  scan_time_ms: number;
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
  addedById: string | null;
  addedByAlias: string | null; // User alias who added this deal
  createdAt: string;
  updatedAt: string;
}

