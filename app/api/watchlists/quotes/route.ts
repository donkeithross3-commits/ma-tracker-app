import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

interface QuoteItem {
  ticker: string;
  instrumentType?: string;
  exchange?: string;
}

interface QuoteResult {
  ticker: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  close: number | null;
  stale: boolean;
  source: string;
  priceSource: string | null;
  timestamp: string | null;
  lastTradeTs: string | null;
  quoteTs: string | null;
  minuteBarTs: string | null;
  snapshotUpdatedTs: string | null;
  marketAgeSec: number | null;
}

// Per-request timeout — prevents one slow/hung ticker from blocking the batch.
// The IB relay has a 15s timeout, so 10s gives the relay time to respond while
// bounding total wall time for the batch to ~10s via Promise.allSettled.
const PER_REQUEST_TIMEOUT_MS = 10_000;

// Max concurrent requests to the relay. Processing too many at once overwhelms
// the IB agent (sequential processing) and causes WebSocket disconnections.
const MAX_CONCURRENT = 4;

function parseAgeSeconds(ts: string | null): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

function staleThresholdSec(source: string, priceSource: string | null): number {
  if (source === "polygon" && priceSource === "minute_bar") return 75;
  if (source === "polygon" && priceSource === "day_close") return 300;
  return 20;
}

/** Helper: resolve a stale/error result */
function staleResult(ticker: string, source = "error"): QuoteResult {
  return {
    ticker,
    price: null,
    change: null,
    changePct: null,
    volume: null,
    bid: null,
    ask: null,
    close: null,
    stale: true,
    source,
    priceSource: null,
    timestamp: null,
    lastTradeTs: null,
    quoteTs: null,
    minuteBarTs: null,
    snapshotUpdatedTs: null,
    marketAgeSec: null,
  };
}

/** Fetch a single quote with timeout */
async function fetchSingleQuote(
  item: QuoteItem,
  userId: string
): Promise<QuoteResult> {
  const ticker = item.ticker.toUpperCase();

  // Build payload for stock-quote relay
  const payload: Record<string, string> = { ticker, userId };

  if (item.instrumentType === "future") {
    payload.secType = "FUT";
    if (item.exchange) payload.exchange = item.exchange;
  } else if (item.instrumentType === "index") {
    payload.secType = "IND";
    payload.exchange = item.exchange || "CBOE";
  }

  try {
    const resp = await fetch(
      `${PYTHON_SERVICE_URL}/options/relay/stock-quote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      }
    );

    if (!resp.ok) return staleResult(ticker);

    const data = await resp.json();
    const price = data.price ?? null;
    const close = data.close ?? null;
    const source =
      typeof data.source === "string" && data.source ? data.source : "unknown";
    const priceSource =
      typeof data.price_source === "string" && data.price_source
        ? data.price_source
        : null;
    const timestamp =
      typeof data.timestamp === "string" && data.timestamp
        ? data.timestamp
        : null;
    const lastTradeTs =
      typeof data.last_trade_ts === "string" && data.last_trade_ts
        ? data.last_trade_ts
        : null;
    const quoteTs =
      typeof data.quote_ts === "string" && data.quote_ts
        ? data.quote_ts
        : null;
    const minuteBarTs =
      typeof data.minute_bar_ts === "string" && data.minute_bar_ts
        ? data.minute_bar_ts
        : null;
    const snapshotUpdatedTs =
      typeof data.snapshot_updated_ts === "string" && data.snapshot_updated_ts
        ? data.snapshot_updated_ts
        : null;
    const freshnessTs =
      lastTradeTs ?? quoteTs ?? minuteBarTs ?? snapshotUpdatedTs ?? timestamp;
    const marketAgeSec = parseAgeSeconds(freshnessTs);
    const stale =
      price == null
        ? true
        : marketAgeSec != null
          ? marketAgeSec > staleThresholdSec(source, priceSource)
          : false;
    let change: number | null = null;
    let changePct: number | null = null;

    if (price != null && close != null && close > 0) {
      change = price - close;
      changePct = (change / close) * 100;
    }

    return {
      ticker,
      price,
      change,
      changePct,
      volume: data.volume ?? null,
      bid: data.bid ?? null,
      ask: data.ask ?? null,
      close,
      stale,
      source,
      priceSource,
      timestamp,
      lastTradeTs,
      quoteTs,
      minuteBarTs,
      snapshotUpdatedTs,
      marketAgeSec,
    };
  } catch {
    return staleResult(ticker);
  }
}

/** POST /api/watchlists/quotes — Batch fetch quotes for watchlist items */
export async function POST(request: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  let body: { items?: QuoteItem[] };
  try {
    body = await request.json();
  } catch (e) {
    console.error("[watchlist-quotes] JSON parse error:", e);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items: QuoteItem[] = body.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    console.warn("[watchlist-quotes] empty items array");
    return NextResponse.json(
      { error: "items array is required" },
      { status: 400 }
    );
  }

  console.log(
    `[watchlist-quotes] fetching ${items.length} quotes for user=${user.id}`,
  );

  // Cap at 50 items to avoid abuse
  const capped = items.slice(0, 50);

  // Process in chunks to avoid overwhelming the IB agent.
  // The agent processes requests sequentially — 18 concurrent requests cause
  // WebSocket disconnections. Chunking to 4 at a time keeps the agent stable.
  const quotes: QuoteResult[] = [];
  for (let i = 0; i < capped.length; i += MAX_CONCURRENT) {
    const chunk = capped.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      chunk.map((item) => fetchSingleQuote(item, user.id))
    );
    for (const r of results) {
      quotes.push(
        r.status === "fulfilled" ? r.value : staleResult("???")
      );
    }
  }

  const withPrice = quotes.filter((q) => q.price != null).length;
  console.log(
    `[watchlist-quotes] done: ${quotes.length} quotes, ${withPrice} with price`,
  );

  return NextResponse.json({ quotes });
}
