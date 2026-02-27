"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import IBPositionsTab from "./IBPositionsTab";
import SignalsTab from "./SignalsTab";
import ManualTradingV2Tab from "./manual-v2/ManualTradingV2Tab";

interface OptionsScannerTabsProps {
  /** When "KRJ", default tab is manual; otherwise manual. */
  userAlias?: string | null;
}

export default function OptionsScannerTabs({
  userAlias,
}: OptionsScannerTabsProps) {
  const [activeTab, setActiveTab] = useState("manual");

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
      <Tabs.List className="flex gap-1 border-b border-gray-700 mb-3">
        <Tabs.Trigger
          value="manual"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Manual
        </Tabs.Trigger>
        <Tabs.Trigger
          value="manual-v2"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Manual v2
        </Tabs.Trigger>
        <Tabs.Trigger
          value="algorithmic"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Algorithmic
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="manual">
        <IBPositionsTab autoRefresh />
      </Tabs.Content>

      <Tabs.Content value="manual-v2">
        <ManualTradingV2Tab />
      </Tabs.Content>

      <Tabs.Content value="algorithmic">
        <SignalsTab />
      </Tabs.Content>
    </Tabs.Root>
  );
}
