import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { strategy_id, version_id } = body;

    if (!strategy_id) {
      return NextResponse.json(
        { error: "strategy_id is required" },
        { status: 400 }
      );
    }
    if (!version_id) {
      return NextResponse.json(
        { error: "version_id is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/execution/swap-model`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, strategy_id, version_id }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Swap model failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error swapping model:", error);
    return NextResponse.json(
      { error: "Failed to swap model" },
      { status: 500 }
    );
  }
}
