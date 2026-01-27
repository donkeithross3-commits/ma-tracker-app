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
  callShortStrikeLower?: number;
  callShortStrikeUpper?: number;
  putShortStrikeLower?: number;
  putShortStrikeUpper?: number;
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

    console.log(`generate-candidates: snapshotId=${snapshotId}, dealId=${dealId}, hasChainData=${!!directChainData}`);

    if (!snapshotId || !dealId) {
      console.log("generate-candidates: Missing required fields");
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
      console.log(`generate-candidates: Using direct chain data for ${directChainData.ticker}, contracts: ${directChainData.contracts?.length || 0}`);
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
    console.log(`generate-candidates: Calling Python service at ${PYTHON_SERVICE_URL}/options/generate-strategies`);
    console.log(`generate-candidates: Payload - ticker=${ticker}, dealPrice=${dealPrice}, closeDate=${formattedCloseDate}, contracts=${contracts?.length || 0}`);
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

      console.log(`generate-candidates: Python service response status: ${response.status}`);
      if (!response.ok) {
        throw new Error(`Python service returned ${response.status}`);
      }

      const data: { candidates: CandidateStrategy[] } = await response.json();
      console.log(`generate-candidates: Got ${data.candidates?.length || 0} candidates`);

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

