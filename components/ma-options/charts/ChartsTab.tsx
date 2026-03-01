"use client";

import { useCallback, useMemo, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
import RGL from "react-grid-layout";
const RGLModule = RGL as any;
import {
  RotateCcw,
  Eye,
  EyeOff,
  BarChart3,
  TrendingUp,
  LineChart,
} from "lucide-react";

import ChartWidget from "./ChartWidget";
import WidgetContainer from "./WidgetContainer";
import SignalPanel from "./SignalPanel";
import PositionsPanel from "./PositionsPanel";
import { usePolygonBars } from "./usePolygonBars";
import { useChartSignals } from "./useChartSignals";
import {
  DEFAULT_LAYOUTS,
  GRID_BREAKPOINTS,
  GRID_COLS,
  ROW_HEIGHT,
  GRID_MARGIN,
  LAYOUT_STORAGE_KEY,
} from "./defaultLayouts";
import { TIMEFRAMES, type OverlayToggles, type TimeframeConfig } from "./types";

// react-grid-layout CSS
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// react-grid-layout CJS/ESM interop
const Responsive = RGLModule.Responsive || RGLModule.default?.Responsive || RGLModule;
const WidthProvider = RGLModule.WidthProvider || RGLModule.default?.WidthProvider;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Layouts = { [P: string]: any[] };
const ResponsiveGridLayout = WidthProvider ? WidthProvider(Responsive) : Responsive;

// ---------------------------------------------------------------------------
// Layout persistence
// ---------------------------------------------------------------------------
function loadSavedLayouts(): Layouts | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupt localStorage — fall back to defaults
  }
  return null;
}

function saveLayouts(layouts: Layouts) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

// ---------------------------------------------------------------------------
// ChartsTab
// ---------------------------------------------------------------------------
export default function ChartsTab() {
  // Ticker state
  const [ticker, setTicker] = useState("SPY");
  const [tickerInput, setTickerInput] = useState("SPY");

  // Timeframe state
  const [timeframe, setTimeframe] = useState<TimeframeConfig>(TIMEFRAMES[1]); // 5m default

  // Overlay toggles
  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>({
    showSignals: true,
    showTrades: true,
    showVolume: true,
  });

  // Grid layouts
  const [layouts, setLayouts] = useState<Layouts>(
    () => loadSavedLayouts() || DEFAULT_LAYOUTS
  );

  // Data hooks
  const { bars, loading: barsLoading, error: barsError } = usePolygonBars(
    ticker,
    { multiplier: timeframe.multiplier, timespan: timeframe.timespan }
  );

  const {
    signals,
    currentSignal,
    fills,
    engineRunning,
    activePositionCount,
  } = useChartSignals(ticker);

  // Handlers
  const handleTickerSubmit = useCallback(() => {
    const clean = tickerInput.trim().toUpperCase();
    if (/^[A-Z]{1,10}$/.test(clean)) {
      setTicker(clean);
    }
  }, [tickerInput]);

  const handleTickerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTickerSubmit();
    },
    [handleTickerSubmit]
  );

  const handleLayoutChange = useCallback((_: unknown, allLayouts: Layouts) => {
    setLayouts(allLayouts);
    saveLayouts(allLayouts);
  }, []);

  const handleResetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS);
    try {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const toggleOverlay = useCallback((key: keyof OverlayToggles) => {
    setOverlayToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Ticker input */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={handleTickerKeyDown}
            onBlur={handleTickerSubmit}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 font-mono uppercase focus:outline-none focus:border-blue-500 inline-edit"
            placeholder="SPY"
            maxLength={10}
          />
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-0.5 bg-gray-800 rounded border border-gray-700">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                timeframe.label === tf.label
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Overlay toggles */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => toggleOverlay("showSignals")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showSignals
                ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle signal markers"
          >
            <LineChart className="h-3 w-3" />
            Signals
          </button>
          <button
            onClick={() => toggleOverlay("showTrades")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showTrades
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle trade markers"
          >
            <TrendingUp className="h-3 w-3" />
            Trades
          </button>
          <button
            onClick={() => toggleOverlay("showVolume")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showVolume
                ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle volume histogram"
          >
            <BarChart3 className="h-3 w-3" />
            Volume
          </button>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          <button
            onClick={handleResetLayout}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-400 rounded border border-gray-700 hover:border-gray-600 transition-colors"
            title="Reset grid layout"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>

      {/* Grid layout */}
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={GRID_BREAKPOINTS}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={GRID_MARGIN}
        draggableHandle=".drag-handle"
        onLayoutChange={handleLayoutChange}
        useCSSTransforms
        compactType="vertical"
      >
        {/* Price Chart */}
        <div key="price-chart">
          <WidgetContainer
            title={`${ticker} — ${timeframe.label}`}
            loading={barsLoading}
            error={barsError}
          >
            {({ width, height }) => (
              <ChartWidget
                bars={bars}
                width={width}
                height={height}
                signals={signals}
                fills={fills}
                overlayToggles={overlayToggles}
                ticker={ticker}
              />
            )}
          </WidgetContainer>
        </div>

        {/* Signal Panel */}
        <div key="signal-panel">
          <WidgetContainer title="Signal">
            {() => (
              <SignalPanel
                currentSignal={currentSignal}
                signals={signals}
                engineRunning={engineRunning}
                ticker={ticker}
              />
            )}
          </WidgetContainer>
        </div>

        {/* Positions Panel */}
        <div key="positions-panel">
          <WidgetContainer title="Positions">
            {() => (
              <PositionsPanel
                fills={fills}
                activePositionCount={activePositionCount}
              />
            )}
          </WidgetContainer>
        </div>
      </ResponsiveGridLayout>
    </div>
  );
}
