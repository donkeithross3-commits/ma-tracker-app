import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

export type RawRow = Record<string, string>;

/** Expected constituent count ranges for system index lists (must match py_proj sync_indexes). */
export const INDEX_EXPECTED_RANGES: Record<string, { min: number; max: number }> = {
  sp500: { min: 498, max: 505 },
  sp100: { min: 98, max: 102 },
  ndx100: { min: 98, max: 102 },
};

/**
 * Returns a warning message when a system index list's row count is outside the expected range.
 * Used for compositionWarning on KrjListData.
 */
export function getCompositionWarning(
  slug: string,
  count: number,
  listName: string
): string | undefined {
  const range = INDEX_EXPECTED_RANGES[slug];
  if (!range || (count >= range.min && count <= range.max)) return undefined;
  return `${listName} shows ${count} tickers (expected ${range.min}–${range.max}). Index composition may be incomplete.`;
}

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
  /** Set when system list row count is outside expected range (e.g. SP500 has 493). */
  compositionWarning?: string;
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

/** Return the most recent Friday (UTC date). Used when metadata is missing. */
function getMostRecentFriday(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const daysBack = day <= 5 ? (day === 0 ? 2 : 5 - day) : day - 5;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
}

function formatSignalDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get signal date for the KRJ header.
 * Reads from metadata.json (written by the Saturday weekly job). If missing or invalid,
 * falls back to the most recent Friday so we never show a misleading file mtime.
 */
export function getSignalDate(): string {
  try {
    const metadataPath = path.join(process.cwd(), "data", "krj", "metadata.json");

    if (fs.existsSync(metadataPath)) {
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: KrjMetadata = JSON.parse(metadataContent);

      if (metadata.signal_date) {
        const [y, m, d] = metadata.signal_date.split("-").map(Number);
        if (y && m && d) {
          const date = new Date(Date.UTC(y, m - 1, d));
          return formatSignalDate(date);
        }
      }
    }

    return formatSignalDate(getMostRecentFriday());
  } catch (error) {
    console.error(`Error reading signal date:`, error);
    return formatSignalDate(getMostRecentFriday());
  }
}

export type KrjSignal = "Long" | "Short" | "Neutral";

const KRJ_SIGNAL_VALUES: KrjSignal[] = ["Long", "Neutral", "Short"];

/**
 * Get KRJ weekly signal for a set of tickers.
 * Returns a map of ticker (uppercase) -> "Long" | "Short" | "Neutral".
 * Uses CSV data plus on-demand signals. Tickers not found are omitted (caller treats as "not available").
 */
