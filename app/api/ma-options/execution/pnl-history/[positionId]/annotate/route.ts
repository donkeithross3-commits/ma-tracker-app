import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * PATCH /api/ma-options/execution/pnl-history/[positionId]/annotate
 *
 * Update annotation fields on a position. Only provided fields are updated.
 * Body: { annotation?, manual_intervention?, intervention_type? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { positionId } = await params;
    const body = await request.json();

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/pnl-history/positions/${encodeURIComponent(positionId)}/annotate?user_id=${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Annotate failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error annotating position:", error);
    return NextResponse.json(
      { error: "Failed to annotate position" },
      { status: 500 }
    );
  }
}
