import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * GET /api/ma-options/execution/pnl-history/[positionId]
 *
 * Proxy for fill detail: /relay/pnl-history/positions/{positionId}/fills
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { positionId } = await params;

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/pnl-history/positions/${encodeURIComponent(positionId)}/fills?user_id=${encodeURIComponent(user.id)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Fill fetch failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching fill detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch fill detail" },
      { status: 500 }
    );
  }
}
