import { NextResponse } from "next/server";
import {
  fetchPolygonBars,
  fetchFredSeries,
  computeRollingCorrelation,
  classifyVolRegime,
  classifyLiquidityRegime,
  classifyTrendRegime,
  classifyCorrelationRegime,
  type RegimeResponse,
} from "@/lib/cockpit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Fetch required data in parallel
    const [vixBars, spyBars, gldBars, hyOasRows] = await Promise.all([
      fetchPolygonBars("I:VIX", 60),
      fetchPolygonBars("SPY", 60),
      fetchPolygonBars("GLD", 60),
      fetchFredSeries("BAMLH0A0HYM2", 60),
    ]);

    // Vol regime
    const vixLatest = vixBars.length > 0 ? vixBars[vixBars.length - 1].close : null;
    const vol = classifyVolRegime(vixLatest);

    // Liquidity regime
    const liquidity = classifyLiquidityRegime(hyOasRows);

    // Trend regime
    const trend = classifyTrendRegime(spyBars);

    // Correlation regime
    const spyGldCorr = computeRollingCorrelation(spyBars, gldBars, 20);
    const correlation = classifyCorrelationRegime(spyGldCorr);

    const response: RegimeResponse = {
      asOf: new Date().toISOString(),
      vol: { label: vol.label, value: vol.label, tooltip: vol.tooltip },
      liquidity: { label: liquidity.label, value: liquidity.label, tooltip: liquidity.tooltip },
      trend: { label: trend.label, value: trend.label, tooltip: trend.tooltip },
      correlation: { label: correlation.label, value: correlation.label, tooltip: correlation.tooltip },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Cockpit regime error:", error);
    return NextResponse.json(
      { error: "Failed to compute regime" },
      { status: 500 }
    );
  }
}
