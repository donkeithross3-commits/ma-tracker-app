"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface DealDetail {
  deal_id: string;
  target_name: string;
  target_ticker: string | null;
  acquirer_name: string | null;
  acquirer_ticker: string | null;
  deal_tier: string;
  deal_status: string;
  deal_value: number | null;
  deal_type: string | null;
  confidence_score: number;
  source_count: number;
  first_detected_at: string;
  last_updated_source_at: string | null;
}

interface DealSource {
  source_id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  mention_type: string;
  headline: string | null;
  content_snippet: string | null;
  credibility_score: number;
  source_published_at: string | null;
  detected_at: string;
  extracted_data: any;
}

export default function DealSourcesPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.dealId as string;

  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [sources, setSources] = useState<DealSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unapproving, setUnapproving] = useState(false);

  useEffect(() => {
    fetchDealDetails();
  }, [dealId]);

  const fetchDealDetails = async () => {
    try {
      const response = await fetch(`http://localhost:8000/intelligence/deals/${dealId}`);
      if (!response.ok) throw new Error("Failed to fetch deal details");

      const data = await response.json();
      setDeal(data.deal);
      setSources(data.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleUnapprove = async () => {
    if (!confirm("Are you sure you want to send this deal back to the staging area?")) {
      return;
    }

    setUnapproving(true);
    try {
      const response = await fetch(
        `http://localhost:8000/edgar/intelligence-deals/${dealId}/unapprove`,
        { method: "POST" }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to unapprove deal");
      }

      const result = await response.json();
      alert(result.message);
      router.push("/staging");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unapprove deal");
    } finally {
      setUnapproving(false);
    }
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case "active": return "bg-green-100 text-green-800";
      case "rumored": return "bg-yellow-100 text-yellow-800";
      case "watchlist": return "bg-gray-100 text-gray-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getSourceTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      "regulatory": "bg-blue-100 text-blue-800",
      "news": "bg-purple-100 text-purple-800",
      "financial_data": "bg-indigo-100 text-indigo-800",
      "social_media": "bg-pink-100 text-pink-800",
      "market_data": "bg-teal-100 text-teal-800",
    };
    return colors[type] || "bg-gray-100 text-gray-800";
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return "N/A";
    return `$${value.toLocaleString()}B`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading deal details...</p>
        </div>
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error || "Deal not found"}</p>
          <button
            onClick={() => router.push("/staging")}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Staging
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => router.push("/staging")}
              className="text-blue-600 hover:text-blue-800 flex items-center"
            >
              ← Back to Intelligence Deals
            </button>
            <button
              onClick={handleUnapprove}
              disabled={unapproving}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {unapproving ? "Sending back..." : "↩ Send Back to Staging"}
            </button>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Deal Sources</h1>
        </div>

        {/* Deal Summary Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {deal.target_name}
                {deal.target_ticker && (
                  <span className="text-lg text-gray-600 ml-2">({deal.target_ticker})</span>
                )}
              </h2>
              {deal.acquirer_name && (
                <p className="text-lg text-gray-700">
                  Acquired by: <span className="font-semibold">{deal.acquirer_name}</span>
                  {deal.acquirer_ticker && ` (${deal.acquirer_ticker})`}
                </p>
              )}
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getTierBadgeColor(deal.deal_tier)}`}>
              {deal.deal_tier.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
            <div>
              <p className="text-sm text-gray-600">Deal Value</p>
              <p className="text-lg font-semibold">{formatCurrency(deal.deal_value)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Deal Type</p>
              <p className="text-lg font-semibold">{deal.deal_type || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Confidence Score</p>
              <p className="text-lg font-semibold">{(deal.confidence_score * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Source Count</p>
              <p className="text-lg font-semibold">{deal.source_count} sources</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 mt-4">
            <div>
              <p className="text-sm text-gray-600">First Detected</p>
              <p className="text-sm font-medium">{formatDate(deal.first_detected_at)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Last Updated</p>
              <p className="text-sm font-medium">{formatDate(deal.last_updated_source_at)}</p>
            </div>
          </div>
        </div>

        {/* Sources List */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">
            Sources ({sources.length})
          </h3>
        </div>

        <div className="space-y-4">
          {sources.map((source) => (
            <div key={source.source_id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              {/* Source Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getSourceTypeBadge(source.source_type)}`}>
                      {source.source_name}
                    </span>
                    <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                      {source.mention_type}
                    </span>
                  </div>
                  {source.headline && (
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">{source.headline}</h4>
                  )}
                </div>
                <div className="text-right ml-4">
                  <p className="text-sm text-gray-600">Credibility</p>
                  <p className="text-lg font-bold text-blue-600">{(source.credibility_score * 100).toFixed(0)}%</p>
                </div>
              </div>

              {/* Content Snippet */}
              {source.content_snippet && (
                <p className="text-gray-700 mb-3 text-sm leading-relaxed">{source.content_snippet}</p>
              )}

              {/* Extracted Data */}
              {source.extracted_data && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 mb-4 border border-blue-100">
                  <p className="text-xs font-bold text-blue-900 mb-1 uppercase tracking-wide">Original AI Extraction from Source</p>
                  <p className="text-xs text-gray-600 mb-3 italic">Note: This shows what was initially extracted. See deal summary above for verified information.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      try {
                        const data = typeof source.extracted_data === 'string'
                          ? JSON.parse(source.extracted_data)
                          : source.extracted_data;
                        return Object.entries(data).map(([key, value]) => (
                          <div key={key} className="bg-white rounded p-2 shadow-sm">
                            <p className="text-xs text-gray-500 font-medium capitalize">
                              {key.replace(/_/g, ' ')}
                            </p>
                            <p className="text-sm text-gray-900 font-semibold mt-1">
                              {value === null || value === undefined ? '—' : String(value)}
                            </p>
                          </div>
                        ));
                      } catch (e) {
                        return (
                          <div className="col-span-2">
                            <pre className="text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(source.extracted_data, null, 2)}
                            </pre>
                          </div>
                        );
                      }
                    })()}
                  </div>
                </div>
              )}

              {/* Source Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-200 mt-3">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  {source.source_published_at && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-700">Published:</span>
                      <span>{formatDate(source.source_published_at)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-700">Detected:</span>
                    <span>{formatDate(source.detected_at)}</span>
                  </div>
                </div>
                {source.source_url && (
                  <a
                    href={source.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    View Original Source
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {sources.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600">No sources found for this deal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
