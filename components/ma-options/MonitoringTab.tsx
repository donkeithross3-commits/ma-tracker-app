"use client";

import { useEffect, useState } from "react";
import type { WatchedSpreadDTO, SpreadUpdateFailure } from "@/types/ma-options";
import WatchedSpreadsTable from "./WatchedSpreadsTable";
import DealFilter from "./DealFilter";

type SpreadFilter = "all" | "mine";

export default function MonitoringTab() {
  const [spreads, setSpreads] = useState<WatchedSpreadDTO[]>([]);
  const [filteredSpreads, setFilteredSpreads] = useState<WatchedSpreadDTO[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [spreadFilter, setSpreadFilter] = useState<SpreadFilter>("all");
  const [loading, setLoading] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingSpreads, setRefreshingSpreads] = useState<Set<string>>(new Set());
  const [refreshStatus, setRefreshStatus] = useState<string>("");
  // Track failures by spreadId for per-row indicators
  const [failedSpreads, setFailedSpreads] = useState<Map<string, SpreadUpdateFailure>>(new Map());

  useEffect(() => {
    loadSpreads();

    // Set up auto-refresh every 30 seconds
    const interval = setInterval(() => {
      refreshPrices();
    }, 30000);
    setRefreshInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadFilter]);

  useEffect(() => {
    // Filter spreads when selection changes
    if (selectedDealId) {
      setFilteredSpreads(spreads.filter((s) => s.dealId === selectedDealId));
    } else {
      setFilteredSpreads(spreads);
    }
  }, [selectedDealId, spreads]);

  const loadSpreads = async () => {
    setLoading(true);
    try {
      const url = spreadFilter === "mine" 
        ? "/api/ma-options/watched-spreads?filter=mine"
        : "/api/ma-options/watched-spreads";
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        // Filter to only show active spreads
        const activeSpreads = (data.spreads || []).filter(
          (spread: WatchedSpreadDTO) => spread.status === "active"
        );
        setSpreads(activeSpreads);
      }
    } catch (error) {
      console.error("Error loading spreads:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshPrices = async () => {
    if (spreads.length === 0) return;
    
    // Prevent overlapping refreshes
    if (isRefreshing) {
      console.warn("Refresh already in progress - ignoring duplicate request");
      return;
    }

    setIsRefreshing(true);
    setRefreshStatus("Spawning price agents...");
    
    try {
      const spreadIds = spreads.map((s) => s.id);
      const uniqueTickers = [...new Set(spreads.map(s => s.dealTicker))];
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e2c4934-9031-43dd-950a-350ecf67fcc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonitoringTab.tsx:71',message:'REFRESH: Request sent',data:{spreadCount:spreads.length,spreadIds:spreadIds,tickers:uniqueTickers},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'UI_UPDATE'})}).catch(()=>{});
      // #endregion
      
      // Update status after 2 seconds
      const statusTimer1 = setTimeout(() => {
        setRefreshStatus(`Fetching ${uniqueTickers.length} tickers from IB TWS...`);
      }, 2000);
      
      // Update status after 30 seconds
      const statusTimer2 = setTimeout(() => {
        setRefreshStatus("Processing option chains...");
      }, 30000);
      
      const response = await fetch("/api/ma-options/update-spread-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadIds }),
      });
      
      clearTimeout(statusTimer1);
      clearTimeout(statusTimer2);

      if (response.ok) {
        const data = await response.json();
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e2c4934-9031-43dd-950a-350ecf67fcc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonitoringTab.tsx:100',message:'REFRESH: Response received',data:{updatesCount:data.updates?.length||0,updates:data.updates,metadata:data.metadata},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'UI_UPDATE'})}).catch(()=>{});
        // #endregion
        
        // Update spreads with new prices
        setSpreads((prevSpreads) =>
          prevSpreads.map((spread) => {
            const update = data.updates.find((u: any) => u.spreadId === spread.id);
            if (update) {
              const pnlDollar = update.currentPremium - spread.entryPremium;
              const pnlPercent = (pnlDollar / spread.entryPremium) * 100;
              
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/1e2c4934-9031-43dd-950a-350ecf67fcc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonitoringTab.tsx:112',message:'REFRESH: Updating spread in state',data:{spreadId:spread.id,ticker:spread.dealTicker,oldPremium:spread.currentPremium,newPremium:update.currentPremium,oldLastUpdated:spread.lastUpdated,newLastUpdated:update.lastUpdated},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'UI_UPDATE'})}).catch(()=>{});
              // #endregion
              
              return {
                ...spread,
                currentPremium: update.currentPremium,
                lastUpdated: update.lastUpdated,
                pnlDollar,
                pnlPercent,
              };
            }
            return spread;
          })
        );
        
        // Track failures for per-row indicators
        const failures = data.failures as SpreadUpdateFailure[] || [];
        if (failures.length > 0) {
          const failureMap = new Map<string, SpreadUpdateFailure>();
          for (const f of failures) {
            failureMap.set(f.spreadId, f);
          }
          setFailedSpreads(failureMap);
        } else {
          // Clear failures on successful full refresh
          setFailedSpreads(new Map());
        }
        
        // Show success/partial success message
        const meta = data.metadata;
        if (meta) {
          if (failures.length > 0) {
            // Show which tickers failed
            const failedTickers = [...new Set(failures.map(f => f.ticker))].join(", ");
            setRefreshStatus(`⚠ Updated ${meta.updatedSpreads}/${meta.totalSpreads} spreads (${failedTickers}: unavailable)`);
          } else {
            setRefreshStatus(`✓ Updated ${meta.updatedSpreads}/${meta.totalSpreads} spreads in ${meta.durationSeconds}s`);
          }
        } else {
          setRefreshStatus(`✓ Updated ${data.updates.length} spreads`);
        }
        
        // Keep status visible longer if there were failures
        setTimeout(() => setRefreshStatus(""), failures.length > 0 ? 8000 : 3000);
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e2c4934-9031-43dd-950a-350ecf67fcc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MonitoringTab.tsx:140',message:'REFRESH: State update complete',data:{spreadsUpdated:data.updates?.length||0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'UI_UPDATE'})}).catch(()=>{});
        // #endregion
      } else {
        setRefreshStatus("❌ Refresh failed");
        setTimeout(() => setRefreshStatus(""), 3000);
      }
    } catch (error) {
      setRefreshStatus("❌ Network error");
      setTimeout(() => setRefreshStatus(""), 3000);
      console.error("Error refreshing prices:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshSingleSpread = async (spreadId: string) => {
    // Prevent if already refreshing this spread
    if (refreshingSpreads.has(spreadId)) return;
    
    console.log("[SINGLE REFRESH] Starting refresh for spreadId:", spreadId);
    setRefreshingSpreads(prev => new Set(prev).add(spreadId));
    
    try {
      const response = await fetch("/api/ma-options/update-spread-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadIds: [spreadId] }),
      });
      
      console.log("[SINGLE REFRESH] Response status:", response.status, response.ok);
      
      if (response.ok) {
        const data = await response.json();
        console.log("[SINGLE REFRESH] Response data:", data);
        
        // Check for failures
        const failures = data.failures as SpreadUpdateFailure[] || [];
        if (failures.length > 0) {
          // Add failure to tracking map
          setFailedSpreads(prev => {
            const newMap = new Map(prev);
            for (const f of failures) {
              newMap.set(f.spreadId, f);
            }
            return newMap;
          });
        } else {
          // Clear this spread from failures if it succeeded
          setFailedSpreads(prev => {
            const newMap = new Map(prev);
            newMap.delete(spreadId);
            return newMap;
          });
        }
        
        // Update the single spread with new prices
        setSpreads((prevSpreads) =>
          prevSpreads.map((spread) => {
            const update = data.updates?.find((u: any) => u.spreadId === spread.id);
            console.log("[SINGLE REFRESH] Checking spread:", spread.id, "found update:", update);
            if (update) {
              const pnlDollar = update.currentPremium - spread.entryPremium;
              const pnlPercent = (pnlDollar / spread.entryPremium) * 100;
              console.log("[SINGLE REFRESH] Updating spread with new premium:", update.currentPremium);
              return {
                ...spread,
                currentPremium: update.currentPremium,
                lastUpdated: update.lastUpdated,
                pnlDollar,
                pnlPercent,
              };
            }
            return spread;
          })
        );
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("[SINGLE REFRESH] Error response:", errorData);
      }
    } catch (error) {
      console.error("[SINGLE REFRESH] Error:", error);
    } finally {
      setRefreshingSpreads(prev => {
        const newSet = new Set(prev);
        newSet.delete(spreadId);
        return newSet;
      });
    }
  };

  const handleDeactivate = async (spreadId: string) => {
    try {
      console.log("Deactivating spread:", spreadId);
      const response = await fetch(
        `/api/ma-options/watched-spreads/${spreadId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "inactive" }),
        }
      );

      console.log("Deactivate response:", response.status, response.ok);

      if (response.ok) {
        alert("Spread deactivated successfully!");
        loadSpreads();
      } else {
        const errorData = await response.json();
        console.error("Deactivate error:", errorData);
        alert(`Failed to deactivate: ${errorData.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error deactivating spread:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Failed to deactivate spread"}`);
    }
  };

  // Get unique deals for filter
  const deals = Array.from(
    new Set(spreads.map((s) => JSON.stringify({ id: s.dealId, ticker: s.dealTicker, name: s.dealTargetName })))
  ).map((s) => JSON.parse(s));

  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex items-center gap-4 flex-wrap">
        <DealFilter
          deals={deals}
          selectedDealId={selectedDealId}
          onSelectDeal={setSelectedDealId}
        />
        
        {/* Spread ownership filter */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Show:</span>
          <button
            onClick={() => setSpreadFilter("all")}
            className={`px-2 py-1 rounded ${
              spreadFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            All Spreads
          </button>
          <button
            onClick={() => setSpreadFilter("mine")}
            className={`px-2 py-1 rounded ${
              spreadFilter === "mine"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            My Spreads
          </button>
        </div>
      </div>

      {/* Spreads Table */}
      {loading ? (
        <div className="text-gray-400 text-center py-4">Loading...</div>
      ) : (
        <WatchedSpreadsTable
          spreads={filteredSpreads}
          onDeactivate={handleDeactivate}
          onRefresh={refreshPrices}
          onRefreshSingle={refreshSingleSpread}
          isRefreshing={isRefreshing}
          refreshingSpreads={refreshingSpreads}
          refreshStatus={refreshStatus}
          failedSpreads={failedSpreads}
        />
      )}
    </div>
  );
}

