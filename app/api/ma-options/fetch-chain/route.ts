import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { OptionChainResponse, OptionContract } from "@/types/ma-options";
import { spawn } from "child_process";
import path from "path";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Check if a WebSocket data provider is connected and fetch data through it
 */
async function fetchViaWebSocketRelay(
  ticker: string,
  dealPrice: number,
  expectedCloseDate: string,
  scanParams?: ScanParameters
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Check provider status via the relay endpoint
    const statusResponse = await fetch(`${PYTHON_SERVICE_URL}/options/relay/ib-status`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!statusResponse.ok) {
      return { success: false, error: "Could not check provider status" };
    }

    const status = await statusResponse.json();
    
    if (!status.connected || !status.providers || status.providers.length === 0) {
      return { success: false, error: "No data provider connected" };
    }

    console.log(`WebSocket provider available, fetching chain for ${ticker}...`);

    // Send request through the relay
    // The Python service will route this to the connected provider via WebSocket
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/relay/fetch-chain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker,
        dealPrice,
        expectedCloseDate,
        scanParams: scanParams || {},
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { 
        success: false, 
        error: errorData.detail || `Relay request failed: ${response.status}` 
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.log(`WebSocket relay error: ${error}`);
    return { success: false, error: String(error) };
  }
}

interface ScanParameters {
  daysBeforeClose?: number;
  strikeLowerBound?: number;
  strikeUpperBound?: number;
  callShortStrikeLower?: number;
  callShortStrikeUpper?: number;
  putShortStrikeLower?: number;
  putShortStrikeUpper?: number;
  topStrategiesPerExpiration?: number;
  dealConfidence?: number;
}

interface FetchChainRequest {
  dealId: string;
  ticker: string;
  dealPrice: number;
  expectedCloseDate: string;
  scanParams?: ScanParameters;
}

/**
 * Spawn the price agent to fetch fresh data from IB TWS
 * Returns true if successful, false if failed
 */
