"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  filingType: string;
  filingUrl: string;
}

export default function StagedDealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;

  const [deal, setDeal] = useState<StagedDeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    fetchDeal();
  }, [dealId]);

  const fetchDeal = async () => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/edgar/staged-deals/${dealId}`);
      if (response.ok) {
        const data = await response.json();
        setDeal(data);
      } else {
        console.error("Failed to fetch deal");
      }
    } catch (error) {
      console.error("Failed to fetch deal:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (action: "approve" | "reject") => {
    if (!confirm(`Are you sure you want to ${action} this deal?`)) {
      return;
    }

    setReviewing(true);
    try {
      const response = await fetch(
        `/api/edgar/staged-deals/${dealId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        alert(result.message);

        if (action === "approve") {
          // Redirect to deal edit page with pre-populated intelligence data
          router.push(`/deals/edit/${result.dealId}`);
        } else {
          // Go back to staging queue
          router.push("/staging");
        }
      } else {
        alert("Failed to review deal");
      }
    } catch (error) {
      console.error("Failed to review deal:", error);
      alert("Failed to review deal");
    } finally {
      setReviewing(false);
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "Not disclosed";
    return `$${value.toFixed(2)}B`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Deal Not Found</h2>
          <Link href="/staging" className="text-blue-600 hover:underline">
            ← Back to Staging Queue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/staging"
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to Staging Queue
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {deal.targetName}
              </h1>
              {deal.targetTicker && (
                <div className="text-lg text-gray-600">{deal.targetTicker}</div>
              )}
            </div>
            <span
              className={`px-3 py-1 text-sm font-medium rounded-full ${
                deal.status === "pending"
                  ? "bg-yellow-100 text-yellow-800"
                  : deal.status === "approved"
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {deal.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Deal Information Card */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Deal Information</h2>
          </div>
          <div className="p-6 grid grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Target Company
              </label>
              <div className="mt-1 text-lg text-gray-900">{deal.targetName}</div>
              {deal.targetTicker && (
                <div className="text-sm text-gray-600">{deal.targetTicker}</div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Acquirer
              </label>
              <div className="mt-1 text-lg text-gray-900">
                {deal.acquirerName || "Not disclosed"}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Deal Value
              </label>
              <div className="mt-1 text-lg text-gray-900">
                {formatCurrency(deal.dealValue)}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Deal Type
              </label>
              <div className="mt-1 text-lg text-gray-900 capitalize">
                {deal.dealType || "Unknown"}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Detection Confidence
              </label>
              <div className="mt-1">
                <span
                  className={`text-lg font-semibold ${
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
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Detected At
              </label>
              <div className="mt-1 text-sm text-gray-900">
                {formatDate(deal.detectedAt)}
              </div>
            </div>
          </div>
        </div>

        {/* SEC Filing Card */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">SEC Filing</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 mb-1">Filing Type</div>
                <div className="text-lg font-semibold text-gray-900">{deal.filingType}</div>
              </div>
              <a
                href={deal.filingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                View Filing on EDGAR →
              </a>
            </div>
          </div>
        </div>

        {/* Research Status Card */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Research Analysis</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 mb-1">
                  Research Status
                </div>
                <div className="text-lg text-gray-900 capitalize">
                  {deal.researchStatus}
                </div>
              </div>
              {deal.researchStatus === "completed" && (
                <div className="text-sm text-gray-600">
                  AI-generated research analysis is ready for review
                </div>
              )}
              {deal.researchStatus === "queued" && (
                <div className="text-sm text-gray-600">
                  Research analysis is being generated...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Review Actions */}
        {deal.status === "pending" && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Review Actions</h2>
            </div>
            <div className="p-6">
              <div className="flex gap-4">
                <button
                  onClick={() => handleReview("approve")}
                  disabled={reviewing}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reviewing ? "Processing..." : "✓ Approve & Add to Production"}
                </button>
                <button
                  onClick={() => handleReview("reject")}
                  disabled={reviewing}
                  className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reviewing ? "Processing..." : "✗ Reject Deal"}
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-4">
                Approving will create a production deal record and copy all research analysis.
                Rejecting will remove this deal from the staging queue.
              </p>
            </div>
          </div>
        )}

        {deal.status !== "pending" && (
          <div className="bg-gray-100 rounded-lg p-6 text-center">
            <p className="text-gray-700">
              This deal has already been{" "}
              <span className="font-semibold">{deal.status}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
