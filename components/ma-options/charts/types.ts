// ---------------------------------------------------------------------------
// Chart system shared types
// ---------------------------------------------------------------------------

/** OHLCV bar from Polygon, time as epoch seconds (lightweight-charts format) */
export interface ChartBar {
  time: number; // epoch seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  trades?: number;
}

/** Signal history entry from BMC strategy */
export interface SignalHistoryEntry {
  timestamp: string; // ISO-8601
  probability: number;
  direction: string; // "call" | "put"
  strength: number;
  suppressed?: string; // suppression reason, absent if not suppressed
}

/** Current signal snapshot from BMC strategy */
export interface CurrentSignal {
  timestamp: string;
  probability: number;
  direction: string;
  strength: number;
  n_features: number;
  n_nan: number;
  computation_ms: number;
  underlying_price: number | null;
  suppressed?: string;
  option_contract?: {
    symbol: string;
    strike: number;
    expiry: string;
    right: string;
  };
}

/** Strategy-level BMC signal state */
export interface BMCStrategyState {
  type: string;
  ticker: string;
  started: boolean;
  current_signal: CurrentSignal | null;
  signal_history: SignalHistoryEntry[];
  decisions_run: number;
  signals_generated: number;
  positions_spawned: number;
  model_version: string;
  model_type: string;
}

/** Fill from position_ledger */
export interface PositionFill {
  time: number; // epoch seconds
  price: number;
  qty: number;
  level: string; // "entry", "trailing_stop", "stop_loss", "profit_target_1", "expired_worthless"
  pnl_pct: number;
  positionId: string;
  instrument: {
    symbol: string;
    strike?: number;
    expiry?: string;
    right?: string;
  };
  status: "active" | "closed";
  isEntry: boolean;
}

/** Position ledger entry (from execution/status API) */
export interface PositionLedgerEntry {
  id: string;
  status: "active" | "closed";
  created_at: number;
  closed_at: number | null;
  exit_reason?: string;
  entry: {
    order_id: number;
    price: number;
    quantity: number;
    fill_time: number;
    perm_id: number;
  };
  instrument: {
    symbol: string;
    strike?: number;
    expiry?: string;
    right?: string;
  };
  fill_log: Array<{
    time: number;
    order_id: number;
    exec_id?: string;
    level: string;
    qty_filled: number;
    avg_price: number;
    remaining_qty: number;
    pnl_pct: number;
    execution_analytics?: {
      commission?: number | null;
      slippage?: number | null;
    };
  }>;
  lineage?: {
    model_version?: string;
    model_type?: string;
    signal?: {
      probability?: number;
      direction?: string;
      strength?: number;
    };
  };
}

/** Widget types in the grid */
export type WidgetType = "price-chart" | "signal-panel" | "positions-panel";

/** Overlay toggle state */
export interface OverlayToggles {
  showSignals: boolean;
  showTrades: boolean;
  showVolume: boolean;
}

/** Timeframe config for Polygon bars */
export interface TimeframeConfig {
  multiplier: number;
  timespan: "minute" | "hour" | "day";
  label: string;
}

/** Available timeframes */
export const TIMEFRAMES: TimeframeConfig[] = [
  { multiplier: 1, timespan: "minute", label: "1m" },
  { multiplier: 5, timespan: "minute", label: "5m" },
  { multiplier: 15, timespan: "minute", label: "15m" },
  { multiplier: 1, timespan: "hour", label: "1h" },
  { multiplier: 1, timespan: "day", label: "1D" },
];
