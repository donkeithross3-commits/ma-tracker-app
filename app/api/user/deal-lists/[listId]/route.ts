import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { UserDealListDTO } from "../route";

interface RouteParams {
  params: Promise<{ listId: string }>;
}

/**
 * GET /api/user/deal-lists/[listId]
 * Get a specific deal list with its items
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const list = await prisma.userDealList.findFirst({
      where: {
        id: listId,
        userId: session.user.id,
      },
      include: {
        items: {
          include: {
            spread: {
              include: {
                scannerDeal: true,
                curator: { select: { alias: true } },
              },
            },
          },
          orderBy: { addedAt: "desc" },
        },
      },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    return NextResponse.json({
      list: {
        id: list.id,
        name: list.name,
        isDefault: list.isDefault,
        createdAt: list.createdAt.toISOString(),
        updatedAt: list.updatedAt.toISOString(),
      },
      items: list.items.map((item) => ({
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
      })),
    });
  } catch (error) {
    console.error("Error fetching deal list:", error);
    return NextResponse.json(
      { error: "Failed to fetch deal list" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/deal-lists/[listId]
 * Update a deal list (rename)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "List name is required" },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await prisma.userDealList.findFirst({
      where: {
        id: listId,
        userId: session.user.id,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const list = await prisma.userDealList.update({
      where: { id: listId },
      data: { name: name.trim() },
      include: {
        _count: { select: { items: true } },
      },
    });

    const listDTO: UserDealListDTO = {
      id: list.id,
      name: list.name,
      isDefault: list.isDefault,
      itemCount: list._count.items,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    };

    return NextResponse.json({ list: listDTO });
  } catch (error) {
    console.error("Error updating deal list:", error);
    return NextResponse.json(
      { error: "Failed to update deal list" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/deal-lists/[listId]
 * Delete a deal list (cannot delete default list)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    // Verify ownership and check if default
    const existing = await prisma.userDealList.findFirst({
      where: {
        id: listId,
        userId: session.user.id,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot delete the default list" },
        { status: 400 }
      );
    }

    await prisma.userDealList.delete({
      where: { id: listId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting deal list:", error);
    return NextResponse.json(
      { error: "Failed to delete deal list" },
      { status: 500 }
    );
  }
}
