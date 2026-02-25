"use client";

interface Milestone {
  id: string;
  type: string;
  date: string | null;
  expected_date: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  risk_factor_affected: string | null;
}

interface DealTimelineProps {
  milestones: Milestone[];
  announcedDate: string | null;
  expectedCloseDate: string | null;
  outsideDate: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  announcement: "Announced",
  hsr_filing: "HSR Filed",
  hsr_clearance: "HSR Cleared",
  hsr_second_request: "2nd Request",
  eu_phase1: "EU Phase I",
  eu_phase2: "EU Phase II",
  cfius_filing: "CFIUS Filed",
  cfius_clearance: "CFIUS Cleared",
  other_regulatory: "Reg. Review",
  proxy_filing: "Proxy Filed",
  shareholder_vote: "Vote",
  go_shop_start: "Go-Shop Start",
  go_shop_end: "Go-Shop End",
  financing_committed: "Financing",
  closing: "Closing",
  outside_date: "Outside Date",
  termination: "Terminated",
  extension: "Extended",
  other: "Other",
};

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-500";
    case "pending":
      return "bg-gray-500";
    case "failed":
      return "bg-red-500";
    case "extended":
      return "bg-yellow-500";
    case "waived":
      return "bg-blue-500";
    default:
      return "bg-gray-600";
  }
}

function statusTextColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-400";
    case "pending":
      return "text-gray-400";
    case "failed":
      return "text-red-400";
    case "extended":
      return "text-yellow-400";
    case "waived":
      return "text-blue-400";
    default:
      return "text-gray-500";
  }
}

function formatDate(d: string | null): string {
  if (!d) return "TBD";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DealTimeline({
  milestones,
  announcedDate,
  expectedCloseDate,
  outsideDate,
}: DealTimelineProps) {
  // Build timeline nodes: announced + milestones + close + outside date
  const nodes: {
    label: string;
    date: string | null;
    status: string;
    isKey?: boolean;
  }[] = [];

  // Announcement
  nodes.push({
    label: "Announced",
    date: announcedDate,
    status: announcedDate ? "completed" : "pending",
    isKey: true,
  });

  // Add milestones (skip announcement type if already shown)
  for (const m of milestones) {
    if (m.type === "announcement") continue;
    if (m.type === "outside_date") continue;
    if (m.type === "closing") continue;
    nodes.push({
      label: TYPE_LABELS[m.type] || m.type,
      date: m.date || m.expected_date,
      status: m.status,
    });
  }

  // Expected close
  nodes.push({
    label: "Close",
    date: expectedCloseDate,
    status: expectedCloseDate ? "pending" : "pending",
    isKey: true,
  });

  // Outside date
  if (outsideDate) {
    nodes.push({
      label: "Outside",
      date: outsideDate,
      status: "pending",
      isKey: true,
    });
  }

  if (nodes.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No timeline data available
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Deal Timeline
      </h3>
      <div className="relative flex items-center gap-0 overflow-x-auto pb-2">
        {nodes.map((node, i) => (
          <div key={i} className="flex items-center">
            {/* Node */}
            <div className="flex flex-col items-center min-w-[72px]">
              <div
                className={`w-3 h-3 rounded-full ${statusColor(node.status)} ${
                  node.isKey ? "ring-2 ring-offset-1 ring-offset-gray-900" : ""
                } ${node.status === "completed" ? "ring-green-500/30" : "ring-gray-600/30"}`}
              />
              <div
                className={`text-[10px] mt-1 font-medium ${statusTextColor(
                  node.status
                )}`}
              >
                {node.label}
              </div>
              <div className="text-[10px] text-gray-500 font-mono">
                {formatDate(node.date)}
              </div>
            </div>
            {/* Connector line */}
            {i < nodes.length - 1 && (
              <div
                className={`h-px flex-1 min-w-[20px] ${
                  node.status === "completed"
                    ? "bg-green-500/40"
                    : "bg-gray-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
