"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type SeriesMarker,
  type Time,
  type ISeriesMarkersPluginApi,
} from "lightweight-charts";
import type { ChartBar, OverlayToggles, SignalHistoryEntry, PositionFill } from "./types";
import { buildSignalOverlay, type SignalHistogramPoint } from "./SignalOverlay";
import { buildTradeMarkers } from "./TradeMarkers";

// ---------------------------------------------------------------------------
// Dark theme constants
// ---------------------------------------------------------------------------
const BG_COLOR = "#030712"; // bg-gray-950
const TEXT_COLOR = "#9CA3AF"; // text-gray-400
const GRID_COLOR = "#1F2937"; // border-gray-800
const UP_COLOR = "#22C55E"; // green-500
const DOWN_COLOR = "#EF4444"; // red-500
const VOLUME_UP = "rgba(34, 197, 94, 0.25)";
const VOLUME_DOWN = "rgba(239, 68, 68, 0.25)";

export interface ChartWidgetHandle {
  fitContent: () => void;
}

interface ChartWidgetProps {
  bars: ChartBar[];
  width: number;
  height: number;
  signals?: SignalHistoryEntry[];
  fills?: PositionFill[];
  overlayToggles: OverlayToggles;
  ticker?: string;
}

interface OHLCVData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  up: boolean;
}

