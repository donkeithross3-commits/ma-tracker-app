import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

interface IngestChainRequest {
  agentId: string;
  ticker: string;
  agentTimestamp: string;
  spotPrice: number;
  dealPrice: number;
  expectedCloseDate: string;
  contracts: Array<{
    symbol: string;
    strike: number;
    expiry: string;
    right: string;
    bid: number;
    ask: number;
    mid: number;
    last: number;
    volume: number;
    openInterest: number;
    impliedVol: number;
    delta: number;
    bidSize: number;
    askSize: number;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7);
    if (!AGENT_API_KEY || apiKey !== AGENT_API_KEY) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 403 }
      );
    }

    // 2. Validate payload
    const body: IngestChainRequest = await request.json();
    const {
      agentId,
      ticker,
      agentTimestamp,
      spotPrice,
      dealPrice,
      expectedCloseDate,
      contracts,
    } = body;

    if (!agentId || !ticker || !agentTimestamp || !contracts) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, ticker, agentTimestamp, contracts" },
        { status: 400 }
      );
    }

    if (!Array.isArray(contracts)) {
      return NextResponse.json(
        { error: "contracts must be an array" },
        { status: 400 }
      );
    }

    // 3. Timestamp validation
    const serverTime = new Date();
    const agentTime = new Date(agentTimestamp);

    // Reject future timestamps (1-minute tolerance for clock skew)
    const skew = agentTime.getTime() - serverTime.getTime();
    if (skew > 60000) {
      return NextResponse.json(
        {
          error: "Agent timestamp is in the future",
          agentTimestamp,
          serverTime: serverTime.toISOString(),
          skewMs: skew,
        },
        { status: 400 }
      );
    }

    // 4. Find deal by ticker
    const deal = await prisma.deal.findFirst({
      where: { ticker: ticker.toUpperCase() },
      include: {
        versions: {
          where: { isCurrentVersion: true },
          take: 1,
        },
      },
    });

    if (!deal) {
      return NextResponse.json(
        { error: `Deal not found for ticker: ${ticker}` },
        { status: 404 }
      );
    }

    // 5. Check for conflicts (1-minute window)
    const existing = await prisma.optionChainSnapshot.findFirst({
      where: {
        ticker: ticker.toUpperCase(),
        snapshotDate: {
          gte: new Date(serverTime.getTime() - 60000), // 1 minute ago
        },
      },
      orderBy: { snapshotDate: "desc" },
    });

    if (existing) {
      // Log conflict (application logs)
      console.log("Price conflict detected", {
        ticker,
        existingAgent: existing.agentId,
        existingTime: existing.snapshotDate,
        newAgent: agentId,
        newTime: serverTime,
        action: "rejecting_older",
      });

      // Return 409 to inform agent (not an error, just FYI)
      return NextResponse.json(
        {
          status: 409,
          message: "Newer data already exists",
          existingTimestamp: existing.snapshotDate,
          existingAgent: existing.agentId,
        },
        { status: 409 }
      );
    }

    // 6. Calculate days to close
    const dealVersion = deal.versions[0];
    const daysToClose = dealVersion?.expectedCloseDate
      ? Math.ceil(
          (new Date(dealVersion.expectedCloseDate).getTime() -
            serverTime.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;

    // 7. Extract unique expirations and strikes
    const expirations = [...new Set(contracts.map((c) => c.expiry))];
    const strikes = [...new Set(contracts.map((c) => c.strike))];

    // 8. Save snapshot
    // CRITICAL: Use serverTime for snapshotDate (authoritative)
    //           Store agentTimestamp for display only
    const snapshot = await prisma.optionChainSnapshot.create({
      data: {
        dealId: deal.id,
        ticker: ticker.toUpperCase(),
        snapshotDate: serverTime, // Authoritative (server receipt time)
        agentId: agentId, // For tracking
        agentTimestamp: agentTime, // For display only
        spotPrice,
        dealPrice: dealVersion?.cashPerShare || dealPrice,
        daysToClose,
        chainData: contracts,
        expirationCount: expirations.length,
        strikeCount: strikes.length,
      },
    });

    // 9. Log success
    console.log("Price data ingested successfully", {
      agentId,
      ticker,
      snapshotId: snapshot.id,
      contractCount: contracts.length,
      serverTime: serverTime.toISOString(),
      agentTime: agentTimestamp,
    });

    return NextResponse.json({
      success: true,
      dealId: deal.id,
      snapshotId: snapshot.id,
      contractsReceived: contracts.length,
      serverTimestamp: serverTime.toISOString(),
    });
  } catch (error) {
    console.error("Error ingesting chain data:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

