import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: Request) {
  try {
    // Extract query parameters from the request URL
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    // Build the URL for the Python backend
    let url = `${PYTHON_SERVICE_URL}/edgar/staged-deals`;
    if (status) {
      url += `?status=${status}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Python backend error:", error);
      // Return empty array on error to maintain consistent data type
      return NextResponse.json([]);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Staged deals fetch error:", error);
    // Return empty array on error to maintain consistent data type
    return NextResponse.json([]);
  }
}
