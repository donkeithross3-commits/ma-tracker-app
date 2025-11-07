import { NextRequest, NextResponse } from "next/server";

// GET /api/intelligence/suggestions/[dealId] - Get suggestions for a production deal
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");

    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
    const url = new URL(`/intelligence/suggestions/${dealId}`, pythonServiceUrl);

    if (status) {
      url.searchParams.append("status", status);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch suggestions", details: error },
        { status: response.status }
      );
    }

    const suggestions = await response.json();
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error fetching suggestions:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
