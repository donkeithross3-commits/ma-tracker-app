#!/usr/bin/env npx tsx
/**
 * Fetch market cap for all KRJ tickers from Polygon and write data/krj/ticker_market_caps.json.
 * Run from project root. Requires POLYGON_API_KEY in env or .env.local.
 *
 * Usage: npx tsx scripts/fetch-krj-market-caps.ts
 * Or:    POLYGON_API_KEY=yourkey npx tsx scripts/fetch-krj-market-caps.ts
 */

import fs from "fs";
import path from "path";

// Load env files if present (no dotenv dependency)
for (const name of [".env.local", ".env", ".env.development"]) {
  const envPath = path.join(process.cwd(), name);
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    break; // first file wins
  }
}

const API_KEY = process.env.POLYGON_API_KEY?.trim();
if (!API_KEY) {
  console.error("POLYGON_API_KEY is not set. Set it in .env.local or the environment.");
  process.exit(1);
}

const DATA_KRJ = path.join(process.cwd(), "data", "krj");
const OUT_PATH = path.join(DATA_KRJ, "ticker_market_caps.json");

const CSV_FILES = [
  "latest_equities.csv",
  "latest_etfs_fx.csv",
  "latest_sp500.csv",
  "latest_sp100.csv",
  "latest_ndx100.csv",
  "latest_drc.csv",
];

function collectTickers(): Set<string> {
  const tickers = new Set<string>();
  for (const file of CSV_FILES) {
    const filePath = path.join(DATA_KRJ, file);
    if (!fs.existsSync(filePath)) continue;
    const csv = fs.readFileSync(filePath, "utf8");
    const lines = csv.split("\n").filter(Boolean);
    const header = lines[0]?.toLowerCase().split(",").map((s) => s.trim()) ?? [];
    const tickerIdx = header.indexOf("ticker");
    if (tickerIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      const t = row[tickerIdx]?.trim().toUpperCase();
      if (t && !t.startsWith("C:")) tickers.add(t);
    }
  }
  return tickers;
}

async function fetchMarketCap(ticker: string): Promise<number | null> {
  const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { results?: { market_cap?: number } };
    const cap = data.results?.market_cap;
    if (cap == null || typeof cap !== "number" || cap <= 0) return null;
    return cap / 1e9; // dollars -> billions
  } catch (e) {
    console.warn(`[${ticker}] ${e}`);
    return null;
  }
}

async function main() {
  const tickers = collectTickers();
  console.log(`Found ${tickers.size} unique tickers in KRJ CSVs.`);

  let existing: Record<string, number> = {};
  if (fs.existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) as Record<string, number>;
      console.log(`Loaded ${Object.keys(existing).length} existing entries from ${OUT_PATH}.`);
    } catch {
      // ignore
    }
  }

  const toFetch = [...tickers].filter((t) => existing[t] == null);
  if (toFetch.length === 0) {
    console.log("All tickers already have market cap. Exiting.");
    return;
  }

  console.log(`Fetching market cap for ${toFetch.length} tickers from Polygon (rate-limited)...`);
  const out: Record<string, number> = { ...existing };

  for (let i = 0; i < toFetch.length; i++) {
    const ticker = toFetch[i];
    const capB = await fetchMarketCap(ticker);
    if (capB != null) out[ticker] = Math.round(capB * 100) / 100;
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${toFetch.length}`);
    await new Promise((r) => setTimeout(r, 220)); // ~4.5/sec to stay under 5/sec
  }

  // Sort keys for stable output
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(out).sort()) {
    sorted[k] = out[k];
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 2), "utf8");
  console.log(`Wrote ${Object.keys(sorted).length} entries to ${OUT_PATH}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
