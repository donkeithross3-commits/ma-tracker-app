function gradeStyle(grade: string | null): { text: string; bg: string; border: string } {
  if (!grade) return { text: "text-gray-500", bg: "bg-gray-500/10", border: "border-gray-500/30" };
  const g = grade.toUpperCase();
  if (g === "LOW") return { text: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" };
  if (g === "MEDIUM" || g === "MED") return { text: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" };
  if (g === "HIGH") return { text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" };
  return { text: "text-gray-400", bg: "bg-gray-400/10", border: "border-gray-400/30" };
}

export { gradeStyle };

export function GradeBadge({ grade, label }: { grade: string | null; label: string }) {
  const style = gradeStyle(grade);
  return (
    <div className={`px-3 py-2 rounded border text-center ${style.bg} ${style.border}`}>
      <div className={`text-lg font-bold ${style.text}`}>{grade || "-"}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}
