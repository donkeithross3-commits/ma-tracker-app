"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import * as Tabs from "@radix-ui/react-tabs";
import { ExternalLink } from "lucide-react";
import IBPositionsTab from "./IBPositionsTab";
import SignalsTab from "./SignalsTab";
import ManualTradingV2Tab from "./manual-v2/ManualTradingV2Tab";
import PnlHistoryTab from "./PnlHistoryTab";
import BookTab from "./BookTab";

// lightweight-charts requires `window` — SSR-safe dynamic import
const ChartsTab = dynamic(() => import("./charts/ChartsTab"), { ssr: false });

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
        <Tabs.Trigger
          value="charts"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Charts
        </Tabs.Trigger>
        <Tabs.Trigger
          value="book"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          Book
        </Tabs.Trigger>
        <Tabs.Trigger
          value="pnl-history"
          className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
        >
          P&L History
        </Tabs.Trigger>
        {activeTab === "charts" && (
          <button
            onClick={() => {
              const params = new URLSearchParams(window.location.search);
              const preset = params.get("preset");
              const url = preset ? `/charts?preset=${encodeURIComponent(preset)}` : "/charts";
              window.open(url, "_blank");
            }}
            className="px-1.5 py-1 text-gray-500 hover:text-gray-200 transition-colors"
            title="Open charts in standalone window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
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

      <Tabs.Content value="charts">
        <ChartsTab />
      </Tabs.Content>

      <Tabs.Content value="book">
        <BookTab />
      </Tabs.Content>

      <Tabs.Content value="pnl-history">
        <PnlHistoryTab />
      </Tabs.Content>
    </Tabs.Root>
  );
}
