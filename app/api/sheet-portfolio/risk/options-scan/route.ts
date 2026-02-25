import { NextRequest, NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

const SCAN_TIMEOUT_MS = 45_000; // 45s — generous for Polygon pagination

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get("ticker");
    if (!ticker) {
      return NextResponse.json({ error: "ticker query param is required" }, { status: 400 });
    }

    const url = `${PORTFOLIO_SERVICE_URL}/risk/options-scan?ticker=${encodeURIComponent(ticker)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const body = await resp.text();
        return NextResponse.json({ error: body }, { status: resp.status });
      }

      const data = await resp.json();
      return NextResponse.json(data);
    } catch (fetchErr: unknown) {
      clearTimeout(timer);
      if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
        return NextResponse.json({
          error_code: "timeout",
          error_message: "Options scan timed out. The data provider may be slow — try again shortly.",
          optionable: false,
          categories: {},
          total_opportunities: 0,
          scan_time_ms: SCAN_TIMEOUT_MS,
          ticker: ticker.toUpperCase(),
        });
      }
      throw fetchErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error_code: "proxy_error",
      error_message: "Unable to connect to the analysis service.",
      detail: message,
      optionable: false,
      categories: {},
      total_opportunities: 0,
      scan_time_ms: 0,
    });
  }
}
