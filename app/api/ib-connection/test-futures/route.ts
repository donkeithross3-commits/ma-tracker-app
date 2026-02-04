import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    const url = new URL(`${PYTHON_SERVICE_URL}/options/relay/test-futures`);
    if (userId) url.searchParams.set("user_id", String(userId));
    console.log("[test-futures] user_id for routing:", userId ?? "(none)");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: errorData.detail || `Request failed: ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error testing futures:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to test futures",
      },
      { status: 500 }
    );
  }
}
