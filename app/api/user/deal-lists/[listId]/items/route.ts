import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

interface RouteParams {
  params: Promise<{ listId: string }>;
}

/**
 * POST /api/user/deal-lists/[listId]/items
 * Add a deal to a list
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const body = await request.json();
    const { dealId, notes } = body;

    if (!dealId) {
      return NextResponse.json(
        { error: "dealId is required" },
        { status: 400 }
      );
    }

    // Verify list ownership
    const list = await prisma.userDealList.findFirst({
      where: {
        id: listId,
        userId: session.user.id,
      },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    // Verify deal exists
    const deal = await prisma.scannerDeal.findUnique({
      where: { id: dealId },
    });

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Check if already in list
    const existing = await prisma.userDealListItem.findUnique({
      where: {
        listId_dealId: {
          listId,
          dealId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Deal is already in this list" },
        { status: 409 }
      );
    }

    const item = await prisma.userDealListItem.create({
      data: {
        listId,
        dealId,
        notes: notes || null,
      },
      include: {
        deal: {
          include: {
            addedBy: { select: { alias: true } },
          },
        },
      },
    });

    return NextResponse.json(
      {
        item: {
          id: item.id,
          dealId: item.dealId,
          ticker: item.deal.ticker,
          targetName: item.deal.targetName,
          expectedClosePrice: item.deal.expectedClosePrice.toNumber(),
          expectedCloseDate: item.deal.expectedCloseDate.toISOString().split("T")[0],
          addedByAlias: item.deal.addedBy?.alias || null,
          notes: item.notes,
          addedAt: item.addedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error adding deal to list:", error);
    return NextResponse.json(
      { error: "Failed to add deal to list" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/deal-lists/[listId]/items
 * Remove a deal from a list
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const body = await request.json();
    const { dealId } = body;

    if (!dealId) {
      return NextResponse.json(
        { error: "dealId is required" },
        { status: 400 }
      );
    }

    // Verify list ownership
    const list = await prisma.userDealList.findFirst({
      where: {
        id: listId,
        userId: session.user.id,
      },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    await prisma.userDealListItem.delete({
      where: {
        listId_dealId: {
          listId,
          dealId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Item might not exist, that's ok
    return NextResponse.json({ success: true });
  }
}
