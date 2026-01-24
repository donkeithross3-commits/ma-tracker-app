import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface UpdateSpreadRequest {
  status?: "active" | "inactive" | "expired";
  notes?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // In Next.js 15+, params is a Promise that needs to be awaited
    const { id } = await params;
    const body: UpdateSpreadRequest = await request.json();

    console.log("PATCH watched-spread:", { id, body });

    if (!id) {
      return NextResponse.json(
        { error: "Spread ID is required" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: any = {};
    if (body.status !== undefined) {
      updateData.status = body.status;
    }
    if (body.notes !== undefined) {
      updateData.notes = body.notes;
    }

    // Update spread
    const spread = await prisma.watchedSpread.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      spread: {
        id: spread.id,
        status: spread.status,
        notes: spread.notes,
      },
    });
  } catch (error) {
    console.error("Error updating spread:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update spread",
      },
      { status: 500 }
    );
  }
}

