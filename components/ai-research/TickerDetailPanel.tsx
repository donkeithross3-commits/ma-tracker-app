"use client";

import { type TickerDetail } from "./ticker-details";

// ---------------------------------------------------------------------------
// Helpers (re-use the same formatting logic as AIResearchContent)
// ---------------------------------------------------------------------------

function pct(v: number | null, decimals = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return `${(v * 100).toFixed(decimals)}%`;
}

function fmt(v: number | null, decimals = 2): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return v.toFixed(decimals);
}

function fmtB(v: number | null): string {
  if (v === null || v === undefined || isNaN(v)) return "--";
  if (Math.abs(v) >= 1) return `$${v.toFixed(1)}B`;
  if (Math.abs(v) >= 0.001) return `$${(v * 1000).toFixed(0)}M`;
  return `$${v.toFixed(2)}B`;
}

function fmtEmployees(v: number | null): string {
  if (v === null) return "--";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function marginArrow(change: number | null): JSX.Element | null {
  if (change === null || change === undefined || isNaN(change)) return null;
  if (change > 0) return <span className="text-green-400 ml-0.5">{"\u25B2"}{pct(change, 0)}</span>;
  if (change < 0) return <span className="text-red-400 ml-0.5">{"\u25BC"}{pct(change, 0)}</span>;
  return <span className="text-gray-600 ml-0.5">--</span>;
}

function returnColor(v: number | null): string {
  if (v === null) return "text-gray-500";
  if (v > 0.05) return "text-green-400";
  if (v > 0) return "text-green-400/70";
  if (v > -0.05) return "text-red-400/70";
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Micro-components for visual elements
// ---------------------------------------------------------------------------

/** Thin horizontal bar (0-1 scale) */
function Bar({ value, color, max = 1 }: { value: number | null; color: string; max?: number }) {
  if (value === null || value === undefined || isNaN(value)) {
    return <div className="h-1.5 bg-gray-800 rounded-full w-full" />;
  }
  const w = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className="h-1.5 bg-gray-800 rounded-full w-full">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/** Labeled bar row for moat/sentiment sections */
function BarRow({ label, value, color, showPct = true }: { label: string; value: number | null; color: string; showPct?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-[72px] shrink-0 truncate">{label}</span>
      <div className="flex-1 min-w-0">
        <Bar value={value} color={color} />
      </div>
      <span className="text-[10px] font-mono text-gray-400 w-[36px] text-right shrink-0">
        {showPct ? pct(value, 0) : fmt(value)}
      </span>
    </div>
  );
}

/** 3-bar revenue sparkline */
function RevenueSparkline({ v0, v1, v2 }: { v0: number | null; v1: number | null; v2: number | null }) {
  const vals = [v0, v1, v2].map((v) => (v !== null && !isNaN(v) ? Math.abs(v) : 0));
  const max = Math.max(...vals, 0.001);
  const colors = ["bg-gray-600", "bg-blue-500/70", "bg-blue-400"];
  return (
    <div className="flex items-end gap-0.5 h-4">
      {vals.map((v, i) => (
        <div
          key={i}
          className={`w-2.5 rounded-t ${colors[i]}`}
          style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  );
}

/** Valuation gap bar: actual P/S vs expected P/S */
function ValuationGap({ actual, expected }: { actual: number | null; expected: number | null }) {
  if (actual === null || expected === null) return <span className="text-[10px] text-gray-600">n/a</span>;
  const max = Math.max(actual, expected, 0.1);
  const aw = (actual / max) * 100;
  const ew = (expected / max) * 100;
  const isUndervalued = actual < expected;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 w-[40px] shrink-0">Actual</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full">
          <div className={`h-1.5 rounded-full ${isUndervalued ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${aw}%` }} />
        </div>
        <span className="text-[10px] font-mono text-gray-400 w-[32px] text-right">{fmt(actual, 1)}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 w-[40px] shrink-0">Fair</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full">
          <div className="h-1.5 rounded-full bg-blue-500/60" style={{ width: `${ew}%` }} />
        </div>
        <span className="text-[10px] font-mono text-gray-400 w-[32px] text-right">{fmt(expected, 1)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{children}</h4>;
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-300">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

interface TickerDetailPanelProps {
  ticker: string;
  detail: TickerDetail;
  colSpan: number;
  narrative?: string;
}

export function TickerDetailPanel({ ticker, detail, colSpan, narrative }: TickerDetailPanelProps) {
  const d = detail;

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="bg-gray-900/80 border border-gray-800 rounded-lg mx-1 mb-1 p-3">
          {/* AI Impact Thesis — specific view on how AI changes this company */}
          {d.aiThesis && (
            <div className="mb-3 px-2 py-2 bg-blue-950/40 border border-blue-900/50 rounded-md">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">AI Impact Thesis</span>
              </div>
              <p className="text-[12px] leading-relaxed text-gray-300">
                {d.aiThesis}
              </p>
            </div>
          )}
          {/* AI Narrative — model explanation */}
          {narrative && (
            <div className="mb-3 px-1">
              <p className="text-[11px] leading-relaxed text-gray-500 italic">
                {narrative}
              </p>
            </div>
          )}
          {/* 4-column grid */}
          <div className="grid grid-cols-4 gap-4">

            {/* ── Column 1: Company Overview & Fundamentals ── */}
            <div className="space-y-3">
              {/* Company header */}
              <div>
                <div className="text-sm font-bold text-gray-100">{d.name}</div>
                <div className="text-[10px] text-gray-500">{d.sicDescription}</div>
                {d.employees !== null && (
                  <div className="text-[10px] text-gray-600">{fmtEmployees(d.employees)} employees</div>
                )}
              </div>

              {/* Revenue trend */}
              <div>
                <SectionTitle>Revenue Trend</SectionTitle>
                <div className="flex items-end gap-3">
                  <RevenueSparkline v0={d.revenue2yAgoB} v1={d.revenuePrevB} v2={d.revenueB} />
                  <div className="flex-1 space-y-0">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500">Latest</span>
                      <span className="font-mono text-gray-200">{fmtB(d.revenueB)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500">Prev</span>
                      <span className="font-mono text-gray-400">{fmtB(d.revenuePrevB)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500">2y ago</span>
                      <span className="font-mono text-gray-500">{fmtB(d.revenue2yAgoB)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-1">
                  <span className="text-[10px] text-gray-500">
                    YoY <span className={`font-mono ${(d.revenueGrowthYoY ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>{pct(d.revenueGrowthYoY, 0)}</span>
                  </span>
                  <span className="text-[10px] text-gray-500">
                    CAGR <span className={`font-mono ${(d.revenueCagr2y ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>{pct(d.revenueCagr2y, 0)}</span>
                  </span>
                </div>
              </div>

              {/* Margin waterfall */}
              <div>
                <SectionTitle>Margins</SectionTitle>
                <div className="space-y-0.5">
                  <StatRow label="Gross">{pct(d.grossMargin, 1)}</StatRow>
                  <StatRow label="Operating">
                    {pct(d.operatingMargin, 1)}
                    {marginArrow(d.operatingMarginChange2y)}
                  </StatRow>
                  <StatRow label="Net">
                    {pct(d.netMargin, 1)}
                    {marginArrow(d.netMarginChange2y)}
                  </StatRow>
                </div>
              </div>

              {/* Returns & Leverage */}
              <div>
                <SectionTitle>Returns & Leverage</SectionTitle>
                <div className="space-y-0.5">
                  <StatRow label="ROE">{pct(d.returnOnEquity, 1)}</StatRow>
                  <StatRow label="ROA">{pct(d.returnOnAssets, 1)}</StatRow>
                  <StatRow label="D/E">{fmt(d.debtToEquity)}</StatRow>
                  <StatRow label="FCF Yield">{pct(d.fcfYield, 1)}</StatRow>
                  <StatRow label="R&D Intensity">{pct(d.rndIntensity, 1)}</StatRow>
                  <StatRow label="Free CF">{fmtB(d.freeCashFlowB)}</StatRow>
                </div>
              </div>
            </div>

            {/* ── Column 2: Valuation & Technicals ── */}
            <div className="space-y-3">
              {/* Valuation */}
              <div>
                <SectionTitle>Valuation (P/S)</SectionTitle>
                <ValuationGap actual={d.priceToSales} expected={d.expectedPriceToSales} />
                <div className="mt-1.5 space-y-0.5">
                  <StatRow label="EV/S">{fmt(d.evToSales, 1)}x</StatRow>
                  <StatRow label="P/E">{d.priceToEarnings !== null ? `${fmt(d.priceToEarnings, 1)}x` : "--"}</StatRow>
                </div>
              </div>

              {/* Returns */}
              <div>
                <SectionTitle>Price Returns</SectionTitle>
                <div className="space-y-0.5">
                  <StatRow label="21d">
                    <span className={returnColor(d.return21d)}>{pct(d.return21d, 1)}</span>
                  </StatRow>
                  <StatRow label="63d">
                    <span className={returnColor(d.return63d)}>{pct(d.return63d, 1)}</span>
                  </StatRow>
                  <StatRow label="126d">
                    <span className={returnColor(d.return126d)}>{pct(d.return126d, 1)}</span>
                  </StatRow>
                </div>
              </div>

              {/* Technical indicators */}
              <div>
                <SectionTitle>Technical Indicators</SectionTitle>
                <div className="space-y-0.5">
                  <StatRow label="RSI (14)">
                    <span className={
                      (d.rsi14 ?? 50) > 70 ? "text-red-400" :
                      (d.rsi14 ?? 50) < 30 ? "text-green-400" : "text-gray-300"
                    }>
                      {fmt(d.rsi14, 1)}
                    </span>
                  </StatRow>
                  <StatRow label="63d Vol">{pct(d.vol63d, 1)}</StatRow>
                  <StatRow label="Dist SMA200">
                    <span className={returnColor(d.distSma200)}>{pct(d.distSma200, 1)}</span>
                  </StatRow>
                </div>
              </div>
            </div>

            {/* ── Column 3: AI Assessment ── */}
            <div className="space-y-3">
              <div>
                <SectionTitle>AI Sentiment Breakdown</SectionTitle>
                <div className="space-y-1">
                  <BarRow label="Fear" value={d.aiFearRatio} color="bg-red-500" />
                  <BarRow label="Execution" value={d.aiExecutionRatio} color="bg-green-500" />
                  <BarRow label="Concrete" value={d.aiExecConcreteRatio} color="bg-blue-500" />
                  <BarRow label="Hype" value={d.aiHypeRatio} color="bg-yellow-500" />
                  <BarRow label="Discount" value={d.aiDiscountRatio} color="bg-orange-500" />
                  <BarRow label="Data Signal" value={d.aiDataSignalRatio} color="bg-cyan-500" />
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-gray-800 pt-1.5">
                  <span className="text-[10px] font-semibold text-gray-400">Net Sentiment</span>
                  <span className={`text-xs font-mono font-bold ${
                    (d.aiNetSentiment ?? 0) > 0 ? "text-green-400" :
                    (d.aiNetSentiment ?? 0) < -0.05 ? "text-red-400" : "text-gray-400"
                  }`}>
                    {d.aiNetSentiment !== null ? (d.aiNetSentiment > 0 ? "+" : "") + fmt(d.aiNetSentiment) : "--"}
                  </span>
                </div>
              </div>

              <div>
                <SectionTitle>News Coverage</SectionTitle>
                <div className="space-y-0.5">
                  <StatRow label="Articles">{d.newsCount !== null ? String(d.newsCount) : "--"}</StatRow>
                  <StatRow label="Recency">{d.newsRecencyDays !== null ? `${fmt(d.newsRecencyDays, 0)}d ago` : "--"}</StatRow>
                  <StatRow label="AI Intensity">{pct(d.aiNewsIntensity, 0)}</StatRow>
                  <StatRow label="Strategy Spec.">{pct(d.aiStrategySpecificity, 0)}</StatRow>
                </div>
              </div>
            </div>

            {/* ── Column 4: Competitive Moat ── */}
            <div className="space-y-3">
              <div>
                <SectionTitle>Competitive Moat</SectionTitle>
                <div className="space-y-1">
                  <BarRow label="Switch Cost" value={d.switchingCostScore} color="bg-blue-500" />
                  <BarRow label="Incumbent" value={d.incumbentAdvScore} color="bg-blue-400" />
                  <BarRow label="Entrant" value={d.entrantAdvScore} color="bg-amber-400" />
                  <BarRow label="Size" value={d.sizeScore} color="bg-purple-500" />
                  <BarRow label="Agility" value={d.agilityScore} color="bg-teal-500" />
                </div>
              </div>

              <div>
                <SectionTitle>AI Exposure</SectionTitle>
                <div className="space-y-1">
                  <BarRow label="AI Tailwind" value={d.aiTailwind} color="bg-emerald-500" />
                  <BarRow label="Disruption" value={d.disruptionSusceptibility} color="bg-red-500" />
                  <BarRow label="Legacy Cost" value={d.legacyCostPenalty} color="bg-orange-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
