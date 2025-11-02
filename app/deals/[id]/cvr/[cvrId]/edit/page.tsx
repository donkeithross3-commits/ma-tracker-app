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
import { ArrowLeft, Trash2 } from "lucide-react";

async function getCVR(cvrId: string) {
  const cvr = await prisma.cVR.findUnique({
    where: { id: cvrId },
    include: {
      deal: {
        select: {
          id: true,
          ticker: true,
        },
      },
    },
  });

  if (!cvr) {
    notFound();
  }

  return cvr;
}

async function updateCVR(cvrId: string, dealId: string, formData: FormData) {
  "use server";

  const session = await auth();

  // Get old values for audit log
  const oldCVR = await prisma.cVR.findUnique({
    where: { id: cvrId },
  });

  if (!oldCVR) {
    throw new Error("CVR not found");
  }

  const cvrName = formData.get("cvrName") as string;
  const paymentAmount = formData.get("paymentAmount") as string;
  const probability = formData.get("probability") as string;
  const paymentDeadline = formData.get("paymentDeadline") as string;
  const paymentStatus = formData.get("paymentStatus") as string;
  const notes = formData.get("notes") as string;

  const newValues = {
    cvrName,
    paymentAmount: parseFloat(paymentAmount),
    probability: parseFloat(probability) / 100,
    paymentDeadline: paymentDeadline ? new Date(paymentDeadline) : null,
    paymentStatus,
    notes: notes || null,
  };

  await prisma.cVR.update({
    where: { id: cvrId },
    data: newValues,
  });

  // Log the update
  await createAuditLog({
    entityType: "cvr",
    entityId: cvrId,
    action: "update",
    oldValues: {
      cvrName: oldCVR.cvrName,
      paymentAmount: oldCVR.paymentAmount.toNumber(),
      probability: oldCVR.probability.toNumber(),
      paymentDeadline: oldCVR.paymentDeadline,
      paymentStatus: oldCVR.paymentStatus,
      notes: oldCVR.notes,
    },
    newValues,
    userId: session?.user?.id,
  });

  redirect(`/deals/${dealId}`);
}

async function deleteCVR(cvrId: string, dealId: string) {
  "use server";

  const session = await auth();

  // Get values for audit log before deletion
  const cvr = await prisma.cVR.findUnique({
    where: { id: cvrId },
  });

  if (!cvr) {
    throw new Error("CVR not found");
  }

  await prisma.cVR.delete({
    where: { id: cvrId },
  });

  // Log the deletion
  await createAuditLog({
    entityType: "cvr",
    entityId: cvrId,
    action: "delete",
    oldValues: {
      cvrName: cvr.cvrName,
      paymentAmount: cvr.paymentAmount.toNumber(),
      probability: cvr.probability.toNumber(),
      paymentDeadline: cvr.paymentDeadline,
      paymentStatus: cvr.paymentStatus,
      notes: cvr.notes,
    },
    userId: session?.user?.id,
  });

  redirect(`/deals/${dealId}`);
}

export default async function EditCVRPage({
  params,
}: {
  params: Promise<{ id: string; cvrId: string }>;
}) {
  const { id: dealId, cvrId } = await params;
  const cvr = await getCVR(cvrId);
  const updateCVRWithIds = updateCVR.bind(null, cvrId, dealId);
  const deleteCVRWithIds = deleteCVR.bind(null, cvrId, dealId);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/deals/${dealId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Deal
              </Button>
            </Link>
            <h1 className="text-xl font-bold">
              Edit CVR - {cvr.deal.ticker}
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-2xl">
        <Card className="bg-white p-6">
          <form action={updateCVRWithIds} className="space-y-6">
            <div>
              <Label htmlFor="cvrName">
                CVR Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cvrName"
                name="cvrName"
                defaultValue={cvr.cvrName || ""}
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
                  defaultValue={cvr.paymentAmount.toNumber()}
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
                  defaultValue={(cvr.probability.toNumber() * 100).toFixed(0)}
                  placeholder="50"
                  required
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter as percentage (0-100)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="paymentDeadline">Payment Deadline</Label>
                <Input
                  id="paymentDeadline"
                  name="paymentDeadline"
                  type="date"
                  defaultValue={
                    cvr.paymentDeadline
                      ? new Date(cvr.paymentDeadline).toISOString().split("T")[0]
                      : ""
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="paymentStatus">
                  Payment Status <span className="text-red-500">*</span>
                </Label>
                <select
                  id="paymentStatus"
                  name="paymentStatus"
                  defaultValue={cvr.paymentStatus}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 mt-1"
                  required
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={cvr.notes || ""}
                placeholder="Notes about this CVR..."
                className="mt-1"
                rows={4}
              />
            </div>

            {/* Form Actions */}
            <div className="flex justify-between items-center pt-4 border-t">
              <form action={deleteCVRWithIds}>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    if (
                      !confirm(
                        "Are you sure you want to delete this CVR? This action cannot be undone."
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete CVR
                </Button>
              </form>

              <div className="flex gap-3">
                <Link href={`/deals/${dealId}`}>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Save Changes</Button>
              </div>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
