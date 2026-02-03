import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { WatchedSpreadDTO } from "@/types/ma-options";

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  try {
    const searchParams = request.nextUrl.searchParams;
    const scannerDealId = searchParams.get("dealId");
    const filter = searchParams.get("filter"); // "mine" | "all" | null

    // Build where clause
    const where: any = {};
    if (scannerDealId) {
      where.scannerDealId = scannerDealId;
    }

    // Filter by curator if requested
    if (filter === "mine" && userId) {
      where.curatedBy = userId;
    }

    // Fetch watched spreads with scanner deal info and curator
    const spreads = await prisma.watchedSpread.findMany({
      where,
      include: {
        scannerDeal: true,
        curator: { select: { alias: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transform to DTO format
    const spreadsDTO: WatchedSpreadDTO[] = spreads.map((spread) => {
      const expectedCloseDate = spread.scannerDeal.expectedCloseDate;

      // Calculate days to close
      let daysToClose = 0;
      if (expectedCloseDate) {
        const today = new Date();
        const closeDate = new Date(expectedCloseDate);
        daysToClose = Math.ceil(
          (closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // Calculate P&L
      const entryPremium = spread.entryPremium.toNumber();
      const currentPremium = spread.currentPremium?.toNumber() || entryPremium;
      const pnlDollar = currentPremium - entryPremium;
      const pnlPercent = entryPremium !== 0 ? (pnlDollar / entryPremium) * 100 : 0;

      // Calculate liquidity score
      const avgBidAskSpread = spread.avgBidAskSpread?.toNumber() || 0;
      const avgVolume = spread.avgVolume || 0;
      const avgOpenInterest = spread.avgOpenInterest || 0;

      const spreadScore = 1 / (1 + avgBidAskSpread);
      const volumeScore = Math.min(avgVolume / 100, 1);
      const oiScore = Math.min(avgOpenInterest / 1000, 1);
      const liquidityScore =
        (spreadScore * 0.5 + volumeScore * 0.25 + oiScore * 0.25) * 100;

      return {
        id: spread.id,
        dealId: spread.scannerDealId,
        dealTicker: spread.scannerDeal.ticker,
        dealTargetName: spread.scannerDeal.targetName || "",
        dealPrice: spread.scannerDeal.expectedClosePrice.toNumber(),
        dealExpectedCloseDate: spread.scannerDeal.expectedCloseDate.toISOString().split("T")[0],
        strategyType: spread.strategyType,
        expiration: spread.expiration.toISOString(),
        legs: spread.legs as any,
        entryPremium,
        currentPremium,
        underlyingPrice: spread.underlyingPrice?.toNumber() || null,
        maxProfit: spread.maxProfit.toNumber(),
        maxLoss: spread.maxLoss.toNumber(),
        returnOnRisk: spread.returnOnRisk.toNumber(),
        annualizedYield: spread.annualizedYield.toNumber(),
        pnlDollar,
        pnlPercent,
        daysToClose,
        liquidityScore,
        lastUpdated: spread.lastUpdated?.toISOString() || null,
        status: spread.status,
        notes: spread.notes,
        curatedById: spread.curatedBy,
        curatedByAlias: spread.curator?.alias || null,
        isPublic: spread.isPublic,
      };
    });

    return NextResponse.json({ spreads: spreadsDTO });
  } catch (error) {
    console.error("Error fetching watched spreads:", error);
    return NextResponse.json(
      { error: "Failed to fetch watched spreads" },
      { status: 500 }
    );
  }
}
