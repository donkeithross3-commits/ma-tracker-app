import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * GET /api/ib-connection/relay-registry
 *
 * Returns the current WebSocket relay registry (connected agents) from the Python service.
 * Use for debugging when the dashboard shows "Disconnected" but the agent appears connected.
 * If providers_connected > 0, the agent is registered; check provider_statuses in ib-status for IB state.
 */
export async function GET() {
  try {
    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/registry`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 0 },
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: "Relay registry unavailable", detail: data },
        { status: response.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach Python service",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
