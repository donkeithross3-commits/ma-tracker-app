import { NextRequest, NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get("ticker");
    if (!ticker) {
      return NextResponse.json({ error: "ticker query param is required" }, { status: 400 });
    }

    const url = `${PORTFOLIO_SERVICE_URL}/risk/options-scan?ticker=${encodeURIComponent(ticker)}`;
    const resp = await fetch(url, { method: "GET", cache: "no-store" });

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
