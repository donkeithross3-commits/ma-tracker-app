import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

/**
 * GET /api/krj/lists/[listId]/fork
 * Get user's fork of a specific list
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listId } = await params;

  try {
    const fork = await prisma.krjTickerListFork.findUnique({
      where: {
        sourceListId_userId: {
          sourceListId: listId,
          userId: session.user.id,
        },
      },
    });

    if (!fork) {
      return NextResponse.json({ fork: null });
    }

    return NextResponse.json({
      fork: {
        addedTickers: fork.addedTickers,
        removedTickers: fork.removedTickers,
      },
    });
  } catch (error) {
    console.error("Error fetching fork:", error);
    return NextResponse.json(
      { error: "Failed to fetch fork" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/krj/lists/[listId]/fork
 * Create or update a fork of a list
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
    const body = await request.json();
    const { addedTickers, removedTickers } = body;

    // Verify the list exists
    const list = await prisma.krjTickerList.findUnique({
      where: { id: listId },
    });

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const fork = await prisma.krjTickerListFork.upsert({
      where: {
        sourceListId_userId: {
          sourceListId: listId,
          userId: session.user.id,
        },
      },
      update: {
        ...(addedTickers !== undefined && { addedTickers }),
        ...(removedTickers !== undefined && { removedTickers }),
      },
      create: {
        sourceListId: listId,
        userId: session.user.id,
        addedTickers: addedTickers || [],
        removedTickers: removedTickers || [],
      },
    });

    return NextResponse.json({
      fork: {
        addedTickers: fork.addedTickers,
        removedTickers: fork.removedTickers,
      },
    });
  } catch (error) {
    console.error("Error updating fork:", error);
    return NextResponse.json(
      { error: "Failed to update fork" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/krj/lists/[listId]/fork
 * Delete a fork (revert to original list)
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
    await prisma.krjTickerListFork.delete({
      where: {
        sourceListId_userId: {
          sourceListId: listId,
          userId: session.user.id,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Ignore if fork doesn't exist
    return NextResponse.json({ success: true });
  }
}
