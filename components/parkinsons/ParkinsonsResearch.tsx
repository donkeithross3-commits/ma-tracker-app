"use client";

import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Filter,
  FlaskConical,
  Heart,
  Info,
  Shield,
  Syringe,
  Target,
  ChevronDown,
  ChevronUp,
  Home,
} from "lucide-react";
import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────────────

interface ActionItem {
  id: string;
  priority: "highest" | "high" | "medium" | "creative";
  title: string;
  description: string;
  contact: string;
  deadline: string;
  status: "pending" | "in-progress" | "completed";
  date_added: string;
  date_resolved: string | null;
}

interface TrackedTherapy {
  id: string;
  name: string;
  category: string;
  target: string;
  mechanism: string;
  evidence_tier: number;
  status: string;
  latest_update: string;
  relevance_to_patient: string;
  clinicaltrials_id: string | null;
  source_urls: string[];
  last_checked: string;
}

interface ResearchUpdate {
  id: string;
  date: string;
  title: string;
  summary: string;
  evidence_tier: number | null;
  category: string;
  source_urls: string[];
  implications_for_patient: string;
}

interface DiagnosticRecommendation {
  id: string;
  test: string;
  purpose: string;
  availability: string;
  status: "recommended" | "scheduled" | "completed" | "results-received";
  date_recommended: string;
}

interface PatientProfile {
  diagnosis: string;
  confirmed_pathology: string[];
  clinical_features: string[];
  suspected_pathology: string[];
  therapeutic_framing: string;
}

interface ResearchData {
  last_updated: string;
  patient_profile: PatientProfile;
  action_items: ActionItem[];
  tracked_therapies: TrackedTherapy[];
  research_updates: ResearchUpdate[];
  diagnostic_recommendations: DiagnosticRecommendation[];
}

// ─── Evidence Tier Helpers ─────────────────────────────────────────────

const EVIDENCE_TIERS: Record<
  number,
  { label: string; color: string; bg: string; icon: string }
> = {
  1: {
    label: "Published Phase 2/3",
    color: "text-green-400",
    bg: "bg-green-500/20 border-green-500/30",
    icon: "🟢",
  },
  2: {
    label: "Active Clinical Trial",
    color: "text-blue-400",
    bg: "bg-blue-500/20 border-blue-500/30",
    icon: "🔵",
  },
  3: {
    label: "Peer-Reviewed Preclinical",
    color: "text-yellow-400",
    bg: "bg-yellow-500/20 border-yellow-500/30",
    icon: "🟡",
  },
  4: {
    label: "Conference / Preprint",
    color: "text-orange-400",
    bg: "bg-orange-500/20 border-orange-500/30",
    icon: "🟠",
  },
  5: {
    label: "Theoretical / Emerging",
    color: "text-gray-400",
    bg: "bg-gray-500/20 border-gray-500/30",
    icon: "⚪",
  },
};

