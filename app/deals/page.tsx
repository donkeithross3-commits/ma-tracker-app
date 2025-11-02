import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";

async function getDealsForDashboard() {
  const deals = await prisma.deal.findMany({
    where: { status: "active" },
    include: {
      versions: {
        where: { isCurrentVersion: true },
        take: 1,
      },
      prices: {
        orderBy: { priceDate: "desc" },
        take: 1,
      },
      cvrs: {
        where: { paymentStatus: "pending" },
      },
    },
  });

  // Calculate metrics for each deal
  const dealsWithMetrics = deals
    .filter((deal) => deal.versions.length > 0)
    .map((deal) => {
      const version = deal.versions[0];
      const price = deal.prices.length > 0 ? deal.prices[0] : null;

      // Calculate deal price
      const cashComponent = version.cashPerShare?.toNumber() || 0;
      const stockComponent =
        version.stockRatio && price?.acquirorPrice
          ? version.stockRatio.toNumber() * price.acquirorPrice.toNumber()
          : 0;
      const dividends = version.dividendsOther?.toNumber() || 0;
      const cvrNpv = deal.cvrs.reduce(
        (sum, cvr) =>
          sum + cvr.paymentAmount.toNumber() * cvr.probability.toNumber(),
        0
      );

      const dealPrice = cashComponent + stockComponent + dividends + cvrNpv;
      const currentPrice = price?.targetPrice.toNumber() || 0;
      const grossYield = dealPrice > 0 ? (dealPrice - currentPrice) / dealPrice : 0;

      // Calculate days to close and outside date
      const daysToClose = version.expectedCloseDate
        ? Math.ceil(
            (new Date(version.expectedCloseDate).getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null;

      const countdown = version.outsideDate
        ? Math.ceil(
            (new Date(version.outsideDate).getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0;

      // Use stored currentYield from individual deal sheet if available, otherwise calculate
      const currentYield = version.currentYield?.toNumber() ?? null;

      // Pre-format all values to ensure consistent server/client rendering
      const dealPriceFormatted = dealPrice > 0 ? `$${dealPrice.toFixed(2)}` : "";
      const currentPriceFormatted = currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "$0.00";
      const grossYieldFormatted = `${(grossYield * 100).toFixed(2)}%`;
      const priceChangeFormatted = "0.00%"; // We don't have historical data yet
      const currentYieldFormatted = currentYield !== null ? `${(currentYield * 100).toFixed(2)}%` : "";
      const countdownDisplay = countdown > 0 ? countdown.toString() : countdown === 0 && !version.outsideDate ? "" : "0";
      const categoryFormatted = version.category?.replace(/_/g, " ") || "";

      return {
        id: deal.id,
        ticker: deal.ticker,
        acquirorName: deal.acquirorName,
        announcedDate: version.announcedDate,
        expectedCloseDate: version.expectedCloseDate,
        outsideDate: version.outsideDate,
        countdown: countdownDisplay,
        dealPrice: dealPriceFormatted,
        currentPrice: currentPriceFormatted,
        grossYield: grossYieldFormatted,
        priceChange: priceChangeFormatted,
        currentYield: currentYieldFormatted,
        category: categoryFormatted,
        isInvestable: version.isInvestable,
        investableNotes: version.investableNotes,
        dealNotes: version.dealNotes,
        voteRisk: version.voteRisk,
        financeRisk: version.financeRisk,
        legalRisk: version.legalRisk,
        hasCvr: deal.cvrs.length > 0,
      };
    });

  // Sort by announced date descending (newest first), like the spreadsheet
  dealsWithMetrics.sort((a, b) => {
    if (!a.announcedDate && !b.announcedDate) return 0;
    if (!a.announcedDate) return 1;
    if (!b.announcedDate) return -1;
    return new Date(b.announcedDate).getTime() - new Date(a.announcedDate).getTime();
  });

  return dealsWithMetrics;
}

function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  // Use UTC methods to avoid timezone conversion issues
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const year = d.getUTCFullYear().toString().slice(-2);
  return `${month}/${day}/${year}`;
}

export default async function DealsPage() {
  const session = await auth();
  const deals = await getDealsForDashboard();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="w-full px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">M&A Dashboard</h1>
            {session?.user && (
              <p className="text-xs text-gray-600">
                {session.user.name || session.user.email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="outline" size="sm">Home</Button>
            </Link>
            <Link href="/portfolio">
              <Button variant="outline" size="sm">Portfolio</Button>
            </Link>
            <Link href="/deals/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Deal
              </Button>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full px-2 py-4">
        <Card className="bg-white overflow-hidden">
          <div className="overflow-x-auto w-full relative">
            <table className="text-xs border-collapse w-full" style={{ minWidth: '1800px' }}>
              <thead>
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '60px' }}>Target</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '120px', maxWidth: '120px' }}>Acquiror</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Anncd</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Close</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>End Dt</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '55px' }}>Cntdwn</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Deal Px</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Crrnt Px</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '70px' }}>Grss Yld</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '60px' }}>Px Chg</th>
                  <th className="text-right py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '70px' }}>Crrnt Yld</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '80px' }}>Category</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '90px', maxWidth: '90px' }}>Investable</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '150px', maxWidth: '150px' }}>Deal Notes</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Vote</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '70px' }}>Finance</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '65px' }}>Legal</th>
                  <th className="text-center py-1.5 px-1.5 font-semibold text-gray-700 border-r border-gray-300 whitespace-nowrap" style={{ width: '40px' }}>CVR</th>
                  <th className="text-left py-1.5 px-1.5 font-semibold text-gray-700 whitespace-nowrap" style={{ width: '45px' }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    {/* Target */}
                    <td className="py-1 px-1.5 border-r border-gray-200" style={{ width: '60px' }}>
                      <Link
                        href={`/deals/${deal.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {deal.ticker}
                      </Link>
                    </td>

                    {/* Acquiror */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '120px', maxWidth: '120px' }}>
                      <div className="truncate" title={deal.acquirorName || ""}>
                        {deal.acquirorName || ""}
                      </div>
                    </td>

                    {/* Announced */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '65px' }}>
                      {formatDateShort(deal.announcedDate)}
                    </td>

                    {/* Close */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '65px' }}>
                      {formatDateShort(deal.expectedCloseDate)}
                    </td>

                    {/* End Dt */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '65px' }}>
                      {deal.outsideDate ? formatDateShort(deal.outsideDate) : ""}
                    </td>

                    {/* Countdown */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '55px' }}>
                      {deal.countdown}
                    </td>

                    {/* Deal Px */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '65px' }}>
                      {deal.dealPrice}
                    </td>

                    {/* Current Px */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '65px' }}>
                      {deal.currentPrice}
                    </td>

                    {/* Gross Yield */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '70px' }}>
                      {deal.grossYield}
                    </td>

                    {/* Px Chng */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '60px' }}>
                      {deal.priceChange}
                    </td>

                    {/* Current Yield (IRR) */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-right text-gray-700" style={{ width: '70px' }}>
                      {deal.currentYield}
                    </td>

                    {/* Category */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700 text-xs" style={{ width: '80px' }}>
                      {deal.category}
                    </td>

                    {/* Investable */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '90px', maxWidth: '90px' }}>
                      <div className="truncate" title={deal.investableNotes || (deal.isInvestable ? "Yes" : "No")}>
                        {deal.investableNotes || (deal.isInvestable ? "Yes" : "No")}
                      </div>
                    </td>

                    {/* Deal Notes */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700" style={{ width: '150px', maxWidth: '150px' }}>
                      <div className="truncate" title={deal.dealNotes || ""}>
                        {deal.dealNotes || ""}
                      </div>
                    </td>

                    {/* Vote Risk */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700 text-xs capitalize whitespace-nowrap" style={{ width: '65px' }}>
                      {deal.voteRisk || ""}
                    </td>

                    {/* Finance Risk */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700 text-xs capitalize whitespace-nowrap" style={{ width: '70px' }}>
                      {deal.financeRisk || ""}
                    </td>

                    {/* Legal Risk */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-gray-700 text-xs capitalize whitespace-nowrap" style={{ width: '65px' }}>
                      {deal.legalRisk || ""}
                    </td>

                    {/* CVR */}
                    <td className="py-1 px-1.5 border-r border-gray-200 text-center text-gray-700" style={{ width: '40px' }}>
                      {deal.hasCvr ? "Y" : "N"}
                    </td>

                    {/* Link to Sheet */}
                    <td className="py-1 px-1.5 text-gray-700" style={{ width: '45px' }}>
                      <Link
                        href={`/deals/${deal.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
