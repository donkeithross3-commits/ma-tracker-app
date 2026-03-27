"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SummaryResponse, BurnRateResponse, SessionsResponse, EfficiencyResponse } from "./types";

export type AIUsageData = {
  summary: SummaryResponse | null;
  burnRate: BurnRateResponse | null;
  sessions: SessionsResponse | null;
  efficiency: EfficiencyResponse | null;
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  refresh: () => void;
};

export function useAIUsageData(days: number): AIUsageData {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [burnRate, setBurnRate] = useState<BurnRateResponse | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [efficiency, setEfficiency] = useState<EfficiencyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Promise.allSettled — one slow endpoint doesn't block others (Fleet pattern)
      const results = await Promise.allSettled([
        fetch(`/api/ai-usage/summary?days=${days}`, { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`summary: ${r.status}`))
        ),
        fetch("/api/ai-usage/burn-rate", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`burn-rate: ${r.status}`))
        ),
        fetch(`/api/ai-usage/sessions?days=${days}&limit=100`, { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`sessions: ${r.status}`))
        ),
        fetch(`/api/ai-usage/efficiency?days=${days}`, { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`efficiency: ${r.status}`))
        ),
      ]);

      if (results[0].status === "fulfilled") setSummary(results[0].value);
      if (results[1].status === "fulfilled") setBurnRate(results[1].value);
      if (results[2].status === "fulfilled") setSessions(results[2].value);
      if (results[3].status === "fulfilled") setEfficiency(results[3].value);

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0 && failures.length < 4) {
        setError(`${failures.length} data source(s) unavailable`);
      } else if (failures.length === 4) {
        setError("Failed to fetch AI usage data");
      } else {
        setError(null);
      }

      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    pollRef.current = setInterval(() => {
      if (!document.hidden) fetchData();
    }, 60_000);

    const handleVisibility = () => {
      if (!document.hidden) fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData]);

  return { summary, burnRate, sessions, efficiency, loading, error, lastSync, refresh: fetchData };
}
