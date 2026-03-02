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
import {
  FUTURES_SYMBOLS,
  parseFuturesContract,
  getContractMonth,
  getExchangeForSymbol,
} from "./futures-utils";

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
      className="w-16 bg-gray-800 border border-gray-700 rounded px-1 py-0 text-sm text-gray-100 font-mono uppercase focus:outline-none focus:border-blue-500 inline-edit"
      style={{ touchAction: "manipulation" }}
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

  // Auto-detect futures instruments via shared utilities
  const contractMonth = getContractMonth(config.ticker);
  const parsed = parseFuturesContract(config.ticker);
  const futuresBase = parsed ? parsed.base : config.ticker;
  const isFutures =
    config.secType === "FUT" || FUTURES_SYMBOLS.has(futuresBase);
  const futuresExchange =
    config.exchange || getExchangeForSymbol(futuresBase);

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
    <div className="flex items-center flex-wrap gap-1 ml-1">
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

  // Show bar count in title for quick data verification
  const barCountLabel = bars.length > 0 ? ` (${bars.length})` : "";

  return (
    <WidgetContainer
      title={`${config.ticker} — ${timeframe.label}${barCountLabel}`}
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
