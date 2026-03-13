"use client";

import type { MarketResponse, AssetRow } from "./types";
import { PRIMARY_TICKERS, SECTOR_TICKERS } from "./types";
import { InfoTip, CockpitTooltip } from "./CockpitTooltip";

// Oscillator types
interface TimescaleReading {
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
}

interface OscillatorData {
  tickers: Record<string, {
    timescales: Record<string, TimescaleReading>;
  }>;
  timescales_available: string[];
  _stale?: boolean;
}

function ReturnCell({ val }: { val: number | null }) {
  if (val == null) return <td className="px-2 py-1 text-right font-mono text-gray-600">—</td>;
  const pct = val * 100;
  const abs = Math.abs(pct);
  let color = "text-gray-400";
  if (pct > 0) {
    color = abs > 2 ? "text-green-300" : abs > 0.5 ? "text-green-400" : "text-green-500/70";
  } else if (pct < 0) {
    color = abs > 2 ? "text-red-300" : abs > 0.5 ? "text-red-400" : "text-red-500/70";
  }
  return (
    <td className={`px-2 py-1 text-right font-mono text-xs ${color}`}>
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </td>
  );
}

function SigmaCell({ val }: { val: number | null }) {
  if (val == null) return <td className="px-2 py-1 text-right font-mono text-gray-600">—</td>;
  const flagged = Math.abs(val) > 2;
  const color = flagged ? "text-amber-300" : Math.abs(val) > 1 ? "text-gray-300" : "text-gray-500";
  return (
    <td className={`px-2 py-1 text-right font-mono text-xs ${color}`}>
      {val > 0 ? "+" : ""}{val.toFixed(1)}σ {flagged ? "⚠" : ""}
    </td>
  );
}

// Oscillator state rendering
const STATE_CONFIG: Record<string, { sym: string; color: string; shortLabel: string }> = {
  overbought:    { sym: "▲▲", color: "text-red-400",    shortLabel: "OB" },
  trending_up:   { sym: "▲",  color: "text-green-400",  shortLabel: "TU" },
  neutral:       { sym: "→",  color: "text-gray-400",   shortLabel: "N"  },
  trending_down: { sym: "▼",  color: "text-red-400",    shortLabel: "TD" },
  oversold:      { sym: "▼▼", color: "text-green-400",  shortLabel: "OS" },
  insufficient:  { sym: "?",  color: "text-gray-600",   shortLabel: "?"  },
};

const CHARACTER_LABEL: Record<string, string> = {
  trending: "T",
  mean_reverting: "M",
  random: "R",
};

function OscCell({ reading }: { reading: TimescaleReading | undefined }) {
  if (!reading) return <td className="px-1.5 py-1 text-center font-mono text-[11px] text-gray-600">—</td>;

  const cfg = STATE_CONFIG[reading.state] ?? STATE_CONFIG.insufficient;
  const charLabel = CHARACTER_LABEL[reading.character] ?? "?";

  return (
    <td className="px-1.5 py-1 text-center">
      <CockpitTooltip content={`${reading.interpretation}\n\nHurst: ${reading.hurst} (${reading.character})\nz-score: ${reading.z_score.toFixed(1)} | percentile: ${reading.percentile.toFixed(0)}\nDominant cycle: ${reading.dominant_cycle.toFixed(0)} bars`}>
        <span className={`font-mono text-[11px] ${cfg.color}`}>
          {cfg.sym}{cfg.shortLabel}
        </span>
        <span className="text-[9px] text-gray-500 ml-0.5">{charLabel}</span>
      </CockpitTooltip>
    </td>
  );
}

type GroupKey = "primary" | "macro" | "sector";

function classifyGroup(ticker: string): GroupKey {
  if (PRIMARY_TICKERS.has(ticker)) return "primary";
  if (SECTOR_TICKERS.has(ticker)) return "sector";
  return "macro";
}

const GROUP_LABELS: Record<GroupKey, string> = {
  primary: "Primary Tickers (Traded)",
  macro: "Cross-Asset Context",
  sector: "Sector Breadth",
};

interface Props {
  market: MarketResponse | null;
  oscillators: OscillatorData | null;
  loading: boolean;
}

