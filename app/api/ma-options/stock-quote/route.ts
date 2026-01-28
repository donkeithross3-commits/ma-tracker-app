import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export interface StockQuoteResponse {
  ticker: string;
  price: number;
  bid: number | null;
  ask: number | null;
  timestamp: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker } = body;

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    // Get current user for agent routing (optional)
    const user = await getCurrentUser();

    // Fetch stock quote through the Python service relay
    // Include userId so requests are routed to the user's own agent when available
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/relay/stock-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        ticker: ticker.toUpperCase(),
        userId: user?.id || undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Failed to fetch quote: ${response.status}` },
        { status: response.status }
      );
    }

    const data: StockQuoteResponse = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching stock quote:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock quote" },
      { status: 500 }
    );
  }
}
