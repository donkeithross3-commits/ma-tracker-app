"use client";

import Link from "next/link";
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
    alias?: string | null;
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
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-100 whitespace-nowrap"
          >
            ← DR3 Dashboard
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-100">
              M&A Options Scanner
            </h1>
            <p className="text-sm text-gray-400">
              Curate and monitor options strategies for merger arbitrage deals ({deals.length} deal{deals.length !== 1 ? "s" : ""})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <IBConnectionStatus />
          <UserMenu variant="dark" initialUser={initialUser} />
        </div>
      </div>

      <OptionsScannerTabs 
        deals={deals} 
        onDealsChange={handleDealsChange}
        onRefreshDeals={refreshDeals}
        userAlias={initialUser?.alias ?? undefined}
      />
    </IBConnectionProvider>
  );
}
