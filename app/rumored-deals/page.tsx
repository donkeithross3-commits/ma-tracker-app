"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/dateUtils";

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
  source_published_at: string | null;
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

  // Rejection dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingDealId, setRejectingDealId] = useState<string | null>(null);
  const [rejectionCategory, setRejectionCategory] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState<string>("");

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

  const formatCurrency = (value: number | null) => {
    if (!value) return "N/A";
    return `$${value.toLocaleString()}B`;
  };

  const handleRejectClick = (dealId: string) => {
    setRejectingDealId(dealId);
    setRejectionCategory("");
    setRejectionReason("");
    setShowRejectDialog(true);
  };

  const confirmRejectDeal = async () => {
    if (!rejectingDealId) {
      console.error("No deal ID to reject");
      return;
    }

    console.log("Rejecting intelligence deal:", rejectingDealId, {
      category: rejectionCategory,
      reason: rejectionReason
    });

    try {
      const response = await fetch(`/api/intelligence/deals/${rejectingDealId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rejection_category: rejectionCategory || null,
          rejection_reason: rejectionReason || null,
        }),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Backend error:", errorData);
        throw new Error(errorData.error || "Failed to reject deal");
      }

      const data = await response.json();
      console.log("Deal rejected successfully:", data);

      // Close dialog and reset state
      setShowRejectDialog(false);
      setRejectingDealId(null);
      setRejectionCategory("");
      setRejectionReason("");

      // Refresh deals list
      await fetchRumoredDeals();

      alert(`Deal "${data.deal_status}" successfully`);
    } catch (error) {
      console.error("Error rejecting deal:", error);
      alert(error instanceof Error ? error.message : "Failed to reject deal");
    }
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
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-full mx-auto px-4">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Rumor Watch</h1>
              <p className="text-sm text-gray-600 mt-1">
                Tracking {deals.length} rumored deals with EDGAR validation
              </p>
            </div>
            <button
              onClick={() => router.push("/staging")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Back to Intelligence
            </button>
          </div>
        </div>

        {/* Deals Grid */}
        {deals.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No rumored deals found.</p>
            <p className="text-gray-500 text-sm mt-1">Start monitoring sources to detect potential M&A activity.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Target
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Acquirer
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Tier
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      EDGAR
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                      Conf.
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                      Sources
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Value
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Detected
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {deals.map((deal) => (
                    <tr key={deal.deal_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{deal.target_name}</div>
                          {deal.target_ticker && (
                            <div className="text-xs text-gray-500">{deal.target_ticker}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {deal.acquirer_name ? (
                          <div>
                            <div className="text-sm text-gray-900">{deal.acquirer_name}</div>
                            {deal.acquirer_ticker && (
                              <div className="text-xs text-gray-500">{deal.acquirer_ticker}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${getTierBadgeColor(deal.deal_tier)}`}>
                          {deal.deal_tier}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {deal.edgar_status.has_edgar_filing ? (
                          <div className="flex items-center gap-1">
                            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs text-green-700 font-medium">
                              {deal.edgar_status.edgar_filing_count}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <svg className="w-3 h-3 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="text-xs text-amber-700 font-medium">None</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <span className="text-sm font-semibold text-blue-600">
                          {(deal.confidence_score * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <div className="text-sm text-gray-900">{deal.source_count}</div>
                        <div className="text-xs text-gray-500">
                          {deal.source_breakdown.edgar}E/{deal.source_breakdown.non_edgar}O
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{formatCurrency(deal.deal_value)}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          {deal.source_published_at && (
                            <span className="text-xs text-gray-700 font-medium whitespace-nowrap">
                              {formatDateTime(deal.source_published_at)}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            Det: {formatDateTime(deal.first_detected_at)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => router.push(`/intelligence/deals/${deal.deal_id}`)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => router.push(`/deals/edit/${deal.deal_id}`)}
                            className="text-xs text-green-600 hover:text-green-800 font-medium flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => handleRejectClick(deal.deal_id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Rejection Reason Dialog */}
      {showRejectDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Reject Rumored Deal - Add Reason (Optional)
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Help improve rumor detection accuracy by providing a rejection reason. This will be used to train the filter.
            </p>

            {/* Category Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <select
                value={rejectionCategory}
                onChange={(e) => setRejectionCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a category...</option>
                <option value="not_rumor">Not an M&A Rumor</option>
                <option value="insufficient_evidence">Insufficient Evidence</option>
                <option value="wrong_company">Wrong Company Ticker</option>
                <option value="social_media_noise">Social Media Noise</option>
                <option value="already_in_production">Already in Production</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Free-text Reason */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Additional Details (Optional)
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g., 'This is just speculation on Twitter, no credible sources'"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectingDealId(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmRejectDeal}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Reject Deal
              </button>
            </div>

            {rejectionCategory === "" && rejectionReason === "" && (
              <p className="text-xs text-gray-500 mt-3 text-center">
                You can skip adding a reason, but it helps improve accuracy
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
