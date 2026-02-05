import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

export type RawRow = Record<string, string>;

export type KrjListData = {
  id: string;
  key: string; // slug
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerAlias: string | null;
  isSystem: boolean;
  isEditable: boolean;
  canEdit: boolean; // Whether current user can edit
  isFork: boolean; // Whether user has forked this list
  rows: RawRow[];
  tickers: string[];
  forkDelta?: {
    added: string[];
    removed: string[];
  };
};

export type KrjMetadata = {
  signal_date?: string;
  generated_at?: string;
  categories?: Record<string, string>;
  version?: string;
};

/**
 * Load and parse a CSV file from the KRJ data directory
 */
function loadCsv(fileName: string): RawRow[] {
  const filePath = path.join(process.cwd(), "data", "krj", fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`CSV file not found: ${fileName}`);
    return [];
  }
  const csv = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<RawRow>(csv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    console.error("CSV parse errors", fileName, parsed.errors);
  }
  return parsed.data;
}

/**
 * Get signal date from metadata.json
 */
export function getSignalDate(): string {
  try {
    const metadataPath = path.join(process.cwd(), "data", "krj", "metadata.json");
    
    if (fs.existsSync(metadataPath)) {
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: KrjMetadata = JSON.parse(metadataContent);
      
      if (metadata.signal_date) {
        const [year, month, day] = metadata.signal_date.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      }
    }
    
    // Fallback: Use file modification timestamp
    const filePath = path.join(process.cwd(), "data", "krj", "latest_equities.csv");
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return stats.mtime.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    }
    
    return "—";
  } catch (error) {
    console.error(`Error reading signal date:`, error);
    return "—";
  }
}

export type KrjSignal = "Long" | "Short" | "Neutral";

const KRJ_SIGNAL_VALUES: KrjSignal[] = ["Long", "Neutral", "Short"];

/**
 * Get KRJ weekly signal for a set of tickers.
 * Returns a map of ticker (uppercase) -> "Long" | "Short" | "Neutral".
 * Tickers not in any KRJ CSV are omitted (caller treats as "not available").
 */
export function getKrjSignalsForTickers(tickers: string[]): Record<string, KrjSignal> {
  if (tickers.length === 0) return {};
  const wantSet = new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
  if (wantSet.size === 0) return {};

  const allCsvData: Record<string, RawRow[]> = {};
  for (const [slug, csvFile] of Object.entries(SLUG_TO_CSV)) {
    allCsvData[slug] = loadCsv(csvFile);
  }
  const result: Record<string, KrjSignal> = {};
  for (const rows of Object.values(allCsvData)) {
    for (const row of rows) {
      const ticker = (row.ticker || "").toUpperCase();
      if (!ticker || !wantSet.has(ticker) || result[ticker]) continue;
      const raw = (row.signal || "").trim();
      if (KRJ_SIGNAL_VALUES.includes(raw as KrjSignal)) {
        result[ticker] = raw as KrjSignal;
      }
    }
  }
  return result;
}

/**
 * Map list slugs to CSV filenames
 */
const SLUG_TO_CSV: Record<string, string> = {
  equities: "latest_equities.csv",
  etfs_fx: "latest_etfs_fx.csv",
  sp500: "latest_sp500.csv",
  sp100: "latest_sp100.csv",
  drc: "latest_drc.csv",
};

/**
 * Get all KRJ lists with data for a specific user
 * Applies user forks and preferences
 */
