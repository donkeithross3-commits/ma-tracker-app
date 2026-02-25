"use client";

import { useEffect, useState } from "react";

interface AccuracyData {
  days_tracked: number;
  first_estimate_date: string | null;
  last_estimate_date: string | null;
  outcome: string;
  sheet_brier: number | null;
  ai_brier: number | null;
  prob_success_winner: string;
  sheet_score: number | null;
  ai_score: number | null;
  overall_winner: string;
}

function WinnerBadge({ winner }: { winner: string }) {
  if (winner === "ai") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">
        AI Wins
      </span>
    );
  }
  if (winner === "sheet") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
        Sheet Wins
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 font-medium">
      Tie
    </span>
  );
}

export function AccuracyScoreboard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAccuracy() {
      try {
        const res = await fetch(
          `/api/sheet-portfolio/v2/deal/${ticker}/accuracy`
        );
        if (res.ok) {
          const json = await res.json();
          setData(json.accuracy);
        }
      } catch {
        // Silently fail — accuracy data is optional
      } finally {
        setLoading(false);
      }
    }
    fetchAccuracy();
  }, [ticker]);

  if (loading) return null;
  if (!data) return null;

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Prediction Accuracy
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Sheet Brier
          </div>
          <div className="text-lg font-mono font-bold text-gray-200">
            {data.sheet_brier !== null ? data.sheet_brier.toFixed(3) : "-"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            AI Brier
          </div>
          <div className="text-lg font-mono font-bold text-gray-200">
            {data.ai_brier !== null ? data.ai_brier.toFixed(3) : "-"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Winner
          </div>
          <WinnerBadge winner={data.overall_winner} />
        </div>
        <div className="text-center">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Days Tracked
          </div>
          <div className="text-lg font-mono font-bold text-gray-200">
            {data.days_tracked}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-gray-600 text-center">
        Outcome: {data.outcome.replace(/_/g, " ")}
      </div>
    </div>
  );
}
