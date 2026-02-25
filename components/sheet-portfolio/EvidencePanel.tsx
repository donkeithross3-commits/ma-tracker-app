"use client";

import { useState } from "react";

interface EvidenceItem {
  source: string;
  date: string;
  detail: string;
}

interface EvidencePanelProps {
  evidence: EvidenceItem[];
  reasoning?: string;
  bamsecUrl?: string;
}

export function EvidencePanel({
  evidence,
  reasoning,
  bamsecUrl,
}: EvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!evidence || evidence.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
          &#9654;
        </span>
        {evidence.length} source{evidence.length !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l border-gray-800 space-y-2">
          {evidence.map((e, i) => (
            <div key={i} className="text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-orange-400 font-medium">{e.source}</span>
                <span className="text-gray-600">{e.date}</span>
              </div>
              <div className="text-gray-400 mt-0.5">{e.detail}</div>
            </div>
          ))}
          {reasoning && (
            <div className="text-[11px] text-gray-500 italic mt-1 pt-1 border-t border-gray-800/50">
              {reasoning}
            </div>
          )}
          {bamsecUrl && (
            <a
              href={bamsecUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              View filings on BamSEC
            </a>
          )}
        </div>
      )}
    </div>
  );
}
