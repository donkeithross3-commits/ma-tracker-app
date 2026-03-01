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
}

/** POST /api/watchlists/quotes — Batch fetch quotes for watchlist items */
export async function POST(request: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const body = await request.json();
  const items: QuoteItem[] = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "items array is required" },
      { status: 400 }
    );
  }

  // Cap at 50 items to avoid abuse
  const capped = items.slice(0, 50);

  const results = await Promise.allSettled(
    capped.map(async (item): Promise<QuoteResult> => {
      const ticker = item.ticker.toUpperCase();

      // Build payload for stock-quote relay
      const payload: Record<string, string> = {
        ticker,
        userId: user.id,
      };

      // Map instrument types to IB contract params
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
          }
        );

        if (!resp.ok) {
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
            source: "error",
          };
        }

        const data = await resp.json();
        const price = data.price ?? null;
        const close = data.close ?? null;
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
          stale: price == null,
          source: "ib",
        };
      } catch {
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
          source: "error",
        };
      }
    })
  );

  const quotes: QuoteResult[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          ticker: "???",
          price: null,
          change: null,
          changePct: null,
          volume: null,
          bid: null,
          ask: null,
          close: null,
          stale: true,
          source: "error",
        }
  );

  return NextResponse.json({ quotes });
}
