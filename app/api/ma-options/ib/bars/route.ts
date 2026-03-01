import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

const VALID_BAR_SIZES = new Set([
  "1 min",
  "5 mins",
  "15 mins",
  "1 hour",
  "1 day",
]);

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { searchParams } = request.nextUrl;
    const ticker = (searchParams.get("ticker") || "").toUpperCase();
    const secType = searchParams.get("secType") || "FUT";
    const exchange = searchParams.get("exchange") || "";
    const duration = searchParams.get("duration") || "5 D";
    const barSize = searchParams.get("barSize") || "5 mins";
    const useRTH = searchParams.get("useRTH") === "true";

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }
    if (!VALID_BAR_SIZES.has(barSize)) {
      return NextResponse.json(
        {
          error: `Invalid barSize. Must be one of: ${[...VALID_BAR_SIZES].join(", ")}`,
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/historical-bars`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          secType,
          exchange: exchange || undefined,
          duration,
          barSize,
          whatToShow: "TRADES",
          useRTH,
          userId: user.id,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            errorData.detail || `Failed to fetch IB bars: ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching IB bars:", error);
    return NextResponse.json(
      { error: "Failed to fetch IB chart data" },
      { status: 500 }
    );
  }
}
