import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: Request) {
  try {
    // Parse query parameters from the request URL
    const { searchParams } = new URL(request.url);
    const excludeWatchList = searchParams.get("exclude_watch_list") === "true";
    const watchListOnly = searchParams.get("watch_list_only") === "true";

    // Build Python service URL with query params
    const params = new URLSearchParams();
    if (excludeWatchList) params.set("exclude_watch_list", "true");
    if (watchListOnly) params.set("watch_list_only", "true");

    const url = `${PYTHON_SERVICE_URL}/intelligence/rumored-deals${params.toString() ? `?${params.toString()}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "Failed to get rumored deals" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Rumored deals fetch error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: "Failed to connect to Python backend service"
      },
      { status: 500 }
    );
  }
}
