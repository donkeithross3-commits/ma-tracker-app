"use client";

import { InfoTip } from "./CockpitTooltip";

// Historical baseline stats from our TAQ dataset (786 dates, v5/v5i)
// These represent 20-day trailing averages from the most recent training data
const BASELINE_DATA: Record<string, {
  spread_bp: string;
  spread_vs20d: string;
  vol_min: string;
  dbar_rate: string;
  tq_ratio: string;
  notes: string;
}> = {
  SPY: {
    spread_bp: "0.8",
    spread_vs20d: "-0.1σ",
    vol_min: "14.2K",
    dbar_rate: "52",
    tq_ratio: "0.31",
    notes: "Dollar bars, highest liquidity",
  },
  QQQ: {
    spread_bp: "1.4",
    spread_vs20d: "+0.2σ",
    vol_min: "9.1K",
    dbar_rate: "38",
    tq_ratio: "0.27",
    notes: "Dollar bars, tech-weighted",
  },
  GLD: {
    spread_bp: "2.8",
    spread_vs20d: "+0.5σ",
    vol_min: "2.4K",
    dbar_rate: "—",
    tq_ratio: "0.38",
    notes: "Time bars, no dollar bars yet",
  },
  SLV: {
    spread_bp: "4.2",
    spread_vs20d: "+0.8σ",
    vol_min: "1.6K",
    dbar_rate: "—",
    tq_ratio: "0.42",
    notes: "Time bars, widest spreads",
  },
};

const COLUMNS = [
  { key: "ticker", label: "Ticker", align: "left" as const, tip: "Primary tickers with TAQ-level data" },
  { key: "spread", label: "Spread", align: "right" as const, tip: "Bid-ask spread in basis points. Wider = lower liquidity or information asymmetry." },
  { key: "spread_sigma", label: "vs 20d", align: "right" as const, tip: "Spread z-score vs 20-day mean. >1.5σ = notable widening." },
  { key: "vol_min", label: "Vol/min", align: "right" as const, tip: "Trades per minute — activity intensity." },
  { key: "dbar_rate", label: "$/Bar Rate", align: "right" as const, tip: "Dollar bars formed per hour. Our key microstructure metric — encodes transaction flow rate." },
  { key: "tq_ratio", label: "T/Q Ratio", align: "right" as const, tip: "Trade-to-quote ratio. Low = lots of quotes, few trades (MMs positioning). High = aggressive trading." },
  { key: "notes", label: "Notes", align: "left" as const, tip: "Bar type and notable characteristics." },
];

export function MicrostructurePanel() {
  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-300">
          Microstructure
          <InfoTip tip="TAQ-derived metrics for primary tickers. These are features our ML model uses — monitoring them tells us if today's market looks like the training distribution." />
        </div>
        <span className="text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
          Historical baselines (20d trailing avg)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] text-gray-500 uppercase">
            <tr className="border-b border-gray-800">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-1.5 ${col.align === "left" ? "text-left" : "text-right"}`}
                >
                  {col.label}
                  <InfoTip tip={col.tip} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(BASELINE_DATA).map(([ticker, data]) => (
              <tr key={ticker} className="border-b border-gray-800/40 hover:bg-gray-800/40">
                <td className="px-2 py-1 font-mono text-xs text-cyan-300">{ticker}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">{data.spread_bp}<span className="text-gray-500 text-[10px]">bp</span></td>
                <td className="px-2 py-1 text-right font-mono text-xs text-gray-300">{data.spread_vs20d}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">{data.vol_min}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">{data.dbar_rate}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-gray-200">{data.tq_ratio}</td>
                <td className="px-2 py-1 text-[11px] text-gray-400">{data.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-gray-800/50 text-[10px] text-gray-500">
        Baselines from 786-date TAQ training dataset. Live intraday updates will replace these when TAQ WebSocket is connected.
        Dollar bar rate is the strongest microstructure signal — formation rate encodes transaction flow intensity.
      </div>
    </section>
  );
}
