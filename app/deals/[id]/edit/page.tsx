import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";

async function getDealWithPrices(id: string) {
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
    },
  });

  if (!deal || deal.versions.length === 0) {
    notFound();
  }

  return { deal, version: deal.versions[0], latestPrice: deal.prices[0] || null };
}

async function updateDeal(dealId: string, formData: FormData) {
  "use server";

  // Extract form data
  const ticker = formData.get("ticker") as string;
  const targetName = formData.get("targetName") as string;
  const acquirorName = formData.get("acquirorName") as string;
  const acquirorTicker = formData.get("acquirorTicker") as string;
  const status = formData.get("status") as string;

  // Version data
  const announcedDate = formData.get("announcedDate") as string;
  const expectedCloseDate = formData.get("expectedCloseDate") as string;
  const outsideDate = formData.get("outsideDate") as string;
  const category = formData.get("category") as string;

  const cashPerShare = formData.get("cashPerShare") as string;
  const stockRatio = formData.get("stockRatio") as string;
  const stressTestDiscount = formData.get("stressTestDiscount") as string;
  const dividendsOther = formData.get("dividendsOther") as string;

  const voteRisk = formData.get("voteRisk") as string;
  const financeRisk = formData.get("financeRisk") as string;
  const legalRisk = formData.get("legalRisk") as string;

  const dealNotes = formData.get("dealNotes") as string;
  const investableNotes = formData.get("investableNotes") as string;
  const isInvestable = formData.get("isInvestable") === "true";
  const goShopEndDate = formData.get("goShopEndDate") as string;

  // Get current version
  const currentDeal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      versions: {
        where: { isCurrentVersion: true },
        take: 1,
      },
    },
  });

  if (!currentDeal || currentDeal.versions.length === 0) {
    throw new Error("Deal not found");
  }

  const currentVersion = currentDeal.versions[0];

  // Check if version fields have changed
  const versionChanged =
    announcedDate !== (currentVersion.announcedDate?.toISOString().split("T")[0] || "") ||
    expectedCloseDate !== (currentVersion.expectedCloseDate?.toISOString().split("T")[0] || "") ||
    outsideDate !== (currentVersion.outsideDate?.toISOString().split("T")[0] || "") ||
    goShopEndDate !== (currentVersion.goShopEndDate?.toISOString().split("T")[0] || "") ||
    category !== (currentVersion.category || "") ||
    parseFloat(cashPerShare || "0") !== (currentVersion.cashPerShare?.toNumber() || 0) ||
    parseFloat(stockRatio || "0") !== (currentVersion.stockRatio?.toNumber() || 0) ||
    parseFloat(stressTestDiscount || "0") !== (currentVersion.stressTestDiscount?.toNumber() || 0) ||
    parseFloat(dividendsOther || "0") !== (currentVersion.dividendsOther?.toNumber() || 0) ||
    voteRisk !== (currentVersion.voteRisk || "") ||
    financeRisk !== (currentVersion.financeRisk || "") ||
    legalRisk !== (currentVersion.legalRisk || "") ||
    dealNotes !== (currentVersion.dealNotes || "") ||
    investableNotes !== (currentVersion.investableNotes || "") ||
    isInvestable !== currentVersion.isInvestable;

  if (versionChanged) {
    // Mark current version as not current
    await prisma.dealVersion.update({
      where: { id: currentVersion.id },
      data: { isCurrentVersion: false },
    });

    // Create new version
    await prisma.dealVersion.create({
      data: {
        dealId,
        versionNumber: currentVersion.versionNumber + 1,
        isCurrentVersion: true,
        announcedDate: announcedDate ? new Date(announcedDate) : null,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        outsideDate: outsideDate ? new Date(outsideDate) : null,
        goShopEndDate: goShopEndDate ? new Date(goShopEndDate) : null,
        category: category || null,
        cashPerShare: cashPerShare ? parseFloat(cashPerShare) : null,
        stockRatio: stockRatio ? parseFloat(stockRatio) : null,
        stressTestDiscount: stressTestDiscount ? parseFloat(stressTestDiscount) : null,
        dividendsOther: dividendsOther ? parseFloat(dividendsOther) : null,
        voteRisk: voteRisk || null,
        financeRisk: financeRisk || null,
        legalRisk: legalRisk || null,
        dealNotes: dealNotes || null,
        investableNotes: investableNotes || null,
        isInvestable,
      },
    });
  }

  // Update deal basic info (always updates, no versioning)
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      ticker: ticker.toUpperCase(),
      targetName: targetName || null,
      acquirorTicker: acquirorTicker || null,
      acquirorName,
      status: status as any,
    },
  });

  redirect(`/deals/${dealId}`);
}

