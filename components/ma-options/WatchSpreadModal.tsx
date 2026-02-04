"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Star, List, Loader2 } from "lucide-react";

interface UserDealList {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount?: number;
}

interface WatchSpreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (listIds: string[], newListName?: string) => Promise<void>;
  spreadDescription: string; // e.g., "AVGO 180/200 Call Spread Jun 2026"
}

export function WatchSpreadModal({
  isOpen,
  onClose,
  onConfirm,
  spreadDescription,
}: WatchSpreadModalProps) {
  const [lists, setLists] = useState<UserDealList[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Load user's deal lists when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLists();
    }
  }, [isOpen]);

  const loadLists = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/user/deal-lists");
      if (!response.ok) {
        if (response.status === 401) {
          // Not logged in - just show "All Spreads" option
          setLists([]);
          return;
        }
        throw new Error("Failed to load lists");
      }
      const data = await response.json();
      setLists(data.lists || []);
      
      // Pre-select the default (Favorites) list
      const defaultList = data.lists?.find((l: UserDealList) => l.isDefault);
      if (defaultList) {
        setSelectedListIds([defaultList.id]);
      }
    } catch (err) {
      console.error("Error loading lists:", err);
      setError(err instanceof Error ? err.message : "Failed to load lists");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleList = (listId: string) => {
    setSelectedListIds((prev) =>
      prev.includes(listId)
        ? prev.filter((id) => id !== listId)
        : [...prev, listId]
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(
        selectedListIds,
        showNewListInput && newListName.trim() ? newListName.trim() : undefined
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add spread");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedListIds([]);
    setShowNewListInput(false);
    setNewListName("");
    setError(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <List className="h-5 w-5" />
            Add to Watchlist
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Spread description */}
          <div className="bg-gray-800 rounded px-3 py-2 text-sm">
            <span className="text-gray-400">Adding:</span>{" "}
            <span className="font-mono text-blue-400">{spreadDescription}</span>
          </div>

          {/* Info about All Spreads */}
          <p className="text-sm text-gray-400">
            This spread will be added to <strong>All Spreads</strong> (visible to all users).
            Optionally add it to your personal lists below.
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
            </div>
          ) : (
            <>
              {/* User's lists */}
              {lists.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">
                    Add to your lists:
                  </label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {lists.map((list) => (
                      <label
                        key={list.id}
                        className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-800 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedListIds.includes(list.id)}
                          onCheckedChange={() => handleToggleList(list.id)}
                          className="border-gray-600 data-[state=checked]:bg-blue-600"
                        />
                        <span className="flex items-center gap-2">
                          {list.isDefault && (
                            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                          )}
                          {list.name}
                        </span>
                        {list.itemCount !== undefined && (
                          <span className="text-xs text-gray-500 ml-auto">
                            {list.itemCount} items
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Create new list option */}
              {!showNewListInput ? (
                <button
                  onClick={() => setShowNewListInput(true)}
                  className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                >
                  <Plus className="h-4 w-4" />
                  Create new list
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">
                    New list name:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="e.g., High Conviction"
                      className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowNewListInput(false);
                        setNewListName("");
                      }}
                      className="text-gray-400"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className="border-gray-600 text-gray-300"
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add to Watchlist"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
