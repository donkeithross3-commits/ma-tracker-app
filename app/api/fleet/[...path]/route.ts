import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Proxy fleet API requests to the FastAPI backend.
 *
 * GET  /api/fleet/status  → GET  {PYTHON_SERVICE_URL}/fleet/status
 * GET  /api/fleet/alerts  → GET  {PYTHON_SERVICE_URL}/fleet/alerts
 * POST /api/fleet/checkin → POST {PYTHON_SERVICE_URL}/fleet/checkin
 */
async function proxyFleet(request: NextRequest) {
  try {
    // Extract the sub-path after /api/fleet/
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\/fleet/, "");
    const targetUrl = `${PYTHON_SERVICE_URL}/fleet${subPath}${url.search}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Forward auth header on POST
    const fleetKey = request.headers.get("x-fleet-key");
    if (fleetKey) {
      headers["x-fleet-key"] = fleetKey;
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward body on POST/PUT
    if (request.method === "POST" || request.method === "PUT") {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Fleet proxy error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        error: message,
        details: "Failed to connect to Python backend service",
      },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyFleet(request);
}

export async function POST(request: NextRequest) {
  return proxyFleet(request);
}
