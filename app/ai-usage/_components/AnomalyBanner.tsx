import type { Anomaly } from "../_lib/types";

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-red-600/40 bg-red-950/30 text-red-300",
  medium: "border-amber-600/40 bg-amber-950/30 text-amber-300",
  low: "border-gray-600/40 bg-gray-900 text-gray-300",
};

export function AnomalyBanner({ anomalies }: { anomalies: Anomaly[] | undefined }) {
  if (!anomalies || anomalies.length === 0) return null;

  const maxSeverity = anomalies.some((a) => a.severity === "high")
    ? "high"
    : anomalies.some((a) => a.severity === "medium")
      ? "medium"
      : "low";

  return (
    <div className={`rounded border px-3 py-2 ${SEVERITY_STYLES[maxSeverity]}`}>
      <div className="flex items-center gap-2 text-sm font-medium mb-1">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"} detected
      </div>
      <ul className="text-xs opacity-80 space-y-0.5">
        {anomalies.map((a, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${
              a.severity === "high" ? "bg-red-400" : a.severity === "medium" ? "bg-amber-400" : "bg-gray-400"
            }`} />
            {a.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
