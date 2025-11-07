import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/deals - List all deals
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");

    const where = status ? { status } : {};

    const deals = await prisma.deal.findMany({
      where,
      include: {
        versions: {
          where: { isCurrentVersion: true },
          take: 1,
        },
        prices: {
          orderBy: { priceDate: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ deals });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json(
      { error: "Failed to fetch deals" },
      { status: 500 }
    );
  }
}

// POST /api/deals - Create new deal from intelligence data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      // Basic deal info
      ticker,
      targetName,
      acquirorTicker,
      acquirorName,
      status = "active",

      // Deal version data
      announcedDate,
      expectedCloseDate,
      outsideDate,
      category,
      cashPerShare,
      stockRatio,
      dividendsOther,
      stressTestDiscount,
      voteRisk,
      financeRisk,
      legalRisk,
      currentYield,
      isInvestable,
      investableNotes,
      dealNotes,
      goShopEndDate,

      // User ID (would come from auth in production)
      createdById,

      // Intelligence tracking
      intelligenceDealId,
    } = body;

    // Create deal and first version in a transaction
    const deal = await prisma.deal.create({
      data: {
        ticker,
        targetName,
        acquirorTicker,
        acquirorName,
        status,
        createdById,
        updatedById: createdById,
        intelligenceDealId: intelligenceDealId || null,
        lastIntelligenceSync: intelligenceDealId ? new Date() : null,
        versions: {
          create: {
            versionNumber: 1,
            announcedDate: announcedDate ? new Date(announcedDate) : null,
            expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
            outsideDate: outsideDate ? new Date(outsideDate) : null,
            category,
            cashPerShare,
            stockRatio,
            dividendsOther,
            stressTestDiscount,
            voteRisk,
            financeRisk,
            legalRisk,
            currentYield,
            isInvestable: isInvestable || false,
            investableNotes,
            dealNotes,
            goShopEndDate: goShopEndDate ? new Date(goShopEndDate) : null,
            isCurrentVersion: true,
            createdById,
          },
        },
      },
      include: {
        versions: true,
      },
    });

    // If intelligence deal ID provided, update intelligence system to track this deal
    if (intelligenceDealId) {
      try {
        const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
        const trackResponse = await fetch(
          `${pythonServiceUrl}/intelligence/deals/${intelligenceDealId}/track`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ production_deal_id: deal.id }),
          }
        );

        if (!trackResponse.ok) {
          console.warn("Failed to track deal in intelligence system:", await trackResponse.text());
        } else {
          console.log("Successfully linked deal to intelligence system");
        }
      } catch (error) {
        console.error("Error linking to intelligence system:", error);
        // Don't fail the request if intelligence linking fails
      }
    }

    return NextResponse.json({ deal }, { status: 201 });
  } catch (error) {
    console.error("Error creating deal:", error);
    return NextResponse.json(
      { error: "Failed to create deal", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
