"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface StagedDeal {
  id: string;
  targetName: string;
  targetTicker: string | null;
  acquirerName: string | null;
  dealValue: number | null;
  dealType: string | null;
  confidenceScore: number | null;
  status: string;
  researchStatus: string;
  detectedAt: string;
  filingDate: string;
  filingType: string;
  filingUrl: string;
}

interface IntelligenceDeal {
  dealId: string;
  targetName: string;
  targetTicker: string | null;
  acquirerName: string | null;
  dealTier: string;
  dealStatus: string;
  dealValue: number | null;
  confidenceScore: number;
  sourceCount: number;
  firstDetectedAt: string;
}

export default function StagingPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"edgar" | "intelligence">("edgar");
  const [deals, setDeals] = useState<StagedDeal[]>([]);
  const [intelligenceDeals, setIntelligenceDeals] = useState<IntelligenceDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [tierFilter, setTierFilter] = useState<"all" | "active" | "rumored" | "watchlist">("all");

  const [edgarStatus, setEdgarStatus] = useState<{
    is_running: boolean;
    message: string;
  } | null>(null);

  const [intelligenceStatus, setIntelligenceStatus] = useState<{
    is_running: boolean;
    message: string;
    monitors_count?: number;
  } | null>(null);

  useEffect(() => {
    if (activeTab === "edgar") {
      fetchDeals();
    } else {
      fetchIntelligenceDeals();
    }
    fetchMonitoringStatus();
  }, [filter, tierFilter, activeTab]);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? "http://localhost:8000/edgar/staged-deals"
        : `http://localhost:8000/edgar/staged-deals?status=${filter}`;

      const response = await fetch(url);
      const data = await response.json();
      setDeals(data);
    } catch (error) {
      console.error("Failed to fetch deals:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchIntelligenceDeals = async () => {
    setLoading(true);
    try {
      const url = tierFilter === "all"
        ? "http://localhost:8000/intelligence/deals"
        : `http://localhost:8000/intelligence/deals?tier=${tierFilter}`;

      const response = await fetch(url);
      const data = await response.json();
      setIntelligenceDeals(data);
    } catch (error) {
      console.error("Failed to fetch intelligence deals:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonitoringStatus = async () => {
    try {
      // Fetch EDGAR status
      const edgarResponse = await fetch("http://localhost:8000/edgar/monitoring/status");
      const edgarData = await edgarResponse.json();
      setEdgarStatus(edgarData);

      // Fetch Intelligence status
      const intelligenceResponse = await fetch("http://localhost:8000/intelligence/monitoring/status");
      const intelligenceData = await intelligenceResponse.json();
      setIntelligenceStatus(intelligenceData);
    } catch (error) {
      console.error("Failed to fetch monitoring status:", error);
    }
  };

  const toggleEdgarMonitoring = async () => {
    try {
      const endpoint = edgarStatus?.is_running
        ? "http://localhost:8000/edgar/monitoring/stop"
        : "http://localhost:8000/edgar/monitoring/start";

      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      setEdgarStatus(data);
    } catch (error) {
      console.error("Failed to toggle EDGAR monitoring:", error);
    }
  };

  const toggleIntelligenceMonitoring = async () => {
    try {
      const endpoint = intelligenceStatus?.is_running
        ? "http://localhost:8000/intelligence/monitoring/stop"
        : "http://localhost:8000/intelligence/monitoring/start";

      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      setIntelligenceStatus(data);
      // Refresh intelligence deals after starting monitoring
      if (data.is_running) {
        setTimeout(() => fetchIntelligenceDeals(), 2000);
      }
    } catch (error) {
      console.error("Failed to toggle Intelligence monitoring:", error);
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "Not disclosed";
    return `$${value.toFixed(2)}B`;
  };

  const formatDate = (dateString: string) => {
    const utcDateString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
    return new Date(utcDateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTierBadge = (tier: string) => {
    const styles = {
      active: "bg-green-100 text-green-800",
      rumored: "bg-yellow-100 text-yellow-800",
      watchlist: "bg-gray-100 text-gray-800",
    };
    return styles[tier as keyof typeof styles] || styles.watchlist;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">M&A Intelligence Platform</h1>
              <p className="text-gray-600 mt-2">
                Multi-source deal monitoring and staging
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              ← Back to Dashboard
            </Link>
          </div>

          {/* Monitoring Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* EDGAR Monitoring Card */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    EDGAR Real-Time Monitoring
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          edgarStatus?.is_running ? "bg-green-500" : "bg-gray-400"
                        }`}
                      />
                      <span className="text-sm text-gray-700">
                        {edgarStatus?.is_running ? "Running" : "Stopped"}
                      </span>
                    </div>
                    {edgarStatus?.is_running && (
                      <span className="text-xs text-gray-500">
                        Polling every 60s
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={toggleEdgarMonitoring}
                  className={`px-6 py-2 rounded-lg font-medium ${
                    edgarStatus?.is_running
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-green-600 text-white hover:bg-green-700"
                  }`}
                >
                  {edgarStatus?.is_running ? "Stop" : "Start"}
                </button>
              </div>
            </div>

            {/* Intelligence Monitoring Card */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Multi-Source Intelligence
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          intelligenceStatus?.is_running ? "bg-green-500" : "bg-gray-400"
                        }`}
                      />
                      <span className="text-sm text-gray-700">
                        {intelligenceStatus?.is_running ? "Running" : "Stopped"}
                      </span>
                    </div>
                    {intelligenceStatus?.is_running && intelligenceStatus.monitors_count && (
                      <span className="text-xs text-gray-500">
                        {intelligenceStatus.monitors_count} sources active
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={toggleIntelligenceMonitoring}
                  className={`px-6 py-2 rounded-lg font-medium ${
                    intelligenceStatus?.is_running
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {intelligenceStatus?.is_running ? "Stop" : "Start"}
                </button>
              </div>
              {intelligenceStatus?.is_running && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Monitoring: FTC, Reuters, Seeking Alpha, and more...
                  </p>
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => router.push("/rumored-deals")}
                  className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  View Rumor Watch Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <div className="flex">
              <button
                onClick={() => setActiveTab("edgar")}
                className={`px-6 py-3 font-medium ${
                  activeTab === "edgar"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                EDGAR Staging Queue
              </button>
              <button
                onClick={() => setActiveTab("intelligence")}
                className={`px-6 py-3 font-medium ${
                  activeTab === "intelligence"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Intelligence Deals
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {activeTab === "edgar" ? (
                <>
                  {["all", "pending", "approved", "rejected"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f as any)}
                      className={`px-4 py-2 rounded-lg font-medium capitalize ${
                        filter === f
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {["all", "active", "rumored", "watchlist"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setTierFilter(f as any)}
                      className={`px-4 py-2 rounded-lg font-medium capitalize ${
                        tierFilter === f
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                      title={
                        f === "all" ? "All deals from all confidence tiers" :
                        f === "active" ? "High-confidence deals with multiple corroborating sources" :
                        f === "rumored" ? "Medium-confidence deals with EDGAR validation" :
                        "Low-confidence watchlist deals (early signals)"
                      }
                    >
                      {f === "watchlist" ? "General" : f}
                    </button>
                  ))}
                </>
              )}
            </div>
            {activeTab === "intelligence" && (
              <div className="text-xs text-gray-500 flex items-start gap-2">
                <svg className="w-4 h-4 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  <strong>All:</strong> All deals •
                  <strong className="ml-1">Active:</strong> High confidence •
                  <strong className="ml-1">Rumored:</strong> EDGAR validated •
                  <strong className="ml-1">General:</strong> Watchlist (early signals)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Rumored Deals Helper Banner */}
        {activeTab === "intelligence" && tierFilter === "rumored" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="font-semibold text-amber-900">Rumored Deals with EDGAR Validation</h3>
                </div>
                <p className="text-sm text-amber-800 mb-3">
                  View the detailed Rumor Watch Dashboard for comprehensive EDGAR cross-reference validation,
                  filing analysis, and confidence scoring for all rumored deals.
                </p>
                <button
                  onClick={() => router.push("/rumored-deals")}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Open Rumor Watch Dashboard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : activeTab === "edgar" ? (
            // EDGAR Deals Table
            deals.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 mb-2">No {filter} deals found</p>
                {filter === "pending" && !edgarStatus?.is_running && (
                  <p className="text-sm text-gray-400">
                    Start monitoring to detect new M&A deals from EDGAR
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Target
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acquirer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deal Value
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Filing
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Filing / Detected
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {deals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {deal.targetName}
                          </div>
                          {deal.targetTicker && (
                            <div className="text-sm text-gray-500">{deal.targetTicker}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {deal.acquirerName || "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(deal.dealValue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <a
                          href={deal.filingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {deal.filingType}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`text-sm font-medium ${
                            deal.confidenceScore && deal.confidenceScore >= 0.7
                              ? "text-green-600"
                              : deal.confidenceScore && deal.confidenceScore >= 0.5
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}
                        >
                          {deal.confidenceScore
                            ? `${(deal.confidenceScore * 100).toFixed(0)}%`
                            : "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex flex-col">
                          <span className="text-gray-700 font-medium">Filed: {formatDate(deal.filingDate)}</span>
                          <span className="text-gray-500 text-xs">Detected: {formatDate(deal.detectedAt)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            deal.status === "pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : deal.status === "approved"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {deal.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Link
                          href={`/staging/${deal.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            // Intelligence Deals Table
            intelligenceDeals.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 mb-2">No {tierFilter === "all" ? "" : tierFilter} deals found</p>
                {!intelligenceStatus?.is_running && (
                  <p className="text-sm text-gray-400">
                    Start intelligence monitoring to aggregate deals from multiple sources
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Target
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acquirer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deal Value
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Sources
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      First Detected
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {intelligenceDeals.map((deal) => (
                    <tr key={deal.dealId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {deal.targetName}
                          </div>
                          {deal.targetTicker && (
                            <div className="text-sm text-gray-500">{deal.targetTicker}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {deal.acquirerName || "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(deal.dealValue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${getTierBadge(deal.dealTier)}`}
                        >
                          {deal.dealTier}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-blue-600">
                          {deal.sourceCount} {deal.sourceCount === 1 ? 'source' : 'sources'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`text-sm font-medium ${
                            deal.confidenceScore >= 0.7
                              ? "text-green-600"
                              : deal.confidenceScore >= 0.5
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}
                        >
                          {(deal.confidenceScore * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(deal.firstDetectedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => router.push(`/intelligence/deals/${deal.dealId}`)}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          View Sources →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
