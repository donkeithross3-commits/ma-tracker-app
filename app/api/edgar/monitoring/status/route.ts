import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/edgar/monitoring/status`, {
      method: "GET",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "Failed to get EDGAR monitoring status" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("EDGAR monitoring status error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: "Failed to connect to Python backend service"
      },
      { status: 500 }
    );
  }
}
