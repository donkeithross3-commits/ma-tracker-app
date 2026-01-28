import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from the standalone_agent folder
function getAgentVersion(): string {
  try {
    const versionPath = join(
      process.cwd(),
      "python-service",
      "standalone_agent",
      "version.txt"
    );
    return readFileSync(versionPath, "utf-8").trim();
  } catch {
    return "1.0.0"; // fallback
  }
}

export async function GET() {
  const version = getAgentVersion();

  return NextResponse.json({
    version,
    downloadUrl: "/api/ma-options/download-agent",
  });
}