function EvidenceBadge({ tier }: { tier: number | null }) {
  if (tier === null) return null;
  const info = EVIDENCE_TIERS[tier];
  if (!info) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border ${info.bg} ${info.color}`}
    >
      <span>{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
}

// ─── Priority Helpers ──────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  string,
  { border: string; bg: string; text: string; label: string }
> = {
  highest: {
    border: "border-red-500",
    bg: "bg-red-500/10",
    text: "text-red-400",
    label: "URGENT",
  },
  high: {
    border: "border-amber-500",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    label: "HIGH",
  },
  medium: {
    border: "border-blue-500",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    label: "MEDIUM",
  },
  creative: {
    border: "border-purple-500",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    label: "EXPLORATORY",
  },
};

// ─── Category Labels ───────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  active_immunotherapy: "Active Immunotherapy (Vaccine)",
  passive_immunotherapy: "Passive Immunotherapy (Antibody)",
  small_molecule: "Small Molecule",
  neuroprotection: "Neuroprotection",
  gene_therapy: "Gene Therapy / ASO",
  delivery_technology: "Delivery Technology",
};

const TARGET_LABELS: Record<string, { label: string; color: string }> = {
  "alpha-synuclein": { label: "α-Synuclein", color: "text-emerald-400" },
  tau: { label: "Tau", color: "text-violet-400" },
  "alpha-synuclein (gene silencing)": {
    label: "α-Syn (Gene)",
    color: "text-emerald-400",
  },
  "GLP-1 receptor (neuroprotection)": {
    label: "GLP-1R",
    color: "text-cyan-400",
  },
  "Blood-brain barrier (delivery enhancement)": {
    label: "BBB Delivery",
    color: "text-orange-400",
  },
};

// ─── Status Icons ──────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  recommended: Circle,
  scheduled: Clock,
  completed: CheckCircle2,
  "results-received": CheckCircle2,
};

// ─── Section Components ────────────────────────────────────────────────

function MedicalDisclaimer() {
  return (
    <div className="sticky top-0 z-50 bg-amber-900/90 backdrop-blur-sm border-b-2 border-amber-500 px-4 py-3">
      <div className="max-w-[1400px] mx-auto flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
        <p className="text-amber-100 text-base font-medium">
          <strong>Medical Disclaimer:</strong> This page is for informational
          purposes only. All treatment decisions must be made in consultation
          with qualified neurologists and movement disorder specialists. Clinical
          trial eligibility requires medical evaluation.
        </p>
      </div>
    </div>
  );
}

function ActionItemCard({
  item,
  onToggleStatus,
}: {
  item: ActionItem;
  onToggleStatus: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
  const isCompleted = item.status === "completed";

  return (
    <Card
      className={`border-2 ${config.border} ${config.bg} ${isCompleted ? "opacity-60" : ""}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-bold uppercase tracking-wider ${config.text}`}
              >
                {config.label}
              </span>
              {isCompleted && (
                <Badge
                  variant="outline"
                  className="text-green-400 border-green-500"
                >
                  Done
                </Badge>
              )}
            </div>
            <CardTitle className="text-lg leading-tight text-white">
              {item.title}
            </CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 min-h-[44px] min-w-[44px]"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        <CardDescription className="text-base text-gray-300 mt-1">
          <strong className="text-amber-300">Deadline:</strong> {item.deadline}
        </CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          <p className="text-base text-gray-300 leading-relaxed">
            {item.description}
          </p>
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <p className="text-sm text-gray-400 font-medium mb-1">Contact:</p>
            <p className="text-base text-gray-200">{item.contact}</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant={isCompleted ? "outline" : "default"}
              className={`min-h-[48px] text-base font-medium ${
                isCompleted
                  ? ""
                  : "bg-green-600 hover:bg-green-700 text-white"
              }`}
              onClick={() => onToggleStatus(item.id)}
            >
              {isCompleted ? (
                <>
                  <Circle className="h-4 w-4 mr-2" /> Mark as Pending
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Mark as Done
                </>
              )}
            </Button>
            <span className="text-xs text-gray-500">
              Added {item.date_added}
            </span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ActionItemsSection({
  items,
  onToggleStatus,
}: {
  items: ActionItem[];
  onToggleStatus: (id: string) => void;
}) {
  const sorted = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      highest: 0,
      high: 1,
      medium: 2,
      creative: 3,
    };
    return [...items].sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      return (
        (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)
      );
    });
  }, [items]);

  const pendingCount = items.filter((i) => i.status !== "completed").length;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Target className="h-6 w-6 text-red-400" />
        <h2 className="text-2xl font-bold text-white">
          Action Items
        </h2>
        <Badge variant="destructive" className="text-sm">
          {pendingCount} pending
        </Badge>
      </div>
      <p className="text-base text-gray-400 mb-4">
        Things to DO — discuss with the neurologist, contact trial sites, request
        tests. Sorted by urgency.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {sorted.map((item) => (
          <ActionItemCard
            key={item.id}
            item={item}
            onToggleStatus={onToggleStatus}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Therapies Table ───────────────────────────────────────────────────

function TherapiesSection({
  therapies,
}: {
  therapies: TrackedTherapy[];
}) {
  const [targetFilter, setTargetFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const targets = useMemo(() => {
    const set = new Set(therapies.map((t) => t.target));
    return Array.from(set).sort();
  }, [therapies]);

  const filtered = useMemo(() => {
    let result = [...therapies];
    if (targetFilter !== "all") {
      result = result.filter((t) => t.target === targetFilter);
    }
    if (tierFilter !== "all") {
      result = result.filter((t) => t.evidence_tier === parseInt(tierFilter));
    }
    result.sort((a, b) => a.evidence_tier - b.evidence_tier);
    return result;
  }, [therapies, targetFilter, tierFilter]);

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Syringe className="h-6 w-6 text-blue-400" />
        <h2 className="text-2xl font-bold text-white">
          Tracked Therapies
        </h2>
        <Badge className="bg-blue-500/20 text-blue-400 text-sm">
          {therapies.length} therapies
        </Badge>
      </div>
      <p className="text-base text-gray-400 mb-4">
        All therapies under investigation. Filter by target protein or evidence
        strength. Strongest evidence first.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Filter className="h-4 w-4 text-gray-500" />

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400 font-medium">Target:</label>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base text-gray-200 min-h-[44px]"
          >
            <option value="all">All Targets</option>
            {targets.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABELS[t]?.label || t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400 font-medium">Evidence:</label>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base text-gray-200 min-h-[44px]"
          >
            <option value="all">All Tiers</option>
            {[1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={t}>
                {EVIDENCE_TIERS[t]?.icon} {EVIDENCE_TIERS[t]?.label}
              </option>
            ))}
          </select>
        </div>

        {(targetFilter !== "all" || tierFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px] text-base"
            onClick={() => {
              setTargetFilter("all");
              setTierFilter("all");
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Therapy Cards — better for comfort mode than a dense table */}
      <div className="space-y-3">
        {filtered.map((therapy) => {
          const isExpanded = expandedId === therapy.id;
          const targetInfo = TARGET_LABELS[therapy.target];

          return (
            <div
              key={therapy.id}
              className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden"
            >
              {/* Compact header row */}
              <button
                onClick={() =>
                  setExpandedId(isExpanded ? null : therapy.id)
                }
                className="w-full text-left px-4 py-3 hover:bg-gray-800/50 transition-colors min-h-[56px] flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold text-white">
                      {therapy.name}
                    </span>
                    <span
                      className={`text-sm font-medium ${targetInfo?.color || "text-gray-400"}`}
                    >
                      {targetInfo?.label || therapy.target}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5 truncate">
                    {therapy.status}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <EvidenceBadge tier={therapy.evidence_tier} />
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-800 space-y-3">
                  <div className="grid gap-3 mt-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Category
                      </p>
                      <p className="text-base text-gray-200">
                        {CATEGORY_LABELS[therapy.category] || therapy.category}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                        Status
                      </p>
                      <p className="text-base text-gray-200">
                        {therapy.status}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                      Mechanism
                    </p>
                    <p className="text-base text-gray-300 leading-relaxed">
                      {therapy.mechanism}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                      Latest Update
                    </p>
                    <p className="text-base text-gray-300 leading-relaxed">
                      {therapy.latest_update}
                    </p>
                  </div>

                  <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-1">
                      Relevance to Patient
                    </p>
                    <p className="text-base text-blue-200 leading-relaxed">
                      {therapy.relevance_to_patient}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {therapy.clinicaltrials_id && (
                      <a
                        href={`https://clinicaltrials.gov/study/${therapy.clinicaltrials_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-3 bg-cyan-500/10 rounded-lg"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        ClinicalTrials.gov
                      </a>
                    )}
                    {therapy.source_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-300 min-h-[44px] px-3 bg-gray-800 rounded-lg"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Source {i + 1}
                      </a>
                    ))}
                  </div>

                  <p className="text-xs text-gray-600">
                    Last checked: {therapy.last_checked}
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-base">
            No therapies match the current filters.
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Research Timeline ─────────────────────────────────────────────────

