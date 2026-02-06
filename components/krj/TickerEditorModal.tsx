"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit3, X, Loader2, ChevronUp, ChevronDown, GripVertical, Save } from "lucide-react";

interface TickerMatch {
  ticker: string;
  name: string;
}

interface TickerEditorModalProps {
  listId: string;
  listName: string;
  listSlug?: string;
}

export function TickerEditorModal({
  listId,
  listName,
  listSlug,
}: TickerEditorModalProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [localTickers, setLocalTickers] = useState<string[]>([]);
  const [newTicker, setNewTicker] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  // Track if list was modified this session (to refresh on close)
  const listModifiedRef = useRef(false);
  // Reorder state
  const [orderChanged, setOrderChanged] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  // Drag state for reordering
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Ticker autocomplete state (SEC EDGAR lookup)
  const [suggestions, setSuggestions] = useState<TickerMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const tickerInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Load tickers from API when modal opens
  const loadTickers = async () => {
    setIsLoading(true);
    setError(null);
    
    if (!listId) {
      setError("No listId provided to modal");
      setIsLoading(false);
      return;
    }
    
    try {
      const url = `/api/krj/lists/${listId}/tickers`;
      const response = await fetch(url, { credentials: 'include' });
      
      // Check for redirect (auth failure)
      if (response.redirected) {
        throw new Error(`Auth redirect to: ${response.url}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Non-JSON response (${contentType}): ${text.substring(0, 100)}`);
      }
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(`API error ${response.status}: ${data.error || JSON.stringify(data)}`);
      }
      
      const data = await response.json();
      if (!data.tickers || !Array.isArray(data.tickers)) {
        throw new Error(`Invalid response: ${JSON.stringify(data).substring(0, 100)}`);
      }
      // Preserve order from API (sorted by position)
      setLocalTickers(data.tickers.map((t: { ticker: string }) => t.ticker));
    } catch (err) {
      setError(`listId=${listId}, error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Load tickers when modal opens
  useEffect(() => {
    if (isOpen) {
      loadTickers();
      setNewTicker("");
      setAddSuccess(null);
      setRestoreSuccess(null);
      listModifiedRef.current = false;
    }
  }, [isOpen]);

  // Debounced ticker autocomplete search (SEC EDGAR)
  useEffect(() => {
    if (!newTicker || newTicker.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/ticker-lookup?q=${encodeURIComponent(newTicker)}`
        );
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.matches || []);
          setShowSuggestions(data.matches?.length > 0);
          setSelectedIndex(-1);
        }
      } catch (err) {
        console.error("Ticker lookup error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [newTicker]);

  // Close suggestions dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tickerInputRef.current &&
        !tickerInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSuggestion = (match: TickerMatch) => {
    setNewTicker(match.ticker);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Modal is closing - refresh page if list was modified
      if (listModifiedRef.current) {
        router.refresh();
      }
    }
    setIsOpen(open);
  };

  const handleRestoreEtfsFx = async () => {
    if (listSlug !== "etfs_fx") return;
    setIsRestoring(true);
    setError(null);
    setRestoreSuccess(null);
    try {
      const response = await fetch("/api/krj/lists/restore-etfs-fx", { method: "POST" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Restore failed");
      }
      const data = await response.json();
      setRestoreSuccess(data.message ?? "List restored.");
      listModifiedRef.current = true;
      await loadTickers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setIsRestoring(false);
    }
  };

  // Move ticker up/down in the list
  const handleMoveTicker = useCallback((index: number, direction: "up" | "down") => {
    setLocalTickers((prev) => {
      const newList = [...prev];
      const targetIdx = direction === "up" ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= newList.length) return prev;
      [newList[index], newList[targetIdx]] = [newList[targetIdx], newList[index]];
      return newList;
    });
    setOrderChanged(true);
  }, []);

  // Drag-and-drop handlers
  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setLocalTickers((prev) => {
        const newList = [...prev];
        const [dragged] = newList.splice(dragIdx, 1);
        newList.splice(dragOverIdx, 0, dragged);
        return newList;
      });
      setOrderChanged(true);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Save reordered ticker list to server
  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    setError(null);
    try {
      const response = await fetch(`/api/krj/lists/${listId}/tickers/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: localTickers }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save order");
      }
      setOrderChanged(false);
      listModifiedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Restore DRC list to canonical tickers
  const handleRestoreDrc = async () => {
    if (listSlug !== "drc") return;
    setIsRestoring(true);
    setError(null);
    setRestoreSuccess(null);
    try {
      const response = await fetch("/api/krj/lists/restore-drc", { method: "POST" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Restore failed");
      }
      const data = await response.json();
      setRestoreSuccess(data.message ?? "DRC list restored.");
      setOrderChanged(false);
      listModifiedRef.current = true;
      await loadTickers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setIsRestoring(false);
    }
  };

  const handleAddTicker = async () => {
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) return;

    if (localTickers.includes(ticker)) {
      setError(`${ticker} is already in the list`);
      return;
    }

    setIsAdding(true);
    setError(null);
    setAddSuccess(null);
    setShowSuggestions(false);

    // Validate ticker exists in SEC EDGAR
    try {
      const lookupRes = await fetch(`/api/ticker-lookup?q=${encodeURIComponent(ticker)}`);
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        const exactMatch = (lookupData.matches || []).find(
          (m: TickerMatch) => m.ticker === ticker
        );
        if (!exactMatch) {
          setError("Ticker not found in SEC EDGAR. Type a few letters and pick from the list.");
          setIsAdding(false);
          return;
        }
      }
    } catch {
      // If lookup fails, allow the add to proceed (don't block on network issues)
    }

    try {
      const response = await fetch(`/api/krj/lists/${listId}/tickers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add ticker");
      }

      // Add to end of list (preserve order)
      setLocalTickers((prev) => [...prev, ticker]);
      setNewTicker("");
      setAddSuccess(`${ticker} added to list. Close and use "Request signal" in the table for data, or refresh the page.`);
      listModifiedRef.current = true;
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/5eb096b0-06f6-4f03-a0db-0e4112629bad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "TickerEditorModal.tsx:handleAddTicker", message: "add ticker success", data: { ticker, listId }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H4" }) }).catch(() => {});
      // #endregion
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTicker = async (ticker: string) => {
    setIsRemoving(ticker);
    setError(null);

    try {
      const response = await fetch(`/api/krj/lists/${listId}/tickers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove ticker");
      }

      setLocalTickers((prev) => prev.filter((t) => t !== ticker));
      listModifiedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove ticker");
    } finally {
      setIsRemoving(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        return;
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
        return;
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTicker();
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
        onClick={() => setIsOpen(true)}
      >
        <Edit3 className="h-4 w-4 mr-1" />
        Edit Tickers
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              Edit {listName} Tickers
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Add new ticker with SEC EDGAR autocomplete */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <div className="relative">
                  <input
                    ref={tickerInputRef}
                    type="text"
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                    onKeyDown={handleKeyDown}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Type ticker or company name..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    disabled={isAdding}
                    autoComplete="off"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-gray-500 border-t-blue-500 rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg max-h-60 overflow-y-auto"
                  >
                    {suggestions.map((match, index) => (
                      <button
                        key={match.ticker}
                        type="button"
                        onClick={() => handleSelectSuggestion(match)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 ${
                          index === selectedIndex ? "bg-gray-700" : ""
                        }`}
                      >
                        <span className="font-mono text-blue-400 font-medium min-w-[60px]">
                          {match.ticker}
                        </span>
                        <span className="text-gray-300 truncate">{match.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                onClick={handleAddTicker}
                disabled={isAdding || !newTicker.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="h-4 w-4 mr-1" />
                {isAdding ? "Adding..." : "Add"}
              </Button>
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-3 py-2">
                {error}
              </div>
            )}

            {addSuccess && (
              <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded px-3 py-2">
                {addSuccess}
              </div>
            )}

            {restoreSuccess && (
              <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded px-3 py-2">
                {restoreSuccess}
              </div>
            )}

            {/* Restore buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {listSlug === "etfs_fx" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestoreEtfsFx}
                  disabled={isRestoring}
                  className="border-amber-600 text-amber-400 hover:bg-amber-900/30"
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    "Restore default ETFs/FX list"
                  )}
                </Button>
              )}
              {listSlug === "drc" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestoreDrc}
                  disabled={isRestoring}
                  className="border-amber-600 text-amber-400 hover:bg-amber-900/30"
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    "Restore default DRC list"
                  )}
                </Button>
              )}
              {orderChanged && (
                <Button
                  size="sm"
                  onClick={handleSaveOrder}
                  disabled={isSavingOrder}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isSavingOrder ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      Save Order
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Ticker list */}
            <div className="flex-1 overflow-y-auto border border-gray-700 rounded">
              <div className="p-2 text-xs text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900">
                {isLoading ? "Loading..." : `${localTickers.length} ticker${localTickers.length !== 1 ? "s" : ""}`}
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {localTickers.map((ticker, idx) => (
                    <div
                      key={ticker}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-1 px-2 py-1.5 hover:bg-gray-800 transition-colors ${
                        dragIdx === idx ? "opacity-50 bg-gray-800" : ""
                      } ${dragOverIdx === idx && dragIdx !== idx ? "border-t-2 border-blue-500" : ""}`}
                    >
                      {/* Drag handle */}
                      <GripVertical className="h-4 w-4 text-gray-600 cursor-grab flex-shrink-0" />
                      {/* Position number */}
                      <span className="text-xs text-gray-500 w-5 text-right flex-shrink-0">{idx + 1}</span>
                      {/* Ticker */}
                      <span className="font-mono text-sm flex-1 ml-1">{ticker}</span>
                      {/* Up/Down arrows */}
                      <div className="flex flex-col flex-shrink-0">
                        <button
                          onClick={() => handleMoveTicker(idx, "up")}
                          disabled={idx === 0}
                          className="text-gray-500 hover:text-gray-200 disabled:opacity-20 p-0 leading-none"
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleMoveTicker(idx, "down")}
                          disabled={idx === localTickers.length - 1}
                          className="text-gray-500 hover:text-gray-200 disabled:opacity-20 p-0 leading-none"
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={() => handleRemoveTicker(ticker)}
                        disabled={isRemoving === ticker}
                        className="text-gray-500 hover:text-red-400 disabled:opacity-50 flex-shrink-0 ml-1"
                        title="Remove ticker"
                      >
                        {isRemoving === ticker ? (
                          <span className="text-xs">...</span>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                  {localTickers.length === 0 && (
                    <div className="px-3 py-8 text-center text-gray-500 text-sm">
                      No tickers in this list
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Drag tickers or use arrows to reorder, then click Save Order. Newly added tickers appear at the end. Use &quot;Request signal&quot; in the table for data, or wait for the weekly batch.
            </p>
          </div>

          <DialogFooter className="flex items-center gap-2">
            {orderChanged && (
              <span className="text-xs text-amber-400 mr-auto">
                Unsaved order changes — click Save Order above
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
