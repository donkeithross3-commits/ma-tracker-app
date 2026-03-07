import { NextResponse } from "next/server";
import {
  fetchFredSeries,
  computeDeltas,
  FRED_SERIES,
  FRED_TOOLTIPS,
  type MetricPoint,
  type MacroResponse,
} from "@/lib/cockpit";

export const dynamic = "force-dynamic";

function buildMetricPoint(
  rows: { date: string; value: number }[],
  tooltip: string
): MetricPoint {
  if (rows.length === 0) {
    return { value: null, date: "", delta1d: null, delta5d: null, delta20d: null, tooltip };
  }
  const latest = rows[rows.length - 1];
  const deltas = computeDeltas(rows);
  return {
    value: latest.value,
    date: latest.date,
    ...deltas,
    tooltip,
  };
}

export async function GET() {
  try {
    // Fetch all FRED series in parallel
    const seriesData = await Promise.all(
      FRED_SERIES.map((id) => fetchFredSeries(id, 60))
    );

    const dataMap: Record<string, { date: string; value: number }[]> = {};
    FRED_SERIES.forEach((id, i) => {
      dataMap[id] = seriesData[i];
    });

    // Build rates
    const rates: Record<string, MetricPoint> = {};
    for (const id of ["DGS3MO", "DGS2", "DGS5", "DGS10", "DGS30"] as const) {
      rates[id] = buildMetricPoint(dataMap[id], FRED_TOOLTIPS[id]);
    }

    // Build spreads
    const twoTen = buildMetricPoint(
      dataMap.T10Y2Y,
      FRED_TOOLTIPS.T10Y2Y
    );
    const threeMoTen = buildMetricPoint(
      dataMap.T10Y3M,
      FRED_TOOLTIPS.T10Y3M
    );

    // Rate of change of yield curve steepness (delta of the 2s10s spread)
    if (twoTen.delta1d !== null) {
      twoTen.tooltip += ` | Steepening rate: ${twoTen.delta1d > 0 ? "+" : ""}${twoTen.delta1d.toFixed(3)}/day`;
    }

    const hyOas = buildMetricPoint(dataMap.BAMLH0A0HYM2, FRED_TOOLTIPS.BAMLH0A0HYM2);
    const dollar = buildMetricPoint(dataMap.DTWEXBGS, FRED_TOOLTIPS.DTWEXBGS);
    const stress = buildMetricPoint(dataMap.STLFSI2, FRED_TOOLTIPS.STLFSI2);

    const response: MacroResponse = {
      asOf: new Date().toISOString(),
      yieldCurve: {
        spreads: { twoTen, threeMoTen },
        rates,
      },
      credit: { hyOas },
      dollar: { tradeWeighted: dollar },
      stress: { stlfsi: stress },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Cockpit macro error:", error);
    return NextResponse.json(
      { error: "Failed to fetch macro data" },
      { status: 500 }
    );
  }
}
