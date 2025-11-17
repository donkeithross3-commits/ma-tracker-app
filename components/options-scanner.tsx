"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Loader2, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

interface OptionContract {
  symbol: string;
  strike: number;
  expiry: string;
  right: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open_interest: number;
  implied_vol: number | null;  // May be null when IB doesn't provide Greeks
  delta: number | null;  // May be null when IB doesn't provide Greeks
  mid_price: number;
}

interface Opportunity {
  strategy: string;
  entry_cost: number;  // Midpoint cost
  max_profit: number;
  breakeven: number;
  expected_return: number;  // Midpoint expected return
  annualized_return: number;  // Midpoint annualized return
  probability_of_profit: number;
  edge_vs_market: number;
  notes: string;
  contracts: OptionContract[];
  // Far-touch metrics
  entry_cost_ft: number;
  expected_return_ft: number;
  annualized_return_ft: number;
}

interface ScannerResponse {
  success: boolean;
  ticker: string;
  current_price?: number;
  deal_value: number;
  spread_pct?: number;
  days_to_close: number;
  opportunities: Opportunity[];
  error?: string;
}

interface OptionsScannerProps {
  ticker: string;
  dealPrice: number;
  expectedCloseDate: Date | null;
  dividend?: number;
  cvrValue?: number;
  confidence?: number;
}

