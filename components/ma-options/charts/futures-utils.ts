/**
 * Shared futures utilities for watchlist + chart components.
 *
 * Single source of truth for: known symbols, exchange mapping,
 * contract parsing, and front-month derivation.
 */

// ---------------------------------------------------------------------------
// IB futures month codes
// ---------------------------------------------------------------------------

/** Indexed by 0-based month: F=Jan(0), G=Feb(1), H=Mar(2), ... Z=Dec(11) */
export const FUTURES_MONTH_CODE_LETTERS = "FGHJKMNQUVXZ";

/** Letter → two-digit month string */
export const FUTURES_MONTH_CODES: Record<string, string> = {
  F: "01", G: "02", H: "03", J: "04", K: "05", M: "06",
  N: "07", Q: "08", U: "09", V: "10", X: "11", Z: "12",
};

// ---------------------------------------------------------------------------
// Known futures symbols + exchange mapping
// ---------------------------------------------------------------------------

export const FUTURES_SYMBOLS = new Set([
  "ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM",
  "CL", "NG", "RB", "HO", "MCL",
  "GC", "SI", "HG", "SIL", "MGC",
  "ZB", "ZN", "ZF", "ZT", "UB",
  "ZC", "ZS", "ZW", "ZM", "ZL",
  "6E", "6J", "6B", "6A", "6C", "6S",
  "PL", "PA",
]);

export const FUTURES_EXCHANGE: Record<string, string> = {
  SI: "COMEX", GC: "COMEX", HG: "COMEX", SIL: "COMEX", MGC: "COMEX",
  PL: "NYMEX", PA: "NYMEX",
  CL: "NYMEX", NG: "NYMEX", RB: "NYMEX", HO: "NYMEX", MCL: "NYMEX",
  ES: "CME", NQ: "CME", RTY: "CME", MES: "CME", MNQ: "CME", M2K: "CME", EMD: "CME",
  YM: "CBOT", MYM: "CBOT",
  ZB: "CBOT", ZN: "CBOT", ZF: "CBOT", ZT: "CBOT",
  "6E": "CME", "6J": "CME", "6A": "CME", "6B": "CME", "6C": "CME",
  ZC: "CBOT", ZS: "CBOT", ZW: "CBOT", ZM: "CBOT", ZL: "CBOT",
};

const QUARTERLY_FUTURES = new Set([
  "ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM",
]);

// Regex: root symbol + month code letter + 1-2 year digits
const FUTURES_CONTRACT_RE = /^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$/;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a futures ticker into base symbol + contract identifiers.
 *
 *   "ESH6"  → { base: "ES", monthCode: "H", yearDigit: "6" }
 *   "SIK6"  → { base: "SI", monthCode: "K", yearDigit: "6" }
 *   "NQM26" → { base: "NQ", monthCode: "M", yearDigit: "26" }
 *   "ES"    → null (bare root — no embedded contract)
 *   "AAPL"  → null (not a futures contract)
 */
export function parseFuturesContract(
  ticker: string,
): { base: string; monthCode: string; yearDigit: string } | null {
  const m = FUTURES_CONTRACT_RE.exec(ticker);
  if (m) {
    const [, base, monthCode, yearDigit] = m;
    if (FUTURES_SYMBOLS.has(base)) {
      return { base, monthCode, yearDigit };
    }
  }
  return null;
}

/**
 * Check if a ticker is a known futures symbol (bare root or full contract).
 */
export function isFuturesTicker(ticker: string): boolean {
  if (FUTURES_SYMBOLS.has(ticker)) return true;
  return parseFuturesContract(ticker) !== null;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Get the display month code for a futures ticker.
 *
 *   "SIK6"  → "K6"  (embedded contract month)
 *   "ESH26" → "H6"  (normalize to single year digit)
 *   "ES"    → "H6"  (derived front month for bare roots)
 *
 * Returns null for non-futures tickers.
 */
export function getDisplayMonthCode(ticker: string): string | null {
  // Embedded contract month (e.g. "SIK6", "ESH6")
  const parsed = parseFuturesContract(ticker);
  if (parsed) {
    const y = parsed.yearDigit[parsed.yearDigit.length - 1];
    return parsed.monthCode + y;
  }

  // Bare root — derive front month
  if (!FUTURES_SYMBOLS.has(ticker)) return null;
  return deriveFrontMonthCode(ticker);
}

/**
 * Derive the front-month contract code for a bare futures root.
 * Mirrors the agent's `_get_front_month()` logic.
 */
function deriveFrontMonthCode(symbol: string): string {
  const now = new Date();
  const month = now.getUTCMonth(); // 0-based
  const year = now.getUTCFullYear();

  if (QUARTERLY_FUTURES.has(symbol)) {
    const quarters = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec
    for (const q of quarters) {
      if (q >= month) {
        return FUTURES_MONTH_CODE_LETTERS[q] + String(year % 10);
      }
    }
    return FUTURES_MONTH_CODE_LETTERS[2] + String((year + 1) % 10);
  }

  // Monthly: always next month (current month contract typically expired)
  const nextMonth = (month + 1) % 12;
  const nextYear = month === 11 ? year + 1 : year;
  return FUTURES_MONTH_CODE_LETTERS[nextMonth] + String(nextYear % 10);
}

/**
 * Get the IB contract month string ("YYYYMM") for a futures ticker.
 *
 *   "ESH6"  → "202603"
 *   "NQM26" → "202606"
 *   "ES"    → null (bare root — use CONTFUT)
 *   "AAPL"  → null (not a futures contract)
 */
export function getContractMonth(ticker: string): string | null {
  const parsed = parseFuturesContract(ticker);
  if (!parsed) return null;
  const month = FUTURES_MONTH_CODES[parsed.monthCode];
  const year =
    parsed.yearDigit.length === 1
      ? `202${parsed.yearDigit}`
      : `20${parsed.yearDigit}`;
  return `${year}${month}`;
}

/**
 * Get the IB exchange for a futures base symbol.
 * Returns "CME" as default if not found in the mapping.
 */
export function getExchangeForSymbol(base: string): string {
  return FUTURES_EXCHANGE[base] || "CME";
}