export async function getKrjListsForUser(userId: string | null): Promise<{
  lists: KrjListData[];
  signalDate: string;
}> {
  // Fetch all lists from database
  const dbLists = await prisma.krjTickerList.findMany({
    include: {
      owner: { select: { id: true, alias: true } },
      tickers: { select: { ticker: true } },
    },
    orderBy: { displayOrder: "asc" },
  });

  // Fetch user's forks and preferences if logged in
  let userForks: Record<string, { addedTickers: string[]; removedTickers: string[] }> = {};
  let hiddenListIds: string[] = [];
  let tabOrder: string[] = [];

  if (userId) {
    const forks = await prisma.krjTickerListFork.findMany({
      where: { userId },
    });
    for (const fork of forks) {
      userForks[fork.sourceListId] = {
        addedTickers: fork.addedTickers,
        removedTickers: fork.removedTickers,
      };
    }

    const prefs = await prisma.userKrjPreferences.findUnique({
      where: { userId },
    });
    if (prefs) {
      hiddenListIds = prefs.hiddenListIds;
      tabOrder = prefs.tabOrder;
    }
  }

  // Load CSV data for each list
  const allCsvData: Record<string, RawRow[]> = {};
  for (const [slug, csvFile] of Object.entries(SLUG_TO_CSV)) {
    allCsvData[slug] = loadCsv(csvFile);
  }

  // Build a master ticker lookup from ALL CSV files
  // This allows a ticker added to DRC to show data from Top Equities CSV
  const masterTickerData: Record<string, RawRow> = {};
  for (const csvRows of Object.values(allCsvData)) {
    for (const row of csvRows) {
      const ticker = (row.ticker || "").toUpperCase();
      if (ticker && !masterTickerData[ticker]) {
        masterTickerData[ticker] = row;
      }
    }
  }

  // Build the list data with user customizations applied
  const lists: KrjListData[] = [];

  for (const dbList of dbLists) {
    // Skip hidden lists
    if (hiddenListIds.includes(dbList.id)) {
      continue;
    }

    // Get base tickers from database
    let tickers = dbList.tickers.map((t) => t.ticker);

    // Apply user fork if exists
    const fork = userForks[dbList.id];
    const isFork = !!fork;
    if (fork) {
      // Add user's added tickers
      tickers = [...new Set([...tickers, ...fork.addedTickers])];
      // Remove user's removed tickers
      tickers = tickers.filter((t) => !fork.removedTickers.includes(t));
    }

    // Get CSV data - first try the list's own CSV, then fall back to master lookup
    const csvData = allCsvData[dbList.slug] || [];

    // Filter CSV rows to only include tickers in the list
    // For system lists (SP500/SP100), use all CSV data
    let rows: RawRow[];
    if (dbList.isSystem && tickers.length === 0) {
      // System list with no DB tickers - use all CSV rows
      rows = csvData;
      tickers = csvData.map((r) => r.ticker).filter(Boolean);
    } else {
      // Build rows from ticker list, looking up data from any CSV
      const tickerSet = new Set(tickers.map((t) => t.toUpperCase()));
      
      // First, get rows from this list's CSV
      const rowsFromOwnCsv = csvData.filter((row) => {
        const rowTicker = (row.ticker || "").toUpperCase();
        return tickerSet.has(rowTicker);
      });
      
      // Track which tickers we found
      const foundTickers = new Set(rowsFromOwnCsv.map((r) => (r.ticker || "").toUpperCase()));
      
      // For tickers not in own CSV, look up from master data
      const rowsFromMaster: RawRow[] = [];
      for (const ticker of tickers) {
        const upperTicker = ticker.toUpperCase();
        if (!foundTickers.has(upperTicker) && masterTickerData[upperTicker]) {
          rowsFromMaster.push(masterTickerData[upperTicker]);
        }
      }
      
      rows = [...rowsFromOwnCsv, ...rowsFromMaster];
    }

    // Sort currency pairs first for ETFs/FX
    if (dbList.slug === "etfs_fx") {
      rows = [...rows].sort((a, b) => {
        const tickerA = (a.ticker || "").trim();
        const tickerB = (b.ticker || "").trim();
        const isACurrency = tickerA.startsWith("c:");
        const isBCurrency = tickerB.startsWith("c:");
        if (isACurrency && !isBCurrency) return -1;
        if (!isACurrency && isBCurrency) return 1;
        return tickerA.localeCompare(tickerB);
      });
    }

    lists.push({
      id: dbList.id,
      key: dbList.slug,
      name: dbList.name,
      description: dbList.description,
      ownerId: dbList.ownerId,
      ownerAlias: dbList.owner?.alias || null,
      isSystem: dbList.isSystem,
      isEditable: dbList.isEditable,
      canEdit: userId !== null && dbList.ownerId === userId && dbList.isEditable,
      isFork,
      rows,
      tickers,
      forkDelta: fork
        ? { added: fork.addedTickers, removed: fork.removedTickers }
        : undefined,
    });
  }

  // Apply custom tab order if set
  if (tabOrder.length > 0) {
    lists.sort((a, b) => {
      const aIdx = tabOrder.indexOf(a.id);
      const bIdx = tabOrder.indexOf(b.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }

  return {
    lists,
    signalDate: getSignalDate(),
  };
}
