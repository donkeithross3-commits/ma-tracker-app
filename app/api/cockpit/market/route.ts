import { NextResponse } from "next/server";
import {
  fetchPolygonBars,
  computeReturns,
  computeRollingStdDev,
  MARKET_TICKERS,
  type AssetRow,
  type MarketResponse,
  type MetricPoint,
  computeDeltas,
} from "@/lib/cockpit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Fetch all tickers + VIX in parallel
    const allTickers = [...MARKET_TICKERS.map((t) => t.ticker), "VIX"];
    const allBars = await Promise.all(
      allTickers.map((t) => fetchPolygonBars(t === "VIX" ? "I:VIX" : t, 60))
    );

    const barMap: Record<string, Awaited<ReturnType<typeof fetchPolygonBars>>> = {};
    allTickers.forEach((t, i) => {
      barMap[t] = allBars[i];
    });

    // Build asset rows
    const assets: AssetRow[] = MARKET_TICKERS.map((meta) => {
      const bars = barMap[meta.ticker];
      const returns = computeReturns(bars);
      const stdDev = computeRollingStdDev(bars, 20);
      const latestReturn = returns.return1d;

      const volNormMove =
        latestReturn !== null && stdDev !== null && stdDev > 0
          ? latestReturn / stdDev
          : null;

      return {
        ticker: meta.ticker,
        name: meta.name,
        price: bars.length > 0 ? bars[bars.length - 1].close : null,
        ...returns,
        volNormMove,
        tooltip: meta.tooltip,
      };
    });

    // VIX metric
    const vixBars = barMap["VIX"];
    const vixValues = vixBars.map((b) => ({ date: b.date, value: b.close }));
    const vixDeltas = computeDeltas(vixValues);
    const vixMetric: MetricPoint = {
      value: vixValues.length > 0 ? vixValues[vixValues.length - 1].value : null,
      date: vixValues.length > 0 ? vixValues[vixValues.length - 1].date : "",
      ...vixDeltas,
      tooltip: "CBOE Volatility Index — market's expectation of 30-day forward volatility",
    };

    const response: MarketResponse = {
      asOf: new Date().toISOString(),
      assets,
      vix: vixMetric,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Cockpit market error:", error);
    return NextResponse.json(
      { error: "Failed to fetch market data" },
      { status: 500 }
    );
  }
}