function ResearchTimeline({ updates }: { updates: ResearchUpdate[] }) {
  const sorted = useMemo(
    () => [...updates].sort((a, b) => b.date.localeCompare(a.date)),
    [updates]
  );

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <FlaskConical className="h-6 w-6 text-purple-400" />
        <h2 className="text-2xl font-bold text-white">
          Research Timeline
        </h2>
      </div>
      <p className="text-base text-gray-400 mb-4">
        Newest research developments first. This timeline grows daily as the
        autonomous research loop discovers new findings.
      </p>

      <div className="space-y-4">
        {sorted.map((update) => (
          <Card key={update.id} className="border-gray-700 bg-gray-900">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-500 font-mono">
                  {update.date}
                </span>
                <EvidenceBadge tier={update.evidence_tier} />
                <Badge
                  variant="outline"
                  className="text-gray-400 border-gray-600 text-sm"
                >
                  {update.category}
                </Badge>
              </div>
              <CardTitle className="text-lg mt-2">{update.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-base text-gray-300 leading-relaxed">
                {update.summary}
              </p>

              {update.implications_for_patient && (
                <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-1">
                    What This Means for the Patient
                  </p>
                  <p className="text-base text-emerald-200 leading-relaxed">
                    {update.implications_for_patient}
                  </p>
                </div>
              )}

              {update.source_urls.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-400 py-2 min-h-[44px] flex items-center">
                    {update.source_urls.length} source
                    {update.source_urls.length !== 1 ? "s" : ""}
                  </summary>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {update.source_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:text-cyan-300 underline break-all"
                      >
                        {new URL(url).hostname}
                      </a>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ─── Diagnostic Roadmap ────────────────────────────────────────────────

function DiagnosticRoadmap({
  recommendations,
  onToggleDiagnostic,
}: {
  recommendations: DiagnosticRecommendation[];
  onToggleDiagnostic: (id: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Shield className="h-6 w-6 text-teal-400" />
        <h2 className="text-2xl font-bold text-white">
          Diagnostic Roadmap
        </h2>
      </div>
      <p className="text-base text-gray-400 mb-4">
        Recommended tests to clarify the dual proteinopathy, quantify disease
        burden, and unlock trial eligibility. Check off as completed.
      </p>

      <div className="space-y-3">
        {recommendations.map((rec) => {
          const isComplete =
            rec.status === "completed" || rec.status === "results-received";
          const StatusIcon = STATUS_ICONS[rec.status] || Circle;

          return (
            <div
              key={rec.id}
              className={`bg-gray-900 border rounded-xl p-4 flex gap-4 items-start ${
                isComplete
                  ? "border-green-500/30 opacity-75"
                  : "border-gray-700"
              }`}
            >
              <button
                onClick={() => onToggleDiagnostic(rec.id)}
                className="shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors"
                aria-label={
                  isComplete ? "Mark as pending" : "Mark as completed"
                }
              >
                <StatusIcon
                  className={`h-6 w-6 ${
                    isComplete ? "text-green-400" : "text-gray-500"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <h3
                  className={`text-lg font-semibold ${
                    isComplete
                      ? "text-gray-500 line-through"
                      : "text-white"
                  }`}
                >
                  {rec.test}
                </h3>
                <p className="text-base text-gray-300 mt-1 leading-relaxed">
                  {rec.purpose}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  <strong>Availability:</strong> {rec.availability}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-sm ${
                  isComplete
                    ? "text-green-400 border-green-500/40"
                    : "text-gray-400 border-gray-600"
                }`}
              >
                {rec.status}
              </Badge>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Patient Context ───────────────────────────────────────────────────

function PatientContext({
  profile,
  collapsed,
  onToggle,
}: {
  profile: PatientProfile;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        className="flex items-center gap-3 mb-4 w-full text-left min-h-[44px]"
      >
        <Heart className="h-6 w-6 text-rose-400" />
        <h2 className="text-2xl font-bold text-white">
          Patient Context
        </h2>
        {collapsed ? (
          <ChevronDown className="h-5 w-5 text-gray-500" />
        ) : (
          <ChevronUp className="h-5 w-5 text-gray-500" />
        )}
      </button>

      {!collapsed && (
        <Card className="border-gray-700 bg-gray-900">
          <CardContent className="pt-6 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                Diagnosis
              </p>
              <p className="text-lg font-semibold text-white">
                {profile.diagnosis}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-2">
                  Confirmed Pathology
                </p>
                {profile.confirmed_pathology.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-base text-emerald-200"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    {p}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-violet-400 uppercase tracking-wider mb-2">
                  Suspected Pathology
                </p>
                {profile.suspected_pathology.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-base text-violet-200"
                  >
                    <Info className="h-4 w-4 text-violet-400" />
                    {p}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Clinical Features
              </p>
              <div className="flex flex-wrap gap-2">
                {profile.clinical_features.map((f, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-base px-3 py-1 text-gray-300 border-gray-600"
                  >
                    {f}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-r from-emerald-900/20 to-violet-900/20 border border-emerald-500/20 rounded-lg p-4">
              <p className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-2">
                Why Dual Proteinopathy Is an Opportunity
              </p>
              <p className="text-base text-gray-200 leading-relaxed">
                {profile.therapeutic_framing}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

// ─── Evidence Tier Legend ───────────────────────────────────────────────

function EvidenceLegend() {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
        Evidence Tier Guide
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(EVIDENCE_TIERS).map(([tier, info]) => (
          <div
            key={tier}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${info.bg}`}
          >
            <span>{info.icon}</span>
            <span className={`text-sm font-medium ${info.color}`}>
              {info.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export default function ParkinsonsResearch({
  data,
}: {
  data: ResearchData;
}) {
  const [actionItems, setActionItems] = useState(data.action_items);
  const [diagnostics, setDiagnostics] = useState(
    data.diagnostic_recommendations
  );
  const [contextCollapsed, setContextCollapsed] = useState(true);

  const handleToggleAction = useCallback((id: string) => {
    setActionItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status:
                item.status === "completed"
                  ? ("pending" as const)
                  : ("completed" as const),
              date_resolved:
                item.status === "completed"
                  ? null
                  : new Date().toISOString().split("T")[0],
            }
          : item
      )
    );
  }, []);

  const handleToggleDiagnostic = useCallback((id: string) => {
    setDiagnostics((prev) =>
      prev.map((rec) =>
        rec.id === id
          ? {
              ...rec,
              status:
                rec.status === "completed"
                  ? ("recommended" as const)
                  : ("completed" as const),
            }
          : rec
      )
    );
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <MedicalDisclaimer />

      <div className="max-w-[1400px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href="/"
                className="text-gray-500 hover:text-gray-300 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors"
                aria-label="Home"
              >
                <Home className="h-5 w-5" />
              </Link>
              <h1 className="text-3xl font-bold text-white">
                Parkinson&apos;s &amp; PSP Research
              </h1>
            </div>
            <p className="text-base text-gray-400">
              Dual proteinopathy treatment landscape — daily autonomous updates
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-600">Last updated</p>
            <p className="text-sm text-gray-400 font-mono">
              {new Date(data.last_updated).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Evidence Legend */}
        <EvidenceLegend />

        {/* Main Content */}
        <div className="mt-6 space-y-10">
          <ActionItemsSection
            items={actionItems}
            onToggleStatus={handleToggleAction}
          />

          <TherapiesSection therapies={data.tracked_therapies} />

          <ResearchTimeline updates={data.research_updates} />

          <DiagnosticRoadmap
            recommendations={diagnostics}
            onToggleDiagnostic={handleToggleDiagnostic}
          />

          <PatientContext
            profile={data.patient_profile}
            collapsed={contextCollapsed}
            onToggle={() => setContextCollapsed((p) => !p)}
          />
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-gray-800 text-center">
          <p className="text-sm text-gray-600">
            This page is maintained by an autonomous research agent that monitors
            ClinicalTrials.gov, PubMed, CurePSP, and other sources daily.
          </p>
          <p className="text-xs text-gray-700 mt-2">
            DR3 Dashboard &middot; Parkinson&apos;s Research Module
          </p>
        </footer>
      </div>
    </div>
  );
}
