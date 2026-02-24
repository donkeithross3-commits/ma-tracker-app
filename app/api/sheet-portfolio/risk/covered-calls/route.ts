import { NextRequest, NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

async function proxyCoveredCalls(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get("ticker");
    const minYield = req.nextUrl.searchParams.get("min_yield");
    const minLiquidity = req.nextUrl.searchParams.get("min_liquidity");

    const params = new URLSearchParams();
    if (ticker) params.set("ticker", ticker);
    if (minYield) params.set("min_yield", minYield);
    if (minLiquidity) params.set("min_liquidity", minLiquidity);

    const qs = params.toString();
    const url = `${PORTFOLIO_SERVICE_URL}/risk/covered-calls${qs ? `?${qs}` : ""}`;

    const resp = await fetch(url, { method: "POST", cache: "no-store" });
    if (!resp.ok) {
      const body = await resp.text();
      return NextResponse.json({ error: body }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to reach Python service: ${message}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxyCoveredCalls(req);
}

export async function POST(req: NextRequest) {
  return proxyCoveredCalls(req);
}
