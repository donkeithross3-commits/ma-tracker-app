import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export type KrjListWithTickers = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerId: string | null;
  ownerAlias: string | null;
  isSystem: boolean;
  isEditable: boolean;
  displayOrder: number;
  tickers: string[];
  tickerCount: number;
};

export type KrjListsResponse = {
  lists: KrjListWithTickers[];
  userForks: Record<string, { addedTickers: string[]; removedTickers: string[] }>;
  userPreferences: { hiddenListIds: string[]; tabOrder: string[] } | null;
};

/**
 * GET /api/krj/lists
 * Get all KRJ ticker lists with user's forks and preferences applied
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  try {
    // Fetch all lists with their tickers and owner info
    const lists = await prisma.krjTickerList.findMany({
      include: {
        owner: { select: { alias: true } },
        tickers: { select: { ticker: true } },
      },
      orderBy: { displayOrder: "asc" },
    });

    // Fetch user's forks if logged in
    let userForks: Record<string, { addedTickers: string[]; removedTickers: string[] }> = {};
    let userPreferences: { hiddenListIds: string[]; tabOrder: string[] } | null = null;

    if (userId) {
      const forks = await prisma.krjTickerListFork.findMany({
        where: { userId },
      });
      for (const fork of forks) {
        userForks[fork.sourceListId] = {
          addedTickers: fork.addedTickers,
          removedTickers: fork.removedTickers,
        };
      }

      const prefs = await prisma.userKrjPreferences.findUnique({
        where: { userId },
      });
      if (prefs) {
        userPreferences = {
          hiddenListIds: prefs.hiddenListIds,
          tabOrder: prefs.tabOrder,
        };
      }
    }

    const response: KrjListsResponse = {
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        slug: list.slug,
        description: list.description,
        ownerId: list.ownerId,
        ownerAlias: list.owner?.alias || null,
        isSystem: list.isSystem,
        isEditable: list.isEditable,
        displayOrder: list.displayOrder,
        tickers: list.tickers.map((t) => t.ticker),
        tickerCount: list.tickers.length,
      })),
      userForks,
      userPreferences,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching KRJ lists:", error);
    return NextResponse.json(
      { error: "Failed to fetch KRJ lists" },
      { status: 500 }
    );
  }
}
