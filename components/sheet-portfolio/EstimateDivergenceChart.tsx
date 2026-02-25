"use client";

import { useEffect, useState } from "react";

interface Snapshot {
  date: string;
  sheet_prob_success: number | null;
  ai_prob_success: number | null;
  divergence: number | null;
}

function formatPct(v: number | null): string {
  if (v === null) return "-";
  return `${(v * 100).toFixed(0)}%`;
}

function TextFallback({ snapshots }: { snapshots: Snapshot[] }) {
  const latest = snapshots[snapshots.length - 1];
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-400">Sheet Prob:</span>
        <span className="font-mono text-blue-400">
          {formatPct(latest?.sheet_prob_success ?? null)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">AI Prob:</span>
        <span className="font-mono text-purple-400">
          {formatPct(latest?.ai_prob_success ?? null)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Divergence:</span>
        <span className="font-mono text-gray-300">
          {latest?.divergence !== null
            ? `${(latest.divergence * 100).toFixed(1)}pp`
            : "-"}
        </span>
      </div>
      <div className="text-[10px] text-gray-600">
        {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} tracked
      </div>
    </div>
  );
}

function SVGChart({ snapshots }: { snapshots: Snapshot[] }) {
  const width = 300;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 35 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Filter to snapshots that have at least one value
  const valid = snapshots.filter(
    (s) => s.sheet_prob_success !== null || s.ai_prob_success !== null
  );
  if (valid.length < 2) return <TextFallback snapshots={snapshots} />;

  const xScale = (i: number) =>
    padding.left + (i / (valid.length - 1)) * chartW;
  const yScale = (v: number) =>
    padding.top + chartH - (v * chartH); // v is 0-1

  // Build paths
  const sheetPoints: string[] = [];
  const aiPoints: string[] = [];

  valid.forEach((s, i) => {
    const x = xScale(i);
    if (s.sheet_prob_success !== null) {
      const y = yScale(s.sheet_prob_success);
      sheetPoints.push(`${x},${y}`);
    }
    if (s.ai_prob_success !== null) {
      const y = yScale(s.ai_prob_success);
      aiPoints.push(`${x},${y}`);
    }
  });

  const sheetPath =
    sheetPoints.length >= 2
      ? `M ${sheetPoints.join(" L ")}`
      : null;
  const aiPath =
    aiPoints.length >= 2
      ? `M ${aiPoints.join(" L ")}`
      : null;

  // Y-axis labels
  const yLabels = [0, 0.5, 1.0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yLabels.map((v) => (
        <g key={v}>
          <line
            x1={padding.left}
            y1={yScale(v)}
            x2={width - padding.right}
            y2={yScale(v)}
            stroke="#374151"
            strokeWidth={0.5}
          />
          <text
            x={padding.left - 4}
            y={yScale(v) + 3}
            textAnchor="end"
            className="fill-gray-500"
            fontSize={8}
          >
            {(v * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {/* Sheet line (solid blue) */}
      {sheetPath && (
        <path
          d={sheetPath}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={1.5}
        />
      )}

      {/* AI line (dashed purple) */}
      {aiPath && (
        <path
          d={aiPath}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={1.5}
          strokeDasharray="4,3"
        />
      )}

      {/* X-axis labels (first and last date) */}
      <text
        x={padding.left}
        y={height - 4}
        className="fill-gray-500"
        fontSize={7}
      >
        {valid[0]?.date?.slice(5) ?? ""}
      </text>
      <text
        x={width - padding.right}
        y={height - 4}
        textAnchor="end"
        className="fill-gray-500"
        fontSize={7}
      >
        {valid[valid.length - 1]?.date?.slice(5) ?? ""}
      </text>
    </svg>
  );
}

export function EstimateDivergenceChart({ ticker }: { ticker: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEstimates() {
      try {
        const res = await fetch(
          `/api/sheet-portfolio/v2/deal/${ticker}/estimates`
        );
        if (res.ok) {
          const json = await res.json();
          setSnapshots(json.snapshots || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchEstimates();
  }, [ticker]);

  if (loading) return null;
  if (snapshots.length === 0) return null;

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">
          Estimate Divergence
        </h3>
        <div className="flex gap-3 text-[10px]">
          <span className="text-blue-400">--- Sheet</span>
          <span className="text-purple-400">- - AI</span>
        </div>
      </div>
      {snapshots.length < 3 ? (
        <TextFallback snapshots={snapshots} />
      ) : (
        <SVGChart snapshots={snapshots} />
      )}
    </div>
  );
}
