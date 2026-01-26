import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Check WebSocket relay provider status
 */
async function checkRelayProviderStatus(): Promise<{
  connected: boolean;
  providers?: any[];
  message?: string;
}> {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/options/relay/ib-status`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return { connected: false };
    }

    const data = await response.json();
    return {
      connected: data.connected,
      providers: data.providers,
      message: data.message,
    };
  } catch (error) {
    return { connected: false };
  }
}

/**
 * Test IB TWS connection by spawning a quick Python test
 */
async function testIBConnection(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonServicePath = path.join(process.cwd(), "python-service");
    const venvPython = path.join(pythonServicePath, ".venv", "bin", "python3");
    
    const testScript = `
from app.options.ib_client import IBClient
import sys
import random
try:
    client = IBClient()
    # Use a random client ID to avoid conflicts
    client_id = random.randint(200, 299)
    connected = client.connect('127.0.0.1', 7497, client_id)
    client.disconnect()
    sys.exit(0 if connected else 1)
except Exception as e:
    sys.exit(1)
`;

    const test = spawn(venvPython, ["-c", testScript], {
      cwd: pythonServicePath,
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      test.kill();
      resolve(false);
    }, 5000); // 5 second timeout

    test.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });

    test.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    // 1. Check WebSocket relay provider first (preferred for remote setups)
    const relayStatus = await checkRelayProviderStatus();
    
    if (relayStatus.connected) {
      return NextResponse.json({
        connected: true,
        source: "ws-relay",
        providers: relayStatus.providers,
        message: relayStatus.message || "IB connected via WebSocket relay",
      });
    }

    // 2. Test local IB TWS connection
    const ibConnected = await testIBConnection();
    
    if (ibConnected) {
      // Check if we have recent agent data for metadata
      const recentAgentData = await prisma.optionChainSnapshot.findFirst({
        where: {
          snapshotDate: {
            gte: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes
          },
        },
        orderBy: { snapshotDate: "desc" },
      });

      return NextResponse.json({
        connected: true,
        source: "ib-tws",
        agentId: recentAgentData?.agentId,
        lastSeen: recentAgentData?.snapshotDate,
        message: "IB TWS is connected and accepting requests",
      });
    }

    // 3. Nothing connected
    return NextResponse.json({
      connected: false,
      source: "none",
      message: "No IB connection available. Start the local agent or ensure TWS is running.",
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      source: "error",
      message: error instanceof Error ? error.message : "Error checking IB connection",
    });
  }
}

