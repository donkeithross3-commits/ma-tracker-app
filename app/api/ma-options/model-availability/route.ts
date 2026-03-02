import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * GET /api/ma-options/model-availability
 *
 * Returns per-ticker model availability from the BMC model registry.
 * Used by the Signals tab to show which tickers have UP/DOWN/symmetric models
 * before starting the execution engine.
 */
export async function GET() {
  try {
    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/model-availability`,
      { method: "GET", next: { revalidate: 0 } }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { tickers: {}, error: errorData.detail || `Python service returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Model availability error:", error);
    return NextResponse.json(
      { tickers: {}, error: "Python service unreachable" },
      { status: 503 }
    );
  }
}
