import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { ArrowUpRight, ArrowLeft } from "lucide-react";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = 'force-dynamic';

async function getPortfolioPositions() {
  const positions = await prisma.portfolioPosition.findMany({
    where: { status: "open" },
    include: {
      deal: {
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
      },
    },
    orderBy: { entryDate: "desc" },
  });

  return positions
    .filter((pos) => pos.deal.versions.length > 0 && pos.deal.prices.length > 0)
    .map((pos) => {
      const deal = pos.deal;
      const version = deal.versions[0];
      const price = deal.prices[0];

      // Calculate deal price
      const cashComponent = version.cashPerShare?.toNumber() || 0;
      const stockComponent =
        version.stockRatio && price.acquirorPrice
          ? version.stockRatio.toNumber() * price.acquirorPrice.toNumber()
          : 0;
      const dividends = version.dividendsOther?.toNumber() || 0;
      const cvrNpv = deal.cvrs.reduce(
        (sum, cvr) =>
          sum + cvr.paymentAmount.toNumber() * cvr.probability.toNumber(),
        0
      );

      const dealPrice = cashComponent + stockComponent + dividends + cvrNpv;
      const currentPrice = price.targetPrice.toNumber();
      const grossSpread = (dealPrice - currentPrice) / currentPrice;

      // Position calculations
      const shares = pos.shares.toNumber();
      const entryPrice = pos.entryPrice.toNumber();
      const costBasis = shares * entryPrice;
      const currentValue = shares * currentPrice;
      const targetValue = shares * dealPrice;
      const unrealizedPL = currentValue - costBasis;
      const unrealizedReturn = (currentPrice - entryPrice) / entryPrice;

      // Calculate days to close
      const daysToClose = version.expectedCloseDate
        ? Math.ceil(
            (new Date(version.expectedCloseDate).getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null;

      // Calculate projected IRR
      const projectedIRR =
        daysToClose && daysToClose > 0
          ? Math.pow(1 + grossSpread, 365 / daysToClose) - 1
          : null;

      return {
        positionId: pos.id,
        dealId: deal.id,
        ticker: deal.ticker,
        targetName: deal.targetName,
        shares,
        entryDate: pos.entryDate,
        entryPrice,
        currentPrice,
        dealPrice,
        costBasis,
        currentValue,
        targetValue,
        unrealizedPL,
        unrealizedReturn,
        grossSpread,
        projectedIRR,
        daysToClose,
        expectedCloseDate: version.expectedCloseDate,
        category: version.category,
        hasCvr: deal.cvrs.length > 0,
        voteRisk: version.voteRisk,
        financeRisk: version.financeRisk,
        legalRisk: version.legalRisk,
      };
    });
}

export default async function PortfolioPage() {
  const positions = await getPortfolioPositions();

  const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
  const totalCurrentValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
  const totalUnrealizedPL = totalCurrentValue - totalCostBasis;
  const totalReturn = totalCostBasis > 0 ? totalUnrealizedPL / totalCostBasis : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Portfolio</h1>
            <p className="text-sm text-muted-foreground">
              {positions.length} open position{positions.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="outline">Home</Button>
            </Link>
            <Link href="/deals">
              <Button variant="outline">M&A Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        {positions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-lg text-muted-foreground mb-4">No open positions</p>
              <Link href="/deals">
                <Button>View Active Deals</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Portfolio Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Value
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(totalCurrentValue)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cost: {formatCurrency(totalCostBasis)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Unrealized P/L
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-2xl font-bold ${
                      totalUnrealizedPL >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(totalUnrealizedPL)}
                  </div>
                  <p
                    className={`text-xs ${
                      totalReturn >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatPercent(totalReturn)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg Spread
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatPercent(
                      positions.reduce((sum, p) => sum + p.grossSpread, 0) /
                        positions.length
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg Projected IRR
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatPercent(
                      positions
                        .filter((p) => p.projectedIRR !== null)
                        .reduce((sum, p) => sum + (p.projectedIRR || 0), 0) /
                        positions.filter((p) => p.projectedIRR !== null).length
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Positions Table */}
            <Card>
              <CardHeader>
                <CardTitle>Open Positions</CardTitle>
                <CardDescription>
                  Click on any position to view deal details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-sm text-muted-foreground">
                        <th className="text-left py-3 px-2 font-medium">Ticker</th>
                        <th className="text-left py-3 px-2 font-medium">Target</th>
                        <th className="text-right py-3 px-2 font-medium">Shares</th>
                        <th className="text-right py-3 px-2 font-medium">Entry</th>
                        <th className="text-right py-3 px-2 font-medium">Current</th>
                        <th className="text-right py-3 px-2 font-medium">Deal Px</th>
                        <th className="text-right py-3 px-2 font-medium">Cost</th>
                        <th className="text-right py-3 px-2 font-medium">Value</th>
                        <th className="text-right py-3 px-2 font-medium">Unreal. P/L</th>
                        <th className="text-right py-3 px-2 font-medium">Return</th>
                        <th className="text-right py-3 px-2 font-medium">Spread</th>
                        <th className="text-right py-3 px-2 font-medium">Proj. IRR</th>
                        <th className="text-center py-3 px-2 font-medium">Days</th>
                        <th className="text-right py-3 px-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos) => (
                        <tr
                          key={pos.positionId}
                          className="border-b hover:bg-muted/50 transition-colors"
                        >
                          <td className="py-3 px-2">
                            <Link
                              href={`/deals/${pos.dealId}`}
                              className="font-semibold hover:underline"
                            >
                              {pos.ticker}
                            </Link>
                          </td>
                          <td className="py-3 px-2 text-sm">
                            {pos.targetName || "-"}
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {pos.shares.toLocaleString()}
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {formatCurrency(pos.entryPrice)}
                            <div className="text-xs text-muted-foreground">
                              {formatDate(pos.entryDate)}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {formatCurrency(pos.currentPrice)}
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {formatCurrency(pos.dealPrice)}
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {formatCurrency(pos.costBasis)}
                          </td>
                          <td className="py-3 px-2 text-right text-sm font-medium">
                            {formatCurrency(pos.currentValue)}
                          </td>
                          <td className="py-3 px-2 text-right text-sm font-medium">
                            <span
                              className={
                                pos.unrealizedPL >= 0
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }
                            >
                              {formatCurrency(pos.unrealizedPL)}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right text-sm font-medium">
                            <span
                              className={
                                pos.unrealizedReturn >= 0
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }
                            >
                              {formatPercent(pos.unrealizedReturn)}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right text-sm">
                            {formatPercent(pos.grossSpread)}
                          </td>
                          <td className="py-3 px-2 text-right text-sm font-medium">
                            {pos.projectedIRR !== null ? (
                              <span
                                className={
                                  pos.projectedIRR >= 0
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-red-600 dark:text-red-400"
                                }
                              >
                                {formatPercent(pos.projectedIRR)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="py-3 px-2 text-center text-sm">
                            {pos.daysToClose !== null ? pos.daysToClose : "-"}
                            {pos.expectedCloseDate && (
                              <div className="text-xs text-muted-foreground">
                                {formatDate(pos.expectedCloseDate)}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right">
                            <Link href={`/deals/${pos.dealId}`}>
                              <Button variant="ghost" size="sm">
                                <ArrowUpRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
