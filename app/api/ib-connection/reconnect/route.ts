import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/ib-reconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          message: `Python service returned ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error reconnecting to IB:", error);
    return NextResponse.json(
      {
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : "Failed to reconnect to IB",
      },
      { status: 500 }
    );
  }
}

