"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings, Eye, EyeOff, GitFork, User } from "lucide-react";

type ListInfo = {
  listId: string;
  key: string;
  label: string;
  ownerAlias: string | null;
  isSystem: boolean;
  isEditable: boolean;
  canEdit: boolean;
  isFork: boolean;
  forkDelta?: { added: string[]; removed: string[] };
  tickerCount: number;
};

interface ListSettingsModalProps {
  lists: ListInfo[];
  hiddenListIds: string[];
  onHiddenListsChange: (hiddenIds: string[]) => void;
  onForkList: (listId: string) => void;
  onResetFork: (listId: string) => void;
  userId: string | null;
}

export function ListSettingsModal({
  lists,
  hiddenListIds,
  onHiddenListsChange,
  onForkList,
  onResetFork,
  userId,
}: ListSettingsModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localHidden, setLocalHidden] = useState<string[]>(hiddenListIds);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setLocalHidden(hiddenListIds);
    }
    setIsOpen(open);
  };

  const handleToggleList = (listId: string) => {
    setLocalHidden((prev) =>
      prev.includes(listId)
        ? prev.filter((id) => id !== listId)
        : [...prev, listId]
    );
  };

  const handleSave = async () => {
    try {
      await fetch("/api/krj/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenListIds: localHidden }),
      });
      onHiddenListsChange(localHidden);
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to save preferences:", error);
    }
  };

  if (!userId) {
    return null; // Don't show settings if not logged in
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="text-gray-400 hover:text-gray-100 hover:bg-gray-700"
        title="List Settings"
      >
        <Settings className="h-4 w-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-gray-900 text-gray-100 border-gray-700 max-w-lg">
          <DialogHeader>
            <DialogTitle>KRJ List Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Choose which lists to show in your view. Hidden lists won&apos;t appear in your tabs.
            </p>

            <div className="space-y-2">
              {lists.map((list) => {
                const isHidden = localHidden.includes(list.listId);
                return (
                  <div
                    key={list.listId}
                    className={`flex items-center justify-between p-3 rounded border ${
                      isHidden
                        ? "border-gray-700 bg-gray-800/50 opacity-60"
                        : "border-gray-600 bg-gray-800"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={!isHidden}
                        onCheckedChange={() => handleToggleList(list.listId)}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{list.label}</span>
                          {list.isFork && (
                            <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <GitFork className="h-3 w-3" />
                              Fork
                            </span>
                          )}
                          {list.isSystem && (
                            <span className="text-xs bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">
                              System
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                          {list.ownerAlias && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {list.ownerAlias}
                            </span>
                          )}
                          <span>{list.tickerCount} tickers</span>
                          {list.forkDelta && (
                            <span className="text-blue-400">
                              (+{list.forkDelta.added.length} / -{list.forkDelta.removed.length})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isHidden ? (
                        <EyeOff className="h-4 w-4 text-gray-500" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {lists.some((l) => l.isFork) && (
              <div className="pt-2 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-2">
                  Forked lists have your custom additions/removals. Reset to see the original.
                </p>
                {lists
                  .filter((l) => l.isFork)
                  .map((list) => (
                    <Button
                      key={list.listId}
                      variant="outline"
                      size="sm"
                      onClick={() => onResetFork(list.listId)}
                      className="mr-2 mb-2 bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
                    >
                      Reset &ldquo;{list.label}&rdquo; fork
                    </Button>
                  ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
