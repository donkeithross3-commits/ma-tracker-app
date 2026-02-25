import { gradeStyle } from "./GradeBadge";

export function GradeFactorCard({ label, grade, confidence, detail }: {
  label: string;
  grade: string | null;
  confidence: number | null;
  detail: string | null;
}) {
  if (!grade) return null;
  const style = gradeStyle(grade);

  return (
    <div className="bg-gray-800/50 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>{grade}</span>
      </div>
      {confidence != null && (
        <div className="w-full bg-gray-700 rounded-full h-1 mb-1.5" title={`Confidence: ${(confidence * 100).toFixed(0)}%`}>
          <div className="h-1 rounded-full bg-blue-400" style={{ width: `${confidence * 100}%` }} />
        </div>
      )}
      {detail && <p className="text-xs text-gray-500 line-clamp-2">{detail}</p>}
    </div>
  );
}
