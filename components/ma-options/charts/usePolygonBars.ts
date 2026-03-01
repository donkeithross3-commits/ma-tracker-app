"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartBar, TimeframeConfig } from "./types";

const POLL_INTERVAL_MS = 30_000; // 30s bar refresh

/** Format date as YYYY-MM-DD for Polygon */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Compute date range based on timeframe */
function getDateRange(tf: TimeframeConfig): { from: string; to: string } {
  const now = new Date();
  const to = formatDate(now);

  let from: Date;
  if (tf.timespan === "day") {
    // 6 months for daily
    from = new Date(now);
    from.setMonth(from.getMonth() - 6);
  } else if (tf.timespan === "hour") {
    // 10 days for hourly
    from = new Date(now);
    from.setDate(from.getDate() - 10);
  } else {
    // 1 day for minute bars (incl today)
    from = new Date(now);
    from.setDate(from.getDate() - 1);
  }

  return { from: formatDate(from), to };
}

interface UsePolygonBarsOptions {
  multiplier: number;
  timespan: "minute" | "hour" | "day";
}

interface UsePolygonBarsResult {
  bars: ChartBar[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePolygonBars(
  ticker: string,
  { multiplier, timespan }: UsePolygonBarsOptions
): UsePolygonBarsResult {
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastBarTimeRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBars = useCallback(
    async (isAppend = false) => {
      if (document.hidden) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!isAppend) setLoading(true);

        const tf: TimeframeConfig = { multiplier, timespan, label: "" };
        const range = getDateRange(tf);

        // For append polls, only fetch from last bar time
        const from = isAppend && lastBarTimeRef.current > 0
          ? new Date(lastBarTimeRef.current * 1000).toISOString().split("T")[0]
          : range.from;

        const params = new URLSearchParams({
          ticker,
          multiplier: String(multiplier),
          timespan,
          from,
          to: range.to,
          limit: "5000",
        });

        const res = await fetch(`/api/ma-options/polygon/bars?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const newBars: ChartBar[] = data.bars || [];

        if (isAppend && newBars.length > 0) {
          // Merge: update last bar if same timestamp, append new ones
          setBars((prev) => {
            const merged = [...prev];
            for (const bar of newBars) {
              const idx = merged.findIndex((b) => b.time === bar.time);
              if (idx >= 0) {
                merged[idx] = bar; // Update existing bar
              } else {
                merged.push(bar); // Append new bar
              }
            }
            merged.sort((a, b) => a.time - b.time);
            return merged;
          });
        } else {
          setBars(newBars);
        }

        // Track last bar time for incremental polls
        if (newBars.length > 0) {
          lastBarTimeRef.current = newBars[newBars.length - 1].time;
        }

        setError(null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!isAppend) {
          setError(err instanceof Error ? err.message : "Failed to fetch bars");
        }
      } finally {
        if (!isAppend) setLoading(false);
      }
    },
    [ticker, multiplier, timespan]
  );

  // Initial fetch + poll
  useEffect(() => {
    // Reset on ticker/timeframe change
    setBars([]);
    lastBarTimeRef.current = 0;
    setError(null);

    fetchBars(false);

    pollRef.current = setInterval(() => fetchBars(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      abortRef.current?.abort();
    };
  }, [fetchBars]);

  return { bars, loading, error, refetch: () => fetchBars(false) };
}
