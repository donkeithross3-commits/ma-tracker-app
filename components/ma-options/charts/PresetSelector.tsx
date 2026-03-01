"use client";

import { useCallback, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Plus, Trash2, Check } from "lucide-react";
import type { ChartPreset } from "./types";
import { BUILT_IN_PRESETS } from "./defaultLayouts";

interface PresetSelectorProps {
  currentPreset: string;
  savedPresets: Record<string, ChartPreset>;
  onSelect: (name: string) => void;
  onSaveAs: (name: string) => void;
  onDelete: (name: string) => void;
}

export default function PresetSelector({
  currentPreset,
  savedPresets,
  onSelect,
  onSaveAs,
  onDelete,
}: PresetSelectorProps) {
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  const builtInNames = Object.keys(BUILT_IN_PRESETS);
  const userPresetNames = Object.keys(savedPresets).filter(
    (name) => !BUILT_IN_PRESETS[name]
  );

  const handleSaveAs = useCallback(() => {
    const name = saveAsName.trim();
    if (name && !BUILT_IN_PRESETS[name]) {
      onSaveAs(name);
      setSaveAsName("");
      setShowSaveAs(false);
    }
  }, [saveAsName, onSaveAs]);

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (!open) {
          setShowSaveAs(false);
          setSaveAsName("");
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-200 bg-gray-800 border border-gray-700 rounded hover:border-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {currentPreset}
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[200px] max-h-[60vh] overflow-y-auto rounded-md border border-gray-600 bg-gray-800 p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="start"
        >
          {/* Built-in presets */}
          <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            Built-in
          </div>
          {builtInNames.map((name) => (
            <DropdownMenu.Item
              key={name}
              onSelect={() => onSelect(name)}
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer outline-none"
            >
              {currentPreset === name ? (
                <Check className="h-3 w-3 text-blue-400 shrink-0" />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {name}
            </DropdownMenu.Item>
          ))}

          {/* User presets */}
          {userPresetNames.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-600" />
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Saved
              </div>
              {userPresetNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer group"
                  onClick={() => onSelect(name)}
                >
                  {currentPreset === name ? (
                    <Check className="h-3 w-3 text-blue-400 shrink-0" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(name);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-500 hover:text-red-400 transition-all"
                    title="Delete preset"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Save As */}
          <DropdownMenu.Separator className="my-1 h-px bg-gray-600" />
          {showSaveAs ? (
            <div
              className="px-2 py-1.5 flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveAs();
                  if (e.key === "Escape") setShowSaveAs(false);
                }}
                placeholder="Preset name..."
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 inline-edit"
                autoFocus
              />
              <button
                onClick={handleSaveAs}
                disabled={!saveAsName.trim()}
                className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          ) : (
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setShowSaveAs(true);
              }}
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded cursor-pointer outline-none"
            >
              <Plus className="h-3 w-3" />
              Save As...
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
