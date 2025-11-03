import { NextRequest, NextResponse } from "next/server";

// Python service URL - update this with your deployed service URL
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.ticker || !body.deal_price || !body.expected_close_date) {
      return NextResponse.json(
        { error: "Missing required fields: ticker, deal_price, expected_close_date" },
        { status: 400 }
      );
    }

    // Call Python service
    const response = await fetch(`${PYTHON_SERVICE_URL}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "Failed to scan options" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Options scan error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: "Failed to connect to options scanner service. Ensure Python service is running."
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/health`, {
      method: "GET",
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: "Python service not responding" },
        { status: 503 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      status: "healthy",
      python_service: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error.message,
        python_service_url: PYTHON_SERVICE_URL
      },
      { status: 503 }
    );
  }
}
