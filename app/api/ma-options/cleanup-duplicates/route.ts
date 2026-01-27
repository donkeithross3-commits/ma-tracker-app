import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { StrategyLeg } from "@/types/ma-options";

/**
 * Generate a unique signature for spread legs
 * This allows us to identify duplicate spreads regardless of leg order in JSON
 */
function generateLegSignature(legs: StrategyLeg[] | unknown): string {
  const legArray = legs as StrategyLeg[];
  if (!Array.isArray(legArray)) return "";
  
  return legArray
    .map(l => `${l.strike}|${l.right}|${l.side}|${l.quantity}`)
    .sort()
    .join(',');
}

/**
 * POST /api/ma-options/cleanup-duplicates
 * 
 * One-time cleanup endpoint to remove duplicate spreads from the database.
 * Keeps the oldest entry (by createdAt) for each unique combination of:
 * - scannerDealId
 * - strategyType
 * - expiration
 * - leg signature (sorted string of strike|right|side|quantity)
 * 
 * Only removes active spreads that are duplicates.
 * 
 * Returns details of what was removed for audit purposes.
 */
export async function POST(request: NextRequest) {
  try {
    // Fetch all active spreads
    const allSpreads = await prisma.watchedSpread.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "asc" }, // Oldest first so we keep the first one we see
      include: {
        scannerDeal: {
          select: { ticker: true }
        }
      }
    });

    console.log(`[CLEANUP] Found ${allSpreads.length} active spreads to check for duplicates`);

    // Group spreads by uniqueness key
    const uniqueGroups = new Map<string, typeof allSpreads>();
    
    for (const spread of allSpreads) {
      // Generate expiration string (normalize Date to YYYY-MM-DD)
      const expirationStr = spread.expiration instanceof Date 
        ? spread.expiration.toISOString().split('T')[0]
        : String(spread.expiration);
      
      // Generate leg signature
      const legSig = generateLegSignature(spread.legs);
      
      // Create unique key
      const uniqueKey = `${spread.scannerDealId}|${spread.strategyType}|${expirationStr}|${legSig}`;
      
      if (!uniqueGroups.has(uniqueKey)) {
        uniqueGroups.set(uniqueKey, []);
      }
      uniqueGroups.get(uniqueKey)!.push(spread);
    }

    // Find duplicates (groups with more than 1 entry)
    const duplicatesToDelete: string[] = [];
    const deletionDetails: Array<{
      ticker: string;
      strategyType: string;
      expiration: string;
      legs: string;
      keptId: string;
      keptCreatedAt: Date;
      deletedIds: string[];
      deletedCreatedAts: Date[];
    }> = [];

    for (const [key, spreads] of uniqueGroups) {
      if (spreads.length > 1) {
        // Keep the first one (oldest), delete the rest
        const [keep, ...toDelete] = spreads;
        
        duplicatesToDelete.push(...toDelete.map(s => s.id));
        
        deletionDetails.push({
          ticker: keep.scannerDeal?.ticker || "UNKNOWN",
          strategyType: keep.strategyType,
          expiration: keep.expiration instanceof Date 
            ? keep.expiration.toISOString().split('T')[0]
            : String(keep.expiration),
          legs: generateLegSignature(keep.legs),
          keptId: keep.id,
          keptCreatedAt: keep.createdAt,
          deletedIds: toDelete.map(s => s.id),
          deletedCreatedAts: toDelete.map(s => s.createdAt),
        });
      }
    }

    console.log(`[CLEANUP] Found ${duplicatesToDelete.length} duplicate spreads to delete`);

    // Delete duplicates
    let deletedCount = 0;
    if (duplicatesToDelete.length > 0) {
      const result = await prisma.watchedSpread.deleteMany({
        where: { id: { in: duplicatesToDelete } }
      });
      deletedCount = result.count;
      console.log(`[CLEANUP] Deleted ${deletedCount} duplicate spreads`);
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalActiveChecked: allSpreads.length,
        uniqueGroups: uniqueGroups.size,
        duplicatesFound: duplicatesToDelete.length,
        duplicatesDeleted: deletedCount,
      },
      details: deletionDetails,
    });

  } catch (error) {
    console.error("[CLEANUP] Error cleaning up duplicates:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to cleanup duplicates" 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ma-options/cleanup-duplicates
 * 
 * Preview mode - shows what would be deleted without actually deleting
 */
export async function GET(request: NextRequest) {
  try {
    // Fetch all active spreads
    const allSpreads = await prisma.watchedSpread.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "asc" },
      include: {
        scannerDeal: {
          select: { ticker: true }
        }
      }
    });

    // Group spreads by uniqueness key
    const uniqueGroups = new Map<string, typeof allSpreads>();
    
    for (const spread of allSpreads) {
      const expirationStr = spread.expiration instanceof Date 
        ? spread.expiration.toISOString().split('T')[0]
        : String(spread.expiration);
      
      const legSig = generateLegSignature(spread.legs);
      const uniqueKey = `${spread.scannerDealId}|${spread.strategyType}|${expirationStr}|${legSig}`;
      
      if (!uniqueGroups.has(uniqueKey)) {
        uniqueGroups.set(uniqueKey, []);
      }
      uniqueGroups.get(uniqueKey)!.push(spread);
    }

    // Find duplicates
    const duplicates: Array<{
      ticker: string;
      strategyType: string;
      expiration: string;
      legs: string;
      count: number;
      wouldKeep: { id: string; createdAt: Date };
      wouldDelete: Array<{ id: string; createdAt: Date }>;
    }> = [];

    for (const [key, spreads] of uniqueGroups) {
      if (spreads.length > 1) {
        const [keep, ...toDelete] = spreads;
        duplicates.push({
          ticker: keep.scannerDeal?.ticker || "UNKNOWN",
          strategyType: keep.strategyType,
          expiration: keep.expiration instanceof Date 
            ? keep.expiration.toISOString().split('T')[0]
            : String(keep.expiration),
          legs: generateLegSignature(keep.legs),
          count: spreads.length,
          wouldKeep: { id: keep.id, createdAt: keep.createdAt },
          wouldDelete: toDelete.map(s => ({ id: s.id, createdAt: s.createdAt })),
        });
      }
    }

    return NextResponse.json({
      preview: true,
      message: "This is a preview. Use POST to actually delete duplicates.",
      summary: {
        totalActiveChecked: allSpreads.length,
        uniqueGroups: uniqueGroups.size,
        duplicatesFound: duplicates.reduce((sum, d) => sum + d.wouldDelete.length, 0),
      },
      duplicates,
    });

  } catch (error) {
    console.error("[CLEANUP] Error previewing duplicates:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to preview duplicates" 
      },
      { status: 500 }
    );
  }
}
