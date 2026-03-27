import { fmtCost } from "../_lib/formatters";
import { AGENT_COLORS } from "../_lib/constants";

export function MachineAgentMatrix({
  matrix,
}: {
  matrix: Record<string, Record<string, number>> | undefined;
}) {
  if (!matrix || Object.keys(matrix).length === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-gray-200 mb-2">Machine x Agent</h2>
        <p className="text-gray-500 text-sm">No data.</p>
      </div>
    );
  }

  const machines = Object.keys(matrix).sort();
  const agentSet = new Set<string>();
  for (const agents of Object.values(matrix)) {
    for (const agent of Object.keys(agents)) agentSet.add(agent);
  }
  const agents = Array.from(agentSet).sort();

  // Find max cell value for color intensity
  let maxVal = 0;
  for (const m of machines) {
    for (const a of agents) {
      const v = matrix[m]?.[a] ?? 0;
      if (v > maxVal) maxVal = v;
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-2">Machine x Agent</h2>
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `72px repeat(${agents.length}, 1fr)` }}
      >
        {/* Header row */}
        <div />
        {agents.map((a) => (
          <div
            key={a}
            className={`text-[9px] text-center truncate px-0.5 py-0.5 ${AGENT_COLORS[a] || "text-gray-400"}`}
            title={a}
          >
            {a.replace("parkinsons-research", "parkinsons").replace("-", "\u200B-")}
          </div>
        ))}

        {/* Data rows */}
        {machines.map((m) => (
          <>
            <div key={`label-${m}`} className="text-xs text-gray-400 font-mono py-1 pr-1 text-right">
              {m}
            </div>
            {agents.map((a) => {
              const cost = matrix[m]?.[a] ?? 0;
              const intensity = maxVal > 0 ? cost / maxVal : 0;
              return (
                <div
                  key={`${m}-${a}`}
                  className="text-center text-[10px] font-mono py-1 rounded-sm"
                  style={{
                    backgroundColor: cost > 0
                      ? `rgba(59, 130, 246, ${Math.max(intensity * 0.7, 0.08)})`
                      : "transparent",
                  }}
                  title={`${m} / ${a}: ${fmtCost(cost)}`}
                >
                  {cost > 0 ? fmtCost(cost) : ""}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
