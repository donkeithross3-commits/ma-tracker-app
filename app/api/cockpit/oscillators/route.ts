import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

// The cockpit oscillators are pre-computed by py_proj and saved as JSON
// Path: py_proj/market_state/cache/cockpit_oscillators.json
// This route serves the pre-computed data to the dashboard

const OSCILLATOR_PATHS = [
  // Local dev: py_proj is a sibling directory
  join(process.cwd(), "..", "py_proj", "market_state", "cache", "cockpit_oscillators.json"),
  // Droplet: py_proj is at /home/don/dev/py_proj
  "/home/don/dev/py_proj/market_state/cache/cockpit_oscillators.json",
  // Alternative: data mounted in the app
  join(process.cwd(), "data", "cockpit_oscillators.json"),
];

export async function GET() {
  for (const path of OSCILLATOR_PATHS) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw);

      // Check freshness — warn if older than 24 hours
      const asOf = new Date(data.as_of);
      const ageHours = (Date.now() - asOf.getTime()) / (1000 * 60 * 60);

      return NextResponse.json({
        ...data,
        _source: path,
        _age_hours: Math.round(ageHours * 10) / 10,
        _stale: ageHours > 24,
      });
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    {
      error: "Oscillator data not found. Run: python -m market_state.cockpit_oscillators",
      tickers: {},
      timescales_available: [],
    },
    { status: 404 }
  );
}
