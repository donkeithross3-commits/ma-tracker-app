import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from the standalone_agent folder.
// IMPORTANT: In production this reads from INSIDE the Docker container.
// Updating version.txt on the host (git pull) does NOT change what this
// endpoint returns. You must rebuild the Docker image and recreate the
// container: docker compose build --no-cache web && docker compose up -d --force-recreate web
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
