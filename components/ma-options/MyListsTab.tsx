"use client";

import { useState, useEffect } from "react";
import { Plus, Folder, Trash2, Edit2, Check, X, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScannerDeal } from "@/types/ma-options";

interface DealList {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
}

interface DealListItem {
  id: string;
  dealId: string;
  ticker: string;
  targetName: string | null;
  expectedClosePrice: number;
  expectedCloseDate: string;
  addedByAlias: string | null;
  notes: string | null;
  addedAt: string;
}

interface MyListsTabProps {
  allDeals: ScannerDeal[];
}

export default function MyListsTab({ allDeals }: MyListsTabProps) {
  const [lists, setLists] = useState<DealList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listItems, setListItems] = useState<DealListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create new list state
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Rename list state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Add deal state
  const [showAddDeal, setShowAddDeal] = useState(false);

  // Fetch lists on mount
  useEffect(() => {
    fetchLists();
  }, []);

  // Fetch items when list is selected
  useEffect(() => {
    if (selectedListId) {
      fetchListItems(selectedListId);
    } else {
      setListItems([]);
    }
  }, [selectedListId]);

  const fetchLists = async () => {
    try {
      const response = await fetch("/api/user/deal-lists");
      if (!response.ok) throw new Error("Failed to fetch lists");
      const data = await response.json();
      setLists(data.lists);
      // Auto-select default list
      const defaultList = data.lists.find((l: DealList) => l.isDefault);
      if (defaultList && !selectedListId) {
        setSelectedListId(defaultList.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchListItems = async (listId: string) => {
    setIsLoadingItems(true);
    try {
      const response = await fetch(`/api/user/deal-lists/${listId}`);
      if (!response.ok) throw new Error("Failed to fetch list items");
      const data = await response.json();
      setListItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setIsLoadingItems(false);
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
      if (!response.ok) throw new Error("Failed to create list");
      const data = await response.json();
      setLists((prev) => [...prev, data.list]);
      setNewListName("");
      setIsCreating(false);
      setSelectedListId(data.list.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
    }
  };

  const handleRenameList = async (listId: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }

    try {
      const response = await fetch(`/api/user/deal-lists/${listId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!response.ok) throw new Error("Failed to rename list");
      const data = await response.json();
      setLists((prev) =>
        prev.map((l) => (l.id === listId ? data.list : l))
      );
      setRenamingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename list");
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (!confirm("Are you sure you want to delete this list?")) return;

    try {
      const response = await fetch(`/api/user/deal-lists/${listId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete list");
      }
      setLists((prev) => prev.filter((l) => l.id !== listId));
      if (selectedListId === listId) {
        const defaultList = lists.find((l) => l.isDefault);
        setSelectedListId(defaultList?.id || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete list");
    }
  };

  const handleAddDeal = async (dealId: string) => {
    if (!selectedListId) return;

    try {
      const response = await fetch(`/api/user/deal-lists/${selectedListId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add deal");
      }
      const data = await response.json();
      setListItems((prev) => [data.item, ...prev]);
      setLists((prev) =>
        prev.map((l) =>
          l.id === selectedListId ? { ...l, itemCount: l.itemCount + 1 } : l
        )
      );
      setShowAddDeal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add deal");
    }
  };

  const handleRemoveDeal = async (dealId: string) => {
    if (!selectedListId) return;

    try {
      await fetch(`/api/user/deal-lists/${selectedListId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      setListItems((prev) => prev.filter((item) => item.dealId !== dealId));
      setLists((prev) =>
        prev.map((l) =>
          l.id === selectedListId ? { ...l, itemCount: Math.max(0, l.itemCount - 1) } : l
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove deal");
    }
  };

  // Get deals not already in the selected list
  const availableDeals = allDeals.filter(
    (deal) => !listItems.some((item) => item.dealId === deal.id)
  );

  if (isLoading) {
    return (
      <div className="text-center py-8 text-gray-500">Loading your lists...</div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[400px]">
      {/* Lists sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-gray-700 pr-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300">My Lists</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCreating(true)}
            className="text-gray-400 hover:text-gray-100 h-7 w-7 p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {isCreating && (
          <div className="flex gap-1 mb-2">
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
              placeholder="List name..."
              className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
              autoFocus
            />
            <button
              onClick={handleCreateList}
              className="text-green-400 hover:text-green-300 p-1"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewListName("");
              }}
              className="text-gray-400 hover:text-gray-300 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {lists.map((list) => (
            <div
              key={list.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                selectedListId === list.id
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
              onClick={() => setSelectedListId(list.id)}
            >
              {renamingId === list.id ? (
                <div className="flex-1 flex gap-1">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameList(list.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="flex-1 px-1 py-0.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameList(list.id);
                    }}
                    className="text-green-400 hover:text-green-300"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  {list.isDefault ? (
                    <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span className="flex-1 text-sm truncate">{list.name}</span>
                  <span className="text-xs text-gray-500">{list.itemCount}</span>
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(list.id);
                        setRenameValue(list.name);
                      }}
                      className="text-gray-500 hover:text-gray-300"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    {!list.isDefault && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteList(list.id);
                        }}
                        className="text-gray-500 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {lists.length === 0 && !isCreating && (
            <div className="text-center py-4 text-gray-500 text-sm">
              No lists yet. Create one to get started.
            </div>
          )}
        </div>
      </div>

      {/* List contents */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedListId ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-100">
                {lists.find((l) => l.id === selectedListId)?.name}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddDeal(!showAddDeal)}
                className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Deal
              </Button>
            </div>

            {showAddDeal && (
              <div className="mb-3 p-3 bg-gray-800 border border-gray-700 rounded">
                <div className="text-sm text-gray-400 mb-2">
                  Select a deal to add to this list:
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {availableDeals.map((deal) => (
                    <button
                      key={deal.id}
                      onClick={() => handleAddDeal(deal.id)}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-gray-700 flex items-center justify-between"
                    >
                      <span className="font-mono">{deal.ticker}</span>
                      <span className="text-gray-500 text-xs">
                        ${deal.expectedClosePrice.toFixed(2)} • {deal.expectedCloseDate}
                      </span>
                    </button>
                  ))}
                  {availableDeals.length === 0 && (
                    <div className="text-center py-2 text-gray-500 text-sm">
                      All deals are already in this list
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mb-3 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-3 py-2">
                {error}
                <button
                  onClick={() => setError(null)}
                  className="ml-2 text-red-300 hover:text-red-200"
                >
                  ×
                </button>
              </div>
            )}

            {isLoadingItems ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 px-2 text-gray-400 font-medium">
                        Ticker
                      </th>
                      <th className="text-left py-2 px-2 text-gray-400 font-medium">
                        Target
                      </th>
                      <th className="text-right py-2 px-2 text-gray-400 font-medium">
                        Deal Price
                      </th>
                      <th className="text-right py-2 px-2 text-gray-400 font-medium">
                        Close Date
                      </th>
                      <th className="text-center py-2 px-2 text-gray-400 font-medium">
                        Added By
                      </th>
                      <th className="text-center py-2 px-2 text-gray-400 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listItems.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-gray-800 hover:bg-gray-800"
                      >
                        <td className="py-2 px-2 text-gray-100 font-mono">
                          {item.ticker}
                        </td>
                        <td className="py-2 px-2 text-gray-300">
                          {item.targetName || "—"}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-100 font-mono">
                          ${item.expectedClosePrice.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-300 font-mono text-xs">
                          {item.expectedCloseDate}
                        </td>
                        <td className="py-2 px-2 text-center text-xs text-gray-400">
                          {item.addedByAlias || "—"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            onClick={() => handleRemoveDeal(item.dealId)}
                            className="text-gray-500 hover:text-red-400"
                            title="Remove from list"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {listItems.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No deals in this list yet. Click &quot;Add Deal&quot; to get started.
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a list to view its contents
          </div>
        )}
      </div>
    </div>
  );
}
