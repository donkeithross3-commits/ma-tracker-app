"use client"

import { useCallback, useMemo } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Columns3, Check, RotateCcw } from "lucide-react"

export interface ColumnDef {
  key: string
  label: string
}

interface ColumnChooserProps {
  /** All available columns. */
  columns: ColumnDef[]
  /** Keys of currently visible columns (order-preserved). */
  visible: string[]
  /** Default column keys (used by "Reset to defaults"). */
  defaults: string[]
  /** Called when the user toggles a column or resets. */
  onChange: (visibleKeys: string[]) => void
  /** Optional: columns that cannot be hidden (e.g. "ticker"). */
  locked?: string[]
  /** Optional: button size variant. */
  size?: "sm" | "md"
}

/**
 * Reusable column visibility chooser.
 * Renders a small icon button that opens a dropdown with checkboxes for each column.
 * Fully generic — knows nothing about KRJ or any specific page.
 */
export function ColumnChooser({
  columns,
  visible,
  defaults,
  onChange,
  locked = [],
  size = "sm",
}: ColumnChooserProps) {
  const visibleSet = useMemo(() => new Set(visible), [visible])
  const lockedSet = useMemo(() => new Set(locked), [locked])
  const isDefault = useMemo(
    () =>
      visible.length === defaults.length &&
      defaults.every((k) => visibleSet.has(k)),
    [visible, defaults, visibleSet]
  )

  const toggleColumn = useCallback(
    (key: string) => {
      if (lockedSet.has(key)) return
      if (visibleSet.has(key)) {
        // Don't allow hiding ALL columns — keep at least 1 + locked
        const remaining = visible.filter((k) => k !== key)
        if (remaining.length === 0) return
        onChange(remaining)
      } else {
        // Insert at the position matching the master column order
        const masterOrder = columns.map((c) => c.key)
        const next = [...visible, key].sort(
          (a, b) => masterOrder.indexOf(a) - masterOrder.indexOf(b)
        )
        onChange(next)
      }
    },
    [columns, visible, visibleSet, lockedSet, onChange]
  )

  const resetToDefaults = useCallback(() => {
    onChange([...defaults])
  }, [defaults, onChange])

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"
  const btnPad = size === "sm" ? "p-1.5" : "p-2"

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={`${btnPad} rounded text-gray-400 hover:text-gray-100 hover:bg-gray-700 focus:text-gray-100 focus:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400`}
          title="Choose columns"
          aria-label="Choose columns"
        >
          <Columns3 className={iconSize} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[220px] max-h-[70vh] overflow-y-auto rounded-md border border-gray-600 bg-gray-800 p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="end"
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Visible Columns
          </div>

          {columns.map((col) => {
            const checked = visibleSet.has(col.key)
            const isLocked = lockedSet.has(col.key)
            return (
              <DropdownMenu.CheckboxItem
                key={col.key}
                checked={checked}
                disabled={isLocked}
                onCheckedChange={() => toggleColumn(col.key)}
                onSelect={(e) => e.preventDefault()} // Keep menu open
                className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none transition-colors
                  ${isLocked ? "text-gray-500 cursor-default" : "text-gray-200 hover:bg-gray-700 focus:bg-gray-700"}
                `}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked
                      ? "bg-blue-600 border-blue-600"
                      : "border-gray-500 bg-transparent"
                  }`}
                >
                  {checked && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="truncate">{col.label}</span>
              </DropdownMenu.CheckboxItem>
            )
          })}

          {!isDefault && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-600" />
              <DropdownMenu.Item
                onSelect={resetToDefaults}
                className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-700 rounded cursor-pointer outline-none"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to defaults
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
