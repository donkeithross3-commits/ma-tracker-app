import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { exportTickerLists } from "../../export/route";

/**
 * GET /api/krj/lists/[listId]/tickers
 * Get all tickers in a list
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;

  try {
    const tickers = await prisma.krjTicker.findMany({
      where: { listId },
      orderBy: { ticker: "asc" },
      include: {
        addedBy: { select: { alias: true } },
      },
    });

    return NextResponse.json({
      tickers: tickers.map((t) => ({
        ticker: t.ticker,
        addedBy: t.addedBy?.alias || null,
        addedAt: t.addedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching tickers:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickers" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/krj/lists/[listId]/tickers
 * Add tickers to a list (owner only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    // Verify the user owns this list
    const list = await prisma.krjTickerList.findUnique({
      where: { id: listId },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    if (list.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the list owner can add tickers" },
        { status: 403 }
      );
    }

    if (!list.isEditable) {
      return NextResponse.json(
        { error: "This list cannot be edited" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { tickers } = body;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json(
        { error: "Tickers array required" },
        { status: 400 }
      );
    }

    // Normalize tickers (uppercase, trim)
    const normalizedTickers = tickers.map((t: string) =>
      t.trim().toUpperCase()
    );

    // Add tickers (skip duplicates)
    const created = await prisma.krjTicker.createMany({
      data: normalizedTickers.map((ticker) => ({
        listId,
        ticker,
        addedById: session.user.id,
      })),
      skipDuplicates: true,
    });

    // Export updated lists for weekly batch
    await exportTickerLists().catch((e) => console.error("Export failed:", e));

    return NextResponse.json({
      added: created.count,
      message: `Added ${created.count} ticker(s)`,
    });
  } catch (error) {
    console.error("Error adding tickers:", error);
    return NextResponse.json(
      { error: "Failed to add tickers" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/krj/lists/[listId]/tickers
 * Remove tickers from a list (owner only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    // Verify the user owns this list
    const list = await prisma.krjTickerList.findUnique({
      where: { id: listId },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    if (list.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Only the list owner can remove tickers" },
        { status: 403 }
      );
    }

    if (!list.isEditable) {
      return NextResponse.json(
        { error: "This list cannot be edited" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { tickers } = body;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json(
        { error: "Tickers array required" },
        { status: 400 }
      );
    }

    // Normalize tickers (uppercase, trim)
    const normalizedTickers = tickers.map((t: string) =>
      t.trim().toUpperCase()
    );

    // Remove tickers
    const deleted = await prisma.krjTicker.deleteMany({
      where: {
        listId,
        ticker: { in: normalizedTickers },
      },
    });

    // Export updated lists for weekly batch
    await exportTickerLists().catch((e) => console.error("Export failed:", e));

    return NextResponse.json({
      removed: deleted.count,
      message: `Removed ${deleted.count} ticker(s)`,
    });
  } catch (error) {
    console.error("Error removing tickers:", error);
    return NextResponse.json(
      { error: "Failed to remove tickers" },
      { status: 500 }
    );
  }
}
