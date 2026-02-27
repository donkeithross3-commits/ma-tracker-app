"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";

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

export default function BaselineReviewPage() {
  const [view, setView] = useState<"flagged" | "index">("flagged");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [riskChanges, setRiskChanges] = useState<Record<string, RiskChange[]>>({});
  const [changesOpen, setChangesOpen] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      fetch(`/api/sheet-portfolio/baseline-review?view=${view}`)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.text();
        }),
      fetch("/api/sheet-portfolio/risk-changes")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([html, changesArr]) => {
        setHtmlContent(html);
        const map: Record<string, RiskChange[]> = {};
        for (const c of changesArr as RiskChange[]) {
          if (!map[c.ticker]) map[c.ticker] = [];
          map[c.ticker].push(c);
        }
        setRiskChanges(map);
        setChangesOpen(Object.keys(map).length > 0);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [view]);

  const changedTickers = Object.keys(riskChanges);
  const totalChanges = Object.values(riskChanges).reduce((s, arr) => s + arr.length, 0);
  const hasWorsened = Object.values(riskChanges).some(arr => arr.some(c => c.direction === "worsened"));

  // Calculate panel height for iframe adjustment
  const panelHeight = changesOpen && changedTickers.length > 0 ? "auto" : "0";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-3 py-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">AI Baseline Review</h1>
            <p className="text-xs text-gray-500">
              Opus + Sonnet multi-model comparison
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex border border-gray-700 rounded overflow-hidden">
              <button
                onClick={() => setView("flagged")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === "flagged"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                Flagged Deals
              </button>
              <button
                onClick={() => setView("index")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === "index"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                Full Index
              </button>
            </div>
            <Link
              href="/sheet-portfolio"
              className="px-3 py-1.5 text-xs border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 text-xs border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      {/* Risk Changes Panel */}
      {!loading && (
        <div className="border-b border-gray-800 bg-gray-900/50">
          <div className="max-w-[1800px] mx-auto px-3">
            <button
              onClick={() => setChangesOpen(!changesOpen)}
              className="w-full py-1.5 flex items-center gap-2 text-xs"
            >
              <span className={`transition-transform ${changesOpen ? "rotate-90" : ""}`}>
                &#9654;
              </span>
              {changedTickers.length > 0 ? (
                <span className={hasWorsened ? "text-amber-400" : "text-green-400"}>
                  <strong>{totalChanges}</strong> risk grade change{totalChanges !== 1 ? "s" : ""} across{" "}
                  <strong>{changedTickers.length}</strong> deal{changedTickers.length !== 1 ? "s" : ""} today
                </span>
              ) : (
                <span className="text-gray-600">No risk changes today</span>
              )}
            </button>

            {changesOpen && changedTickers.length > 0 && (
              <div className="pb-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(380px, 1fr))` }}>
                {changedTickers.map((ticker) => {
                  const changes = riskChanges[ticker];
                  const tickerWorsened = changes.some(c => c.direction === "worsened");
                  return (
                    <div
                      key={ticker}
                      className={`rounded border px-2.5 py-1.5 text-xs ${
                        tickerWorsened
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-green-500/30 bg-green-500/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          href={`/sheet-portfolio/${ticker}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {ticker}
                        </Link>
                        <span className="text-gray-500">
                          {changes.length} change{changes.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {changes.map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[11px] leading-tight">
                          <span className={c.direction === "worsened" ? "text-red-400" : "text-green-400"}>
                            {c.direction === "worsened" ? "\u2193" : "\u2191"}
                          </span>
                          <div>
                            <span className="text-gray-300 font-medium">{c.factor}</span>
                            <span className="text-gray-500 mx-1">
                              {c.old_level} &rarr; {c.new_level}
                            </span>
                            {c.explanation && (
                              <span className="text-gray-600 block mt-0.5">
                                {c.explanation.length > 150 ? c.explanation.slice(0, 150) + "..." : c.explanation}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-5">
            <span className="text-gray-400 text-sm">Loading review...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-5">
            <span className="text-red-400 text-sm">Failed to load: {error}</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          className="w-full border-0"
          style={{ height: "calc(100vh - 48px)" }}
        />
      </main>
    </div>
  );
}
