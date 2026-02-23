import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * GET /api/ma-options/polygon-health?ticker=SPY
 *
 * Pre-open health check for the Polygon data source.
 * Tests API auth, stock snapshot freshness, options chain reachability,
 * and round-trip latency. Also reports IB agent connectivity.
 *
 * Designed to be called before market open (9:30 AM ET).
 * Stock snapshots clear at 3:30 AM EST and start updating ~4:00 AM EST.
 * Options data shows previous-day values until the open.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker") || "SPY";

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/polygon-health?ticker=${encodeURIComponent(ticker)}`,
      { method: "GET", next: { revalidate: 0 } }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          polygon_configured: false,
          overall: "fail",
          error: errorData.detail || `Python service returned ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Polygon health check error:", error);
    return NextResponse.json(
      {
        polygon_configured: false,
        overall: "fail",
        error: "Python service unreachable",
      },
      { status: 503 }
    );
  }
}
