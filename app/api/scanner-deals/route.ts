import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export interface ScannerDealDTO {
  id: string;
  ticker: string;
  targetName: string | null;
  expectedClosePrice: number;
  expectedCloseDate: string;
  daysToClose: number;
  notes: string | null;
  isActive: boolean;
  noOptionsAvailable: boolean;
  lastOptionsCheck: string | null;
  createdAt: string;
  updatedAt: string;
}

// GET - List all active scanner deals
export async function GET() {
  try {
    const deals = await prisma.scannerDeal.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        ticker: "asc",
      },
    });

    const dealsDTO: ScannerDealDTO[] = deals.map((deal) => {
      const expectedCloseDate = new Date(deal.expectedCloseDate);
      const today = new Date();
      const daysToClose = Math.ceil(
        (expectedCloseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        id: deal.id,
        ticker: deal.ticker,
        targetName: deal.targetName,
        expectedClosePrice: deal.expectedClosePrice.toNumber(),
        expectedCloseDate: deal.expectedCloseDate.toISOString().split("T")[0],
        daysToClose,
        notes: deal.notes,
        isActive: deal.isActive,
        noOptionsAvailable: deal.noOptionsAvailable,
        lastOptionsCheck: deal.lastOptionsCheck?.toISOString() || null,
        createdAt: deal.createdAt.toISOString(),
        updatedAt: deal.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ deals: dealsDTO });
  } catch (error) {
    console.error("Error fetching scanner deals:", error);
    return NextResponse.json(
      { error: "Failed to fetch scanner deals" },
      { status: 500 }
    );
  }
}

// POST - Create a new scanner deal
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, targetName, expectedClosePrice, expectedCloseDate, notes } =
      body;

    // Validate required fields
    if (!ticker || !expectedClosePrice || !expectedCloseDate) {
      return NextResponse.json(
        { error: "ticker, expectedClosePrice, and expectedCloseDate are required" },
        { status: 400 }
      );
    }

    // Check if ticker already exists
    const existing = await prisma.scannerDeal.findUnique({
      where: { ticker: ticker.toUpperCase() },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Deal for ticker ${ticker.toUpperCase()} already exists` },
        { status: 409 }
      );
    }

    const deal = await prisma.scannerDeal.create({
      data: {
        ticker: ticker.toUpperCase(),
        targetName: targetName || null,
        expectedClosePrice,
        expectedCloseDate: new Date(expectedCloseDate),
        notes: notes || null,
      },
    });

    const expectedDate = new Date(deal.expectedCloseDate);
    const today = new Date();
    const daysToClose = Math.ceil(
      (expectedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    const dealDTO: ScannerDealDTO = {
      id: deal.id,
      ticker: deal.ticker,
      targetName: deal.targetName,
      expectedClosePrice: deal.expectedClosePrice.toNumber(),
      expectedCloseDate: deal.expectedCloseDate.toISOString().split("T")[0],
      daysToClose,
      notes: deal.notes,
      isActive: deal.isActive,
      noOptionsAvailable: deal.noOptionsAvailable,
      lastOptionsCheck: deal.lastOptionsCheck?.toISOString() || null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };

    return NextResponse.json({ deal: dealDTO }, { status: 201 });
  } catch (error) {
    console.error("Error creating scanner deal:", error);
    return NextResponse.json(
      { error: "Failed to create scanner deal" },
      { status: 500 }
    );
  }
}
