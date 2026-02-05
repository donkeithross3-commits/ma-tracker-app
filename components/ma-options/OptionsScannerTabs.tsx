"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { ScannerDeal } from "@/types/ma-options";
import CuratorTab from "./CuratorTab";
import MonitoringTab from "./MonitoringTab";
import IBPositionsTab from "./IBPositionsTab";

interface OptionsScannerTabsProps {
  deals: ScannerDeal[];
  onDealsChange: (deals: ScannerDeal[]) => void;
  onRefreshDeals: () => void;
}

export default function OptionsScannerTabs({ 
  deals, 
  onDealsChange,
  onRefreshDeals,
}: OptionsScannerTabsProps) {
  const [activeTab, setActiveTab] = useState("monitor");

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
      <Tabs.List className="flex gap-1 border-b border-gray-700 mb-3">
        <Tabs.Trigger
          value="curate"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Curate
        </Tabs.Trigger>
        <Tabs.Trigger
          value="monitor"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Monitor
        </Tabs.Trigger>
        <Tabs.Trigger
          value="account"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Account
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="curate">
        <CuratorTab deals={deals} onDealsChange={onDealsChange} />
      </Tabs.Content>

      <Tabs.Content value="monitor">
        <MonitoringTab />
      </Tabs.Content>

      <Tabs.Content value="account">
        <IBPositionsTab autoRefresh />
      </Tabs.Content>
    </Tabs.Root>
  );
}
