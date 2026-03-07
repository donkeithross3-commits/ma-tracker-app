"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MacroRegimeStrip } from "@/components/cockpit/MacroRegimeStrip";
import { CrossAssetHeatmap } from "@/components/cockpit/CrossAssetHeatmap";
import { MicrostructurePanel } from "@/components/cockpit/MicrostructurePanel";
import { DataHealthPanel } from "@/components/cockpit/DataHealthPanel";
import type {
  MacroResponse,
  MarketResponse,
  RegimeResponse,
  DataHealthResponse,
} from "@/components/cockpit/types";

// Oscillator data shape (from py_proj cockpit_oscillators.py)
interface OscillatorData {
  tickers: Record<string, {
    timescales: Record<string, {
      timescale: string;
      label: string;
      state: string;
      character: string;
      hurst: number;
      z_score: number;
      percentile: number;
      displacement: number;
      dominant_cycle: number;
      interpretation: string;
    }>;
  }>;
  timescales_available: string[];
  _stale?: boolean;
}

// Refresh intervals (ms)
const MACRO_INTERVAL = 5 * 60 * 1000; // 5 min
const MARKET_INTERVAL = 60 * 1000; // 1 min
const HEALTH_INTERVAL = 2 * 60 * 1000; // 2 min
const OSC_INTERVAL = 10 * 60 * 1000; // 10 min (pre-computed, changes infrequently)

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function CockpitPage() {
  const [macro, setMacro] = useState<MacroResponse | null>(null);
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [regime, setRegime] = useState<RegimeResponse | null>(null);
  const [health, setHealth] = useState<DataHealthResponse | null>(null);
  const [oscillators, setOscillators] = useState<OscillatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchAll = useCallback(async () => {
    try {
      const [m, mkt, r, h, osc] = await Promise.all([
        safeFetch<MacroResponse>("/api/cockpit/macro"),
        safeFetch<MarketResponse>("/api/cockpit/market"),
        safeFetch<RegimeResponse>("/api/cockpit/regime"),
        safeFetch<DataHealthResponse>("/api/cockpit/data-health"),
        safeFetch<OscillatorData>("/api/cockpit/oscillators"),
      ]);
      setMacro(m);
      setMarket(mkt);
      setRegime(r);
      setHealth(h);
      setOscillators(osc);
      setLastRefresh(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cockpit data");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMarket = useCallback(async () => {
    const mkt = await safeFetch<MarketResponse>("/api/cockpit/market");
    if (mkt) {
      setMarket(mkt);
      setLastRefresh(new Date().toLocaleTimeString());
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    const h = await safeFetch<DataHealthResponse>("/api/cockpit/data-health");
    if (h) setHealth(h);
  }, []);

  const fetchOscillators = useCallback(async () => {
    const osc = await safeFetch<OscillatorData>("/api/cockpit/oscillators");
    if (osc) setOscillators(osc);
  }, []);

  useEffect(() => {
    fetchAll();

    const macroTimer = setInterval(fetchAll, MACRO_INTERVAL);
    const marketTimer = setInterval(fetchMarket, MARKET_INTERVAL);
    const healthTimer = setInterval(fetchHealth, HEALTH_INTERVAL);
    const oscTimer = setInterval(fetchOscillators, OSC_INTERVAL);

    // Refresh on tab focus (skip ticks when hidden per CLAUDE.md)
    const handleVisibility = () => {
      if (!document.hidden) fetchAll();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(macroTimer);
      clearInterval(marketTimer);
      clearInterval(healthTimer);
      clearInterval(oscTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchAll, fetchMarket, fetchHealth, fetchOscillators]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DR3 Cockpit</h1>
            <p className="text-[10px] text-gray-500">
              Liquidity, regime & data health — pre-market briefing + live monitoring
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">
              {lastRefresh ? `Updated ${lastRefresh}` : ""}
            </span>
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
            <button
              onClick={fetchAll}
              className="text-sm px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {error && (
          <div className="rounded border border-red-600/40 bg-red-950/40 text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Panel 1: Macro Regime Strip */}
        <MacroRegimeStrip
          macro={macro}
          market={market ? { vix: market.vix } : null}
          regime={regime}
          loading={loading}
        />

        {/* Panel 2: Cross-Asset Heatmap */}
        <CrossAssetHeatmap market={market} oscillators={oscillators} loading={loading} />

        {/* Panel 3: Microstructure (placeholder) */}
        <MicrostructurePanel />

        {/* Panel 4: Data Health & Pipeline */}
        <DataHealthPanel health={health} loading={loading} />
      </main>
    </div>
  );
}
