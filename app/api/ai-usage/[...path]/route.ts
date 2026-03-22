import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Proxy AI usage API requests to the FastAPI backend.
 *
 * GET  /api/ai-usage/summary   → GET  {PYTHON_SERVICE_URL}/ai-usage/summary
 * GET  /api/ai-usage/sessions  → GET  {PYTHON_SERVICE_URL}/ai-usage/sessions
 * GET  /api/ai-usage/burn-rate → GET  {PYTHON_SERVICE_URL}/ai-usage/burn-rate
 * POST /api/ai-usage/ingest    → POST {PYTHON_SERVICE_URL}/ai-usage/ingest
 */
async function proxyAiUsage(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\/ai-usage/, "");
    const targetUrl = `${PYTHON_SERVICE_URL}/ai-usage${subPath}${url.search}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Forward auth header on POST (collector uses X-Fleet-Key)
    const fleetKey = request.headers.get("x-fleet-key");
    if (fleetKey) {
      headers["x-fleet-key"] = fleetKey;
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    if (request.method === "POST" || request.method === "PUT") {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(targetUrl, {
      ...fetchOptions,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (error: unknown) {
    console.error("AI usage proxy error:", error);
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
  return proxyAiUsage(request);
}

export async function POST(request: NextRequest) {
  return proxyAiUsage(request);
}
