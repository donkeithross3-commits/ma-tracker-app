import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";

async function getDeal(id: string) {
  const deal = await prisma.deal.findUnique({
    where: { id },
    select: {
      id: true,
      ticker: true,
      prices: {
        orderBy: { priceDate: "desc" },
        take: 1,
      },
    },
  });

  if (!deal) {
    notFound();
  }

  return deal;
}

async function updatePrice(dealId: string, formData: FormData) {
  "use server";

  const priceDate = formData.get("priceDate") as string;
  const targetPrice = formData.get("targetPrice") as string;
  const acquirorPrice = formData.get("acquirorPrice") as string;

  await prisma.dealPrice.create({
    data: {
      dealId,
      priceDate: new Date(priceDate),
      targetPrice: parseFloat(targetPrice),
      acquirorPrice: acquirorPrice ? parseFloat(acquirorPrice) : null,
      source: "manual",
    },
  });

  redirect(`/deals/${dealId}`);
}

export default async function NewPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  const updatePriceWithId = updatePrice.bind(null, id);

  const latestPrice = deal.prices[0] || null;

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
            <h1 className="text-xl font-bold">Update Price - {deal.ticker}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-2xl">
        <Card className="bg-white p-6">
          {latestPrice && (
            <div className="mb-6 p-4 bg-gray-50 rounded-md">
              <h3 className="text-sm font-semibold mb-2">Latest Prices</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Date:</span>{" "}
                  <span className="font-medium">
                    {new Date(latestPrice.priceDate).toLocaleDateString()}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Target:</span>{" "}
                  <span className="font-medium">
                    ${latestPrice.targetPrice.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Acquiror:</span>{" "}
                  <span className="font-medium">
                    {latestPrice.acquirorPrice
                      ? `$${latestPrice.acquirorPrice.toFixed(2)}`
                      : "N/A"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <form action={updatePriceWithId} className="space-y-6">
            <div>
              <Label htmlFor="priceDate">
                Price Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="priceDate"
                name="priceDate"
                type="date"
                required
                className="mt-1"
                defaultValue={new Date().toISOString().split("T")[0]}
              />
            </div>

            <div>
              <Label htmlFor="targetPrice">
                Target Price ($) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="targetPrice"
                name="targetPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                required
                className="mt-1"
                defaultValue={latestPrice?.targetPrice.toNumber() || ""}
              />
              <p className="text-xs text-gray-500 mt-1">
                Current trading price of {deal.ticker}
              </p>
            </div>

            <div>
              <Label htmlFor="acquirorPrice">Acquiror Price ($)</Label>
              <Input
                id="acquirorPrice"
                name="acquirorPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="mt-1"
                defaultValue={latestPrice?.acquirorPrice?.toNumber() || ""}
              />
              <p className="text-xs text-gray-500 mt-1">
                Required for stock deals to calculate deal value
              </p>
            </div>

            <div className="bg-blue-50 p-4 rounded-md">
              <p className="text-sm text-blue-900">
                <strong>Note:</strong> This will add a new price record. Historical prices
                are preserved for tracking price changes over time.
              </p>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Link href={`/deals/${id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Update Price</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
