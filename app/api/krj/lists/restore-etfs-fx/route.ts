import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { exportTickerLists } from "../export/route";

/** Canonical ETFs/FX list (matches seed-customization.ts). */
const ETFS_FX_TICKERS = [
  "c:EURUSD", "c:GBPUSD", "c:USDJPY", "c:CADUSD", "c:EURGBP",
  "DIA", "SPY", "QQQ", "MDY", "IWM", "OEF", "SLV", "GLD", "USO",
  "XLE", "XLF", "EEM", "ARKK", "UVXY",
  "BIL", "BILS", "SPTS", "SPTI", "SPTL",
  "HYG", "JNK", "TLT", "IEF", "SHY",
  "VEA", "IEFA", "BND", "AGG",
  "VUG", "VWO", "IEMG", "IJR", "IJH", "VIG", "IWF", "EFA",
];

/**
 * POST /api/krj/lists/restore-etfs-fx
 * Restore the ETFs/FX list to the canonical 42 tickers. Requires auth; only list owner can restore.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const list = await prisma.krjTickerList.findUnique({
    where: { slug: "etfs_fx" },
    include: { tickers: true },
  });

  if (!list) {
    return NextResponse.json({ error: "ETFs/FX list not found" }, { status: 404 });
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
      data: ETFS_FX_TICKERS.map((ticker) => ({
        listId: list.id,
        ticker,
        addedById: session!.user!.id,
      })),
    });
  });

  // Export updated lists for weekly batch
  await exportTickerLists().catch((e) => console.error("Export failed:", e));

  return NextResponse.json({
    ok: true,
    message: `Restored ETFs/FX list to ${ETFS_FX_TICKERS.length} tickers`,
    count: ETFS_FX_TICKERS.length,
  });
}
