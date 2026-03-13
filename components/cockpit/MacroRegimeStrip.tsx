"use client";

import type { MacroResponse, RegimeResponse, ApiMetricPoint } from "./types";
import { volRegimeColor, regimeColor } from "./types";
import { InfoTip } from "./CockpitTooltip";

function Delta({ val, unit = "", precision = 2 }: { val: number | null; unit?: string; precision?: number }) {
  if (val == null) return <span className="text-gray-600">—</span>;
  const arrow = val > 0.0001 ? "▲" : val < -0.0001 ? "▼" : "→";
  const color = val > 0.0001 ? "text-green-400" : val < -0.0001 ? "text-red-400" : "text-gray-400";
  return (
    <span className={`${color} text-[11px] ml-1`}>
      {arrow}{Math.abs(val).toFixed(precision)}{unit}
    </span>
  );
}

function MetricCell({
  label,
  mp,
  unit,
  precision = 2,
  multiplier = 1,
}: {
  label: string;
  mp: ApiMetricPoint | undefined;
  unit?: string;
  precision?: number;
  multiplier?: number;
}) {
  const value = mp?.value != null ? mp.value * multiplier : null;
  const d1 = mp?.delta1d != null ? mp.delta1d * multiplier : null;
  const tooltip = mp?.tooltip ?? "";
  return (
    <div className="px-2 py-1">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
        {label}
        <InfoTip tip={tooltip} />
      </div>
      <div className="text-sm font-mono text-gray-100">
        {value != null ? value.toFixed(precision) : "—"}
        {unit && <span className="text-gray-500 text-xs ml-0.5">{unit}</span>}
        <Delta val={d1} precision={precision} />
      </div>
    </div>
  );
}

function RegimePill({ label, state, color }: { label: string; state: string; color: "green" | "yellow" | "red" }) {
  const colorMap = {
    green: "bg-green-500/20 text-green-400 border-green-500/30",
    yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    red: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${colorMap[color]}`}>
      {label}: {state}
    </span>
  );
}

interface Props {
  macro: MacroResponse | null;
  market: { vix: ApiMetricPoint } | null;
  regime: RegimeResponse | null;
  loading: boolean;
}

export function MacroRegimeStrip({ macro, market, regime, loading }: Props) {
  if (loading && !macro && !regime) {
    return (
      <section className="rounded border border-gray-800 bg-gray-900 p-3">
        <div className="h-24 bg-gray-800 rounded animate-pulse flex items-center justify-center">
          <span className="text-xs text-gray-500">Loading macro data…</span>
        </div>
      </section>
    );
  }

  const vix = market?.vix;
  const twoTen = macro?.yieldCurve.spreads.twoTen;

  // Build regime pills
  const pills = regime
    ? [
        { label: "Vol", state: regime.vol.value, color: volRegimeColor(regime.vol.value), tip: regime.vol.tooltip },
        { label: "Liquidity", state: regime.liquidity.value, color: regimeColor(regime.liquidity.value), tip: regime.liquidity.tooltip },
        { label: "Trend", state: regime.trend.value, color: regimeColor(regime.trend.value), tip: regime.trend.tooltip },
        { label: "Correlation", state: regime.correlation.value, color: regimeColor(regime.correlation.value), tip: regime.correlation.tooltip },
      ]
    : null;

  // Model context based on regime
  let modelContext = "";
  if (regime) {
    const vixVal = vix?.value;
    if (vixVal != null) {
      if (vixVal >= 15) modelContext = `VIX ${vixVal.toFixed(1)} — in model training range. Dollar bars active.`;
      else modelContext = `VIX ${vixVal.toFixed(1)} — below model threshold (VIX<15 dead zone).`;
    }
  }

  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      {/* Regime pills row */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {pills
            ? pills.map((p) => (
                <span key={p.label} title={p.tip}>
                  <RegimePill label={p.label} state={p.state} color={p.color as "green" | "yellow" | "red"} />
                </span>
              ))
            : ["Vol", "Liquidity", "Trend", "Correlation"].map((l) => (
                <RegimePill key={l} label={l} state="—" color="yellow" />
              ))}
        </div>
        <div className="text-[10px] text-gray-500">
          {macro?.asOf ? `Data: ${new Date(macro.asOf).toLocaleDateString()}` : ""}
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 divide-x divide-gray-800/50">
        {/* VIX */}
        <div className="px-2 py-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
            VIX
            <InfoTip tip="CBOE Volatility Index — market's expectation of 30-day forward vol. Our model works best when VIX >= 15." />
          </div>
          <div className="text-sm font-mono text-gray-100">
            {vix?.value != null ? vix.value.toFixed(1) : "—"}
            <Delta val={vix?.delta1d ?? null} precision={1} />
          </div>
        </div>

        {/* Yields */}
        <MetricCell label="3M" mp={macro?.yieldCurve.rates.DGS3MO} unit="%" />
        <MetricCell label="2Y" mp={macro?.yieldCurve.rates.DGS2} unit="%" />
        <MetricCell label="10Y" mp={macro?.yieldCurve.rates.DGS10} unit="%" />
        <MetricCell label="30Y" mp={macro?.yieldCurve.rates.DGS30} unit="%" />

        {/* Curve spreads — stored as percentage points, display as bp */}
        <MetricCell label="2s10s" mp={twoTen} unit="%" precision={2} />

        {/* Credit */}
        <MetricCell label="HY OAS" mp={macro?.credit.hyOas} precision={0} />

        {/* Dollar */}
        <MetricCell label="DXY" mp={macro?.dollar.tradeWeighted} precision={1} />
      </div>

      {/* Rate of change of steepness + stress + model context */}
      <div className="px-3 py-1.5 border-t border-gray-800/50 flex items-center gap-4 text-[11px] text-gray-400 flex-wrap">
        <span>
          2s10s Δ5d: <Delta val={twoTen?.delta5d ?? null} precision={3} />
        </span>
        <span>
          2s10s Δ20d: <Delta val={twoTen?.delta20d ?? null} precision={3} />
        </span>
        <span>
          Stress: {macro?.stress.stlfsi.value != null ? macro.stress.stlfsi.value.toFixed(2) : "—"}
          <InfoTip tip={macro?.stress.stlfsi.tooltip ?? "St. Louis Financial Stress Index. 0 = normal, >1 = above-average stress."} />
          <Delta val={macro?.stress.stlfsi.delta1d ?? null} />
        </span>
        {modelContext && (
          <span className="ml-auto text-gray-500 italic">{modelContext}</span>
        )}
      </div>
    </section>
  );
}
