import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import MAOptionsContent from "@/components/ma-options/MAOptionsContent";
import type { ScannerDeal } from "@/types/ma-options";

// Force dynamic rendering - this page requires database access
export const dynamic = 'force-dynamic';

export default async function MAOptionsPage() {
  const session = await auth();
  
  // Fetch active scanner deals with user attribution
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

  console.log(`MA Options Scanner: Loaded ${scannerDeals.length} scanner deals`);

  return (
    <div className="min-h-screen bg-gray-950 px-3 py-2">
      <div className="max-w-[1800px] mx-auto">
        <MAOptionsContent 
          initialDeals={scannerDeals} 
          initialUser={session?.user ? { name: session.user.name, email: session.user.email, alias: session.user.alias } : undefined}
        />
      </div>
    </div>
  );
}