async function spawnPriceAgent(
  ticker: string,
  dealPrice: number,
  closeDate: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonServicePath = path.join(process.cwd(), "python-service");
    const venvPython = path.join(pythonServicePath, ".venv", "bin", "python3");
    
    console.log(`Spawning price agent for ${ticker}...`);
    
    const agent = spawn(
      venvPython,
      [
        "price_agent.py",
        "--ticker", ticker,
        "--deal-price", dealPrice.toString(),
        "--close-date", closeDate,
      ],
      {
        cwd: pythonServicePath,
        env: { ...process.env },
      }
    );

    let output = "";
    let errorOutput = "";

    agent.stdout?.on("data", (data) => {
      output += data.toString();
    });

    agent.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    // Set timeout of 3 minutes
    const timeout = setTimeout(() => {
      console.log(`Price agent timeout for ${ticker}`);
      agent.kill();
      resolve(false);
    }, 180000);

    agent.on("close", (code) => {
      clearTimeout(timeout);
      
      if (code === 0 && output.includes("RESULT_SUCCESS: True")) {
        console.log(`✓ Price agent completed successfully for ${ticker}`);
        resolve(true);
      } else {
        console.log(`✗ Price agent failed for ${ticker} (exit code: ${code})`);
        if (errorOutput) {
          console.log(`Error output: ${errorOutput.slice(-500)}`); // Last 500 chars
        }
        resolve(false);
      }
    });

    agent.on("error", (error) => {
      clearTimeout(timeout);
      console.log(`Price agent spawn error for ${ticker}:`, error.message);
      resolve(false);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: FetchChainRequest = await request.json();
    const { dealId, ticker, dealPrice, expectedCloseDate, scanParams } = body;

    if (!dealId || !ticker || !dealPrice || !expectedCloseDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Convert ISO date to YYYY-MM-DD format
    const closeDateObj = new Date(expectedCloseDate);
    const formattedCloseDate = closeDateObj.toISOString().split('T')[0];

    // PRIORITY 0: Try WebSocket relay (remote IB data provider)
    // This is the preferred method when IB TWS runs on a different machine
    const relayResult = await fetchViaWebSocketRelay(
      ticker,
      dealPrice,
      formattedCloseDate,
      scanParams
    );

    if (relayResult.success && relayResult.data) {
      console.log(`✓ Got data via WebSocket relay for ${ticker}`);
      
      const chainData = relayResult.data;
      const contracts = chainData.contracts || [];
      const expirations = chainData.expirations || [];
      
      // Calculate days to close
      const today = new Date();
      const closeDate = new Date(expectedCloseDate);
      const daysToClose = Math.ceil(
        (closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Note: We skip saving to optionChainSnapshot because it has a foreign key
      // to the old 'deals' table, but we're now using ScannerDeal IDs.
      // The data is returned directly to the frontend.

      return NextResponse.json({
        snapshotId: `ws-relay-${Date.now()}`, // Temporary ID for relay responses
        ticker: chainData.ticker || ticker,
        spotPrice: chainData.spotPrice,
        dealPrice,
        daysToClose,
        expirations,
        contracts,
        source: "ws-relay",
        timestamp: new Date(),
      });
    }

    // Log relay failure reason for debugging
    if (relayResult.error && relayResult.error !== "No data provider connected") {
      console.log(`WebSocket relay failed for ${ticker}: ${relayResult.error}`);
    }

    // PRIORITY 1: Check for recent data from price agents
    // Only use cached data if just fetched (2 second debounce for double-clicks)
    const recentSnapshot = await prisma.optionChainSnapshot.findFirst({
      where: {
        ticker: ticker.toUpperCase(),
        snapshotDate: {
          gte: new Date(Date.now() - 2 * 1000), // 2 seconds (debounce only)
        },
      },
      orderBy: { snapshotDate: "desc" },
    });

    if (recentSnapshot) {
      // Use cached data from price agent
      const chainData = recentSnapshot.chainData as any[];
      const expirations = [...new Set(chainData.map((c: any) => c.expiry))];
      
      // Calculate age for display
      const ageMs = Date.now() - recentSnapshot.snapshotDate.getTime();
      const ageMinutes = Math.floor(ageMs / 60000);
      
      console.log(`Using agent data for ${ticker}`, {
        agentId: recentSnapshot.agentId,
        ageMinutes,
        contractCount: chainData.length,
      });

      return NextResponse.json({
        snapshotId: recentSnapshot.id,
        ticker: recentSnapshot.ticker,
        spotPrice: Number(recentSnapshot.spotPrice),
        dealPrice: Number(recentSnapshot.dealPrice),
        daysToClose: recentSnapshot.daysToClose,
        expirations: expirations.sort(),
        contracts: chainData,
        source: "agent",
        agentId: recentSnapshot.agentId,
        timestamp: recentSnapshot.snapshotDate,
        agentTimestamp: recentSnapshot.agentTimestamp,
        ageMinutes,
      });
    }

    // PRIORITY 2: Spawn price agent on-demand to fetch fresh data
    console.log(`No recent data for ${ticker}, spawning price agent...`);
    const agentSuccess = await spawnPriceAgent(ticker, dealPrice, formattedCloseDate);
    
    if (agentSuccess) {
      // Agent completed successfully, fetch the newly created snapshot
      const newSnapshot = await prisma.optionChainSnapshot.findFirst({
        where: { ticker: ticker.toUpperCase() },
        orderBy: { snapshotDate: "desc" },
      });
      
      if (newSnapshot) {
        const chainData = newSnapshot.chainData as any[];
        const expirations = [...new Set(chainData.map((c: any) => c.expiry))];
        const ageMs = Math.abs(Date.now() - newSnapshot.snapshotDate.getTime());
        const ageMinutes = Math.floor(ageMs / 60000);
        
        console.log(`✓ Returning fresh agent data for ${ticker} (${chainData.length} contracts)`);
        
        return NextResponse.json({
          snapshotId: newSnapshot.id,
          ticker: newSnapshot.ticker,
          spotPrice: Number(newSnapshot.spotPrice),
          dealPrice: Number(newSnapshot.dealPrice),
          daysToClose: newSnapshot.daysToClose,
          expirations: expirations.sort(),
          contracts: chainData,
          source: "agent",
          agentId: newSnapshot.agentId,
          timestamp: newSnapshot.snapshotDate,
          agentTimestamp: newSnapshot.agentTimestamp,
          ageMinutes,
        });
      }
    }

    // PRIORITY 3: Fall back to Python service (if available)
    // This allows gradual migration - old path still works
    try {
      const response = await fetch(`${PYTHON_SERVICE_URL}/options/chain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker,
          dealPrice,
          expectedCloseDate: formattedCloseDate,
          scanParams: scanParams || {},
        }),
      });

      if (!response.ok) {
        // Parse error detail from Python service
        let errorDetail = `Python service returned ${response.status}`;
        let isIBConnectionError = false;
        
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorDetail = errorData.detail;
            // Check if this is an IB connection error
            isIBConnectionError = 
              response.status === 503 && 
              (errorDetail.includes("IB TWS") || 
               errorDetail.includes("Failed to connect") ||
               errorDetail.includes("not available"));
          }
        } catch (e) {
          // Couldn't parse error, use default message
        }

        // If this is an IB connection error, provide a clear message to the user
        if (isIBConnectionError) {
          throw new Error(
            `IB TWS not connected. Please ensure Interactive Brokers TWS or Gateway is running and accepting API connections on port 7497. Error: ${errorDetail}`
          );
        }
        
        throw new Error(errorDetail);
      }

    const chainData: {
      ticker: string;
      spotPrice: number;
      expirations: string[];
      contracts: OptionContract[];
    } = await response.json();
    
    // Mark as legacy source
    (chainData as any).source = "python-service";

    // Calculate days to close
    const today = new Date();
    const closeDate = new Date(expectedCloseDate);
    const daysToClose = Math.ceil(
      (closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Save snapshot to database (even if empty, for audit trail)
    const snapshot = await prisma.optionChainSnapshot.create({
      data: {
        dealId,
        ticker,
        spotPrice: chainData.spotPrice,
        dealPrice,
        daysToClose,
        chainData: chainData.contracts as any,
        expirationCount: chainData.expirations.length,
        strikeCount: new Set(chainData.contracts.map((c) => c.strike)).size,
      },
    });

      const result: OptionChainResponse = {
        snapshotId: snapshot.id,
        ticker: chainData.ticker,
        spotPrice: chainData.spotPrice,
        dealPrice,
        daysToClose,
        expirations: chainData.expirations,
        contracts: chainData.contracts,
      };

      return NextResponse.json(result);
    } catch (pythonServiceError) {
      // Python service is offline or unreachable
      console.log(`Python service unavailable for ${ticker}, checking for cached data...`);
      
      // Check for ANY cached data (even if old)
      const anyCachedSnapshot = await prisma.optionChainSnapshot.findFirst({
        where: { ticker: ticker.toUpperCase() },
        orderBy: { snapshotDate: "desc" },
      });
      
      if (anyCachedSnapshot) {
        // Calculate age - handle timezone differences by using absolute value
        const ageMs = Math.abs(Date.now() - anyCachedSnapshot.snapshotDate.getTime());
        const ageMinutes = Math.floor(ageMs / 60000);
        
        console.log(`Found cached snapshot for ${ticker}: age=${ageMinutes} minutes, ageMs=${ageMs}, threshold=${30 * 60 * 1000}`);
        
        // If data is reasonably fresh (< 30 minutes), return it
        // This gives users time to run the agent and then click the button
        if (ageMs < 30 * 60 * 1000) {
          console.log(`Using cached agent data for ${ticker} (${ageMinutes} minutes old)`);
          
          const chainData = anyCachedSnapshot.chainData as any[];
          const expirations = [...new Set(chainData.map((c: any) => c.expiry))];
          
          return NextResponse.json({
            snapshotId: anyCachedSnapshot.id,
            ticker: anyCachedSnapshot.ticker,
            spotPrice: Number(anyCachedSnapshot.spotPrice),
            dealPrice: Number(anyCachedSnapshot.dealPrice),
            daysToClose: anyCachedSnapshot.daysToClose,
            expirations: expirations.sort(),
            contracts: chainData,
            source: "agent",
            agentId: anyCachedSnapshot.agentId,
            timestamp: anyCachedSnapshot.snapshotDate,
            agentTimestamp: anyCachedSnapshot.agentTimestamp,
            ageMinutes,
          });
        }
        
        // Data is stale (> 5 minutes), return error with instructions
        return NextResponse.json({
          error: "No fresh data available",
          message: `Last snapshot is ${ageMinutes} minutes old. Run the price agent to fetch fresh data.`,
          instructions: `cd python-service && source .venv/bin/activate && python3 price_agent.py --ticker ${ticker} --deal-price ${dealPrice} --close-date ${formattedCloseDate}`,
          lastSnapshot: {
            age: ageMinutes,
            timestamp: anyCachedSnapshot.snapshotDate,
            agentId: anyCachedSnapshot.agentId,
          }
        }, { status: 503 });
      }
      
      // No cached data at all
      return NextResponse.json({
        error: "No data available",
        message: "No cached data found. Run the price agent to fetch data.",
        instructions: `cd python-service && source .venv/bin/activate && python3 price_agent.py --ticker ${ticker} --deal-price ${dealPrice} --close-date ${formattedCloseDate}`,
      }, { status: 503 });
    }
  } catch (error) {
    console.error("Error fetching option chain:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch option chain",
      },
      { status: 500 }
    );
  }
}

