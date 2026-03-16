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
  ClipboardList,
  Clock,
  Copy,
  Dna,
  ExternalLink,
  Filter,
  FlaskConical,
  Heart,
  Info,
  Phone,
  Mail,
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

interface TrialContact {
  name: string;
  phone: string;
  email: string;
  role: string;
}

interface TrialStep {
  id: string;
  title: string;
  description: string;
  status: string;
}

interface TrialEligibility {
  requirement: string;
  dad_status: string;
  met: string;
}

interface TrialEnrollmentGuideData {
  trial_name: string;
  trial_id: string;
  status_note: string;
  why_this_trial: string;
  key_insight: string;
  contacts: {
    enrollment_center: TrialContact;
    curepsp_hopeline: TrialContact;
  };
  what_to_say: string;
  steps: TrialStep[];
  eligibility: TrialEligibility[];
  trial_benefits: string[];
  source_urls: string[];
}

interface GenomicStep {
  id: string;
  title: string;
  description: string;
  how: string;
  status?: string;
}

interface GenomicPhase {
  id: string;
  phase: string;
  status: string;
  urgency: string;
  steps: GenomicStep[];
}

interface GenomicRoadmapData {
  title: string;
  description: string;
  phases: GenomicPhase[];
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
  genomic_roadmap?: GenomicRoadmapData;
  trial_enrollment_guide?: TrialEnrollmentGuideData;
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

// ─── Text with Auto-Linked URLs ────────────────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s,)]+)/g;

function LinkedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(URL_REGEX);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 break-all"
          >
            {part.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
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

// ─── Trial Enrollment Guide (Hero Section for Mom) ─────────────────────

function TrialEnrollmentGuide({
  guide,
}: {
  guide: TrialEnrollmentGuideData;
}) {
  const [copied, setCopied] = useState(false);
  const [showEligibility, setShowEligibility] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(guide.what_to_say).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }, [guide.what_to_say]);

  return (
    <section className="relative">
      {/* Big hero card */}
      <div className="bg-gradient-to-br from-violet-900/30 via-gray-900 to-blue-900/20 border-2 border-violet-500/50 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-5 border-b border-violet-500/20">
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList className="h-7 w-7 text-violet-400" />
            <h2 className="text-2xl font-bold text-white">
              Trial Enrollment Guide
            </h2>
            <Badge className="bg-red-500/30 text-red-300 border-red-500/40 text-sm font-bold animate-pulse">
              ACT NOW
            </Badge>
          </div>
          <p className="text-lg text-violet-200 font-medium">
            {guide.trial_name}
          </p>
          <p className="text-base text-gray-300 mt-1">
            {guide.why_this_trial}
          </p>
        </div>

        {/* Key Insight Banner */}
        <div className="px-5 py-3 bg-amber-900/30 border-b border-amber-500/20">
          <p className="text-base text-amber-200 leading-relaxed">
            <strong className="text-amber-300">Key:</strong>{" "}
            {guide.key_insight}
          </p>
        </div>

        {/* Two big contact cards side by side */}
        <div className="px-5 py-5">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
            Who to Call
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Enrollment Center */}
            <div className="bg-gray-800/60 border border-violet-500/30 rounded-xl p-4">
              <p className="text-sm text-violet-400 font-bold uppercase tracking-wider mb-2">
                {guide.contacts.enrollment_center.name}
              </p>
              <a
                href={`tel:${guide.contacts.enrollment_center.phone}`}
                className="flex items-center gap-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl px-5 py-4 text-xl font-bold transition-colors min-h-[56px] mb-3"
              >
                <Phone className="h-6 w-6 shrink-0" />
                {guide.contacts.enrollment_center.phone}
              </a>
              <a
                href={`mailto:${guide.contacts.enrollment_center.email}`}
                className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-5 py-3 text-base font-medium transition-colors min-h-[48px] mb-2"
              >
                <Mail className="h-5 w-5 shrink-0" />
                {guide.contacts.enrollment_center.email}
              </a>
              <p className="text-sm text-gray-400 mt-2">
                {guide.contacts.enrollment_center.role}
              </p>
            </div>

            {/* CurePSP */}
            <div className="bg-gray-800/60 border border-blue-500/30 rounded-xl p-4">
              <p className="text-sm text-blue-400 font-bold uppercase tracking-wider mb-2">
                {guide.contacts.curepsp_hopeline.name}
              </p>
              <a
                href={`tel:${guide.contacts.curepsp_hopeline.phone}`}
                className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-5 py-4 text-xl font-bold transition-colors min-h-[56px] mb-3"
              >
                <Phone className="h-6 w-6 shrink-0" />
                {guide.contacts.curepsp_hopeline.phone}
              </a>
              <a
                href={`mailto:${guide.contacts.curepsp_hopeline.email}`}
                className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-5 py-3 text-base font-medium transition-colors min-h-[48px] mb-2"
              >
                <Mail className="h-5 w-5 shrink-0" />
                {guide.contacts.curepsp_hopeline.email}
              </a>
              <p className="text-sm text-gray-400 mt-2">
                {guide.contacts.curepsp_hopeline.role}
              </p>
            </div>
          </div>
        </div>

