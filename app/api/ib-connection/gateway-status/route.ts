import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/gateway/status`,
      { method: "GET", cache: "no-store" }
    );

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error checking gateway status:", error);
    return NextResponse.json(
      { running: false, status: "error", error: "Failed to check gateway status" },
      { status: 500 }
    );
  }
}
