import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";

async function getDeal(id: string) {
  const deal = await prisma.deal.findUnique({
    where: { id },
    select: {
      id: true,
      ticker: true,
    },
  });

  if (!deal) {
    notFound();
  }

  return deal;
}

async function createPosition(dealId: string, formData: FormData) {
  "use server";

  const entryDate = formData.get("entryDate") as string;
  const shares = formData.get("shares") as string;
  const entryPrice = formData.get("entryPrice") as string;
  const entryDealPrice = formData.get("entryDealPrice") as string;
  const entryExpectedClose = formData.get("entryExpectedClose") as string;
  const entryNotes = formData.get("entryNotes") as string;

  await prisma.portfolioPosition.create({
    data: {
      dealId,
      entryDate: new Date(entryDate),
      shares: parseInt(shares),
      entryPrice: parseFloat(entryPrice),
      entryDealPrice: entryDealPrice ? parseFloat(entryDealPrice) : null,
      entryExpectedClose: entryExpectedClose ? new Date(entryExpectedClose) : null,
      status: "open",
      entryNotes: entryNotes || null,
    },
  });

  redirect(`/deals/${dealId}`);
}

export default async function NewPositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  const createPositionWithId = createPosition.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/deals/${id}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Deal
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Open Position - {deal.ticker}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-2xl">
        <Card className="bg-white p-6">
          <form action={createPositionWithId} className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b">
                Position Details
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="entryDate">
                      Entry Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="entryDate"
                      name="entryDate"
                      type="date"
                      required
                      className="mt-1"
                      defaultValue={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div>
                    <Label htmlFor="shares">
                      Shares <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="shares"
                      name="shares"
                      type="number"
                      step="1"
                      placeholder="1000"
                      required
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="entryPrice">
                      Entry Price ($) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="entryPrice"
                      name="entryPrice"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      required
                      className="mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Price per share at entry
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="entryDealPrice">Deal Price at Entry ($)</Label>
                    <Input
                      id="entryDealPrice"
                      name="entryDealPrice"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      For calculating entry spread
                    </p>
                  </div>
                </div>

                <div>
                  <Label htmlFor="entryExpectedClose">
                    Expected Close Date at Entry
                  </Label>
                  <Input
                    id="entryExpectedClose"
                    name="entryExpectedClose"
                    type="date"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    For calculating expected IRR at entry
                  </p>
                </div>

                <div>
                  <Label htmlFor="entryNotes">Entry Notes</Label>
                  <Textarea
                    id="entryNotes"
                    name="entryNotes"
                    placeholder="Rationale for entering this position..."
                    className="mt-1"
                    rows={4}
                  />
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-md">
              <p className="text-sm text-blue-900">
                <strong>Note:</strong> This will create a new open position. The entry deal price
                and expected close date will be memorialized to track how the deal evolves after entry.
              </p>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Link href={`/deals/${id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Open Position</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
