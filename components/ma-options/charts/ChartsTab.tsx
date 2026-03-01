"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RotateCcw,
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
  GRID_COLS,
  ROW_HEIGHT,
  GRID_MARGIN,
  LAYOUT_STORAGE_KEY,
  type LayoutItem,
  type LayoutMap,
} from "./defaultLayouts";
import { TIMEFRAMES, type OverlayToggles, type TimeframeConfig } from "./types";

// react-grid-layout CSS
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// ---------------------------------------------------------------------------
// Dynamic import of react-grid-layout (CJS/ESM safe)
// We use the Responsive component with manual width measurement instead
// of WidthProvider HOC which has interop issues.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RGLResponsive: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RGL = require("react-grid-layout");
  RGLResponsive = RGL.Responsive || RGL.default?.Responsive || RGL;
} catch {
  // Will be caught at render time
}

// ---------------------------------------------------------------------------
// Layout persistence
// ---------------------------------------------------------------------------
function loadSavedLayouts(): LayoutMap | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate structure: must have at least one breakpoint with arrays
      if (parsed && typeof parsed === "object") {
        const keys = Object.keys(parsed);
        if (keys.length > 0 && Array.isArray(parsed[keys[0]])) {
          return parsed;
        }
      }
    }
  } catch {
    // corrupt localStorage — fall back to defaults
  }
  return null;
}

function saveLayouts(layouts: LayoutMap) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

// ---------------------------------------------------------------------------
// Pick breakpoint from container width
// ---------------------------------------------------------------------------
function getBreakpoint(width: number): "lg" | "md" | "sm" {
  if (width >= 1200) return "lg";
  if (width >= 996) return "md";
  return "sm";
}

// ---------------------------------------------------------------------------
// ChartsTab
// ---------------------------------------------------------------------------
export default function ChartsTab() {
  // Ticker state
  const [ticker, setTicker] = useState("SPY");
  const [tickerInput, setTickerInput] = useState("SPY");

  // Timeframe state — default to 1D on weekends so chart shows data
  const [timeframe, setTimeframe] = useState<TimeframeConfig>(() => {
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    return isWeekend ? TIMEFRAMES[4] : TIMEFRAMES[1]; // 1D on weekends, 5m on weekdays
  });

  // Overlay toggles
  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>({
    showSignals: true,
    showTrades: true,
    showVolume: true,
  });

  // Grid layouts
  const [layouts, setLayouts] = useState<LayoutMap>(
    () => loadSavedLayouts() || DEFAULT_LAYOUTS
  );

  // Measure container width for grid (replaces WidthProvider)
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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

  // Current breakpoint + cols
  const breakpoint = getBreakpoint(containerWidth);
  const cols = GRID_COLS[breakpoint];

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLayoutChange = useCallback((currentLayout: any[], allLayouts: any) => {
    if (allLayouts && typeof allLayouts === "object") {
      setLayouts(allLayouts);
      saveLayouts(allLayouts);
    }
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

  // Compute grid item dimensions for fallback
  const colWidth = containerWidth > 0
    ? (containerWidth - GRID_MARGIN[0] * (cols + 1)) / cols
    : 0;

  const getItemStyle = (item: LayoutItem): React.CSSProperties => ({
    width: "100%",
    height: "100%",
  });

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
      <div ref={containerRef}>
        {containerWidth > 0 && RGLResponsive ? (
          <RGLResponsive
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={GRID_COLS}
            rowHeight={ROW_HEIGHT}
            width={containerWidth}
            margin={GRID_MARGIN}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            useCSSTransforms
            compactType="vertical"
          >
            {/* Price Chart */}
            <div key="price-chart" style={{ width: "100%", height: "100%" }}>
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
            <div key="signal-panel" style={{ width: "100%", height: "100%" }}>
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
            <div key="positions-panel" style={{ width: "100%", height: "100%" }}>
              <WidgetContainer title="Positions">
                {() => (
                  <PositionsPanel
                    fills={fills}
                    activePositionCount={activePositionCount}
                  />
                )}
              </WidgetContainer>
            </div>
          </RGLResponsive>
        ) : (
          <div className="text-sm text-gray-500 py-8 text-center">
            Loading chart grid...
          </div>
        )}
      </div>
    </div>
  );
}
