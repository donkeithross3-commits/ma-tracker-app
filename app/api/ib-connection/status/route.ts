import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";
import { prisma } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

const RELAY_STATUS_TIMEOUT_MS = 15000; // 15s (relay may query multiple providers, 5s each)

/**
 * Check WebSocket relay provider status.
 * When userId is provided, only checks providers belonging to that user
 * so the dashboard shows "connected" only when YOUR agent is connected.
 */
async function checkRelayProviderStatus(userId?: string): Promise<{
  connected: boolean;
  providers?: any[];
  message?: string;
  relayError?: string; // Set when relay returned an error or fetch failed (for debugging)
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RELAY_STATUS_TIMEOUT_MS);
  try {
    const url = new URL(`${PYTHON_SERVICE_URL}/options/relay/ib-status`);
    if (userId) url.searchParams.set("user_id", userId);
    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
      }
    );
    clearTimeout(timeoutId);

    const text = await response.text();
    if (!response.ok) {
      return {
        connected: false,
        relayError: `relay ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    let data: { connected?: boolean; providers?: any[]; message?: string };
    try {
      data = JSON.parse(text);
    } catch {
      return { connected: false, relayError: "relay invalid JSON" };
    }

    return {
      connected: Boolean(data.connected),
      providers: data.providers,
      message: data.message,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      connected: false,
      relayError: message.includes("abort") ? "relay timeout" : message,
    };
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
  const pyUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
  try {
    // Get the logged-in user so the status check is user-specific.
    const user = await getCurrentUser();
    const userId = user?.id ?? undefined;

    // 1. Check WebSocket relay provider first (preferred for remote setups)
    const relayStatus = await checkRelayProviderStatus(userId);
    console.log("[ib-connection/status] PYTHON_SERVICE_URL=", pyUrl, "userId=", userId ?? "anon", "relayConnected=", relayStatus.connected, "relayError=", relayStatus.relayError ?? "none");
    
    if (relayStatus.connected) {
      return NextResponse.json({
        connected: true,
        source: "ws-relay",
        providers: relayStatus.providers,
        message: relayStatus.message || "IB connected via WebSocket relay",
      });
    }

    // The relay returned connected=false.  It may have included a useful
    // message (e.g. "agent connected but belongs to a different account").
    // Preserve that for the UI.
    const relayError = relayStatus.relayError;
    const relayMessage = relayStatus.message; // may explain *why* not connected

    // If the relay gave a specific user-facing reason (account mismatch etc.),
    // skip the slow local-TWS probe and return immediately.
    if (relayMessage && !relayError) {
      return NextResponse.json({
        connected: false,
        source: "relay",
        message: relayMessage,
      });
    }

    // 2. Test local IB TWS connection (only when relay had no useful info)
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
      message:
        relayError ||
        "No IB connection available. Start the local agent or ensure TWS is running.",
      relayError: relayError || undefined,
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      source: "error",
      message: error instanceof Error ? error.message : "Error checking IB connection",
    });
  }
}

