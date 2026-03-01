// ---------------------------------------------------------------------------
// Default react-grid-layout arrangements per breakpoint
// ---------------------------------------------------------------------------

import type {
  LayoutItem,
  LayoutMap,
  ChartPreset,
  TimeframeConfig,
} from "./types";
import { TIMEFRAMES } from "./types";

// Re-export for backward compatibility (moved to types.ts)
export type { LayoutItem, LayoutMap };

/**
 * Default grid layouts (legacy — used as base for Single Chart preset).
 * - lg (≥1200): price chart 9×16, signal panel 3×8 top-right, positions 3×8 bottom-right
 * - md (≥996):  price chart full width, panels side-by-side below
 * - sm (≥768):  single column stack
 */
export const DEFAULT_LAYOUTS: LayoutMap = {
  lg: [
    { i: "price-chart", x: 0, y: 0, w: 9, h: 16, minW: 4, minH: 8 },
    { i: "signal-panel", x: 9, y: 0, w: 3, h: 8, minW: 2, minH: 4 },
    { i: "positions-panel", x: 9, y: 8, w: 3, h: 8, minW: 2, minH: 4 },
  ],
  md: [
    { i: "price-chart", x: 0, y: 0, w: 10, h: 14, minW: 4, minH: 8 },
    { i: "signal-panel", x: 0, y: 14, w: 5, h: 6, minW: 2, minH: 4 },
    { i: "positions-panel", x: 5, y: 14, w: 5, h: 6, minW: 2, minH: 4 },
  ],
  sm: [
    { i: "price-chart", x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
    { i: "signal-panel", x: 0, y: 12, w: 3, h: 6, minW: 2, minH: 4 },
    { i: "positions-panel", x: 3, y: 12, w: 3, h: 6, minW: 2, minH: 4 },
  ],
};

export const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768 };
export const GRID_COLS: Record<string, number> = { lg: 12, md: 10, sm: 6 };
export const ROW_HEIGHT = 30;
export const GRID_MARGIN: [number, number] = [8, 8];

/** localStorage key for persisted layout (legacy — migrated to server-side presets) */
export const LAYOUT_STORAGE_KEY = "charts-grid-layout";

// ---------------------------------------------------------------------------
// Widget ID generation
// ---------------------------------------------------------------------------

/** Generate a unique widget ID */
export function generateWidgetId(): string {
  return `chart-${Math.random().toString(36).slice(2, 10)}`;
}

/** Default timeframe for new widgets (5m weekday, 1D weekend) */
export function defaultTimeframe(): TimeframeConfig {
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? TIMEFRAMES[4] : TIMEFRAMES[1];
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

/** Single Chart preset — matches the original 1-chart + sidebars layout */
export const SINGLE_CHART_PRESET: ChartPreset = {
  name: "Single Chart",
  isBuiltIn: true,
  overlayToggles: { showSignals: true, showTrades: true, showVolume: true },
  widgets: [
    { id: "sc-price", type: "price-chart", ticker: "SPY", timeframe: TIMEFRAMES[1] },
    { id: "sc-signal", type: "signal-panel", ticker: "SPY" },
    { id: "sc-positions", type: "positions-panel", ticker: "SPY" },
  ],
  gridLayouts: {
    lg: [
      { i: "sc-price", x: 0, y: 0, w: 9, h: 16, minW: 4, minH: 8 },
      { i: "sc-signal", x: 9, y: 0, w: 3, h: 8, minW: 2, minH: 4 },
      { i: "sc-positions", x: 9, y: 8, w: 3, h: 8, minW: 2, minH: 4 },
    ],
    md: [
      { i: "sc-price", x: 0, y: 0, w: 10, h: 14, minW: 4, minH: 8 },
      { i: "sc-signal", x: 0, y: 14, w: 5, h: 6, minW: 2, minH: 4 },
      { i: "sc-positions", x: 5, y: 14, w: 5, h: 6, minW: 2, minH: 4 },
    ],
    sm: [
      { i: "sc-price", x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
      { i: "sc-signal", x: 0, y: 12, w: 3, h: 6, minW: 2, minH: 4 },
      { i: "sc-positions", x: 3, y: 12, w: 3, h: 6, minW: 2, minH: 4 },
    ],
  },
};

/** Quad View preset — 4 price charts in 2×2 grid */
export const QUAD_VIEW_PRESET: ChartPreset = (() => {
  const tickers = ["SPY", "QQQ", "IWM", "SLV"];
  const ids = tickers.map((_, i) => `qv-${i}`);
  const tf = TIMEFRAMES[1]; // 5m default
  return {
    name: "Quad View",
    isBuiltIn: true,
    overlayToggles: { showSignals: true, showTrades: true, showVolume: true },
    widgets: tickers.map((t, i) => ({
      id: ids[i],
      type: "price-chart" as const,
      ticker: t,
      timeframe: tf,
    })),
    gridLayouts: {
      lg: [
        { i: ids[0], x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
        { i: ids[1], x: 6, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
        { i: ids[2], x: 0, y: 12, w: 6, h: 12, minW: 3, minH: 6 },
        { i: ids[3], x: 6, y: 12, w: 6, h: 12, minW: 3, minH: 6 },
      ],
      md: [
        { i: ids[0], x: 0, y: 0, w: 5, h: 10, minW: 3, minH: 6 },
        { i: ids[1], x: 5, y: 0, w: 5, h: 10, minW: 3, minH: 6 },
        { i: ids[2], x: 0, y: 10, w: 5, h: 10, minW: 3, minH: 6 },
        { i: ids[3], x: 5, y: 10, w: 5, h: 10, minW: 3, minH: 6 },
      ],
      sm: [
        { i: ids[0], x: 0, y: 0, w: 6, h: 10, minW: 3, minH: 6 },
        { i: ids[1], x: 0, y: 10, w: 6, h: 10, minW: 3, minH: 6 },
        { i: ids[2], x: 0, y: 20, w: 6, h: 10, minW: 3, minH: 6 },
        { i: ids[3], x: 0, y: 30, w: 6, h: 10, minW: 3, minH: 6 },
      ],
    },
  };
})();

/** All built-in presets by name */
export const BUILT_IN_PRESETS: Record<string, ChartPreset> = {
  "Single Chart": SINGLE_CHART_PRESET,
  "Quad View": QUAD_VIEW_PRESET,
};

/** Generate a default layout item for a new widget added to the grid */
export function defaultLayoutItem(
  id: string,
  type: "price-chart" | "signal-panel" | "positions-panel",
  cols: number,
): LayoutItem {
  switch (type) {
    case "price-chart":
      return { i: id, x: 0, y: 999, w: Math.min(6, cols), h: 12, minW: 3, minH: 6 };
    case "signal-panel":
      return { i: id, x: 0, y: 999, w: Math.min(3, cols), h: 8, minW: 2, minH: 4 };
    case "positions-panel":
      return { i: id, x: 0, y: 999, w: Math.min(3, cols), h: 8, minW: 2, minH: 4 };
  }
}
