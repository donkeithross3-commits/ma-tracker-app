/**
 * One-off script to seed a user's default watchlist with standard trading terminal tickers.
 *
 * Usage: npx tsx scripts/seed-watchlist.ts
 *
 * Requires DATABASE_URL in environment.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Standard trading terminal watchlist items based on reference image
const SEED_ITEMS: { ticker: string; instrumentType: string; exchange?: string; displayName?: string }[] = [
  // --- Equity Index Futures (CME) ---
  { ticker: "ES", instrumentType: "future", exchange: "CME", displayName: "E-mini S&P 500" },
  { ticker: "NQ", instrumentType: "future", exchange: "CME", displayName: "E-mini NASDAQ 100" },
  { ticker: "YM", instrumentType: "future", exchange: "CBOT", displayName: "E-mini Dow" },
  { ticker: "RTY", instrumentType: "future", exchange: "CME", displayName: "E-mini Russell 2000" },
  // --- Energy Futures ---
  { ticker: "CL", instrumentType: "future", exchange: "NYMEX", displayName: "Crude Oil" },
  { ticker: "NG", instrumentType: "future", exchange: "NYMEX", displayName: "Natural Gas" },
  // --- Metals Futures ---
  { ticker: "GC", instrumentType: "future", exchange: "COMEX", displayName: "Gold" },
  { ticker: "SI", instrumentType: "future", exchange: "COMEX", displayName: "Silver" },
  // --- Treasury Futures ---
  { ticker: "ZB", instrumentType: "future", exchange: "CBOT", displayName: "30Y Treasury Bond" },
  { ticker: "ZN", instrumentType: "future", exchange: "CBOT", displayName: "10Y Treasury Note" },
  // --- Major Stocks ---
  { ticker: "NVDA", instrumentType: "stock", displayName: "NVIDIA Corp" },
  { ticker: "MSFT", instrumentType: "stock", displayName: "Microsoft Corp" },
  { ticker: "AAPL", instrumentType: "stock", displayName: "Apple Inc" },
  { ticker: "AMZN", instrumentType: "stock", displayName: "Amazon.com Inc" },
  { ticker: "GOOG", instrumentType: "stock", displayName: "Alphabet Inc" },
  { ticker: "META", instrumentType: "stock", displayName: "Meta Platforms Inc" },
  { ticker: "TSLA", instrumentType: "stock", displayName: "Tesla Inc" },
  { ticker: "SPY", instrumentType: "stock", displayName: "SPDR S&P 500 ETF" },
];

async function main() {
  // Find Don's user account (the primary user)
  const user = await prisma.user.findFirst({
    where: { email: "don.keith.ross3@gmail.com" },
  });

  if (!user) {
    console.error("User not found");
    process.exit(1);
  }

  console.log(`Found user: ${user.fullName || user.email} (${user.id})`);

  // Find the "default" watchlist
  let watchlist = await prisma.watchlist.findFirst({
    where: { userId: user.id, name: "default" },
    include: { items: true },
  });

  if (!watchlist) {
    // Create it if it doesn't exist
    watchlist = await prisma.watchlist.create({
      data: { userId: user.id, name: "default", sortOrder: 0 },
      include: { items: true },
    });
    console.log(`Created "default" watchlist: ${watchlist.id}`);
  } else {
    console.log(`Found "default" watchlist: ${watchlist.id} (${watchlist.items.length} existing items)`);
  }

  // Get existing tickers to avoid duplicates
  const existingTickers = new Set(watchlist.items.map((i) => i.ticker));
  console.log(`Existing tickers: ${[...existingTickers].join(", ") || "(none)"}`);

  // Get the next sort order
  const maxSort = watchlist.items.reduce(
    (max, i) => Math.max(max, i.sortOrder),
    -1
  );
  let nextSort = maxSort + 1;

  // Insert new items
  let added = 0;
  for (const item of SEED_ITEMS) {
    if (existingTickers.has(item.ticker)) {
      console.log(`  Skipping ${item.ticker} (already exists)`);
      continue;
    }

    await prisma.watchlistItem.create({
      data: {
        listId: watchlist.id,
        ticker: item.ticker,
        instrumentType: item.instrumentType,
        displayName: item.displayName || null,
        exchange: item.exchange || null,
        sortOrder: nextSort++,
      },
    });
    console.log(`  Added ${item.ticker} (${item.instrumentType}${item.exchange ? ` / ${item.exchange}` : ""})`);
    added++;
  }

  console.log(`\nDone! Added ${added} items, ${existingTickers.size} already existed.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
