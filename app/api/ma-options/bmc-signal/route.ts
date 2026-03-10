import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const fresh = request.nextUrl.searchParams.get("fresh") || "";
    const freshParam = fresh ? `&fresh=${fresh}` : "";
    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/bmc-signal?user_id=${encodeURIComponent(user.id)}${freshParam}`,
      { method: "GET", headers: { "Content-Type": "application/json" }, cache: "no-store" }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `BMC signal fetch failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching BMC signal:", error);
    return NextResponse.json(
      { error: "Failed to fetch BMC signal" },
      { status: 500 }
    );
  }
}
