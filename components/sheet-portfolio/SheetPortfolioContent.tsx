"use client";

import { useState, useCallback } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { IBConnectionProvider } from "@/components/ma-options/IBConnectionContext";
import type { ScannerDeal } from "@/types/ma-options";
import PortfolioTab from "./PortfolioTab";
import CuratorTab from "@/components/ma-options/CuratorTab";
import MonitoringTab from "@/components/ma-options/MonitoringTab";

interface SheetPortfolioContentProps {
  initialDeals: ScannerDeal[];
}

export default function SheetPortfolioContent({ initialDeals }: SheetPortfolioContentProps) {
  const [activeTab, setActiveTab] = useState("portfolio");
  const [deals, setDeals] = useState<ScannerDeal[]>(initialDeals);

  const handleDealsChange = useCallback((updatedDeals: ScannerDeal[]) => {
    setDeals(updatedDeals);
  }, []);

  return (
    <IBConnectionProvider>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        {/* Tab navigation */}
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          <div className="max-w-[1800px] mx-auto px-3 pt-2">
            <Tabs.List className="flex gap-1 border-b border-gray-800 mb-0">
              <Tabs.Trigger
                value="portfolio"
                className="px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors border-b-2 border-transparent data-[state=active]:text-white data-[state=active]:border-blue-500"
              >
                Portfolio
              </Tabs.Trigger>
              <Tabs.Trigger
                value="curate"
                className="px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors border-b-2 border-transparent data-[state=active]:text-white data-[state=active]:border-blue-500"
              >
                Curate
              </Tabs.Trigger>
              <Tabs.Trigger
                value="monitor"
                className="px-4 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors border-b-2 border-transparent data-[state=active]:text-white data-[state=active]:border-blue-500"
              >
                Monitor
              </Tabs.Trigger>
            </Tabs.List>
          </div>

          <Tabs.Content value="portfolio" className="outline-none">
            <PortfolioTab />
          </Tabs.Content>

          <Tabs.Content value="curate" className="outline-none">
            <div className="max-w-[1800px] mx-auto px-3 py-3">
              <CuratorTab deals={deals} onDealsChange={handleDealsChange} />
            </div>
          </Tabs.Content>

          <Tabs.Content value="monitor" className="outline-none">
            <div className="max-w-[1800px] mx-auto px-3 py-3">
              <MonitoringTab />
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </IBConnectionProvider>
  );
}
