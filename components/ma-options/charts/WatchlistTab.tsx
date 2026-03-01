"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { List } from "lucide-react";
import WatchlistManager, { type WatchlistSummary } from "./WatchlistManager";
import WatchlistTable, { type WatchlistItemDisplay } from "./WatchlistTable";
import { useWatchlistQuotes } from "./useWatchlistQuotes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WatchlistDetail {
  id: string;
  name: string;
  items: WatchlistItemDisplay[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WatchlistTab() {
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistItemDisplay[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);

  // Prepare quote items from current items
  const quoteItems = useMemo(
    () =>
      items.map((i) => ({
        ticker: i.ticker,
        instrumentType: i.instrumentType,
        exchange: i.exchange,
      })),
    [items]
  );

  const { quotes, loading: quotesLoading, lastFetch } = useWatchlistQuotes(quoteItems);

  // --- Fetch all lists ---
  const fetchLists = useCallback(async () => {
    try {
      const resp = await fetch("/api/watchlists");
      if (resp.ok) {
        const data = await resp.json();
        setLists(data);
        return data as WatchlistSummary[];
      }
    } catch {
      // ignore
    }
    return [] as WatchlistSummary[];
  }, []);

  // --- Fetch items for a list ---
  const fetchItems = useCallback(async (listId: string) => {
    try {
      const resp = await fetch(`/api/watchlists/${listId}`);
      if (resp.ok) {
        const data: WatchlistDetail = await resp.json();
        setItems(data.items);
      }
    } catch {
      // ignore
    }
  }, []);

  // --- Load lists on mount ---
  useEffect(() => {
    (async () => {
      setLoadingLists(true);
      const fetched = await fetchLists();
      if (fetched.length > 0) {
        setSelectedListId(fetched[0].id);
        await fetchItems(fetched[0].id);
      }
      setLoadingLists(false);
    })();
  }, [fetchLists, fetchItems]);

  // --- Switch list ---
  const handleSelectList = useCallback(
    async (id: string) => {
      setSelectedListId(id);
      setItems([]);
      await fetchItems(id);
    },
    [fetchItems]
  );

  // --- Create list ---
  const handleCreateList = useCallback(
    async (name: string) => {
      try {
        const resp = await fetch("/api/watchlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (resp.ok) {
          const newList = await resp.json();
          setLists((prev) => [...prev, newList]);
          setSelectedListId(newList.id);
          setItems([]);
        }
      } catch {
        // ignore
      }
    },
    []
  );

  // --- Rename list ---
  const handleRenameList = useCallback(async (id: string, name: string) => {
    try {
      const resp = await fetch(`/api/watchlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (resp.ok) {
        setLists((prev) =>
          prev.map((l) => (l.id === id ? { ...l, name } : l))
        );
      }
    } catch {
      // ignore
    }
  }, []);

  // --- Delete list ---
  const handleDeleteList = useCallback(
    async (id: string) => {
      try {
        const resp = await fetch(`/api/watchlists/${id}`, {
          method: "DELETE",
        });
        if (resp.ok) {
          setLists((prev) => {
            const remaining = prev.filter((l) => l.id !== id);
            if (selectedListId === id) {
              if (remaining.length > 0) {
                setSelectedListId(remaining[0].id);
                fetchItems(remaining[0].id);
              } else {
                setSelectedListId(null);
                setItems([]);
              }
            }
            return remaining;
          });
        }
      } catch {
        // ignore
      }
    },
    [selectedListId, fetchItems]
  );

  // --- Add ticker ---
  const handleAddTicker = useCallback(
    async (
      ticker: string,
      instrumentType: string,
      displayName?: string,
      exchange?: string
    ) => {
      if (!selectedListId) return;
      try {
        const resp = await fetch(
          `/api/watchlists/${selectedListId}/items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticker,
              instrumentType,
              displayName,
              exchange,
            }),
          }
        );
        if (resp.ok) {
          const newItem = await resp.json();
          setItems((prev) => [...prev, newItem]);
          // Update item count in lists
          setLists((prev) =>
            prev.map((l) =>
              l.id === selectedListId
                ? { ...l, itemCount: l.itemCount + 1 }
                : l
            )
          );
        } else {
          const err = await resp.json().catch(() => ({}));
          if (err.error) {
            // Could show a toast, for now just log
            console.warn("Add ticker failed:", err.error);
          }
        }
      } catch {
        // ignore
      }
    },
    [selectedListId]
  );

  // --- Remove ticker ---
  const handleRemoveItem = useCallback(
    async (ticker: string) => {
      if (!selectedListId) return;
      try {
        const resp = await fetch(
          `/api/watchlists/${selectedListId}/items?ticker=${encodeURIComponent(ticker)}`,
          { method: "DELETE" }
        );
        if (resp.ok) {
          setItems((prev) => prev.filter((i) => i.ticker !== ticker));
          setLists((prev) =>
            prev.map((l) =>
              l.id === selectedListId
                ? { ...l, itemCount: Math.max(0, l.itemCount - 1) }
                : l
            )
          );
        }
      } catch {
        // ignore
      }
    },
    [selectedListId]
  );

  // --- Loading state ---
  if (loadingLists) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        Loading watchlists...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Manager bar */}
      <WatchlistManager
        lists={lists}
        selectedListId={selectedListId}
        onSelectList={handleSelectList}
        onCreateList={handleCreateList}
        onRenameList={handleRenameList}
        onDeleteList={handleDeleteList}
        onAddTicker={handleAddTicker}
      />

      {/* Content */}
      {selectedListId ? (
        <>
          {/* Status bar */}
          <div className="flex items-center justify-between text-xs text-gray-500 px-1">
            <span>
              {items.length} instrument{items.length !== 1 ? "s" : ""}
            </span>
            <span>
              {quotesLoading && "Fetching..."}
              {!quotesLoading && lastFetch && (
                <>Last update: {lastFetch.toLocaleTimeString()}</>
              )}
            </span>
          </div>

          <WatchlistTable
            items={items}
            quotes={quotes}
            onRemoveItem={handleRemoveItem}
          />
        </>
      ) : (
        <div className="text-center py-16">
          <List className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-1">No watchlists yet</p>
          <p className="text-gray-500 text-xs">
            Click &quot;New List&quot; to create your first watchlist
          </p>
        </div>
      )}
    </div>
  );
}
