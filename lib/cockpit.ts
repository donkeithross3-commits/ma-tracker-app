// Cockpit shared types, fetchers, caching, and regime classification
import https from "https";

// FRED's Apache server advertises HTTP/2 via ALPN but its upgrade handling
// confuses Node 22's undici (used by global fetch()), causing requests to hang
// indefinitely. Force HTTP/1.1 via a dedicated https.Agent.
const fredAgent = new https.Agent({
  ALPNProtocols: ["http/1.1"],
  keepAlive: false,
});

function fredFetch(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        agent: fredAgent,
        headers: { "User-Agent": "DR3-Dashboard/1.0", Accept: "*/*" },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () =>
          resolve({
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            status: res.statusCode ?? 500,
            text: async () => data,
          })
        );
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`FRED request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricPoint {
  value: number | null;
  date: string;
  delta1d: number | null;
  delta5d: number | null;
  delta20d: number | null;
  tooltip: string;
}

export interface YieldCurveData {
  spreads: {
    twoTen: MetricPoint;
    threeMoTen: MetricPoint;
  };
  rates: Record<string, MetricPoint>;
}

export interface MacroResponse {
  asOf: string;
  yieldCurve: YieldCurveData;
  credit: { hyOas: MetricPoint };
  dollar: { tradeWeighted: MetricPoint };
  stress: { stlfsi: MetricPoint };
}

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
  vix: MetricPoint;
}

export type VolRegime = "Low" | "Normal" | "Elevated";
export type LiquidityRegime = "Tight" | "Normal" | "Wide";
export type TrendRegime = "Risk-On" | "Neutral" | "Risk-Off";
export type CorrelationRegime = "Diversified" | "Normal" | "Correlated";

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "6eZKwBEkYlWnict34a6pbTOInsu0hvi4";

export const FRED_SERIES = [
  "DGS3MO", "DGS2", "DGS5", "DGS10", "DGS30",
  "T10Y2Y", "T10Y3M",
  "BAMLH0A0HYM2", "DTWEXBGS", "STLFSI2",
] as const;

export const FRED_TOOLTIPS: Record<string, string> = {
  DGS3MO: "3-Month Treasury yield",
  DGS2: "2-Year Treasury yield",
  DGS5: "5-Year Treasury yield",
  DGS10: "10-Year Treasury yield",
  DGS30: "30-Year Treasury yield",
  T10Y2Y: "10Y-2Y Treasury spread (yield curve slope)",
  T10Y3M: "10Y-3M Treasury spread (recession indicator)",
  BAMLH0A0HYM2: "ICE BofA High Yield OAS — credit stress proxy",
  DTWEXBGS: "Trade-Weighted US Dollar Index (Broad)",
  STLFSI2: "St. Louis Fed Financial Stress Index",
};

export const MARKET_TICKERS: { ticker: string; name: string; tooltip: string }[] = [
  { ticker: "SPY", name: "S&P 500", tooltip: "SPDR S&P 500 ETF — broad US equity benchmark" },
  { ticker: "QQQ", name: "Nasdaq 100", tooltip: "Invesco QQQ — tech-heavy large-cap index" },
  { ticker: "IWM", name: "Russell 2000", tooltip: "iShares Russell 2000 — US small-cap index" },
  { ticker: "GLD", name: "Gold", tooltip: "SPDR Gold Shares — gold price proxy" },
  { ticker: "SLV", name: "Silver", tooltip: "iShares Silver Trust — silver price proxy" },
  { ticker: "TLT", name: "20+ Year Treasury", tooltip: "iShares 20+ Year Treasury Bond ETF — long duration rates" },
  { ticker: "HYG", name: "High Yield Bonds", tooltip: "iShares iBoxx High Yield Corporate Bond ETF" },
  { ticker: "EEM", name: "Emerging Markets", tooltip: "iShares MSCI Emerging Markets ETF" },
  { ticker: "UUP", name: "US Dollar", tooltip: "Invesco DB US Dollar Index Bullish Fund" },
  { ticker: "XLF", name: "Financials", tooltip: "Financial Select Sector SPDR Fund" },
  { ticker: "XLK", name: "Technology", tooltip: "Technology Select Sector SPDR Fund" },
  { ticker: "XLE", name: "Energy", tooltip: "Energy Select Sector SPDR Fund" },
  { ticker: "XLP", name: "Consumer Staples", tooltip: "Consumer Staples Select Sector SPDR Fund" },
  { ticker: "XLI", name: "Industrials", tooltip: "Industrial Select Sector SPDR Fund" },
  { ticker: "MSTR", name: "MicroStrategy", tooltip: "MicroStrategy — BTC proxy / vol vehicle" },
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// FRED: 24h TTL
const FRED_TTL = 24 * 60 * 60 * 1000;
// Polygon: 15 min during market hours, 60 min outside
function polygonTtl(): number {
  const now = new Date();
  const hour = now.getUTCHours();
  // Market hours roughly 13:30-20:00 UTC (9:30-4:00 ET)
  const isMarketHours = hour >= 13 && hour < 20;
  return isMarketHours ? 15 * 60 * 1000 : 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// FRED Fetcher
// ---------------------------------------------------------------------------

export interface FredRow {
  date: string;
  value: number;
}

export async function fetchFredSeries(
  seriesId: string,
  lookbackDays = 60
): Promise<FredRow[]> {
  const cacheKey = `fred:${seriesId}`;
  const cached = getCached<FredRow[]>(cacheKey, FRED_TTL);
  if (cached) return cached;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${fmt(start)}&coed=${fmt(end)}`;

  const res = await fredFetch(url, 10000);
  if (!res.ok) {
    console.error(`FRED fetch failed for ${seriesId}: ${res.status}`);
    return [];
  }

  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // skip header
  const rows: FredRow[] = [];
  for (const line of lines) {
    const [date, val] = line.split(",");
    const num = parseFloat(val);
    if (!isNaN(num)) {
      rows.push({ date, value: num });
    }
  }

  setCache(cacheKey, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// Polygon Fetcher
// ---------------------------------------------------------------------------

export interface PolygonBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchPolygonBars(
  ticker: string,
  lookbackDays = 60
): Promise<PolygonBar[]> {
  const cacheKey = `polygon:${ticker}`;
  const ttl = polygonTtl();
  const cached = getCached<PolygonBar[]>(cacheKey, ttl);
  if (cached) return cached;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fmt(start)}/${fmt(end)}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    console.error(`Polygon fetch failed for ${ticker}: ${res.status}`);
    return [];
  }

  const json = await res.json();
  const results = json.results || [];
  const bars: PolygonBar[] = results.map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => ({
    date: new Date(r.t).toISOString().split("T")[0],
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
  }));

  setCache(cacheKey, bars);
  return bars;
}

