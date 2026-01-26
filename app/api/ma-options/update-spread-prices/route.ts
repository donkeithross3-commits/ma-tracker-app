import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  UpdateSpreadPricesRequest,
  UpdateSpreadPricesResponse,
  StrategyLeg,
} from "@/types/ma-options";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Fetch prices for specific contracts via WebSocket relay
 */
async function fetchPricesViaRelay(
  contracts: Array<{ticker: string, strike: number, expiry: string, right: string}>
): Promise<{success: boolean, contracts: any[]} | null> {
  try {
    console.log(`[PRICE FETCH] Fetching ${contracts.length} contracts via WebSocket relay...`);
    
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/relay/fetch-prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contracts }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log(`[PRICE FETCH] Relay error: ${errorData.detail || response.status}`);
      return null;
    }
    
    const data = await response.json();
    const successful = data.contracts?.filter((c: any) => c !== null).length || 0;
    console.log(`[PRICE FETCH] ✓ Got ${successful}/${contracts.length} prices via relay`);
    
    return data;
  } catch (error) {
    console.log(`[PRICE FETCH] ✗ Relay error: ${error}`);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: UpdateSpreadPricesRequest = await request.json();
    const { spreadIds } = body;

    if (!spreadIds || spreadIds.length === 0) {
      return NextResponse.json(
        { error: "Spread IDs are required" },
        { status: 400 }
      );
    }

    // Fetch spreads with scanner deal info
    const spreads = await prisma.watchedSpread.findMany({
      where: { id: { in: spreadIds } },
      include: {
        scannerDeal: true,
      },
    });

    if (spreads.length === 0) {
      return NextResponse.json({ updates: [] });
    }

    console.log(`[REFRESH PRICES] Updating ${spreads.length} spreads`);
    
    // Extract all unique contracts from spread legs
    const contractsNeeded = new Map<string, {ticker: string, strike: number, expiry: string, right: string}>();
    
    for (const spread of spreads) {
      if (!spread.scannerDeal) continue;
      
      const ticker = spread.scannerDeal.ticker;
      const legs = spread.legs as unknown as StrategyLeg[];
      const expiry = typeof spread.expiration === 'string' 
        ? spread.expiration 
        : (spread.expiration as Date).toISOString().split('T')[0];
      
      for (const leg of legs) {
        const contractKey = `${ticker}_${leg.strike}_${expiry}_${leg.right}`;
        if (!contractsNeeded.has(contractKey)) {
          contractsNeeded.set(contractKey, {
            ticker,
            strike: Number(leg.strike),
            expiry,
            right: leg.right,
          });
        }
      }
    }
    
    console.log(`[REFRESH PRICES] Need ${contractsNeeded.size} unique contracts`);
    
    // Fetch all prices in one call via relay
    const allContracts = Array.from(contractsNeeded.values());
    const fetchResult = await fetchPricesViaRelay(allContracts);
    
    // Build price lookup map
    const priceData = new Map<string, any>();
    let totalFetched = 0;
    if (fetchResult && fetchResult.contracts) {
      for (const contract of fetchResult.contracts) {
        if (contract) {
          const key = `${contract.ticker}_${contract.strike}_${contract.expiry.replace(/-/g, '')}_${contract.right}`;
          priceData.set(key, contract);
          totalFetched++;
        }
      }
    }
    
    console.log(`[REFRESH PRICES] Fetched ${totalFetched}/${contractsNeeded.size} prices`);
    
    // Update spreads
    const updates = [];
    const now = new Date();
    
    for (const spread of spreads) {
      const legs = spread.legs as unknown as StrategyLeg[];
      const expiry = typeof spread.expiration === 'string' 
        ? spread.expiration 
        : (spread.expiration as Date).toISOString().split('T')[0];
      const expiryNorm = expiry.replace(/-/g, '');
      
      let netPremium = 0;
      let allLegsFound = true;
      const updatedLegs = JSON.parse(JSON.stringify(legs)) as StrategyLeg[];
      
      for (const leg of updatedLegs) {
        const contractKey = `${spread.scannerDeal!.ticker}_${leg.strike}_${expiryNorm}_${leg.right}`;
        const price = priceData.get(contractKey);
        
        if (price) {
          leg.bid = price.bid;
          leg.ask = price.ask;
          leg.mid = price.mid;
          const legPremium = price.mid * leg.quantity;
          netPremium += (leg.side === "BUY" ? legPremium : -legPremium);
        } else {
          console.log(`[REFRESH PRICES] Missing: ${contractKey}`);
          allLegsFound = false;
          break;
        }
      }
      
      if (allLegsFound) {
        const updated = await prisma.watchedSpread.update({
          where: { id: spread.id },
          data: {
            currentPremium: netPremium,
            lastUpdated: now,
            legs: updatedLegs as any,
          },
        });
        
        updates.push({
          spreadId: updated.id,
          currentPremium: updated.currentPremium?.toNumber() || 0,
          lastUpdated: updated.lastUpdated?.toISOString() || "",
        });
      }
    }
    
    const durationMs = Date.now() - startTime;
    console.log(`[REFRESH PRICES] Updated ${updates.length}/${spreads.length} spreads in ${Math.round(durationMs/1000)}s`);
    
    return NextResponse.json({ 
      updates,
      metadata: {
        totalSpreads: spreads.length,
        updatedSpreads: updates.length,
        contractsFetched: totalFetched,
        contractsNeeded: contractsNeeded.size,
        durationSeconds: Math.round(durationMs / 1000),
      }
    });
  } catch (error) {
    console.error("Error updating spread prices:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update spread prices",
      },
      { status: 500 }
    );
  }
}

