import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import archiver from "archiver";

/**
 * GET /api/ma-options/download-agent-update?key=xxx
 * Download agent update using API key authentication.
 * This endpoint is used by the auto-update feature in the agent.
 * Does NOT include config.env (preserves user's existing key).
 */
export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("key");

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  // Validate API key
  const agentKey = await prisma.agentApiKey.findUnique({
    where: { key: apiKey },
  });

  if (!agentKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    // Path to standalone_agent directory
    const agentDir = path.join(
      process.cwd(),
      "python-service",
      "standalone_agent"
    );

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
      zlib: { level: 9 },
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

    // Add files (NOT including config.env - user keeps their existing one)
    const filesToInclude = [
      "ib_data_agent.py",
      "run_agent.py",
      "ib_scanner.py",
      "resource_manager.py",
      "quote_cache.py",
      "execution_engine.py",
      "position_store.py",
      "trade_attribution.py",
      "install.py",
      "requirements.txt",
      "README.md",
      "start_windows.bat",
      "start_windows.ps1",
      "start_unix.sh",
      "version.txt",
    ];

    for (const fileName of filesToInclude) {
      const filePath = path.join(agentDir, fileName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: fileName });
      }
    }

    // Add strategies directory
    const strategiesDir = path.join(agentDir, "strategies");
    if (fs.existsSync(strategiesDir)) {
      archive.directory(strategiesDir, "strategies");
    }

    // Add standalone executable if it exists
    const exePath = path.join(agentDir, "dist", "ib_data_agent.exe");
    if (fs.existsSync(exePath)) {
      archive.file(exePath, { name: "ib_data_agent.exe" });
    }

    // Add bundled Python for Windows
    const pythonBundleDir = path.join(agentDir, "python_bundle");
    if (fs.existsSync(pythonBundleDir)) {
      archive.directory(pythonBundleDir, "python_bundle");
    }

    // Add ibapi directory
    const ibapiDir = path.join(agentDir, "ibapi");
    if (fs.existsSync(ibapiDir)) {
      archive.directory(ibapiDir, "ibapi");
    }

    // Finalize the archive
    await archive.finalize();

    // Wait for all data to be collected
    const zipBuffer = await archivePromise;

    // Return ZIP file
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ib-data-agent-update.zip"',
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error generating agent update:", error);
    return NextResponse.json(
      { error: "Failed to generate agent update" },
      { status: 500 }
    );
  }
}
