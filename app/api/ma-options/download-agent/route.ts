import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { Readable } from "stream";

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  const bytes = crypto.randomBytes(32);
  return bytes.toString("base64url");
}

/**
 * GET /api/ma-options/download-agent
 * Download the IB Data Agent as a ZIP file with the user's API key pre-configured.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get or create API key
    let agentKey = await prisma.agentApiKey.findUnique({
      where: { userId },
    });

    if (!agentKey) {
      agentKey = await prisma.agentApiKey.create({
        data: {
          userId,
          key: generateApiKey(),
        },
      });
    }

    // Path to standalone_agent directory
    const agentDir = path.join(process.cwd(), "python-service", "standalone_agent");
    
    // Check if agent directory exists
    if (!fs.existsSync(agentDir)) {
      console.error("Agent directory not found:", agentDir);
      return NextResponse.json(
        { error: "Agent package not found on server" },
        { status: 500 }
      );
    }

    // Create a buffer to hold the ZIP
    const chunks: Buffer[] = [];
    
    // Create archive
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    // Collect chunks
    archive.on("data", (chunk) => {
      chunks.push(chunk);
    });

    // Wait for archive to finish
    const archivePromise = new Promise<Buffer>((resolve, reject) => {
      archive.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      archive.on("error", reject);
    });

    // Add files from standalone_agent directory
    const filesToInclude = [
      "ib_data_agent.py",
      "ib_scanner.py",
      "install.py",
      "requirements.txt",
      "README.md",
      "start_windows.bat",
      "start_windows.ps1",
      "start_unix.sh",
      "config.env.template",
    ];

    for (const fileName of filesToInclude) {
      const filePath = path.join(agentDir, fileName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `ib-data-agent/${fileName}` });
      }
    }

    // Add ibapi directory
    const ibapiDir = path.join(agentDir, "ibapi");
    if (fs.existsSync(ibapiDir)) {
      archive.directory(ibapiDir, "ib-data-agent/ibapi");
    }

    // Create config.env with user's API key
    const configContent = `# IB Data Agent Configuration
# ============================
# Generated for your account - DO NOT SHARE this file!

# Your API key (auto-generated)
IB_PROVIDER_KEY=${agentKey.key}

# IB TWS/Gateway connection settings (modify if needed)
# IB_HOST=127.0.0.1
# IB_PORT=7497

# Use 7497 for paper trading, 7496 for live trading

# WebSocket relay URL (don't change unless instructed)
# RELAY_URL=wss://dr3-dashboard.com/ws/data-provider
`;

    archive.append(configContent, { name: "ib-data-agent/config.env" });

    // Finalize the archive
    await archive.finalize();

    // Wait for all data to be collected
    const zipBuffer = await archivePromise;

    // Return ZIP file
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ib-data-agent.zip"',
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error generating agent download:", error);
    return NextResponse.json(
      { error: "Failed to generate agent download" },
      { status: 500 }
    );
  }
}
