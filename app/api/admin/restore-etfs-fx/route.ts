import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Canonical ETFs/FX list in exact order specified by user.
 */
const ETFS_FX_TICKERS = [
  "c:EURUSD",
  "c:GBPUSD",
  "c:USDJPY",
  "c:CADUSD",
  "c:EURGBP",
  "DIA",
  "SPY",
  "QQQ",
  "MDY",
  "IWM",
  "OEF",
  "SLV",
  "GLD",
  "USO",
  "XLE",
  "XLF",
  "EEM",
  "ARKK",
  "UVXY",
  "BIL",
  "BILS",
  "SPTS",
  "SPTI",
  "SPTL",
  "HYG",
  "JNK",
  "TLT",
  "IEF",
  "SHY",
  "VEA",
  "IEFA",
  "BND",
  "AGG",
  "VUG",
  "VWO",
  "IEMG",
  "IJR",
  "IJH",
  "VIG",
  "IWF",
  "EFA",
];

const ADMIN_KEY = "restore-etfs-fx-20260205";

/**
 * GET /api/admin/restore-etfs-fx?key=restore-etfs-fx-20260205
 * One-time admin endpoint to restore the ETFs/FX list without session auth.
 * Delete this file after use.
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (key !== ADMIN_KEY) {
    return NextResponse.json({ error: "Invalid key" }, { status: 403 });
  }

  const list = await prisma.krjTickerList.findUnique({
    where: { slug: "etfs_fx" },
  });

  if (!list) {
    return NextResponse.json({ error: "ETFs/FX list not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.krjTicker.deleteMany({ where: { listId: list.id } });
    await tx.krjTicker.createMany({
      data: ETFS_FX_TICKERS.map((ticker) => ({
        listId: list.id,
        ticker,
        // No addedById - admin restore
      })),
    });
  });

  return NextResponse.json({
    ok: true,
    message: `Restored ETFs/FX list to ${ETFS_FX_TICKERS.length} tickers`,
    count: ETFS_FX_TICKERS.length,
    tickers: ETFS_FX_TICKERS,
  });
}
