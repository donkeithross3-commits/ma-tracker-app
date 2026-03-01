import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/watchlists/[id] — Get a single watchlist with its items */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;

  const list = await prisma.watchlist.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  if (!list || list.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: list.id,
    name: list.name,
    sortOrder: list.sortOrder,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    items: list.items.map((item) => ({
      id: item.id,
      ticker: item.ticker,
      instrumentType: item.instrumentType,
      displayName: item.displayName,
      exchange: item.exchange,
      sortOrder: item.sortOrder,
    })),
  });
}

/** PUT /api/watchlists/[id] — Rename a watchlist */
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;

  // Ownership check
  const existing = await prisma.watchlist.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const updated = await prisma.watchlist.update({
    where: { id },
    data: { name },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    sortOrder: updated.sortOrder,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

/** DELETE /api/watchlists/[id] — Delete a watchlist and all its items */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await context.params;

  // Ownership check
  const existing = await prisma.watchlist.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.watchlist.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
