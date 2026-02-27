import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { contracts } = body;

    if (!contracts || !Array.isArray(contracts) || contracts.length === 0) {
      return NextResponse.json(
        { error: "contracts array is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/fetch-prices`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contracts,
          userId: String(userId),
        }),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      let detail = `Request failed: ${response.status}`;
      try {
        detail = JSON.parse(text).detail || detail;
      } catch {
        // use default detail
      }
      return NextResponse.json({ error: detail }, { status: response.status });
    }

    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching leg prices:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch prices",
      },
      { status: 500 }
    );
  }
}
