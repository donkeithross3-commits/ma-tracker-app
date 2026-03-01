// ---------------------------------------------------------------------------
// SignalOverlay — pure functions mapping signal_history → chart markers + histogram
// ---------------------------------------------------------------------------

import type { ChartBar, SignalHistoryEntry } from "./types";
import type { SeriesMarker, Time } from "lightweight-charts";

export interface SignalHistogramPoint {
  time: number;
  value: number;
  color: string;
}

export interface SignalOverlayResult {
  markers: SeriesMarker<Time>[];
  histogramData: SignalHistogramPoint[];
}

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

  // Check if the previous bar is closer
  if (lo > 0 && Math.abs(bars[lo - 1].time - targetSec) < Math.abs(bars[lo].time - targetSec)) {
    return bars[lo - 1].time;
  }
  return bars[lo].time;
}

/** Convert ISO timestamp to epoch seconds */
function isoToEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Color by direction and suppressed state */
function signalColor(direction: string, suppressed?: string, alpha = 0.8): string {
  if (suppressed) return `rgba(234, 179, 8, ${alpha})`; // yellow
  if (direction === "call") return `rgba(34, 197, 94, ${alpha})`; // green
  if (direction === "put") return `rgba(239, 68, 68, ${alpha})`; // red
  return `rgba(156, 163, 175, ${alpha})`; // gray fallback
}

/**
 * Build signal overlay data for lightweight-charts.
 *
 * @param signals - Signal history from BMC strategy
 * @param bars - Price bars (sorted by time)
 * @param threshold - Probability threshold for marker display (default 0.5)
 */
export function buildSignalOverlay(
  signals: SignalHistoryEntry[],
  bars: ChartBar[],
  threshold = 0.5
): SignalOverlayResult {
  const markers: SeriesMarker<Time>[] = [];
  const histogramData: SignalHistogramPoint[] = [];

  if (bars.length === 0) return { markers, histogramData };

  for (const sig of signals) {
    const epochSec = isoToEpoch(sig.timestamp);
    const snappedTime = snapToBar(bars, epochSec);
    if (snappedTime === null) continue;

    // Histogram: every signal gets a colored bar
    // Height = probability (0-1), sign indicates direction
    const dirSign = sig.direction === "put" ? -1 : 1;
    histogramData.push({
      time: snappedTime,
      value: sig.probability * dirSign,
      color: signalColor(sig.direction, sig.suppressed, 0.6 + sig.strength * 0.4),
    });

    // Markers: only above threshold
    if (sig.probability >= threshold) {
      if (sig.suppressed) {
        // Suppressed high-prob signal → yellow circle
        markers.push({
          time: snappedTime as Time,
          position: "aboveBar",
          color: "rgba(234, 179, 8, 0.9)",
          shape: "circle",
          text: `S:${sig.suppressed.slice(0, 8)}`,
        });
      } else {
        // Active signal → arrow
        const probText = `${Math.round(sig.probability * 100)}%`;
        markers.push({
          time: snappedTime as Time,
          position: sig.direction === "call" ? "belowBar" : "aboveBar",
          color: sig.direction === "call"
            ? "rgba(34, 197, 94, 0.9)"
            : "rgba(239, 68, 68, 0.9)",
          shape: sig.direction === "call" ? "arrowUp" : "arrowDown",
          text: probText,
        });
      }
    }
  }

  // Sort by time (lightweight-charts requires sorted markers)
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  histogramData.sort((a, b) => a.time - b.time);

  return { markers, histogramData };
}
