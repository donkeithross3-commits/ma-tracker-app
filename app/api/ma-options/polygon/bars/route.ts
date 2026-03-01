import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";

// Strict validation patterns
const TICKER_RE = /^[A-Z][A-Z0-9]{0,9}$/;
const VALID_TIMESPANS = new Set(["minute", "hour", "day"]);

export async function GET(request: NextRequest) {
  try {
    // Auth check — same pattern as bmc-signal route
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!POLYGON_API_KEY) {
      return NextResponse.json(
        { error: "Polygon API key not configured" },
        { status: 503 }
      );
    }

    // Parse and validate query params
    const { searchParams } = request.nextUrl;
    const ticker = searchParams.get("ticker") || "";
    const timespan = searchParams.get("timespan") || "minute";
    const multiplier = parseInt(searchParams.get("multiplier") || "5", 10);
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "5000", 10), 50000);

    if (!TICKER_RE.test(ticker)) {
      return NextResponse.json(
        { error: "Invalid ticker. Must be 1-10 uppercase letters." },
        { status: 400 }
      );
    }
    if (!VALID_TIMESPANS.has(timespan)) {
      return NextResponse.json(
        { error: `Invalid timespan. Must be one of: ${[...VALID_TIMESPANS].join(", ")}` },
        { status: 400 }
      );
    }
    if (isNaN(multiplier) || multiplier < 1 || multiplier > 60) {
      return NextResponse.json(
        { error: "Invalid multiplier. Must be 1-60." },
        { status: 400 }
      );
    }
    if (!from || !to) {
      return NextResponse.json(
        { error: "Both 'from' and 'to' date params required (YYYY-MM-DD or epoch ms)." },
        { status: 400 }
      );
    }

    // Call Polygon aggregates API
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}&apiKey=${POLYGON_API_KEY}`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    // Pass through rate limit errors
    if (response.status === 429) {
      return NextResponse.json(
        { error: "Polygon rate limit exceeded. Try again shortly." },
        { status: 429 }
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return NextResponse.json(
        { error: `Polygon API error: ${response.status} - ${errorText}` },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    const data = await response.json();

    // Transform Polygon bars to ChartBar format
    // Polygon: t (epoch ms), o, h, l, c, v, vw, n
    // ChartBar: time (epoch seconds), open, high, low, close, volume, vwap, trades
    const bars = (data.results || []).map((bar: Record<string, number>) => ({
      time: Math.floor(bar.t / 1000),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v || 0,
      vwap: bar.vw || undefined,
      trades: bar.n || undefined,
    }));

    return NextResponse.json({
      ticker: data.ticker || ticker,
      bars,
      count: bars.length,
      status: data.status,
    });
  } catch (error) {
    console.error("Error fetching Polygon bars:", error);
    return NextResponse.json(
      { error: "Failed to fetch chart data" },
      { status: 500 }
    );
  }
}
