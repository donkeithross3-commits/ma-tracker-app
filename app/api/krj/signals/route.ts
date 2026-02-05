import { NextRequest, NextResponse } from "next/server";
import { getKrjSignalsForTickers, type KrjSignal } from "@/lib/krj-data";

/**
 * GET /api/krj/signals?tickers=AAPL,SPY,SPCE
 * Returns KRJ weekly signal for each ticker that exists in KRJ data.
 * Tickers not in any KRJ list are omitted (UI shows "Not available").
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  if (!tickersParam || !tickersParam.trim()) {
    return NextResponse.json({ signals: {} });
  }
  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tickers.length === 0) {
    return NextResponse.json({ signals: {} });
  }
  try {
    const signals: Record<string, KrjSignal> = getKrjSignalsForTickers(tickers);
    return NextResponse.json({ signals });
  } catch (e) {
    console.error("KRJ signals error:", e);
    return NextResponse.json(
      { error: "Failed to load KRJ signals" },
      { status: 500 }
    );
  }
}
