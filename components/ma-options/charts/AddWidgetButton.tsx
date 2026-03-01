"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, LineChart, Activity, Briefcase } from "lucide-react";
import type { WidgetType } from "./types";

interface AddWidgetButtonProps {
  onAdd: (type: WidgetType) => void;
}

export default function AddWidgetButton({ onAdd }: AddWidgetButtonProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded hover:text-gray-200 hover:border-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
          title="Add widget"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] rounded-md border border-gray-600 bg-gray-800 p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="start"
        >
          <DropdownMenu.Item
            onSelect={() => onAdd("price-chart")}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer outline-none"
          >
            <LineChart className="h-3.5 w-3.5 text-blue-400" />
            Price Chart
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onAdd("signal-panel")}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer outline-none"
          >
            <Activity className="h-3.5 w-3.5 text-green-400" />
            Signal Panel
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onAdd("positions-panel")}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer outline-none"
          >
            <Briefcase className="h-3.5 w-3.5 text-purple-400" />
            Positions Panel
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
