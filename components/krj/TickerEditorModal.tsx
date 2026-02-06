"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit3, X, Loader2 } from "lucide-react";

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

  // Load tickers from API when modal opens
  const loadTickers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/krj/lists/${listId}/tickers`);
      if (!response.ok) throw new Error("Failed to load tickers");
      const data = await response.json();
      setLocalTickers(data.tickers.map((t: { ticker: string }) => t.ticker).sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickers");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      loadTickers();
      setNewTicker("");
      setAddSuccess(null);
      setRestoreSuccess(null);
      listModifiedRef.current = false;
    } else {
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

      setLocalTickers((prev) => [...prev, ticker].sort());
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
            {/* Add new ticker */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder="Enter ticker symbol..."
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                disabled={isAdding}
              />
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

            {listSlug === "etfs_fx" && (
              <div className="flex items-center gap-2">
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
              </div>
            )}

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
                  {localTickers.map((ticker) => (
                    <div
                      key={ticker}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-800"
                    >
                      <span className="font-mono text-sm">{ticker}</span>
                      <button
                        onClick={() => handleRemoveTicker(ticker)}
                        disabled={isRemoving === ticker}
                        className="text-gray-500 hover:text-red-400 disabled:opacity-50"
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
              Newly added tickers appear in the table right away. Use &quot;Request signal&quot; on a row to fetch signal data on demand, or wait for the next weekly batch.
            </p>
          </div>

          <DialogFooter>
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
