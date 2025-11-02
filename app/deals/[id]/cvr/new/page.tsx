import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { createAuditLog } from "@/lib/audit";
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

async function createCVR(dealId: string, formData: FormData) {
  "use server";

  const session = await auth();
  const cvrName = formData.get("cvrName") as string;
  const paymentAmount = formData.get("paymentAmount") as string;
  const probability = formData.get("probability") as string;
  const paymentDeadline = formData.get("paymentDeadline") as string;
  const notes = formData.get("notes") as string;

  const cvrData = {
    dealId,
    cvrName,
    paymentAmount: parseFloat(paymentAmount),
    probability: parseFloat(probability) / 100, // Convert percentage to decimal
    paymentDeadline: paymentDeadline ? new Date(paymentDeadline) : null,
    paymentStatus: "pending",
    notes: notes || null,
  };

  const cvr = await prisma.cvr.create({
    data: cvrData,
  });

  // Log the creation
  await createAuditLog({
    entityType: "cvr",
    entityId: cvr.id,
    action: "create",
    newValues: cvrData,
    userId: session?.user?.id,
  });

  redirect(`/deals/${dealId}`);
}

export default async function NewCVRPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  const createCVRWithId = createCVR.bind(null, id);

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
            <h1 className="text-xl font-bold">Add CVR - {deal.ticker}</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-2xl">
        <Card className="bg-white p-6">
          <form action={createCVRWithId} className="space-y-6">
            <div>
              <Label htmlFor="cvrName">
                CVR Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cvrName"
                name="cvrName"
                placeholder="e.g., Milestone payment upon FDA approval"
                required
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="paymentAmount">
                  Payment Amount ($) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="paymentAmount"
                  name="paymentAmount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="probability">
                  Probability (%) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="probability"
                  name="probability"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  placeholder="50"
                  required
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">Enter as percentage (0-100)</p>
              </div>
            </div>

            <div>
              <Label htmlFor="paymentDeadline">Payment Deadline</Label>
              <Input
                id="paymentDeadline"
                name="paymentDeadline"
                type="date"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="Notes about this CVR..."
                className="mt-1"
                rows={4}
              />
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Link href={`/deals/${id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Add CVR</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
