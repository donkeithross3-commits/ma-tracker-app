"use client";

import { useState } from "react";
import type {
  DealForScanner,
  OptionChainResponse,
  CandidateStrategy,
} from "@/types/ma-options";
import DealSelector from "./DealSelector";
import DealInfo, { type ScanParameters } from "./DealInfo";
import OptionChainViewer from "./OptionChainViewer";
import CandidateStrategiesTable from "./CandidateStrategiesTable";
import WatchlistManager from "./WatchlistManager";
import { useIBConnection } from "./IBConnectionContext";

interface CuratorTabProps {
  deals: DealForScanner[];
  onDealsChange?: () => void;
}

export default function CuratorTab({ deals, onDealsChange }: CuratorTabProps) {
  const { isConnected: ibConnected } = useIBConnection();
  const [selectedDeal, setSelectedDeal] = useState<DealForScanner | null>(null);
  const [chainData, setChainData] = useState<OptionChainResponse | null>(null);
  const [candidates, setCandidates] = useState<CandidateStrategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectDeal = (deal: DealForScanner) => {
    console.log("Deal selected:", deal);
    setSelectedDeal(deal);
    // Reset previous data when selecting a new deal
    setChainData(null);
    setCandidates([]);
    setError(null);
  };

  const handleLoadChain = async (params: ScanParameters) => {
    if (!selectedDeal) return;

    setLoading(true);
    setError(null);

    console.log("Loading chain with parameters:", params);

    try {
      // Fetch option chain
      const chainResponse = await fetch("/api/ma-options/fetch-chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: selectedDeal.id,
          ticker: selectedDeal.ticker,
          dealPrice: params.dealPrice, // Use user-edited deal price
          expectedCloseDate: selectedDeal.expectedCloseDate,
          scanParams: params,
        }),
      });

      if (!chainResponse.ok) {
        throw new Error("Failed to fetch option chain");
      }

      const chainResult: OptionChainResponse = await chainResponse.json();
      setChainData(chainResult);

      // Generate candidate strategies with parameters
      const candidatesResponse = await fetch(
        "/api/ma-options/generate-candidates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshotId: chainResult.snapshotId,
            dealId: selectedDeal.id,
            scanParams: params,
          }),
        }
      );

      if (!candidatesResponse.ok) {
        throw new Error("Failed to generate candidates");
      }

      const candidatesResult = await candidatesResponse.json();
      setCandidates(candidatesResult.candidates || []);

      // Refresh deals list to show updated noOptionsAvailable flag
      if (onDealsChange) {
        onDealsChange();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleWatchSpread = async (strategy: CandidateStrategy) => {
    if (!selectedDeal) return;

    try {
      const response = await fetch("/api/ma-options/watch-spread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: selectedDeal.id,
          strategy,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add to watchlist");
      }

      alert("Added to watchlist!");
      
      // Refresh deals list to update watched spreads count badge
      if (onDealsChange) {
        onDealsChange();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add to watchlist");
    }
  };

  return (
    <div className="space-y-6">
      {/* Deal Info - Show at top when selected */}
      {selectedDeal && (
        <DealInfo
          deal={selectedDeal}
          onLoadChain={handleLoadChain}
          loading={loading}
          ibConnected={ibConnected}
        />
      )}

      {/* Error Display */}
      {error && (
        <div className={`border rounded p-4 text-sm ${
          error.includes("IB TWS not connected") 
            ? "bg-orange-900/20 border-orange-700 text-orange-400" 
            : "bg-red-900/20 border-red-700 text-red-400"
        }`}>
          <div className="font-semibold mb-1">
            {error.includes("IB TWS not connected") ? "⚠️ IB TWS Not Connected" : "Error"}
          </div>
          <div>{error}</div>
          {error.includes("IB TWS not connected") && (
            <div className="mt-2 text-xs text-orange-300">
              Please start Interactive Brokers TWS or Gateway and ensure it's accepting API connections on port 7497.
              <br />
              <a 
                href="https://www.interactivebrokers.com/en/trading/tws.php" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline hover:text-orange-200"
              >
                Learn more about IB TWS API →
              </a>
            </div>
          )}
        </div>
      )}

      {/* Option Chain Viewer */}
      {chainData && <OptionChainViewer chainData={chainData} />}

      {/* Candidate Strategies */}
      {candidates.length > 0 && (
        <CandidateStrategiesTable
          candidates={candidates}
          onWatch={handleWatchSpread}
        />
      )}

      {/* Watchlist Manager */}
      {selectedDeal && <WatchlistManager dealId={selectedDeal.id} />}

      {/* Deal Selector - At bottom for easy access to change deals */}
      <DealSelector
        deals={deals}
        selectedDeal={selectedDeal}
        onSelectDeal={handleSelectDeal}
      />
    </div>
  );
}

