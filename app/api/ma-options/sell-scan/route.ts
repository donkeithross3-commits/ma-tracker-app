import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export interface SellScanContract {
  symbol: string;
  strike: number;
  expiry: string;
  right: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  open_interest: number;
  implied_vol?: number;
  delta?: number;
}

export interface SellScanResponse {
  ticker: string;
  spotPrice: number;
  right: string;
  expirations: string[];
  contracts: SellScanContract[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, right = "C" } = body;

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    const side = (right as string).toUpperCase();
    if (side !== "C" && side !== "P") {
      return NextResponse.json(
        { error: "right must be C or P" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();

    const response = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/sell-scan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          right: side,
          userId: user?.id || undefined,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail = errorData.detail ?? errorData.error;
      const message =
        response.status === 404
          ? "Sell-scan endpoint not available (404). Restart the Python service on the server to load the latest code."
          : detail || `Sell scan failed: ${response.status}`;
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const data: SellScanResponse = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sell scan error:", error);
    return NextResponse.json(
      { error: "Sell scan failed" },
      { status: 500 }
    );
  }
}