// ---------------------------------------------------------------------------
// Metric Helpers
// ---------------------------------------------------------------------------

export function computeDeltas(
  values: { date: string; value: number }[]
): { delta1d: number | null; delta5d: number | null; delta20d: number | null } {
  if (values.length < 2) return { delta1d: null, delta5d: null, delta20d: null };

  const latest = values[values.length - 1].value;
  const get = (offset: number) =>
    values.length > offset ? latest - values[values.length - 1 - offset].value : null;

  return {
    delta1d: get(1),
    delta5d: get(5),
    delta20d: get(20),
  };
}

export function computeReturns(
  bars: PolygonBar[]
): { return1d: number | null; return5d: number | null; return20d: number | null } {
  if (bars.length < 2) return { return1d: null, return5d: null, return20d: null };

  const latest = bars[bars.length - 1].close;
  const pctReturn = (offset: number) => {
    if (bars.length <= offset) return null;
    const prev = bars[bars.length - 1 - offset].close;
    return prev !== 0 ? (latest - prev) / prev : null;
  };

  return {
    return1d: pctReturn(1),
    return5d: pctReturn(5),
    return20d: pctReturn(20),
  };
}

export function computeRollingStdDev(bars: PolygonBar[], window = 20): number | null {
  if (bars.length < window + 1) return null;
  const returns: number[] = [];
  for (let i = bars.length - window; i < bars.length; i++) {
    returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

export function computeRollingCorrelation(
  barsA: PolygonBar[],
  barsB: PolygonBar[],
  window = 20
): number | null {
  // Align by date
  const dateMapB = new Map(barsB.map((b) => [b.date, b]));
  const aligned: { a: number; b: number }[] = [];
  for (let i = 1; i < barsA.length; i++) {
    const bBar = dateMapB.get(barsA[i].date);
    const bBarPrev = dateMapB.get(barsA[i - 1].date);
    if (bBar && bBarPrev && barsA[i - 1].close !== 0 && bBarPrev.close !== 0) {
      aligned.push({
        a: (barsA[i].close - barsA[i - 1].close) / barsA[i - 1].close,
        b: (bBar.close - bBarPrev.close) / bBarPrev.close,
      });
    }
  }

  if (aligned.length < window) return null;
  const recent = aligned.slice(-window);

  const meanA = recent.reduce((s, r) => s + r.a, 0) / window;
  const meanB = recent.reduce((s, r) => s + r.b, 0) / window;

  let cov = 0, varA = 0, varB = 0;
  for (const r of recent) {
    const da = r.a - meanA;
    const db = r.b - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}

// ---------------------------------------------------------------------------
// Regime Classification
// ---------------------------------------------------------------------------

export function classifyVolRegime(vix: number | null): { label: VolRegime; tooltip: string } {
  if (vix === null) return { label: "Normal", tooltip: "VIX data unavailable" };
  if (vix < 15) return { label: "Low", tooltip: `VIX at ${vix.toFixed(1)} — suppressed volatility, complacency risk` };
  if (vix <= 25) return { label: "Normal", tooltip: `VIX at ${vix.toFixed(1)} — typical market volatility` };
  return { label: "Elevated", tooltip: `VIX at ${vix.toFixed(1)} — heightened fear, potential dislocation` };
}

export function classifyLiquidityRegime(
  hyOasValues: { value: number }[]
): { label: LiquidityRegime; tooltip: string } {
  if (hyOasValues.length < 20) return { label: "Normal", tooltip: "Insufficient HY OAS history" };

  const recent = hyOasValues.slice(-20);
  const current = recent[recent.length - 1].value;
  const sorted = [...recent].map((r) => r.value).sort((a, b) => a - b);
  const rank = sorted.indexOf(current);
  const percentile = rank / (sorted.length - 1);

  if (percentile < 0.25)
    return { label: "Tight", tooltip: `HY OAS at ${current.toFixed(0)}bps — tight spreads, risk-on credit conditions (${(percentile * 100).toFixed(0)}th %ile over 20d)` };
  if (percentile > 0.75)
    return { label: "Wide", tooltip: `HY OAS at ${current.toFixed(0)}bps — wide spreads, credit stress (${(percentile * 100).toFixed(0)}th %ile over 20d)` };
  return { label: "Normal", tooltip: `HY OAS at ${current.toFixed(0)}bps — normal credit conditions (${(percentile * 100).toFixed(0)}th %ile over 20d)` };
}

export function classifyTrendRegime(
  spyBars: PolygonBar[]
): { label: TrendRegime; tooltip: string } {
  if (spyBars.length < 20) return { label: "Neutral", tooltip: "Insufficient SPY price history" };

  const recent20 = spyBars.slice(-20);
  const ma20 = recent20.reduce((s, b) => s + b.close, 0) / 20;
  const current = spyBars[spyBars.length - 1].close;
  const pctFromMa = (current - ma20) / ma20;

  // Direction: compare current MA vs MA 5 days ago
  const older = spyBars.slice(-25, -5);
  const maOlder = older.length >= 20
    ? older.slice(-20).reduce((s, b) => s + b.close, 0) / 20
    : ma20;
  const maDirection = ma20 > maOlder ? "rising" : "falling";

  if (pctFromMa > 0.01 && maDirection === "rising")
    return { label: "Risk-On", tooltip: `SPY ${(pctFromMa * 100).toFixed(1)}% above 20d MA, MA rising — bullish trend` };
  if (pctFromMa < -0.01 && maDirection === "falling")
    return { label: "Risk-Off", tooltip: `SPY ${(pctFromMa * 100).toFixed(1)}% below 20d MA, MA falling — bearish trend` };
  return { label: "Neutral", tooltip: `SPY near 20d MA (${(pctFromMa * 100).toFixed(1)}%) — no clear trend` };
}

export function classifyCorrelationRegime(
  correlation: number | null
): { label: CorrelationRegime; tooltip: string } {
  if (correlation === null) return { label: "Normal", tooltip: "Correlation data unavailable" };
  if (correlation < 0.3)
    return { label: "Diversified", tooltip: `SPY-GLD 20d correlation at ${correlation.toFixed(2)} — assets moving independently, diversification working` };
  if (correlation > 0.6)
    return { label: "Correlated", tooltip: `SPY-GLD 20d correlation at ${correlation.toFixed(2)} — risk assets moving together, reduced diversification` };
  return { label: "Normal", tooltip: `SPY-GLD 20d correlation at ${correlation.toFixed(2)} — moderate co-movement` };
}
