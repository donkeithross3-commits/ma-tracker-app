import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { AvailabilityCheckResponse } from "@/types/ma-options";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get("ticker");

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker parameter is required" },
        { status: 400 }
      );
    }

    // 1. Check for recent snapshots in the database (distributed model)
    const recentSnapshot = await prisma.optionChainSnapshot.findFirst({
      where: {
        ticker: ticker.toUpperCase(),
        snapshotDate: {
          gte: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes
        },
      },
    });

    if (recentSnapshot) {
      return NextResponse.json({
        available: true,
        expirationCount: recentSnapshot.expirationCount,
        source: "agent",
      });
    }

    // 2. Fall back to Python service
    try {
      const response = await fetch(
        `${PYTHON_SERVICE_URL}/options/check-availability?ticker=${encodeURIComponent(ticker)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data: AvailabilityCheckResponse = await response.json();
        return NextResponse.json({
          ...data,
          source: "python-service",
        });
      }
    } catch (pythonError) {
      console.warn(`Python service availability check failed for ${ticker}:`, pythonError.message);
      // If Python service is down and no recent agent data, it's not "available" right now
    }

    return NextResponse.json({
      available: false,
      expirationCount: 0,
      message: "No recent market data available from agents or server",
    });
  } catch (error) {
    console.error("Error checking option availability:", error);
    return NextResponse.json(
      {
        available: false,
        expirationCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