export function getKrjSignalsForTickers(tickers: string[]): Record<string, KrjSignal> {
  if (tickers.length === 0) return {};
  const wantSet = new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
  if (wantSet.size === 0) return {};

  const result: Record<string, KrjSignal> = {};
  const allCsvData: Record<string, RawRow[]> = {};
  for (const [slug, csvFile] of Object.entries(SLUG_TO_CSV)) {
    allCsvData[slug] = loadCsv(csvFile);
  }
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
  const onDemand = loadOnDemandSignals();
  for (const ticker of wantSet) {
    if (result[ticker]) continue;
    const row = onDemand[ticker];
    if (!row) continue;
    const raw = (row.signal || "").trim();
    if (KRJ_SIGNAL_VALUES.includes(raw as KrjSignal)) result[ticker] = raw as KrjSignal;
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
  ndx100: "latest_ndx100.csv",
  drc: "latest_drc.csv",
};

const KRJ_CSV_COLUMNS = [
  "ticker", "c", "weekly_low", "25DMA", "25DMA_shifted",
  "long_signal_value", "short_signal_value", "signal", "signal_status_prior_week",
  "vol_ratio", "25DMA_range_bps", "25D_ADV_Shares_MM", "25D_ADV_nortional_B", "avg_trade_size",
  "market_cap_b",
] as const;

/** Path to on-demand (single-ticker) signals merged into list data */
const ON_DEMAND_SIGNALS_PATH = path.join(process.cwd(), "data", "krj", "on_demand_signals.json");

/** Path to optional ticker -> market cap (billions) JSON; pipeline or script can write this */
const TICKER_MARKET_CAPS_PATH = path.join(process.cwd(), "data", "krj", "ticker_market_caps.json");

function loadTickerMarketCaps(): Record<string, number> {
  try {
    if (!fs.existsSync(TICKER_MARKET_CAPS_PATH)) return {};
    const raw = fs.readFileSync(TICKER_MARKET_CAPS_PATH, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [ticker, val] of Object.entries(data)) {
      const t = (ticker || "").toUpperCase();
      const n = Number(val);
      if (t && !Number.isNaN(n) && n > 0) out[t] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Row is a placeholder when it has a ticker but no Friday close or signal (no CSV data yet).
 */
export function isPlaceholderRow(row: RawRow): boolean {
  const ticker = (row?.ticker || "").trim();
  const c = (row?.c ?? "").toString().trim();
  const signal = (row?.signal ?? "").toString().trim();
  return !!ticker && !c && !signal;
}

function loadOnDemandSignals(): Record<string, RawRow> {
  try {
    if (!fs.existsSync(ON_DEMAND_SIGNALS_PATH)) return {};
    const raw = fs.readFileSync(ON_DEMAND_SIGNALS_PATH, "utf8");
    const data = JSON.parse(raw) as Record<string, RawRow>;
    const out: Record<string, RawRow> = {};
    for (const [ticker, row] of Object.entries(data)) {
      const upper = (ticker || "").toUpperCase();
      if (upper && row && typeof row === "object") out[upper] = row;
    }
    return out;
  } catch {
    return {};
  }
}

function makePlaceholderRow(ticker: string): RawRow {
  const row: RawRow = {};
  for (const col of KRJ_CSV_COLUMNS) {
    row[col] = col === "ticker" ? ticker.toUpperCase() : "";
  }
  return row;
}

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
      tickers: { 
        select: { ticker: true },
        orderBy: { position: "asc" },
      },
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
  // Merge on-demand (single-ticker) signals so they appear in lists
  const onDemandSignals = loadOnDemandSignals();
  for (const [ticker, row] of Object.entries(onDemandSignals)) {
    const upper = ticker.toUpperCase();
    if (upper && !masterTickerData[upper]) masterTickerData[upper] = row;
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
      
      // For tickers not in own CSV, look up from master data or add placeholder
      const rowsFromMaster: RawRow[] = [];
      const placeholderRows: RawRow[] = [];
      for (const ticker of tickers) {
        const upperTicker = ticker.toUpperCase();
        if (foundTickers.has(upperTicker)) continue;
        if (masterTickerData[upperTicker]) {
          rowsFromMaster.push(masterTickerData[upperTicker]);
        } else {
          // Do not show placeholder rows for currency pairs (c: prefix); they would clutter ETFs/FX with "No signal yet" for tickers not in the weekly CSV.
          if (upperTicker.startsWith("C:")) continue;
          // ETFs/FX: only show tickers that have data (CSV or on-demand). Do not add placeholders so the tab matches the original behavior and is not cluttered with "No signal yet" rows.
          if (dbList.slug === "etfs_fx") continue;
          placeholderRows.push(makePlaceholderRow(ticker));
        }
      }
      // Build rows map for quick lookup
      const rowMap = new Map<string, RawRow>();
      for (const row of [...rowsFromOwnCsv, ...rowsFromMaster, ...placeholderRows]) {
        const ticker = (row.ticker || "").toUpperCase();
        if (ticker) rowMap.set(ticker, row);
      }
      
      // Preserve ticker order from database (position column)
      rows = [];
      for (const ticker of tickers) {
        const row = rowMap.get(ticker.toUpperCase());
        if (row) rows.push(row);
      }
    }

    const compositionWarning = dbList.isSystem
      ? getCompositionWarning(dbList.slug, rows.length, dbList.name)
      : undefined;

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
      compositionWarning,
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

  // Enrich market_cap_b: 1) optional JSON file (pipeline), 2) ticker_master (DB)
  const allTickers = new Set<string>();
  for (const list of lists) {
    for (const row of list.rows) {
      const t = (row.ticker || "").trim().toUpperCase();
      if (t) allTickers.add(t);
    }
  }
  const tickerArray = Array.from(allTickers);
  const marketCapByTicker: Record<string, number> = loadTickerMarketCaps();
  if (tickerArray.length > 0) {
    try {
      type Row = { ticker: string; market_cap_usd: unknown };
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        "SELECT ticker, market_cap_usd FROM ticker_master WHERE ticker = ANY($1::text[]) AND market_cap_usd IS NOT NULL",
        tickerArray
      );
      for (const r of rows) {
        const cap = Number(r.market_cap_usd);
        const t = (r.ticker || "").toUpperCase();
        if (t && !Number.isNaN(cap) && cap > 0) {
          const capB = cap / 1e9;
          if (marketCapByTicker[t] == null) marketCapByTicker[t] = capB;
        }
      }
    } catch {
      // ticker_master may not exist or may differ; skip DB enrichment
    }
  }
  if (Object.keys(marketCapByTicker).length > 0) {
    for (const list of lists) {
      for (const row of list.rows) {
        const t = (row.ticker || "").trim().toUpperCase();
        const capB = marketCapByTicker[t];
        if (capB != null && (!row.market_cap_b || String(row.market_cap_b).trim() === "")) {
          row.market_cap_b = String(capB);
        }
      }
    }
  }

  return {
    lists,
    signalDate: getSignalDate(),
  };
}
