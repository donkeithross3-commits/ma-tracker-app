import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn } from 'child_process';
import path from 'path';
import type {
  UpdateSpreadPricesRequest,
  UpdateSpreadPricesResponse,
  StrategyLeg,
} from "@/types/ma-options";

/**
 * Spawn lightweight price fetcher for specific contracts (OPTIMIZED for Monitor tab)
 * Much faster than full chain scanning - only fetches what we need
 */
async function spawnPriceFetcher(
  ticker: string,
  contracts: Array<{ticker: string, strike: number, expiry: string, right: string}>
): Promise<{success: boolean, contracts: any[]} | null> {
  return new Promise((resolve) => {
    const pythonServicePath = path.join(process.cwd(), "python-service");
    const venvPython = path.join(pythonServicePath, ".venv", "bin", "python3");
    
    console.log(`[PRICE FETCH] ${ticker}: fetching ${contracts.length} specific contracts...`);
    
    const contractsJson = JSON.stringify(contracts);
    
    const fetcher = spawn(
      venvPython,
      [
        "price_fetcher.py",
        "--contracts", contractsJson,
      ],
      {
        cwd: pythonServicePath,
        env: { ...process.env },
      }
    );

    let output = "";
    let errorOutput = "";

    fetcher.stdout?.on("data", (data) => {
      output += data.toString();
    });

    fetcher.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    // Set timeout of 30 seconds (should be MUCH faster than full chain)
    const timeout = setTimeout(() => {
      console.log(`[PRICE FETCH] Timeout for ${ticker}`);
      fetcher.kill();
      resolve(null);
    }, 30000);

    fetcher.on("close", (code) => {
      clearTimeout(timeout);
      
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.success) {
            console.log(`[PRICE FETCH] ✓ ${ticker}: got ${result.contracts.filter((c: any) => c).length} prices`);
            resolve(result);
          } else {
            console.log(`[PRICE FETCH] ✗ ${ticker}: ${result.error}`);
            resolve(null);
          }
        } catch (e) {
          console.log(`[PRICE FETCH] ✗ ${ticker}: failed to parse output`);
          resolve(null);
        }
      } else {
        console.log(`[PRICE FETCH] ✗ ${ticker}: exit code ${code}`);
        if (errorOutput) {
          console.log(`Error: ${errorOutput.slice(-300)}`);
        }
        resolve(null);
      }
    });

    fetcher.on("error", (error) => {
      clearTimeout(timeout);
      console.log(`[PRICE FETCH] ✗ ${ticker}: spawn error - ${error.message}`);
      resolve(null);
    });
  });
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

    // Fetch spreads with deal info
    const spreads = await prisma.watchedSpread.findMany({
      where: { id: { in: spreadIds } },
      include: {
        deal: {
          include: {
            versions: {
              where: { isCurrentVersion: true },
              take: 1,
            },
          },
        },
      },
    });

    if (spreads.length === 0) {
      return NextResponse.json({ updates: [] });
    }

    console.log(`[REFRESH PRICES] Updating ${spreads.length} spreads`);
    
    // Extract all unique contracts from spread legs
    const contractsNeeded = new Map<string, {ticker: string, strike: number, expiry: string, right: string}>();
    
    for (const spread of spreads) {
      if (!spread.deal) continue;
      
      const ticker = spread.deal.ticker;
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
    
    // Group by ticker
    const contractsByTicker = new Map<string, typeof contractsNeeded>();
    for (const [key, contract] of contractsNeeded.entries()) {
      if (!contractsByTicker.has(contract.ticker)) {
        contractsByTicker.set(contract.ticker, new Map());
      }
      contractsByTicker.get(contract.ticker)!.set(key, contract);
    }
    
    // Fetch prices in parallel
    const fetchPromises = Array.from(contractsByTicker.entries()).map(([ticker, contracts]) =>
      spawnPriceFetcher(ticker, Array.from(contracts.values()))
    );
    
    const fetchResults = await Promise.all(fetchPromises);
    
    // Build price lookup map
    const priceData = new Map<string, any>();
    let totalFetched = 0;
    for (const result of fetchResults) {
      if (result && result.contracts) {
        for (const contract of result.contracts) {
          if (contract) {
            const key = `${contract.ticker}_${contract.strike}_${contract.expiry.replace(/-/g, '')}_${contract.right}`;
            priceData.set(key, contract);
            totalFetched++;
          }
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
        const contractKey = `${spread.deal!.ticker}_${leg.strike}_${expiryNorm}_${leg.right}`;
        const price = priceData.get(contractKey);
        
        if (price) {
          leg.bid = price.bid;
          leg.ask = price.ask;
          leg.mid = price.mid;
          if (price.volume !== undefined) leg.volume = price.volume;
          if (price.openInterest !== undefined) leg.openInterest = price.openInterest;
          if (price.bidSize !== undefined) leg.bidSize = price.bidSize;
          if (price.askSize !== undefined) leg.askSize = price.askSize;
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

