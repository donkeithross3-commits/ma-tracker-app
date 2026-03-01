// ---------------------------------------------------------------------------
// Default react-grid-layout arrangements per breakpoint
// ---------------------------------------------------------------------------

/** Layout item shape (mirrors react-grid-layout's Layout interface) */
export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface LayoutMap {
  [key: string]: LayoutItem[];
}

/**
 * Default grid layouts.
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
export const GRID_COLS = { lg: 12, md: 10, sm: 6 };
export const ROW_HEIGHT = 30;
export const GRID_MARGIN: [number, number] = [8, 8];

/** localStorage key for persisted layout */
export const LAYOUT_STORAGE_KEY = "charts-grid-layout";
