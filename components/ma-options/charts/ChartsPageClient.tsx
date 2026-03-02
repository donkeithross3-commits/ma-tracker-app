"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import * as Tabs from "@radix-ui/react-tabs";
import { UserMenu } from "@/components/UserMenu";
import WatchlistTab from "./WatchlistTab";

// lightweight-charts requires `window` — SSR-safe dynamic import
const ChartsTab = dynamic(() => import("./ChartsTab"), { ssr: false });

interface ChartsPageClientProps {
  initialUser?: {
    name?: string | null;
    email?: string | null;
  };
}

export default function ChartsPageClient({ initialUser }: ChartsPageClientProps) {
  const [activeTab, setActiveTab] = useState("charts");

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Compact header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-100 whitespace-nowrap"
          >
            &larr; DR3
          </Link>
          <h1 className="text-lg font-semibold text-gray-100">Charts</h1>
        </div>
        <UserMenu variant="dark" initialUser={initialUser} />
      </div>

      {/* Tabbed content */}
      <div className="flex-1 px-3 py-2">
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List className="flex gap-1 border-b border-gray-700 mb-3">
            <Tabs.Trigger
              value="charts"
              className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
            >
              Charts
            </Tabs.Trigger>
            <Tabs.Trigger
              value="watchlist"
              className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-gray-100 data-[state=active]:text-gray-100 data-[state=active]:border-b-2 data-[state=active]:border-blue-500"
            >
              Watchlist
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="charts" className="outline-none">
            <ChartsTab />
          </Tabs.Content>

          <Tabs.Content value="watchlist" className="outline-none">
            <WatchlistTab />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}
