"use client";

import { useCallback, useEffect, useState } from "react";

import ChartWidget from "./ChartWidget";
import WidgetContainer from "./WidgetContainer";
import SignalPanel from "./SignalPanel";
import PositionsPanel from "./PositionsPanel";
import { usePolygonBars } from "./usePolygonBars";
import { useIBBars } from "./useIBBars";
import { useChartSignals } from "./useChartSignals";
import {
  TIMEFRAMES,
  type ChartWidgetConfig,
  type OverlayToggles,
} from "./types";

// ---------------------------------------------------------------------------
// Futures auto-detection — known futures symbols + exchange mapping
// ---------------------------------------------------------------------------

const FUTURES_SYMBOLS = new Set([
  "ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM",
  "CL", "NG", "RB", "HO", "MCL",
  "GC", "SI", "HG", "SIL", "MGC",
  "ZB", "ZN", "ZF", "ZT", "UB",
  "ZC", "ZS", "ZW", "ZM", "ZL",
  "6E", "6J", "6B", "6A", "6C", "6S",
  "PL", "PA",
]);

const FUTURES_EXCHANGE: Record<string, string> = {
  SI: "COMEX", GC: "COMEX", HG: "COMEX", SIL: "COMEX", MGC: "COMEX",
  PL: "NYMEX", PA: "NYMEX",
  CL: "NYMEX", NG: "NYMEX", RB: "NYMEX", HO: "NYMEX", MCL: "NYMEX",
  ES: "CME", NQ: "CME", RTY: "CME", MES: "CME", MNQ: "CME", M2K: "CME", EMD: "CME",
  YM: "CBOT", MYM: "CBOT",
  ZB: "CBOT", ZN: "CBOT", ZF: "CBOT", ZT: "CBOT",
  "6E": "CME", "6J": "CME", "6A": "CME", "6B": "CME", "6C": "CME",
  ZC: "CBOT", ZS: "CBOT", ZW: "CBOT", ZM: "CBOT", ZL: "CBOT",
};

// IB futures month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun
//                         N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
const FUTURES_MONTH_CODES: Record<string, string> = {
  F: "01", G: "02", H: "03", J: "04", K: "05", M: "06",
  N: "07", Q: "08", U: "09", V: "10", X: "11", Z: "12",
};

// Regex: root symbol + month code letter + 1-2 year digits (e.g. ESH6, NQM26, CLZ25)
const FUTURES_CONTRACT_RE = /^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$/;

/**
 * Extract the base futures symbol and optional contract month from a ticker.
 * "ESH6"  → { base: "ES", contractMonth: "202603" }
 * "NQM26" → { base: "NQ", contractMonth: "202606" }
 * "ES"    → { base: "ES", contractMonth: null }  (bare root = continuous)
 * "AAPL"  → { base: "AAPL", contractMonth: null }
 */
function parseFuturesTicker(ticker: string): {
  base: string;
  contractMonth: string | null;
} {
  const m = FUTURES_CONTRACT_RE.exec(ticker);
  if (m) {
    const [, base, monthCode, yearDigits] = m;
    // Only treat as futures contract if the base is a known futures symbol
    if (FUTURES_SYMBOLS.has(base)) {
      const month = FUTURES_MONTH_CODES[monthCode];
      // Convert 1-2 digit year: "6" → "2026", "26" → "2026", "5" → "2025"
      const year =
        yearDigits.length === 1
          ? `202${yearDigits}`
          : yearDigits.length === 2
            ? `20${yearDigits}`
            : yearDigits;
      return { base, contractMonth: `${year}${month}` };
    }
  }
  return { base: ticker, contractMonth: null };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChartWidgetInstanceProps {
  config: ChartWidgetConfig;
  overlayToggles: OverlayToggles;
  onConfigChange: (id: string, partial: Partial<ChartWidgetConfig>) => void;
  onRemove?: () => void;
}

// ---------------------------------------------------------------------------
// Shared inline ticker input
// ---------------------------------------------------------------------------

function InlineTickerInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (ticker: string) => void;
}) {
  const [input, setInput] = useState(value);

  const handleSubmit = useCallback(() => {
    const clean = input.trim().toUpperCase();
    if (/^[A-Z0-9]{1,10}$/.test(clean) && clean !== value) {
      onChange(clean);
    } else {
      setInput(value); // Reset on invalid input
    }
  }, [input, value, onChange]);

  // Sync when external value changes (e.g., preset load)
  useEffect(() => {
    setInput(value);
  }, [value]);

  return (
    <input
      type="text"
      value={input}
      onChange={(e) => setInput(e.target.value.toUpperCase())}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSubmit();
      }}
      onBlur={handleSubmit}
      className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0 text-xs text-gray-100 font-mono uppercase focus:outline-none focus:border-blue-500 inline-edit"
      maxLength={10}
    />
  );
}

// ---------------------------------------------------------------------------
// Price Chart sub-component (owns bars + signals hooks)
// ---------------------------------------------------------------------------

