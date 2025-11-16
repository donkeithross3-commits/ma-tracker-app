import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: Request) {
  try {
    // Extract query parameters from the request URL
    const { searchParams } = new URL(request.url);
    const days = searchParams.get("days");
    const source_name = searchParams.get("source_name");
    const min_confidence = searchParams.get("min_confidence");
    const limit = searchParams.get("limit");

    // Build the URL for the Python backend
    let url = `${PYTHON_SERVICE_URL}/intelligence/sources`;
    const params = new URLSearchParams();
    if (days) params.append("days", days);
    if (source_name) params.append("source_name", source_name);
    if (min_confidence) params.append("min_confidence", min_confidence);
    if (limit) params.append("limit", limit);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "Failed to get intelligence sources" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Intelligence sources fetch error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: "Failed to connect to Python backend service"
      },
      { status: 500 }
    );
  }
}
