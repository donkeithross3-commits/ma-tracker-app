import { prisma } from "@/lib/db";
import MAOptionsContent from "@/components/ma-options/MAOptionsContent";
import type { DealForScanner } from "@/types/ma-options";

export default async function MAOptionsPage() {
  // Fetch active deals with watched spreads count
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
    .filter((deal) => deal.dealPrice > 0 && deal.expectedCloseDate);

  console.log(`MA Options Scanner: Loaded ${dealsForScanner.length} deals`);

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-[1800px] mx-auto">
        <MAOptionsContent initialDeals={dealsForScanner} />
      </div>
    </div>
  );
}

