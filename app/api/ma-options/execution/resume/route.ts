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

    const body = await request.json().catch(() => ({}));

    const payload: Record<string, unknown> = { userId: user.id };
    if (body.global_entry_cap != null) {
      payload.global_entry_cap = body.global_entry_cap;
    }
    if (body.ticker_budgets) {
      payload.ticker_budgets = body.ticker_budgets;
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/execution/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Resume failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error resuming execution:", error);
    return NextResponse.json(
      { error: "Failed to resume execution" },
      { status: 500 }
    );
  }
}
