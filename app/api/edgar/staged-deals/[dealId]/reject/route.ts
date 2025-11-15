import { NextResponse } from "next/server";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;

    // Parse request body for rejection reason and category
    const body = await request.json().catch(() => ({}));
    const { rejection_category, rejection_reason } = body;

    // Call Python backend to reject the staged deal
    const response = await fetch(
      `${PYTHON_SERVICE_URL}/edgar/staged-deals/${dealId}/review`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          action: "reject",
          rejection_category,
          rejection_reason,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Python backend error:", error);
      return NextResponse.json(
        { error: "Failed to reject deal" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Reject staged deal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
