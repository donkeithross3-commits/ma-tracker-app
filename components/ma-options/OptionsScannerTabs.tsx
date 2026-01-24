"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { DealForScanner } from "@/types/ma-options";
import CuratorTab from "./CuratorTab";
import MonitoringTab from "./MonitoringTab";

interface OptionsScannerTabsProps {
  deals: DealForScanner[];
  onDealsChange: () => void;
}

export default function OptionsScannerTabs({ deals, onDealsChange }: OptionsScannerTabsProps) {
  const [activeTab, setActiveTab] = useState("curate");

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
      <Tabs.List className="flex gap-2 border-b border-gray-700 mb-6">
        <Tabs.Trigger
          value="curate"
          className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Curate
        </Tabs.Trigger>
        <Tabs.Trigger
          value="monitor"
          className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Monitor
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="curate">
        <CuratorTab deals={deals} onDealsChange={onDealsChange} />
      </Tabs.Content>

      <Tabs.Content value="monitor">
        <MonitoringTab />
      </Tabs.Content>
    </Tabs.Root>
  );
}

