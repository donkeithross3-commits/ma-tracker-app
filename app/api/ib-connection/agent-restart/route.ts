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

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/agent/restart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      }
    );

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error restarting agent:", error);
    return NextResponse.json(
      { success: false, message: "Failed to restart agent" },
      { status: 500 }
    );
  }
}
