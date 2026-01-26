import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  GenerateCandidatesResponse,
  CandidateStrategy,
} from "@/types/ma-options";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

interface ScanParameters {
  daysBeforeClose?: number;
  strikeLowerBound?: number;
  strikeUpperBound?: number;
  shortStrikeLower?: number;
  shortStrikeUpper?: number;
  topStrategiesPerExpiration?: number;
  dealConfidence?: number;
}

interface ChainData {
  ticker: string;
  spotPrice: number;
  dealPrice: number;
  expectedCloseDate: string;
  contracts: any[];
}

interface GenerateCandidatesRequest {
  snapshotId: string;
  dealId: string;
  scanParams?: ScanParameters;
  chainData?: ChainData; // Direct chain data for ws-relay results
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateCandidatesRequest = await request.json();
    const { snapshotId, dealId, scanParams, chainData: directChainData } = body;

    if (!snapshotId || !dealId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    let ticker: string;
    let dealPrice: number;
    let spotPrice: number;
    let formattedCloseDate: string;
    let contracts: any[];

    // If direct chain data is provided (from ws-relay), use it
    if (directChainData) {
      ticker = directChainData.ticker;
      dealPrice = directChainData.dealPrice;
      spotPrice = directChainData.spotPrice;
      contracts = directChainData.contracts;
      // Parse the close date
      const closeDate = new Date(directChainData.expectedCloseDate);
      formattedCloseDate = closeDate.toISOString().split('T')[0];
    } else {
      // Fetch snapshot from database
      const snapshot = await prisma.optionChainSnapshot.findUnique({
        where: { id: snapshotId },
        include: {
          deal: {
            include: {
              versions: {
                where: { isCurrentVersion: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!snapshot) {
        return NextResponse.json(
          { error: "Snapshot not found" },
          { status: 404 }
        );
      }

      const version = snapshot.deal.versions[0];
      if (!version || !version.expectedCloseDate) {
        return NextResponse.json(
          { error: "Deal missing expected close date" },
          { status: 400 }
        );
      }

      ticker = snapshot.ticker;
      dealPrice = snapshot.dealPrice.toNumber();
      spotPrice = snapshot.spotPrice.toNumber();
      contracts = snapshot.chainData as any[];
      formattedCloseDate = version.expectedCloseDate.toISOString().split('T')[0];
    }

    // Call Python service to generate strategies
    try {
      const response = await fetch(
        `${PYTHON_SERVICE_URL}/options/generate-strategies`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ticker,
            dealPrice,
            expectedCloseDate: formattedCloseDate,
            chainData: {
              ticker,
              spotPrice,
              expirations: [], // Will be extracted from contracts
              contracts,
            },
            scanParams: scanParams || {},
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Python service returned ${response.status}`);
      }

      const data: { candidates: CandidateStrategy[] } = await response.json();

      const result: GenerateCandidatesResponse = {
        candidates: data.candidates,
      };

      return NextResponse.json(result);
    } catch (pythonError) {
      console.warn("Python analyzer offline:", (pythonError as Error).message);
      
      // Return a 200 with an empty list and a message instead of a 500 crash
      return NextResponse.json({
        candidates: [],
        error: "Strategy analyzer is currently offline. Market data is available but strategy generation requires the Python service.",
        source: "agent-only"
      });
    }
  } catch (error) {
    console.error("Error generating candidates:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate candidates",
      },
      { status: 500 }
    );
  }
}

