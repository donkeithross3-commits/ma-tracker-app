import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type {
  WatchSpreadRequest,
  WatchSpreadResponse,
  StrategyLeg,
} from "@/types/ma-options";

/**
 * Generate a unique signature for spread legs
 * This allows us to identify duplicate spreads regardless of leg order in JSON
 */
function generateLegSignature(legs: StrategyLeg[] | unknown): string {
  const legArray = legs as StrategyLeg[];
  if (!Array.isArray(legArray)) return "";
  
  return legArray
    .map(l => `${l.strike}|${l.right}|${l.side}|${l.quantity}`)
    .sort()
    .join(',');
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    
    const body: WatchSpreadRequest = await request.json();
    const { dealId: scannerDealId, strategy, underlyingPrice, notes, listIds, newListName } = body;

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

    // Generate leg signature for the new spread
    const newLegSignature = generateLegSignature(strategy.legs);
    console.log("DEBUG: Leg signature:", newLegSignature);

    // Check for existing duplicate spread
    // We need to check for same deal, strategy type, expiration, and leg signature
    const existingSpreads = await prisma.watchedSpread.findMany({
      where: {
        scannerDealId,
        strategyType: strategy.strategyType,
        expiration: expirationDate,
        status: "active",
      },
    });

    // Check if any existing spread has the same leg signature
    for (const existing of existingSpreads) {
      const existingLegSig = generateLegSignature(existing.legs);
      if (existingLegSig === newLegSignature) {
        console.log("DEBUG: Found duplicate spread:", existing.id);
        return NextResponse.json({
          spreadId: existing.id,
          success: false,
          duplicate: true,
          message: "This spread is already in your watchlist",
        });
      }
    }

    // No duplicate found, create the spread
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
        underlyingPrice: underlyingPrice || null,
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
        curatedBy: userId || null,
        isPublic: true, // All spreads are public by default
      },
    });

    // Handle list assignments if user is logged in
    if (userId) {
      const listsToAdd: string[] = [...(listIds || [])];
      
      // Create new list if requested
      if (newListName) {
        const newList = await prisma.userDealList.create({
          data: {
            userId,
            name: newListName,
            isDefault: false,
          },
        });
        listsToAdd.push(newList.id);
      }
      
      // Add the spread to each selected list
      for (const listId of listsToAdd) {
        // Verify user owns this list
        const list = await prisma.userDealList.findFirst({
          where: { id: listId, userId },
        });
        
        if (list) {
          // Add the spread to the list
          await prisma.userDealListItem.upsert({
            where: {
              listId_spreadId: {
                listId,
                spreadId: spread.id,
              },
            },
            create: {
              listId,
              spreadId: spread.id,
            },
            update: {}, // Don't update if already exists
          });
        }
      }
    }

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

