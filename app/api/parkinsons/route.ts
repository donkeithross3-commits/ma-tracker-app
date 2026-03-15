import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_PATH = join(process.cwd(), "data", "parkinsons", "research-updates.json");

export async function GET() {
  try {
    if (!existsSync(DATA_PATH)) {
      return NextResponse.json(
        { error: "Research data file not found" },
        { status: 404 }
      );
    }

    const raw = readFileSync(DATA_PATH, "utf-8");
    const data = JSON.parse(raw);

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load research data";
    console.error("Error loading parkinsons research data:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
