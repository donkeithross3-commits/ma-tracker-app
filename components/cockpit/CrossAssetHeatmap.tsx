"use client";

import type { MarketResponse, AssetRow } from "./types";
import { PRIMARY_TICKERS, SECTOR_TICKERS } from "./types";
import { InfoTip } from "./CockpitTooltip";

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
  loading: boolean;
}

export function CrossAssetHeatmap({ market, loading }: Props) {
  if (loading && !market) {
    return (
      <section className="rounded border border-gray-800 bg-gray-900 p-3 animate-pulse">
        <div className="h-48 bg-gray-800 rounded" />
      </section>
    );
  }

  const assets = market?.assets ?? [];
  const groups: Record<GroupKey, AssetRow[]> = { primary: [], macro: [], sector: [] };
  for (const a of assets) {
    groups[classifyGroup(a.ticker)].push(a);
  }

  // Sector breadth: count sectors above 20d MA (return20d > 0 as proxy)
  const sectorAssets = groups.sector;
  const sectorsAbove = sectorAssets.filter((s) => (s.return20d ?? 0) > 0).length;

  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-300">
          Cross-Asset Heatmap
          <InfoTip tip="Returns and vol-normalized moves for key symbols. Outliers (>2σ) flagged. Primary tickers are what we trade; cross-asset provides regime context." />
        </div>
        <div className="text-[10px] text-gray-500">
          {market?.asOf ? new Date(market.asOf).toLocaleTimeString() : ""}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] text-gray-500 uppercase">
            <tr className="border-b border-gray-800">
              <th className="text-left px-2 py-1.5">Symbol</th>
              <th className="text-right px-2 py-1.5">Price</th>
              <th className="text-right px-2 py-1.5">
                Δ1d <InfoTip tip="1-day return (close to close)" />
              </th>
              <th className="text-right px-2 py-1.5">
                Δ5d <InfoTip tip="5-day return (1 trading week)" />
              </th>
              <th className="text-right px-2 py-1.5">
                Δ20d <InfoTip tip="20-day return (~1 calendar month)" />
              </th>
              <th className="text-right px-2 py-1.5">
                σ <InfoTip tip="Today's move in units of 20-day realized volatility. >2σ is an outlier." />
              </th>
              <th className="text-center px-2 py-1.5">Flag</th>
            </tr>
          </thead>
          <tbody>
            {(["primary", "macro", "sector"] as const).map((group) => {
              const rows = groups[group];
              if (!rows || rows.length === 0) return null;
              return [
                <tr key={`label-${group}`} className="border-b border-gray-800/50">
                  <td colSpan={7} className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider bg-gray-900/50">
                    {GROUP_LABELS[group]}
                  </td>
                </tr>,
                ...rows.map((row) => {
                  const flagged = row.volNormMove != null && Math.abs(row.volNormMove) > 2;
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
                        <span className="text-[10px] text-gray-600 ml-1.5 hidden sm:inline">{row.name}</span>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">
                        {row.price != null ? row.price.toFixed(2) : "—"}
                      </td>
                      <ReturnCell val={row.return1d} />
                      <ReturnCell val={row.return5d} />
                      <ReturnCell val={row.return20d} />
                      <SigmaCell val={row.volNormMove} />
                      <td className="px-2 py-1 text-center text-xs">
                        {flagged ? <span className="text-amber-400">⚠</span> : ""}
                      </td>
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
      </div>
    </section>
  );
}
