import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user for cross-user fallback routing
    const user = await getCurrentUser();
    const userId = user?.id ?? undefined;

    // Parse force flag from request body
    let force = false;
    try {
      const body = await request.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON — default to non-force
    }

    const url = new URL(`${PYTHON_SERVICE_URL}/options/relay/ib-reconnect`);
    if (userId) url.searchParams.set("user_id", userId);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
      cache: "no-store",
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error reconnecting to IB:", error);
    return NextResponse.json(
      {
        success: false,
        connected: false,
        message:
          error instanceof Error ? error.message : "Failed to reconnect to IB",
      },
      { status: 500 }
    );
  }
}
