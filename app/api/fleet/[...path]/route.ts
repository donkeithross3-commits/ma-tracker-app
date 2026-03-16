import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Proxy fleet API requests to the FastAPI backend.
 *
 * GET  /api/fleet/status  → GET  {PYTHON_SERVICE_URL}/fleet/status
 * GET  /api/fleet/alerts  → GET  {PYTHON_SERVICE_URL}/fleet/alerts
 * GET  /api/fleet/utilization → GET {PYTHON_SERVICE_URL}/fleet/utilization
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

    // Utilization endpoint parses a large telemetry file — give it more
    // time but don't hang indefinitely (Cloudflare 524s at ~100s).
    const isUtilization = subPath.includes("utilization");
    const timeoutMs = isUtilization ? 60_000 : 15_000;
    const response = await fetch(targetUrl, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
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
