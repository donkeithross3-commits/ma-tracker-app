export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "\u2014";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "\u2014";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

export function fmtOverhead(ratio: number): string {
  if (ratio >= 100) return `${Math.round(ratio)}:1`;
  if (ratio >= 10) return `${ratio.toFixed(0)}:1`;
  if (ratio >= 1) return `${ratio.toFixed(1)}:1`;
  return `${ratio.toFixed(2)}:1`;
}

export function overheadColor(ratio: number): string {
  if (ratio > 10) return "text-red-400";
  if (ratio > 3) return "text-amber-400";
  return "text-emerald-400";
}

export function quotaColor(pct: number): string {
  if (pct >= 80) return "text-red-400";
  if (pct >= 60) return "text-amber-400";
  return "text-emerald-400";
}

export function quotaBarColor(pct: number): string {
  if (pct >= 80) return "bg-red-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-emerald-500";
}

/** Color for auto-budget remaining (inverted: high remaining = good). */
export function autoBudgetColor(remainingPct: number): string {
  if (remainingPct <= 20) return "text-red-400";
  if (remainingPct <= 50) return "text-amber-400";
  return "text-emerald-400";
}

export function autoBudgetBarColor(remainingPct: number): string {
  if (remainingPct <= 20) return "bg-red-500";
  if (remainingPct <= 50) return "bg-amber-500";
  return "bg-emerald-500";
}