function formatDateForInput(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { deal, version, latestPrice } = await getDealWithPrices(id);

  const updateDealWithId = updateDeal.bind(null, id);

  // Calculate some values for display
  const targetPrice = latestPrice?.targetPrice.toNumber() || 0;
  const acquirorPrice = latestPrice?.acquirorPrice?.toNumber() || 0;
  const cashComponent = version.cashPerShare?.toNumber() || 0;
  const stockComponent =
    version.stockRatio && acquirorPrice
      ? version.stockRatio.toNumber() * acquirorPrice
      : 0;
  const dividends = version.dividendsOther?.toNumber() || 0;
  const totalDealPrice = cashComponent + stockComponent + dividends;

  const dealSpread = totalDealPrice > 0 && targetPrice > 0
    ? ((totalDealPrice - targetPrice) / targetPrice)
    : 0;

  const daysToClose = version.expectedCloseDate
    ? Math.ceil(
        (new Date(version.expectedCloseDate).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  const monthsToClose = daysToClose ? daysToClose / 30 : null;

  const expectedIRR =
    daysToClose && daysToClose > 0 && dealSpread > 0
      ? Math.pow(1 + dealSpread, 365 / daysToClose) - 1
      : null;

  // Row component for consistent styling
  const FormRow = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
    <div className={`grid grid-cols-[200px_1fr] gap-4 py-2 border-b border-gray-200 ${className}`}>
      <div className="font-medium text-sm flex items-center">{label}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );

  const ReadOnlyRow = ({ label, value, className = "" }: { label: string; value: string | number; className?: string }) => (
    <div className={`grid grid-cols-[200px_1fr] gap-4 py-2 border-b border-gray-200 ${className}`}>
      <div className="font-medium text-sm flex items-center">{label}</div>
      <div className="text-sm flex items-center bg-gray-50 px-3 py-2 rounded">{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/deals/${id}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Edit Deal: {deal.ticker}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-5xl">
        <Card className="bg-white p-6">
          <form action={updateDealWithId} className="space-y-6">
            {/* Target & Acquiror */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <FormRow label="Target">
                <Input
                  name="ticker"
                  defaultValue={deal.ticker}
                  required
                  className="max-w-[200px]"
                  placeholder="Ticker"
                />
                <Input
                  name="targetName"
                  defaultValue={deal.targetName || ""}
                  placeholder="Target Name"
                  className="flex-1"
                />
              </FormRow>
              <ReadOnlyRow label="Target current price" value={targetPrice > 0 ? `$${targetPrice.toFixed(2)}` : "-"} />
              <FormRow label="Acquiror">
                <Input
                  name="acquirorTicker"
                  defaultValue={deal.acquirorTicker || ""}
                  placeholder="Ticker"
                  className="max-w-[200px]"
                />
                <Input
                  name="acquirorName"
                  defaultValue={deal.acquirorName || ""}
                  required
                  placeholder="Acquiror Name"
                  className="flex-1"
                />
              </FormRow>
              <ReadOnlyRow label="Acquiror current price" value={acquirorPrice > 0 ? `$${acquirorPrice.toFixed(2)}` : "-"} />
            </div>

            {/* Deal Terms */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 font-semibold border-b">Deal Terms</div>
              <FormRow label="Category">
                <select
                  name="category"
                  defaultValue={version.category || ""}
                  className="flex h-10 w-full max-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  <option value="all-cash">All-cash</option>
                  <option value="cash">Cash</option>
                  <option value="stock">Stock</option>
                  <option value="mixed">Mixed</option>
                  <option value="cash_or_stock">Cash or Stock</option>
                  <option value="cash_stock_cvr">Cash + Stock + CVR</option>
                </select>
              </FormRow>
              <FormRow label="Cash per share">
                <Input
                  name="cashPerShare"
                  type="number"
                  step="0.01"
                  defaultValue={version.cashPerShare?.toNumber() || ""}
                  placeholder="0.00"
                  className="max-w-[150px]"
                />
                {totalDealPrice > 0 && (
                  <span className="text-sm text-gray-600">
                    {((cashComponent / totalDealPrice) * 100).toFixed(2)}%
                  </span>
                )}
              </FormRow>
              <FormRow label="Stock ratio">
                <Input
                  name="stockRatio"
                  type="number"
                  step="0.0001"
                  defaultValue={version.stockRatio?.toNumber() || ""}
                  placeholder="0.0000"
                  className="max-w-[150px]"
                />
              </FormRow>
              <FormRow label="Stress test discount">
                <Input
                  name="stressTestDiscount"
                  type="number"
                  step="0.01"
                  defaultValue={version.stressTestDiscount?.toNumber() || ""}
                  placeholder="0.00"
                  className="max-w-[150px]"
                />
              </FormRow>
              <FormRow label="Stock per share">
                <span className="text-sm bg-gray-50 px-3 py-2 rounded">
                  {stockComponent > 0 ? `$${stockComponent.toFixed(2)}` : "$0.00"}
                </span>
                {totalDealPrice > 0 && (
                  <span className="text-sm text-gray-600">
                    {((stockComponent / totalDealPrice) * 100).toFixed(2)}%
                  </span>
                )}
              </FormRow>
              <FormRow label="Dividends / Other">
                <Input
                  name="dividendsOther"
                  type="number"
                  step="0.01"
                  defaultValue={version.dividendsOther?.toNumber() || ""}
                  placeholder="0.00"
                  className="max-w-[150px]"
                />
                {totalDealPrice > 0 && dividends > 0 && (
                  <span className="text-sm text-gray-600">
                    {((dividends / totalDealPrice) * 100).toFixed(2)}%
                  </span>
                )}
              </FormRow>
              <ReadOnlyRow
                label="Total price per share"
                value={totalDealPrice > 0 ? `$${totalDealPrice.toFixed(2)}` : "-"}
                className="bg-blue-50"
              />
            </div>

            {/* Spread Calculations */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <ReadOnlyRow
                label="Target current price"
                value={targetPrice > 0 ? `$${targetPrice.toFixed(2)}` : "-"}
              />
              <ReadOnlyRow
                label="Deal spread"
                value={dealSpread > 0 ? `${(dealSpread * 100).toFixed(2)}%` : "-"}
              />
              <ReadOnlyRow
                label="Deal Close Time (Months)"
                value={monthsToClose ? monthsToClose.toFixed(2) : "-"}
              />
              <ReadOnlyRow
                label="Expected IRR"
                value={expectedIRR ? `${(expectedIRR * 100).toFixed(2)}%` : "-"}
              />
            </div>

            {/* Dates */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <ReadOnlyRow label="Today's Date:" value={new Date().toLocaleDateString()} />
              <FormRow label="Announce Date:">
                <Input
                  name="announcedDate"
                  type="date"
                  defaultValue={formatDateForInput(version.announcedDate)}
                  className="max-w-[200px]"
                />
              </FormRow>
              <FormRow label="Expected close date:">
                <Input
                  name="expectedCloseDate"
                  type="date"
                  defaultValue={formatDateForInput(version.expectedCloseDate)}
                  className="max-w-[200px]"
                />
              </FormRow>
              <FormRow label="Outside Date">
                <Input
                  name="outsideDate"
                  type="date"
                  defaultValue={formatDateForInput(version.outsideDate)}
                  className="max-w-[200px]"
                />
              </FormRow>
              <FormRow label="Go-Shop End Date:">
                <Input
                  name="goShopEndDate"
                  type="date"
                  defaultValue={formatDateForInput(version.goShopEndDate)}
                  className="max-w-[200px]"
                />
              </FormRow>
            </div>

            {/* Risk Assessment */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 font-semibold border-b">Risk Assessment</div>
              <FormRow label="Shareholder Risk (Vote)">
                <select
                  name="voteRisk"
                  defaultValue={version.voteRisk || ""}
                  className="flex h-10 w-full max-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FormRow>
              <FormRow label="Financing Risk">
                <select
                  name="financeRisk"
                  defaultValue={version.financeRisk || ""}
                  className="flex h-10 w-full max-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FormRow>
              <FormRow label="Legal Risk">
                <select
                  name="legalRisk"
                  defaultValue={version.legalRisk || ""}
                  className="flex h-10 w-full max-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FormRow>
            </div>

            {/* Investability */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <FormRow label="Investable Deal?">
                <select
                  name="isInvestable"
                  defaultValue={version.isInvestable ? "true" : "false"}
                  className="flex h-10 w-full max-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </FormRow>
            </div>

            {/* Notes */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 font-semibold border-b">Notes</div>
              <div className="p-4 space-y-4">
                <div>
                  <Label htmlFor="investableNotes" className="text-sm font-medium mb-2 block">
                    Investable Notes
                  </Label>
                  <Textarea
                    id="investableNotes"
                    name="investableNotes"
                    defaultValue={version.investableNotes || ""}
                    placeholder="Notes about investability..."
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="dealNotes" className="text-sm font-medium mb-2 block">
                    Deal Notes / Key Risks
                  </Label>
                  <Textarea
                    id="dealNotes"
                    name="dealNotes"
                    defaultValue={version.dealNotes || ""}
                    placeholder="General notes about the deal, key risks, etc..."
                    rows={4}
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-0 border rounded-lg overflow-hidden">
              <FormRow label="Deal Status">
                <select
                  name="status"
                  defaultValue={deal.status}
                  className="flex h-10 w-full max-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="terminated">Terminated</option>
                </select>
              </FormRow>
            </div>

            {/* Version Info */}
            <div className="bg-blue-50 p-4 rounded-md text-sm text-blue-900">
              <strong>Version Control:</strong> Changes to deal terms will create version v
              {version.versionNumber + 1}. Basic information updates won't create a new version.
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Link href={`/deals/${id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
