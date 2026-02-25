import { NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL ||
  process.env.PYTHON_SERVICE_URL ||
  "http://localhost:8000";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const response = await fetch(
      `${PORTFOLIO_SERVICE_URL}/portfolio/v2/deal/${ticker.toUpperCase()}/estimates`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Backend returned ${response.status}: ${text}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching deal estimates:", error);
    return NextResponse.json(
      { error: "Failed to fetch deal estimate history" },
      { status: 500 }
    );
  }
}
