"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartBar } from "./types";

const POLL_INTERVAL_MS = 30_000; // 30s bar refresh

// ---------------------------------------------------------------------------
// Map Polygon-style timeframe to IB duration/barSize
// ---------------------------------------------------------------------------

function getIBParams(
  multiplier: number,
  timespan: "minute" | "hour" | "day"
): { duration: string; barSize: string } {
  if (timespan === "day") return { duration: "1 Y", barSize: "1 day" };
  if (timespan === "hour") return { duration: "1 M", barSize: "1 hour" };
  // minute
  if (multiplier <= 1) return { duration: "1 D", barSize: "1 min" };
  if (multiplier <= 5) return { duration: "5 D", barSize: "5 mins" };
  return { duration: "10 D", barSize: "15 mins" };
}

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

interface UseIBBarsOptions {
  secType: string;
  exchange: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
  enabled?: boolean; // default true — set false to skip fetching (React hooks rules)
}

interface UseIBBarsResult {
  bars: ChartBar[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIBBars(
  ticker: string,
  { secType, exchange, multiplier, timespan, enabled = true }: UseIBBarsOptions
): UseIBBarsResult {
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastBarTimeRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBars = useCallback(
    async (isAppend = false) => {
      if (!enabled) return;
      if (document.hidden) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!isAppend) setLoading(true);

        const { duration, barSize } = getIBParams(multiplier, timespan);

        const params = new URLSearchParams({
          ticker,
          secType,
          exchange,
          duration,
          barSize,
        });

        const res = await fetch(`/api/ma-options/ib/bars?${params}`, {
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
                merged[idx] = bar;
              } else {
                merged.push(bar);
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
    [ticker, secType, exchange, multiplier, timespan, enabled]
  );

  // Initial fetch + poll
  useEffect(() => {
    if (!enabled) {
      setBars([]);
      setLoading(false);
      setError(null);
      return;
    }

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
  }, [fetchBars, enabled]);

  return { bars, loading, error, refetch: () => fetchBars(false) };
}
