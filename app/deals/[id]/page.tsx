import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, User } from "lucide-react";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";

async function getDealWithLatestData(id: string) {
  const deal = await prisma.deal.findUnique({
    where: { id },
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
      portfolioPositions: {
        where: { status: "open" },
      },
    },
  });

  if (!deal || deal.versions.length === 0) {
    return null;
  }

  return {
    ...deal,
    currentVersion: deal.versions[0],
    latestPrice: deal.prices[0] || null,
  };
}

async function getAuditLogsForDeal(dealId: string) {
  // Get all CVR IDs for this deal
  const cvrs = await prisma.cVR.findMany({
    where: { dealId },
    select: { id: true },
  });
  const cvrIds = cvrs.map((cvr) => cvr.id);

  // Fetch audit logs for the deal and all its CVRs
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "deal", entityId: dealId },
        { entityType: "cvr", entityId: { in: cvrIds } },
      ],
    },
    include: {
      createdBy: {
        select: {
          username: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 50, // Limit to last 50 changes
  });

  return logs;
}

function calculateDealMetrics(deal: any) {
  const version = deal.currentVersion;
  const price = deal.latestPrice;

  if (!price || !version) {
    return null;
  }

  // Calculate deal price
  const cashComponent = version.cashPerShare?.toNumber() || 0;
  const stockComponent = version.stockRatio && price.acquirorPrice
    ? version.stockRatio.toNumber() * price.acquirorPrice.toNumber()
    : 0;
  const dividends = version.dividendsOther?.toNumber() || 0;
  const cvrNpv = deal.cvrs.reduce(
    (sum: number, cvr: any) =>
      sum + cvr.paymentAmount.toNumber() * cvr.probability.toNumber(),
    0
  );

  const dealPrice = cashComponent + stockComponent + dividends + cvrNpv;
  const currentPrice = price.targetPrice.toNumber();
  const grossSpread = (dealPrice - currentPrice) / currentPrice;

  // Calculate days to close
  const daysToClose = version.expectedCloseDate
    ? Math.ceil(
        (new Date(version.expectedCloseDate).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Calculate annualized return (IRR approximation)
  const annualizedReturn =
    daysToClose && daysToClose > 0
      ? Math.pow(1 + grossSpread, 365 / daysToClose) - 1
      : null;

  return {
    dealPrice,
    currentPrice,
    grossSpread,
    daysToClose,
    annualizedReturn,
    cashComponent,
    stockComponent,
    dividends,
    cvrNpv,
  };
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await getDealWithLatestData(id);

  if (!deal) {
    notFound();
  }

  // Fetch audit logs for this deal
  const auditLogs = await getAuditLogsForDeal(id);

  const metrics = calculateDealMetrics(deal);
  const version = deal.currentVersion;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/deals">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{deal.ticker}</h1>
              <p className="text-sm text-muted-foreground">{deal.targetName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/deals/${deal.id}/price/new`}>
              <Button variant="outline">Update Price</Button>
            </Link>
            <Link href={`/deals/${deal.id}/edit`}>
              <Button variant="outline">Edit Deal</Button>
            </Link>
            <Link href={`/deals/${deal.id}/history`}>
              <Button variant="outline">Version History</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="terms">Deal Terms</TabsTrigger>
            <TabsTrigger value="cvrs">CVRs</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Current Spread */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Current Spread
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics ? formatPercent(metrics.grossSpread) : "-"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gross yield to close
                  </p>
                </CardContent>
              </Card>

              {/* Annualized Return */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Projected IRR
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics && metrics.annualizedReturn
                      ? formatPercent(metrics.annualizedReturn)
                      : "-"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Annualized return
                  </p>
                </CardContent>
              </Card>

              {/* Days to Close */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Days to Close
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics?.daysToClose ?? "-"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {version.expectedCloseDate
                      ? formatDate(version.expectedCloseDate)
                      : "No date set"}
                  </p>
                </CardContent>
              </Card>

              {/* Deal Status */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold capitalize">{deal.status}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {version.isInvestable ? "✓ Investable" : "✗ Not investable"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Price Information */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Current Prices</CardTitle>
                  <CardDescription>
                    As of {deal.latestPrice ? formatDate(deal.latestPrice.priceDate) : "-"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Target ({deal.ticker})</span>
                    <span className="font-semibold">
                      {deal.latestPrice ? formatCurrency(deal.latestPrice.targetPrice.toNumber()) : "-"}
                    </span>
                  </div>
                  {deal.acquirorTicker && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        Acquiror ({deal.acquirorTicker})
                      </span>
                      <span className="font-semibold">
                        {deal.latestPrice?.acquirorPrice
                          ? formatCurrency(deal.latestPrice.acquirorPrice.toNumber())
                          : "-"}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm font-medium">Deal Price</span>
                    <span className="font-bold">
                      {metrics ? formatCurrency(metrics.dealPrice) : "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Deal Information</CardTitle>
                  <CardDescription>Key dates and parties</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Acquiror</span>
                    <span className="font-semibold">{deal.acquirorName || "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Announced</span>
                    <span className="font-semibold">
                      {version.announcedDate ? formatDate(version.announcedDate) : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Expected Close</span>
                    <span className="font-semibold">
                      {version.expectedCloseDate ? formatDate(version.expectedCloseDate) : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Outside Date</span>
                    <span className="font-semibold">
                      {version.outsideDate ? formatDate(version.outsideDate) : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Category</span>
                    <span className="font-semibold capitalize">
                      {version.category?.replace(/_/g, " ") || "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Risk Assessment */}
            <Card>
              <CardHeader>
                <CardTitle>Risk Assessment</CardTitle>
                <CardDescription>Evaluation of deal completion risks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-sm font-medium mb-1">Vote Risk</div>
                    <div className="text-2xl font-bold capitalize">
                      {version.voteRisk || "Not assessed"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Finance Risk</div>
                    <div className="text-2xl font-bold capitalize">
                      {version.financeRisk || "Not assessed"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Legal/Regulatory Risk</div>
                    <div className="text-2xl font-bold capitalize">
                      {version.legalRisk || "Not assessed"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Deal Terms Tab */}
          <TabsContent value="terms" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Deal Consideration</CardTitle>
                <CardDescription>Breakdown of deal terms and pricing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Cash per Share</div>
                    <div className="text-xl font-bold">
                      {version.cashPerShare
                        ? formatCurrency(version.cashPerShare.toNumber())
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Stock Ratio</div>
                    <div className="text-xl font-bold">
                      {version.stockRatio ? version.stockRatio.toNumber() : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Dividends/Other</div>
                    <div className="text-xl font-bold">
                      {version.dividendsOther
                        ? formatCurrency(version.dividendsOther.toNumber())
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">CVR NPV</div>
                    <div className="text-xl font-bold">
                      {metrics ? formatCurrency(metrics.cvrNpv) : "-"}
                    </div>
                  </div>
                </div>

                {metrics && (
                  <div className="pt-4 border-t">
                    <div className="text-sm text-muted-foreground mb-2">Total Deal Price</div>
                    <div className="text-3xl font-bold">
                      {formatCurrency(metrics.dealPrice)}
                    </div>
                    <div className="text-sm text-muted-foreground mt-2">
                      Cash: {formatCurrency(metrics.cashComponent)} + Stock:{" "}
                      {formatCurrency(metrics.stockComponent)} + Other:{" "}
                      {formatCurrency(metrics.dividends)} + CVRs:{" "}
                      {formatCurrency(metrics.cvrNpv)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* CVRs Tab */}
          <TabsContent value="cvrs" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Contingent Value Rights</CardTitle>
                    <CardDescription>
                      {deal.cvrs.length > 0
                        ? `${deal.cvrs.length} pending CVR payment(s)`
                        : "No CVRs associated with this deal"}
                    </CardDescription>
                  </div>
                  <Link href={`/deals/${deal.id}/cvr/new`}>
                    <Button size="sm">Add CVR</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {deal.cvrs.length > 0 ? (
                  <div className="space-y-4">
                    {deal.cvrs.map((cvr: any) => (
                      <div key={cvr.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <div className="font-semibold">{cvr.cvrName || "CVR Payment"}</div>
                            <div className="text-sm text-muted-foreground">
                              Due: {formatDate(cvr.paymentDeadline)}
                            </div>
                          </div>
                          <div className="flex items-start gap-4">
                            <div className="text-right">
                              <div className="text-lg font-bold">
                                {formatCurrency(cvr.paymentAmount.toNumber())}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {formatPercent(cvr.probability.toNumber())} probability
                              </div>
                            </div>
                            <Link href={`/deals/${deal.id}/cvr/${cvr.id}/edit`}>
                              <Button variant="outline" size="sm">
                                Edit
                              </Button>
                            </Link>
                          </div>
                        </div>
                        {cvr.notes && (
                          <div className="text-sm text-muted-foreground mt-2">{cvr.notes}</div>
                        )}
                        <div className="mt-2 pt-2 border-t flex justify-between items-center">
                          <div>
                            <span className="text-sm font-medium">Expected Value: </span>
                            <span className="text-sm font-bold">
                              {formatCurrency(
                                cvr.paymentAmount.toNumber() * cvr.probability.toNumber()
                              )}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                cvr.paymentStatus === "paid"
                                  ? "bg-green-100 text-green-700"
                                  : cvr.paymentStatus === "expired"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {cvr.paymentStatus}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No CVRs configured for this deal
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Positions Tab */}
          <TabsContent value="positions" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Portfolio Positions</CardTitle>
                    <CardDescription>
                      {deal.portfolioPositions.length > 0
                        ? `${deal.portfolioPositions.length} open position(s)`
                        : "No positions taken in this deal"}
                    </CardDescription>
                  </div>
                  <Link href={`/deals/${deal.id}/position/new`}>
                    <Button size="sm">Open Position</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {deal.portfolioPositions.length > 0 ? (
                  <div className="space-y-4">
                    {deal.portfolioPositions.map((position: any) => {
                      const currentPrice = deal.latestPrice?.targetPrice.toNumber() || 0;
                      const entryPrice = position.entryPrice.toNumber();
                      const shares = position.shares.toNumber();
                      const unrealizedPL = (currentPrice - entryPrice) * shares;
                      const unrealizedReturn = (currentPrice - entryPrice) / entryPrice;

                      return (
                        <div key={position.id} className="border rounded-lg p-4">
                          <div className="grid gap-4 md:grid-cols-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Shares</div>
                              <div className="text-lg font-bold">
                                {shares.toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Entry Price</div>
                              <div className="text-lg font-bold">
                                {formatCurrency(entryPrice)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatDate(position.entryDate)}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Market Value</div>
                              <div className="text-lg font-bold">
                                {formatCurrency(currentPrice * shares)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Cost: {formatCurrency(entryPrice * shares)}
                              </div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Unrealized P/L</div>
                              <div
                                className={`text-lg font-bold ${
                                  unrealizedPL >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatCurrency(unrealizedPL)}
                              </div>
                              <div
                                className={`text-xs ${
                                  unrealizedReturn >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatPercent(unrealizedReturn)}
                              </div>
                            </div>
                          </div>
                          {position.notes && (
                            <div className="text-sm text-muted-foreground mt-3 pt-3 border-t">
                              {position.notes}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No positions taken in this deal yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Deal Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  {version.dealNotes ? (
                    <p className="whitespace-pre-wrap">{version.dealNotes}</p>
                  ) : (
                    <p className="text-muted-foreground">No notes added yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {version.investableNotes && (
              <Card>
                <CardHeader>
                  <CardTitle>Investability Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose max-w-none">
                    <p className="whitespace-pre-wrap">{version.investableNotes}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {version.goShopEndDate && (
              <Card>
                <CardHeader>
                  <CardTitle>Go-Shop Period</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    <span className="font-medium">Ends: </span>
                    <span>{formatDate(version.goShopEndDate)}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Change History</CardTitle>
                <CardDescription>
                  {auditLogs.length > 0
                    ? `${auditLogs.length} recent change(s)`
                    : "No changes recorded"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {auditLogs.length > 0 ? (
                  <div className="space-y-4">
                    {auditLogs.map((log: any) => {
                      const changedFields = log.changedFields
                        ? JSON.parse(log.changedFields)
                        : [];
                      const oldValues = log.oldValues ? JSON.parse(log.oldValues) : {};
                      const newValues = log.newValues ? JSON.parse(log.newValues) : {};

                      return (
                        <div key={log.id} className="border rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    log.action === "create"
                                      ? "bg-green-100 text-green-700"
                                      : log.action === "update"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {log.action.toUpperCase()}
                                </span>
                                <span className="text-sm font-medium capitalize">
                                  {log.entityType}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(log.createdAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>

                              {log.createdBy && (
                                <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                                  <User className="h-3 w-3" />
                                  <span>
                                    {log.createdBy.fullName || log.createdBy.username}
                                  </span>
                                </div>
                              )}

                              {log.action === "update" && changedFields.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  <div className="text-xs font-medium text-muted-foreground">
                                    Changed fields:
                                  </div>
                                  {changedFields.map((field: string) => (
                                    <div
                                      key={field}
                                      className="text-sm bg-gray-50 rounded p-2"
                                    >
                                      <span className="font-medium">{field}</span>
                                      <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
                                        <div>
                                          <span className="text-muted-foreground">From: </span>
                                          <span className="font-mono">
                                            {oldValues[field] === null
                                              ? "null"
                                              : oldValues[field] instanceof Date
                                              ? formatDate(oldValues[field])
                                              : typeof oldValues[field] === "number"
                                              ? oldValues[field].toString()
                                              : oldValues[field]?.toString() || ""}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground">To: </span>
                                          <span className="font-mono">
                                            {newValues[field] === null
                                              ? "null"
                                              : newValues[field] instanceof Date
                                              ? formatDate(newValues[field])
                                              : typeof newValues[field] === "number"
                                              ? newValues[field].toString()
                                              : newValues[field]?.toString() || ""}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {log.action === "create" && newValues && (
                                <div className="text-xs text-muted-foreground mt-2">
                                  Created new {log.entityType}
                                  {newValues.cvrName && `: ${newValues.cvrName}`}
                                </div>
                              )}

                              {log.action === "delete" && oldValues && (
                                <div className="text-xs text-muted-foreground mt-2">
                                  Deleted {log.entityType}
                                  {oldValues.cvrName && `: ${oldValues.cvrName}`}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No audit logs recorded yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
