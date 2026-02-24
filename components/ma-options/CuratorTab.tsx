"use client";

import { useState, useEffect } from "react";
import type {
  ScannerDeal,
  OptionChainResponse,
  CandidateStrategy,
  OptionContract,
} from "@/types/ma-options";
import AddDealForm from "./AddDealForm";
import ScannerDealSelector from "./ScannerDealSelector";
import DealInfo, { type ScanParameters } from "./DealInfo";
import OptionChainViewer from "./OptionChainViewer";
import CandidateStrategiesTable from "./CandidateStrategiesTable";
import { WatchSpreadModal } from "./WatchSpreadModal";


interface CuratorTabProps {
  deals: ScannerDeal[];
  onDealsChange?: (deals: ScannerDeal[]) => void;
}

export default function CuratorTab({ deals: initialDeals, onDealsChange }: CuratorTabProps) {
  const [deals, setDeals] = useState<ScannerDeal[]>(initialDeals);
  const [selectedDeal, setSelectedDeal] = useState<ScannerDeal | null>(null);
  const [chainData, setChainData] = useState<OptionChainResponse | null>(null);
  const [candidates, setCandidates] = useState<CandidateStrategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Editable deal price for real-time metric recalculation
  const [editableDealPrice, setEditableDealPrice] = useState<number | null>(null);
  
  // Watch spread modal state
  const [watchModalOpen, setWatchModalOpen] = useState(false);
  const [pendingStrategy, setPendingStrategy] = useState<CandidateStrategy | null>(null);
  
  // Reset editable deal price when deal changes
  useEffect(() => {
    if (selectedDeal) {
      setEditableDealPrice(selectedDeal.expectedClosePrice);
    } else {
      setEditableDealPrice(null);
    }
  }, [selectedDeal?.id, selectedDeal?.expectedClosePrice]);

  const handleSelectDeal = (deal: ScannerDeal) => {
    console.log("Deal selected:", deal);
    setSelectedDeal(deal);
    // Reset previous data when selecting a new deal
    setChainData(null);
    setCandidates([]);
    setError(null);
  };

  const handleDealAdded = (deal: ScannerDeal) => {
    const newDeals = [...deals, deal].sort((a, b) => a.ticker.localeCompare(b.ticker));
    setDeals(newDeals);
    onDealsChange?.(newDeals);
  };

  const handleDealUpdated = (updatedDeal: ScannerDeal) => {
    const newDeals = deals.map((d) => (d.id === updatedDeal.id ? updatedDeal : d));
    setDeals(newDeals);
    onDealsChange?.(newDeals);
    
    // Update selected deal if it was the one edited
    if (selectedDeal?.id === updatedDeal.id) {
      setSelectedDeal(updatedDeal);
    }
  };

  const handleDealDeleted = (dealId: string) => {
    const newDeals = deals.filter((d) => d.id !== dealId);
    setDeals(newDeals);
    onDealsChange?.(newDeals);
    
    // Clear selection if deleted deal was selected
    if (selectedDeal?.id === dealId) {
      setSelectedDeal(null);
      setChainData(null);
      setCandidates([]);
    }
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
          dealPrice: params.dealPrice,
          expectedCloseDate: selectedDeal.expectedCloseDate,
          scanParams: params,
        }),
      });

      if (!chainResponse.ok) {
        const errorData = await chainResponse.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch option chain");
      }

      const chainResult: OptionChainResponse = await chainResponse.json();
      setChainData(chainResult);

      // Update noOptionsAvailable flag based on scan results
      const hasOptions = chainResult.contracts && chainResult.contracts.length > 0;
      try {
        await fetch(`/api/scanner-deals/${selectedDeal.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noOptionsAvailable: !hasOptions,
            lastOptionsCheck: new Date().toISOString(),
          }),
        });
        // Update local deal state
        handleDealUpdated({
          ...selectedDeal,
          noOptionsAvailable: !hasOptions,
          lastOptionsCheck: new Date().toISOString(),
        });
      } catch (updateErr) {
        console.warn("Failed to update deal options flag:", updateErr);
      }

      // Generate candidate strategies with parameters
      // Always pass chainData directly - this avoids database lookup issues
      // and works for both ws-relay and agent sources
      console.log("CuratorTab: chainResult.source =", chainResult.source, "snapshotId =", chainResult.snapshotId, "contracts =", chainResult.contracts?.length);
      
      const candidatesResponse = await fetch(
        "/api/ma-options/generate-candidates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshotId: chainResult.snapshotId,
            dealId: selectedDeal.id,
            scanParams: params,
            // Always include chain data to avoid database lookup issues
            chainData: {
              ticker: chainResult.ticker,
              spotPrice: chainResult.spotPrice,
              dealPrice: chainResult.dealPrice,
              expectedCloseDate: selectedDeal.expectedCloseDate,
              contracts: chainResult.contracts,
            },
          }),
        }
      );

      if (!candidatesResponse.ok) {
        throw new Error("Failed to generate candidates");
      }

      const candidatesResult = await candidatesResponse.json();
      setCandidates(candidatesResult.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleWatchSpread = async (strategy: CandidateStrategy) => {
    if (!selectedDeal) return;
    
    // Open modal to let user choose lists
    setPendingStrategy(strategy);
    setWatchModalOpen(true);
  };
  
  const handleConfirmWatch = async (listIds: string[], newListName?: string) => {
    if (!selectedDeal || !pendingStrategy) return;

    const response = await fetch("/api/ma-options/watch-spread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId: selectedDeal.id,
        strategy: pendingStrategy,
        underlyingPrice: chainData?.spotPrice,
        listIds,
        newListName,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to add to watchlist");
    }

    // Check for duplicate response
    if (data.duplicate) {
      throw new Error(data.message || "This spread is already in your watchlist");
    }
    
    // Success - modal will close automatically
    setPendingStrategy(null);
  };
  
  // Generate spread description for modal
  const getSpreadDescription = (strategy: CandidateStrategy): string => {
    if (!selectedDeal) return "";
    const legs = strategy.legs;
    const expDate = new Date(strategy.expiration);
    const expStr = expDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    
    if (legs.length === 1) {
      const leg = legs[0];
      return `${selectedDeal.ticker} ${leg.strike}${leg.right} ${expStr}`;
    } else if (legs.length === 2) {
      const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
      const type = legs[0].right === "C" ? "Call" : "Put";
      return `${selectedDeal.ticker} ${strikes[0]}/${strikes[1]} ${type} Spread ${expStr}`;
    }
    return `${selectedDeal.ticker} ${strategy.strategyType} ${expStr}`;
  };

  const handleWatchSingleLeg = async (contract: OptionContract) => {
    if (!selectedDeal || !chainData) return;

    // Calculate single leg metrics
    const cost = contract.mid;
    const costFarTouch = contract.ask;
    const dealPrice = selectedDeal.expectedClosePrice;
    
    // For calls: profit = deal price - strike - cost (if deal closes above strike)
    // For puts: profit = strike - deal price - cost (if deal closes below strike)
    let maxProfit: number;
    let maxLoss: number;
    
    if (contract.right === "C") {
      // Long call: max profit if deal closes at deal price
      const intrinsicAtDeal = Math.max(0, dealPrice - contract.strike);
      maxProfit = intrinsicAtDeal - cost;
      maxLoss = cost; // Max loss is premium paid
    } else {
      // Long put: max profit if deal fails and stock goes to 0 (theoretical)
      // More realistic: profit if stock drops below strike
      const intrinsicAtDeal = Math.max(0, contract.strike - dealPrice);
      maxProfit = intrinsicAtDeal - cost;
      maxLoss = cost; // Max loss is premium paid
    }

    // Calculate days to expiration
    const expiryDate = new Date(
      parseInt(contract.expiry.substring(0, 4)),
      parseInt(contract.expiry.substring(4, 6)) - 1,
      parseInt(contract.expiry.substring(6, 8))
    );
    const daysToExpiry = Math.max(1, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const yearsToExpiry = daysToExpiry / 365;

    // Annualized yield (simple: return / cost / years)
    const returnOnRisk = maxProfit > 0 && cost > 0 ? maxProfit / cost : 0;
    const annualizedYield = cost > 0 ? (maxProfit / cost) / yearsToExpiry : 0;
    const annualizedYieldFarTouch = costFarTouch > 0 ? ((maxProfit + cost - costFarTouch) / costFarTouch) / yearsToExpiry : 0;

    // Build strategy object for the single leg
    const strategy: CandidateStrategy = {
      id: crypto.randomUUID(),
      strategyType: contract.right === "C" ? "long_call" : "long_put",
      expiration: expiryDate,
      legs: [{
        symbol: contract.symbol,
        strike: contract.strike,
        right: contract.right,
        quantity: 1,
        side: "BUY",
        bid: contract.bid,
        ask: contract.ask,
        mid: contract.mid,
        volume: contract.volume,
        openInterest: contract.open_interest,
        bidSize: contract.bid_size,
        askSize: contract.ask_size,
      }],
      netPremium: cost,
      netPremiumFarTouch: costFarTouch,
      maxProfit: maxProfit,
      maxLoss: maxLoss,
      returnOnRisk: returnOnRisk,
      annualizedYield: annualizedYield,
      annualizedYieldFarTouch: annualizedYieldFarTouch,
      liquidityScore: calculateLiquidityScore(contract),
      notes: `Long ${contract.strike}${contract.right} @ $${cost.toFixed(2)} mid ($${costFarTouch.toFixed(2)} ask)`,
    };

    // Open modal to let user choose lists
    setPendingStrategy(strategy);
    setWatchModalOpen(true);
  };

  // Helper to calculate liquidity score for a single contract
  const calculateLiquidityScore = (contract: OptionContract): number => {
    const bidAskSpread = contract.mid > 0 ? (contract.ask - contract.bid) / contract.mid : 1;
    const spreadScore = 1 / (1 + bidAskSpread);
    const volumeScore = Math.min(contract.volume / 100, 1);
    const oiScore = Math.min(contract.open_interest / 1000, 1);
    return (spreadScore * 0.5 + volumeScore * 0.25 + oiScore * 0.25) * 100;
  };

  return (
    <div className="space-y-6">
      {/* Add Deal Form */}
      <AddDealForm onDealAdded={handleDealAdded} />

      {/* Deal Info - Show at top when selected */}
      {selectedDeal && editableDealPrice !== null && (
        <DealInfo
          deal={selectedDeal}
          onLoadChain={handleLoadChain}
          loading={loading}
          dealPrice={editableDealPrice}
          onDealPriceChange={setEditableDealPrice}
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
            {error.includes("IB TWS not connected") ? "IB TWS Not Connected" : "Error"}
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
                Learn more about IB TWS API
              </a>
            </div>
          )}
        </div>
      )}

      {/* Option Chain Viewer */}
      {chainData && selectedDeal && (
        <OptionChainViewer 
          chainData={chainData} 
          onWatchSingleLeg={handleWatchSingleLeg}
        />
      )}

      {/* Candidate Strategies */}
      {candidates.length > 0 && selectedDeal && editableDealPrice !== null && (
        <CandidateStrategiesTable
          candidates={candidates}
          onWatch={handleWatchSpread}
          dealPrice={editableDealPrice}
          daysToClose={selectedDeal.daysToClose}
          spotPrice={chainData?.spotPrice}
        />
      )}

      {/* Deal Selector - At bottom for easy access to change deals */}
      <ScannerDealSelector
        deals={deals}
        selectedDeal={selectedDeal}
        onSelectDeal={handleSelectDeal}
        onDealUpdated={handleDealUpdated}
        onDealDeleted={handleDealDeleted}
      />
      
      {/* Watch Spread Modal */}
      <WatchSpreadModal
        isOpen={watchModalOpen}
        onClose={() => {
          setWatchModalOpen(false);
          setPendingStrategy(null);
        }}
        onConfirm={handleConfirmWatch}
        spreadDescription={pendingStrategy ? getSpreadDescription(pendingStrategy) : ""}
      />
    </div>
  );
}
