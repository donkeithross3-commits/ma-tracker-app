"use client";

import { InfoTip } from "./CockpitTooltip";

const TICKERS = ["SPY", "QQQ", "GLD", "SLV"];

const COLUMNS = [
  { key: "ticker", label: "Ticker", tip: "Primary tickers with TAQ-level data" },
  { key: "spread", label: "Spread", tip: "Bid-ask spread vs 20-day baseline. Wider spreads = lower liquidity or information asymmetry." },
  { key: "spread_sigma", label: "vs 20d", tip: "Spread in standard deviations vs 20-day mean. >1.5σ = notable widening." },
  { key: "vol_min", label: "Vol/min", tip: "Trades per minute — measures activity intensity." },
  { key: "dbar_rate", label: "$/Bar Rate", tip: "Dollar bars formed per hour. Our key microstructure metric — encodes transaction flow rate." },
  { key: "tq_ratio", label: "T/Q Ratio", tip: "Trade-to-quote ratio. Low ratio = lots of quotes but few trades (market makers positioning). High = aggressive trading." },
  { key: "feat_shift", label: "Feat Shift", tip: "KS-test of today's feature distributions vs training set. 'SHIFT' means today looks different from what the model trained on." },
];

export function MicrostructurePanel() {
  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-300">
          Microstructure
          <InfoTip tip="TAQ-derived intraday metrics for primary tickers. These are the features our ML model uses — monitoring them tells us if today's market looks like the training distribution." />
        </div>
        <span className="text-[10px] text-amber-400/70 bg-amber-500/10 px-2 py-0.5 rounded">
          Live TAQ feed required
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] text-gray-500 uppercase">
            <tr className="border-b border-gray-800">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-1.5 ${col.key === "ticker" ? "text-left" : "text-right"}`}
                >
                  {col.label}
                  <InfoTip tip={col.tip} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TICKERS.map((ticker) => (
              <tr key={ticker} className="border-b border-gray-800/40">
                <td className="px-2 py-1 font-mono text-xs text-cyan-300">{ticker}</td>
                {Array.from({ length: 6 }).map((_, i) => (
                  <td key={i} className="px-2 py-1 text-right font-mono text-xs text-gray-600">
                    —
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t border-gray-800/50 text-[10px] text-gray-500">
        Requires live TAQ WebSocket connection. Dollar bar formation rate and feature shift detection will populate when the data pipeline is streaming.
      </div>
    </section>
  );
}
