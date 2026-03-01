import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * GET /api/ma-options/execution/pnl-history
 *
 * Proxy for three P&L history endpoints:
 *   - ?endpoint=positions  → /relay/pnl-history/positions
 *   - ?endpoint=summary    → /relay/pnl-history/summary
 *
 * POST /api/ma-options/execution/pnl-history
 *   - Backfill endpoint    → /relay/pnl-history/backfill
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get("endpoint") || "positions";

    // Build the Python service URL with user_id and pass through all query params
    const params = new URLSearchParams(searchParams);
    params.set("user_id", user.id);
    params.delete("endpoint"); // Don't forward the routing param

    let path: string;
    if (endpoint === "summary") {
      path = "/options/relay/pnl-history/summary";
    } else {
      path = "/options/relay/pnl-history/positions";
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}${path}?${params.toString()}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Fetch failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching P&L history:", error);
    return NextResponse.json(
      { error: "Failed to fetch P&L history" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/pnl-history/backfill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, positions: body.positions || [] }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Backfill failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error backfilling P&L history:", error);
    return NextResponse.json(
      { error: "Failed to backfill P&L history" },
      { status: 500 }
    );
  }
}
