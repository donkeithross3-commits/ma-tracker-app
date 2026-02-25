"use client";

import { useState, useRef, useEffect } from "react";

export function SupplementalScoreCard({ label, score, detail, hasDisagreement }: {
  label: string;
  score: number | null;
  detail: string | null;
  hasDisagreement?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, [detail]);

  if (score === null) return null;

  let barColor = "bg-green-400";
  if (score >= 8) barColor = "bg-red-400";
  else if (score >= 6) barColor = "bg-orange-400";
  else if (score >= 4) barColor = "bg-yellow-400";
  else if (score >= 2) barColor = "bg-lime-400";

  return (
    <div className={`bg-gray-800/50 rounded p-2 ${hasDisagreement ? "border border-amber-500/40" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-400">
          {label}
          {hasDisagreement && <span className="ml-1 text-amber-400" title="AI disagrees with sheet timing">&#x23F0;</span>}
        </span>
        <span className="text-xs font-mono font-bold text-gray-200">{score.toFixed(1)}/10</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1 mb-1.5">
        <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${(score / 10) * 100}%` }} />
      </div>
      {detail && (
        <>
          <p
            ref={textRef}
            className={`text-xs text-gray-500 ${expanded ? "" : "line-clamp-2"}`}
          >
            {detail}
          </p>
          {(isClamped || expanded) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-gray-600 hover:text-gray-300 transition-colors flex items-center gap-1 mt-1"
            >
              <span className={`transition-transform inline-block ${expanded ? "rotate-90" : ""}`}>
                &#9654;
              </span>
              {expanded ? "Less" : "More"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
