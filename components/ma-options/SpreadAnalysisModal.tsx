"use client";

import { useState, useEffect, useCallback } from "react";
import type { WatchedSpreadDTO } from "@/types/ma-options";

/**
 * Get color class for profit/return values
 * Positive = green, Zero = gray, Negative = red
 */
function getProfitColorClass(value: number): string {
  if (value > 0) return "text-green-400";
  if (value < 0) return "text-red-400";
  return "text-gray-400";
}

/**
 * Format quote timestamp for display in Eastern Time
 * Shows "as of X:XX PM ET" for today, or "Jan 11, X:XX PM ET" for other days
 */
function formatQuoteTimestamp(timestamp: string): string {
  if (timestamp === "saved") return "saved";
  
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = { 
    hour: 'numeric', 
    minute: '2-digit',
    timeZone: 'America/New_York'
  };
  
  // Check if date is today in Eastern Time
  const nowET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const dateET = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const isToday = nowET === dateET;
  
  const timeStr = date.toLocaleTimeString('en-US', options);
  
  if (isToday) {
    return `as of ${timeStr} ET`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    return `${dateStr}, ${timeStr} ET`;
  }
}

interface SpreadAnalysisModalProps {
  spread: WatchedSpreadDTO;
  onClose: () => void;
}

interface StockQuote {
  price: number;
  bid: number | null;
  ask: number | null;
  timestamp: string;
}

interface ComparisonMetrics {
  capitalRequired: number;
  maxProfit: number;
  maxLoss: number;
  expectedReturnPct: number;
  capitalEfficiency: number;
  annualizedReturn: number;
}

