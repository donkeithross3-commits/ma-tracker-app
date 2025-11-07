"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

interface DealFormData {
  // Basic Info (pre-populated)
  ticker: string;
  targetName: string;
  acquirorTicker: string;
  acquirorName: string;
  status: string;

  // Dates
  announcedDate: string;
  expectedCloseDate: string;
  outsideDate: string;
  goShopEndDate: string;

  // Deal Terms
  category: string;
  cashPerShare: string;
  stockRatio: string;
  dividendsOther: string;
  stressTestDiscount: string;

  // Risk Assessments
  voteRisk: string;
  financeRisk: string;
  legalRisk: string;

  // Calculated/Investment
  currentYield: string;
  isInvestable: boolean;
  investableNotes: string;
  dealNotes: string;
}

export default function DealEditPage() {
  const router = useRouter();
  const params = useParams();
  const dealId = params.dealId as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparedDeal, setPreparedDeal] = useState<any>(null);

  const [formData, setFormData] = useState<DealFormData>({
    ticker: "",
    targetName: "",
    acquirorTicker: "",
    acquirorName: "",
    status: "active",
    announcedDate: "",
    expectedCloseDate: "",
    outsideDate: "",
    goShopEndDate: "",
    category: "",
    cashPerShare: "",
    stockRatio: "",
    dividendsOther: "",
    stressTestDiscount: "",
    voteRisk: "",
    financeRisk: "",
    legalRisk: "",
    currentYield: "",
    isInvestable: false,
    investableNotes: "",
    dealNotes: "",
  });

  useEffect(() => {
    fetchPreparedDeal();
  }, [dealId]);

  const fetchPreparedDeal = async () => {
    try {
      const response = await fetch(`/api/deals/prepare?dealId=${dealId}`);
      if (!response.ok) throw new Error("Failed to fetch deal data");

      const data = await response.json();
      const deal = data.deal;
      setPreparedDeal(deal);

      // Pre-populate form with available data from intelligence + research
      setFormData({
        ticker: deal.ticker || "",
        targetName: deal.targetName || "",
        acquirorTicker: deal.acquirorTicker || "",
        acquirorName: deal.acquirorName || "",
        status: "active",
        // Dates from research
        announcedDate: deal.announcedDate || "",
        expectedCloseDate: deal.expectedCloseDate || "",
        outsideDate: deal.outsideDate || "",
        goShopEndDate: deal.goShopEndDate || "",
        // Deal terms from research
        category: deal.category || "",
        cashPerShare: deal.cashPerShare?.toString() || "",
        stockRatio: deal.stockRatio?.toString() || "",
        dividendsOther: deal.dividendsOther?.toString() || "",
        stressTestDiscount: deal.stressTestDiscount?.toString() || "",
        // Risk factors from research
        voteRisk: deal.voteRisk || "",
        financeRisk: deal.financeRisk || "",
        legalRisk: deal.legalRisk || "",
        // Investment fields (user completes these)
        currentYield: deal.currentYield?.toString() || "",
        isInvestable: deal.isInvestable || false,
        investableNotes: deal.investableNotes || "",
        dealNotes: deal.dealNotes || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          cashPerShare: formData.cashPerShare ? parseFloat(formData.cashPerShare) : null,
          stockRatio: formData.stockRatio ? parseFloat(formData.stockRatio) : null,
          dividendsOther: formData.dividendsOther ? parseFloat(formData.dividendsOther) : null,
          stressTestDiscount: formData.stressTestDiscount ? parseFloat(formData.stressTestDiscount) : null,
          currentYield: formData.currentYield ? parseFloat(formData.currentYield) : null,
          announcedDate: formData.announcedDate || null,
          expectedCloseDate: formData.expectedCloseDate || null,
          outsideDate: formData.outsideDate || null,
          goShopEndDate: formData.goShopEndDate || null,
          createdById: null, // TODO: Get from auth
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || "Failed to create deal");
      }

      const { deal } = await response.json();

      // Redirect to M&A Dashboard to see the new deal
      router.push(`/deals`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof DealFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading deal data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-800 text-sm mb-2 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Add Deal to Production</h1>
          <p className="text-sm text-gray-600 mt-2">
            Review and complete the deal details below. Fields marked with * are required.
          </p>
        </div>

        {/* Intelligence Summary Card */}
        {preparedDeal && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 mb-2">Intelligence Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Confidence Score:</span>{" "}
                <span className="font-medium">{(preparedDeal.confidenceScore * 100).toFixed(0)}%</span>
              </div>
              <div>
                <span className="text-blue-700">Sources:</span>{" "}
                <span className="font-medium">{preparedDeal.sourceCount}</span>
              </div>
              <div>
                <span className="text-blue-700">First Detected:</span>{" "}
                <span className="font-medium">{new Date(preparedDeal.firstDetectedAt).toLocaleDateString()}</span>
              </div>
              {preparedDeal.edgar_status?.has_edgar_filing && (
                <div>
                  <span className="text-blue-700">EDGAR Filings:</span>{" "}
                  <span className="font-medium">{preparedDeal.edgar_status.edgar_filing_count}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Research Report Viewer */}
        {preparedDeal?.hasResearch && preparedDeal.researchReport && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">AI Research Report</h2>
              <span className="text-xs text-gray-500 bg-green-100 px-2 py-1 rounded">
                Generated from EDGAR filing
              </span>
            </div>
            <div className="prose prose-sm max-w-none bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">
                {preparedDeal.researchReport}
              </pre>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Ticker *
                </label>
                <input
                  type="text"
                  required
                  value={formData.ticker}
                  onChange={(e) => updateField("ticker", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="AAPL"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.targetName}
                  onChange={(e) => updateField("targetName", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Apple Inc."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Acquiror Ticker
                </label>
                <input
                  type="text"
                  value={formData.acquirorTicker}
                  onChange={(e) => updateField("acquirorTicker", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="MSFT"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Acquiror Name
                </label>
                <input
                  type="text"
                  value={formData.acquirorName}
                  onChange={(e) => updateField("acquirorName", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Microsoft Corporation"
                />
              </div>
            </div>
          </div>

          {/* Important Dates */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Important Dates</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Announced Date
                </label>
                <input
                  type="date"
                  value={formData.announcedDate}
                  onChange={(e) => updateField("announcedDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Close Date
                </label>
                <input
                  type="date"
                  value={formData.expectedCloseDate}
                  onChange={(e) => updateField("expectedCloseDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Outside Date
                </label>
                <input
                  type="date"
                  value={formData.outsideDate}
                  onChange={(e) => updateField("outsideDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Date after which either party can terminate</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Go-Shop End Date
                </label>
                <input
                  type="date"
                  value={formData.goShopEndDate}
                  onChange={(e) => updateField("goShopEndDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Deal Terms */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Deal Terms</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => updateField("category", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  <option value="all_cash">All Cash</option>
                  <option value="cash_stock">Cash + Stock</option>
                  <option value="cash_cvr">Cash + CVR</option>
                  <option value="stock">Stock</option>
                  <option value="non_binding_offer">Non-Binding Offer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cash Per Share ($)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.cashPerShare}
                  onChange={(e) => updateField("cashPerShare", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="54.20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stock Ratio
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={formData.stockRatio}
                  onChange={(e) => updateField("stockRatio", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.345"
                />
                <p className="text-xs text-gray-500 mt-1">Exchange ratio for stock deals</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dividends / Other ($)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.dividendsOther}
                  onChange={(e) => updateField("dividendsOther", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stress Test Discount
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.stressTestDiscount}
                  onChange={(e) => updateField("stressTestDiscount", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.05"
                />
                <p className="text-xs text-gray-500 mt-1">Discount factor for stress testing</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Yield
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={formData.currentYield}
                  onChange={(e) => updateField("currentYield", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.0850"
                />
                <p className="text-xs text-gray-500 mt-1">Expected IRR</p>
              </div>
            </div>
          </div>

          {/* Risk Assessment */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Risk Assessment</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vote Risk
                </label>
                <select
                  value={formData.voteRisk}
                  onChange={(e) => updateField("voteRisk", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Finance Risk
                </label>
                <select
                  value={formData.financeRisk}
                  onChange={(e) => updateField("financeRisk", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Legal Risk
                </label>
                <select
                  value={formData.legalRisk}
                  onChange={(e) => updateField("legalRisk", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* Investment Decision */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Investment Decision</h2>
            <div className="space-y-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isInvestable"
                  checked={formData.isInvestable}
                  onChange={(e) => updateField("isInvestable", e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="isInvestable" className="ml-2 block text-sm font-medium text-gray-700">
                  This deal is investable
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Investable Notes
                </label>
                <textarea
                  value={formData.investableNotes}
                  onChange={(e) => updateField("investableNotes", e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Explain why this deal is or isn't investable..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deal Notes
                </label>
                <textarea
                  value={formData.dealNotes}
                  onChange={(e) => updateField("dealNotes", e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="General notes about this deal..."
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              )}
              {saving ? "Saving..." : "Add to Production"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