export function CrossAssetHeatmap({ market, oscillators, loading }: Props) {
  if (loading && !market) {
    return (
      <section className="rounded border border-gray-800 bg-gray-900 p-3">
        <div className="h-48 bg-gray-800 rounded animate-pulse flex items-center justify-center">
          <span className="text-xs text-gray-500">Loading market data…</span>
        </div>
      </section>
    );
  }

  const assets = market?.assets ?? [];
  const groups: Record<GroupKey, AssetRow[]> = { primary: [], macro: [], sector: [] };
  for (const a of assets) {
    groups[classifyGroup(a.ticker)].push(a);
  }

  const sectorAssets = groups.sector;
  const sectorsAbove = sectorAssets.filter((s) => (s.return20d ?? 0) > 0).length;

  const hasOsc = oscillators && Object.keys(oscillators.tickers || {}).length > 0;
  const timescales = oscillators?.timescales_available ?? ["monthly", "weekly", "daily"];
  const tsLabels: Record<string, string> = { monthly: "Mo", weekly: "Wk", daily: "Dy" };

  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-300">
          Cross-Asset Heatmap
          <InfoTip tip="Returns, vol-normalized moves, and multi-timescale trend oscillators. Oscillator states: OB=Overbought, TU=Trending Up, N=Neutral, TD=Trending Down, OS=Oversold. Character: T=Trending, M=Mean-Reverting, R=Random." />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          {oscillators?._stale && <span className="text-amber-400">Oscillators stale</span>}
          {market?.asOf ? new Date(market.asOf).toLocaleTimeString() : ""}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] text-gray-500 uppercase">
            <tr className="border-b border-gray-800">
              <th className="text-left px-2 py-1.5">Symbol</th>
              <th className="text-right px-2 py-1.5">Price</th>
              <th className="text-right px-2 py-1.5">Δ1d</th>
              <th className="text-right px-2 py-1.5">Δ5d</th>
              <th className="text-right px-2 py-1.5">Δ20d</th>
              <th className="text-right px-2 py-1.5">
                σ <InfoTip tip="Today's move in units of 20-day realized vol" />
              </th>
              {hasOsc && timescales.map((ts) => (
                <th key={ts} className="text-center px-1.5 py-1.5 border-l border-gray-800/30">
                  {tsLabels[ts] ?? ts}
                  <InfoTip tip={`${ts} oscillator. Ehlers cycle-adaptive with Hurst regime classification. Hover cells for details.`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["primary", "macro", "sector"] as const).map((group) => {
              const rows = groups[group];
              if (!rows || rows.length === 0) return null;
              const colSpan = 6 + (hasOsc ? timescales.length : 0);
              return [
                <tr key={`label-${group}`} className="border-b border-gray-800/50">
                  <td colSpan={colSpan} className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider bg-gray-900/50">
                    {GROUP_LABELS[group]}
                  </td>
                </tr>,
                ...rows.map((row) => {
                  const flagged = row.volNormMove != null && Math.abs(row.volNormMove) > 2;
                  const tickerOsc = oscillators?.tickers?.[row.ticker];
                  return (
                    <tr
                      key={row.ticker}
                      className={`border-b border-gray-800/40 hover:bg-gray-800/40 ${
                        group === "primary" ? "bg-gray-800/10" : ""
                      }`}
                    >
                      <td className="px-2 py-1" title={row.tooltip}>
                        <span className={`font-mono text-xs ${group === "primary" ? "text-cyan-300" : "text-gray-300"}`}>
                          {row.ticker}
                        </span>
                        <span className="text-[11px] text-gray-400 ml-1.5">{row.name}</span>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">
                        {row.price != null ? row.price.toFixed(2) : "—"}
                      </td>
                      <ReturnCell val={row.return1d} />
                      <ReturnCell val={row.return5d} />
                      <ReturnCell val={row.return20d} />
                      <SigmaCell val={row.volNormMove} />
                      {hasOsc && timescales.map((ts) => (
                        <OscCell
                          key={ts}
                          reading={tickerOsc?.timescales?.[ts] as TimescaleReading | undefined}
                        />
                      ))}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-gray-800/50 text-[11px] text-gray-400 flex items-center gap-4 flex-wrap">
        <span>
          Sector breadth: {sectorsAbove}/{sectorAssets.length} positive over 20d
          <InfoTip tip="Sectors with positive 20-day returns. High = broad participation, Low = narrow rally." />
        </span>
        {hasOsc && (
          <span>
            Oscillator: Ehlers adaptive cycle + Hurst regime
            <InfoTip tip="T=Trending (Hurst>0.55, moves tend to continue), M=Mean-Reverting (Hurst<0.45, moves tend to reverse), R=Random. OB in T context = trend may extend. OS in M context = bounce likely." />
          </span>
        )}
      </div>
    </section>
  );
}
