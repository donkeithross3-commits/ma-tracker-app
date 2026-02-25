export interface Disagreement {
  factor: string;
  sheet_says: string;
  ai_says: string;
  severity: string;
  is_new: boolean;
  evidence: Array<{ source: string; date: string; detail: string }>;
  reasoning: string;
}

export function ProductionDisagreements({ disagreements }: {
  disagreements: Disagreement[];
}) {
  if (!disagreements || disagreements.length === 0) return null;

  const severityStyle = (s: string) => {
    if (s === "material") return "bg-red-400/15 text-red-400";
    if (s === "notable") return "bg-amber-400/15 text-amber-400";
    return "bg-gray-700 text-gray-400";
  };

  return (
    <div className="mb-3 p-2 bg-amber-400/5 border border-amber-600/20 rounded">
      <h4 className="text-xs font-medium text-amber-400 mb-1.5">
        AI Disagreements ({disagreements.length})
      </h4>
      <div className="space-y-2">
        {disagreements.map((d, i) => (
          <div key={i} className="text-xs bg-gray-800/60 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1">
              {d.factor === "timing" && <span title="Timeline Mismatch">&#x23F0;</span>}
              <span className="font-medium text-gray-200 capitalize">{d.factor}</span>
              <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${severityStyle(d.severity)}`}>
                {d.severity}
              </span>
              {d.is_new && (
                <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-400/15 text-blue-400">NEW</span>
              )}
            </div>
            <div className="text-gray-400 mb-1">
              <span className="text-gray-500">Sheet:</span> {d.sheet_says}
              <span className="mx-1.5 text-gray-600">&rarr;</span>
              <span className="text-amber-300">AI:</span> {d.ai_says}
            </div>
            {d.reasoning && <p className="text-gray-500 mb-1">{d.reasoning}</p>}
            {Array.isArray(d.evidence) && d.evidence.length > 0 && (
              <div className="space-y-0.5 mt-1 pl-2 border-l border-gray-700">
                {d.evidence.map((e, j) => (
                  <div key={j} className="text-[11px] text-gray-500">
                    <span className="text-gray-400">{e.source}</span>
                    {e.date && <span className="text-gray-600 ml-1">({e.date})</span>}
                    {e.detail && <span className="ml-1">- {e.detail}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