        {/* What to say — copyable script */}
        <div className="px-5 pb-5">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
            What to Say When You Call
          </h3>
          <div className="bg-gray-800/80 border border-gray-600 rounded-xl p-4 relative">
            <p className="text-base text-gray-200 leading-relaxed italic pr-12">
              &ldquo;{guide.what_to_say}&rdquo;
            </p>
            <button
              onClick={handleCopy}
              className="absolute top-3 right-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <Copy className="h-5 w-5 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 pb-5">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
            Step-by-Step
          </h3>
          <div className="space-y-3">
            {guide.steps.map((step, idx) => (
              <div
                key={step.id}
                className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 flex items-start gap-4"
              >
                <span className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 text-sm font-bold border border-violet-500/30">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-semibold text-white">
                    {step.title}
                  </h4>
                  <p className="text-base text-gray-300 mt-1 leading-relaxed">
                    <LinkedText text={step.description} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expandable: Eligibility */}
        <div className="px-5 pb-3">
          <button
            onClick={() => setShowEligibility(!showEligibility)}
            className="w-full text-left flex items-center justify-between bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3 min-h-[48px] hover:bg-gray-800/60 transition-colors"
          >
            <span className="text-base font-medium text-gray-300">
              Eligibility Requirements &amp; Dad&apos;s Status
            </span>
            {showEligibility ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </button>
          {showEligibility && (
            <div className="mt-3 space-y-2">
              {guide.eligibility.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-3"
                >
                  <p className="text-base text-white font-medium">
                    {item.requirement}
                  </p>
                  <p className="text-sm text-amber-300/80 mt-1">
                    {item.dad_status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expandable: Documentation */}
        <div className="px-5 pb-3">
          <button
            onClick={() => setShowDocs(!showDocs)}
            className="w-full text-left flex items-center justify-between bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3 min-h-[48px] hover:bg-gray-800/60 transition-colors"
          >
            <span className="text-base font-medium text-gray-300">
              What the Trial Covers
            </span>
            {showDocs ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </button>
          {showDocs && (
            <div className="mt-3 space-y-2">
              {guide.trial_benefits.map((benefit, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 bg-emerald-900/20 border border-emerald-500/20 rounded-lg px-4 py-2.5"
                >
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <p className="text-base text-emerald-200">{benefit}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Source links */}
        <div className="px-5 pb-5 pt-2 border-t border-gray-800/50">
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://clinicaltrials.gov/study/${guide.trial_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-3 bg-cyan-500/10 rounded-lg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              ClinicalTrials.gov ({guide.trial_id})
            </a>
            <a
              href="https://www.psp.org/ptp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-3 bg-cyan-500/10 rounded-lg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              CurePSP Trial Page
            </a>
            <p className="text-xs text-gray-600 self-center ml-2">
              {guide.status_note}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Genomic Roadmap ───────────────────────────────────────────────────

const PHASE_STYLES: Record<
  string,
  { border: string; bg: string; accent: string; badge: string }
> = {
  "phase-1": {
    border: "border-rose-500/40",
    bg: "bg-gradient-to-br from-rose-900/20 to-gray-900",
    accent: "text-rose-400",
    badge: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  },
  "phase-2": {
    border: "border-cyan-500/40",
    bg: "bg-gradient-to-br from-cyan-900/20 to-gray-900",
    accent: "text-cyan-400",
    badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  },
  "phase-3": {
    border: "border-emerald-500/40",
    bg: "bg-gradient-to-br from-emerald-900/20 to-gray-900",
    accent: "text-emerald-400",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
};

function GenomicRoadmapSection({
  roadmap,
}: {
  roadmap: GenomicRoadmapData;
}) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(
    "phase-1"
  );

  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <Dna className="h-6 w-6 text-rose-400" />
        <h2 className="text-2xl font-bold text-white">
          Personalized Genomic Medicine
        </h2>
        <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-sm">
          NEW
        </Badge>
      </div>
      <p className="text-base text-gray-400 mb-2">
        {roadmap.description}
      </p>
      <p className="text-sm text-amber-400/80 mb-5 font-medium">
        Step 1 is to get the genetic data — everything else builds on it.
      </p>

      <div className="space-y-4">
        {roadmap.phases.map((phase) => {
          const style =
            PHASE_STYLES[phase.id] || PHASE_STYLES["phase-1"];
          const isExpanded = expandedPhase === phase.id;
          const completedSteps = phase.steps.filter(
            (s) => s.status === "completed"
          ).length;

          return (
            <div
              key={phase.id}
              className={`border rounded-xl overflow-hidden ${style.border} ${style.bg}`}
            >
              {/* Phase header */}
              <button
                onClick={() =>
                  setExpandedPhase(isExpanded ? null : phase.id)
                }
                className="w-full text-left px-5 py-4 hover:bg-white/5 transition-colors min-h-[56px] flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-white">
                      {phase.phase}
                    </h3>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${style.badge}`}
                    >
                      {completedSteps}/{phase.steps.length} steps
                    </span>
                  </div>
                  <p className={`text-sm mt-0.5 ${style.accent} font-medium`}>
                    {phase.urgency}
                  </p>
                </div>
                <div className="shrink-0">
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </div>
              </button>

              {/* Steps */}
              {isExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-white/10">
                  {phase.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold ${style.badge}`}
                        >
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-base font-semibold text-white">
                            {step.title}
                          </h4>
                          <p className="text-base text-gray-300 mt-1 leading-relaxed">
                            <LinkedText text={step.description} />
                          </p>
                          <div className="mt-3 bg-gray-800/80 border border-gray-700/50 rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                              How to do it
                            </p>
                            <p className="text-base text-gray-200 leading-relaxed">
                              <LinkedText text={step.how} />
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
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

        {/* Trial Enrollment Guide — THE most important section */}
        {data.trial_enrollment_guide && (
          <div className="mt-6">
            <TrialEnrollmentGuide guide={data.trial_enrollment_guide} />
          </div>
        )}

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

          {data.genomic_roadmap && (
            <GenomicRoadmapSection roadmap={data.genomic_roadmap} />
          )}

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