export function OptionsScanner({
  ticker,
  dealPrice,
  expectedCloseDate,
  dividend = 0,
  cvrValue = 0,
  confidence = 0.75,
}: OptionsScannerProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!expectedCloseDate) {
      setError("Expected close date is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/options/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker,
          deal_price: dealPrice,
          expected_close_date: expectedCloseDate.toISOString().split("T")[0],
          dividend_before_close: dividend,
          ctr_value: cvrValue,
          confidence,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || result.details || "Failed to scan options");
        return;
      }

      setData(result);
    } catch (err: any) {
      setError(err.message || "Failed to connect to options scanner");
    } finally {
      setLoading(false);
    }
  };

  const formatExpiry = (expiry: string) => {
    // Format YYYYMMDD to MMM DD, YYYY
    const year = expiry.substring(0, 4);
    const month = expiry.substring(4, 6);
    const day = expiry.substring(6, 8);
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Options Scanner</CardTitle>
              <CardDescription>
                Analyze call options and spreads for merger arbitrage opportunities
              </CardDescription>
            </div>
            <Button onClick={handleScan} disabled={loading || !expectedCloseDate}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                "Scan Options"
              )}
            </Button>
          </div>
        </CardHeader>
        {data && (
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-sm text-muted-foreground">Current Price</div>
                <div className="text-2xl font-bold">
                  {data.current_price ? formatCurrency(data.current_price) : "-"}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Deal Value</div>
                <div className="text-2xl font-bold">{formatCurrency(data.deal_value)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Spread</div>
                <div className="text-2xl font-bold">
                  {data.spread_pct !== undefined ? formatPercent(data.spread_pct / 100) : "-"}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Days to Close</div>
                <div className="text-2xl font-bold">{data.days_to_close}</div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Error Message */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <div className="font-semibold text-red-900">Scan Failed</div>
                <div className="text-sm text-red-700">{error}</div>
                <div className="text-xs text-red-600 mt-2">
                  Ensure the Python options scanner service is running and accessible.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Opportunities List - Compact Table View */}
      {data && data.opportunities && data.opportunities.length > 0 && (
        <div className="space-y-6">
          {/* Separate call spreads and put spreads */}
          {(() => {
            const callSpreads = data.opportunities.filter(opp => opp.strategy === 'spread');
            const putSpreads = data.opportunities.filter(opp => opp.strategy === 'put_spread');

            // Group call spreads by expiration
            const callsByExpiry: { [key: string]: typeof data.opportunities } = {};
            callSpreads.forEach((opp) => {
              const expiry = opp.contracts[0]?.expiry || 'unknown';
              if (!callsByExpiry[expiry]) callsByExpiry[expiry] = [];
              callsByExpiry[expiry].push(opp);
            });

            // Group put spreads by expiration
            const putsByExpiry: { [key: string]: typeof data.opportunities } = {};
            putSpreads.forEach((opp) => {
              const expiry = opp.contracts[0]?.expiry || 'unknown';
              if (!putsByExpiry[expiry]) putsByExpiry[expiry] = [];
              putsByExpiry[expiry].push(opp);
            });

            return (
              <>
                {/* Call Spreads Section */}
                {callSpreads.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Call Spreads (Debit)</h3>
                    {Object.entries(callsByExpiry).map(([expiry, opps]) => (
              <Card key={expiry}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Expiration: {formatExpiry(expiry)} ({opps.length} spread{opps.length !== 1 ? 's' : ''})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2 font-medium">Spread</th>
                          <th className="text-right py-2 px-2 font-medium">Midpt Cost</th>
                          <th className="text-right py-2 px-2 font-medium">Midpt Exp Return</th>
                          <th className="text-right py-2 px-2 font-medium">Midpt Annual %</th>
                          <th className="text-right py-2 px-2 font-medium">FT Cost</th>
                          <th className="text-right py-2 px-2 font-medium">FT Exp Return</th>
                          <th className="text-right py-2 px-2 font-medium">FT Annual %</th>
                          <th className="text-right py-2 px-2 font-medium">Leg 1 Bid/Ask</th>
                          <th className="text-right py-2 px-2 font-medium">Leg 2 Bid/Ask</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opps.map((opp, idx) => {
                          const longContract = opp.contracts[0];
                          const shortContract = opp.contracts[1];
                          return (
                            <tr
                              key={idx}
                              className="border-b hover:bg-gray-50"
                            >
                              <td className="py-2 px-2 font-medium">
                                {longContract?.strike}/{shortContract?.strike}
                              </td>
                              {/* Midpoint metrics */}
                              <td className="text-right py-2 px-2 font-mono">
                                {formatCurrency(opp.entry_cost)}
                              </td>
                              <td className="text-right py-2 px-2">
                                <div className="font-mono">{formatCurrency(opp.expected_return)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatPercent(opp.expected_return / opp.entry_cost)}
                                </div>
                              </td>
                              <td className={`text-right py-2 px-2 font-bold ${
                                opp.annualized_return > 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {formatPercent(opp.annualized_return)}
                              </td>
                              {/* Far-touch metrics */}
                              <td className="text-right py-2 px-2 font-mono">
                                {formatCurrency(opp.entry_cost_ft)}
                              </td>
                              <td className="text-right py-2 px-2">
                                <div className="font-mono">{formatCurrency(opp.expected_return_ft)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatPercent(opp.expected_return_ft / opp.entry_cost_ft)}
                                </div>
                              </td>
                              <td className={`text-right py-2 px-2 font-bold ${
                                opp.annualized_return_ft > 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {formatPercent(opp.annualized_return_ft)}
                              </td>
                              {/* Contract bid/ask */}
                              <td className="text-right py-2 px-2 font-mono text-xs">
                                {longContract ? `${formatCurrency(longContract.bid)}/${formatCurrency(longContract.ask)}` : '-'}
                              </td>
                              <td className="text-right py-2 px-2 font-mono text-xs">
                                {shortContract ? `${formatCurrency(shortContract.bid)}/${formatCurrency(shortContract.ask)}` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
                    ))}
                  </div>
                )}

                {/* Put Spreads Section */}
                {putSpreads.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Put Spreads (Credit)</h3>
                    {Object.entries(putsByExpiry).map(([expiry, opps]) => (
                      <Card key={`put-${expiry}`}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">
                            Expiration: {formatExpiry(expiry)} ({opps.length} spread{opps.length !== 1 ? 's' : ''})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-2 px-2 font-medium">Spread</th>
                                  <th className="text-right py-2 px-2 font-medium">Midpt Credit</th>
                                  <th className="text-right py-2 px-2 font-medium">Midpt Max Loss</th>
                                  <th className="text-right py-2 px-2 font-medium">Midpt R/R</th>
                                  <th className="text-right py-2 px-2 font-medium">Midpt Annual %</th>
                                  <th className="text-right py-2 px-2 font-medium">FT Credit</th>
                                  <th className="text-right py-2 px-2 font-medium">FT Max Loss</th>
                                  <th className="text-right py-2 px-2 font-medium">FT R/R</th>
                                  <th className="text-right py-2 px-2 font-medium">FT Annual %</th>
                                  <th className="text-right py-2 px-2 font-medium">Leg 1 Bid/Ask</th>
                                  <th className="text-right py-2 px-2 font-medium">Leg 2 Bid/Ask</th>
                                </tr>
                              </thead>
                              <tbody>
                                {opps.map((opp, idx) => {
                                  const longPut = opp.contracts[0];  // Buy lower strike
                                  const shortPut = opp.contracts[1];  // Sell higher strike

                                  // For put spreads:
                                  // Credit = max_profit (expected_return)
                                  // Max loss = entry_cost
                                  // R/R = edge_vs_market

                                  const creditMid = opp.max_profit;
                                  const maxLossMid = opp.entry_cost;
                                  const rrMid = opp.edge_vs_market;

                                  const creditFt = opp.expected_return_ft;
                                  const maxLossFt = opp.entry_cost_ft;
                                  const rrFt = creditFt / maxLossFt;

                                  return (
                                    <tr
                                      key={idx}
                                      className="border-b hover:bg-gray-50"
                                    >
                                      <td className="py-2 px-2 font-medium">
                                        {longPut?.strike}/{shortPut?.strike}P
                                      </td>
                                      {/* Midpoint metrics */}
                                      <td className="text-right py-2 px-2 font-mono text-green-600">
                                        {formatCurrency(creditMid)}
                                      </td>
                                      <td className="text-right py-2 px-2 font-mono text-red-600">
                                        {formatCurrency(maxLossMid)}
                                      </td>
                                      <td className="text-right py-2 px-2 font-bold">
                                        {rrMid.toFixed(2)}x
                                      </td>
                                      <td className={`text-right py-2 px-2 font-bold ${
                                        opp.annualized_return > 0 ? 'text-green-600' : 'text-red-600'
                                      }`}>
                                        {formatPercent(opp.annualized_return)}
                                      </td>
                                      {/* Far-touch metrics */}
                                      <td className="text-right py-2 px-2 font-mono text-green-600">
                                        {formatCurrency(creditFt)}
                                      </td>
                                      <td className="text-right py-2 px-2 font-mono text-red-600">
                                        {formatCurrency(maxLossFt)}
                                      </td>
                                      <td className="text-right py-2 px-2 font-bold">
                                        {rrFt.toFixed(2)}x
                                      </td>
                                      <td className={`text-right py-2 px-2 font-bold ${
                                        opp.annualized_return_ft > 0 ? 'text-green-600' : 'text-red-600'
                                      }`}>
                                        {formatPercent(opp.annualized_return_ft)}
                                      </td>
                                      {/* Contract bid/ask */}
                                      <td className="text-right py-2 px-2 font-mono text-xs">
                                        {longPut ? `${formatCurrency(longPut.bid)}/${formatCurrency(longPut.ask)}` : '-'}
                                      </td>
                                      <td className="text-right py-2 px-2 font-mono text-xs">
                                        {shortPut ? `${formatCurrency(shortPut.bid)}/${formatCurrency(shortPut.ask)}` : '-'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* No Opportunities */}
      {data && data.opportunities && data.opportunities.length === 0 && !data.error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <TrendingDown className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <div className="font-medium">No Profitable Opportunities Found</div>
            <div className="text-sm mt-2">
              The scanner did not identify any attractive option strategies for this deal.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scanner Error */}
      {data && data.error && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <div className="font-semibold text-yellow-900">Scanner Warning</div>
                <div className="text-sm text-yellow-700">{data.error}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
