"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface EdgarStatus {
  has_edgar_filing: boolean;
  edgar_filing_count: number;
  edgar_filing_types: string[];
  last_edgar_search: string | null;
  confidence_impact: number | null;
  filings_found_in_last_search: number;
}

interface RumoredDeal {
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
  promoted_to_rumored_at: string | null;
  edgar_status: EdgarStatus;
  source_breakdown: {
    total: number;
    edgar: number;
    non_edgar: number;
  };
}

export default function RumoredDealsPage() {
  const router = useRouter();
  const [deals, setDeals] = useState<RumoredDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRumoredDeals();
  }, []);

  const fetchRumoredDeals = async () => {
    try {
      const response = await fetch("http://localhost:8000/intelligence/rumored-deals");
      if (!response.ok) throw new Error("Failed to fetch rumored deals");

      const data = await response.json();
      setDeals(data.deals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case "rumored": return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "watchlist": return "bg-gray-100 text-gray-800 border-gray-300";
      default: return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getEdgarStatusBadge = (status: EdgarStatus) => {
    if (status.has_edgar_filing) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 border border-green-300">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-green-800">EDGAR Confirmed</span>
          </div>
          <span className="text-xs text-gray-600">
            {status.edgar_filing_count} filing{status.edgar_filing_count !== 1 ? 's' : ''}
          </span>
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 border border-amber-200">
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm font-medium text-amber-800">No EDGAR Filing</span>
        </div>
      );
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
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
          <p className="text-gray-600">Loading rumored deals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Rumor Watch</h1>
              <p className="text-gray-600 mt-2">
                Tracking {deals.length} rumored deals with EDGAR cross-reference validation
              </p>
            </div>
            <button
              onClick={() => router.push("/staging")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Back to Intelligence
            </button>
          </div>

          {/* Legend */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">About EDGAR Validation</h3>
            <p className="text-sm text-blue-800">
              Each rumored deal is automatically cross-referenced with EDGAR filings.
              Deals with corroborating EDGAR filings (8-K, DEFM14A, SC TO, etc.) receive a confidence boost
              and are prioritized for promotion to Active status.
            </p>
          </div>
        </div>

        {/* Deals List */}
        {deals.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 text-lg">No rumored deals found.</p>
            <p className="text-gray-500 text-sm mt-2">Start monitoring sources to detect potential M&A activity.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {deals.map((deal) => (
              <div key={deal.deal_id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                <div className="p-6">
                  {/* Deal Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-2xl font-bold text-gray-900">
                          {deal.target_name}
                          {deal.target_ticker && (
                            <span className="text-lg text-gray-600 ml-2">({deal.target_ticker})</span>
                          )}
                        </h2>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getTierBadgeColor(deal.deal_tier)}`}>
                          {deal.deal_tier.toUpperCase()}
                        </span>
                      </div>
                      {deal.acquirer_name && (
                        <p className="text-gray-700">
                          Potential acquirer: <span className="font-semibold">{deal.acquirer_name}</span>
                          {deal.acquirer_ticker && ` (${deal.acquirer_ticker})`}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Confidence</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {(deal.confidence_score * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  {/* EDGAR Status Section */}
                  <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-lg p-4 mb-4 border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">EDGAR Validation Status</h3>
                      {getEdgarStatusBadge(deal.edgar_status)}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                      <div className="bg-white rounded p-3 shadow-sm">
                        <p className="text-xs text-gray-500 font-medium">Last EDGAR Search</p>
                        <p className="text-sm text-gray-900 font-semibold mt-1">
                          {deal.edgar_status.last_edgar_search
                            ? formatDate(deal.edgar_status.last_edgar_search)
                            : "Not searched"}
                        </p>
                      </div>
                      <div className="bg-white rounded p-3 shadow-sm">
                        <p className="text-xs text-gray-500 font-medium">Filings Found</p>
                        <p className="text-sm text-gray-900 font-semibold mt-1">
                          {deal.edgar_status.filings_found_in_last_search}
                        </p>
                      </div>
                      <div className="bg-white rounded p-3 shadow-sm">
                        <p className="text-xs text-gray-500 font-medium">Confidence Impact</p>
                        <p className="text-sm font-semibold mt-1">
                          {deal.edgar_status.confidence_impact !== null ? (
                            <span className={deal.edgar_status.confidence_impact > 0 ? "text-green-600" : "text-gray-600"}>
                              {deal.edgar_status.confidence_impact > 0 ? "+" : ""}
                              {(deal.edgar_status.confidence_impact * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </p>
                      </div>
                      <div className="bg-white rounded p-3 shadow-sm">
                        <p className="text-xs text-gray-500 font-medium">Source Mix</p>
                        <p className="text-sm text-gray-900 font-semibold mt-1">
                          {deal.source_breakdown.edgar} EDGAR / {deal.source_breakdown.non_edgar} Other
                        </p>
                      </div>
                    </div>

                    {deal.edgar_status.edgar_filing_types.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-600 mb-2">Filing Types Found:</p>
                        <div className="flex flex-wrap gap-1">
                          {deal.edgar_status.edgar_filing_types.map((type, idx) => (
                            <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                              {type}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Deal Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-gray-600">Deal Value</p>
                      <p className="text-lg font-semibold">{formatCurrency(deal.deal_value)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Deal Type</p>
                      <p className="text-lg font-semibold">{deal.deal_type || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Total Sources</p>
                      <p className="text-lg font-semibold">{deal.source_count}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">First Detected</p>
                      <p className="text-lg font-semibold">{formatDate(deal.first_detected_at)}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => router.push(`/intelligence/deals/${deal.deal_id}`)}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      View All Sources
                    </button>
                    {deal.target_ticker && (
                      <button
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                        onClick={() => {
                          // Could link to EDGAR search or ticker watchlist
                          alert(`Monitor ${deal.target_ticker} on EDGAR`);
                        }}
                      >
                        Monitor {deal.target_ticker}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
