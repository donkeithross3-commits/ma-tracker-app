"use client";

import { useState, useCallback, useEffect } from "react";
import type { ScannerDeal } from "@/types/ma-options";
import { IBConnectionProvider } from "./IBConnectionContext";
import IBConnectionStatus from "./IBConnectionStatus";
import OptionsScannerTabs from "./OptionsScannerTabs";
import { UserMenu } from "@/components/UserMenu";

interface MAOptionsContentProps {
  initialDeals: ScannerDeal[];
  initialUser?: {
    name?: string | null;
    email?: string | null;
  };
}

export default function MAOptionsContent({ initialDeals, initialUser }: MAOptionsContentProps) {
  const [deals, setDeals] = useState<ScannerDeal[]>(initialDeals);

  const refreshDeals = useCallback(async () => {
    try {
      const response = await fetch("/api/scanner-deals");
      if (response.ok) {
        const data = await response.json();
        console.log("[MAOptionsContent] Fetched deals, noOptionsAvailable flags:", 
          data.deals.filter((d: ScannerDeal) => d.noOptionsAvailable).map((d: ScannerDeal) => d.ticker)
        );
        setDeals(data.deals);
      }
    } catch (error) {
      console.error("Failed to refresh deals:", error);
    }
  }, []);

  // Fetch fresh data on mount to ensure noOptionsAvailable flags are current
  useEffect(() => {
    refreshDeals();
  }, [refreshDeals]);

  const handleDealsChange = useCallback((newDeals: ScannerDeal[]) => {
    setDeals(newDeals);
  }, []);

  return (
    <IBConnectionProvider>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-100">
          M&A Options Scanner
        </h1>
        <div className="flex items-center gap-4">
          <IBConnectionStatus />
          <UserMenu variant="dark" initialUser={initialUser} />
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Curate and monitor options strategies for merger arbitrage deals ({deals.length} deal{deals.length !== 1 ? "s" : ""})
      </p>

      <OptionsScannerTabs 
        deals={deals} 
        onDealsChange={handleDealsChange}
        onRefreshDeals={refreshDeals}
      />
    </IBConnectionProvider>
  );
}
