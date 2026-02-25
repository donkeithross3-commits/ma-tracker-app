import Link from "next/link";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";

/* ─── Table of Contents ─── */
const TOC = [
  { id: "overview", label: "Overview" },
  { id: "enriched-context", label: "Phase 1" },
  { id: "prediction-registry", label: "Phase 2" },
  { id: "calibration-loop", label: "Phase 3" },
  { id: "human-review", label: "Phase 4" },
  { id: "signal-weighting", label: "Phase 5" },
  { id: "smart-routing", label: "Routing" },
  { id: "cost-optimization", label: "Cost" },
  { id: "how-to-use", label: "Usage" },
] as const;

/* ─── Phase color map ─── */
const PHASE_COLORS: Record<
  string,
  { border: string; badgeBg: string; badgeText: string; label: string }
> = {
  overview: {
    border: "border-l-blue-400",
    badgeBg: "bg-blue-500/20",
    badgeText: "text-blue-300",
    label: "System Overview",
  },
  "enriched-context": {
    border: "border-l-blue-500",
    badgeBg: "bg-blue-500/20",
    badgeText: "text-blue-300",
    label: "Phase 1",
  },
  "prediction-registry": {
    border: "border-l-emerald-500",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    label: "Phase 2",
  },
  "calibration-loop": {
    border: "border-l-amber-500",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-300",
    label: "Phase 3",
  },
  "human-review": {
    border: "border-l-purple-500",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-300",
    label: "Phase 4",
  },
  "signal-weighting": {
    border: "border-l-cyan-500",
    badgeBg: "bg-cyan-500/20",
    badgeText: "text-cyan-300",
    label: "Phase 5",
  },
  "smart-routing": {
    border: "border-l-orange-500",
    badgeBg: "bg-orange-500/20",
    badgeText: "text-orange-300",
    label: "Smart Routing",
  },
  "cost-optimization": {
    border: "border-l-green-500",
    badgeBg: "bg-green-500/20",
    badgeText: "text-green-300",
    label: "Cost Optimization",
  },
  "how-to-use": {
    border: "border-l-gray-500",
    badgeBg: "bg-gray-500/20",
    badgeText: "text-gray-300",
    label: "How to Use",
  },
};

