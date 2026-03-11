import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Proxy CoS API requests to the FastAPI backend.
 *
 * POST /api/cos/chat    → POST {PYTHON_SERVICE_URL}/cos/chat
 * GET  /api/cos/activity → GET  {PYTHON_SERVICE_URL}/cos/activity
 * GET  /api/cos/health  → GET  {PYTHON_SERVICE_URL}/cos/health
 */
async function proxyCos(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\/cos/, "");
    const targetUrl = `${PYTHON_SERVICE_URL}/cos${subPath}${url.search}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    if (request.method === "POST" || request.method === "PUT") {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (error: unknown) {
    console.error("CoS proxy error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        error: message,
        details: "Failed to connect to Python backend service",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyCos(request);
}

export async function POST(request: NextRequest) {
  return proxyCos(request);
}
