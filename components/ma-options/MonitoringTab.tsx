"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, Star, Folder, Trash2 } from "lucide-react";
import type { WatchedSpreadDTO, SpreadUpdateFailure } from "@/types/ma-options";
import WatchedSpreadsTable from "./WatchedSpreadsTable";
import DealFilter from "./DealFilter";

interface UserList {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
}

// Filter can be "all", "mine", or a list ID
type SpreadFilter = "all" | "mine" | string;

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
  
  // User lists state
  const [userLists, setUserLists] = useState<UserList[]>([]);
  const [listSpreadIds, setListSpreadIds] = useState<Set<string>>(new Set());
  const [showListDropdown, setShowListDropdown] = useState(false);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Load user lists on mount
  useEffect(() => {
    loadUserLists();
  }, []);

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
    let filtered = spreads;
    
    // Apply list filter (for custom lists, filter by spreadIds in that list)
    if (spreadFilter !== "all" && spreadFilter !== "mine" && listSpreadIds.size > 0) {
      filtered = filtered.filter((s) => listSpreadIds.has(s.id));
    }
    
    // Apply deal filter
    if (selectedDealId) {
      filtered = filtered.filter((s) => s.dealId === selectedDealId);
    }
    
    setFilteredSpreads(filtered);
  }, [selectedDealId, spreads, spreadFilter, listSpreadIds]);

  const loadUserLists = async () => {
    try {
      const response = await fetch("/api/user/deal-lists");
      if (response.ok) {
        const data = await response.json();
        setUserLists(data.lists || []);
      }
    } catch (error) {
      console.error("Error loading user lists:", error);
    }
  };

  const loadListSpreads = async (listId: string) => {
    try {
      const response = await fetch(`/api/user/deal-lists/${listId}`);
      if (response.ok) {
        const data = await response.json();
        const spreadIds = new Set<string>((data.items || []).map((item: { spreadId: string }) => item.spreadId));
        setListSpreadIds(spreadIds);
      }
    } catch (error) {
      console.error("Error loading list spreads:", error);
      setListSpreadIds(new Set());
    }
  };

  const loadSpreads = async () => {
    setLoading(true);
    try {
      // For custom lists, we still load all spreads but filter client-side
      // For "mine", use the server filter
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
      
      // If a custom list is selected, load its spread IDs
      if (spreadFilter !== "all" && spreadFilter !== "mine") {
        await loadListSpreads(spreadFilter);
      } else {
        setListSpreadIds(new Set());
      }
    } catch (error) {
      console.error("Error loading spreads:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    try {
      const response = await fetch("/api/user/deal-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setUserLists((prev) => [...prev, data.list]);
        setNewListName("");
        setIsCreatingList(false);
        // Switch to the new list
        setSpreadFilter(data.list.id);
      }
    } catch (error) {
      console.error("Error creating list:", error);
    }
  };

  const handleDeleteList = async (listId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this list?")) return;
    try {
      const response = await fetch(`/api/user/deal-lists/${listId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setUserLists((prev) => prev.filter((l) => l.id !== listId));
        if (spreadFilter === listId) {
          setSpreadFilter("all");
        }
      }
    } catch (error) {
      console.error("Error deleting list:", error);
    }
  };

  const getFilterLabel = () => {
    if (spreadFilter === "all") return "All Spreads";
    if (spreadFilter === "mine") return "My Spreads";
    const list = userLists.find((l) => l.id === spreadFilter);
    return list?.name || "Select...";
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
        
        {/* Spread list filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowListDropdown(!showListDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 text-gray-100 rounded hover:bg-gray-600 border border-gray-600"
          >
            {spreadFilter !== "all" && spreadFilter !== "mine" && (
              <Folder className="h-3.5 w-3.5 text-gray-400" />
            )}
            {getFilterLabel()}
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>
          
          {showListDropdown && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50">
              {/* Built-in filters */}
              <div className="p-1 border-b border-gray-700">
                <button
                  onClick={() => { setSpreadFilter("all"); setShowListDropdown(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded ${
                    spreadFilter === "all" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  All Spreads
                </button>
                <button
                  onClick={() => { setSpreadFilter("mine"); setShowListDropdown(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded ${
                    spreadFilter === "mine" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  My Spreads
                </button>
              </div>
              
              {/* User lists */}
              {userLists.length > 0 && (
                <div className="p-1 border-b border-gray-700">
                  <div className="px-3 py-1 text-xs text-gray-500 uppercase">My Lists</div>
                  {userLists.map((list) => (
                    <button
                      key={list.id}
                      onClick={() => { setSpreadFilter(list.id); setShowListDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm rounded flex items-center justify-between group ${
                        spreadFilter === list.id ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {list.isDefault ? (
                          <Star className="h-3.5 w-3.5 text-yellow-500" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-gray-400" />
                        )}
                        {list.name}
                        <span className="text-xs text-gray-500">({list.itemCount})</span>
                      </span>
                      {!list.isDefault && (
                        <button
                          onClick={(e) => handleDeleteList(list.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 p-0.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </button>
                  ))}
                </div>
              )}
              
              {/* Create new list */}
              <div className="p-1">
                {isCreatingList ? (
                  <div className="flex gap-1 px-2 py-1">
                    <input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateList();
                        if (e.key === "Escape") { setIsCreatingList(false); setNewListName(""); }
                      }}
                      placeholder="List name..."
                      className="flex-1 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded text-gray-100"
                      autoFocus
                    />
                    <button
                      onClick={handleCreateList}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreatingList(true)}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded flex items-center gap-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New List...
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Show count when filtering by list */}
        {spreadFilter !== "all" && spreadFilter !== "mine" && (
          <span className="text-xs text-gray-500">
            {listSpreadIds.size} spread{listSpreadIds.size !== 1 ? "s" : ""} in list
          </span>
        )}
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

