"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import { useAIUsageData } from "./_lib/use-ai-usage";
import { aggregateByDay } from "./_lib/aggregations";
import { SummaryStrip } from "./_components/SummaryStrip";
import { AnomalyBanner } from "./_components/AnomalyBanner";
import { OverviewTab } from "./_components/OverviewTab";
import { SessionsTab } from "./_components/SessionsTab";
import { EfficiencyTab } from "./_components/EfficiencyTab";

export default function AIUsagePage() {
  const [days, setDays] = useState(7);
  const [activeTab, setActiveTab] = useState<"overview" | "sessions" | "efficiency">("overview");
  const { summary, burnRate, sessions, efficiency, quotaBudget, loading, error, lastSync, refresh } =
    useAIUsageData(days);

  const dailyData = useMemo(() => aggregateByDay(summary), [summary]);

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading AI usage data\u2026</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Sticky header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-300 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">AI Usage</h1>
              <p className="text-[10px] text-gray-500">
                Token consumption + cost{lastSync ? ` \u00B7 synced ${lastSync}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    days === d ? "bg-gray-700 text-gray-100" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              onClick={refresh}
              className="px-2.5 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition-colors"
            >
              Refresh
            </button>
            <UserMenu variant="dark" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {error && (
          <div className="rounded border border-red-600/40 bg-red-950/40 text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <AnomalyBanner anomalies={efficiency?.anomalies} />

        <SummaryStrip summary={summary} burnRate={burnRate} quotaBudget={quotaBudget} days={days} />

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-gray-800">
          {(["overview", "sessions", "efficiency"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px capitalize ${
                activeTab === tab
                  ? "border-blue-500 text-gray-100"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <OverviewTab dailyData={dailyData} summary={summary} efficiency={efficiency} />
        )}
        {activeTab === "sessions" && <SessionsTab sessions={sessions} />}
        {activeTab === "efficiency" && (
          <EfficiencyTab efficiency={efficiency} summary={summary} quotaBudget={quotaBudget} />
        )}
      </main>
    </div>
  );
}
