// Types matching the actual API response shapes from /api/cockpit/*

// --- /api/cockpit/macro ---
export interface ApiMetricPoint {
  value: number | null;
  date: string;
  delta1d: number | null;
  delta5d: number | null;
  delta20d: number | null;
  tooltip: string;
}

export interface MacroResponse {
  asOf: string;
  yieldCurve: {
    spreads: {
      twoTen: ApiMetricPoint;
      threeMoTen: ApiMetricPoint;
    };
    rates: Record<string, ApiMetricPoint>; // DGS3MO, DGS2, DGS5, DGS10, DGS30
  };
  credit: { hyOas: ApiMetricPoint };
  dollar: { tradeWeighted: ApiMetricPoint };
  stress: { stlfsi: ApiMetricPoint };
}

// --- /api/cockpit/market ---
export interface AssetRow {
  ticker: string;
  name: string;
  price: number | null;
  return1d: number | null;
  return5d: number | null;
  return20d: number | null;
  volNormMove: number | null;
  tooltip: string;
}

export interface MarketResponse {
  asOf: string;
  assets: AssetRow[];
  vix: ApiMetricPoint;
}

// --- /api/cockpit/regime ---
export interface RegimeAxis {
  label: string;
  value: string;
  tooltip: string;
}

export interface RegimeResponse {
  asOf: string;
  vol: RegimeAxis;
  liquidity: RegimeAxis;
  trend: RegimeAxis;
  correlation: RegimeAxis;
}

// --- /api/cockpit/data-health ---
export interface DataHealthCheck {
  source: string;
  status: "ok" | "stale" | "error";
  lastUpdate: string | null;
  message: string;
}

export interface DataHealthResponse {
  asOf: string;
  checks: DataHealthCheck[];
  overall: "healthy" | "degraded" | "unhealthy";
}

// --- Derived / UI helpers ---
export type RegimeColor = "green" | "yellow" | "red";

export function regimeColor(label: string): RegimeColor {
  const favorable = ["Low", "Tight", "Risk-On", "Diversified"];
  const unfavorable = ["Elevated", "Wide", "Risk-Off", "Correlated"];
  if (favorable.includes(label)) return "green";
  if (unfavorable.includes(label)) return "red";
  return "yellow";
}

// Note: "Low" vol is green for general market but actually BAD for our model
// (VIX<15 = dead zone). We handle this special case in the UI.
export function volRegimeColor(label: string): RegimeColor {
  if (label === "Low") return "red";       // Bad for our model
  if (label === "Normal") return "green";   // Sweet spot
  if (label === "Elevated") return "yellow"; // Can work but risky
  return "yellow";
}

// Primary tickers (highlighted in heatmap)
export const PRIMARY_TICKERS = new Set(["SPY", "QQQ", "GLD", "SLV"]);

// Sector tickers
export const SECTOR_TICKERS = new Set(["XLF", "XLK", "XLE", "XLP", "XLI"]);
