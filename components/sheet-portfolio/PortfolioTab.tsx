"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

interface Deal {
  row_index: number;
  ticker: string;
  acquiror: string;
  category: string;
  deal_price: number | null;
  current_price: number | null;
  gross_yield: number | null;
  current_yield: number | null;
  price_change: number | null;
  deal_price_raw: string | null;
  current_price_raw: string | null;
  gross_yield_raw: string | null;
  current_yield_raw: string | null;
  price_change_raw: string | null;
  investable: string | null;
  vote_risk: string | null;
  finance_risk: string | null;
  legal_risk: string | null;
  announced_date: string | null;
  close_date: string | null;
  end_date: string | null;
  announced_date_raw: string | null;
  close_date_raw: string | null;
  end_date_raw: string | null;
  countdown_days: number | null;
  countdown_raw: string | null;
  go_shop_raw: string | null;
  cvr_flag: string | null;
  is_excluded?: boolean;
}

interface RiskData {
  ticker: string;
  vote_grade: string | null;
  financing_grade: string | null;
  legal_grade: string | null;
  regulatory_grade: string | null;
  mac_grade: string | null;
  investable_assessment: string | null;
  needs_attention: boolean;
  has_risk_change: boolean;
  attention_reason: string | null;
  discrepancy_count: number;
  event_count: number;
  deal_summary: string | null;
}

interface HealthStatus {
  status: string;
  last_success_date: string | null;
  last_success_rows: number;
  last_success_at: string | null;
  recent_failures: number;
}

interface DiffEntry {
  ticker: string;
  diff_type: "added" | "modified" | "removed";
  changed_fields: Record<string, { old: string; new: string }>;
}

interface RiskChange {
  ticker: string;
  factor: string;
  old_level: string;
  new_level: string;
  direction: "worsened" | "improved";
  magnitude: number;
  change_date: string;
  explanation?: string;
}

// Factor name → single-letter label used in riskScoreCell
const FACTOR_LABEL_MAP: Record<string, string> = {
  vote: "V",
  financing: "F",
  legal: "L",
  regulatory: "R",
  mac: "M",
};

type SortKey = keyof Deal | "__default__";

function riskBadge(risk: string | null) {
  if (!risk) return null;
  const lower = risk.toLowerCase();
  let color = "text-gray-400 bg-gray-400/10";
  if (lower.startsWith("low")) color = "text-green-400 bg-green-400/10";
  else if (lower.startsWith("med")) color = "text-yellow-400 bg-yellow-400/10";
  else if (lower.startsWith("high")) color = "text-red-400 bg-red-400/10";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${color}`} title={risk}>
      {risk.length > 12 ? risk.slice(0, 12) + "..." : risk}
    </span>
  );
}

function yieldCell(raw: string | null, parsed: number | null) {
  if (raw === "#DIV/0!" || raw === "#VALUE!" || raw === "#N/A") {
    return <span className="text-gray-500">{raw}</span>;
  }
  if (parsed === null) return <span className="text-gray-500">-</span>;
  const pct = (parsed * 100).toFixed(2);
  const color = parsed >= 0 ? "text-green-400" : "text-red-400";
  return <span className={color}>{pct}%</span>;
}

function formatDate(d: string | null) {
  if (!d) return "";
  // YYYY-MM-DD -> M/D/YY
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0].slice(2)}`;
}

function gradeColor(grade: string | null): string {
  if (!grade) return "text-gray-600";
  const g = grade.toUpperCase();
  if (g === "LOW") return "text-green-400";
  if (g === "MEDIUM" || g === "MED") return "text-yellow-400";
  if (g === "HIGH") return "text-red-400";
  return "text-gray-400";
}

