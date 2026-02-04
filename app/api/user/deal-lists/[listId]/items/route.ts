import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

interface RouteParams {
  params: Promise<{ listId: string }>;
}

/**
 * POST /api/user/deal-lists/[listId]/items
 * Add a spread to a list
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const body = await request.json();
    const { spreadId, notes } = body;

    if (!spreadId) {
      return NextResponse.json(
        { error: "spreadId is required" },
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

    // Verify spread exists
    const spread = await prisma.watchedSpread.findUnique({
      where: { id: spreadId },
      include: {
        scannerDeal: true,
        curator: { select: { alias: true } },
      },
    });

    if (!spread) {
      return NextResponse.json({ error: "Spread not found" }, { status: 404 });
    }

    // Check if already in list
    const existing = await prisma.userDealListItem.findUnique({
      where: {
        listId_spreadId: {
          listId,
          spreadId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Spread is already in this list" },
        { status: 409 }
      );
    }

    const item = await prisma.userDealListItem.create({
      data: {
        listId,
        spreadId,
        notes: notes || null,
      },
      include: {
        spread: {
          include: {
            scannerDeal: true,
            curator: { select: { alias: true } },
          },
        },
      },
    });

    return NextResponse.json(
      {
        item: {
          id: item.id,
          spreadId: item.spreadId,
          ticker: item.spread.scannerDeal.ticker,
          strategyType: item.spread.strategyType,
          expiration: item.spread.expiration.toISOString().split("T")[0],
          entryPremium: item.spread.entryPremium.toNumber(),
          maxProfit: item.spread.maxProfit.toNumber(),
          returnOnRisk: item.spread.returnOnRisk.toNumber(),
          status: item.spread.status,
          curatorAlias: item.spread.curator?.alias || null,
          notes: item.notes,
          addedAt: item.addedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error adding spread to list:", error);
    return NextResponse.json(
      { error: "Failed to add spread to list" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/deal-lists/[listId]/items
 * Remove a spread from a list
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const body = await request.json();
    const { spreadId } = body;

    if (!spreadId) {
      return NextResponse.json(
        { error: "spreadId is required" },
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
        listId_spreadId: {
          listId,
          spreadId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Item might not exist, that's ok
    return NextResponse.json({ success: true });
  }
}
