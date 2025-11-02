import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";

async function createDeal(formData: FormData) {
  "use server";

  // Extract form data
  const ticker = formData.get("ticker") as string;
  const acquirorName = formData.get("acquirorName") as string;
  const description = formData.get("description") as string;

  // Version data
  const announcedDate = formData.get("announcedDate") as string;
  const expectedCloseDate = formData.get("expectedCloseDate") as string;
  const outsideDate = formData.get("outsideDate") as string;
  const category = formData.get("category") as string;

  const cashPerShare = formData.get("cashPerShare") as string;
  const stockRatio = formData.get("stockRatio") as string;
  const dividendsOther = formData.get("dividendsOther") as string;

  const voteRisk = formData.get("voteRisk") as string;
  const financeRisk = formData.get("financeRisk") as string;
  const legalRisk = formData.get("legalRisk") as string;

  const dealNotes = formData.get("dealNotes") as string;
  const investableNotes = formData.get("investableNotes") as string;
  const isInvestable = formData.get("isInvestable") === "true";

  // Create deal with initial version
  const deal = await prisma.deal.create({
    data: {
      ticker: ticker.toUpperCase(),
      acquirorName,
      description: description || null,
      status: "active",
      versions: {
        create: {
          versionNumber: 1,
          isCurrentVersion: true,
          announcedDate: announcedDate ? new Date(announcedDate) : null,
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
          outsideDate: outsideDate ? new Date(outsideDate) : null,
          category: category || null,
          cashPerShare: cashPerShare ? parseFloat(cashPerShare) : null,
          stockRatio: stockRatio ? parseFloat(stockRatio) : null,
          dividendsOther: dividendsOther ? parseFloat(dividendsOther) : null,
          voteRisk: voteRisk || null,
          financeRisk: financeRisk || null,
          legalRisk: legalRisk || null,
          dealNotes: dealNotes || null,
          investableNotes: investableNotes || null,
          isInvestable,
        },
      },
    },
  });

  redirect(`/deals/${deal.id}`);
}

export default function NewDealPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/deals">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Dashboard
              </Button>
            </Link>
            <h1 className="text-xl font-bold">New Deal</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-4xl">
        <Card className="bg-white p-6">
          <form action={createDeal} className="space-y-6">
            {/* Basic Information */}
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Basic Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ticker">
                    Target Ticker <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="ticker"
                    name="ticker"
                    placeholder="AAPL"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="acquirorName">
                    Acquiror Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="acquirorName"
                    name="acquirorName"
                    placeholder="Company Name"
                    required
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Brief description of the deal..."
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>

            {/* Key Dates */}
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Key Dates
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="announcedDate">Announced Date</Label>
                  <Input
                    id="announcedDate"
                    name="announcedDate"
                    type="date"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="expectedCloseDate">Expected Close Date</Label>
                  <Input
                    id="expectedCloseDate"
                    name="expectedCloseDate"
                    type="date"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="outsideDate">Outside Date</Label>
                  <Input
                    id="outsideDate"
                    name="outsideDate"
                    type="date"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Deal Terms */}
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Deal Terms
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category">Category</Label>
                  <select
                    id="category"
                    name="category"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Select category...</option>
                    <option value="cash">Cash</option>
                    <option value="stock">Stock</option>
                    <option value="mixed">Mixed</option>
                    <option value="cash_or_stock">Cash or Stock</option>
                    <option value="potential">Potential</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cashPerShare">Cash Per Share ($)</Label>
                  <Input
                    id="cashPerShare"
                    name="cashPerShare"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="stockRatio">Stock Exchange Ratio</Label>
                  <Input
                    id="stockRatio"
                    name="stockRatio"
                    type="number"
                    step="0.0001"
                    placeholder="0.0000"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="dividendsOther">Dividends/Other ($)</Label>
                  <Input
                    id="dividendsOther"
                    name="dividendsOther"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Risk Assessment */}
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Risk Assessment
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="voteRisk">Vote Risk</Label>
                  <select
                    id="voteRisk"
                    name="voteRisk"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Select...</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="financeRisk">Finance Risk</Label>
                  <select
                    id="financeRisk"
                    name="financeRisk"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Select...</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="legalRisk">Legal Risk</Label>
                  <select
                    id="legalRisk"
                    name="legalRisk"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Select...</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Investability & Notes */}
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Investability & Notes
              </h2>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="isInvestable">Investable?</Label>
                  <select
                    id="isInvestable"
                    name="isInvestable"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="investableNotes">Investable Notes</Label>
                  <Textarea
                    id="investableNotes"
                    name="investableNotes"
                    placeholder="Notes about investability..."
                    className="mt-1"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="dealNotes">Deal Notes</Label>
                  <Textarea
                    id="dealNotes"
                    name="dealNotes"
                    placeholder="General notes about the deal..."
                    className="mt-1"
                    rows={4}
                  />
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Link href="/deals">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Create Deal</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
