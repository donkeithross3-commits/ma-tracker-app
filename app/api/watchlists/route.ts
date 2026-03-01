import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { prisma } from "@/lib/db";

/** GET /api/watchlists — List all watchlists for the current user */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const lists = await prisma.watchlist.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  return NextResponse.json(
    lists.map((l) => ({
      id: l.id,
      name: l.name,
      sortOrder: l.sortOrder,
      itemCount: l._count.items,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    }))
  );
}

/** POST /api/watchlists — Create a new watchlist */
export async function POST(request: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const body = await request.json();
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Determine next sort order
  const maxSort = await prisma.watchlist.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const list = await prisma.watchlist.create({
    data: {
      userId: user.id,
      name,
      sortOrder: nextSort,
    },
  });

  return NextResponse.json(
    {
      id: list.id,
      name: list.name,
      sortOrder: list.sortOrder,
      itemCount: 0,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    },
    { status: 201 }
  );
}
