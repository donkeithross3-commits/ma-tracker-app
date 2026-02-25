export type ProvenanceType = "ai" | "live" | "prior-close" | "sheet" | "filing" | "computed";

export function ProvenancePill({ type }: { type: ProvenanceType }) {
  if (type === "ai") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>;
  }
  if (type === "live") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium">LIVE</span>;
  }
  if (type === "sheet") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">SHEET</span>;
  }
  if (type === "filing") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">FILING</span>;
  }
  if (type === "computed") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 font-medium">COMPUTED</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-500 font-medium">PRIOR CLOSE</span>;
}
