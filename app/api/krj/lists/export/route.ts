import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";

const EXPORT_PATH = path.join(process.cwd(), "data", "krj", "ticker_lists.json");

/**
 * Export all KRJ ticker lists to a JSON file for the weekly batch to read.
 * SPY is always included in etfs_fx regardless of user edits.
 */
async function exportTickerLists() {
  const lists = await prisma.krjTickerList.findMany({
    include: {
      tickers: {
        orderBy: { position: "asc" },
      },
    },
  });

  const exportData: Record<string, string[]> = {};

  for (const list of lists) {
    const tickers = list.tickers.map((t) => t.ticker);
    
    // Always ensure SPY is in etfs_fx (batch needs it for vol_ratio calculations)
    // Add at end if missing (don't sort - preserve order)
    if (list.slug === "etfs_fx" && !tickers.includes("SPY")) {
      tickers.push("SPY");
    }
    
    exportData[list.slug] = tickers;
  }

  // Ensure data directory exists
  const dir = path.dirname(EXPORT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(EXPORT_PATH, JSON.stringify(exportData, null, 2), "utf8");
  
  return exportData;
}

/**
 * GET /api/krj/lists/export
 * Export all ticker lists to JSON file and return the data
 */
export async function GET() {
  try {
    const exportData = await exportTickerLists();
    return NextResponse.json({
      ok: true,
      message: `Exported ${Object.keys(exportData).length} lists to ${EXPORT_PATH}`,
      lists: exportData,
    });
  } catch (error) {
    console.error("Error exporting ticker lists:", error);
    return NextResponse.json(
      { error: "Failed to export ticker lists" },
      { status: 500 }
    );
  }
}

// Also export the function so it can be called from other routes
export { exportTickerLists };