function riskScoreCell(risk: RiskData | undefined, changes?: RiskChange[]) {
  if (!risk) return <span className="text-gray-600">-</span>;
  const hasAnyGrade = risk.vote_grade || risk.financing_grade || risk.legal_grade || risk.regulatory_grade || risk.mac_grade;
  if (!hasAnyGrade) return <span className="text-gray-600">-</span>;

  // Build a map from factor label (V/F/L/R/M) to the change for that factor
  const changeByLabel: Record<string, RiskChange> = {};
  if (changes) {
    for (const c of changes) {
      const label = FACTOR_LABEL_MAP[c.factor];
      if (label) changeByLabel[label] = c;
    }
  }

  const grades = [
    { label: "V", grade: risk.vote_grade },
    { label: "F", grade: risk.financing_grade },
    { label: "L", grade: risk.legal_grade },
    { label: "R", grade: risk.regulatory_grade },
    { label: "M", grade: risk.mac_grade },
  ];

  const abbrev = (g: string | null) => {
    if (!g) return "?";
    const u = g.toUpperCase();
    if (u === "LOW") return "L";
    if (u === "MEDIUM" || u === "MED") return "M";
    if (u === "HIGH") return "H";
    return "?";
  };

  return (
    <span className="text-xs font-mono whitespace-nowrap" title={risk.deal_summary || ""}>
      {grades.map((g, i) => {
        const change = changeByLabel[g.label];
        const arrow = change
          ? change.direction === "worsened"
            ? "\u2193"
            : "\u2191"
          : null;
        const arrowColor = change
          ? change.direction === "worsened"
            ? "text-red-400"
            : "text-green-400"
          : "";
        const factorName = Object.entries(FACTOR_LABEL_MAP).find(
          ([, v]) => v === g.label
        )?.[0];
        const tooltip = change
          ? `${factorName}: ${change.old_level} \u2192 ${change.new_level} (${change.direction})`
          : undefined;
        return (
          <span key={i}>
            <span className={gradeColor(g.grade)}>
              {g.label}:{abbrev(g.grade)}
            </span>
            {arrow && (
              <span className={arrowColor} title={tooltip}>
                {arrow}
              </span>
            )}
            {i < grades.length - 1 ? " " : ""}
          </span>
        );
      })}
      {risk.discrepancy_count > 0 && <span className="ml-1" title={`${risk.discrepancy_count} discrepancies`}>&#9888;&#65039;</span>}
      {risk.event_count > 0 && <span className="ml-0.5" title={`${risk.event_count} overnight events`}>&#9889;</span>}
      {risk.needs_attention && <span className="ml-0.5 text-red-400" title={risk.attention_reason || "Needs attention"}>&#9873;</span>}
    </span>
  );
}

// Check if countdown_raw is the 11/3/1773 artifact (Google Sheets formula bug on empty end dates)
function isCountdownArtifact(raw: string | null): boolean {
  if (!raw) return false;
  return raw.includes("1773") || raw.includes("/");
}

// Compute countdown days from end_date when sheet formula produced an artifact
function computeCountdown(deal: Deal): number | null {
  // Use sheet value if valid
  if (!isCountdownArtifact(deal.countdown_raw) && deal.countdown_days !== null) {
    return deal.countdown_days;
  }
  // Fall back to computing from end_date
  if (!deal.end_date) return null;
  const end = new Date(deal.end_date);
  if (isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function ProvenancePill({ type }: { type: "ai" | "live" | "prior-close" }) {
  if (type === "ai") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">AI</span>;
  }
  if (type === "live") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium">LIVE</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-500 font-medium">PRIOR CLOSE</span>;
}

function useMarketFreshness(lastRefresh: Date | null): "fresh" | "stale" | "disconnected" {
  const [freshness, setFreshness] = useState<"fresh" | "stale" | "disconnected">("disconnected");
  useEffect(() => {
    function check() {
      if (!lastRefresh) { setFreshness("disconnected"); return; }
      const age = (Date.now() - lastRefresh.getTime()) / 1000;
      setFreshness(age > 90 ? "stale" : "fresh");
    }
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [lastRefresh]);
  return freshness;
}

function freshnessDotColor(freshness: "fresh" | "stale" | "disconnected"): string {
  if (freshness === "fresh") return "bg-green-500";
  if (freshness === "stale") return "bg-amber-500";
  return "bg-gray-600";
}

function freshnessPriceColor(freshness: "fresh" | "stale" | "disconnected"): string {
  return freshness === "stale" ? "text-cyan-600" : "text-cyan-400";
}

export default function PortfolioTab() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortKey>("__default__");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState<string>("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [riskData, setRiskData] = useState<Record<string, RiskData>>({});
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change: number; change_pct: number }>>({});
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [diffMap, setDiffMap] = useState<Record<string, DiffEntry>>({});
  const [riskChanges, setRiskChanges] = useState<Record<string, RiskChange[]>>({});
  const [showChangesOnly, setShowChangesOnly] = useState(false);

  const freshness = useMarketFreshness(lastRefresh);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const dealsUrl = showExcluded
        ? "/api/sheet-portfolio/deals?include_excluded=true"
        : "/api/sheet-portfolio/deals";
      const [dealsResp, healthResp, riskResp, diffResp, changesResp] = await Promise.all([
        fetch(dealsUrl),
        fetch("/api/sheet-portfolio/health"),
        fetch("/api/sheet-portfolio/risk"),
        fetch("/api/sheet-portfolio/diff").catch(() => null),
        fetch("/api/sheet-portfolio/risk-changes").catch(() => null),
      ]);
      if (dealsResp.ok) {
        setDeals(await dealsResp.json());
      } else {
        setError("Failed to load deals");
      }
      if (healthResp.ok) {
        setHealth(await healthResp.json());
      }
      if (riskResp.ok) {
        const riskArr: RiskData[] = await riskResp.json();
        const riskMap: Record<string, RiskData> = {};
        for (const r of riskArr) {
          riskMap[r.ticker] = r;
        }
        setRiskData(riskMap);
      }
      if (diffResp && diffResp.ok) {
        const diffData = await diffResp.json();
        const map: Record<string, DiffEntry> = {};
        for (const d of diffData.diffs || []) {
          map[d.ticker] = d;
        }
        setDiffMap(map);
      }
      if (changesResp && changesResp.ok) {
        const changesArr: RiskChange[] = await changesResp.json();
        const changesMap: Record<string, RiskChange[]> = {};
        for (const c of changesArr) {
          if (!changesMap[c.ticker]) changesMap[c.ticker] = [];
          changesMap[c.ticker].push(c);
        }
        setRiskChanges(changesMap);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [showExcluded]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchLivePrices = useCallback(async () => {
    try {
      setRefreshing(true);
      const resp = await fetch("/api/sheet-portfolio/live-prices");
      if (resp.ok) {
        const data = await resp.json();
        setLivePrices(data.prices || {});
        setLastRefresh(new Date());
      }
    } catch {
      // silently fail -- stale sheet prices still show
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLivePrices();
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchLivePrices();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchLivePrices]);

  async function toggleExclude(ticker: string, currentlyExcluded: boolean) {
    const newStatus = currentlyExcluded ? "active" : "excluded";
    try {
      const resp = await fetch(
        `/api/sheet-portfolio/allowlist?ticker=${encodeURIComponent(ticker)}&status=${newStatus}`,
        { method: "POST" }
      );
      if (resp.ok) {
        fetchData();
      }
    } catch {
      // silently fail
    }
  }

  async function handleIngest() {
    setIngesting(true);
    setIngestResult(null);
    try {
      // Phase 1: Dashboard ingest
      const resp = await fetch("/api/sheet-portfolio/ingest?force=true", {
        method: "POST",
      });
      const data = await resp.json();
      if (!resp.ok) {
        setIngestResult(`Error: ${data.error || data.detail}`);
        setIngesting(false);
        return;
      }

      const rowCount = data.skipped ? 0 : data.row_count;

      // Refresh table immediately with dashboard data
      await fetchData();

      // Phase 1 succeeded — details are refreshing in the background via the backend
      setIngestResult(
        data.skipped
          ? "No changes detected"
          : `Ingested ${rowCount} rows (details refreshing in background)`
      );
    } catch (e) {
      setIngestResult(
        `Error: ${e instanceof Error ? e.message : "Ingest failed"}`
      );
    } finally {
      setIngesting(false);
    }
  }

  function handleSort(col: keyof Deal) {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const riskChangeCount = Object.keys(riskChanges).length;

  const filteredDeals = deals.filter((d) => {
    if (showChangesOnly && !riskChanges[d.ticker]) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      d.ticker?.toLowerCase().includes(q) ||
      d.acquiror?.toLowerCase().includes(q) ||
      d.category?.toLowerCase().includes(q) ||
      d.investable?.toLowerCase().includes(q) ||
      d.go_shop_raw?.toLowerCase().includes(q)
    );
  });

  const sortedDeals =
    sortCol === "__default__"
      ? filteredDeals // Already in row_index order from API
      : [...filteredDeals].sort((a, b) => {
          const dir = sortDir === "asc" ? 1 : -1;
          const av = a[sortCol as keyof Deal];
          const bv = b[sortCol as keyof Deal];
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (typeof av === "number" && typeof bv === "number")
            return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });

  const sortIcon = (col: string) => {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  // Summary stats
  const investableDeals = deals.filter(
    (d) => d.investable?.toLowerCase().startsWith("yes")
  );
  const yieldDenominator = investableDeals.filter(
    (d) => d.current_yield !== null
  ).length;
  const avgYield =
    yieldDenominator > 0
      ? investableDeals.reduce((s, d) => s + (d.current_yield || 0), 0) /
        yieldDenominator
      : 0;

  // Column definitions matching production Google Sheet order
  const columns: {
    key: keyof Deal;
    label: string;
    align: "left" | "right" | "center";
  }[] = [
    { key: "ticker", label: "Ticker", align: "left" },
    { key: "acquiror", label: "Acquiror", align: "left" },
    { key: "announced_date", label: "Anncd", align: "center" },
    { key: "close_date", label: "Close", align: "center" },
    { key: "end_date", label: "End Dt", align: "center" },
    { key: "countdown_days", label: "Cntdwn", align: "right" },
    { key: "current_price", label: "Crrnt Px", align: "right" },
    { key: "gross_yield", label: "Grss Yield", align: "right" },
    { key: "price_change", label: "Px Chng", align: "right" },
    { key: "current_yield", label: "Crrnt Yield", align: "right" },
    { key: "category", label: "Category", align: "left" },
    { key: "investable", label: "Investable", align: "left" },
    { key: "go_shop_raw", label: "Go Shop or Likely Overbid?", align: "left" },
    { key: "vote_risk", label: "Vote Risk", align: "center" },
    { key: "finance_risk", label: "Finance Risk", align: "center" },
    { key: "legal_risk", label: "Legal Risk", align: "center" },
    { key: "cvr_flag", label: "CVR", align: "center" },
  ];

  return (
    <>
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-3 py-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Event Driven Portfolio</h1>
            <p className="text-xs text-gray-500">
              Production sheet replica
              {health && (
                <span className="ml-2">
                  {health.status === "healthy" ? (
                    <span className="text-green-500">Healthy</span>
                  ) : (
                    <span className="text-yellow-500">{health.status}</span>
                  )}
                  {health.last_success_at &&
                    ` \u00B7 Last ingest: ${new Date(health.last_success_at).toLocaleString()}`}
                  {health.last_success_rows > 0 &&
                    ` (${health.last_success_rows} rows)`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Market data status + refresh */}
            <div className="flex items-center gap-1.5 border border-gray-700 rounded px-2.5 py-1">
              <span className={`inline-block w-2 h-2 rounded-full ${freshnessDotColor(freshness)}`} title={lastRefresh ? (freshness === "stale" ? "Market data stale" : "Polygon connected") : "No market data yet"} />
              <span className="text-xs text-gray-400">
                {lastRefresh
                  ? `Mkt data ${lastRefresh.toLocaleTimeString()}${freshness === "stale" ? " (stale)" : ""}`
                  : "Mkt data loading\u2026"}
              </span>
              <button
                onClick={fetchLivePrices}
                disabled={refreshing}
                className="ml-1 p-0.5 text-cyan-400 hover:text-cyan-300 disabled:opacity-40 transition-colors"
                title="Refresh market data now"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
            <button
              onClick={handleIngest}
              disabled={ingesting}
              className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:bg-gray-700 disabled:text-gray-500 border border-gray-700 rounded transition-colors"
            >
              {ingesting ? "Ingesting..." : "Re-ingest Sheet"}
            </button>
            {ingestResult && (
              <span className="text-xs text-gray-400">{ingestResult}</span>
            )}
            <Link
              href="/baseline-review"
              className="px-3 py-1.5 text-xs bg-purple-900/40 hover:bg-purple-800/50 border border-purple-700/50 rounded text-purple-300 transition-colors"
            >
              AI Review
              {(() => {
                const flaggedCount = Object.values(riskData).filter(r => r.needs_attention).length;
                return flaggedCount > 0 ? (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded-full font-medium">
                    {flaggedCount}
                  </span>
                ) : null;
              })()}
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 text-sm border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-3 py-3">
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">{error}</div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-6 mb-3 text-sm">
              <span className="text-gray-400">
                <strong className="text-gray-100">{deals.length}</strong> deals
              </span>
              <span className="text-gray-400">
                <strong className="text-green-400">
                  {investableDeals.length}
                </strong>{" "}
                investable
              </span>
              {avgYield !== 0 && (
                <span className="text-gray-400">
                  Avg IRR (investable):{" "}
                  <strong
                    className={
                      avgYield >= 0 ? "text-green-400" : "text-red-400"
                    }
                  >
                    {(avgYield * 100).toFixed(1)}%
                  </strong>
                </span>
              )}
              {riskChangeCount > 0 ? (
                <button
                  onClick={() => setShowChangesOnly(!showChangesOnly)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    showChangesOnly
                      ? "border-amber-600 text-amber-400 bg-amber-400/10"
                      : "border-amber-700/50 text-amber-400 hover:bg-amber-400/10"
                  }`}
                  title="Filter to deals with risk grade changes"
                >
                  {showChangesOnly ? `Showing ${riskChangeCount} risk changes` : `${riskChangeCount} risk change${riskChangeCount === 1 ? "" : "s"}`}
                </button>
              ) : (
                <span className="text-xs text-gray-600">No risk changes</span>
              )}
              <button
                onClick={() => setShowExcluded(!showExcluded)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  showExcluded
                    ? "border-yellow-600 text-yellow-400 bg-yellow-400/10"
                    : "border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                {showExcluded ? "Showing excluded" : "Show excluded"}
              </button>
              {sortCol !== "__default__" && (
                <button
                  onClick={() => {
                    setSortCol("__default__");
                    setSortDir("asc");
                  }}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Reset sort
                </button>
              )}
              <div className="ml-auto">
                <input
                  type="text"
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-2 py-1 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 w-48 focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* Deals table - matches production Google Sheet column order */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`py-2 px-2 font-medium cursor-pointer hover:text-gray-300 whitespace-nowrap ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {sortIcon(col.key)}
                      </th>
                    ))}
                    <th className="py-2 px-2 font-medium text-center whitespace-nowrap">
                      Risk <ProvenancePill type="ai" />
                    </th>
                    {showExcluded && (
                      <th className="py-2 px-1 font-medium text-center w-8"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedDeals.map((deal, idx) => {
                    const countdown = computeCountdown(deal);
                    const diff = diffMap[deal.ticker];
                    const tickerChanges = riskChanges[deal.ticker];
                    const hasWorsened = tickerChanges?.some(c => c.direction === "worsened");
                    const hasImproved = tickerChanges?.some(c => c.direction === "improved");
                    // Risk change border takes priority over diff border
                    const rowBorder = hasWorsened
                      ? "border-l-2 border-red-500/50"
                      : hasImproved
                      ? "border-l-2 border-green-500/50"
                      : diff?.diff_type === "added"
                      ? "border-l-2 border-green-500/60"
                      : diff?.diff_type === "modified"
                      ? "border-l-2 border-amber-500/40"
                      : "";
                    return (
                      <tr
                        key={`${deal.ticker}-${idx}`}
                        className={`border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors ${deal.is_excluded ? "opacity-40" : ""} ${rowBorder}`}
                      >
                        {/* Ticker */}
                        <td className="py-1.5 px-2 font-mono font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <Link
                              href={`/sheet-portfolio/${deal.ticker}`}
                              prefetch={false}
                              className={`hover:underline ${deal.is_excluded ? "text-gray-500 line-through" : "text-blue-400 hover:text-blue-300"}`}
                              title={diff?.diff_type === "modified" ? `Changed: ${Object.keys(diff.changed_fields).join(", ")}` : undefined}
                            >
                              {deal.ticker}
                            </Link>
                            {diff?.diff_type === "added" && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/15 text-green-400 leading-none">NEW</span>
                            )}
                            {tickerChanges && tickerChanges.length > 0 && tickerChanges.map((c, ci) => (
                              <span
                                key={ci}
                                className={`text-[10px] px-1 py-0.5 rounded leading-none cursor-default whitespace-nowrap ${
                                  c.direction === "worsened"
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-green-500/15 text-green-400"
                                }`}
                                title={`${c.factor}: ${c.old_level} \u2192 ${c.new_level} (${c.direction})${c.explanation ? "\n" + c.explanation.slice(0, 150) : ""}`}
                              >
                                {c.direction === "worsened" ? "\u25BC" : "\u25B2"}{c.factor}
                              </span>
                            ))}
                          </span>
                        </td>
                        {/* Acquiror */}
                        <td
                          className="py-1.5 px-2 text-gray-300 max-w-[180px] truncate"
                          title={deal.acquiror || ""}
                        >
                          {deal.acquiror}
                        </td>
                        {/* Anncd */}
                        <td className="py-1.5 px-2 text-center text-gray-400 text-xs whitespace-nowrap">
                          {formatDate(deal.announced_date)}
                        </td>
                        {/* Close */}
                        <td className="py-1.5 px-2 text-center text-gray-400 text-xs whitespace-nowrap">
                          {formatDate(deal.close_date)}
                        </td>
                        {/* End Dt */}
                        <td className="py-1.5 px-2 text-center text-gray-400 text-xs whitespace-nowrap">
                          {formatDate(deal.end_date)}
                        </td>
                        {/* Cntdwn */}
                        <td className="py-1.5 px-2 text-right font-mono">
                          {countdown !== null ? (
                            <span
                              className={
                                countdown < 0
                                  ? "text-red-400"
                                  : countdown < 30
                                  ? "text-yellow-400"
                                  : "text-gray-300"
                              }
                            >
                              {countdown}
                            </span>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                        {/* Crrnt Px */}
                        <td className="py-1.5 px-2 text-right font-mono">
                          {livePrices[deal.ticker] ? (
                            <span className={freshnessPriceColor(freshness)} title={`Live: $${livePrices[deal.ticker].price.toFixed(2)}`}>
                              {livePrices[deal.ticker].price.toFixed(2)}
                            </span>
                          ) : (
                            deal.current_price_raw || "-"
                          )}
                        </td>
                        {/* Grss Yield */}
                        <td className="py-1.5 px-2 text-right font-mono">
                          {livePrices[deal.ticker] && livePrices[deal.ticker].price > 0 && deal.deal_price !== null ? (
                            (() => {
                              const liveGross = (deal.deal_price - livePrices[deal.ticker].price) / livePrices[deal.ticker].price;
                              const pct = (liveGross * 100).toFixed(2);
                              return <span className={liveGross >= 0 ? "text-green-400" : "text-red-400"}>{pct}%</span>;
                            })()
                          ) : (
                            yieldCell(deal.gross_yield_raw, deal.gross_yield)
                          )}
                        </td>
                        {/* Px Chng */}
                        <td className="py-1.5 px-2 text-right font-mono">
                          {livePrices[deal.ticker] ? (
                            <span className={livePrices[deal.ticker].change_pct >= 0 ? "text-green-400" : "text-red-400"}>
                              {livePrices[deal.ticker].change_pct >= 0 ? "+" : ""}
                              {livePrices[deal.ticker].change_pct.toFixed(2)}%
                            </span>
                          ) : (
                            yieldCell(
                              deal.price_change_raw,
                              deal.price_change
                            )
                          )}
                        </td>
                        {/* Crrnt Yield */}
                        <td className="py-1.5 px-2 text-right font-mono">
                          {livePrices[deal.ticker] && livePrices[deal.ticker].price > 0 && deal.deal_price !== null && deal.countdown_days !== null && deal.countdown_days > 0 ? (
                            (() => {
                              const liveGross = (deal.deal_price - livePrices[deal.ticker].price) / livePrices[deal.ticker].price;
                              const monthsToClose = deal.countdown_days / 30;
                              const liveCurrentYield = liveGross * (12 / monthsToClose);
                              const pct = (liveCurrentYield * 100).toFixed(2);
                              return <span className={liveCurrentYield >= 0 ? "text-green-400" : "text-red-400"}>{pct}%</span>;
                            })()
                          ) : (
                            yieldCell(
                              deal.current_yield_raw,
                              deal.current_yield
                            )
                          )}
                        </td>
                        {/* Category */}
                        <td className="py-1.5 px-2 text-gray-400 whitespace-nowrap">
                          {deal.category}
                        </td>
                        {/* Investable */}
                        <td className="py-1.5 px-2 max-w-[140px] truncate">
                          {deal.investable?.toLowerCase().startsWith("yes") ? (
                            <span className="text-green-400">
                              {deal.investable}
                            </span>
                          ) : (
                            <span className="text-gray-500">
                              {deal.investable || ""}
                            </span>
                          )}
                        </td>
                        {/* Go Shop or Likely Overbid? */}
                        <td
                          className="py-1.5 px-2 text-gray-400 text-xs max-w-[200px] truncate"
                          title={deal.go_shop_raw || ""}
                        >
                          {deal.go_shop_raw || ""}
                        </td>
                        {/* Vote Risk */}
                        <td className="py-1.5 px-2 text-center">
                          {riskBadge(deal.vote_risk)}
                        </td>
                        {/* Finance Risk */}
                        <td className="py-1.5 px-2 text-center">
                          {riskBadge(deal.finance_risk)}
                        </td>
                        {/* Legal Risk */}
                        <td className="py-1.5 px-2 text-center">
                          {riskBadge(deal.legal_risk)}
                        </td>
                        {/* CVR */}
                        <td className="py-1.5 px-2 text-center text-xs whitespace-nowrap">
                          {deal.cvr_flag &&
                          deal.cvr_flag.toLowerCase() !== "no" ? (
                            <span
                              className="text-purple-400"
                              title={deal.cvr_flag}
                            >
                              {deal.cvr_flag === "Yes" || deal.cvr_flag === "Yes " ? "Yes" : "Yes*"}
                            </span>
                          ) : deal.cvr_flag?.toLowerCase() === "no" ? (
                            <span className="text-gray-600">No</span>
                          ) : null}
                        </td>
                        {/* Risk Score */}
                        <td className="py-1.5 px-2 text-center">
                          {riskScoreCell(riskData[deal.ticker], riskChanges[deal.ticker])}
                        </td>
                        {/* Exclude toggle */}
                        {showExcluded && (
                          <td className="py-1.5 px-1 text-center">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                toggleExclude(
                                  deal.ticker,
                                  !!deal.is_excluded
                                );
                              }}
                              className="text-gray-500 hover:text-gray-300 transition-colors"
                              title={
                                deal.is_excluded
                                  ? "Include deal"
                                  : "Exclude deal"
                              }
                            >
                              {deal.is_excluded ? (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 w-4 inline"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                                    clipRule="evenodd"
                                  />
                                  <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 w-4 inline"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                  <path
                                    fillRule="evenodd"
                                    d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sortedDeals.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                {filter
                  ? `No deals match your filter (${deals.length} total)`
                  : "No deals found. Try ingesting first."}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
