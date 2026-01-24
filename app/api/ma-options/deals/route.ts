import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { DealForScanner } from "@/types/ma-options";

export async function GET() {
  try {
    // Fetch active deals with their latest version and count of active watched spreads
    const deals = await prisma.deal.findMany({
      where: {
        status: "active",
      },
      include: {
        versions: {
          where: {
            isCurrentVersion: true,
          },
          orderBy: {
            versionNumber: "desc",
          },
          take: 1,
        },
        watchedSpreads: {
          where: {
            status: "active",
          },
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        ticker: "asc",
      },
    });

    // Transform to DealForScanner format
    const dealsForScanner: DealForScanner[] = deals
      .filter((deal) => deal.versions.length > 0)
      .map((deal) => {
        const version = deal.versions[0];
        const expectedCloseDate = version.expectedCloseDate;
        const dealPrice = version.cashPerShare?.toNumber() || 0;

        // Calculate days to close
        let daysToClose = 0;
        if (expectedCloseDate) {
          const today = new Date();
          const closeDate = new Date(expectedCloseDate);
          daysToClose = Math.ceil(
            (closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );
        }

        return {
          id: deal.id,
          ticker: deal.ticker,
          targetName: deal.targetName || "",
          acquirorName: deal.acquirorName || null,
          dealPrice,
          expectedCloseDate: expectedCloseDate
            ? expectedCloseDate.toISOString()
            : "",
          daysToClose,
          status: deal.status,
          noOptionsAvailable: deal.noOptionsAvailable,
          lastOptionsCheck: deal.lastOptionsCheck
            ? deal.lastOptionsCheck.toISOString()
            : null,
          watchedSpreadsCount: deal.watchedSpreads.length,
        };
      })
      .filter((deal) => deal.dealPrice > 0 && deal.expectedCloseDate); // Only deals with price and date

    return NextResponse.json({ deals: dealsForScanner });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json(
      { error: "Failed to fetch deals" },
      { status: 500 }
    );
  }
}

