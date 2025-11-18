"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDateTime } from "@/lib/dateUtils";
import { stagingCache, CacheKeys } from "@/lib/stagingDataCache";

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
  matchedTextExcerpt: string | null;
}

interface EdgarStatus {
  has_edgar_filing: boolean;
  edgar_filing_count: number;
  edgar_filing_types: string[];
  last_edgar_search: string | null;
  confidence_impact: number | null;
  filings_found_in_last_search: number;
}

interface SourceBreakdown {
  total: number;
  edgar: number;
  non_edgar: number;
}

interface IntelligenceDeal {
  deal_id: string;
  target_name: string;
  target_ticker: string | null;
  acquirer_name: string | null;
  deal_tier: string;
  deal_status: string;
  deal_value: number | null;
  confidence_score: number;
  source_count: number;
  first_detected_at: string;
  source_published_at: string | null;
  edgar_status?: EdgarStatus;
  source_breakdown?: SourceBreakdown;
}

interface Filing {
  filing_id: string;
  accession_number: string;
  company_name: string;
  ticker: string | null;
  filing_type: string;
  filing_date: string;
  filing_url: string;
  is_ma_relevant: boolean;
  confidence_score: number | null;
  detected_keywords: string[];
  keyword_count: number;
  reasoning: string | null;
  status: string;
  processed_at: string | null;
}

// Helper function to format source names for display
function formatSourceName(sourceName: string): string {
  const sourceLabels: Record<string, string> = {
    'globenewswire_ma': 'GlobeNewswire - M&A Announcements',
    'globenewswire_corporate_actions': 'GlobeNewswire - Corporate Actions',
    'globenewswire_executive_changes': 'GlobeNewswire - Executive Changes',
    'reuters_ma': 'Reuters - M&A News',
    'seeking_alpha_ma': 'Seeking Alpha - M&A News',
    'ftc_early_termination': 'FTC - Early Termination Notices'
  };

  return sourceLabels[sourceName] || sourceName.replace(/_/g, ' ').toUpperCase();
}

