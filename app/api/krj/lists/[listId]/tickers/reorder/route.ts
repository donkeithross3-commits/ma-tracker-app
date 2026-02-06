import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

/**
 * PATCH /api/krj/lists/[listId]/tickers/reorder
 * Reorder tickers in a list. Accepts { tickers: string[] } in the desired order.
 * Updates the position field for each ticker.
 */
export async function PATCH(
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
        { error: "Only the list owner can reorder tickers" },
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

    // Normalize tickers
    const normalizedTickers = tickers.map((t: string) =>
      t.trim().toUpperCase()
    );

    // Use raw SQL to update positions efficiently in a single transaction
    // This avoids Prisma's updateMany type issues with the position field
    await prisma.$transaction(async (tx) => {
      for (let idx = 0; idx < normalizedTickers.length; idx++) {
        await tx.$executeRaw`
          UPDATE krj_tickers
          SET position = ${idx}
          WHERE list_id = ${listId}::uuid AND ticker = ${normalizedTickers[idx]}
        `;
      }
    });

    return NextResponse.json({
      ok: true,
      message: `Reordered ${normalizedTickers.length} tickers`,
    });
  } catch (error) {
    console.error("Error reordering tickers:", error);
    return NextResponse.json(
      { error: "Failed to reorder tickers" },
      { status: 500 }
    );
  }
}
