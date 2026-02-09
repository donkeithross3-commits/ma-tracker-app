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

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(fetchTimeout);

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const isJson =
      contentType.includes("application/json") ||
      (text.trimStart().startsWith("{") || text.trimStart().startsWith("["));

    if (!response.ok) {
      let errorDetail: string;
      if (isJson) {
        try {
          const errorData = JSON.parse(text);
          errorDetail =
            (typeof errorData.detail === "string" && errorData.detail) ||
            (typeof errorData.error === "string" && errorData.error) ||
            `Request failed: ${response.status}`;
        } catch {
          errorDetail = `Request failed: ${response.status}`;
        }
      } else {
        errorDetail = `Backend returned non-JSON (${response.status}). Check Python service is running on port 8000.`;
      }
      return NextResponse.json(
        { success: false, error: errorDetail },
        { status: response.status }
      );
    }

    if (!isJson) {
      console.error("[test-futures] Non-JSON response:", text.slice(0, 200));
      return NextResponse.json(
        {
          success: false,
          error:
            "Backend returned HTML instead of JSON. Is the Python service running on port 8000?",
        },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error testing futures:", error);
    const isAbort =
      error instanceof DOMException && error.name === "AbortError";
    return NextResponse.json(
      {
        success: false,
        error: isAbort
          ? "Futures test timed out (30s). The agent may still be processing — check the agent log for results."
          : error instanceof Error
            ? error.message
            : "Failed to test futures",
      },
      { status: isAbort ? 504 : 500 }
    );
  }
}
