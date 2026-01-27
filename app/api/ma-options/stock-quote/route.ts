import { NextRequest, NextResponse } from "next/server";

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

    // Fetch stock quote through the Python service relay
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/relay/stock-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: ticker.toUpperCase() }),
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