function PriceChartContent({
  config,
  overlayToggles,
  onConfigChange,
  onRemove,
}: ChartWidgetInstanceProps) {
  const timeframe = config.timeframe ?? TIMEFRAMES[1]; // 5m default

  // Auto-detect futures instruments — strip month+year suffix for lookup
  // "ESH6" → base "ES" (in FUTURES_SYMBOLS), contractMonth "202603"
  // "ES"   → base "ES" (in FUTURES_SYMBOLS), contractMonth null (continuous)
  const { base: futuresBase, contractMonth } = parseFuturesTicker(config.ticker);
  const isFutures =
    config.secType === "FUT" || FUTURES_SYMBOLS.has(futuresBase);
  const futuresExchange =
    config.exchange || FUTURES_EXCHANGE[futuresBase] || "CME";

  // Both hooks always called (React rules) — one is disabled via `enabled`
  const polygonResult = usePolygonBars(config.ticker, {
    multiplier: timeframe.multiplier,
    timespan: timeframe.timespan,
    enabled: !isFutures,
  });
  const ibResult = useIBBars(config.ticker, {
    secType: "FUT",
    exchange: futuresExchange,
    multiplier: timeframe.multiplier,
    timespan: timeframe.timespan,
    enabled: isFutures,
    contractMonth: contractMonth ?? undefined,
  });

  const { bars, loading, error } = isFutures ? ibResult : polygonResult;

  const { signals, fills } = useChartSignals(config.ticker);

  const handleTickerChange = useCallback(
    (ticker: string) => onConfigChange(config.id, { ticker }),
    [config.id, onConfigChange]
  );

  const headerExtra = (
    <div className="flex items-center gap-1 ml-1">
      <InlineTickerInput value={config.ticker} onChange={handleTickerChange} />
      {isFutures && (
        <span className="text-[9px] font-medium text-amber-400 bg-amber-400/10 px-1 rounded">
          IB
        </span>
      )}
      <div className="flex items-center gap-0">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.label}
            onClick={() => onConfigChange(config.id, { timeframe: tf })}
            className={`px-1 py-0 text-[10px] font-medium rounded transition-colors ${
              timeframe.label === tf.label
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <WidgetContainer
      title={`${config.ticker} — ${timeframe.label}`}
      loading={loading}
      error={error}
      headerExtra={headerExtra}
      onRemove={onRemove}
    >
      {({ width, height }) => (
        <ChartWidget
          bars={bars}
          width={width}
          height={height}
          signals={signals}
          fills={fills}
          overlayToggles={overlayToggles}
          ticker={config.ticker}
        />
      )}
    </WidgetContainer>
  );
}

// ---------------------------------------------------------------------------
// Signal Panel sub-component (owns signals hook)
// ---------------------------------------------------------------------------

function SignalPanelContent({
  config,
  onConfigChange,
  onRemove,
}: Omit<ChartWidgetInstanceProps, "overlayToggles">) {
  const { signals, currentSignal, engineRunning } = useChartSignals(
    config.ticker
  );

  const handleTickerChange = useCallback(
    (ticker: string) => onConfigChange(config.id, { ticker }),
    [config.id, onConfigChange]
  );

  const headerExtra = (
    <div className="flex items-center gap-1 ml-1">
      <InlineTickerInput value={config.ticker} onChange={handleTickerChange} />
    </div>
  );

  return (
    <WidgetContainer
      title="Signal"
      headerExtra={headerExtra}
      onRemove={onRemove}
    >
      {() => (
        <SignalPanel
          currentSignal={currentSignal}
          signals={signals}
          engineRunning={engineRunning}
          ticker={config.ticker}
        />
      )}
    </WidgetContainer>
  );
}

// ---------------------------------------------------------------------------
// Positions Panel sub-component (owns fills hook)
// ---------------------------------------------------------------------------

function PositionsPanelContent({
  config,
  onConfigChange,
  onRemove,
}: Omit<ChartWidgetInstanceProps, "overlayToggles">) {
  const { fills, activePositionCount } = useChartSignals(config.ticker);

  const handleTickerChange = useCallback(
    (ticker: string) => onConfigChange(config.id, { ticker }),
    [config.id, onConfigChange]
  );

  const headerExtra = (
    <div className="flex items-center gap-1 ml-1">
      <InlineTickerInput value={config.ticker} onChange={handleTickerChange} />
    </div>
  );

  return (
    <WidgetContainer
      title="Positions"
      headerExtra={headerExtra}
      onRemove={onRemove}
    >
      {() => (
        <PositionsPanel
          fills={fills}
          activePositionCount={activePositionCount}
        />
      )}
    </WidgetContainer>
  );
}

// ---------------------------------------------------------------------------
// Main wrapper — delegates to type-specific sub-component
// ---------------------------------------------------------------------------

export default function ChartWidgetInstance(props: ChartWidgetInstanceProps) {
  switch (props.config.type) {
    case "price-chart":
      return <PriceChartContent {...props} />;
    case "signal-panel":
      return <SignalPanelContent {...props} />;
    case "positions-panel":
      return <PositionsPanelContent {...props} />;
    default:
      return null;
  }
}
