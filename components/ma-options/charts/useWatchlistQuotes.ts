"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface QuoteData {
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

export interface WatchlistItemForQuote {
  ticker: string;
  instrumentType?: string;
  exchange?: string | null;
}

const POLL_INTERVAL_MS = 4000;

/**
 * Polling hook for watchlist quotes.
 * - Polls every 4 seconds
 * - Skips when document.hidden
 * - Re-fetches on visibility change
 */
export function useWatchlistQuotes(items: WatchlistItemForQuote[]) {
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef(items);
  const isFetchingRef = useRef(false);
  itemsRef.current = items;

  const fetchQuotes = useCallback(async () => {
    // Guard: skip if a previous fetch is still in flight.
    // Without this, the 8s interval fires new batches while the previous
    // one is still waiting for slow/timed-out tickers — cascading load.
    if (isFetchingRef.current) return;

    const currentItems = itemsRef.current;
    if (currentItems.length === 0) {
      setQuotes(new Map());
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    try {
      const payload = {
        items: currentItems.map((i) => ({
          ticker: i.ticker,
          instrumentType: i.instrumentType || "stock",
          exchange: i.exchange || undefined,
        })),
      };

      const resp = await fetch("/api/watchlists/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        console.error(
          `[watchlist-quotes] fetch failed: ${resp.status} ${resp.statusText}`,
          await resp.text().catch(() => ""),
        );
        return;
      }

      const data = await resp.json();
      const newMap = new Map<string, QuoteData>();
      for (const q of data.quotes || []) {
        newMap.set(q.ticker, q);
      }
      if (newMap.size === 0 && currentItems.length > 0) {
        console.warn(
          "[watchlist-quotes] received 0 quotes for",
          currentItems.length,
          "items. Response:",
          JSON.stringify(data).slice(0, 500),
        );
      }
      setQuotes(newMap);
      setLastFetch(new Date());
    } catch (err) {
      console.error("[watchlist-quotes] error:", err);
      // Keep existing quotes on error
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Set up polling interval
  useEffect(() => {
    if (items.length === 0) {
      setQuotes(new Map());
      return;
    }

    // Initial fetch
    fetchQuotes();

    // Start polling
    intervalRef.current = setInterval(() => {
      if (!document.hidden) {
        fetchQuotes();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [items, fetchQuotes]);

  // Re-fetch on visibility change (tab comes back to foreground)
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && itemsRef.current.length > 0) {
        fetchQuotes();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchQuotes]);

  return { quotes, loading, lastFetch };
}
