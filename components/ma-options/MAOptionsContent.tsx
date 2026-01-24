"use client";

import { useState, useCallback } from "react";
import type { DealForScanner } from "@/types/ma-options";
import { IBConnectionProvider } from "./IBConnectionContext";
import IBConnectionStatus from "./IBConnectionStatus";
import OptionsScannerTabs from "./OptionsScannerTabs";

interface MAOptionsContentProps {
  initialDeals: DealForScanner[];
}

export default function MAOptionsContent({ initialDeals }: MAOptionsContentProps) {
  const [deals, setDeals] = useState<DealForScanner[]>(initialDeals);

  const refreshDeals = useCallback(async () => {
    try {
      const response = await fetch("/api/ma-options/deals");
      if (response.ok) {
        const data = await response.json();
        setDeals(data.deals);
      }
    } catch (error) {
      console.error("Failed to refresh deals:", error);
    }
  }, []);

  return (
    <IBConnectionProvider>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-100">
          M&A Options Scanner
        </h1>
        <IBConnectionStatus />
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Curate and monitor options strategies for merger arbitrage deals ({deals.length} deals available)
      </p>

      <OptionsScannerTabs deals={deals} onDealsChange={refreshDeals} />
    </IBConnectionProvider>
  );
}