export default function StagingPage() {
  console.log("[PERF] StagingPage component mounting at", new Date().toISOString());
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"edgar" | "intelligence" | "halts">("edgar");
  const [deals, setDeals] = useState<StagedDeal[]>([]);
  const [intelligenceDeals, setIntelligenceDeals] = useState<IntelligenceDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all_filings" | "all">("pending");
  const [tierFilter, setTierFilter] = useState<"pending" | "watchlist" | "rejected" | "all_articles" | "all">("pending");

  const [edgarStatus, setEdgarStatus] = useState<{
    is_running: boolean;
    message: string;
  } | null>(null);

  const [intelligenceStatus, setIntelligenceStatus] = useState<{
    is_running: boolean;
    message: string;
    monitors_count?: number;
  } | null>(null);

  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // EDGAR rejection dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingDealId, setRejectingDealId] = useState<string | null>(null);
  const [rejectionCategory, setRejectionCategory] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState<string>("");

  // Intelligence rejection dialog state
  const [showIntelligenceRejectDialog, setShowIntelligenceRejectDialog] = useState(false);
  const [rejectingIntelligenceDealId, setRejectingIntelligenceDealId] = useState<string | null>(null);
  const [intelligenceRejectionCategory, setIntelligenceRejectionCategory] = useState<string>("");
  const [intelligenceRejectionReason, setIntelligenceRejectionReason] = useState<string>("");

  // Rumor Watch List state (database-backed)
  const [watchListTickers, setWatchListTickers] = useState<Set<string>>(new Set());

  // Ticker editing state for intelligence deals
  const [editingTickerId, setEditingTickerId] = useState<string | null>(null);
  const [editingTickerValue, setEditingTickerValue] = useState<string>("");

  // Halt monitor state
  const [halts, setHalts] = useState<any[]>([]);
  const [trackedHaltsCount, setTrackedHaltsCount] = useState<number>(0);

  // All Filings state
  const [filings, setFilings] = useState<Filing[]>([]);
  const [expandedFilingId, setExpandedFilingId] = useState<string | null>(null);
  const [filingsFilters, setFilingsFilters] = useState({
    status: 'all',
    days: '7',
    minKeywords: '0',
    minConfidence: '0',
    ticker: ''
  });

  // All Articles state (intelligence sources)
  const [intelligenceSources, setIntelligenceSources] = useState<any>(null);

  // Fetch watch list from database on mount and when switching to intelligence tab
  useEffect(() => {
    if (activeTab === "intelligence") {
      fetchWatchList();
    }
  }, [activeTab]);

  const fetchWatchList = async () => {
    try {
      const response = await fetch("/api/intelligence/watch-list");
      if (response.ok) {
        const data = await response.json();
        const tickers = new Set<string>(data.watch_list.map((item: any) => item.ticker));
        setWatchListTickers(tickers);
      }
    } catch (error) {
      console.error("Failed to fetch watch list:", error);
    }
  };

  // OPTIMIZATION: Prefetch ALL tab data on mount in parallel - never wait for tab clicks!
  useEffect(() => {
    const prefetchAllTabs = async () => {
      console.log("[PERF] Starting parallel prefetch of ALL tabs");
      const startTime = performance.now();

      // Fire ALL requests simultaneously and cache them
      await Promise.allSettled([
        // EDGAR deals - all filter states
        fetch("/api/edgar/staged-deals?status=pending").then(r => r.json()).then(data => {
          if (Array.isArray(data)) {
            stagingCache.set(CacheKeys.EDGAR_DEALS("pending"), data);
            if (filter === "pending") setDeals(data);
          }
        }).catch(() => {}),
        fetch("/api/edgar/staged-deals?status=approved").then(r => r.json()).then(data => {
          if (Array.isArray(data)) {
            stagingCache.set(CacheKeys.EDGAR_DEALS("approved"), data);
          }
        }).catch(() => {}),
        fetch("/api/edgar/staged-deals?status=rejected").then(r => r.json()).then(data => {
          if (Array.isArray(data)) {
            stagingCache.set(CacheKeys.EDGAR_DEALS("rejected"), data);
          }
        }).catch(() => {}),

        // Intelligence deals - all tier states
        fetch("/api/intelligence/rumored-deals?exclude_watch_list=true").then(r => r.json()).then(data => {
          const dealsArray = Array.isArray(data) ? data : (data.deals || []);
          const normalized = dealsArray.map((d: any) => normalizeDeal(d));
          stagingCache.set(CacheKeys.INTELLIGENCE_DEALS("pending"), normalized);
          if (tierFilter === "pending") setIntelligenceDeals(normalized);
        }).catch(() => {}),
        fetch("/api/intelligence/rumored-deals?watch_list_only=true").then(r => r.json()).then(data => {
          const dealsArray = Array.isArray(data) ? data : (data.deals || []);
          const normalized = dealsArray.map((d: any) => normalizeDeal(d));
          stagingCache.set(CacheKeys.INTELLIGENCE_DEALS("watchlist"), normalized);
        }).catch(() => {}),
        fetch("/api/intelligence/deals?status=rejected").then(r => r.json()).then(data => {
          const dealsArray = Array.isArray(data) ? data : (data.deals || []);
          const normalized = dealsArray.map((d: any) => normalizeDeal(d));
          stagingCache.set(CacheKeys.INTELLIGENCE_DEALS("rejected"), normalized);
        }).catch(() => {}),

        // Halts
        fetch("/api/halts/recent?limit=100").then(r => r.json()).then(data => {
          const halts = data.halts || [];
          stagingCache.set(CacheKeys.HALTS, halts);
          setHalts(halts);
          const tracked = halts.filter((h: any) => h.is_tracked_ticker) || [];
          setTrackedHaltsCount(tracked.length);
        }).catch(() => setHalts([])),

        // Watch list
        fetch("/api/intelligence/watch-list").then(r => r.json()).then(data => {
          const tickers = new Set<string>(data.watch_list.map((item: any) => item.ticker));
          stagingCache.set(CacheKeys.WATCH_LIST, tickers);
          setWatchListTickers(tickers);
        }).catch(() => {}),

        // Monitoring status
        fetchMonitoringStatus()
      ]);

      const endTime = performance.now();
      console.log(`[PERF] Parallel prefetch completed in ${(endTime - startTime).toFixed(0)}ms`);
      console.log(`[CACHE] Prefetched 6+ data sets into cache`);
      setLoading(false);
    };

    prefetchAllTabs();
  }, []);

  // Fetch data when tabs/filters change (but data may already be prefetched!)
  useEffect(() => {
    if (activeTab === "edgar") {
      if (filter === "all_filings") {
        fetchFilings();
      } else {
        // Always fetch when filter changes (including back to pending)
        fetchDeals();
      }
    } else if (activeTab === "intelligence") {
      if (tierFilter === "all_articles") {
        fetchIntelligenceSources();
      } else {
        // Always fetch when filter changes (including back to pending)
        fetchIntelligenceDeals();
      }
    }
  }, [filter, tierFilter, activeTab]);

  // Separate effect for filings filters - only refetch when filters change AND we're on all_filings view
  // Note: ticker is excluded from auto-fetch, only searches on Enter key
  useEffect(() => {
    if (activeTab === "edgar" && filter === "all_filings") {
      fetchFilings();
    }
  }, [filingsFilters.status, filingsFilters.days, filingsFilters.minKeywords, filingsFilters.minConfidence]);

  // Auto-start monitors on page load and refresh status periodically
  useEffect(() => {
    // Auto-start monitors if not running
    const autoStartMonitors = async () => {
      try {
        // Check if EDGAR monitor is running
        const edgarRes = await fetch("/api/edgar/monitoring/status");
        const edgarData = await edgarRes.json();

        if (!edgarData.is_running) {
          console.log("Auto-starting EDGAR monitor...");
          await fetch("/api/edgar/monitoring/start", { method: "POST" });
        }

        // Check if Intelligence monitor is running
        const intelRes = await fetch("/api/intelligence/monitoring/status");
        const intelData = await intelRes.json();

        if (!intelData.is_running) {
          console.log("Auto-starting Intelligence monitor...");
          await fetch("/api/intelligence/monitoring/start", { method: "POST" });
        }
      } catch (error) {
        console.error("Failed to auto-start monitors:", error);
      }
    };

    autoStartMonitors();

    // OPTIMIZATION: Refresh status every 30 seconds (reduced from 10s)
    // Reduces API calls from 360/hour to 120/hour per user
    const statusInterval = setInterval(fetchMonitoringStatus, 30000);

    return () => clearInterval(statusInterval);
  }, []);

  const fetchDeals = async () => {
    const cacheKey = CacheKeys.EDGAR_DEALS(filter);

    // Try to get from cache first
    const cachedData = stagingCache.get<StagedDeal[]>(cacheKey);
    if (cachedData) {
      setDeals(cachedData);
      setLoading(false);
      return;
    }

    setLoading(true);
    const startTime = performance.now();
    try {
      const url = filter === "all"
        ? "/api/edgar/staged-deals"
        : `/api/edgar/staged-deals?status=${filter}`;

      console.log(`[DEBUG] Fetching deals from: ${url}`);
      const fetchStart = performance.now();
      const response = await fetch(url);
      const fetchEnd = performance.now();
      console.log(`[PERF] Fetch took ${(fetchEnd - fetchStart).toFixed(0)}ms`);

      const parseStart = performance.now();
      const data = await response.json();
      const parseEnd = performance.now();
      console.log(`[PERF] JSON parse took ${(parseEnd - parseStart).toFixed(0)}ms`);

      console.log(`[DEBUG] API returned ${Array.isArray(data) ? data.length : 'non-array'} deals`);

      // Ensure data is an array before setting it
      if (Array.isArray(data)) {
        const stateStart = performance.now();
        setDeals(data);
        // Store in cache
        stagingCache.set(cacheKey, data);
        const stateEnd = performance.now();
        console.log(`[PERF] State update took ${(stateEnd - stateStart).toFixed(0)}ms`);
        console.log(`[DEBUG] State updated with ${data.length} deals`);
      } else {
        console.error("API returned non-array data:", data);
        setDeals([]);
      }
    } catch (error) {
      console.error("Failed to fetch deals:", error);
      setDeals([]); // Set empty array on error
    } finally {
      const endTime = performance.now();
      console.log(`[PERF] Total fetchDeals took ${(endTime - startTime).toFixed(0)}ms`);
      setLoading(false);
    }
  };

  const fetchFilings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: filingsFilters.status,
        days: filingsFilters.days,
        minKeywords: filingsFilters.minKeywords,
        minConfidence: filingsFilters.minConfidence
      });

      // Add ticker if provided
      if (filingsFilters.ticker) {
        params.append('ticker', filingsFilters.ticker);
      }

      const response = await fetch(`/api/edgar/filings?${params}`);
      const data = await response.json();
      setFilings(data.filings || []);
    } catch (error) {
      console.error('Failed to fetch filings:', error);
      setFilings([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchIntelligenceSources = async () => {
    setLoading(true);
    try {
      // Fetch recent scanned articles (includes filtered and relevant articles)
      const response = await fetch(`/api/intelligence/articles/recent`);
      const data = await response.json();
      setIntelligenceSources(data);
    } catch (error) {
      console.error('Failed to fetch intelligence sources:', error);
      setIntelligenceSources(null);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to normalize deal data from camelCase to snake_case
  const normalizeDeal = (deal: any): IntelligenceDeal => {
    // If already in snake_case (from /rumored-deals), return as is
    if (deal.deal_id) return deal;

    // Otherwise convert from camelCase (from /deals)
    return {
      deal_id: deal.dealId,
      target_name: deal.targetName,
      target_ticker: deal.targetTicker,
      acquirer_name: deal.acquirerName,
      deal_tier: deal.dealTier,
      deal_status: deal.dealStatus,
      deal_value: deal.dealValue,
      confidence_score: deal.confidenceScore,
      source_count: deal.sourceCount,
      first_detected_at: deal.firstDetectedAt,
      source_published_at: deal.sourcePublishedAt || null,
      edgar_status: deal.edgar_status,
      source_breakdown: deal.source_breakdown
    };
  };

  const fetchIntelligenceDeals = async () => {
    const cacheKey = CacheKeys.INTELLIGENCE_DEALS(tierFilter);

    // Try to get from cache first
    const cachedData = stagingCache.get<IntelligenceDeal[]>(cacheKey);
    if (cachedData) {
      setIntelligenceDeals(cachedData);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Map frontend filters to backend API parameters
      // "pending" = rumored deals with tickers, excluding watch list
      // "watchlist" = deals with tickers that are in the watch list
      // "rejected" = rejected deals
      let url: string;

      if (tierFilter === "pending") {
        // Pending: exclude watch list, only deals with tickers
        url = "/api/intelligence/rumored-deals?exclude_watch_list=true";
      } else if (tierFilter === "watchlist") {
        // Watch list: only deals in the watch list
        url = "/api/intelligence/rumored-deals?watch_list_only=true";
      } else if (tierFilter === "rejected") {
        // Rejected deals
        url = "/api/intelligence/deals?status=rejected";
      } else {
        // Default to pending
        url = "/api/intelligence/rumored-deals?exclude_watch_list=true";
      }

      const response = await fetch(url);
      const data = await response.json();

      // Handle both array responses and object responses with a deals array
      const dealsArray = Array.isArray(data) ? data : (data.deals || []);

      // Normalize all deals to snake_case format
      const normalizedDeals = dealsArray.map(normalizeDeal);

      setIntelligenceDeals(normalizedDeals);
      // Store in cache
      stagingCache.set(cacheKey, normalizedDeals);
    } catch (error) {
      console.error("Failed to fetch intelligence deals:", error);
      setIntelligenceDeals([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const fetchHalts = async () => {
    const cacheKey = CacheKeys.HALTS;

    // Try to get from cache first
    const cachedData = stagingCache.get<any[]>(cacheKey);
    if (cachedData) {
      setHalts(cachedData);
      const tracked = cachedData.filter((h: any) => h.is_tracked_ticker) || [];
      setTrackedHaltsCount(tracked.length);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/halts/recent?limit=100");
      const data = await response.json();

      const halts = data.halts || [];
      setHalts(halts);
      // Store in cache
      stagingCache.set(cacheKey, halts);

      // Count tracked halts (halts for tickers we're monitoring)
      const tracked = halts.filter((h: any) => h.is_tracked_ticker) || [];
      setTrackedHaltsCount(tracked.length);
    } catch (error) {
      console.error("Failed to fetch halts:", error);
      setHalts([]);
      setTrackedHaltsCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectIntelligenceDeal = (dealId: string) => {
    // Show rejection dialog
    setRejectingIntelligenceDealId(dealId);
    setShowIntelligenceRejectDialog(true);
    setIntelligenceRejectionCategory("");
    setIntelligenceRejectionReason("");
  };

  const handleAddToWatchList = async (deal: IntelligenceDeal) => {
    const ticker = deal.target_ticker;
    if (!ticker) {
      alert("Cannot add to watch list: No ticker available");
      return;
    }

    try {
      const response = await fetch("/api/intelligence/watch-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker,
          company_name: deal.target_name,
          notes: `Added from rumored deal (${deal.deal_tier}, confidence: ${(deal.confidence_score * 100).toFixed(0)}%)`
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add to watch list");
      }

      // Invalidate caches and refresh data
      stagingCache.invalidate(CacheKeys.WATCH_LIST);
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("pending"));
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("watchlist"));

      // Refresh all affected data
      await fetchWatchList();
      await fetchIntelligenceDeals(); // Refresh current view

      alert(`Added ${ticker} (${deal.target_name}) to Rumor Watch List`);
    } catch (error) {
      console.error("Error adding to watch list:", error);
      alert(error instanceof Error ? error.message : "Failed to add to watch list");
    }
  };

  const handlePromoteToProduction = (deal: IntelligenceDeal) => {
    // Navigate to the same deal edit page used for EDGAR deals
    // The /api/deals/prepare route will handle intelligence deals via their deal_id
    router.push(`/deals/edit/${deal.deal_id}`);
  };

  const handleStartEditingTicker = (deal: IntelligenceDeal) => {
    setEditingTickerId(deal.deal_id);
    setEditingTickerValue(deal.target_ticker || "");
  };

  const handleSaveTicker = async (dealId: string) => {
    try {
      const response = await fetch(`/api/intelligence/deals/${dealId}/ticker`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: editingTickerValue.trim() || null
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update ticker");
      }

      // Exit edit mode
      setEditingTickerId(null);
      setEditingTickerValue("");

      // Invalidate caches since ticker changed
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("pending"));
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("watchlist"));
      stagingCache.invalidate(CacheKeys.WATCH_LIST);

      // Refresh data
      await fetchIntelligenceDeals();
      await fetchWatchList();
    } catch (error) {
      console.error("Error updating ticker:", error);
      alert(error instanceof Error ? error.message : "Failed to update ticker");
    }
  };

  const handleCancelEditingTicker = () => {
    setEditingTickerId(null);
    setEditingTickerValue("");
  };

  const confirmRejectIntelligenceDeal = async () => {
    if (!rejectingIntelligenceDealId) {
      console.error("No intelligence deal ID to reject");
      return;
    }

    console.log("Rejecting intelligence deal:", rejectingIntelligenceDealId, {
      category: intelligenceRejectionCategory,
      reason: intelligenceRejectionReason
    });

    try {
      const response = await fetch(`/api/intelligence/deals/${rejectingIntelligenceDealId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rejection_category: intelligenceRejectionCategory || null,
          rejection_reason: intelligenceRejectionReason || null,
        }),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Backend error:", errorData);
        throw new Error(errorData.error || "Failed to reject intelligence deal");
      }

      const data = await response.json();
      console.log("Intelligence deal rejected successfully:", data);

      // Close dialog and reset state
      setShowIntelligenceRejectDialog(false);
      setRejectingIntelligenceDealId(null);
      setIntelligenceRejectionCategory("");
      setIntelligenceRejectionReason("");

      // Invalidate all intelligence deal caches since status changed
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("pending"));
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("watchlist"));
      stagingCache.invalidate(CacheKeys.INTELLIGENCE_DEALS("rejected"));

      // Refresh deals list
      await fetchIntelligenceDeals();

      alert(`Deal rejected successfully`);
    } catch (error) {
      console.error("Error rejecting intelligence deal:", error);
      alert(error instanceof Error ? error.message : "Failed to reject deal");
    }
  };

  const handleRejectStagedDeal = async (dealId: string) => {
    // Show rejection dialog instead of immediate confirmation
    setRejectingDealId(dealId);
    setShowRejectDialog(true);
    setRejectionCategory("");
    setRejectionReason("");
  };

  const confirmRejectStagedDeal = async () => {
    if (!rejectingDealId) {
      console.error("No deal ID to reject");
      return;
    }

    console.log("Rejecting deal:", rejectingDealId, {
      category: rejectionCategory,
      reason: rejectionReason
    });

    try {
      const response = await fetch(`/api/edgar/staged-deals/${rejectingDealId}/reject`, {
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
        throw new Error(errorData.error || "Failed to reject staged deal");
      }

      const data = await response.json();
      console.log("Rejection successful:", data);

      // Close dialog and refresh
      setShowRejectDialog(false);
      setRejectingDealId(null);

      // Invalidate all EDGAR deal caches since status changed
      stagingCache.invalidate(CacheKeys.EDGAR_DEALS("pending"));
      stagingCache.invalidate(CacheKeys.EDGAR_DEALS("approved"));
      stagingCache.invalidate(CacheKeys.EDGAR_DEALS("rejected"));

      await fetchDeals();
    } catch (error) {
      console.error("Failed to reject staged deal:", error);
      alert(`Failed to reject staged deal: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const fetchMonitoringStatus = async () => {
    try {
      // Fetch EDGAR status
      const edgarResponse = await fetch("/api/edgar/monitoring/status");
      const edgarData = await edgarResponse.json();
      setEdgarStatus(edgarData);

      // Fetch Intelligence status
      const intelligenceResponse = await fetch("/api/intelligence/monitoring/status");
      const intelligenceData = await intelligenceResponse.json();
      setIntelligenceStatus(intelligenceData);
    } catch (error) {
      console.error("Failed to fetch monitoring status:", error);
    }
  };


  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "Not disclosed";
    return `$${value.toFixed(2)}B`;
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "Unknown";
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

  const handleAddFilingAsManualDeal = async (filing: Filing) => {
    const targetName = prompt(`Enter target company name for ${filing.company_name}:`, filing.company_name);
    if (!targetName) return;

    const targetTicker = prompt('Enter target ticker (optional):', filing.ticker || '');
    const acquirerName = prompt('Enter acquirer name (optional):');
    const acquirerTicker = prompt('Enter acquirer ticker (optional):');

    try {
      const response = await fetch(`/api/edgar/filings/${filing.filing_id}/create-deal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_name: targetName,
          target_ticker: targetTicker || null,
          acquirer_name: acquirerName || null,
          acquirer_ticker: acquirerTicker || null,
          notes: `Manually added from All Filings view. Original confidence: ${filing.confidence_score}`
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Success! Staged deal created and marked as false negative.\n\nDeal ID: ${data.staged_deal_id}`);
        // Switch to pending tab to see the new deal
        setFilter('pending');
      } else {
        const error = await response.json();
        alert(`Error: ${error.detail || 'Failed to create deal'}`);
      }
    } catch (error) {
      console.error('Error creating deal from filing:', error);
      alert('Failed to create staged deal. Check console for details.');
    }
  };

  // M&A keywords that trigger detection (matches backend detector.py)
  const MA_KEYWORDS = [
    "merger", "acquisition", "acquire", "acquirer", "takeover", "buyout",
    "tender offer", "going private", "transaction", "combination",
    "merger agreement", "definitive agreement", "letter of intent",
    "purchase agreement", "stock purchase", "asset purchase",
    "cash and stock", "all cash", "all stock", "exchange ratio",
    "premium", "consideration", "per share",
    "closing", "regulatory approval", "shareholder approval",
    "antitrust", "HSR", "termination fee", "break-up fee",
    "commencement", "tender", "offer to purchase", "proration",
    "spin-off", "split-off", "divestiture", "separation"
  ];

  const highlightKeywords = (text: string) => {
    if (!text) return null;

    // Create a regex pattern that matches any of the M&A keywords (case-insensitive)
    const pattern = new RegExp(`(${MA_KEYWORDS.join('|')})`, 'gi');

    // Split text by keywords and wrap matches in span with highlighting
    const parts = text.split(pattern);

    return (
      <span>
        {parts.map((part, index) => {
          // Check if this part is a keyword (case-insensitive)
          const isKeyword = MA_KEYWORDS.some(
            keyword => keyword.toLowerCase() === part.toLowerCase()
          );

          return isKeyword ? (
            <span key={index} className="bg-yellow-200 font-semibold px-1 rounded">
              {part}
            </span>
          ) : (
            <span key={index}>{part}</span>
          );
        })}
      </span>
    );
  };

  const getConfidenceBadge = (score: number | null) => {
    if (score === null) return <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-700">N/A</span>;

    if (score >= 0.90) {
      return <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-800 font-semibold">{score.toFixed(2)}</span>;
    } else if (score >= 0.75) {
      return <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-800 font-semibold">{score.toFixed(2)}</span>;
    } else if (score >= 0.60) {
      return <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">{score.toFixed(2)}</span>;
    } else {
      return <span className="px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-800">{score.toFixed(2)}</span>;
    }
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

          {/* Monitoring Status Bar - Compact read-only status */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-sm border border-blue-100 p-3 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {/* EDGAR Monitor Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${edgarStatus?.is_running ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                  <span className="text-xs font-medium text-gray-700">EDGAR Monitor</span>
                  {edgarStatus?.is_running && (
                    <span className="text-xs text-gray-500">• polling every 60s</span>
                  )}
                </div>

                {/* Intelligence Monitor Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${intelligenceStatus?.is_running ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                  <span className="text-xs font-medium text-gray-700">Intelligence Monitor</span>
                  {intelligenceStatus?.is_running && intelligenceStatus.monitors_count && (
                    <span className="text-xs text-gray-500">• {intelligenceStatus.monitors_count} sources</span>
                  )}
                </div>

                {/* Halt Monitor Status */}
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium text-gray-700">Halt Monitor</span>
                  <span className="text-xs text-gray-500">• polling every 10s</span>
                </div>
              </div>

              {/* Auto-refresh indicator */}
              <div className="text-xs text-gray-400">
                Auto-refreshing...
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
              <button
                onClick={() => setActiveTab("halts")}
                className={`px-6 py-3 font-medium relative ${
                  activeTab === "halts"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Halt Monitor
                {trackedHaltsCount > 0 && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 animate-pulse">
                    {trackedHaltsCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        {activeTab !== "halts" && (
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                {activeTab === "edgar" ? (
                  <>
                    {[
                      { key: "pending", label: "Pending" },
                      { key: "approved", label: "Approved" },
                      { key: "rejected", label: "Rejected" },
                      { key: "all_filings", label: "All Filings" }
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setFilter(f.key as any)}
                        className={`px-4 py-2 rounded-lg font-medium ${
                          filter === f.key
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </>
                ) : activeTab === "intelligence" ? (
                  <>
                    {[
                      { key: "pending", label: "Pending", title: "Rumored deals awaiting approval or rejection" },
                      { key: "watchlist", label: "Rumor Watch List", title: "Tickers added to rumor watch list for monitoring" },
                      { key: "rejected", label: "Rejected", title: "Rejected deals (will not reappear in rumor queue)" },
                      { key: "all_articles", label: "Recent Articles", title: "All articles scanned by monitors (shows which passed M&A filter)" }
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setTierFilter(f.key as any)}
                        className={`px-4 py-2 rounded-lg font-medium ${
                          tierFilter === f.key
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                        title={f.title}
                      >
                        {f.label}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
              {activeTab === "intelligence" && (
                <div className="text-xs text-gray-500 flex items-start gap-2">
                  <svg className="w-4 h-4 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    <strong>Pending:</strong> Rumored deals awaiting approval or rejection •
                    <strong className="ml-1">Rumor Watch List:</strong> Tickers being monitored •
                    <strong className="ml-1">Rejected:</strong> Dismissed deals
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="bg-white rounded-lg shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : activeTab === "edgar" ? (
            filter === "all_filings" ? (
              // All Filings Table
              <div className="overflow-x-auto">
                {/* Filters - always show even when no results */}
                <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <label className="text-gray-600 font-medium">Ticker:</label>
                        <input
                          type="text"
                          placeholder="Press Enter..."
                          value={filingsFilters.ticker}
                          onChange={(e) => setFilingsFilters({ ...filingsFilters, ticker: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              fetchFilings();
                            }
                          }}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-28"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-gray-600 font-medium">Status:</label>
                        <select
                          value={filingsFilters.status}
                          onChange={(e) => setFilingsFilters({ ...filingsFilters, status: e.target.value })}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs"
                        >
                          <option value="all">All</option>
                          <option value="relevant">Relevant</option>
                          <option value="not_relevant">Not Relevant</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-gray-600 font-medium">Period:</label>
                        <select
                          value={filingsFilters.days}
                          onChange={(e) => setFilingsFilters({ ...filingsFilters, days: e.target.value })}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs"
                        >
                          <option value="1">24h</option>
                          <option value="3">3d</option>
                          <option value="7">7d</option>
                          <option value="30">30d</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-gray-600 font-medium">Min KW:</label>
                        <input
                          type="number"
                          min="0"
                          value={filingsFilters.minKeywords}
                          onChange={(e) => setFilingsFilters({ ...filingsFilters, minKeywords: e.target.value })}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-12"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-gray-600 font-medium">Min Conf:</label>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={filingsFilters.minConfidence}
                          onChange={(e) => setFilingsFilters({ ...filingsFilters, minConfidence: e.target.value })}
                          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-12"
                        />
                      </div>
                      <div className="ml-auto flex items-center gap-3 text-xs">
                        <span className="text-gray-600">Total: <span className="font-semibold text-gray-900">{filings.length}</span></span>
                        <span className="text-gray-600">Relevant: <span className="font-semibold text-green-600">{filings.filter(f => f.is_ma_relevant).length}</span></span>
                        <span className="text-gray-600">Avg: <span className="font-semibold text-blue-600">
                          {filings.length > 0
                            ? (filings.reduce((sum, f) => sum + (f.confidence_score || 0), 0) / filings.length).toFixed(2)
                            : '0.00'}
                        </span></span>
                      </div>
                    </div>
                  </div>

                {/* Table */}
                {filings.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">No filings found</div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Company
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Filing
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Date
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Keywords
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Confidence
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filings.map((filing) => (
                        <React.Fragment key={filing.filing_id}>
                          <tr
                            className={filing.is_ma_relevant ? 'bg-green-50' : ''}
                          >
                            <td className="px-2 py-2 whitespace-nowrap">
                              <div className="text-xs font-medium text-gray-900">{filing.company_name}</div>
                              <div className="text-xs text-gray-500">{filing.ticker || 'N/A'}</div>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <a
                                href={filing.filing_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-0.5 inline-flex text-xs font-semibold rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer"
                              >
                                {filing.filing_type}
                              </a>
                            </td>
                            <td className="px-2 py-2 text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-gray-700 font-medium whitespace-nowrap">{formatDate(filing.filing_date)}</span>
                                <span className="text-gray-500 whitespace-nowrap">Det: {filing.processed_at ? formatDate(filing.processed_at) : 'N/A'}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <span className="px-2 py-0.5 inline-flex text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">
                                {filing.keyword_count}
                              </span>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {getConfidenceBadge(filing.confidence_score)}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {filing.reasoning && (
                                  <>
                                    <button
                                      onClick={() => setExpandedFilingId(expandedFilingId === filing.filing_id ? null : filing.filing_id)}
                                      className="text-purple-600 hover:text-purple-800"
                                      title="View reasoning"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                    </button>
                                    <span className="text-gray-300">|</span>
                                  </>
                                )}
                                <button
                                  onClick={() => handleAddFilingAsManualDeal(filing)}
                                  className="text-green-600 hover:text-green-800 font-medium flex items-center gap-0.5 text-xs"
                                  title="Add as staged deal (marks as false negative)"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expandedFilingId === filing.filing_id && filing.reasoning && (
                            <tr className="bg-purple-50">
                              <td colSpan={6} className="px-3 py-2">
                                <div className="text-xs">
                                  <div className="font-semibold text-purple-900 mb-1.5 flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Detector Reasoning:
                                  </div>
                                  <div className="text-gray-700 bg-white p-2 rounded border border-purple-200 leading-relaxed text-xs">
                                    {filing.reasoning}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : deals.length === 0 ? (
            // EDGAR Deals Table (
              <div className="p-8 text-center">
                <p className="text-gray-500 mb-2">No {filter} deals found</p>
                {filter === "pending" && !edgarStatus?.is_running && (
                  <p className="text-sm text-gray-400">
                    Start monitoring to detect new M&A deals from EDGAR
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full table-fixed">
                  <colgroup>
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "18%" }} />
                  </colgroup>
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Target
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Acquirer
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Value
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Filing
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Conf.
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Dates
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {deals.map((deal, index) => (
                      <React.Fragment key={deal.id}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-2 py-2">
                            <div className="truncate">
                              <div className="text-xs font-medium text-gray-900 truncate" title={deal.targetName}>
                                {deal.targetName}
                              </div>
                              {deal.targetTicker && (
                                <div className="text-xs text-gray-500">{deal.targetTicker}</div>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-900 truncate" title={deal.acquirerName || ""}>
                            {deal.acquirerName || "—"}
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-900 whitespace-nowrap">
                            {formatCurrency(deal.dealValue)}
                          </td>
                          <td className="px-2 py-2">
                            <a
                              href={deal.filingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {deal.filingType}
                            </a>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
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
                          <td className="px-2 py-2 text-xs text-gray-500">
                            <div className="flex flex-col space-y-0.5">
                              <span className="text-gray-700 font-medium whitespace-nowrap">{formatDate(deal.filingDate)}</span>
                              <span className="text-gray-500 whitespace-nowrap">Det: {formatDate(deal.detectedAt)}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
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
                          <td className="px-2 py-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              {deal.matchedTextExcerpt && (
                                <>
                                  <button
                                    onClick={() => setExpandedDealId(expandedDealId === deal.id ? null : deal.id)}
                                    className="text-purple-600 hover:text-purple-800 font-medium"
                                    title="View detection context"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </button>
                                  <span className="text-gray-300">|</span>
                                </>
                              )}
                              <Link
                                href={`/staging/${deal.id}`}
                                className="text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Review
                              </Link>
                              <span className="text-gray-300">|</span>
                              {filter !== "rejected" && (
                                <>
                                  <button
                                    onClick={() => handleRejectStagedDeal(deal.id)}
                                    className="text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Reject
                                  </button>
                                  <span className="text-gray-300">|</span>
                                </>
                              )}
                              <button
                                onClick={() => router.push(`/deals/edit/${deal.id}`)}
                                className="text-green-600 hover:text-green-800 font-medium flex items-center gap-0.5"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedDealId === deal.id && deal.matchedTextExcerpt && (
                          <tr className="bg-purple-50">
                            <td colSpan={8} className="px-4 py-3">
                              <div className="text-xs">
                                <div className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  Detection Context (from SEC filing):
                                </div>
                                <div className="text-gray-700 bg-white p-3 rounded border border-purple-200 leading-relaxed">
                                  {highlightKeywords(deal.matchedTextExcerpt)}
                                </div>
                                <div className="mt-2 text-purple-600 italic">
                                  💡 Highlighted keywords triggered M&A detection
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : activeTab === "intelligence" && tierFilter === "all_articles" ? (
            // Recent Articles View - Shows ALL scanned articles (both filtered and M&A-relevant)
            !intelligenceSources ? (
              <div className="p-8 text-center text-gray-500">Loading recent articles...</div>
            ) : intelligenceSources.status === "not_running" ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 mb-2">Intelligence monitoring is not running</p>
                <p className="text-sm text-gray-400">
                  Start intelligence monitoring to scan articles from news sources
                </p>
              </div>
            ) : !intelligenceSources.monitors || intelligenceSources.monitors.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 mb-2">No monitors have scanned articles yet</p>
                <p className="text-sm text-gray-400">
                  Wait for the monitoring cycle to complete
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                {intelligenceSources.monitors.map((monitor: any, index: number) => (
                  <div key={`${monitor.source_name}-${index}`} className="mb-6 last:mb-0">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">{formatSourceName(monitor.source_name)}</h3>
                      <div className="flex items-center gap-4 text-xs text-gray-600">
                        <span>Total Scanned: <strong>{monitor.total_scanned || 0}</strong></span>
                        <span className="text-green-600">M&A Relevant: <strong>{monitor.ma_relevant_count || 0}</strong></span>
                        <span className="text-red-600">Filtered Out: <strong>{(monitor.total_scanned || 0) - (monitor.ma_relevant_count || 0)}</strong></span>
                        {monitor.last_scan_time && (
                          <span>Last Scan: <strong>{formatDateTime(monitor.last_scan_time)}</strong></span>
                        )}
                      </div>
                    </div>
                    {monitor.articles && monitor.articles.length > 0 ? (
                      <table className="w-full">
                        <thead className="bg-gray-100 border-b border-gray-200">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-1/2">Headline</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Filter Status</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acquirer</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Scanned At</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {monitor.articles.map((article: any, idx: number) => (
                            <tr
                              key={`${monitor.source_name}-${idx}`}
                              className={`hover:bg-gray-50 ${article.is_ma_relevant ? 'bg-green-50' : 'bg-red-50'}`}
                            >
                              <td className="px-3 py-3">
                                <div className="text-sm">
                                  {article.url && article.url !== 'N/A' ? (
                                    <a
                                      href={article.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                    >
                                      {article.title || 'No headline'}
                                    </a>
                                  ) : (
                                    <span className="text-gray-900 font-medium">{article.title || 'No headline'}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {article.is_ma_relevant ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    ✓ M&A Relevant
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                    ✗ Filtered Out
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-600">
                                {article.target_name || '-'}
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-600">
                                {article.acquirer_name || '-'}
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-600">
                                {article.scanned_at ? formatDateTime(article.scanned_at) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-4 text-center text-sm text-gray-500">
                        No articles scanned yet
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : activeTab === "intelligence" ? (
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Target
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Acquirer
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Value
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Tier
                      </th>
                      {tierFilter === "pending" && (
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          EDGAR
                        </th>
                      )}
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Sources
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Conf.
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
                    {intelligenceDeals.map((deal) => (
                      <tr key={deal.deal_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {deal.target_name}
                            </div>
                            {editingTickerId === deal.deal_id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="text"
                                  value={editingTickerValue}
                                  onChange={(e) => setEditingTickerValue(e.target.value.toUpperCase())}
                                  placeholder="TICKER"
                                  className="text-xs px-2 py-1 border border-blue-300 rounded w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveTicker(deal.deal_id);
                                    if (e.key === 'Escape') handleCancelEditingTicker();
                                  }}
                                />
                                <button
                                  onClick={() => handleSaveTicker(deal.deal_id)}
                                  className="text-green-600 hover:text-green-800"
                                  title="Save"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                                <button
                                  onClick={handleCancelEditingTicker}
                                  className="text-red-600 hover:text-red-800"
                                  title="Cancel"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 mt-1">
                                {deal.target_ticker ? (
                                  <div className="text-xs text-gray-500">{deal.target_ticker}</div>
                                ) : (
                                  <div className="text-xs text-gray-400 italic">No ticker</div>
                                )}
                                <button
                                  onClick={() => handleStartEditingTicker(deal)}
                                  className="text-blue-600 hover:text-blue-800"
                                  title="Edit ticker"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                          {deal.acquirer_name || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(deal.deal_value)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${getTierBadge(deal.deal_tier)}`}
                          >
                            {deal.deal_tier}
                          </span>
                        </td>
                        {tierFilter === "pending" && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {deal.edgar_status?.has_edgar_filing ? (
                              <div className="flex items-center gap-1 text-green-600">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="text-xs font-medium">{deal.edgar_status.edgar_filing_count}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-amber-600">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <span className="text-xs font-medium">None</span>
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-sm font-medium text-blue-600">
                            {deal.source_breakdown ? (
                              <span className="text-xs text-gray-600">
                                {deal.source_breakdown.edgar}E / {deal.source_breakdown.non_edgar}O
                              </span>
                            ) : (
                              deal.source_count
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`text-sm font-medium ${
                              deal.confidence_score >= 0.7
                                ? "text-green-600"
                                : deal.confidence_score >= 0.5
                                ? "text-yellow-600"
                                : "text-red-600"
                            }`}
                          >
                            {(deal.confidence_score * 100).toFixed(0)}%
                          </span>
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
                        <td className="px-3 py-2 whitespace-nowrap text-sm">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => router.push(`/intelligence/deals/${deal.deal_id}`)}
                              className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                            >
                              View
                            </button>
                            {tierFilter !== "rejected" && (
                              <>
                                <span className="text-gray-300">|</span>
                                <button
                                  onClick={() => handleRejectIntelligenceDeal(deal.deal_id)}
                                  className="text-red-600 hover:text-red-800 font-medium text-xs"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {tierFilter === "pending" && (
                              <>
                                <span className="text-gray-300">|</span>
                                <button
                                  onClick={() => handleAddToWatchList(deal)}
                                  className="text-green-600 hover:text-green-800 font-medium flex items-center gap-1 text-xs"
                                  title="Add to Rumor Watch List"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Watch
                                </button>
                              </>
                            )}
                            {tierFilter === "watchlist" && (
                              <>
                                <span className="text-gray-300">|</span>
                                <button
                                  onClick={() => handlePromoteToProduction(deal)}
                                  className="text-green-600 hover:text-green-800 font-medium text-xs flex items-center gap-1"
                                  title="Promote to Production/Active Tier"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add to Production
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Rejection Reason Dialog */}
      {showRejectDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Reject Deal - Add Reason (Optional)
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Help improve detection accuracy by providing a rejection reason. This will be used to train the filter.
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
                <option value="not_ma">Not an M&A Deal</option>
                <option value="previously_announced">Previously Announced (Historical Filing)</option>
                <option value="wrong_company">Wrong Company Ticker</option>
                <option value="regulatory_only">Regulatory Filing Only</option>
                <option value="incomplete">Incomplete Information</option>
                <option value="private_company">Private Company (Non-Tradeable)</option>
                <option value="target_not_tradeable">Target Not Tradeable</option>
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
                placeholder="e.g., 'This is just a quarterly earnings report, not a merger announcement'"
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
                onClick={confirmRejectStagedDeal}
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

      {/* Halt Monitor Table */}
      {activeTab === "halts" && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ticker
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Exchange
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Halt Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      Loading halts...
                    </td>
                  </tr>
                ) : halts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      No trading halts detected
                    </td>
                  </tr>
                ) : (
                  halts.map((halt: any) => (
                    <tr
                      key={`${halt.ticker}-${halt.halt_time}`}
                      className={halt.is_tracked_ticker ? "bg-yellow-50" : ""}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className={`text-sm font-medium ${halt.is_tracked_ticker ? "text-red-600 font-bold" : "text-gray-900"}`}>
                            {halt.ticker}
                          </span>
                          {halt.is_tracked_ticker && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              Tracked
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {halt.company_name || "-"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{halt.exchange}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {new Date(halt.halt_time).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full w-fit ${
                          halt.halt_code === "T1" || halt.halt_code === "M1"
                            ? "bg-red-100 text-red-800"
                            : halt.halt_code === "T2" || halt.halt_code === "M2"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                        }`}>
                          {halt.halt_code === "T1" ? "News Pending" :
                           halt.halt_code === "T2" ? "News Dissemination" :
                           halt.halt_code === "M1" ? "M&A News Pending" :
                           halt.halt_code === "M2" ? "M&A News Dissemination" :
                           halt.halt_code === "LUDP" ? "Volatility Trading Pause" :
                           halt.halt_code === "LUDS" ? "Straddle Condition" :
                           halt.halt_code}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {halt.resumption_time ? (
                          <span className="text-sm text-green-600">Resumed</span>
                        ) : (
                          <span className="text-sm text-red-600">Halted</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Intelligence Rejection Dialog */}
      {showIntelligenceRejectDialog && (
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
                value={intelligenceRejectionCategory}
                onChange={(e) => setIntelligenceRejectionCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a category...</option>
                <option value="not_rumor">Not an M&A Rumor</option>
                <option value="insufficient_evidence">Insufficient Evidence</option>
                <option value="already_in_edgar">Already in EDGAR (Filed Deal)</option>
                <option value="wrong_company">Wrong Company Ticker</option>
                <option value="social_media_noise">Social Media Noise</option>
                <option value="target_not_tradeable">Target Not Tradeable</option>
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
                value={intelligenceRejectionReason}
                onChange={(e) => setIntelligenceRejectionReason(e.target.value)}
                placeholder="e.g., 'This is just speculation on Twitter, no credible sources'"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowIntelligenceRejectDialog(false);
                  setRejectingIntelligenceDealId(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmRejectIntelligenceDeal}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Reject Deal
              </button>
            </div>

            {intelligenceRejectionCategory === "" && intelligenceRejectionReason === "" && (
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
