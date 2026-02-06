import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { exportTickerLists } from "../export/route";

/** Canonical DRC ticker list (deduplicated, preserving custom order). */
const DRC_TICKERS = [
  "MDB", "OKTA", "COIN", "BDX", "BMNR", "ETH", "IBM", "UNP", "KEYS", "IONQ",
  "EOSE", "ED", "SO", "EMBC", "QS", "CRML", "RDDT", "RBLX", "URA", "MMM",
  "GLNG", "GOOGL", "HD", "IBIT", "IBKR", "LRCX", "META", "MP", "NVDA", "OPEN",
  "OPENL", "OPENW", "OPENZ", "PANW", "AMZN", "CRWD", "CSCO", "ETN", "FBTC",
  "FXI", "FZDXX", "GEV", "SLB", "SNOW", "TSLA", "UBER", "VRT", "WMB", "WYFI",
  "LOW", "MSFT",
];

/**
 * POST /api/krj/lists/restore-drc
 * Restore the DRC list to the canonical tickers. Requires auth; only list owner can restore.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const list = await prisma.krjTickerList.findUnique({
    where: { slug: "drc" },
    include: { tickers: true },
  });

  if (!list) {
    return NextResponse.json({ error: "DRC list not found" }, { status: 404 });
  }

  if (list.ownerId !== session.user.id) {
    return NextResponse.json(
      { error: "Only the list owner can restore this list" },
      { status: 403 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.krjTicker.deleteMany({ where: { listId: list.id } });
    await tx.krjTicker.createMany({
      data: DRC_TICKERS.map((ticker, idx) => ({
        listId: list.id,
        ticker,
        addedById: session!.user!.id,
        position: idx,
      })),
    });
  });

  // Export updated lists for weekly batch
  await exportTickerLists().catch((e) => console.error("Export failed:", e));

  return NextResponse.json({
    ok: true,
    message: `Restored DRC list to ${DRC_TICKERS.length} tickers`,
    count: DRC_TICKERS.length,
  });
}
