import { NextRequest, NextResponse } from "next/server";

// POST /api/intelligence/suggestions/[suggestionId]/reject - Reject a suggestion
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> }
) {
  try {
    const { suggestionId } = await params;
    const body = await request.json();
    const { reviewed_by, rejection_reason } = body;

    if (!reviewed_by) {
      return NextResponse.json(
        { error: "reviewed_by is required" },
        { status: 400 }
      );
    }

    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
    const response = await fetch(
      `${pythonServiceUrl}/intelligence/suggestions/${suggestionId}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed_by, rejection_reason }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: "Failed to reject suggestion", details: error.detail || error },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error rejecting suggestion:", error);
    return NextResponse.json(
      { error: "Failed to reject suggestion", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
