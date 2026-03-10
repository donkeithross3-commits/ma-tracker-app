"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

// ---------------------------------------------------------------------------
// Dark theme constants (matching existing ChartWidget)
// ---------------------------------------------------------------------------
const BG_COLOR = "#030712"; // bg-gray-950
const TEXT_COLOR = "#9CA3AF"; // text-gray-400
const GRID_COLOR = "#1F2937"; // border-gray-800
const SPREAD_COLOR = "#3B82F6"; // blue-500
const DEAL_PRICE_COLOR = "#22C55E"; // green-500
const CLOSE_PRICE_COLOR = "#9CA3AF"; // gray-400

interface SpreadPoint {
  date: string;
  close: number;
  dealPrice: number;
  spreadPct: number;
}

type ChartMode = "spread" | "price";

interface Props {
  /** For the legacy /deals/[id] page — fetches from the Prisma API route */
  dealId?: string;
  /** For the sheet-portfolio page — pass data directly */
  ticker?: string;
  dealPrice?: number;
  announcedDate?: string | null; // YYYY-MM-DD or ISO string
}

export function SpreadHistoryChart({ dealId, ticker, dealPrice, announcedDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Line"> | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dealPriceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [history, setHistory] = useState<SpreadPoint[] | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string>(ticker || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("spread");
  const [hoveredPoint, setHoveredPoint] = useState<{
    date: string;
    value: number;
    close?: number;
    dealPrice?: number;
  } | null>(null);

  // O(1) lookup map for crosshair handler (avoids O(n) find on every mouse move)
  const pointsByDate = useMemo(() => {
    if (!history) return new Map<string, SpreadPoint>();
    return new Map(history.map((p) => [p.date, p]));
  }, [history]);

  // Fetch data — two paths: legacy Prisma route or direct Polygon call
  useEffect(() => {
    let cancelled = false;

    async function fetchViaLegacyRoute() {
      const res = await fetch(`/api/deals/${dealId}/spread-history`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!cancelled) {
        setHistory(json.history);
        setResolvedTicker(json.ticker);
      }
    }

    async function fetchViaPolygon() {
      if (!ticker || !dealPrice || dealPrice <= 0) {
        throw new Error("Deal price not available");
      }

      // Compute date range: from announcement (or 1 year ago) to today
      const today = new Date();
      const fromDate = new Date(announcedDate || today);
      if (!announcedDate) {
        fromDate.setFullYear(fromDate.getFullYear() - 1);
      }

      const fromStr = fromDate.toISOString().split("T")[0];
      const toStr = today.toISOString().split("T")[0];

      const url = `/api/ma-options/polygon/bars?ticker=${ticker}&timespan=day&multiplier=1&from=${fromStr}&to=${toStr}&limit=5000`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const bars: { time: number; close: number }[] = json.bars || [];

      if (bars.length === 0) {
        throw new Error("No price history available");
      }

      // Compute spread for each bar
      const points: SpreadPoint[] = bars.map((bar) => {
        const dateStr = new Date(bar.time * 1000).toISOString().split("T")[0];
        const spreadPct = ((dealPrice - bar.close) / bar.close) * 100;
        return {
          date: dateStr,
          close: bar.close,
          dealPrice: dealPrice,
          spreadPct: Math.round(spreadPct * 100) / 100,
        };
      });

      if (!cancelled) {
        setHistory(points);
        setResolvedTicker(ticker);
      }
    }

    setLoading(true);
    setError(null);

    const promise = dealId ? fetchViaLegacyRoute() : fetchViaPolygon();
    promise
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dealId, ticker, dealPrice, announcedDate]);

  // Build and render chart
  useEffect(() => {
    if (!containerRef.current || !history || history.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceSeriesRef.current = null;
      dealPriceSeriesRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
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
        timeVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    chartRef.current = chart;

    if (chartMode === "spread") {
      // Area chart for spread %
      const series = chart.addSeries(AreaSeries, {
        lineColor: SPREAD_COLOR,
        topColor: "rgba(59, 130, 246, 0.3)",
        bottomColor: "rgba(59, 130, 246, 0.02)",
        lineWidth: 2,
        priceFormat: {
          type: "custom",
          formatter: (price: number) => `${price.toFixed(2)}%`,
        },
      });

      series.setData(
        history.map((p) => ({
          time: p.date as Time,
          value: p.spreadPct,
        }))
      );
      seriesRef.current = series;

      // Add zero line visual reference
      series.createPriceLine({
        price: 0,
        color: "rgba(156, 163, 175, 0.4)",
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: false,
      });
    } else {
      // Price mode: show close price + deal price lines
      const closeSeries = chart.addSeries(LineSeries, {
        color: CLOSE_PRICE_COLOR,
        lineWidth: 2,
        title: resolvedTicker,
        priceFormat: {
          type: "price",
          precision: 2,
          minMove: 0.01,
        },
      });

      closeSeries.setData(
        history.map((p) => ({
          time: p.date as Time,
          value: p.close,
        }))
      );
      priceSeriesRef.current = closeSeries;

      const dealSeries = chart.addSeries(LineSeries, {
        color: DEAL_PRICE_COLOR,
        lineWidth: 2,
        lineStyle: 2, // dashed
        title: "Deal Price",
        priceFormat: {
          type: "price",
          precision: 2,
          minMove: 0.01,
        },
      });

      dealSeries.setData(
        history.map((p) => ({
          time: p.date as Time,
          value: p.dealPrice,
        }))
      );
      dealPriceSeriesRef.current = dealSeries;
    }

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoveredPoint(null);
        return;
      }

      const dateStr = param.time as string;
      const point = pointsByDate.get(dateStr);
      if (point) {
        setHoveredPoint({
          date: dateStr,
          value: chartMode === "spread" ? point.spreadPct : point.close,
          close: point.close,
          dealPrice: point.dealPrice,
        });
      }
    });

    chart.timeScale().fitContent();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceSeriesRef.current = null;
      dealPriceSeriesRef.current = null;
    };
  }, [history, chartMode, pointsByDate, resolvedTicker]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-gray-950 rounded-lg border border-gray-800">
        <div className="text-gray-400 text-sm">Loading spread history...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-gray-950 rounded-lg border border-gray-800">
        <div className="text-gray-500 text-sm">{error}</div>
      </div>
    );
  }

  // No data
  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-gray-950 rounded-lg border border-gray-800">
        <div className="text-gray-500 text-sm">No price history available</div>
      </div>
    );
  }

  // Current spread stats
  const latest = history[history.length - 1];
  const maxSpread = Math.max(...history.map((p) => p.spreadPct));
  const minSpread = Math.min(...history.map((p) => p.spreadPct));

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Mode toggle */}
          <div className="flex rounded-md bg-gray-900 p-0.5">
            <button
              onClick={() => setChartMode("spread")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                chartMode === "spread"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Spread %
            </button>
            <button
              onClick={() => setChartMode("price")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                chartMode === "price"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Price
            </button>
          </div>

          {/* Hover info */}
          {hoveredPoint ? (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>{hoveredPoint.date}</span>
              {chartMode === "spread" ? (
                <span className="text-blue-400 font-medium">
                  {hoveredPoint.value.toFixed(2)}%
                </span>
              ) : (
                <>
                  <span>
                    Close:{" "}
                    <span className="text-gray-200">
                      ${hoveredPoint.close?.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    Deal:{" "}
                    <span className="text-green-400">
                      ${hoveredPoint.dealPrice?.toFixed(2)}
                    </span>
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>
                Current:{" "}
                <span className="text-blue-400 font-medium">
                  {latest.spreadPct.toFixed(2)}%
                </span>
              </span>
              <span>
                Range: {minSpread.toFixed(1)}% – {maxSpread.toFixed(1)}%
              </span>
              <span>{history.length} days</span>
            </div>
          )}
        </div>

        {/* Legend for price mode */}
        {chartMode === "price" && (
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5"
                style={{ backgroundColor: CLOSE_PRICE_COLOR }}
              />
              <span className="text-gray-400">{resolvedTicker}</span>
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5"
                style={{
                  backgroundColor: DEAL_PRICE_COLOR,
                  borderTop: "1px dashed",
                }}
              />
              <span className="text-gray-400">Deal Price</span>
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border border-gray-800"
      />
    </div>
  );
}
