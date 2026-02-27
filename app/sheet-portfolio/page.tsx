import { prisma } from "@/lib/db";
import type { ScannerDeal } from "@/types/ma-options";
import SheetPortfolioContent from "@/components/sheet-portfolio/SheetPortfolioContent";

// Force dynamic rendering - this page requires database access
export const dynamic = 'force-dynamic';

export default async function SheetPortfolioPage() {
  // Fetch active scanner deals for the Curate tab
  const deals = await prisma.scannerDeal.findMany({
    where: {
      isActive: true,
    },
    include: {
      addedBy: { select: { alias: true } },
    },
    orderBy: {
      ticker: "asc",
    },
  });

  // Transform to ScannerDeal format for client
  const scannerDeals: ScannerDeal[] = deals.map((deal) => {
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
      addedById: deal.addedById,
      addedByAlias: deal.addedBy?.alias || null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };
  });

  return <SheetPortfolioContent initialDeals={scannerDeals} />;
}