const ChartWidget = forwardRef<ChartWidgetHandle, ChartWidgetProps>(
  function ChartWidget({ bars, width, height, signals, fills, overlayToggles, ticker }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const signalHistSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const [ohlcv, setOhlcv] = useState<OHLCVData | null>(null);

    // Expose imperative API
    useImperativeHandle(ref, () => ({
      fitContent: () => chartRef.current?.timeScale().fitContent(),
    }));

    // Create chart once on mount
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        width,
        height,
        layout: {
          background: { type: ColorType.Solid, color: BG_COLOR },
          textColor: TEXT_COLOR,
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: GRID_COLOR,
        },
        timeScale: {
          borderColor: GRID_COLOR,
          timeVisible: true,
          secondsVisible: false,
        },
      });

      // Candlestick series (v5 API: chart.addSeries)
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
      });

      // Create markers plugin for the candle series
      const markersPlugin = createSeriesMarkers(candleSeries);

      // Volume histogram on separate price scale
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      // Signal histogram on separate price scale (top area)
      const signalHistSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        priceScaleId: "signal",
      });
      chart.priceScale("signal").applyOptions({
        scaleMargins: { top: 0, bottom: 0.85 },
      });

      // OHLCV legend on crosshair hover
      chart.subscribeCrosshairMove((param) => {
        try {
          if (!param.time || !param.seriesData || param.seriesData.size === 0) {
            setOhlcv(null);
            return;
          }
          const candle = param.seriesData.get(candleSeries) as
            | CandlestickData
            | undefined;
          if (
            !candle ||
            typeof candle.open !== "number" ||
            typeof candle.close !== "number"
          ) {
            setOhlcv(null);
            return;
          }
          // Find matching volume
          const vol = param.seriesData.get(volumeSeries) as
            | HistogramData
            | undefined;
          setOhlcv({
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: vol?.value ?? 0,
            up: candle.close >= candle.open,
          });
        } catch {
          setOhlcv(null);
        }
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      signalHistSeriesRef.current = signalHistSeries;
      markersPluginRef.current = markersPlugin;

      return () => {
        chart.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
        signalHistSeriesRef.current = null;
        markersPluginRef.current = null;
      };
    }, []); // Mount once

    // Resize on dimension change
    useEffect(() => {
      if (chartRef.current && width > 0 && height > 0) {
        chartRef.current.resize(width, height);
      }
    }, [width, height]);

    // Update candlestick + volume data — MUST clear old data when bars are empty
    // so stale candles from a previous timeframe don't persist on screen.
    useEffect(() => {
      if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

      if (bars.length === 0) {
        // Clear stale data from previous timeframe/ticker
        try {
          candleSeriesRef.current.setData([]);
          volumeSeriesRef.current.setData([]);
        } catch {
          // chart may already be disposed
        }
        return;
      }

      try {
        // Deduplicate bars by time (IB can return overlapping timestamps)
        const seen = new Set<number>();
        const dedupedBars = bars.filter((b) => {
          if (seen.has(b.time)) return false;
          seen.add(b.time);
          return true;
        });

        const candleData: CandlestickData[] = dedupedBars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }));

        const volumeData: HistogramData[] = dedupedBars.map((b) => ({
          time: b.time as Time,
          value: b.volume,
          color: b.close >= b.open ? VOLUME_UP : VOLUME_DOWN,
        }));

        candleSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        // Fit content on initial data load
        chartRef.current?.timeScale().fitContent();
      } catch (err) {
        console.error("[ChartWidget] Error setting bar data:", err);
      }
    }, [bars]);

    // Toggle volume visibility
    useEffect(() => {
      if (!volumeSeriesRef.current) return;
      volumeSeriesRef.current.applyOptions({
        visible: overlayToggles.showVolume,
      });
    }, [overlayToggles.showVolume]);

    // Build and apply signal overlay + trade markers
    const applyOverlays = useCallback(() => {
      if (!markersPluginRef.current || !signalHistSeriesRef.current) return;

      try {
        // Signal histogram
        if (overlayToggles.showSignals && signals && signals.length > 0) {
          const { markers: signalMarkers, histogramData } = buildSignalOverlay(
            signals,
            bars
          );

          // Set histogram data
          const histData: HistogramData[] = histogramData.map((h: SignalHistogramPoint) => ({
            time: h.time as Time,
            value: h.value,
            color: h.color,
          }));
          signalHistSeriesRef.current.setData(histData);
          signalHistSeriesRef.current.applyOptions({ visible: true });

          // Merge signal markers with trade markers
          let allMarkers: SeriesMarker<Time>[] = [...signalMarkers];

          if (overlayToggles.showTrades && fills && fills.length > 0) {
            const tradeMarkers = buildTradeMarkers(fills, bars);
            allMarkers = [...allMarkers, ...tradeMarkers];
          }

          allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
          markersPluginRef.current.setMarkers(allMarkers);
        } else {
          // No signal overlay
          signalHistSeriesRef.current.setData([]);
          signalHistSeriesRef.current.applyOptions({ visible: false });

          // Still show trade markers if enabled
          if (overlayToggles.showTrades && fills && fills.length > 0) {
            const tradeMarkers = buildTradeMarkers(fills, bars);
            markersPluginRef.current.setMarkers(tradeMarkers);
          } else {
            markersPluginRef.current.setMarkers([]);
          }
        }
      } catch (err) {
        console.error("[ChartWidget] Error applying overlays:", err);
      }
    }, [bars, signals, fills, overlayToggles]);

    useEffect(() => {
      applyOverlays();
    }, [applyOverlays]);

    return (
      <div className="relative w-full h-full" style={{ minHeight: 200 }}>
        <div ref={containerRef} className="w-full h-full" />
        {ohlcv && (
          <div
            className="absolute top-1 left-1 flex items-center gap-3 text-xs font-mono pointer-events-none z-30 bg-gray-950/80 rounded px-1.5 py-0.5"
          >
            <span>
              <span className="text-gray-500">O </span>
              <span className={ohlcv.up ? "text-green-400" : "text-red-400"}>
                {ohlcv.open.toFixed(2)}
              </span>
            </span>
            <span>
              <span className="text-gray-500">H </span>
              <span className={ohlcv.up ? "text-green-400" : "text-red-400"}>
                {ohlcv.high.toFixed(2)}
              </span>
            </span>
            <span>
              <span className="text-gray-500">L </span>
              <span className={ohlcv.up ? "text-green-400" : "text-red-400"}>
                {ohlcv.low.toFixed(2)}
              </span>
            </span>
            <span>
              <span className="text-gray-500">C </span>
              <span className={ohlcv.up ? "text-green-400" : "text-red-400"}>
                {ohlcv.close.toFixed(2)}
              </span>
            </span>
            <span>
              <span className="text-gray-500">V </span>
              <span className="text-gray-400">
                {ohlcv.volume >= 1_000_000
                  ? `${(ohlcv.volume / 1_000_000).toFixed(1)}M`
                  : ohlcv.volume >= 1_000
                    ? `${(ohlcv.volume / 1_000).toFixed(1)}K`
                    : ohlcv.volume.toLocaleString()}
              </span>
            </span>
          </div>
        )}
      </div>
    );
  }
);

export default ChartWidget;
