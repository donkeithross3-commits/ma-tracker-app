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
  entry_cost: number;
  max_profit: number;
  breakeven: number;
  expected_return: number;
  annualized_return: number;
  probability_of_profit: number;
  edge_vs_market: number;
  notes: string;
  contracts: OptionContract[];
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

      {/* Opportunities List */}
      {data && data.opportunities && data.opportunities.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Top Opportunities ({data.opportunities.length})
            </h3>
          </div>

          {data.opportunities.map((opp, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="capitalize">{opp.strategy}</span>
                      {opp.annualized_return > 0 && (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">{opp.notes}</CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">
                      {formatPercent(opp.annualized_return)}
                    </div>
                    <div className="text-xs text-muted-foreground">Annualized</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-5">
                  <div>
                    <div className="text-sm text-muted-foreground">Entry Cost</div>
                    <div className="text-lg font-bold">
                      {formatCurrency(opp.entry_cost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Max Profit</div>
                    <div className="text-lg font-bold text-green-600">
                      {formatCurrency(opp.max_profit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Expected Return</div>
                    <div className="text-lg font-bold">
                      {formatCurrency(opp.expected_return)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatPercent(opp.expected_return / opp.entry_cost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Probability</div>
                    <div className="text-lg font-bold">
                      {formatPercent(opp.probability_of_profit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Edge vs Market</div>
                    <div
                      className={`text-lg font-bold ${
                        opp.edge_vs_market > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {opp.edge_vs_market > 0 ? "+" : ""}
                      {formatPercent(opp.edge_vs_market)}
                    </div>
                  </div>
                </div>

                {/* Contract Details */}
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm font-medium mb-2">Contract Details:</div>
                  <div className="space-y-2">
                    {opp.contracts.map((contract, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm bg-gray-50 rounded p-2"
                      >
                        <div className="flex items-center gap-4">
                          <span className="font-medium">
                            {contract.symbol} {formatCurrency(contract.strike)}{" "}
                            {contract.right === "C" ? "Call" : "Put"}
                          </span>
                          <span className="text-muted-foreground">
                            Exp: {formatExpiry(contract.expiry)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div>
                            <span className="text-muted-foreground">Bid/Ask: </span>
                            <span className="font-mono">
                              {formatCurrency(contract.bid)} / {formatCurrency(contract.ask)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">IV: </span>
                            <span className="font-mono">
                              {contract.implied_vol != null ? formatPercent(contract.implied_vol) : 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Δ: </span>
                            <span className="font-mono">{contract.delta != null ? contract.delta.toFixed(2) : 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
                  <div>
                    <span className="text-muted-foreground">Breakeven: </span>
                    <span className="font-semibold">{formatCurrency(opp.breakeven)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Return on Risk: </span>
                    <span className="font-semibold">
                      {formatPercent(opp.max_profit / opp.entry_cost)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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
