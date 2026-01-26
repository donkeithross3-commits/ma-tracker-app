import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  WatchSpreadRequest,
  WatchSpreadResponse,
} from "@/types/ma-options";

export async function POST(request: NextRequest) {
  try {
    const body: WatchSpreadRequest = await request.json();
    const { dealId: scannerDealId, strategy, notes } = body;

    if (!scannerDealId || !strategy) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Parse expiration date - handle both Date objects and string formats
    console.log("DEBUG: Parsing expiration:", strategy.expiration, typeof strategy.expiration);
    let expirationDate: Date;
    if (strategy.expiration instanceof Date) {
      expirationDate = strategy.expiration;
      console.log("DEBUG: Using Date object:", expirationDate);
    } else if (typeof strategy.expiration === 'string') {
      const expirationStr = strategy.expiration as string;
      // Handle YYYYMMDD format (e.g., "20260918")
      if (/^\d{8}$/.test(expirationStr)) {
        const year = parseInt(expirationStr.substring(0, 4));
        const month = parseInt(expirationStr.substring(4, 6)) - 1; // JS months are 0-indexed
        const day = parseInt(expirationStr.substring(6, 8));
        expirationDate = new Date(year, month, day);
        console.log("DEBUG: Parsed YYYYMMDD to:", expirationDate.toISOString());
      } else {
        // Try parsing as ISO string
        expirationDate = new Date(expirationStr);
        console.log("DEBUG: Parsed ISO string to:", expirationDate.toISOString());
      }
    } else {
      throw new Error("Invalid expiration date format");
    }

    // Create watched spread
    const spread = await prisma.watchedSpread.create({
      data: {
        scannerDealId,
        strategyType: strategy.strategyType,
        expiration: expirationDate,
        legs: strategy.legs as any,
        entryPremium: strategy.netPremium,
        maxProfit: strategy.maxProfit,
        maxLoss: strategy.maxLoss,
        returnOnRisk: strategy.returnOnRisk,
        annualizedYield: strategy.annualizedYield,
        avgBidAskSpread:
          strategy.legs.reduce(
            (sum, leg) => sum + (leg.ask - leg.bid) / leg.mid,
            0
          ) / strategy.legs.length,
        avgVolume:
          strategy.legs.reduce((sum, leg) => sum + leg.volume, 0) /
          strategy.legs.length,
        avgOpenInterest:
          strategy.legs.reduce((sum, leg) => sum + leg.openInterest, 0) /
          strategy.legs.length,
        status: "active",
        notes: notes || null,
      },
    });

    const result: WatchSpreadResponse = {
      spreadId: spread.id,
      success: true,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error watching spread:", error);
    console.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        spreadId: "",
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to watch spread",
      },
      { status: 500 }
    );
  }
}