export default function SpreadAnalysisModal({ spread, onClose }: SpreadAnalysisModalProps) {
  // Initialize with saved price if available for instant rendering
  const [stockQuote, setStockQuote] = useState<StockQuote | null>(
    spread.underlyingPrice 
      ? { price: spread.underlyingPrice, bid: null, ask: null, timestamp: "saved" }
      : null
  );
  // Only show loading if we don't have a saved price
  const [quoteLoading, setQuoteLoading] = useState(!spread.underlyingPrice);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  
  // User inputs - initialize breakPrice from saved price if available
  const [dealProbability, setDealProbability] = useState(95); // 95% default
  const [breakPrice, setBreakPrice] = useState<number | null>(
    spread.underlyingPrice ? Math.round(spread.underlyingPrice * 0.80 * 100) / 100 : null
  );
  const [userModifiedBreakPrice, setUserModifiedBreakPrice] = useState(false);
  
  // Editable deal price for what-if analysis
  const [editableDealPrice, setEditableDealPrice] = useState<number>(spread.dealPrice);
  const dealPriceModified = editableDealPrice !== spread.dealPrice;
  
  // Reusable fetch function - can be called on mount and on button click
  const fetchQuote = useCallback(async () => {
    setQuoteLoading(true);
    setQuoteError(null);
    
    try {
      const response = await fetch("/api/ma-options/stock-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: spread.dealTicker }),
        cache: "no-store",
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch quote");
      }
      
      const data = await response.json();
      setStockQuote({
        price: data.price,
        bid: data.bid,
        ask: data.ask,
        timestamp: data.timestamp,
      });
      
      // Only update break price if user hasn't manually changed it
      if (!userModifiedBreakPrice) {
        setBreakPrice(Math.round(data.price * 0.80 * 100) / 100);
      }
    } catch (error) {
      // Only set error if we don't have any price data
      setQuoteError(error instanceof Error ? error.message : "Failed to fetch quote");
    } finally {
      setQuoteLoading(false);
    }
  }, [spread.dealTicker, userModifiedBreakPrice]);
  
  // Auto-fetch on mount
  useEffect(() => {
    fetchQuote();
  }, []); // Only run once on mount
  
  // Calculate metrics for both strategies
  const calculateMetrics = useCallback((): { stock: ComparisonMetrics; spread: ComparisonMetrics } | null => {
    if (!stockQuote || breakPrice === null) return null;
    
    const prob = dealProbability / 100;
    const currentPrice = stockQuote.price;
    const dealPrice = editableDealPrice; // Use editable deal price for what-if analysis
    const daysToClose = spread.daysToClose;
    const yearsToClose = Math.max(daysToClose, 1) / 365;
    
    // Stock strategy (100 shares to match 1 contract)
    const stockCapital = currentPrice * 100;
    const stockProfitIfClose = (dealPrice - currentPrice) * 100;
    const stockLossIfBreak = (currentPrice - breakPrice) * 100;
    const stockExpectedValue = (prob * stockProfitIfClose) - ((1 - prob) * stockLossIfBreak);
    const stockExpectedReturnPct = (stockExpectedValue / stockCapital) * 100;
    const stockCapitalEfficiency = stockExpectedValue / stockCapital;
    const stockAnnualized = (Math.pow(1 + stockExpectedValue / stockCapital, 1 / yearsToClose) - 1) * 100;
    
    // Spread strategy
    // For debit spreads (call spreads), capital = entry cost
    // For credit spreads (put spreads), capital = max loss (collateral)
    const spreadCapital = spread.maxLoss * 100; // maxLoss is per share, multiply by 100
    const spreadProfitIfClose = spread.maxProfit * 100;
    
    // Calculate spread value at break price (accounts for residual intrinsic value)
    // Get strikes from legs
    const buyLeg = spread.legs.find(l => l.side === "BUY");
    const sellLeg = spread.legs.find(l => l.side === "SELL");
    const isCallSpread = spread.legs[0]?.right === "C";
    
    let spreadValueAtBreak = 0;
    if (buyLeg && sellLeg) {
      if (isCallSpread) {
        // Call spread: value = max(0, price - buyStrike) - max(0, price - sellStrike)
        const longCallValue = Math.max(0, breakPrice - buyLeg.strike);
        const shortCallValue = Math.max(0, breakPrice - sellLeg.strike);
        spreadValueAtBreak = (longCallValue - shortCallValue) * 100;
      } else {
        // Put spread: value = max(0, buyStrike - price) - max(0, sellStrike - price)
        const longPutValue = Math.max(0, buyLeg.strike - breakPrice);
        const shortPutValue = Math.max(0, sellLeg.strike - breakPrice);
        spreadValueAtBreak = (longPutValue - shortPutValue) * 100;
      }
    }
    
    // Loss at break = entry cost - value at break (for debit spreads)
    // For call spread: entry cost is spreadCapital, loss is cost minus residual value
    const spreadLossIfBreak = Math.max(0, spreadCapital - spreadValueAtBreak);
    
    const spreadExpectedValue = (prob * spreadProfitIfClose) - ((1 - prob) * spreadLossIfBreak);
    const spreadExpectedReturnPct = (spreadExpectedValue / spreadCapital) * 100;
    const spreadCapitalEfficiency = spreadExpectedValue / spreadCapital;
    const spreadAnnualized = (Math.pow(1 + spreadExpectedValue / spreadCapital, 1 / yearsToClose) - 1) * 100;
    
    return {
      stock: {
        capitalRequired: stockCapital,
        maxProfit: stockProfitIfClose,
        maxLoss: stockLossIfBreak,
        expectedReturnPct: stockExpectedReturnPct,
        capitalEfficiency: stockCapitalEfficiency,
        annualizedReturn: stockAnnualized,
      },
      spread: {
        capitalRequired: spreadCapital,
        maxProfit: spreadProfitIfClose,
        maxLoss: spreadLossIfBreak,
        expectedReturnPct: spreadExpectedReturnPct,
        capitalEfficiency: spreadCapitalEfficiency,
        annualizedReturn: spreadAnnualized,
      },
    };
  }, [stockQuote, breakPrice, dealProbability, spread, editableDealPrice]);
  
  const metrics = calculateMetrics();
  
  // Generate payoff data points
  const generatePayoffData = useCallback(() => {
    if (!stockQuote || breakPrice === null) return null;
    
    const currentPrice = stockQuote.price;
    const dealPrice = editableDealPrice; // Use editable deal price
    
    // Get spread strikes
    const strikes = spread.legs.map(leg => leg.strike).sort((a, b) => a - b);
    const lowStrike = strikes[0];
    const highStrike = strikes[strikes.length - 1];
    
    // Generate price points from break price to 10% above deal
    const minPrice = Math.min(breakPrice * 0.9, lowStrike * 0.9);
    const maxPrice = Math.max(dealPrice * 1.1, highStrike * 1.1);
    const step = (maxPrice - minPrice) / 50;
    
    const points: { price: number; stockPL: number; spreadPL: number }[] = [];
    
    for (let price = minPrice; price <= maxPrice; price += step) {
      // Stock P&L: (final price - purchase price) * 100
      const stockPL = (price - currentPrice) * 100;
      
      // Spread P&L calculation depends on spread type
      let spreadPL: number;
      
      if (spread.strategyType === "spread" || spread.legs[0]?.right === "C") {
        // Call spread: Buy low strike call, sell high strike call
        const buyLeg = spread.legs.find(l => l.side === "BUY");
        const sellLeg = spread.legs.find(l => l.side === "SELL");
        
        if (buyLeg && sellLeg) {
          const buyStrike = buyLeg.strike;
          const sellStrike = sellLeg.strike;
          const netDebit = (buyLeg.ask - sellLeg.bid);
          
          // At expiration:
          // Long call value: max(0, price - buyStrike)
          // Short call value: -max(0, price - sellStrike)
          const longCallValue = Math.max(0, price - buyStrike);
          const shortCallValue = -Math.max(0, price - sellStrike);
          spreadPL = ((longCallValue + shortCallValue) - netDebit) * 100;
        } else {
          spreadPL = 0;
        }
      } else {
        // Put spread: Buy low strike put, sell high strike put
        const buyLeg = spread.legs.find(l => l.side === "BUY");
        const sellLeg = spread.legs.find(l => l.side === "SELL");
        
        if (buyLeg && sellLeg) {
          const buyStrike = buyLeg.strike;
          const sellStrike = sellLeg.strike;
          const netCredit = (sellLeg.bid - buyLeg.ask);
          
          // At expiration:
          // Long put value: max(0, buyStrike - price)
          // Short put value: -max(0, sellStrike - price)
          const longPutValue = Math.max(0, buyStrike - price);
          const shortPutValue = -Math.max(0, sellStrike - price);
          spreadPL = ((longPutValue + shortPutValue) + netCredit) * 100;
        } else {
          spreadPL = 0;
        }
      }
      
      points.push({ price, stockPL, spreadPL });
    }
    
    return {
      points,
      markers: {
        currentPrice,
        breakPrice,
        dealPrice,
        lowStrike,
        highStrike,
      },
    };
  }, [stockQuote, breakPrice, spread, editableDealPrice]);
  
  const payoffData = generatePayoffData();
  
  // Format currency
  const formatCurrency = (value: number) => {
    const sign = value >= 0 ? "" : "-";
    return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  // Format percentage
  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  };
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">
              Spread Analysis: {spread.dealTicker}
            </h2>
            <p className="text-sm text-gray-400">
              {spread.strategyType === "spread" 
                ? (spread.legs[0]?.right === "C" ? "Call Spread" : "Put Spread")
                : spread.strategyType} | {spread.expiration} | {spread.legs.map(l => `${l.strike}${l.right}`).join("/")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-xl px-2"
          >
            ×
          </button>
        </div>
        
        <div className="p-4 space-y-6">
          {/* Stock Quote & Inputs */}
          <div className="grid grid-cols-3 gap-4">
            {/* Current Stock Price */}
            <div className="bg-gray-800 rounded p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Current Stock Price</span>
                <button
                  onClick={fetchQuote}
                  disabled={quoteLoading}
                  className={`text-gray-400 hover:text-white transition-colors ${quoteLoading ? 'animate-spin' : ''}`}
                  title="Refresh quote"
                >
                  ↻
                </button>
              </div>
              {quoteLoading && !stockQuote ? (
                <div className="text-gray-400">Loading...</div>
              ) : quoteError && !stockQuote ? (
                <div className="text-red-400 text-sm">{quoteError}</div>
              ) : stockQuote ? (
                <>
                  <div className="text-xl font-mono text-gray-100">${stockQuote.price.toFixed(2)}</div>
                  {stockQuote.bid && stockQuote.ask && (
                    <div className="text-xs text-gray-500 mt-1">
                      Bid: ${stockQuote.bid.toFixed(2)} | Ask: ${stockQuote.ask.toFixed(2)}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatQuoteTimestamp(stockQuote.timestamp)}
                  </div>
                </>
              ) : null}
            </div>
            
            {/* Deal Probability Input */}
            <div className="bg-gray-800 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">Deal Close Probability</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={dealProbability}
                  onChange={(e) => setDealProbability(parseInt(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={dealProbability}
                  onChange={(e) => setDealProbability(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-gray-100 text-sm text-center"
                />
                <span className="text-gray-400">%</span>
              </div>
            </div>
            
            {/* Break Price Input */}
            <div className="bg-gray-800 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">Break Price (if deal fails)</div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={breakPrice ?? ""}
                  onChange={(e) => {
                    setBreakPrice(parseFloat(e.target.value) || null);
                    setUserModifiedBreakPrice(true);
                  }}
                  className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-gray-100 text-sm"
                  placeholder="e.g., stock price without deal premium"
                />
              </div>
              {stockQuote && breakPrice && (
                <div className="text-xs text-gray-500 mt-1">
                  {((1 - breakPrice / stockQuote.price) * 100).toFixed(0)}% below current
                </div>
              )}
            </div>
          </div>
          
          {/* Deal Info */}
          <div className="bg-gray-800/50 rounded p-3 flex flex-wrap gap-4 text-sm items-center">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Deal Price:</span>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={editableDealPrice}
                  onChange={(e) => setEditableDealPrice(parseFloat(e.target.value) || spread.dealPrice)}
                  className="w-20 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-gray-100 text-sm font-mono"
                />
                {dealPriceModified && (
                  <button
                    onClick={() => setEditableDealPrice(spread.dealPrice)}
                    className="text-xs text-yellow-500 hover:text-yellow-400 ml-1"
                    title={`Reset to original: $${spread.dealPrice.toFixed(2)}`}
                  >
                    ↺
                  </button>
                )}
              </div>
              {dealPriceModified && (
                <span className="text-xs text-yellow-500">
                  ({((editableDealPrice / spread.dealPrice - 1) * 100) >= 0 ? "+" : ""}
                  {((editableDealPrice / spread.dealPrice - 1) * 100).toFixed(1)}%)
                </span>
              )}
            </div>
            <div>
              <span className="text-gray-500">Expected Close:</span>{" "}
              <span className="text-gray-100">{spread.dealExpectedCloseDate}</span>
            </div>
            <div>
              <span className="text-gray-500">Days to Close:</span>{" "}
              <span className="text-gray-100">{spread.daysToClose}</span>
            </div>
            {stockQuote && (
              <div>
                <span className="text-gray-500">Upside to Deal:</span>{" "}
                <span className="text-green-400">
                  {((editableDealPrice / stockQuote.price - 1) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
          
          {/* Comparison Table */}
          {metrics && (
            <div className="bg-gray-800 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-3 text-gray-400">Metric</th>
                    <th className="text-right py-2 px-3 text-blue-400">Stock (100 shares)</th>
                    <th className="text-right py-2 px-3 text-purple-400">Spread (1 contract)</th>
                    <th className="text-right py-2 px-3 text-gray-400">Advantage</th>
                  </tr>
                </thead>
                <tbody className="text-gray-100">
                  <tr className="border-b border-gray-700/50">
                    <td className="py-2 px-3 text-gray-400">Capital Required</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(metrics.stock.capitalRequired)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(metrics.spread.capitalRequired)}</td>
                    <td className="py-2 px-3 text-right text-purple-400">
                      {((1 - metrics.spread.capitalRequired / metrics.stock.capitalRequired) * 100).toFixed(0)}% less
                    </td>
                  </tr>
                  <tr className="border-b border-gray-700/50">
                    <td className="py-2 px-3 text-gray-400">Max Profit (deal closes)</td>
                    <td className={`py-2 px-3 text-right font-mono ${getProfitColorClass(metrics.stock.maxProfit)}`}>
                      +{(metrics.stock.maxProfit / metrics.stock.capitalRequired * 100).toFixed(1)}% <span className="text-gray-500">({formatCurrency(metrics.stock.maxProfit)})</span>
                    </td>
                    <td className={`py-2 px-3 text-right font-mono ${getProfitColorClass(metrics.spread.maxProfit)}`}>
                      +{(metrics.spread.maxProfit / metrics.spread.capitalRequired * 100).toFixed(1)}% <span className="text-gray-500">({formatCurrency(metrics.spread.maxProfit)})</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {(() => {
                        const stockProfitPct = metrics.stock.maxProfit / metrics.stock.capitalRequired * 100;
                        const spreadProfitPct = metrics.spread.maxProfit / metrics.spread.capitalRequired * 100;
                        if (spreadProfitPct > stockProfitPct) {
                          return <span className="text-purple-400">Spread +{(spreadProfitPct - stockProfitPct).toFixed(1)}pp</span>;
                        } else if (stockProfitPct > spreadProfitPct) {
                          return <span className="text-blue-400">Stock +{(stockProfitPct - spreadProfitPct).toFixed(1)}pp</span>;
                        } else {
                          return <span className="text-gray-400">—</span>;
                        }
                      })()}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-700/50">
                    <td className="py-2 px-3 text-gray-400">Max Loss (deal breaks)</td>
                    <td className="py-2 px-3 text-right font-mono text-red-400">
                      -{(metrics.stock.maxLoss / metrics.stock.capitalRequired * 100).toFixed(1)}% <span className="text-gray-500">({formatCurrency(-metrics.stock.maxLoss)})</span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-red-400">
                      -{(metrics.spread.maxLoss / metrics.spread.capitalRequired * 100).toFixed(1)}% <span className="text-gray-500">({formatCurrency(-metrics.spread.maxLoss)})</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {(() => {
                        const stockLossPct = metrics.stock.maxLoss / metrics.stock.capitalRequired * 100;
                        const spreadLossPct = metrics.spread.maxLoss / metrics.spread.capitalRequired * 100;
                        // Lower % loss is better
                        if (spreadLossPct < stockLossPct) {
                          return <span className="text-purple-400">Spread -{(stockLossPct - spreadLossPct).toFixed(1)}pp</span>;
                        } else if (stockLossPct < spreadLossPct) {
                          return <span className="text-blue-400">Stock -{(spreadLossPct - stockLossPct).toFixed(1)}pp</span>;
                        } else {
                          return <span className="text-gray-400">—</span>;
                        }
                      })()}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-700/50">
                    <td className="py-2 px-3 text-gray-400">Expected Return %</td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={getProfitColorClass(metrics.stock.expectedReturnPct)}>
                        {formatPercent(metrics.stock.expectedReturnPct)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={getProfitColorClass(metrics.spread.expectedReturnPct)}>
                        {formatPercent(metrics.spread.expectedReturnPct)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {metrics.spread.expectedReturnPct > metrics.stock.expectedReturnPct ? (
                        <span className="text-purple-400">+{(metrics.spread.expectedReturnPct - metrics.stock.expectedReturnPct).toFixed(1)}pp</span>
                      ) : metrics.stock.expectedReturnPct > metrics.spread.expectedReturnPct ? (
                        <span className="text-blue-400">+{(metrics.stock.expectedReturnPct - metrics.spread.expectedReturnPct).toFixed(1)}pp</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-gray-400">Annualized Return</td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={getProfitColorClass(metrics.stock.annualizedReturn)}>
                        {formatPercent(metrics.stock.annualizedReturn)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={getProfitColorClass(metrics.spread.annualizedReturn)}>
                        {formatPercent(metrics.spread.annualizedReturn)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          
          {/* Payoff Diagram */}
          {payoffData && (
            <div className="bg-gray-800 rounded p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Payoff at Expiration</h3>
              <PayoffChart data={payoffData} />
            </div>
          )}
          
          {/* Insights */}
          {metrics && stockQuote && (
            <div className="bg-gray-800/50 rounded p-4 text-sm">
              <h3 className="text-gray-300 font-medium mb-2">Key Insights</h3>
              <ul className="space-y-1 text-gray-400">
                <li>
                  • The spread requires <span className="text-purple-400">{((1 - metrics.spread.capitalRequired / metrics.stock.capitalRequired) * 100).toFixed(0)}% less capital</span> than buying the stock
                </li>
                {metrics.spread.capitalEfficiency > metrics.stock.capitalEfficiency && (
                  <li>
                    • The spread is more <span className="text-purple-400">capital efficient</span> ({(metrics.spread.capitalEfficiency * 100).toFixed(1)}% vs {(metrics.stock.capitalEfficiency * 100).toFixed(1)}%)
                  </li>
                )}
                {spread.legs[0]?.right === "C" && breakPrice && stockQuote && (
                  <li>
                    • If deal breaks and stock falls to ${breakPrice.toFixed(2)}, stock loses {formatCurrency(metrics.stock.maxLoss)} while spread loses only {formatCurrency(metrics.spread.maxLoss)}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple SVG Payoff Chart Component
interface PayoffChartProps {
  data: {
    points: { price: number; stockPL: number; spreadPL: number }[];
    markers: {
      currentPrice: number;
      breakPrice: number;
      dealPrice: number;
      lowStrike: number;
      highStrike: number;
    };
  };
}

function PayoffChart({ data }: PayoffChartProps) {
  const { points, markers } = data;
  
  // Calculate bounds
  const minPrice = Math.min(...points.map(p => p.price));
  const maxPrice = Math.max(...points.map(p => p.price));
  const minPL = Math.min(...points.flatMap(p => [p.stockPL, p.spreadPL]));
  const maxPL = Math.max(...points.flatMap(p => [p.stockPL, p.spreadPL]));
  
  // SVG dimensions - increased bottom padding for X-axis label
  const width = 600;
  const height = 270;
  const padding = { top: 20, right: 20, bottom: 55, left: 70 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Scale functions
  const scaleX = (price: number) => padding.left + ((price - minPrice) / (maxPrice - minPrice)) * chartWidth;
  const scaleY = (pl: number) => padding.top + chartHeight - ((pl - minPL) / (maxPL - minPL)) * chartHeight;
  
  // Generate path strings
  const stockPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.price)} ${scaleY(p.stockPL)}`).join(" ");
  const spreadPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.price)} ${scaleY(p.spreadPL)}`).join(" ");
  
  // Zero line Y position
  const zeroY = scaleY(0);
  
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="text-gray-400">
      {/* Grid lines */}
      <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#4b5563" strokeWidth="1" />
      
      {/* Marker lines */}
      {/* Current Price */}
      <line
        x1={scaleX(markers.currentPrice)}
        y1={padding.top}
        x2={scaleX(markers.currentPrice)}
        y2={height - padding.bottom}
        stroke="#6b7280"
        strokeWidth="1"
        strokeDasharray="4,4"
      />
      <text x={scaleX(markers.currentPrice)} y={height - 5} textAnchor="middle" className="text-[10px] fill-gray-500">
        Current
      </text>
      
      {/* Break Price */}
      <line
        x1={scaleX(markers.breakPrice)}
        y1={padding.top}
        x2={scaleX(markers.breakPrice)}
        y2={height - padding.bottom}
        stroke="#ef4444"
        strokeWidth="1"
        strokeDasharray="4,4"
      />
      <text x={scaleX(markers.breakPrice)} y={height - 5} textAnchor="middle" className="text-[10px] fill-red-500">
        Break
      </text>
      
      {/* Deal Price */}
      <line
        x1={scaleX(markers.dealPrice)}
        y1={padding.top}
        x2={scaleX(markers.dealPrice)}
        y2={height - padding.bottom}
        stroke="#22c55e"
        strokeWidth="1"
        strokeDasharray="4,4"
      />
      <text x={scaleX(markers.dealPrice)} y={height - 5} textAnchor="middle" className="text-[10px] fill-green-500">
        Deal
      </text>
      
      {/* Stock line */}
      <path d={stockPath} fill="none" stroke="#3b82f6" strokeWidth="2" />
      
      {/* Spread line */}
      <path d={spreadPath} fill="none" stroke="#a855f7" strokeWidth="2" />
      
      {/* Y-axis labels */}
      <text x={padding.left - 10} y={scaleY(maxPL)} textAnchor="end" dominantBaseline="middle" className="text-[10px] fill-gray-500">
        ${Math.round(maxPL)}
      </text>
      <text x={padding.left - 10} y={zeroY} textAnchor="end" dominantBaseline="middle" className="text-[10px] fill-gray-500">
        $0
      </text>
      <text x={padding.left - 10} y={scaleY(minPL)} textAnchor="end" dominantBaseline="middle" className="text-[10px] fill-gray-500">
        ${Math.round(minPL)}
      </text>
      
      {/* Y-axis title (rotated) */}
      <text
        x={15}
        y={(padding.top + height - padding.bottom) / 2}
        transform={`rotate(-90, 15, ${(padding.top + height - padding.bottom) / 2})`}
        textAnchor="middle"
        className="text-[11px] fill-gray-400"
      >
        Payoff ($)
      </text>
      
      {/* X-axis title */}
      <text
        x={(padding.left + width - padding.right) / 2}
        y={height - 10}
        textAnchor="middle"
        className="text-[11px] fill-gray-400"
      >
        Stock Price ($)
      </text>
      
      {/* Legend */}
      <g transform={`translate(${width - padding.right - 100}, ${padding.top})`}>
        <line x1="0" y1="5" x2="20" y2="5" stroke="#3b82f6" strokeWidth="2" />
        <text x="25" y="8" className="text-[10px] fill-blue-400">Stock</text>
        <line x1="0" y1="20" x2="20" y2="20" stroke="#a855f7" strokeWidth="2" />
        <text x="25" y="23" className="text-[10px] fill-purple-400">Spread</text>
      </g>
    </svg>
  );
}
