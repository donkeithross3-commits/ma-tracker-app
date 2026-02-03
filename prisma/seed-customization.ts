import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// User aliases mapping
const USER_ALIASES: Record<string, string> = {
  "don@limitlessventures.us": "DR3",
  "don.keith.ross3@gmail.com": "DR3_dev",
  "keith@unrival.network": "KRJ",
  "luis@limitlessventures.us": "LVS",
  "alexander@limitlessventures.us": "ASH",
  "dmartensen@myvbu.com": "DOM",
};

// KRJ Ticker Lists configuration
// Based on KRJ_backtester_updated.py
const KRJ_LISTS = [
  {
    name: "Top Equities",
    slug: "equities",
    description: "Top traded equities for KRJ signal tracking",
    ownerAlias: "KRJ",
    isSystem: false,
    isEditable: true,
    displayOrder: 0,
    tickers: [
      "AAPL", "MSFT", "GOOG", "AMZN", "NVDA", "TSLA", "META", "VIRT", "PXD",
      "DVN", "COIN", "HOOD", "MU", "CCJ", "MARA", "SQ", "CVNA", "SHOP", "SNOW"
    ],
  },
  {
    name: "ETFs / FX",
    slug: "etfs_fx",
    description: "ETFs and currency pairs",
    ownerAlias: "KRJ",
    isSystem: false,
    isEditable: true,
    displayOrder: 1,
    tickers: [
      "DIA", "SPY", "QQQ", "MDY", "IWM", "OEF", "SLV", "GLD", "USO",
      "XLE", "XLF", "XLV", "XLK", "XLI", "XLY", "XLP", "XLB", "XLU", "XLRE",
      "c:EURUSD", "c:GBPUSD", "c:USDJPY", "c:AUDUSD", "c:USDCAD"
    ],
  },
  {
    name: "SP500",
    slug: "sp500",
    description: "S&P 500 index constituents (auto-updated from SPY holdings)",
    ownerAlias: "DR3_dev",
    isSystem: true,
    isEditable: false,
    displayOrder: 2,
    // Tickers loaded from CSV - we'll leave this empty and it will be populated from sp500_tickers.csv
    tickers: [] as string[],
  },
  {
    name: "SP100",
    slug: "sp100",
    description: "S&P 100 index constituents (auto-updated from OEF holdings)",
    ownerAlias: "DR3_dev",
    isSystem: true,
    isEditable: false,
    displayOrder: 3,
    // Tickers loaded from CSV - we'll leave this empty and it will be populated from sp100_tickers.csv
    tickers: [] as string[],
  },
  {
    name: "DRC",
    slug: "drc",
    description: "Custom DRC watchlist",
    ownerAlias: "DR3",
    isSystem: false,
    isEditable: true,
    displayOrder: 4,
    tickers: [
      "AMZN", "BDX", "BMNR", "COIN", "CRML", "CRWD", "DVN", "ENVX", "GOOG",
      "GS", "HOOD", "IONQ", "JPM", "MARA", "META", "MSFT", "MU", "NVDA",
      "PLTR", "QCOM", "SNOW", "SQ", "TSLA", "TSM", "V", "VRT"
    ],
  },
];

async function main() {
  console.log("Starting customization seed...\n");

  // Step 1: Update user aliases
  console.log("=== Updating User Aliases ===");
  for (const [email, alias] of Object.entries(USER_ALIASES)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.user.update({
        where: { email },
        data: { alias },
      });
      console.log(`  ✓ ${email} → ${alias}`);
    } else {
      console.log(`  ⚠ User not found: ${email} (will be set when they sign up)`);
      // Add to whitelist if not already there
      await prisma.emailWhitelist.upsert({
        where: { email },
        update: {},
        create: { email, notes: `Alias: ${alias}` },
      });
    }
  }

  // Step 2: Create KRJ ticker lists
  console.log("\n=== Creating KRJ Ticker Lists ===");
  for (const listConfig of KRJ_LISTS) {
    // Find owner by alias
    const owner = await prisma.user.findFirst({
      where: { alias: listConfig.ownerAlias },
    });

    // Check if list already exists
    const existingList = await prisma.krjTickerList.findUnique({
      where: { slug: listConfig.slug },
    });

    if (existingList) {
      console.log(`  ⚠ List "${listConfig.name}" already exists, skipping...`);
      continue;
    }

    // Create the list
    const list = await prisma.krjTickerList.create({
      data: {
        name: listConfig.name,
        slug: listConfig.slug,
        description: listConfig.description,
        ownerId: owner?.id,
        isSystem: listConfig.isSystem,
        isEditable: listConfig.isEditable,
        displayOrder: listConfig.displayOrder,
      },
    });
    console.log(`  ✓ Created list: ${listConfig.name} (owner: ${listConfig.ownerAlias})`);

    // Add tickers if any
    if (listConfig.tickers.length > 0) {
      await prisma.krjTicker.createMany({
        data: listConfig.tickers.map((ticker) => ({
          listId: list.id,
          ticker,
          addedById: owner?.id,
        })),
      });
      console.log(`    → Added ${listConfig.tickers.length} tickers`);
    } else {
      console.log(`    → No tickers (system list - loaded from CSV)`);
    }
  }

  // Step 3: Create default "Favorites" deal list for each user
  console.log("\n=== Creating Default Deal Lists ===");
  const users = await prisma.user.findMany();
  for (const user of users) {
    const existingList = await prisma.userDealList.findFirst({
      where: { userId: user.id, isDefault: true },
    });
    if (!existingList) {
      await prisma.userDealList.create({
        data: {
          userId: user.id,
          name: "Favorites",
          isDefault: true,
        },
      });
      console.log(`  ✓ Created "Favorites" list for ${user.alias || user.email}`);
    } else {
      console.log(`  ⚠ Default list already exists for ${user.alias || user.email}`);
    }
  }

  console.log("\n✅ Seed completed!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
