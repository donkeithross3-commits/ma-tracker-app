import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    const url = new URL(`${PYTHON_SERVICE_URL}/options/relay/positions`);
    url.searchParams.set("user_id", String(userId));
    const targetUrl = url.toString();
    console.log("[positions] Fetching from Python relay:", `${PYTHON_SERVICE_URL}/options/relay/positions?user_id=${userId}`);

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    console.log(`[positions] Python relay response: status=${response.status} bodyLen=${text.length} body=${text.substring(0, 300)}`);
    const isJson =
      contentType.includes("application/json") ||
      (text.trimStart().startsWith("{") || text.trimStart().startsWith("["));

    if (!response.ok) {
      let errorDetail: string;
      if (response.status === 404) {
        console.error("[positions] Python returned 404. URL:", targetUrl.replace(userId, "***"), "body:", text.slice(0, 200));
        errorDetail =
          "Positions endpoint not found (404). Ensure the Python service on the server is up to date and restarted so /options/relay/positions is available.";
      } else if (isJson) {
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
        { error: errorDetail },
        { status: response.status }
      );
    }

    if (!isJson) {
      return NextResponse.json(
        {
          error:
            "Backend returned HTML instead of JSON. Is the Python service running on port 8000?",
        },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);

    // Filter out managed/advisor accounts that shouldn't appear in IB Trading Tools
    const EXCLUDED_ACCOUNTS = new Set(["U22621569"]);
    if (Array.isArray(data)) {
      const filtered = data.filter((p: any) => !EXCLUDED_ACCOUNTS.has(p.account));
      return NextResponse.json(filtered);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching positions:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch positions",
      },
      { status: 500 }
    );
  }
}