/* ─── Helpers ─── */
function Badge({ id }: { id: string }) {
  const c = PHASE_COLORS[id];
  if (!c) return null;
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded ${c.badgeBg} ${c.badgeText}`}
    >
      {c.label}
    </span>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const c = PHASE_COLORS[id];
  return (
    <section
      id={id}
      className={`scroll-mt-24 border-l-4 ${c?.border ?? "border-l-gray-700"} pl-6 py-2`}
    >
      <div className="flex items-center gap-3 mb-4">
        <Badge id={id} />
        <h2 className="text-2xl font-bold tracking-tight text-gray-100">
          {title}
        </h2>
      </div>
      <div className="space-y-4 text-[15px] leading-relaxed text-gray-300">
        {children}
      </div>
    </section>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 font-mono text-sm text-gray-300 overflow-x-auto">
      {children}
    </div>
  );
}

function FlowStep({ label, last }: { label: string; last?: boolean }) {
  return (
    <>
      <div className="flex items-center justify-center px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm font-medium text-gray-200 whitespace-nowrap">
        {label}
      </div>
      {!last && (
        <span className="text-gray-500 text-xl font-light select-none">&rarr;</span>
      )}
    </>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 ml-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-500 flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Page ─── */
export default async function UserGuidePage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-gray-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Prediction System Guide
              </h1>
              <p className="text-xs text-gray-500">
                Prediction-Assessment-Score Loop
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
            <UserMenu
              variant="dark"
              initialUser={session?.user ? { name: session.user.name, email: session.user.email } : undefined}
            />
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Table of Contents */}
        <nav className="mb-12">
          <div className="flex flex-wrap gap-2">
            {TOC.map((item) => {
              const c = PHASE_COLORS[item.id];
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${c?.badgeBg ?? "bg-gray-800"} ${c?.badgeText ?? "text-gray-400"} border-gray-700 hover:border-gray-500 hover:brightness-125`}
                >
                  {item.label}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="space-y-14">
          {/* ── 1. Overview ── */}
          <Section id="overview" title="How It Works">
            <p>
              The Prediction-Assessment-Score Loop is a five-phase AI system that
              monitors M&amp;A deal risk on a daily cadence. It is designed to
              answer one question with precision:{" "}
              <em className="text-gray-100 font-medium">
                has anything materially changed for this deal since yesterday?
              </em>
            </p>
            <p>
              Every morning, the system collects enriched context for each active
              deal -- SEC filings, trading halts, Google Sheet changes, options
              market data, and milestone timelines. It then classifies the
              magnitude of change, routes to the right AI model, records
              falsifiable predictions, tracks calibration accuracy, and learns
              from human corrections.
            </p>

            {/* Flow diagram */}
            <div className="mt-6 mb-2">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-medium">
                Daily Pipeline
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <FlowStep label="Context Collection" />
                <FlowStep label="Change Classification" />
                <FlowStep label="Smart Routing" />
                <FlowStep label="AI Assessment" />
                <FlowStep label="Prediction Registry" />
                <FlowStep label="Calibration Feedback" last />
              </div>
            </div>

            <p className="text-sm text-gray-500 mt-4">
              The loop is self-improving: prediction accuracy feeds back into the
              AI prompt as calibration data, and human corrections sharpen
              signal-weighting over time. Every cycle makes the system marginally
              more accurate than the last.
            </p>
          </Section>

          {/* ── 2. Phase 1: Enriched Context ── */}
          <Section id="enriched-context" title="Enriched Context">
            <p>
              Before the AI sees anything, the system builds a comprehensive
              picture of each deal&apos;s current state. This is the foundation
              every downstream decision rests on.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {[
                {
                  title: "Options-Implied Probability",
                  desc: "Derives deal-close probability from live market prices. The options market is often the fastest signal -- it reprices before news hits the tape.",
                },
                {
                  title: "Three-Signal Triangulation",
                  desc: "Cross-references the options market implied probability, the Google Sheet analyst assessment, and the AI model's own estimate. Disagreements are flagged automatically.",
                },
                {
                  title: "Milestone Timeline",
                  desc: "Tracks regulatory approvals, shareholder votes, financing deadlines, and closing dates. Auto-resolves predictions when milestones complete.",
                },
                {
                  title: "SEC Filing & Halt Monitoring",
                  desc: "Watches for new 8-K, S-4, 425, 14D-9, and DEFM14A filings. Detects M1/M2 trading halts (merger-related) linked to active deals in real time.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-gray-900/50 border border-gray-800 rounded-lg p-4"
                >
                  <h4 className="text-sm font-semibold text-gray-200 mb-1.5">
                    {item.title}
                  </h4>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 3. Phase 2: Prediction Registry ── */}
          <Section id="prediction-registry" title="Prediction Registry">
            <p>
              Every assessment produces 2-5 falsifiable predictions per deal.
              These are not vague forecasts -- they are specific, time-bounded
              claims the system will later grade itself on.
            </p>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Prediction Types
              </p>
              <div className="flex flex-wrap gap-2">
                {["deal_closes", "milestone_completion", "spread_direction", "break_price"].map(
                  (type) => (
                    <span
                      key={type}
                      className="font-mono text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2.5 py-1 rounded"
                    >
                      {type}
                    </span>
                  )
                )}
              </div>
            </div>

            <BulletList
              items={[
                "AI makes 2-5 falsifiable predictions per deal per assessment cycle",
                "Predictions auto-resolve when their target milestone completes or the deal closes",
                "Each prediction carries an explicit probability and a resolution deadline",
              ]}
            />

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Brier Scoring
              </p>
              <CodeBlock>
                Brier Score = (predicted_probability - actual_outcome)&sup2;
              </CodeBlock>
              <p className="text-sm text-gray-400 mt-3">
                A perfect prediction scores{" "}
                <span className="text-emerald-300 font-mono">0.00</span>. A
                maximally wrong prediction scores{" "}
                <span className="text-red-300 font-mono">1.00</span>. The system
                aggregates Brier scores across all resolved predictions to measure
                calibration quality. Lower is always better.
              </p>
            </div>
          </Section>

          {/* ── 4. Phase 3: Calibration Loop ── */}
          <Section id="calibration-loop" title="Calibration Loop">
            <p>
              Raw predictions are useful, but calibrated predictions are
              actionable. The calibration loop examines every resolved prediction
              to detect systematic bias and feed corrections back into the
              prompt.
            </p>

            <BulletList
              items={[
                "Aggregates prediction accuracy across all resolved predictions",
                "Groups predictions by probability bucket (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)",
                "Detects overconfidence bias (predictions at 90% that resolve at 65%) and underconfidence bias (predictions at 50% that resolve at 80%)",
                "Breaks calibration down by risk factor: regulatory, shareholder vote, financing, legal",
                "Injects calibration feedback directly into the AI system prompt so the model can self-correct",
              ]}
            />

            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 mt-4">
              <p className="text-sm text-gray-400">
                <span className="text-amber-300 font-medium">Example feedback:</span>{" "}
                &ldquo;Your predictions in the 80-100% confidence bucket have
                historically resolved at 71%. Consider reducing certainty on
                regulatory approvals where you have been overconfident by
                approximately 10 percentage points.&rdquo;
              </p>
            </div>
          </Section>

          {/* ── 5. Phase 4: Human Review Queue ── */}
          <Section id="human-review" title="Human Review Queue">
            <p>
              Not every assessment needs human attention, but some demand it. The
              review queue automatically surfaces deals that warrant a portfolio
              manager&apos;s judgment, scored by urgency.
            </p>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Automatic Flagging Triggers
              </p>
              <BulletList
                items={[
                  "Three-way signal disagreement: options market, sheet analyst, and AI all diverge",
                  "Significant AI grade change between consecutive assessments",
                  "Poorly-performing predictions (high Brier score on recent resolutions)",
                  "New milestone events (regulatory filing, vote scheduled, halt detected)",
                ]}
              />
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Priority Scoring (0-80 Scale)
              </p>
              <p className="text-sm text-gray-400">
                Each trigger contributes points to a composite priority score.
                Higher scores surface first in the review queue. A three-way
                disagreement on a large position with a recent grade change might
                score 65+, while a minor milestone on a small deal might score 15.
              </p>
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                What the Portfolio Manager Provides
              </p>
              <BulletList
                items={[
                  "Which signal was right (options market, sheet analyst, or AI)",
                  "Corrected grades when the AI got it wrong",
                  "Missed reasoning the AI should have caught",
                  "Error type classification (data staleness, logic error, missing context, model limitation)",
                ]}
              />
              <p className="text-sm text-gray-500 mt-3">
                These corrections feed directly into future assessments. The system
                learns which signal to trust and which reasoning patterns to avoid.
              </p>
            </div>
          </Section>

          {/* ── 6. Phase 5: Signal Weighting ── */}
          <Section id="signal-weighting" title="Signal Weighting">
            <p>
              Three signals compete to estimate deal-close probability: the
              options market, the Google Sheet analyst, and the AI model. Over
              time, some prove more reliable than others. Signal weighting
              quantifies that reliability gap and makes it actionable.
            </p>

            <BulletList
              items={[
                "Each signal accumulates a historical Brier score from resolved predictions",
                "Inverse-Brier weighting: a signal with Brier 0.08 receives roughly 3x the weight of a signal with Brier 0.25",
                "Weights are injected into the AI prompt so the model knows how much to trust each disagreement",
                "Minimum threshold: 10 resolved deals required before signal weights activate (avoids small-sample distortion)",
              ]}
            />

            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 mt-4">
              <p className="text-sm text-gray-400">
                <span className="text-cyan-300 font-medium">In practice:</span>{" "}
                if the options market has been the most accurate signal
                historically, and it suddenly diverges from the AI&apos;s
                estimate, the AI is prompted to weight that disagreement heavily
                rather than dismiss it.
              </p>
            </div>
          </Section>

          {/* ── 7. Smart Routing ── */}
          <Section id="smart-routing" title="Smart Model Routing">
            <p>
              Not every deal needs Opus. The system hashes the material context
              fields for each deal and compares against yesterday&apos;s hash. The
              magnitude of change determines which model -- if any -- runs the
              assessment.
            </p>

            {/* Routing table */}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900/50 text-left">
                    <th className="px-4 py-2.5 font-semibold text-gray-300 rounded-tl-lg">
                      Change Level
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-gray-300">
                      Strategy
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-gray-300">
                      Model
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-gray-300 rounded-tr-lg">
                      Cost (In/Out per MTok)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {[
                    {
                      level: "No Change",
                      strategy: "REUSE (copy previous)",
                      model: "None",
                      cost: "$0",
                      levelColor: "text-green-400",
                    },
                    {
                      level: "Minor",
                      strategy: "DELTA (abbreviated prompt)",
                      model: "Haiku 4.5",
                      cost: "$1 / $5",
                      levelColor: "text-yellow-400",
                    },
                    {
                      level: "Moderate",
                      strategy: "DELTA (abbreviated prompt)",
                      model: "Sonnet 4.6",
                      cost: "$3 / $15",
                      levelColor: "text-orange-400",
                    },
                    {
                      level: "Major / First",
                      strategy: "FULL (complete prompt)",
                      model: "Opus 4.6",
                      cost: "$5 / $25",
                      levelColor: "text-red-400",
                    },
                  ].map((row) => (
                    <tr
                      key={row.level}
                      className="hover:bg-gray-900/30 transition-colors"
                    >
                      <td className={`px-4 py-2.5 font-medium ${row.levelColor}`}>
                        {row.level}
                      </td>
                      <td className="px-4 py-2.5 text-gray-300">{row.strategy}</td>
                      <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">
                        {row.model}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                        {row.cost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Context Hashing
              </p>
              <p className="text-sm text-gray-400">
                The system computes a deterministic hash of each deal&apos;s
                material context fields: analyst grades, regulatory status,
                milestone state, and options-implied probability. Price data is
                bucketed (e.g., $0.50 increments for spreads, 5% increments for
                implied probability) to filter out market noise that
                doesn&apos;t represent a genuine change in deal thesis. Only when
                the hash differs from yesterday does the system trigger a new
                assessment.
              </p>
            </div>
          </Section>

          {/* ── 8. Cost Optimization ── */}
          <Section id="cost-optimization" title="Cost Optimization">
            <p>
              Running AI assessments on 30+ active deals daily adds up quickly.
              The system stacks four cost-reduction strategies to keep the bill
              manageable without sacrificing assessment quality.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {[
                {
                  title: "Prompt Caching",
                  desc: "The system prompt (which includes calibration data, signal weights, and schema instructions) is cached. Subsequent reads of the cached prompt cost 90% less than the first write.",
                  saving: "90% on cached reads",
                },
                {
                  title: "Batch API",
                  desc: "All deals in a morning run are submitted as a single batch rather than individual requests. Batch processing provides a flat 50% discount on all input and output tokens.",
                  saving: "50% on all tokens",
                },
                {
                  title: "Combined Savings",
                  desc: "When a cached system prompt is read inside a batch request, discounts stack: the cached portion costs 10% of list price, then the batch discount halves that again.",
                  saving: "Up to 95% on cached batch reads",
                },
                {
                  title: "Smart Routing",
                  desc: "Unchanged deals cost nothing (REUSE). Minor changes use Haiku at $1/$5 per MTok. Only genuine material changes warrant Opus at $5/$25. Most days, 60-80% of deals are REUSE or MINOR.",
                  saving: "60-80% of deals skip expensive models",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-gray-900/50 border border-gray-800 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <h4 className="text-sm font-semibold text-gray-200">
                      {item.title}
                    </h4>
                    <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded whitespace-nowrap ml-2">
                      {item.saving}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 9. How to Use ── */}
          <Section id="how-to-use" title="How to Use">
            <p>
              The prediction system runs autonomously. Here is how to interact
              with its outputs and configure its behavior.
            </p>

            <BulletList
              items={[
                "Assessments run on a scheduled morning task. No manual trigger is needed.",
                "Results are visible on the Event Driven Portfolio page at /sheet-portfolio. Click any deal to see AI grades, signal disagreements, and active predictions.",
                "Review queue items appear automatically when flagged. Items are sorted by priority score -- attend to the highest-scoring items first.",
                "Human corrections submitted through the review queue feed back into the next assessment cycle.",
              ]}
            />

            <div className="mt-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-medium">
                Feature Flags
              </p>
              <p className="text-sm text-gray-400 mb-3">
                Each phase of the system can be independently enabled or disabled
                via environment variables. All flags default to enabled.
              </p>
              <CodeBlock>
                <div className="space-y-1">
                  {[
                    { flag: "RISK_ENRICHED_CONTEXT", desc: "Options + SEC + halt enrichment" },
                    { flag: "RISK_PREDICTIONS", desc: "Falsifiable prediction generation" },
                    { flag: "RISK_CALIBRATION", desc: "Calibration feedback in prompts" },
                    { flag: "RISK_REVIEW_QUEUE", desc: "Automatic flagging for human review" },
                    { flag: "RISK_SIGNAL_WEIGHTS", desc: "Historical signal weighting" },
                    { flag: "RISK_BATCH_MODE", desc: "Batch API for cost savings" },
                  ].map((item) => (
                    <div key={item.flag} className="flex items-center gap-4">
                      <span className="text-blue-300 min-w-[260px]">
                        {item.flag}
                      </span>
                      <span className="text-gray-500"># {item.desc}</span>
                    </div>
                  ))}
                </div>
              </CodeBlock>
            </div>
          </Section>
        </div>

        {/* ── Footer ── */}
        <div className="mt-16 pt-8 border-t border-gray-800/50">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <Link
              href="/sheet-portfolio"
              className="hover:text-gray-300 transition-colors"
            >
              &larr; Event Driven Portfolio
            </Link>
            <Link
              href="/changelog"
              className="hover:text-gray-300 transition-colors"
            >
              Release Notes &rarr;
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
