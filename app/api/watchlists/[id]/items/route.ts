import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

/** Verify the watchlist exists and belongs to the current user */
async function verifyOwnership(listId: string, userId: string) {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list || list.userId !== userId) return null;
  return list;
}

/** POST /api/watchlists/[id]/items — Add an item to the watchlist */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const list = await verifyOwnership(id, user.id);
  if (!list) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const ticker = (body.ticker || "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  const instrumentType = body.instrumentType || "stock";
  if (!["stock", "index", "future"].includes(instrumentType)) {
    return NextResponse.json(
      { error: "instrumentType must be stock, index, or future" },
      { status: 400 }
    );
  }

  // Check for duplicate
  const existing = await prisma.watchlistItem.findUnique({
    where: { listId_ticker: { listId: id, ticker } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `${ticker} is already in this watchlist` },
      { status: 409 }
    );
  }

  // Determine next sort order
  const maxSort = await prisma.watchlistItem.aggregate({
    where: { listId: id },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const item = await prisma.watchlistItem.create({
    data: {
      listId: id,
      ticker,
      instrumentType,
      displayName: body.displayName || null,
      exchange: body.exchange || null,
      sortOrder: nextSort,
    },
  });

  return NextResponse.json(
    {
      id: item.id,
      ticker: item.ticker,
      instrumentType: item.instrumentType,
      displayName: item.displayName,
      exchange: item.exchange,
      sortOrder: item.sortOrder,
    },
    { status: 201 }
  );
}

/** DELETE /api/watchlists/[id]/items — Remove an item (by ticker query param or itemId) */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const list = await verifyOwnership(id, user.id);
  if (!list) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase();
  const itemId = url.searchParams.get("itemId");

  if (!ticker && !itemId) {
    return NextResponse.json(
      { error: "Either ticker or itemId query param is required" },
      { status: 400 }
    );
  }

  if (ticker) {
    const item = await prisma.watchlistItem.findUnique({
      where: { listId_ticker: { listId: id, ticker } },
    });
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    await prisma.watchlistItem.delete({ where: { id: item.id } });
  } else if (itemId) {
    const item = await prisma.watchlistItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.listId !== id) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    await prisma.watchlistItem.delete({ where: { id: itemId } });
  }

  return NextResponse.json({ ok: true });
}

/** PUT /api/watchlists/[id]/items — Reorder items */
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;
  const list = await verifyOwnership(id, user.id);
  if (!list) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const orderedIds: string[] = body.itemIds;
  if (!Array.isArray(orderedIds)) {
    return NextResponse.json(
      { error: "itemIds array is required" },
      { status: 400 }
    );
  }

  // Batch update sort orders
  await prisma.$transaction(
    orderedIds.map((itemId, index) =>
      prisma.watchlistItem.update({
        where: { id: itemId },
        data: { sortOrder: index },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
