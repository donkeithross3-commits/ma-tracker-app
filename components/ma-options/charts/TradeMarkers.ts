// ---------------------------------------------------------------------------
// TradeMarkers — pure functions mapping position_ledger fills → chart markers
// ---------------------------------------------------------------------------

import type { ChartBar, PositionFill } from "./types";
import type { SeriesMarker, Time } from "lightweight-charts";

/** Level label abbreviations */
const LEVEL_LABELS: Record<string, string> = {
  trailing_stop: "TS",
  stop_loss: "SL",
  profit_target_1: "PT1",
  profit_target_2: "PT2",
  profit_target_3: "PT3",
  expired_worthless: "EXP",
  manual_close: "MAN",
  reconciliation: "REC",
};

/** Binary search: find the bar with time closest to target */
function snapToBar(bars: ChartBar[], targetSec: number): number | null {
  if (bars.length === 0) return null;

  let lo = 0;
  let hi = bars.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < targetSec) lo = mid + 1;
    else hi = mid;
  }

  if (lo > 0 && Math.abs(bars[lo - 1].time - targetSec) < Math.abs(bars[lo].time - targetSec)) {
    return bars[lo - 1].time;
  }
  return bars[lo].time;
}

/**
 * Build trade markers for lightweight-charts from position fills.
 *
 * @param fills - Flattened fills from position_ledger
 * @param bars - Price bars (sorted by time)
 */
export function buildTradeMarkers(
  fills: PositionFill[],
  bars: ChartBar[]
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  if (bars.length === 0) return markers;

  for (const fill of fills) {
    const snappedTime = snapToBar(bars, fill.time);
    if (snappedTime === null) continue;

    if (fill.isEntry) {
      // Entry → green arrow up below bar
      markers.push({
        time: snappedTime as Time,
        position: "belowBar",
        color: "#22C55E",
        shape: "arrowUp",
        text: `BUY ${fill.qty}@$${fill.price.toFixed(2)}`,
      });
    } else {
      // Exit → colored arrow down above bar
      const levelLabel = LEVEL_LABELS[fill.level] || fill.level.slice(0, 4).toUpperCase();
      const pnlStr = fill.pnl_pct >= 0
        ? `+${fill.pnl_pct.toFixed(0)}%`
        : `${fill.pnl_pct.toFixed(0)}%`;
      const color = fill.pnl_pct >= 0 ? "#22C55E" : "#EF4444";

      markers.push({
        time: snappedTime as Time,
        position: "aboveBar",
        color,
        shape: "arrowDown",
        text: `${pnlStr} ${levelLabel}`,
      });
    }
  }

  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}
